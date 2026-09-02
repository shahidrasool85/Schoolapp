"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { IconSearch } from "./icons";

type SearchHit = { id: string; group: string; title: string; href: string; subtitle?: string | null };
type SearchResponse = { groups: Array<{ group: string; results: SearchHit[] }> };

const GROUP_LABEL: Record<string, string> = {
  pages: "Pages",
  pupils: "Pupils",
  staff: "Staff",
  classes: "Classes",
  finance: "Finance",
};

export function CommandPalette() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const [mac, setMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setData(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}`)
        .then((body) => {
          setData(body);
          setError("");
        })
        .catch(() => setError("Search is unavailable."));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  const results = useMemo(() => data?.groups ?? [], [data]);

  return (
    <>
      <button type="button" className="button ghost command-search-btn" onClick={() => setOpen(true)}>
        <IconSearch className="login-password-icon" />
        Search
        <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open ? (
        <div className="command-palette-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages, pupils, staff, classes, finance…"
              aria-label="Search"
            />
            {error ? <p className="muted">{error}</p> : null}
            {!query.trim() ? <p className="muted">Try “term dates”, “timetable”, “invoices” or a pupil name.</p> : null}
            {results.map((group) => (
              <section key={group.group}>
                <h3>{GROUP_LABEL[group.group] ?? group.group}</h3>
                <ul>
                  {group.results.map((hit) => (
                    <li key={hit.id}>
                      <Link href={hit.href} onClick={() => setOpen(false)}>
                        <strong>{hit.title}</strong>
                        {hit.subtitle ? <span>{hit.subtitle}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {query.trim() && results.length === 0 && !error ? <p className="muted">No matches.</p> : null}
            <p className="muted command-palette-hint">Results respect your permissions and this school only.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
