"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import type { PortalChild } from "../../../lib/portal";

export default function ParentChildrenPage() {
  const [children, setChildren] = useState<PortalChild[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ children: PortalChild[] }>("/api/v1/parent/children")
      .then((body) => setChildren(body.children))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!children) return <p>Loading…</p>;

  return (
    <>
      <h1>My Children</h1>
      {children.length === 0 ? (
        <div className="card">
          <p>No children are linked for this school.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Year group</th>
              <th>Class / form</th>
              <th>School</th>
            </tr>
          </thead>
          <tbody>
            {children.map((child) => (
              <tr key={child.id}>
                <td>
                  <Link href={`/parent/children/${child.id}`}>{child.displayName}</Link>
                </td>
                <td>{child.currentYearGroupName ?? "—"}</td>
                <td>{child.currentFormClassName ?? "—"}</td>
                <td>{child.school.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
