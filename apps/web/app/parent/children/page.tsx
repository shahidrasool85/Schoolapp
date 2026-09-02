"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../components/ui";
import { ProfileAvatar } from "../../../components/profile-avatar";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import type { PortalChild } from "../../../lib/portal";

export default function ParentChildrenPage() {
  const [children, setChildren] = useState<PortalChild[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ children: PortalChild[] }>("/api/v1/parent/children")
      .then((body) => setChildren(body.children))
      .catch((err: Error) => setError(userFacingError(err, "Could not load your children.")));
  }, []);

  if (error) return <PageError title="Children unavailable" description={error} />;
  if (!children) return <LoadingState label="Loading your children…" />;

  return (
    <>
      <PageHeader title="My Children" description="Open a child to see attendance, learning, results, and school information." />
      {children.length === 0 ? (
        <EmptyState title="No children linked" description="No children are linked for this school." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Name</th>
              <th>Year group</th>
              <th>Class / form</th>
              <th>School</th>
            </>
          }
        >
          {children.map((child) => (
            <tr key={child.id}>
              <td>
                <Link href={`/parent/children/${child.id}`} className="name-with-avatar">
                  <ProfileAvatar name={child.displayName} photoUrl={child.photoUrl} size="sm" />
                  {child.displayName}
                </Link>
              </td>
              <td>{child.currentYearGroupName ?? "—"}</td>
              <td>{child.currentFormClassName ?? "—"}</td>
              <td>{child.school.name}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
