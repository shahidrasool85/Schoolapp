"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { staffDashboardKind, staffPersonaLabel } from "@schoolapp/domain";
import { SetupReminderCard } from "../../components/setup-reminder-card";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../components/ui";
import type { SchoolOnboardingResponse } from "../../lib/onboarding";
import { api } from "../../lib/api";
import { optionalApi, userFacingError } from "../../lib/errors";
import { formatMinor } from "../../lib/money";

type Lesson = {
  entryId: string;
  startsAt: string;
  endsAt: string;
  className: string;
  classId?: string;
  subjectName: string | null;
  roomName: string | null;
  covered: boolean;
  status: string;
};

type Dashboard = {
  currentAcademicYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  counts: {
    students: number;
    staff: number;
    parents: number;
    classes: number;
    yearGroups: number;
    subjects: number;
  };
};

type AdmissionsDash = {
  counts: {
    awaitingReview: number;
    applicationsSubmitted: number;
    newEnquiries: number;
    offersMade: number;
  };
  links: Record<string, string>;
};

type FinanceOverview = {
  currencies: Array<{
    currency: string;
    outstandingMinor: number;
    overdueCount: number;
  }>;
};

type Assignment = {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  awaitingMarking: number;
  submitted: number;
};

type Submission = { id: string; title: string; studentLegalName: string; status: string };
type Conversation = {
  id: string;
  subject: string;
  pupilName: string | null;
  lastMessageAt: string;
  unreadCount: number;
};
type CalendarEvent = { id: string; title: string; startsAt: string; eventTypeName: string | null };
type ClassRow = { id: string; name: string; yearGroupName: string | null };

