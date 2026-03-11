# Run and Deploy Your AI Studio App

This contains everything you need to run your app locally.

View your app in AI Studio: [AI Studio App](https://ai.studio/apps/f897405a-b800-48d2-81b8-44d9d406b061)

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Production Commands

1. Run Postgres migrations (when DB driver is postgres):
   `npm run migrate:postgres`
2. Create a local DB backup:
   `npm run backup:db`
3. Run authentication smoke test:
   `npm run smoke:auth`
4. Run health smoke test:
   `npm run smoke:health`
5. Generate runtime health report:
   `npm run report:health`
6. Build executive summary from reports:
   `npm run report:executive`
7. Evaluate SLO thresholds from latest report:
   `npm run eval:slo`
8. Send alert notification manually:
   `npm run notify:webhook`

## Security Notes

- Review [docs/SECURITY_OPERATIONS.md](docs/SECURITY_OPERATIONS.md) for session secret rotation and access policy.
- Review [docs/RELEASE_RUNBOOK.md](docs/RELEASE_RUNBOOK.md) for release and rollback process.
- Operations dashboard is available at [/ops](/ops) for admin sessions.
- Automated smoke workflow is available in [/.github/workflows/ops-smoke.yml](.github/workflows/ops-smoke.yml).
- SLO policy is documented in [docs/SRE_SLO.md](docs/SRE_SLO.md).
