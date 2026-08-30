import { LuvLearnMark } from "../components/luvlearn-mark";

export function SchoolNotFoundPage() {
  return (
    <main className="public-page">
      <div className="public-shell">
        <header className="public-header">
          <LuvLearnMark />
        </header>
        <section className="public-hero card">
          <p className="public-kicker">School not found</p>
          <h1>This address is not an active school on LuvLearn.</h1>
          <p className="muted">
            Check the school link you were given, or find your school from the LuvLearn homepage.
          </p>
        </section>
      </div>
    </main>
  );
}
