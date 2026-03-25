/**
 * Login segment layout: no sidebar, no ticker, no bottom nav.
 * Root layout's GlobalAppChrome already omits dashboard chrome for /login;
 * this layout only ensures the login segment is self-contained.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
