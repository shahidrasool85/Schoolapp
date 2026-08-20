export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "2rem auto", padding: 16 }}>
      <h1>Schoolapp</h1>
      <p>
        Multi-tenant school platform. Phase 3 adds read-only parent and student web portals on the
        same <code>/api/v1</code> identity, permissions, and database used by future mobile apps.
      </p>
      <ul>
        <li>
          <a href="/login">Sign in</a>
        </li>
        <li>
          <a href="/school">School Admin</a>
        </li>
        <li>
          <a href="/parent">Parent Portal</a>
        </li>
        <li>
          <a href="/student">Student Portal</a>
        </li>
        <li>
          Health: <code>GET /api/v1/health</code>
        </li>
      </ul>
    </main>
  );
}
