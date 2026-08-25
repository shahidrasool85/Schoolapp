"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Activity = {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  activityTypeName: string | null;
  status: string;
  children: Array<{
    studentProfileId: string;
    consentResponse: string;
    registrationStatus: string | null;
    actionRequired: boolean;
  }>;
};

export default function ParentActivitiesPage() {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [children, setChildren] = useState<Array<{ id: string; displayName: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ activities: Activity[] }>("/api/v1/parent/activities"),
      api<{ children: Array<{ id: string; displayName: string }> }>("/api/v1/parent/children"),
    ])
      .then(([list, family]) => {
        setItems(list.activities);
        setChildren(family.children);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load activities.")));
  }, []);

  if (error) return <PageError title="Activities unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading activities…" />;

  return (
    <>
      <PageHeader
        title="Activities"
        description="Trips, clubs, and other school activities for your children. Consent is explicit and is not recorded just by opening a notice."
      />
      {items.length === 0 ? (
        <EmptyState title="No activities to show" description="When the school publishes a trip or club for your child, it will appear here." />
      ) : (
        <div className="cards">
          {items.map((item) => (
            <div className="card" key={item.id}>
              <strong>{item.title}</strong>
              <span className="muted">
                {item.activityTypeName} · <StatusBadge status={item.status} /> · {new Date(item.startsAt).toLocaleString()}
                {item.location ? ` · ${item.location}` : ""}
              </span>
              {item.children.map((child) => {
                const name = children.find((row) => row.id === child.studentProfileId)?.displayName ?? "Child";
                return (
                  <p key={child.studentProfileId}>
                    {name}: <StatusBadge status={child.consentResponse} />
                    {child.registrationStatus ? (
                      <>
                        {" "}
                        · <StatusBadge status={child.registrationStatus} />
                      </>
                    ) : null}
                    {child.actionRequired ? " · action required" : ""}{" "}
                    <Link href={`/parent/activities/${item.id}?studentId=${child.studentProfileId}`}>Open</Link>
                  </p>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
