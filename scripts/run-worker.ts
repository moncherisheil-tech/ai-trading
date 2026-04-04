/**
 * Dev entry point for the BullMQ queue worker.
 *
 * Usage (standalone):   npx tsx scripts/run-worker.ts
 * Usage (unified dev):  npm run dev   ← runs web + worker via concurrently
 *
 * The worker module handles its own:
 *   - dotenv loading (import 'dotenv/config')
 *   - validateInfraEnv() pre-flight check
 *   - Redis + Postgres health-gate with retry
 *   - Graceful SIGTERM/SIGINT shutdown
 *   - Self-healing restart loop
 */
import '../lib/queue/queue-worker';
