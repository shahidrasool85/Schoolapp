"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import type { PortalChild } from "../../../../lib/portal";

type Teacher = { userId: string; fullName: string; jobTitle: string | null };
type Contacts = {
  contacts: Array<{ contactPoint: string; available: boolean; teachers: Teacher[] }>;
};

export default function ParentNewMessagePage() {
  const router = useRouter();
  const [children, setChildren] = useState<PortalChild[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [contact, setContact] = useState("class_teacher");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ children: PortalChild[] }>("/api/v1/parent/children")
      .then((body) => setChildren(body.children))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function loadContacts(studentId: string) {
    if (!studentId) {
      setTeachers([]);
      return;
    }
    const body = await api<Contacts>(`/api/v1/parent/messages/contacts?studentId=${studentId}`);
    const classTeacher = body.contacts.find((item) => item.contactPoint === "class_teacher");
    setTeachers(classTeacher?.teachers ?? []);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api<{ conversation: { id: string } }>("/api/v1/parent/messages", {
        method: "POST",
        body: JSON.stringify({
          studentId: String(form.get("studentId") || ""),
          contactPoint: String(form.get("contactPoint") || ""),
          teacherUserId: String(form.get("teacherUserId") || "") || null,
          subject: String(form.get("subject") || ""),
          body: String(form.get("body") || ""),
        }),
      });
      router.push(`/parent/messages/${created.conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the conversation");
    }
  }

  return (
    <>
      <h1>New message</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form onSubmit={submit}>
        <label htmlFor="studentId">Child</label>
        <select
          id="studentId"
          name="studentId"
          required
          onChange={(event) => loadContacts(event.target.value).catch((err: Error) => setError(err.message))}
        >
          <option value="">Select a child</option>
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.displayName}
            </option>
          ))}
        </select>
        <label htmlFor="contactPoint">Contact</label>
        <select id="contactPoint" name="contactPoint" value={contact} onChange={(event) => setContact(event.target.value)}>
          <option value="class_teacher">Class teacher</option>
          <option value="school_office">School office</option>
          <option value="admissions">Admissions</option>
        </select>
        {contact === "class_teacher" ? (
          <>
            <label htmlFor="teacherUserId">Teacher</label>
            <select id="teacherUserId" name="teacherUserId" required={teachers.length > 0}>
              {teachers.length === 0 ? (
                <option value="">Assigned class teacher</option>
              ) : teachers.length === 1 ? (
                <option value={teachers[0]!.userId}>{teachers[0]!.fullName}</option>
              ) : (
                <>
                  <option value="">Select an assigned teacher</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.userId} value={teacher.userId}>
                      {teacher.fullName}
                    </option>
                  ))}
                </>
              )}
            </select>
          </>
        ) : null}
        <label htmlFor="subject">Subject</label>
        <input id="subject" name="subject" required maxLength={200} />
        <label htmlFor="body">Message</label>
        <textarea id="body" name="body" rows={6} required maxLength={8000} />
        <button type="submit">Send</button>
      </form>
    </>
  );
}
