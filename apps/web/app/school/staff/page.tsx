"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  InviteTokenAlert,
  PageHeader,
  Select,
  StatusBadge,
} from "../../../components/ui";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { ProfileAvatar } from "../../../components/profile-avatar";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Staff = {
  id: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  membershipStatus: string | null;
  accountStatus: string;
  roleKeys: string[];
  photoUrl?: string | null;
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const body = await api<{ staff: Staff[] }>("/api/v1/staff");
    setStaff(body.staff);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load staff.")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setNotice("");
    try {
      const created = await api<{ invitationToken: string }>("/api/v1/staff", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          fullName: form.get("fullName"),
          jobTitle: form.get("jobTitle") || undefined,
          roleKeys: [String(form.get("roleKey") || "school.teacher")],
        }),
      });
      setInviteToken(created.invitationToken);
      setNotice("Staff created. Copy the one-time invitation now — it will not be shown again.");
      resetFormSafely(formEl);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not create staff."));
    }
  }

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Staff"
        description="Create staff, assign roles, and manage invitations. Teachers cannot manage school-wide accounts."
      />
      <form className="card form-grid" onSubmit={onSubmit}>
        <FormField label="Full name">
          <Input name="fullName" required />
        </FormField>
        <FormField label="Email">
          <Input name="email" type="email" required />
        </FormField>
        <FormField label="Job title">
          <Input name="jobTitle" />
        </FormField>
        <FormField label="Role">
          <Select name="roleKey" defaultValue="school.teacher">
            <option value="school.teacher">Teacher</option>
            <option value="school.headteacher">Headteacher</option>
            <option value="school.admin">School Admin</option>
            <option value="school.admissions">Admissions</option>
            <option value="school.staff">Staff</option>
          </Select>
        </FormField>
        <div>
          <Button type="submit">Create and invite</Button>
        </div>
      </form>
      {inviteToken ? <InviteTokenAlert token={inviteToken} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {staff.length === 0 ? (
        <EmptyState
          title="No staff yet"
          description="Add the first staff member above, or import a CSV from Bulk import."
          action={
            <Link href="/school/imports" className="button secondary">
              Bulk import
            </Link>
          }
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Name</th>
              <th>Email</th>
              <th>Job title</th>
              <th>Roles</th>
              <th>Account</th>
            </>
          }
        >
          {staff.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/school/staff/${row.id}`} className="name-with-avatar">
                  <ProfileAvatar name={row.fullName} photoUrl={row.photoUrl} size="sm" />
                  {row.fullName}
                </Link>
              </td>
              <td>{row.email}</td>
              <td>{row.jobTitle ?? "—"}</td>
              <td>{row.roleKeys.join(", ")}</td>
              <td>
                <StatusBadge status={row.accountStatus} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
