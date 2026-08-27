"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Alert,
  Button,
  Checkbox,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  PersonSummary,
  SectionCard,
  StatusBadge,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

const STAFF_ROLES = [
  { key: "school.teacher", label: "Teacher" },
  { key: "school.staff", label: "Staff" },
  { key: "school.admissions", label: "Admissions" },
  { key: "school.headteacher", label: "Headteacher" },
  { key: "school.admin", label: "School Admin" },
];

type Staff = {
  id: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  employeeNumber: string | null;
  membershipStatus: string | null;
  accountStatus: string;
  pendingInvitation: boolean;
  hasCredentials: boolean;
  roleKeys: string[];
};

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  async function load() {
    const body = await api<{ staff: Staff }>(`/api/v1/staff/${params.id}`);
    setStaff(body.staff);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load staff member.")));
  }, [params.id]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff) return;
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/api/v1/staff/${staff.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          jobTitle: form.get("jobTitle") || null,
          employeeNumber: form.get("employeeNumber") || null,
        }),
      });
      setNotice("Staff details saved.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not save staff details."));
    }
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff) return;
    const form = new FormData(event.currentTarget);
    const roleKeys = STAFF_ROLES.map((role) => role.key).filter((key) => form.get(key) === "on");
    setError("");
    try {
      await api(`/api/v1/staff/${staff.id}/roles`, {
        method: "PATCH",
        body: JSON.stringify({ roleKeys }),
      });
      setNotice("Roles updated.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update roles."));
    }
  }

  async function invite() {
    if (!staff) return;
    setError("");
    try {
      const body = await api<{ invitationToken: string }>(`/api/v1/staff/${staff.id}/invite`, { method: "POST" });
      setInviteToken(body.invitationToken);
      setNotice("Invitation issued. Copy the one-time token now — it will not be shown again.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not send invitation."));
    }
  }

  async function revoke() {
    if (!staff) return;
    setError("");
    try {
      await api(`/api/v1/staff/${staff.id}/invite/revoke`, { method: "POST" });
      setInviteToken("");
      setNotice("Outstanding invitation revoked.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not revoke invitation."));
    }
  }

  async function setStatus(path: "suspend" | "reactivate") {
    if (!staff) return;
    setError("");
    try {
      await api(`/api/v1/staff/${staff.id}/${path}`, { method: "POST" });
      setNotice(path === "suspend" ? "Account suspended." : "Account reactivated.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update account status."));
    }
  }

  if (error && !staff) return <PageError description={error} />;
  if (!staff) return <LoadingState label="Loading staff member…" />;

  return (
    <>
      <PageHeader
        title={staff.fullName}
        description={staff.email ?? "No email"}
        actions={
          <Link href="/school/staff" className="button secondary">
            All staff
          </Link>
        }
      />
      <PersonSummary
        name={staff.fullName}
        meta={<>{staff.jobTitle ?? "Staff"} · {staff.email}</>}
        actions={<StatusBadge status={staff.accountStatus} />}
      />
      {inviteToken ? (
        <Alert tone="info">
          One-time invitation (copy now): <code>{inviteToken}</code>
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard title="Account">
        <p className="muted">
          Status is derived from membership, credentials, and outstanding invitations. Tokens are hashed at rest and
          shown only once.
        </p>
        <div className="button-row">
          <Button type="button" onClick={invite}>
            {staff.pendingInvitation ? "Resend invitation" : "Send invitation"}
          </Button>
          {staff.pendingInvitation ? (
            <Button type="button" variant="secondary" onClick={revoke}>
              Revoke invitation
            </Button>
          ) : null}
          {staff.accountStatus === "suspended" ? (
            <Button type="button" variant="secondary" onClick={() => setStatus("reactivate")}>
              Reactivate
            </Button>
          ) : (
            <Button type="button" variant="danger" onClick={() => setStatus("suspend")}>
              Suspend
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Details">
        <form className="form-grid" onSubmit={saveProfile}>
          <FormField label="Job title">
            <Input name="jobTitle" defaultValue={staff.jobTitle ?? ""} />
          </FormField>
          <FormField label="Employee number">
            <Input name="employeeNumber" defaultValue={staff.employeeNumber ?? ""} />
          </FormField>
          <div>
            <Button type="submit">Save details</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Roles" description="Assigning School Admin requires an existing School Admin. The last admin cannot be removed.">
        <form className="form-grid" onSubmit={saveRoles}>
          {STAFF_ROLES.map((role) => (
            <Checkbox
              key={role.key}
              name={role.key}
              label={role.label}
              defaultChecked={staff.roleKeys.includes(role.key)}
            />
          ))}
          <div>
            <Button type="submit">Save roles</Button>
          </div>
        </form>
      </SectionCard>
    </>
  );
}
