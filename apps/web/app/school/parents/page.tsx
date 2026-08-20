"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";

type Guardian = {
  id: string;
  studentProfileId: string;
  studentLegalName: string | null;
  guardianFullName: string | null;
  guardianEmail: string | null;
  relationship: string;
  hasParentalResponsibility: boolean;
  endedOn: string | null;
};

export default function ParentsPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ guardians: Guardian[] }>("/api/v1/guardians")
      .then((body) => setGuardians(body.guardians))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <h1>Parents / Guardians</h1>
      <p className="muted">
        Link parents from a student record. The same parent identity can hold memberships at more
        than one school.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr><th>Parent</th><th>Email</th><th>Child</th><th>Relationship</th><th>PR</th><th>Status</th></tr>
        </thead>
        <tbody>
          {guardians.map((row) => (
            <tr key={row.id}>
              <td>{row.guardianFullName}</td>
              <td>{row.guardianEmail}</td>
              <td>
                <Link href={`/school/students/${row.studentProfileId}`}>
                  {row.studentLegalName}
                </Link>
              </td>
              <td>{row.relationship}</td>
              <td>{row.hasParentalResponsibility ? "Yes" : "No"}</td>
              <td>{row.endedOn ?? "current"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