function timeRange(start: string, end: string) {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function nextLesson(lessons: Lesson[]) {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return lessons.find((lesson) => lesson.endsAt.slice(0, 5) >= hhmm) ?? lessons[0] ?? null;
}

export default function SchoolDashboardPage() {
  const [kind, setKind] = useState<"operational" | "teacher" | null>(null);
  const [persona, setPersona] = useState<{ fullName: string; label: string } | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [coversToday, setCoversToday] = useState(0);
  const [admissions, setAdmissions] = useState<AdmissionsDash | null>(null);
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [messagingUnread, setMessagingUnread] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [messages, setMessages] = useState<Conversation[] | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState("");
  const [setupReady, setSetupReady] = useState<boolean | null>(null);
  const [setupOnboarding, setSetupOnboarding] = useState<SchoolOnboardingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await api<{
          user: { fullName: string };
          roleKeys: string[];
          permissions: string[];
          organisation?: { name: string };
        }>("/api/v1/me");
        if (cancelled) return;
        setPersona({ fullName: me.user.fullName, label: staffPersonaLabel(me.roleKeys) });
        const dashboardKind = staffDashboardKind(me.permissions ?? []);
        setKind(dashboardKind);
        const dashboard = await api<Dashboard>("/api/v1/dashboard");
        if (cancelled) return;
        setData(dashboard);
        const operational = dashboardKind === "operational";
        const [timetable, unread, admissionsBody, financeBody, learning, marking, inbox, calendar, registerClasses] =
          await Promise.all([
            optionalApi<{ lessons: Lesson[]; coversToday: number }>("/api/v1/dashboard/timetable"),
            optionalApi<{ unreadCount: number }>("/api/v1/messages/unread-count"),
            operational ? optionalApi<AdmissionsDash>("/api/v1/admissions/dashboard") : Promise.resolve(null),
            operational ? optionalApi<FinanceOverview>("/api/v1/finance/overview") : Promise.resolve(null),
            optionalApi<{ assignments: Assignment[] }>("/api/v1/learning/dashboard"),
            optionalApi<{ submissions: Submission[] }>("/api/v1/learning/submissions?status=submitted"),
            optionalApi<{ conversations: Conversation[] }>("/api/v1/messages/conversations?folder=inbox"),
            optionalApi<{ events: CalendarEvent[] }>("/api/v1/calendar/events"),
            optionalApi<{ classes: ClassRow[] }>("/api/v1/attendance/my-classes"),
          ]);
        if (cancelled) return;
        setLessons(timetable?.lessons ?? []);
        setCoversToday(timetable?.coversToday ?? 0);
        setMessagingUnread(unread?.unreadCount ?? null);
        setAdmissions(admissionsBody);
        setFinance(financeBody);
        setAssignments(learning?.assignments ?? null);
        setSubmissions(marking?.submissions ?? null);
        setMessages(inbox?.conversations ?? null);
        setEvents(calendar?.events ?? null);
        setClasses(registerClasses?.classes ?? null);
        const onboarding = await optionalApi<SchoolOnboardingResponse>("/api/v1/onboarding");
        if (!cancelled) {
          setSetupOnboarding(onboarding);
          setSetupReady(onboarding?.readiness.ready ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(userFacingError(err, "Could not load the dashboard."));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    [],
  );

  if (error) return <PageError title="Dashboard unavailable" description={error} />;
  if (!data || !kind) return <LoadingState label="Loading dashboard…" />;

  const outstanding = finance?.currencies[0];
  const awaitingMarking = assignments?.reduce((sum, row) => sum + (row.awaitingMarking ?? 0), 0) ?? 0;
  const upcomingWork = (assignments ?? []).filter((row) => row.dueAt).slice(0, 5);
  const next = nextLesson(lessons ?? []);

  if (kind === "teacher") {
    return (
      <>
        <PageHeader
          title={`Good day${persona ? `, ${persona.fullName.split(" ")[0]}` : ""}`}
          description={`${persona?.label ?? "Teacher"} · ${todayLabel}`}
          actions={
            <>
              <Link className="button" href="/school/attendance/registers">
                Take attendance
              </Link>
              <Link className="button secondary" href="/school/timetable/mine">
                My timetable
              </Link>
              <Link className="button secondary" href="/school/engagement/rewards">
                Award reward
              </Link>
            </>
          }
        />
        <div className="stat-grid">
          <StatCard label="Today's lessons" value={lessons?.length ?? 0} href="/school/timetable/mine" />
          <StatCard label="Assigned classes" value={classes?.length ?? 0} href="/school/attendance/registers" />
          <StatCard label="To mark" value={awaitingMarking} href="/school/teaching/submissions" />
          {messagingUnread != null ? (
            <StatCard label="Unread messages" value={messagingUnread} href="/school/messages" />
          ) : null}
        </div>
        <div className="dash-grid" style={{ marginTop: "1rem" }}>
          <SectionCard title="Today's lessons" actions={<Link href="/school/timetable/mine">Open timetable</Link>}>
            {next ? (
              <p className="muted">
                Next: {next.subjectName ?? next.className} {timeRange(next.startsAt, next.endsAt)}
                {next.roomName ? ` · ${next.roomName}` : ""}
              </p>
            ) : null}
            {(lessons ?? []).length === 0 ? (
              <EmptyState
                title="No lessons today"
                description="Nothing is scheduled for you today. Open your timetable for the rest of the week."
                action={<Link href="/school/timetable/mine">View my timetable</Link>}
              />
            ) : (
              <div className="lesson-cards">
                {(lessons ?? []).map((lesson) => (
                  <article key={`${lesson.entryId}-${lesson.startsAt}`} className="lesson-card">
                    <div className="lesson-time">{timeRange(lesson.startsAt, lesson.endsAt)}</div>
                    <div>
                      <strong>
                        {lesson.subjectName ?? "Lesson"} · {lesson.className}
                      </strong>
                      <p className="muted">
                        {lesson.roomName ?? "No room"}
                        {lesson.covered ? " · Cover" : ""}
                      </p>
                    </div>
                    <div className="page-header-actions">
                      <Link
                        className="button"
                        href={
                          lesson.classId
                            ? `/school/attendance/registers/${lesson.classId}`
                            : "/school/attendance/registers"
                        }
                      >
                        Attendance
                      </Link>
                      <Link className="button secondary" href="/school/teaching">
                        Learning
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
          <div className="stack">
            <SectionCard title="Work to mark" actions={<Link href="/school/teaching/submissions">Queue</Link>}>
              {(submissions ?? []).length === 0 ? (
                <EmptyState title="No submissions waiting" description="Submitted work to mark will appear here." />
              ) : (
                <ul className="queue-list">
                  {(submissions ?? []).slice(0, 6).map((row) => (
                    <li key={row.id}>
                      <Link href={`/school/teaching/submissions`}>
                        <strong>{row.title}</strong>
                        <span className="muted">{row.studentLegalName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="Due soon">
              {upcomingWork.length === 0 ? (
                <EmptyState title="No upcoming due dates" description="Published assignments with due dates will show here." />
              ) : (
                <ul className="queue-list">
                  {upcomingWork.map((row) => (
                    <li key={row.assignmentId}>
                      <Link href={`/school/teaching/assignments/${row.assignmentId}`}>
                        <strong>{row.title}</strong>
                        <span className="muted">{row.dueAt ? new Date(row.dueAt).toLocaleString("en-GB") : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
        <div className="dash-grid" style={{ marginTop: "1rem" }}>
          <SectionCard title="Messages" actions={<Link href="/school/messages">Inbox</Link>}>
            {(messages ?? []).length === 0 ? (
              <EmptyState title="No recent conversations" description="Parent and staff messages will appear in your inbox." />
            ) : (
              <ul className="queue-list">
                {(messages ?? []).slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <Link href={`/school/messages/${item.id}`}>
                      <strong>
                        {item.unreadCount > 0 ? "Unread · " : ""}
                        {item.subject}
                      </strong>
                      <span className="muted">{item.pupilName ?? "No linked pupil"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Assigned classes">
            {(classes ?? []).length === 0 ? (
              <EmptyState title="No assigned classes" description="Classes assigned to you will appear here." />
            ) : (
              <ul className="queue-list">
                {(classes ?? []).map((row) => (
                  <li key={row.id}>
                    <Link href={`/school/attendance/registers/${row.id}`}>
                      <strong>{row.name}</strong>
                      <span className="muted">{row.yearGroupName ?? "Open register"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginTop: "0.75rem" }}>
              <Link className="button secondary" href="/school/engagement/rewards">
                Award reward
              </Link>{" "}
              <Link className="button secondary" href="/school/engagement/learning">
                Early learning
              </Link>
            </p>
          </SectionCard>
        </div>
      </>
    );
  }

  const financeHint = outstanding
    ? `${outstanding.overdueCount} overdue`
    : undefined;

  return (
    <>
      <PageHeader
        title="School dashboard"
        description={`${persona ? `${persona.fullName} · ${persona.label}` : "Staff"} · ${todayLabel}${
          data.currentAcademicYear ? ` · ${data.currentAcademicYear.name}` : ""
        }`}
        actions={
          <>
            {admissions ? (
              <Link className="button" href="/school/admissions/applications">
                Applications
              </Link>
            ) : null}
            {classes ? (
              <Link className="button secondary" href="/school/attendance/registers">
                Registers
              </Link>
            ) : null}
            {messagingUnread != null ? (
              <Link className="button secondary" href="/school/messages">
                Messages
              </Link>
            ) : null}
            <Link className="button secondary" href="/school/engagement">
              Engagement
            </Link>
          </>
        }
      />
      {setupOnboarding ? <SetupReminderCard data={setupOnboarding} /> : setupReady === false ? (
        <EmptyState
          title="Finish school setup"
          description="This school is not using demo data. Complete the setup wizard to add an academic year, classes, staff and pupils."
          action={
            <Link className="button" href="/school/setup">
              Open setup wizard
            </Link>
          }
        />
      ) : null}
      <div className="stat-grid">
        <StatCard label="Pupils" value={data.counts.students} href="/school/students" />
        {data.counts.staff > 0 ? <StatCard label="Staff" value={data.counts.staff} href="/school/staff" /> : null}
        {admissions ? (
          <StatCard
            label="Admissions to review"
            value={admissions.counts.awaitingReview + admissions.counts.applicationsSubmitted}
            href="/school/admissions/applications?status=under_review"
          />
        ) : null}
        {outstanding ? (
          <StatCard
            label="Outstanding"
            value={formatMinor(outstanding.outstandingMinor, outstanding.currency)}
            href="/school/finance/outstanding"
            hint={financeHint}
          />
        ) : null}
        {messagingUnread != null ? (
          <StatCard label="Unread messages" value={messagingUnread} href="/school/messages" />
        ) : null}
        <StatCard label="Lessons today" value={lessons?.length ?? 0} href="/school/timetable" />
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Action queue">
          <ul className="queue-list">
            {admissions && admissions.counts.awaitingReview > 0 ? (
              <li>
                <Link href="/school/admissions/applications?status=under_review">
                  <strong>{admissions.counts.awaitingReview} applications awaiting review</strong>
                  <span className="muted">Open the admissions queue</span>
                </Link>
              </li>
            ) : null}
            {admissions && admissions.counts.applicationsSubmitted > 0 ? (
              <li>
                <Link href="/school/admissions/applications?status=submitted">
                  <strong>{admissions.counts.applicationsSubmitted} applications submitted</strong>
                  <span className="muted">Ready to move into review</span>
                </Link>
              </li>
            ) : null}
            {outstanding && outstanding.overdueCount > 0 ? (
              <li>
                <Link href="/school/finance/outstanding">
                  <strong>{outstanding.overdueCount} overdue payments</strong>
                  <span className="muted">{formatMinor(outstanding.outstandingMinor, outstanding.currency)} outstanding</span>
                </Link>
              </li>
            ) : null}
            {messagingUnread ? (
              <li>
                <Link href="/school/messages">
                  <strong>{messagingUnread} unread messages</strong>
                  <span className="muted">Parent and staff conversations</span>
                </Link>
              </li>
            ) : null}
            {awaitingMarking > 0 ? (
              <li>
                <Link href="/school/teaching/submissions">
                  <strong>{awaitingMarking} submissions to mark</strong>
                  <span className="muted">Teaching & learning queue</span>
                </Link>
              </li>
            ) : null}
          </ul>
          {!(admissions && (admissions.counts.awaitingReview > 0 || admissions.counts.applicationsSubmitted > 0)) &&
          !(outstanding && outstanding.overdueCount > 0) &&
          !messagingUnread &&
          awaitingMarking === 0 ? (
            <EmptyState title="Nothing waiting" description="Admissions, payments, messages and marking queues are clear." />
          ) : null}
        </SectionCard>
        <SectionCard title="Today" actions={<Link href="/school/timetable">Timetable</Link>}>
          {(lessons ?? []).length === 0 ? (
            <EmptyState
              title="No lessons scheduled today"
              description="Open the timetable to view the school week."
              action={<Link href="/school/timetable/schedule">View timetable</Link>}
            />
          ) : (
            <div className="lesson-cards">
              {(lessons ?? []).slice(0, 6).map((lesson) => (
                <article key={`${lesson.entryId}-${lesson.startsAt}`} className="lesson-card">
                  <div className="lesson-time">{timeRange(lesson.startsAt, lesson.endsAt)}</div>
                  <div>
                    <strong>
                      {lesson.className}
                      {lesson.subjectName ? ` · ${lesson.subjectName}` : ""}
                    </strong>
                    <p className="muted">{lesson.roomName ?? "No room"}</p>
                  </div>
                  <StatusBadge status={lesson.covered ? "Cover" : lesson.status} />
                </article>
              ))}
            </div>
          )}
          {coversToday > 0 ? <p className="muted">{coversToday} cover assignment(s) today.</p> : null}
          {(events ?? []).length > 0 ? (
            <>
              <h3>Calendar</h3>
              <ul className="queue-list">
                {(events ?? []).slice(0, 4).map((event) => (
                  <li key={event.id}>
                    <Link href={`/school/communications/calendar/${event.id}`}>
                      <strong>{event.title}</strong>
                      <span className="muted">
                        {new Date(event.startsAt).toLocaleString("en-GB")}
                        {event.eventTypeName ? ` · ${event.eventTypeName}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </SectionCard>
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Recent messages" actions={<Link href="/school/messages">Open inbox</Link>}>
          {(messages ?? []).length === 0 ? (
            <EmptyState title="No conversations yet" description="Parent–teacher messages will appear here." />
          ) : (
            <ul className="queue-list">
              {(messages ?? []).slice(0, 5).map((item) => (
                <li key={item.id}>
                  <Link href={`/school/messages/${item.id}`}>
                    <strong>
                      {item.unreadCount > 0 ? "Unread · " : ""}
                      {item.subject}
                    </strong>
                    <span className="muted">{item.pupilName ?? "No linked pupil"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="School snapshot">
          <dl className="profile-list">
            <div>
              <dt>Year groups</dt>
              <dd>{data.counts.yearGroups}</dd>
            </div>
            <div>
              <dt>Classes</dt>
              <dd>{data.counts.classes}</dd>
            </div>
            <div>
              <dt>Subjects</dt>
              <dd>{data.counts.subjects}</dd>
            </div>
            <div>
              <dt>Parents / guardians</dt>
              <dd>{data.counts.parents}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </>
  );
}
