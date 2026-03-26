import { loadEnvConfig } from '@next/env';
import { APP_CONFIG } from '../lib/config';
import { generateSafeId } from '../lib/utils';
import {
  CcxtBrokerAdapter,
  createBrokerAdapter,
  type IBrokerAdapter,
  type BrokerOrderResult,
} from '../lib/trading/broker-adapter';
import { calculatePositionSize, MAX_ACCOUNT_RISK_PER_TRADE } from '../lib/trading/risk-manager';
import { StealthExecutionEngine } from '../lib/trading/stealth-execution';

type TestResult = {
  name: string;
  passed: boolean;
  details: string;
  error?: string;
};

const COLOR = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function pass(label: string, details: string): void {
  console.log(`${COLOR.green}PASS${COLOR.reset} ${label} -> ${details}`);
}

function fail(label: string, details: string): void {
  console.error(`${COLOR.red}FAIL${COLOR.reset} ${label} -> ${details}`);
}

function info(message: string): void {
  console.log(`${COLOR.cyan}${message}${COLOR.reset}`);
}

function warn(message: string): void {
  console.log(`${COLOR.yellow}${message}${COLOR.reset}`);
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (typeof value !== 'string') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function createFastTimerCap(maxDelayMs: number): () => void {
  const originalSetTimeout = globalThis.setTimeout;
  const patchedSetTimeout: typeof setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const boundedTimeout = Math.min(typeof timeout === 'number' ? timeout : 0, maxDelayMs);
    return originalSetTimeout(handler, boundedTimeout, ...args);
  }) as typeof setTimeout;

  globalThis.setTimeout = patchedSetTimeout;
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}

async function runTest1EnvironmentAndBroker(): Promise<TestResult> {
  const testName = 'Test 1 - Environment & Broker Validation';
  try {
    const requiredEnv = ['IS_LIVE_MODE', 'EXCHANGE_TESTNET'] as const;
    const missing = requiredEnv.filter((key) => {
      const value = process.env[key];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    assertCondition(missing.length === 0, `Missing required environment variables: ${missing.join(', ')}`);

    const testnet = parseBooleanEnv('EXCHANGE_TESTNET', false);
    let broker: IBrokerAdapter;
    let brokerMode = '';
    let brokerSource = '';

    try {
      broker = new CcxtBrokerAdapter({ exchangeId: 'binance', testnet });
      brokerMode = 'Live';
      brokerSource = 'CcxtBrokerAdapter';
    } catch (liveError) {
      warn(
        `[Diagnostics] Live broker init failed (${liveError instanceof Error ? liveError.message : String(liveError)}), switching to fallback adapter.`
      );
      broker = createBrokerAdapter({ allowSimulationFallback: true, testnet });
      brokerMode = broker.isSimulated ? 'Simulated' : 'Live';
      brokerSource = broker.isSimulated ? 'SimulatedExchangeAdapter (fallback)' : 'CcxtBrokerAdapter';
    }

    assertCondition(!!broker, 'Broker adapter could not be instantiated.');

    const appMode = APP_CONFIG.isLiveMode ? 'Live' : 'Simulated';
    return {
      name: testName,
      passed: true,
      details: `App mode: ${appMode} | Broker mode: ${brokerMode} | Source: ${brokerSource} | EXCHANGE_TESTNET=${String(testnet)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      details: 'Environment or broker validation failed.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTest2RiskManagerStress(): Promise<TestResult> {
  const testName = 'Test 2 - Risk Manager Stress Test';
  try {
    const accountBalance = 100_000;

    const aggressiveScenario = calculatePositionSize(accountBalance, 95, 1.2);
    const hardCapUsd = accountBalance * MAX_ACCOUNT_RISK_PER_TRADE;
    assertCondition(
      aggressiveScenario.positionSizeUsd <= hardCapUsd,
      `Hard cap breach: suggested ${formatCurrency(aggressiveScenario.positionSizeUsd)} exceeds ${formatCurrency(hardCapUsd)}`
    );

    const defensiveScenario = calculatePositionSize(accountBalance, 25, 9);
    const defensiveIsProtected =
      defensiveScenario.rejected ||
      defensiveScenario.positionSizeUsd <= accountBalance * 0.005 ||
      defensiveScenario.positionSizeUsd <= hardCapUsd * 0.25;
    assertCondition(
      defensiveIsProtected,
      `Defensive scenario not reduced/rejected enough: ${formatCurrency(defensiveScenario.positionSizeUsd)}`
    );

    return {
      name: testName,
      passed: true,
      details: `High confidence result=${formatCurrency(aggressiveScenario.positionSizeUsd)} (cap ${formatCurrency(hardCapUsd)}), low confidence/high vol result=${formatCurrency(defensiveScenario.positionSizeUsd)} rejected=${String(defensiveScenario.rejected)}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      details: 'Risk manager stress assertions failed.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createDryRunBroker(): IBrokerAdapter {
  return {
    isSimulated: true,
    async fetchTicker() {
      return { simulated: true, timestamp: Date.now() };
    },
    async fetchBalance() {
      return { simulated: true, free: { USDT: 1_000_000 } };
    },
    async createMarketOrder(symbol: string, side: 'buy' | 'sell', amount: number): Promise<BrokerOrderResult> {
      return {
        id: `dryrun-${generateSafeId()}`,
        symbol,
        side,
        amount,
        status: 'closed',
        info: { dryRun: true },
      };
    },
  };
}

async function runTest3TwapDryRun(): Promise<TestResult> {
  const testName = 'Test 3 - TWAP Engine Dry-Run';
  const restoreTimer = createFastTimerCap(5);
  try {
    const broker = createDryRunBroker();
    const engine = new StealthExecutionEngine(broker);

    const result = await engine.executeTWAP('BTC/USDT', 'buy', 1000, 1, 5);
    assertCondition(result.chunkResults.length === 5, `Expected 5 chunks, got ${result.chunkResults.length}`);
    const totalExecuted = result.chunkResults.reduce((sum, c) => sum + c.amount, 0);
    assertCondition(Math.abs(totalExecuted - 1000) < 0.0001, `Total executed mismatch: ${totalExecuted}`);

    return {
      name: testName,
      passed: true,
      details: `Executed ${result.chunkResults.length} chunks, total=${totalExecuted.toFixed(8)}, planned interval=${Math.round(result.intervalMs)}ms (timer-capped for diagnostics).`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      details: 'TWAP dry-run failed.',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    restoreTimer();
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  info('MON CHERI QUANTUM :: PHASE 7 Automated Diagnostics');
  info(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  const results: TestResult[] = [];

  results.push(await runTest1EnvironmentAndBroker());
  results.push(await runTest2RiskManagerStress());
  results.push(await runTest3TwapDryRun());

  console.log('');
  info('Diagnostic Report');
  for (const result of results) {
    if (result.passed) {
      pass(result.name, result.details);
    } else {
      fail(result.name, `${result.details}${result.error ? ` | ${result.error}` : ''}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log('');
  if (failedCount === 0) {
    pass('Overall Status', `${passedCount}/${results.length} tests passed. System diagnostics are green.`);
    process.exitCode = 0;
  } else {
    fail('Overall Status', `${failedCount}/${results.length} tests failed. Review errors before deployment.`);
    process.exitCode = 1;
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    fail('Diagnostics Runtime', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
})();
