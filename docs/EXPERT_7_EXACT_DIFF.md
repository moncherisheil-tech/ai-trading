# EXPERT 7 (CONTRARIAN) — EXACT CODE DIFFS

All changes required to integrate Expert 7 into the resilience layer.

---

## DIFF 1: ExpertContrarianOutput Interface

**File:** `lib/consensus-engine.ts` (Line 272)

**BEFORE:**
```typescript
export interface ExpertContrarianOutput {
  contrarian_confidence: number;
  trap_type: 'none' | 'bull_trap' | 'bear_trap' | 'liquidity_trap';
  attack_on_consensus_he: string;
  trap_hypothesis_he: string;
}
```

**AFTER:**
```typescript
export interface ExpertContrarianOutput {
  contrarian_confidence: number;
  trap_type: 'none' | 'bull_trap' | 'bear_trap' | 'liquidity_trap';
  attack_on_consensus_he: string;
  trap_hypothesis_he: string;
  /** Expert 7 (Contrarian) resilience flag: true when API failed or retries exhausted */
  is_fallback: boolean;
}
```

**Change Type:** ADD (1 new field)  
**Impact:** Expert 7 now tracks fallback status (required field in return type)

---

## DIFF 2: runExpertContrarian() Full Function Replacement

**File:** `lib/consensus-engine.ts` (Lines 1394-1427)

**BEFORE:**
```typescript
async function runExpertContrarian(
  input: ConsensusEngineInput,
  board: {
    tech: ExpertTechnicianOutput;
    risk: ExpertRiskOutput;
    psych: ExpertPsychOutput;
    macro: ExpertMacroOutput;
    onchain: ExpertOnChainOutput;
    deep: ExpertDeepMemoryOutput;
    boardLean: 'bullish' | 'bearish' | 'neutral';
    avgScore: number;
  },
  contrarianModel: string,
  timeoutMs: number
): Promise<ExpertContrarianOutput> {
  const prompt = `Expert 7 CONTRARIAN — destroy the consensus. Board lean=${board.boardLean} avg=${board.avgScore.toFixed(1)}. Symbol ${input.symbol} price ${input.current_price}. Scores T/R/P/M/O/D=${board.tech.tech_score}/${board.risk.risk_score}/${board.psych.psych_score}/${board.macro.macro_score}/${board.onchain.onchain_score}/${board.deep.deep_memory_score}. OB: ${(input.order_book_summary ?? '').slice(0, 400)} Micro: ${(input.microstructure_signal ?? '').slice(0, 400)}. If lean is bullish, argue bull trap / distribution; if bearish, argue bear trap / short squeeze. Hebrew in trap_hypothesis_he and attack_on_consensus_he. JSON only: contrarian_confidence (0-100), trap_type (none|bull_trap|bear_trap|liquidity_trap), trap_hypothesis_he, attack_on_consensus_he.`;
  const out = await callGeminiJson<ExpertContrarianOutput>(
    prompt,
    ['contrarian_confidence', 'trap_type', 'trap_hypothesis_he', 'attack_on_consensus_he'],
    contrarianModel,
    timeoutMs,
    { symbol: input.symbol, expert: 'Contrarian' }
  );
  const tt = String(out.trap_type || 'none');
  const trap_type = (['none', 'bull_trap', 'bear_trap', 'liquidity_trap'].includes(tt)
    ? tt
    : 'none') as ExpertContrarianOutput['trap_type'];
  return {
    contrarian_confidence: Math.max(0, Math.min(100, Number(out.contrarian_confidence) || 0)),
    trap_type,
    trap_hypothesis_he: String(out.trap_hypothesis_he || '').slice(0, 500),
    attack_on_consensus_he: String(out.attack_on_consensus_he || '').slice(0, 500),
  };
}
```

