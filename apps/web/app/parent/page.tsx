"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { optionalApi, userFacingError } from "../../lib/errors";
import { formatMinor } from "../../lib/money";
import type { PortalChild, PortalSchool } from "../../lib/portal";

type NextLesson = {
  studentId: string;
  displayName: string;
  nextLesson: {
    date: string;
    startsAt: string;
    subjectName: string | null;
    className: string;
    status: string;
  } | null;
};

type Dashboard = {
  school: PortalSchool;
  children: PortalChild[];
  upcoming?: { available: boolean; items?: NextLesson[] };
  notifications: { unreadCount: number };
  messaging?: { unreadCount: number };
};

type Charge = {
  id: string;
  title: string;
  studentLegalName: string | null;
  status: string;
  outstandingMinor?: number;
  currency: string;
  dueAt: string | null;
  payable?: boolean;
};

type Activity = {
  id: string;
  title: string;
  startsAt: string;
  children: Array<{ actionRequired: boolean; consentResponse: string }>;
};

type Notice = { id: string; title: string; publishedAt?: string; readAt?: string | null };

export default function ParentDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payments, setPayments] = useState<Charge[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/parent/dashboard")
      .then((body) => {
        setData(body);
        setSelectedId(body.children[0]?.id ?? null);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load your family dashboard.")));
    optionalApi<{ charges: Charge[] }>("/api/v1/parent/payments")
      .then((body) => setPayments(body?.charges ?? []))
      .catch(() => setPayments([]));
    optionalApi<{ activities: Activity[] }>("/api/v1/parent/activities")
      .then((body) => setActivities(body?.activities ?? []))
      .catch(() => setActivities([]));
    optionalApi<{ announcements: Notice[] }>("/api/v1/parent/announcements")
      .then((body) => setNotices(body?.announcements ?? []))
      .catch(() => setNotices([]));
  }, []);

  if (error) return <PageError title="Parent dashboard unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading your children…" />;

  const selected = data.children.find((child) => child.id === selectedId) ?? data.children[0] ?? null;
  const duePayments = (payments ?? []).filter((item) => (item.outstandingMinor ?? 0) > 0);
  const actionActivities = (activities ?? []).filter((item) => item.children.some((child) => child.actionRequired));
  const nextForSelected = data.upcoming?.items?.find((item) => item.studentId === selected?.id)?.nextLesson;

  return (
    <>
      <PageHeader
        title="Family dashboard"
        description={data.school.name}
        actions={
          <Link className="button" href="/parent/messages">
            Messages
            {data.messaging?.unreadCount ? ` (${data.messaging.unreadCount})` : ""}
          </Link>
        }
      />
      {data.children.length === 0 ? (
        <EmptyState
          title="No children available"
          description="No children are available for this school in the parent portal."
        />
      ) : (
        <div className="cards" style={{ marginBottom: "1rem" }}>
          {data.children.map((child) => (
            <button
              key={child.id}
              type="button"
              className={`card${child.id === selected?.id ? " notice unread" : ""}`}
              onClick={() => setSelectedId(child.id)}
              aria-pressed={child.id === selected?.id}
              style={{ textAlign: "left", color: "inherit" }}
            >
              <strong style={{ fontSize: "1.05rem" }}>{child.displayName}</strong>
              <span className="muted">{child.currentYearGroupName ?? "Year group not set"}</span>
              <span className="muted">{child.currentFormClassName ?? "No form class"}</span>
            </button>
          ))}
        </div>
      )}
      {selected ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Next lesson"
              value={
                nextForSelected
                  ? `${nextForSelected.subjectName ?? nextForSelected.className}`
                  : "None listed"
              }
              hint={
                nextForSelected
                  ? `${nextForSelected.date} ${nextForSelected.startsAt.slice(0, 5)}`
                  : "Open the timetable for the week"
              }
              href={`/parent/children/${selected.id}/timetable`}
            />
            <StatCard
              label="Payments due"
              value={duePayments.length}
              href="/parent/payments"
            />
            <StatCard
              label="Consents needed"
              value={actionActivities.length}
              href="/parent/activities"
            />
            <StatCard
              label="Unread messages"
              value={data.messaging?.unreadCount ?? 0}
              href="/parent/messages"
            />
          </div>
          <div className="dash-grid" style={{ marginTop: "1rem" }}>
            <SectionCard
              title={selected.displayName}
              description={`${selected.currentYearGroupName ?? "Year group not set"}${
                selected.currentFormClassName ? ` · ${selected.currentFormClassName}` : ""
              }`}
              actions={<Link href={`/parent/children/${selected.id}`}>Open profile</Link>}
            >
              <div className="cards">
                <Link className="card" href={`/parent/children/${selected.id}#attendance`}>
                  <strong>Attendance</strong>
                  <p className="muted">Recent marks and summary</p>
                </Link>
                <Link className="card" href={`/parent/children/${selected.id}/learning`}>
                  <strong>Learning</strong>
                  <p className="muted">Homework and assignments</p>
                </Link>
                <Link className="card" href={`/parent/children/${selected.id}/results`}>
                  <strong>Results</strong>
                  <p className="muted">Released assessments</p>
                </Link>
                <Link className="card" href={`/parent/children/${selected.id}/reports`}>
                  <strong>Reports</strong>
                  <p className="muted">Published school reports</p>
                </Link>
              </div>
            </SectionCard>
            <div className="stack">
              <SectionCard title="Action required" actions={<Link href="/parent/activities">Activities</Link>}>
                {actionActivities.length === 0 && duePayments.length === 0 ? (
                  <EmptyState title="Nothing needs a response" description="Consents and payments for your children will appear here." />
                ) : (
                  <ul className="queue-list">
                    {actionActivities.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <Link href={`/parent/activities/${item.id}`}>
                          <strong>{item.title}</strong>
                          <span className="muted">Consent or place response needed</span>
                        </Link>
                      </li>
                    ))}
                    {duePayments.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <Link href={`/parent/payments/${item.id}`}>
                          <strong>{item.title}</strong>
                          <span className="muted">
                            {item.studentLegalName ?? "Payment"} ·{" "}
                            {formatMinor(item.outstandingMinor ?? 0, item.currency)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SectionCard title="School notices" actions={<Link href="/parent/notices">All notices</Link>}>
                {(notices ?? []).length === 0 ? (
                  <EmptyState title="No notices" description="School announcements for your family will appear here." />
                ) : (
                  <ul className="queue-list">
                    {(notices ?? []).slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <Link href={`/parent/notices/${item.id}`}>
                          <strong>{item.title}</strong>
                          <StatusBadge status={item.readAt ? "Read" : "New"} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
