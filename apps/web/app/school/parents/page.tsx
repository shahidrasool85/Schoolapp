"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  InviteTokenAlert,
  PageHeader,
  StatusBadge,
} from "../../../components/ui";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Guardian = {
  id: string;
  studentProfileId: string;
  studentLegalName: string | null;
  guardianUserId: string;
  guardianFullName: string | null;
  guardianEmail: string | null;
  relationship: string;
  hasParentalResponsibility: boolean;
  portalAccess: boolean;
  membershipStatus: string | null;
  accountStatus: string;
  pendingInvitation: boolean;
  endedOn: string | null;
};

export default function ParentsPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  async function load() {
    const body = await api<{ guardians: Guardian[] }>("/api/v1/guardians");
    setGuardians(body.guardians);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load parents.")));
  }, []);

  async function invite(id: string) {
    setError("");
    try {
      const body = await api<{ invitationToken: string }>(`/api/v1/guardianships/${id}/invite`, { method: "POST" });
      setInviteToken(body.invitationToken);
      setNotice("Parent invitation issued. Copy the one-time token now — it will not be shown again.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not invite parent."));
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      await api(`/api/v1/guardianships/${id}/invite/revoke`, { method: "POST" });
      setInviteToken("");
      setNotice("Outstanding invitation revoked.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not revoke invitation."));
    }
  }

  async function togglePortal(id: string, portalAccess: boolean) {
    setError("");
    try {
      await api(`/api/v1/guardianships/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ portalAccess }),
      });
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update portal access."));
    }
  }

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Parents / Guardians"
        description="Portal access is off unless explicitly enabled. Matching emails are never linked across organisations."
      />
      {inviteToken ? <InviteTokenAlert token={inviteToken} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {guardians.length === 0 ? (
        <EmptyState
          title="No parents linked yet"
          description="Add a guardian from a pupil record. Parent Portal stays off until you enable it."
          action={
            <Link href="/school/students" className="button secondary">
              Open pupils
            </Link>
          }
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Parent</th>
              <th>Child</th>
              <th>Relationship</th>
              <th>PR</th>
              <th>Parent Portal</th>
              <th>Account</th>
              <th></th>
            </>
          }
        >
          {guardians.map((row) => (
            <tr key={row.id}>
              <td>
                {row.guardianFullName}
                <div className="muted">{row.guardianEmail}</div>
              </td>
              <td>
                <Link href={`/school/students/${row.studentProfileId}`}>{row.studentLegalName}</Link>
              </td>
              <td>{row.relationship}</td>
              <td>{row.hasParentalResponsibility ? "Yes" : "No"}</td>
              <td>
                {row.endedOn ? (
                  "Ended"
                ) : (
                  <Button type="button" variant="secondary" onClick={() => togglePortal(row.id, !row.portalAccess)}>
                    {row.portalAccess ? "Enabled" : "Off"}
                  </Button>
                )}
              </td>
              <td>
                <StatusBadge status={row.accountStatus} />
              </td>
              <td>
                {row.endedOn ? null : (
                  <div className="button-row">
                    <Button type="button" variant="secondary" onClick={() => invite(row.id)}>
                      {row.pendingInvitation ? "Resend" : "Invite"}
                    </Button>
                    {row.pendingInvitation ? (
                      <Button type="button" variant="ghost" onClick={() => revoke(row.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
