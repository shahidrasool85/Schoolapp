"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Staff = {
  id: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  membershipStatus: string | null;
  roleKeys: string[];
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ staff: Staff[] }>("/api/v1/staff");
    setStaff(body.staff);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await api<{ invitationToken: string }>("/api/v1/staff", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        fullName: form.get("fullName"),
        jobTitle: form.get("jobTitle") || undefined,
        roleKeys: [String(form.get("roleKey") || "school.teacher")],
      }),
    });
    setInvite(created.invitationToken);
    event.currentTarget.reset();
    await load();
  }

  return (
    <>
      <h1>Staff / Teachers</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Full name<input name="fullName" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Job title<input name="jobTitle" /></label>
        <label>
          Role
          <select name="roleKey" defaultValue="school.teacher">
            <option value="school.teacher">Teacher</option>
            <option value="school.headteacher">Headteacher</option>
            <option value="school.admin">School Admin</option>
            <option value="school.admissions">Admissions</option>
            <option value="school.staff">Staff</option>
          </select>
        </label>
        <div><button type="submit">Invite staff</button></div>
      </form>
      {invite ? <p>Invitation token: <code>{invite}</code></p> : null}
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Job title</th><th>Roles</th><th>Status</th></tr>
        </thead>
        <tbody>
          {staff.map((row) => (
            <tr key={row.id}>
              <td>{row.fullName}</td>
              <td>{row.email}</td>
              <td>{row.jobTitle ?? "—"}</td>
              <td>{row.roleKeys.join(", ")}</td>
              <td>{row.membershipStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
