"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { loginHrefForReturn } from "@schoolapp/domain";
import {
  Alert,
  Checkbox,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
} from "../../../../components/ui";
import { Button } from "../../../../components/ui/button";
import { api, getToken, setOrgId, setToken } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { loadPublicTenant, schoolOrigin } from "../../../../lib/tenant";

type SchoolAdmin = {
  userId: string;
  email: string | null;
  fullName: string;
  membershipStatus: string;
};

type StaffMember = {
  userId: string;
  email: string | null;
  fullName: string;
  preferredName: string | null;
  userKind: string;
  roles: string[];
  membershipStatus: string;
  userStatus: string;
  jobTitle: string | null;
  employeeNumber: string | null;
  createdAt: string;
  invitationCreatorName: string | null;
  invitationCreatedAt: string | null;
  staffProfileCreatedAt: string | null;
  classAssignmentCount: number;
  isSchoolAdmin: boolean;
};

type PendingInvite = {
  invitationId: string;
  email: string | null;
  intendedRoleKeys: string[];
  createdAt: string;
};

type StructuralPolicy = {
  key: string;
  label: string;
  defaultAction: "preserve";
  action: "preserve" | "wipe";
  rowCount: number;
};

type Preview = {
  mode: string;
  organisation: { id: string; slug: string; name: string; status: string };
  schoolAdminsPreserved: SchoolAdmin[];
  staffPreserved: StaffMember[];
  staffSelectedForRemoval: StaffMember[];
  pendingStaffInvitesPreserved: PendingInvite[];
  counts: Record<string, number>;
  preserved: Array<{ key: string; label: string }>;
  structuralPolicies: StructuralPolicy[];
  liveFinancialResetBlocked: boolean;
  alreadyClean: boolean;
  verification?: Record<string, boolean>;
};

const COUNT_LABELS: Record<string, string> = {
  pupils: "Pupils",
  guardianships: "Guardian relationships",
  staffToRemove: "Staff users explicitly selected for removal",
  membershipsToRemove: "Non-preserved memberships to remove",
  admissionsEnquiries: "Admissions enquiries",
  admissionsApplications: "Applications",
  attendanceMarks: "Attendance marks",
  timetableLessons: "Timetable lessons",
  assignments: "Assignments",
  safeguardingRecords: "Safeguarding records",
  pastoralConcerns: "Pastoral records",
  behaviourIncidents: "Behaviour incidents",
  medications: "Medication records",
  invoices: "Invoices",
  payments: "Payments",
  receipts: "Receipts",
  storedDocuments: "Stored operational documents",
  mailOutbox: "Emails/outbox records",
  classes: "Classes/forms",
  notices: "Notices",
  messages: "Messages",
  notifications: "Notifications",
  activities: "Trips and clubs",
  rewards: "Rewards",
  invitations: "Non-staff invitations to remove",
  dataImports: "Data imports",
  censusRuns: "Census runs",
};

const PRESERVED_COUNT_KEYS = new Set(["staffPreserved", "academicYears"]);

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function staffSummary(member: StaffMember): string {
  const name = member.preferredName ? `${member.fullName} (${member.preferredName})` : member.fullName;
  const email = member.email ? ` · ${member.email}` : "";
  return `${name}${email}`;
}

