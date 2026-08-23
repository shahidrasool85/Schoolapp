"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type EventType = { id: string; key: string; name: string };
type ClassRow = { id: string; name: string };

export default function NewEventPage() {
  const router = useRouter();
  const [types, setTypes] = useState<EventType[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ eventTypes: EventType[] }>("/api/v1/calendar/event-types"),
      api<{ classes: ClassRow[] }>("/api/v1/classes"),
    ])
      .then(([typeBody, classBody]) => {
        setTypes(typeBody.eventTypes);
        setClasses(classBody.classes);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetType = String(form.get("targetType") || "whole_school");
    const classId = String(form.get("classId") || "");
    const targets =
      targetType === "class" && classId
        ? [{ targetType: "class", classId }]
        : [{ targetType }];
    try {
      const created = await api<{ event: { id: string } }>("/api/v1/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          description: String(form.get("description") || "") || null,
          eventTypeKey: String(form.get("eventTypeKey") || "class_event"),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          allDay: form.get("allDay") === "on",
          location: String(form.get("location") || "") || null,
          targets,
        }),
      });
      router.push(`/school/communications/calendar/${created.event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <>
      <h1>New event</h1>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={onSubmit} className="stack">
        <label>
          Title
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Description
          <textarea name="description" rows={5} />
        </label>
        <label>
          Type
          <select name="eventTypeKey" defaultValue="class_event">
            {types.map((type) => (
              <option key={type.id} value={type.key}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input name="startsAt" type="datetime-local" required />
        </label>
        <label>
          Ends
          <input name="endsAt" type="datetime-local" required />
        </label>
        <label>
          Location
          <input name="location" />
        </label>
        <label>
          Audience
          <select name="targetType" defaultValue="class">
            <option value="class">Class</option>
            <option value="staff">Staff</option>
            <option value="whole_school">Whole school</option>
            <option value="parents">Parents</option>
            <option value="students">Students</option>
          </select>
        </label>
        <label>
          Class
          <select name="classId" defaultValue="">
            <option value="">Select class</option>
            {classes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" name="allDay" /> All day
        </label>
        <button type="submit">Save draft</button>
      </form>
    </>
  );
}
