/**
 * Custom 404 page — force-dynamic prevents Next.js from attempting to statically
 * prerender this route during the build, which would cause the webpack-runtime
 * `TypeError: Cannot read properties of undefined (reading 'call')` error that
 * occurs when server-externalized packages (pg, ccxt) are encountered in the
 * SSG worker context.
 */
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div
      dir="rtl"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: '4rem',
          fontWeight: 700,
          lineHeight: 1,
          color: 'var(--app-text, #e2e8f0)',
          margin: 0,
        }}
      >
        404
      </h1>
      <p
        style={{
          fontSize: '1.125rem',
          color: 'var(--muted-foreground, #94a3b8)',
          margin: 0,
        }}
      >
        העמוד המבוקש אינו קיים
      </p>
      <a
        href="/"
        style={{
          marginTop: '0.5rem',
          padding: '0.5rem 1.5rem',
          borderRadius: '0.375rem',
          background: 'var(--primary, #3b82f6)',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 500,
          fontSize: '0.95rem',
        }}
      >
        חזרה לדף הבית
      </a>
    </div>
  );
}
