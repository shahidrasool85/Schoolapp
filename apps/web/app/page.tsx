export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
      <h1>Schoolapp Phase 1</h1>
      <p>
        Foundation only: organisations, users, memberships, RBAC, RLS, audit, and{" "}
        <code>/api/v1</code>.
      </p>
      <ul>
        <li>
          <a href="/login">Web login</a>
        </li>
        <li>
          Health: <code>GET /api/v1/health</code>
        </li>
        <li>
          Login: <code>POST /api/v1/auth/login</code>
        </li>
        <li>
          Me: <code>GET /api/v1/me</code> and <code>GET /api/v1/me/memberships</code>
        </li>
      </ul>
      <p>
        Send <code>X-Organisation-Id</code> to switch school context. The header is a request, not
        authority.
      </p>
    </main>
  );
}
