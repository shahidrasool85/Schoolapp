"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Badge,
  DataTable,
  EmptyState,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
  Timeline,
  UserAvatar,
} from "../../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../../lib/api";
import { formatDate, formatDateTime } from "../../../../../lib/dates";
import { userFacingError } from "../../../../../lib/errors";
import { usePermissions } from "../../../../../lib/use-permissions";
import type { ApplicationDetail, Option } from "./types";
import { ApplicationWorkflowPanel } from "./workflow-panel";

function formatAddress(parts: Array<string | null | undefined>): string {
  const cleaned = parts.map((part) => part?.trim()).filter(Boolean);
  return cleaned.join(", ");
}

function SummaryValue({ value }: { value: unknown }) {
  if (value == null || value === "") {
    return <span className="summary-empty">Not provided</span>;
  }
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  return <>{String(value)}</>;
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <SummaryValue value={value} />
      </dd>
    </div>
  );
}

function displayAnswer(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map((item) => displayAnswer(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (rec.line1 || rec.town || rec.postcode) {
      return formatAddress([
        rec.line1 as string | undefined,
        rec.line2 as string | undefined,
        rec.town as string | undefined,
        rec.postcode as string | undefined,
      ]);
    }
    return Object.entries(rec)
      .filter(([, item]) => item != null && item !== "")
      .map(([key, item]) => `${key.replaceAll("_", " ")}: ${displayAnswer(item)}`)
      .join(", ");
  }
  return String(value);
}

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const { permissions, ready } = usePermissions();
  const [data, setData] = useState<ApplicationDetail | null>(null);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [docError, setDocError] = useState("");

  async function load() {
    const [detail, yr, yg, cl] = await Promise.all([
      api<ApplicationDetail>(`/api/v1/admissions/applications/${params.id}`),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: Option[] }>("/api/v1/classes"),
    ]);
    setData(detail);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(userFacingError(err, "Could not load this application.")));
  }, [params.id]);

  const snapshot = data?.formSubmission?.canonicalSnapshot ?? data?.application.extraFields?.canonical ?? {};
  const child = snapshot.child ?? {};
  const guardians = data?.contacts.filter((contact) => !contact.isEmergency) ?? [];
  const emergencies = data?.contacts.filter((contact) => contact.isEmergency) ?? [];
  const answers = data?.formSubmission?.answers ?? {};
  const customAnswers = Object.entries(answers).filter(([key]) => {
    return !key.includes(".") && key !== "guardians" && !key.startsWith("declaration");
  });
  const medical = snapshot.medical;
  const medicalEmpty =
    !medical?.allergies && !medical?.conditions && !medical?.medication && !medical?.dietary && !medical?.sendNotes;
  const previousSchool =
    snapshot.previousEducation?.schoolName ?? data?.application.previousSchool ?? data?.application.currentSchool;
  const previousEmpty =
    !previousSchool && !snapshot.previousEducation?.startDate && !snapshot.previousEducation?.endDate && !snapshot.previousEducation?.reportDetails;

  const address = data
    ? formatAddress([
        data.application.addressLine1 ?? child.address?.line1,
        data.application.addressLine2 ?? child.address?.line2,
        data.application.addressTown ?? child.address?.town,
        data.application.addressPostcode ?? child.address?.postcode,
      ])
    : "";

  const timelineItems = useMemo(
    () =>
      (data?.history ?? []).map((row) => ({
        id: row.id,
        title: row.previousStatus
          ? `${row.previousStatus.replaceAll("_", " ")} → ${row.newStatus.replaceAll("_", " ")}`
          : row.newStatus.replaceAll("_", " "),
        meta: [formatDateTime(row.createdAt), row.actorName].filter(Boolean).join(" · "),
        body: row.reason ?? undefined,
      })),
    [data?.history],
  );

  if (error && !data) return <PageError description={error} />;
  if (!data || !ready) return <LoadingState label="Loading application…" />;

  const app = data.application;
  const emergencyRows =
    emergencies.length > 0
      ? emergencies
      : snapshot.emergency?.fullName
        ? [
            {
              id: "snapshot",
              fullName: snapshot.emergency.fullName,
              relationship: snapshot.emergency.relationship ?? "",
              telephone: snapshot.emergency.telephone ?? null,
              authorisedCollection: Boolean(snapshot.emergency.authorisedCollection),
            },
          ]
        : [];

  return (
    <>
      <PageHeader
        title={app.pupilLegalName}
        description={
          <span className="header-meta">
            <span>{app.reference}</span>
            <span>{app.intendedYearGroupName ?? "Year group not set"}</span>
            <span>{app.intendedAcademicYearName ?? "Intake not set"}</span>
          </span>
        }
        breadcrumbs={[
          { href: "/school/admissions", label: "Admissions" },
          { href: "/school/admissions/applications", label: "Applications" },
          { label: app.reference },
        ]}
        actions={<StatusBadge status={app.status} />}
      />

      <div className="record-layout">
        <div className="record-main">
          <SectionCard title="Application overview">
            <dl className="profile-list">
              <Field label="Pupil legal name" value={app.pupilLegalName} />
              <Field label="Preferred name" value={app.pupilPreferredName ?? child.preferredName} />
              <Field label="Date of birth" value={formatDate(app.dateOfBirth ?? child.dateOfBirth) || null} />
              <Field label="Sex / gender" value={app.gender ?? child.gender} />
              <Field label="Intake" value={app.intendedAcademicYearName} />
              <Field label="Year group" value={app.intendedYearGroupName} />
              <Field
                label="Proposed start"
                value={formatDate(app.intendedEntryDate ?? child.proposedStartDate) || null}
              />
              <Field label="Address" value={address || null} />
              <Field label="Current school" value={app.currentSchool ?? child.currentSchool} />
              <Field label="Previous school" value={app.previousSchool ?? child.previousSchool} />
              <Field label="Source / campaign" value={data.formSubmission?.campaignLabel ?? app.campaignLabel ?? app.source} />
              <Field label="Form used" value={data.formSubmission?.formName ?? app.publicFormName} />
              <Field
                label="Submitted"
                value={formatDateTime(data.formSubmission?.submittedAt ?? app.submittedAt) || null}
              />
              <Field label="Completeness" value={app.completenessStatus ?? data.formSubmission?.completenessStatus} />
              <div>
                <dt>Enrolled pupil</dt>
                <dd>
                  {app.convertedStudentProfileId ? (
                    <a href={`/school/students/${app.convertedStudentProfileId}`}>Open pupil record</a>
                  ) : (
                    <span className="summary-empty">Not enrolled</span>
                  )}
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Parents / guardians">
            {guardians.length === 0 ? (
              <EmptyState title="No parents or guardians recorded" description="Contacts added on the application will appear here." />
            ) : (
              <div>
                {guardians.map((contact) => (
                  <div className="person-card" key={contact.id}>
                    <UserAvatar name={contact.fullName} />
                    <div>
                      <strong>{contact.fullName}</strong>
                      <p className="muted" style={{ margin: "0.15rem 0 0.35rem" }}>
                        {contact.relationship || "Relationship not provided"}
                        {contact.email ? ` · ${contact.email}` : " · Email not provided"}
                        {contact.telephone ? ` · ${contact.telephone}` : ""}
                      </p>
                      <div className="person-card-meta">
                        {contact.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                        <Badge tone={contact.hasParentalResponsibility ? "success" : "neutral"}>
                          {contact.hasParentalResponsibility ? "Parental responsibility" : "No parental responsibility"}
                        </Badge>
                        <Badge tone={contact.userId ? "info" : "neutral"}>
                          {contact.userId ? "Portal identity linked" : "No portal user yet"}
                        </Badge>
                      </div>
                      {formatAddress([
                        contact.addressLine1,
                        contact.addressLine2,
                        contact.addressTown,
                        contact.addressPostcode,
                      ]) ? (
                        <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                          {formatAddress([
                            contact.addressLine1,
                            contact.addressLine2,
                            contact.addressTown,
                            contact.addressPostcode,
                          ])}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Previous education">
            {previousEmpty ? (
              <EmptyState title="No previous education recorded" />
            ) : (
              <dl className="profile-list">
                <Field label="School" value={previousSchool} />
                <Field label="From" value={formatDate(snapshot.previousEducation?.startDate) || null} />
                <Field label="To" value={formatDate(snapshot.previousEducation?.endDate) || null} />
                <Field label="Report / reference" value={snapshot.previousEducation?.reportDetails} />
              </dl>
            )}
          </SectionCard>

          <SectionCard
            title="Medical & additional needs"
            description="Restricted to authorised admissions staff. This is not shown on parent or student portals."
          >
            {medicalEmpty ? (
              <EmptyState title="No medical or additional needs recorded" />
            ) : (
              <>
                <p className="sensitive-note muted">Sensitive applicant data. Handle according to school policy.</p>
                <dl className="profile-list">
                  <Field label="Allergies" value={medical?.allergies} />
                  <Field label="Medical conditions" value={medical?.conditions} />
                  <Field label="Medication" value={medical?.medication} />
                  <Field label="Dietary requirements" value={medical?.dietary} />
                  <Field label="SEND / additional needs" value={medical?.sendNotes} />
                </dl>
              </>
            )}
          </SectionCard>

          <SectionCard title="Emergency contacts / collection">
            {emergencyRows.length === 0 ? (
              <EmptyState title="No emergency contacts recorded" />
            ) : (
              <div>
                {emergencyRows.map((contact) => (
                  <div className="person-card" key={contact.id}>
                    <UserAvatar name={contact.fullName} />
                    <div>
                      <strong>{contact.fullName}</strong>
                      <p className="muted" style={{ margin: "0.15rem 0 0.35rem" }}>
                        {contact.relationship || "Relationship not provided"}
                        {contact.telephone ? ` · ${contact.telephone}` : " · Telephone not provided"}
                      </p>
                      <Badge tone={contact.authorisedCollection ? "success" : "neutral"}>
                        {contact.authorisedCollection ? "Authorised to collect" : "Not authorised to collect"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Documents">
            {docError ? <Alert tone="danger">{docError}</Alert> : null}
            {(data.documents ?? []).length === 0 ? (
              <EmptyState title="No uploaded documents" />
            ) : (
              <DataTable
                headers={
                  <>
                    <th>File</th>
                    <th>Type / question</th>
                    <th>Uploaded</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Download</th>
                  </>
                }
              >
                {(data.documents ?? []).map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.filename}</td>
                    <td>
                      {doc.fieldKey} · {doc.purpose}
                    </td>
                    <td>{formatDateTime(doc.createdAt)}</td>
                    <td>{doc.byteSize ? `${Math.round(doc.byteSize / 1024)} KB` : "Not provided"}</td>
                    <td>
                      <StatusBadge status={doc.status} />
                    </td>
                    <td>
                      {doc.downloadPath ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            downloadAuthenticated(doc.downloadPath!, doc.filename).catch((err: unknown) =>
                              setDocError(userFacingError(err, "Could not download that file.")),
                            )
                          }
                        >
                          Download
                        </button>
                      ) : (
                        <span className="summary-empty">Not available</span>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </SectionCard>

          {customAnswers.length > 0 ? (
            <SectionCard title="Application-specific answers">
              <dl className="profile-list">
                {customAnswers.map(([key, value]) => (
                  <Field key={key} label={key.replaceAll("_", " ")} value={displayAnswer(value) || null} />
                ))}
              </dl>
            </SectionCard>
          ) : null}

          {data.formSubmission?.declarationSnapshot ? (
            <SectionCard title="Declarations">
              <ul>
                {(data.formSubmission.declarationSnapshot.declarations ?? []).map((item) => (
                  <li key={item.fieldKey}>
                    {item.label}: {item.accepted ? "accepted" : "not accepted"}
                  </li>
                ))}
              </ul>
              {data.formSubmission.declarationSnapshot.capturedAt ? (
                <p className="muted">Captured {formatDateTime(data.formSubmission.declarationSnapshot.capturedAt)}</p>
              ) : null}
            </SectionCard>
          ) : null}

          {snapshot.notes ? (
            <SectionCard title="Applicant notes">
              <p>{snapshot.notes}</p>
            </SectionCard>
          ) : null}
          {app.internalNotes ? (
            <SectionCard title="Internal notes">
              <p>{app.internalNotes}</p>
            </SectionCard>
          ) : null}

          <SectionCard title="Application history">
            {timelineItems.length === 0 ? (
              <EmptyState title="No status history yet" />
            ) : (
              <Timeline items={timelineItems} />
            )}
          </SectionCard>
        </div>

        <ApplicationWorkflowPanel
          data={data}
          years={years}
          groups={groups}
          classes={classes}
          permissions={permissions ?? []}
          onReload={load}
        />
      </div>
    </>
  );
}
