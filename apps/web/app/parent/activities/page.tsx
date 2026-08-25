"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

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
  const [items, setItems] = useState<Activity[]>([]);
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
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Activities</h1>
      <p className="muted">Trips, clubs, and other school activities for your children. Consent is explicit and is not recorded just by opening a notice.</p>
      {items.length === 0 ? <p>No activities to show.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.activityTypeName} · {item.status} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
            </span>
            {item.children.map((child) => {
              const name = children.find((row) => row.id === child.studentProfileId)?.displayName ?? "Child";
              return (
                <p key={child.studentProfileId}>
                  {name}: {child.consentResponse}
                  {child.registrationStatus ? ` · ${child.registrationStatus}` : ""}
                  {child.actionRequired ? " · action required" : ""}
                  {" "}
                  <Link href={`/parent/activities/${item.id}?studentId=${child.studentProfileId}`}>Open</Link>
                </p>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
