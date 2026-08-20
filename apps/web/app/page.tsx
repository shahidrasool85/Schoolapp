export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
      <h1>Schoolapp</h1>
      <p>
        Multi-tenant school platform. Phase 2 adds people and academic structure on the Phase 1
        foundation (tenancy, RBAC, RLS, <code>/api/v1</code>).
      </p>
      <ul>
        <li>
          <a href="/login">Sign in</a>
        </li>
        <li>
          <a href="/school">School Admin</a>
        </li>
        <li>
          Health: <code>GET /api/v1/health</code>
        </li>
      </ul>
    </main>
  );
}
