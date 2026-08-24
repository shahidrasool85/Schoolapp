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
  studentSignupEnabled: boolean;
  children: Array<{ registrationStatus: string | null; consentResponse: string }>;
};

export default function StudentActivitiesPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ activities: Activity[] }>("/api/v1/student/activities")
      .then((body) => setItems(body.activities))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Activities</h1>
      {items.length === 0 ? <p>No activities to show.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/student/activities/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.activityTypeName} · {new Date(item.startsAt).toLocaleString()}
              {item.location ? ` · ${item.location}` : ""}
              {item.children[0]?.registrationStatus ? ` · ${item.children[0].registrationStatus}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
