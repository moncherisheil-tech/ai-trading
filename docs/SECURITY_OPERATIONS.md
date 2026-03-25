# Security Operations Guide

## Session Secret Rotation

Use two secrets during rotation:

- APP_SESSION_SECRET: current signing secret
- APP_SESSION_SECRET_PREVIOUS: previous secret accepted for validation

### Rotation Procedure

1. Generate a new strong secret.
2. Move old APP_SESSION_SECRET value into APP_SESSION_SECRET_PREVIOUS.
3. Set APP_SESSION_SECRET to the new value.
4. Deploy.
5. Wait for the maximum session TTL to pass.
6. Remove APP_SESSION_SECRET_PREVIOUS and deploy again.

## Access Control Policy

- viewer: read history
- operator: run analysis + evaluate
- admin: login control and operational ownership

## Worker Endpoint Hardening

- Restrict worker calls with WORKER_CRON_SECRET.
- Enforce ALLOWED_IPS for worker traffic.
- Keep worker traffic behind trusted scheduler/infrastructure.

## Anti-Automation

- Honeypot and submit-time checks are active.
- Turnstile verification can be enabled with TURNSTILE_SECRET_KEY.

## Incident Response

1. Revoke credentials (session secrets, API keys, scheduler secret).
2. Rotate APP_SESSION_SECRET and APP_SESSION_SECRET_PREVIOUS.
3. Enable stricter ALLOWED_IPS.
4. Review logs/audit trail for unauthorized attempts.