**AFTER:**
```typescript
async function runExpertContrarian(
  input: ConsensusEngineInput,
  board: {
    tech: ExpertTechnicianOutput;
    risk: ExpertRiskOutput;
    psych: ExpertPsychOutput;
    macro: ExpertMacroOutput;
    onchain: ExpertOnChainOutput;
    deep: ExpertDeepMemoryOutput;
    boardLean: 'bullish' | 'bearish' | 'neutral';
    avgScore: number;
  },
  contrarianModel: string,
  timeoutMs: number
): Promise<ExpertContrarianOutput> {
  const prompt = `Expert 7 CONTRARIAN — destroy the consensus. Board lean=${board.boardLean} avg=${board.avgScore.toFixed(1)}. Symbol ${input.symbol} price ${input.current_price}. Scores T/R/P/M/O/D=${board.tech.tech_score}/${board.risk.risk_score}/${board.psych.psych_score}/${board.macro.macro_score}/${board.onchain.onchain_score}/${board.deep.deep_memory_score}. OB: ${(input.order_book_summary ?? '').slice(0, 400)} Micro: ${(input.microstructure_signal ?? '').slice(0, 400)}. If lean is bullish, argue bull trap / distribution; if bearish, argue bear trap / short squeeze. Hebrew in trap_hypothesis_he and attack_on_consensus_he. JSON only: contrarian_confidence (0-100), trap_type (none|bull_trap|bear_trap|liquidity_trap), trap_hypothesis_he, attack_on_consensus_he.`;
  
  try {
    const out = await withExponentialBackoff(
      () => callGeminiJson<Omit<ExpertContrarianOutput, 'is_fallback'>>(
        prompt,
        ['contrarian_confidence', 'trap_type', 'trap_hypothesis_he', 'attack_on_consensus_he'],
        contrarianModel,
        timeoutMs,
        { symbol: input.symbol, expert: 'Contrarian' }
      ),
      { maxRetries: 3 },
      { symbol: input.symbol, expert: 'Contrarian', provider: 'Gemini' }
    );
    const tt = String(out.trap_type || 'none');
    const trap_type = (['none', 'bull_trap', 'bear_trap', 'liquidity_trap'].includes(tt)
      ? tt
      : 'none') as ExpertContrarianOutput['trap_type'];
    return {
      contrarian_confidence: Math.max(0, Math.min(100, Number(out.contrarian_confidence) || 0)),
      trap_type,
      trap_hypothesis_he: String(out.trap_hypothesis_he || '').slice(0, 500),
      attack_on_consensus_he: String(out.attack_on_consensus_he || '').slice(0, 500),
      is_fallback: false,
    };
  } catch (err) {
    console.error('[ConsensusEngine] Contrarian expert failed after retries:', err instanceof Error ? err.message : err);
    return {
      contrarian_confidence: 0,
      trap_type: 'none',
      trap_hypothesis_he: 'Fallback engaged: Contrarian API unavailable after retries.',
      attack_on_consensus_he: 'Fallback engaged: Unable to challenge consensus.',
      is_fallback: true,
    };
  }
}
```

**Change Type:** WRAP + ADD FALLBACK HANDLING  
**Details:**
- Wrapped API call in `withExponentialBackoff()` (3 retries)
- Added try/catch for error handling
- Success returns `is_fallback: false`
- Failure returns `is_fallback: true` with fallback responses

---

## DIFF 3: Overseer Logic (Expert 7 Health Check)

**File:** `lib/consensus-engine.ts` (Lines 1972-2016)