export default function PlatformSchoolPage() {
  const router = useRouter();
  const params = useParams<{ organisationId: string }>();
  const organisationId = params.organisationId;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [platformDomain, setPlatformDomain] = useState("localhost");
  const [confirmationText, setConfirmationText] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [understandPermanent, setUnderstandPermanent] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [staffUserIdsToRemove, setStaffUserIdsToRemove] = useState<string[]>([]);
  const [wipeAcademicStructure, setWipeAcademicStructure] = useState(false);
  const [wipePublishedAdmissionsForms, setWipePublishedAdmissionsForms] = useState(false);
  const [wipeFeeSchedules, setWipeFeeSchedules] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(loginHrefForReturn(`${window.location.pathname}${window.location.search}`, "platform"));
      return;
    }
    let cancelled = false;
    Promise.all([
      loadPublicTenant(),
      api<{ isPlatformAdmin: boolean }>("/api/v1/me", { orgId: null }),
    ])
      .then(async ([tenant, me]) => {
        if (cancelled) return;
        if (tenant.kind === "unknown") {
          setError("This address is not an active school on the platform.");
          return;
        }
        if (tenant.kind === "school") {
          router.replace("/login");
          return;
        }
        if (!me.isPlatformAdmin) {
          setError("This page is for platform administrators.");
          return;
        }
        setPlatformDomain(tenant.platformDomain);
        const body = await api<Preview>(`/api/v1/platform/organisations/${organisationId}/operational-reset`, {
          orgId: null,
        });
        if (cancelled) return;
        setError("");
        setPreview(body);
        setStaffUserIdsToRemove([]);
        setWipeAcademicStructure(false);
        setWipePublishedAdmissionsForms(false);
        setWipeFeeSchedules(false);
        setReady(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(userFacingError(err, "Could not load this school."));
      });
    return () => {
      cancelled = true;
    };
  }, [organisationId, router]);

  const removableStaff = useMemo(() => {
    if (!preview) return [];
    const byId = new Map<string, StaffMember>();
    for (const member of [...preview.staffPreserved, ...preview.staffSelectedForRemoval]) {
      byId.set(member.userId, member);
    }
    return [...byId.values()].filter((member) => !member.isSchoolAdmin);
  }, [preview]);

  const selectedStaff = useMemo(() => {
    const selected = new Set(staffUserIdsToRemove);
    return removableStaff.filter((member) => selected.has(member.userId));
  }, [removableStaff, staffUserIdsToRemove]);

  const unselectedStaff = useMemo(() => {
    const selected = new Set(staffUserIdsToRemove);
    return removableStaff.filter((member) => !selected.has(member.userId));
  }, [removableStaff, staffUserIdsToRemove]);

  const canSubmit = useMemo(() => {
    if (!preview || preview.liveFinancialResetBlocked || resetting) return false;
    if (preview.schoolAdminsPreserved.length < 1) return false;
    return backupConfirmed && understandPermanent && confirmationText.trim().length > 0;
  }, [backupConfirmed, confirmationText, preview, resetting, understandPermanent]);

  function toggleStaffRemoval(userId: string, checked: boolean) {
    setStaffUserIdsToRemove((current) => {
      if (checked) return current.includes(userId) ? current : [...current, userId];
      return current.filter((id) => id !== userId);
    });
  }

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  async function runReset(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    setError("");
    setNotice("");
    setResetting(true);
    try {
      const result = await api<Preview>(`/api/v1/platform/organisations/${organisationId}/operational-reset`, {
        method: "POST",
        orgId: null,
        body: JSON.stringify({
          confirmationText,
          backupConfirmed,
          understandPermanent,
          resetMode: "operational_reset_v1",
          staffUserIdsToRemove,
          wipeAcademicStructure,
          wipePublishedAdmissionsForms,
          wipeFeeSchedules,
        }),
      });
      setPreview(result);
      setConfirmationText("");
      setBackupConfirmed(false);
      setUnderstandPermanent(false);
      setStaffUserIdsToRemove([]);
      setWipeAcademicStructure(false);
      setWipePublishedAdmissionsForms(false);
      setWipeFeeSchedules(false);
      setNotice(`${preview.organisation.name} operational data has been reset. School Admin and staff accounts were preserved unless explicitly selected for removal.`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not reset school operational data."));
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="platform-shell">
      <PageHeader
        title={preview ? preview.organisation.name : "School"}
        description="Platform Admin school controls. This is not School Admin settings."
        breadcrumbs={[
          { href: "/platform", label: "Platform Admin" },
          { href: "/platform", label: "Schools" },
          { label: preview?.organisation.name ?? "School" },
        ]}
        actions={
          <Button type="button" variant="secondary" onClick={logout}>
            Sign out
          </Button>
        }
      />
      {error ? <PageError description={error} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!ready && !error ? <LoadingState label="Loading school…" /> : null}
      {ready && preview ? (
        <>
          <SectionCard title="School identity" description="These values stay after an operational reset.">
            <p>
              <strong>{preview.organisation.name}</strong> · <code>{preview.organisation.slug}</code> ·{" "}
              {preview.organisation.status}
            </p>
            <p className="muted">
              School login:{" "}
              <a href={`${schoolOrigin(preview.organisation.slug, platformDomain)}/login`}>Open school login</a>
            </p>
          </SectionCard>
          <section className="danger-zone" aria-labelledby="danger-zone-heading">
            <h2 id="danger-zone-heading">Danger zone</h2>
            <p>
              <strong>RESET SCHOOL OPERATIONAL DATA</strong>
            </p>
            <p>
              This permanently deletes this school&apos;s operational and UAT records. It does not delete the school,
              hostname, branding, School Admin accounts, or staff/teacher accounts unless you explicitly select those
              staff below. Academic structure, published admissions forms, and fee schedules stay unless you opt in to
              wipe them. This cannot be undone through the UI.
            </p>
            <Alert tone="danger">Create and verify a backup before resetting school data.</Alert>
            {preview.liveFinancialResetBlocked ? (
              <Alert tone="danger">
                Reset is blocked because this school has live Stripe mode or live payment evidence.
              </Alert>
            ) : null}
            <h3>Preserved School Admins</h3>
            <ul>
              {preview.schoolAdminsPreserved.map((admin) => (
                <li key={admin.userId}>
                  {admin.email ?? admin.fullName}
                  {admin.email && admin.fullName ? ` · ${admin.fullName}` : ""}
                </li>
              ))}
            </ul>
            {preview.schoolAdminsPreserved.length === 0 ? (
              <p className="muted">No active School Admin is available to preserve. Reset is blocked.</p>
            ) : null}

            <h3>Preserved staff</h3>
            <p className="muted">
              Staff default to preserve. Selecting a person marks them as demo/test staff to remove. This never uses
              name, email pattern, or created date automatically.
            </p>
            {unselectedStaff.length === 0 ? <p className="muted">No additional staff to preserve.</p> : null}
            <ul className="reset-staff-list">
              {unselectedStaff.map((member) => (
                <li key={member.userId}>
                  <Checkbox
                    checked={false}
                    onChange={(event) => toggleStaffRemoval(member.userId, event.target.checked)}
                    label={`Remove ${staffSummary(member)}`}
                  />
                  <div className="muted reset-staff-meta">
                    {member.userKind} · {member.roles.join(", ") || "no role"} · membership {member.membershipStatus} ·
                    account {member.userStatus}
                    {member.jobTitle ? ` · ${member.jobTitle}` : ""}
                    {member.employeeNumber ? ` · #${member.employeeNumber}` : ""} · created {formatWhen(member.createdAt)}
                    {member.invitationCreatorName
                      ? ` · invited by ${member.invitationCreatorName} ${formatWhen(member.invitationCreatedAt)}`
                      : ""}
                    {member.staffProfileCreatedAt
                      ? ` · staff profile created ${formatWhen(member.staffProfileCreatedAt)}`
                      : ""}{" "}
                    · {member.classAssignmentCount} class assignment{member.classAssignmentCount === 1 ? "" : "s"}
                  </div>
                </li>
              ))}
            </ul>

            <h3>Staff explicitly selected for removal</h3>
            {selectedStaff.length === 0 ? (
              <p className="muted">None. All listed staff will be preserved.</p>
            ) : (
              <ul className="reset-staff-list">
                {selectedStaff.map((member) => (
                  <li key={member.userId}>
                    <Checkbox
                      checked
                      onChange={(event) => toggleStaffRemoval(member.userId, event.target.checked)}
                      label={`Remove ${staffSummary(member)}`}
                    />
                    <div className="muted reset-staff-meta">
                      {member.roles.join(", ")} · membership {member.membershipStatus}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3>Pending staff invitations preserved</h3>
            {preview.pendingStaffInvitesPreserved.length === 0 ? (
              <p className="muted">No unmatched pending staff invitations.</p>
            ) : (
              <ul>
                {preview.pendingStaffInvitesPreserved.map((invite) => (
                  <li key={invite.invitationId}>
                    {invite.email ?? "No email"} · {invite.intendedRoleKeys.join(", ")} · {formatWhen(invite.createdAt)}
                  </li>
                ))}
              </ul>
            )}

            <h3>Academic and configuration categories</h3>
            <p className="muted">These default to preserve. Opt in only if they are known demo/test structure.</p>
            <ul className="reset-structure-list">
              {(preview.structuralPolicies ?? []).map((item) => {
                const checked =
                  item.key === "academicStructure"
                    ? wipeAcademicStructure
                    : item.key === "publishedAdmissionsForms"
                      ? wipePublishedAdmissionsForms
                      : wipeFeeSchedules;
                const onChange =
                  item.key === "academicStructure"
                    ? setWipeAcademicStructure
                    : item.key === "publishedAdmissionsForms"
                      ? setWipePublishedAdmissionsForms
                      : setWipeFeeSchedules;
                return (
                  <li key={item.key}>
                    <Checkbox
                      checked={checked}
                      onChange={(event) => onChange(event.target.checked)}
                      label={`Wipe ${item.label} (${item.rowCount} row${item.rowCount === 1 ? "" : "s"}; default preserve)`}
                    />
                  </li>
                );
              })}
            </ul>

            <h3>Operational records that will be deleted</h3>
            <ul className="reset-count-list">
              {Object.entries(preview.counts)
                .filter(([key]) => !PRESERVED_COUNT_KEYS.has(key))
                .map(([key, value]) => (
                  <li key={key}>
                    {COUNT_LABELS[key] ?? key}: {value}
                  </li>
                ))}
            </ul>
            <h3>What will be preserved</h3>
            <ul>
              {preview.preserved.map((item) => (
                <li key={item.key}>{item.label}</li>
              ))}
            </ul>
            {preview.alreadyClean ? (
              <Alert tone="info">This school already has no operational records. A second reset is safe.</Alert>
            ) : null}
            <form className="form-grid" onSubmit={runReset}>
              <FormField
                label={`Type ${preview.organisation.slug} to confirm`}
                hint="Type the exact school slug or school name."
              >
                <Input
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  autoComplete="off"
                  required
                />
              </FormField>
              <Checkbox
                checked={backupConfirmed}
                onChange={(event) => setBackupConfirmed(event.target.checked)}
                label="I confirm a current backup has been created."
              />
              <Checkbox
                checked={understandPermanent}
                onChange={(event) => setUnderstandPermanent(event.target.checked)}
                label="I understand this will permanently delete this school's operational data."
              />
              <div>
                <Button type="submit" variant="danger" disabled={!canSubmit}>
                  {resetting ? "Resetting…" : `Reset ${preview.organisation.name} data`}
                </Button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
