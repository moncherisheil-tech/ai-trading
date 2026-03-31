/**
 * Standalone Anthropic API diagnostic — loads .env, uses official SDK + shared model constant.
 * Run: npx tsx bin/test-anthropic.ts
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL_CANDIDATES, ANTHROPIC_SONNET_MODEL } from '../lib/anthropic-model';

function logErrorDeep(err: unknown): void {
  console.log('--- caught error (diagnostic) ---');
  if (err instanceof Error) {
    console.log('name:', err.name);
    console.log('message:', err.message);
    console.log('stack:', err.stack);
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown> & { status?: number; response?: unknown };
    if (typeof o.status === 'number') {
      console.log('status code:', o.status);
    }
    // Anthropic SDK APIError often has .status, .headers, .error (parsed body)
    for (const k of ['status', 'headers', 'error', 'request_id', 'body', 'cause']) {
      if (k in o) {
        try {
          console.log(`${k}:`, typeof o[k] === 'object' ? JSON.stringify(o[k], null, 2) : o[k]);
        } catch {
          console.log(`${k}:`, o[k]);
        }
      }
    }
    try {
      console.log('full JSON (own props):', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    } catch {
      console.log('full JSON stringify failed for error object');
    }
  } else {
    console.log('non-object error:', err);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY (or CLAUDE_API_KEY)');
    process.exit(1);
  }

  console.log('Primary model:', ANTHROPIC_SONNET_MODEL);
  console.log('Candidates:', ANTHROPIC_MODEL_CANDIDATES.join(', '));
  const client = new Anthropic({ apiKey });

  for (const modelId of ANTHROPIC_MODEL_CANDIDATES) {
    try {
      const msg = await client.messages.create({
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Hello. Reply with one short word only.' }],
      });
      let text = '';
      for (const b of msg.content) {
        if (b.type === 'text') text += b.text;
      }
      console.log('SUCCESS — model used:', modelId, 'id:', msg.id);
      console.log('Assistant text:', text.trim());
      process.exit(0);
    } catch (e) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 404) {
        console.log(`Model unavailable (404), trying next: ${modelId}`);
        continue;
      }
      logErrorDeep(e);
      process.exit(1);
    }
  }
  console.error('No Anthropic candidate model succeeded.');
  process.exit(1);
}

main();
