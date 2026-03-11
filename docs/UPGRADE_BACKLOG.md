# Upgrade Backlog (50 Tasks)

## Security

- [x] 1. Move Gemini key access to server-only helper.
- [x] 2. Remove implicit unsafe key handling from actions.
- [x] 3. Add trusted-origin allowlist for outbound fetch.
- [x] 4. Add fetch timeout guard.
- [x] 5. Add generic client-safe error messages.
- [x] 6. Add request correlation id in failures.
- [x] 7. Add optional auth gate for server actions.
- [x] 8. Add anti-automation captcha for public usage.
- [x] 9. Add HTTP security headers in Next config.
- [x] 10. Add audit log sink (file or external).

## Data Quality & Validation

- [x] 11. Normalize and validate symbol input.
- [x] 12. Validate AI payload structure and ranges.
- [x] 13. Validate Binance ticker payload safety.
- [x] 14. Validate Fear & Greed response fallback.
- [x] 15. Clamp probability to valid domain.
- [x] 16. Introduce zod schemas for all external payloads.
- [x] 17. Add strict source citation schema.
- [x] 18. Add semantic consistency checks (direction vs target).
- [x] 19. Add automatic repair prompt for inconsistent AI output.
- [x] 20. Add validation metrics panel.

## Reliability & Backend

- [x] 21. Add in-memory rate limiting for analyze action.
- [x] 22. Replace timestamp IDs with randomUUID.
- [x] 23. Use atomic file writes for JSON DB.
- [x] 24. Filter invalid DB records on read.
- [x] 25. Migrate DB to SQLite/Postgres adapter.
- [x] 26. Add DB backup rotation job.
- [x] 27. Add retries with jitter for external APIs.
- [x] 28. Batch evaluate prices in a single Binance request.
- [x] 29. Add model fallback chain.
- [x] 30. Add telemetry fields (latency/model/fallback).

## Performance

- [x] 31. Add no-store fetch policy for market data.
- [x] 32. Add daily cache policy for Fear & Greed.
- [x] 33. Improve ticker update loop (avoid noisy updates).
- [x] 34. Add websocket reconnect backoff.
- [x] 35. Virtualize long history list.
- [x] 36. Split chart bundle or replace heavy chart lib.
- [x] 37. Defer non-critical UI work with dynamic imports.
- [x] 38. Add request dedup cache per symbol.
- [x] 39. Add analysis queue for burst traffic.
- [x] 40. Introduce worker for evaluation job.

## UX / Accessibility / DX

- [x] 41. Add ticker loading/connection state.
- [x] 42. Add reduced-motion CSS handling.
- [x] 43. Add aria labels to actionable controls.
- [x] 44. Add aria-live region for errors/status.
- [x] 45. Show richer AI output fields in result card.
- [x] 46. Add full i18n layer (Hebrew/English toggle).
- [x] 47. Add keyboard shortcuts for analysis actions.
- [x] 48. Add tests (unit + integration) for action flow.
- [x] 49. Add CI pipeline for lint/test/build.
- [x] 50. Add release checklist and runbook.
