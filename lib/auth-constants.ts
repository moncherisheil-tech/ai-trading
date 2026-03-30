/**
 * Single source of truth for the session cookie name.
 * Must stay in sync across:
 *   - app/api/auth/verify-otp/route.ts  (writer)
 *   - middleware.ts                      (reader)
 *   - app/api/settings/app/route.ts     (reader)
 *   - app/api/auth/logout/route.ts      (clearer)
 */
export const AUTH_COOKIE_NAME = 'quantum_auth_session';
