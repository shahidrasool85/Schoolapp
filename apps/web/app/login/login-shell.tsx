import type { ReactNode } from "react";
import type { ResolvedLoginBranding } from "../../lib/login-branding";
import { PlatformMarkIcon, SchoolMarkIcon, brandPanelStyle } from "./login-icons";

type LoginShellMode = "school" | "platform" | "loading" | "unknown";

export function LoginShell({
  mode,
  branding,
  children,
}: {
  mode: LoginShellMode;
  branding: ResolvedLoginBranding;
  children: ReactNode;
}) {
  const isPlatform = mode === "platform";
  const Mark = isPlatform ? PlatformMarkIcon : SchoolMarkIcon;
  const eyebrow = isPlatform ? "Schoolapp" : "School portal";
  const title = isPlatform ? "Platform Administration" : branding.organisationName;
  const subtitle =
    branding.tagline ??
    (isPlatform
      ? "Sign in to manage schools on the platform."
      : mode === "unknown"
        ? "This address is not an active school on the platform."
        : "Welcome to your school portal.");

  return (
    <main className="login-page">
      <section className="login-card" aria-label={title}>
        <aside className="login-brand-panel" style={brandPanelStyle(branding)}>
          <div className="login-brand-panel-inner">
            <div className="login-brand-mark" aria-hidden="true">
              {branding.logoUrl && !isPlatform ? (
                <img src={branding.logoUrl} alt="" className="login-brand-logo" />
              ) : (
                <Mark className="login-brand-icon" />
              )}
            </div>
            <p className="login-brand-eyebrow">{eyebrow}</p>
            <h1 className="login-brand-title">{title}</h1>
            {branding.domainLabel && !isPlatform ? (
              <p className="login-brand-domain">{branding.domainLabel}</p>
            ) : null}
            <p className="login-brand-tagline">{subtitle}</p>
          </div>
        </aside>
        <div className="login-form-panel">
          <div className="login-brand-compact">
            <div className="login-brand-mark compact" aria-hidden="true">
              {branding.logoUrl && !isPlatform ? (
                <img src={branding.logoUrl} alt="" className="login-brand-logo" />
              ) : (
                <Mark className="login-brand-icon" />
              )}
            </div>
            <div>
              <p className="login-compact-eyebrow">{eyebrow}</p>
              <p className="login-compact-title">{title}</p>
            </div>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
