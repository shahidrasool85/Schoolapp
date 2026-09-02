"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { isActiveNavHref, isNavSectionOpen } from "@schoolapp/domain";
import { IconBell, IconMail, IconMenu, NavIcon, SchoolMarkIcon, type NavIconName } from "./icons";
import { CommandPalette } from "./command-palette";
import { LoadingState, PageError } from "./ui";
import { Button, IconButton } from "./ui/button";

export type ShellNavLink = {
  href: string;
  label: string;
  icon?: NavIconName;
  exact?: boolean;
  children?: ShellNavLink[];
  count?: number | null;
  badge?: string | null;
  badgeTone?: "accent" | "subtle";
  emphasis?: boolean;
};

export type ShellNavSection = {
  id: string;
  label?: string;
  items: ShellNavLink[];
};

export function AppShell({
  variant = "staff",
  schoolName,
  personaLabel,
  userName,
  logoUrl,
  schoolOptions,
  selectedSchoolId,
  onSchoolChange,
  sections,
  extraNav,
  unreadMessages,
  unreadNotifications,
  messagesHref,
  notificationsHref,
  onLogout,
  ready,
  error,
  children,
}: {
  variant?: "staff" | "parent" | "student" | "platform";
  schoolName: string;
  personaLabel: string;
  userName?: string | null;
  logoUrl?: string | null;
  schoolOptions?: Array<{ id: string; name: string }>;
  selectedSchoolId?: string | null;
  onSchoolChange?: (id: string) => void;
  sections: ShellNavSection[];
  extraNav?: ReactNode;
  unreadMessages?: number | null;
  unreadNotifications?: number | null;
  messagesHref?: string;
  notificationsHref?: string;
  onLogout: () => void;
  ready: boolean;
  error?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname, search]);

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date()),
    [],
  );

  function changeSchool(event: FormEvent<HTMLSelectElement>) {
    onSchoolChange?.(event.currentTarget.value);
  }

  return (
    <div className={`app-shell portal-${variant}${navOpen ? " nav-open" : ""}`}>
      {navOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside className="nav app-sidebar" id="app-sidebar">
        <div className="app-sidebar-brand">
          <div className="app-sidebar-logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : <SchoolMarkIcon className="login-brand-icon" />}
          </div>
          <div className="app-sidebar-school">
            <strong title={schoolName}>{schoolName}</strong>
            <p className="app-sidebar-persona">{personaLabel}</p>
          </div>
        </div>
        {schoolOptions && schoolOptions.length > 1 ? (
          <label style={{ padding: "0 0.45rem 0.75rem", color: "#d6e4f5" }}>
            School
            <select value={selectedSchoolId ?? ""} onChange={changeSchool}>
              {schoolOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <nav aria-label="Main">
          {sections.map((section) => (
            <div key={section.id}>
              {section.label ? <p className="nav-section-label">{section.label}</p> : null}
              {section.items.map((link) => {
                const children = link.children ?? [];
                const siblingHrefs = children.map((child) => child.href);
                const open = isNavSectionOpen(
                  pathname,
                  search,
                  link.href,
                  children.map((child) => child.href),
                );
                const childActive = children.some((child) =>
                  isActiveNavHref(pathname, search, child.href, child.exact, siblingHrefs),
                );
                const parentActive =
                  isActiveNavHref(pathname, search, link.href, link.exact, siblingHrefs) && !childActive;
                if (children.length === 0) {
                  return (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      className={`app-nav-link${parentActive ? " active" : ""}${link.emphasis ? " is-setup-highlight" : ""}`}
                    >
                      <NavIcon name={link.icon} />
                      <span>{link.label}</span>
                      {link.badge ? (
                        <span className={`setup-nav-badge${link.badgeTone === "subtle" ? " is-subtle" : ""}`}>
                          {link.badge}
                        </span>
                      ) : null}
                      {link.count ? <span className="nav-count">{link.count}</span> : null}
                    </Link>
                  );
                }
                return (
                  <div key={link.href + link.label} className={`nav-group${open ? " open" : ""}`}>
                    <Link
                      href={link.href}
                      className={`app-nav-link nav-parent${parentActive ? " active" : ""}${open && !parentActive ? " open" : ""}`}
                    >
                      <NavIcon name={link.icon} />
                      <span>{link.label}</span>
                      {link.count ? <span className="nav-count">{link.count}</span> : null}
                    </Link>
                    {open
                      ? children.map((child) => (
                          <Link
                            key={child.href + child.label}
                            href={child.href}
                            className={`app-nav-link nav-child${
                              isActiveNavHref(pathname, search, child.href, child.exact, siblingHrefs)
                                ? " active"
                                : ""
                            }`}
                          >
                            {child.label}
                            {child.count ? <span className="nav-count">{child.count}</span> : null}
                          </Link>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        {extraNav}
        <div className="app-sidebar-footer">
          {userName ? (
            <p className="app-sidebar-user" title={userName}>
              {userName}
            </p>
          ) : null}
          <Button type="button" variant="secondary" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", minWidth: 0 }}>
            <IconButton className="app-menu-btn" label="Open menu" onClick={() => setNavOpen(true)}>
              <IconMenu />
            </IconButton>
            <div className="app-topbar-context">
              <strong className="app-topbar-school" title={schoolName}>
                {schoolName}
              </strong>
              <p className="app-topbar-meta">{today}</p>
            </div>
          </div>
          <div className="app-topbar-actions">
            <CommandPalette />
            {messagesHref && unreadMessages != null && unreadMessages > 0 ? (
              <Link className="button ghost" href={messagesHref} aria-label={`${unreadMessages} unread messages`}>
                <IconMail className="login-password-icon" />
                <span className="nav-count" style={{ background: "var(--brand)" }}>
                  {unreadMessages}
                </span>
              </Link>
            ) : messagesHref ? (
              <Link className="button ghost" href={messagesHref} aria-label="Messages">
                <IconMail className="login-password-icon" />
              </Link>
            ) : null}
            {notificationsHref && unreadNotifications != null && unreadNotifications > 0 ? (
              <Link
                className="button ghost"
                href={notificationsHref}
                aria-label={`${unreadNotifications} unread notifications`}
              >
                <IconBell className="login-password-icon" />
                <span className="nav-count" style={{ background: "var(--brand)" }}>
                  {unreadNotifications}
                </span>
              </Link>
            ) : notificationsHref ? (
              <Link className="button ghost" href={notificationsHref} aria-label="Notifications">
                <IconBell className="login-password-icon" />
              </Link>
            ) : null}
          </div>
        </header>
        <main className="content app-content">
          {error ? (
            <PageError description={error} />
          ) : ready ? (
            children
          ) : (
            <LoadingState label="Loading your school workspace…" />
          )}
        </main>
      </div>
    </div>
  );
}