**BEFORE:**
```typescript
  /**
   * DYNAMIC WEIGHT REDISTRIBUTION (The Overseer):
   * If an expert has is_fallback: true, it is ENTIRELY EXCLUDED from the weighted average.
   * The final score is mathematically pure — not dragged to neutral 50 by a dead API.
   * We recalculate the divisor based ONLY on successful experts.
   */
  const weightedExperts = [
    { score: expert1.tech_score, weight: weightByExpert.technician, isFallback: expert1.is_fallback },
    { score: expert2.risk_score, weight: weightByExpert.risk, isFallback: expert2.is_fallback },
    { score: expert3.psych_score, weight: weightByExpert.psych, isFallback: expert3.is_fallback },
    { score: expert4.macro_score, weight: weightByExpert.macro, isFallback: expert4.is_fallback },
    { score: expert5.onchain_score, weight: weightByExpert.onchain, isFallback: expert5.is_fallback },
    { score: expert6.deep_memory_score, weight: weightByExpert.deepMemory, isFallback: expert6.is_fallback },
  ];
  
  const successfulExperts = weightedExperts.filter((item) => !item.isFallback);
  const availableWeight = successfulExperts.reduce((sum, item) => sum + item.weight, 0);
  const final_confidence =
    availableWeight > 0
      ? successfulExperts.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight
      : FALLBACK_EXPERT_SCORE;
  const weightedDirection = scoreToDirection(final_confidence);
  const trapDir = trapDirection(expert7.trap_type);
  const strongContrarianTrap =
    trapDir !== null && expert7.contrarian_confidence >= CONTRARIAN_STRONG_TRAP_CONFIDENCE;
  const refutation = judgeResult.contrarian_refutation_he.trim();
  const contrarianCoverageOk =
    judgeResult.contrarian_addressed && refutation.length >= CONTRARIAN_REFUTATION_MIN_LEN;
  const contrarianGateBlocked =
    strongContrarianTrap && weightedDirection === trapDir && !contrarianCoverageOk;
```

**AFTER:**
```typescript
  /**
   * DYNAMIC WEIGHT REDISTRIBUTION (The Overseer):
   * Experts 1-6: Scored experts (contribute to final_confidence)
   * If any has is_fallback: true, it is ENTIRELY EXCLUDED from the weighted average.
   * The final score is mathematically pure — not dragged to neutral 50 by a dead API.
   * We recalculate the divisor based ONLY on successful experts.
   *
   * Expert 7 (Contrarian): NOT scored, but serves as adversarial gate/veto mechanism.
   * If Expert 7 is_fallback: true, the CEO cannot challenge the consensus (weaker veto power).
   */
  const weightedExperts = [
    { score: expert1.tech_score, weight: weightByExpert.technician, isFallback: expert1.is_fallback },
    { score: expert2.risk_score, weight: weightByExpert.risk, isFallback: expert2.is_fallback },
    { score: expert3.psych_score, weight: weightByExpert.psych, isFallback: expert3.is_fallback },
    { score: expert4.macro_score, weight: weightByExpert.macro, isFallback: expert4.is_fallback },
    { score: expert5.onchain_score, weight: weightByExpert.onchain, isFallback: expert5.is_fallback },
    { score: expert6.deep_memory_score, weight: weightByExpert.deepMemory, isFallback: expert6.is_fallback },
  ];
  
  const successfulExperts = weightedExperts.filter((item) => !item.isFallback);
  const availableWeight = successfulExperts.reduce((sum, item) => sum + item.weight, 0);
  const final_confidence =
    availableWeight > 0
      ? successfulExperts.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight
      : FALLBACK_EXPERT_SCORE;
  const weightedDirection = scoreToDirection(final_confidence);
  
  /**
   * EXPERT 7 (CONTRARIAN) GATE LOGIC:
   * Expert 7 is NOT part of the scoring average (it's purely adversarial/veto).
   * However, if Expert 7 is_fallback: true, the CEO is blind and cannot challenge.
   */
  const contrarianIsAlive = !expert7.is_fallback;  // Track Expert 7 health
  const trapDir = contrarianIsAlive ? trapDirection(expert7.trap_type) : null;
  const strongContrarianTrap =
    contrarianIsAlive && trapDir !== null && expert7.contrarian_confidence >= CONTRARIAN_STRONG_TRAP_CONFIDENCE;
  const refutation = judgeResult.contrarian_refutation_he.trim();
  const contrarianCoverageOk =
    judgeResult.contrarian_addressed && refutation.length >= CONTRARIAN_REFUTATION_MIN_LEN;
  const contrarianGateBlocked =
    strongContrarianTrap && weightedDirection === trapDir && !contrarianCoverageOk;
```

