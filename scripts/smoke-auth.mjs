const baseUrl = process.env.APP_URL || 'http://localhost:3000';
const password = process.env.ADMIN_LOGIN_PASSWORD;

if (!password) {
  console.error('ADMIN_LOGIN_PASSWORD is required for smoke-auth.');
  process.exit(1);
}

const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { method: 'GET' });
if (!csrfRes.ok) {
  console.error('Failed to fetch CSRF token.');
  process.exit(1);
}

const csrfData = await csrfRes.json();
const csrfToken = csrfData.csrfToken;
const csrfCookie = csrfRes.headers.get('set-cookie') || '';

if (!csrfToken || !csrfCookie) {
  console.error('Missing CSRF token or cookie from csrf endpoint.');
  process.exit(1);
}

const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: csrfCookie,
  },
  body: JSON.stringify({ password, csrfToken }),
});

if (!loginRes.ok) {
  const text = await loginRes.text();
  console.error('Login smoke failed:', text);
  process.exit(1);
}

console.log('Auth smoke passed.');
