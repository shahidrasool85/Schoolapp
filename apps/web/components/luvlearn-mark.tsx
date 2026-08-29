export function LuvLearnMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "login-platform-brand is-compact" : "login-platform-brand"}>
      <img
        src="/branding/luvlearn-logo.png"
        alt="LuvLearn School Management System"
        className="login-platform-logo"
      />
      <div className="login-platform-copy">
        <p className="login-platform-wordmark">
          <span className="luv">Luv</span>
          <span className="learn">Learn</span>
        </p>
        <p className="login-platform-product">School Management System</p>
      </div>
    </div>
  );
}