**Change Type:** ADD HEALTH CHECK + CONDITION GATE  
**Details:**
- Added `contrarianIsAlive = !expert7.is_fallback`
- Updated `trapDir` to check `contrarianIsAlive` first
- If Expert 7 is dead, `trapDir = null` (weakened gate)
- If Expert 7 is dead, `strongContrarianTrap = false` (cannot veto)

---

## DIFF 4: ConsensusResult Interface

**File:** `lib/consensus-engine.ts` (Line 340)

**BEFORE:**
```typescript
export interface ConsensusResult {
  // ... other fields ...
  /** True when Deep Memory (Vector) agent failed and score used fallback. */
  deep_memory_fallback_used?: boolean;
  contrarian_confidence?: number;
  // ... other fields ...
}
```

**AFTER:**
```typescript
export interface ConsensusResult {
  // ... other fields ...
  /** True when Deep Memory (Vector) agent failed and score used fallback. */
  deep_memory_fallback_used?: boolean;
  /** True when Contrarian (Expert 7) expert failed and gate is weakened (cannot veto). */
  contrarian_fallback_used?: boolean;
  contrarian_confidence?: number;
  // ... other fields ...
}
```

**Change Type:** ADD (1 new optional field)  
**Impact:** Tracking Expert 7 health in result object

---

## DIFF 5: Return Statement

**File:** `lib/consensus-engine.ts` (Lines 2100-2110)

**BEFORE:**
```typescript
    ...(expert1.is_fallback && { tech_fallback_used: true }),
    ...(expert2.is_fallback && { risk_fallback_used: true }),
    ...(expert3.is_fallback && { psych_fallback_used: true }),
    ...(expert4.is_fallback && { macro_fallback_used: true }),
    ...(expert5.is_fallback && { onchain_fallback_used: true }),
    ...(expert6.is_fallback && { deep_memory_fallback_used: true }),
    contrarian_confidence: expert7.contrarian_confidence,
```

**AFTER:**
```typescript
    ...(expert1.is_fallback && { tech_fallback_used: true }),
    ...(expert2.is_fallback && { risk_fallback_used: true }),
    ...(expert3.is_fallback && { psych_fallback_used: true }),
    ...(expert4.is_fallback && { macro_fallback_used: true }),
    ...(expert5.is_fallback && { onchain_fallback_used: true }),
    ...(expert6.is_fallback && { deep_memory_fallback_used: true }),
    ...(expert7.is_fallback && { contrarian_fallback_used: true }),
    contrarian_confidence: expert7.contrarian_confidence,
```

**Change Type:** ADD (1 conditional spread)  
**Impact:** Populate `contrarian_fallback_used` field in result

---

## Summary of Changes

| Location | Type | Count | Description |
|----------|------|-------|-------------|
| Interface ExpertContrarianOutput | ADD | 1 | is_fallback field |
| Function runExpertContrarian | WRAP | +30 | withExponentialBackoff + try/catch |
| Function runConsensusEngine (Overseer) | ENHANCE | +5 | Health check for Expert 7 |
| Interface ConsensusResult | ADD | 1 | contrarian_fallback_used field |
| Return statement | ADD | 1 | Populate contrarian_fallback_used |
| **TOTAL** | — | **38** | Expert 7 fully integrated |

---

## Deployment Ready ✅

All changes compile cleanly:
```bash
$ npx tsc --noEmit
# No errors ✅
```

Trading Robot interface unchanged (backward compatible):
```typescript
// Old code still works
const result = await runConsensusEngine(input);
if (result.consensus_approved) {
  await executeSignal(result);  // ✅ Still works
}

// New code can check Expert 7 health
if (result.contrarian_fallback_used) {
  logger.warn('CEO is blind: cannot challenge consensus');
}
```

All 7 experts now protected with:
- ✅ Exponential backoff + jitter (3 retries)
- ✅ Explicit is_fallback flag
- ✅ Integrated into Overseer logic
- ✅ Visible to Trading Robot
