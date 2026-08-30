"use client";

import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { LuvLearnMark } from "../components/luvlearn-mark";
import { schoolOrigin } from "../lib/tenant";

type FinderSchool = {
  name: string;
  slug: string;
  hostname: string;
  logoUrl: string | null;
};

const FEATURES = [
  { title: "School Management", body: "Keep people, classes and day-to-day operations in one place." },
  { title: "Admissions & Pupils", body: "Follow a child from enquiry through enrolment and school life." },
  { title: "Attendance", body: "Record registers and understand who is in school each day." },
  { title: "Teaching & Learning", body: "Plan work, share assignments and keep teaching organised." },
  { title: "Parents Portal", body: "Give families a clear view of school life and messages." },
  { title: "Student Portal", body: "Help pupils see their learning, notices and activities." },
  { title: "Assessments & Reports", body: "Capture results and share progress with staff and families." },
  { title: "Safeguarding & Pastoral", body: "Record concerns and pastoral support with the right access." },
  { title: "Timetable", body: "Build the school week around classes, rooms and teachers." },
  { title: "Finance & School Fees", body: "Manage fee schedules, invoices and family accounts." },
];

export function PublicLandingPage({ platformDomain }: { platformDomain: string }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FinderSchool[]>([]);
  const [selected, setSelected] = useState<FinderSchool | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | null>(null);

  const helper = useMemo(() => {
    if (query.trim().length > 0 && query.trim().length < 2) return "Keep typing — enter at least two characters.";
    if (status) return status;
    if (selected) return `${selected.name} selected.`;
    return "Search by school name or school code.";
  }, [query, selected, status]);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const next = query.trim();
    if (next.length < 2) {
      setResults([]);
      setStatus("");
      return;
    }
    debounce.current = window.setTimeout(() => {
      void searchSchools(next);
    }, 220);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query]);

  async function searchSchools(value: string) {
    setSearching(true);
    try {
      const response = await fetch(`/api/v1/public/schools?q=${encodeURIComponent(value)}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setResults([]);
        setStatus("School search is unavailable right now.");
        return;
      }
      const body = (await response.json()) as { schools: FinderSchool[] };
      setResults(body.schools);
      setSelected((current) => current && body.schools.some((row) => row.slug === current.slug) ? current : null);
      setActiveIndex(body.schools.length ? 0 : -1);
      setStatus(body.schools.length === 0 ? "No matching school was found." : "");
    } catch {
      setResults([]);
      setStatus("School search is unavailable right now.");
    } finally {
      setSearching(false);
    }
  }

  function continueToSchool(school: FinderSchool) {
    window.location.assign(`${schoolOrigin(school.slug, platformDomain)}/login`);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = selected ?? results[activeIndex] ?? (results.length === 1 ? results[0] : null);
    if (!chosen) {
      setStatus(query.trim().length < 2 ? "Enter at least two characters." : "Select a school to continue.");
      return;
    }
    continueToSchool(chosen);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && results[activeIndex]) {
      setSelected(results[activeIndex]!);
    }
  }

  return (
    <main className="public-page">
      <div className="public-shell">
        <header className="public-header">
          <LuvLearnMark />
        </header>
        <section className="public-hero card">
          <p className="public-kicker">LuvLearn</p>
          <h1>School Management, Learning &amp; Communication in one connected platform.</h1>
          <p className="public-lede">
            Manage your school. Connect staff and families. Help pupils learn and grow.
          </p>
          <a className="button public-cta" href="#find-your-school">
            Find your school
          </a>
        </section>
        <section className="public-features" aria-label="What LuvLearn covers">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="card public-feature">
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
            </article>
          ))}
        </section>
        <section id="find-your-school" className="card public-finder">
          <h2>Find your school</h2>
          <p className="muted">Search the school name or code, then continue to that school&apos;s sign-in page.</p>
          <form className="public-finder-form" onSubmit={onSubmit}>
            <label htmlFor="school-search">Search school name</label>
            <input
              id="school-search"
              type="search"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              placeholder="Search school name..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
              onKeyDown={onKeyDown}
              autoComplete="off"
            />
            {results.length > 0 ? (
              <ul id={listId} className="public-finder-results" role="listbox">
                {results.map((school, index) => (
                  <li key={school.slug} role="presentation">
                    <button
                      id={`${listId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected?.slug === school.slug || activeIndex === index}
                      className={
                        selected?.slug === school.slug || activeIndex === index
                          ? "public-finder-option is-active"
                          : "public-finder-option"
                      }
                      onClick={() => {
                        setSelected(school);
                        setActiveIndex(index);
                      }}
                    >
                      {school.logoUrl ? (
                        <img src={school.logoUrl} alt="" className="public-finder-logo" />
                      ) : (
                        <span className="public-finder-mark" aria-hidden="true">
                          {school.name.slice(0, 1)}
                        </span>
                      )}
                      <span>
                        <strong>{school.name}</strong>
                        <small>{school.slug}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="muted" aria-live="polite">
              {searching ? "Searching…" : helper}
            </p>
            <button type="submit" className="button">
              Continue
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
