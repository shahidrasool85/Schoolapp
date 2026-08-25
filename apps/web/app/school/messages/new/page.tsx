"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";

type Student = { id: string; legalName: string };
type Parent = { userId: string; fullName: string };

export default function NewStaffConversationPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [error, setError] = useState("");
  const [type, setType] = useState("parent_teacher");

  useEffect(() => {
    api<{ students: Student[] }>("/api/v1/students")
      .then((body) => setStudents(body.students))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function loadParents(studentId: string) {
    if (!studentId) {
      setParents([]);
      return;
    }
    const body = await api<{ parents: Parent[] }>(`/api/v1/messages/pupils/${studentId}/recipients`);
    setParents(body.parents);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const conversationType = String(form.get("conversationType"));
    const relatedPupilId = String(form.get("relatedPupilId") || "") || null;
    const parentUserId = String(form.get("parentUserId") || "") || null;
    try {
      const created = await api<{ conversation: { id: string } }>("/api/v1/messages/conversations", {
        method: "POST",
        body: JSON.stringify({
          conversationType,
          subject: String(form.get("subject") || ""),
          relatedPupilId,
          parentUserIds: parentUserId ? [parentUserId] : conversationType === "staff_internal" ? [] : undefined,
          staffUserIds: [],
          body: String(form.get("body") || ""),
        }),
      });
      router.push(`/school/messages/${created.conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the conversation");
    }
  }

  return (
    <>
      <h1>New conversation</h1>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form onSubmit={submit}>
        <label htmlFor="conversationType">Conversation type</label>
        <select
          id="conversationType"
          name="conversationType"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="parent_teacher">Parent / teacher</option>
          <option value="parent_school">School office</option>
          <option value="admissions">Admissions</option>
          <option value="staff_internal">Staff internal</option>
        </select>
        {type !== "staff_internal" ? (
          <>
            <label htmlFor="relatedPupilId">Pupil</label>
            <select
              id="relatedPupilId"
              name="relatedPupilId"
              required={type === "parent_teacher"}
              onChange={(event) => loadParents(event.target.value).catch((err: Error) => setError(err.message))}
            >
              <option value="">Select a pupil</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.legalName}
                </option>
              ))}
            </select>
            <label htmlFor="parentUserId">Parent / guardian</label>
            <select id="parentUserId" name="parentUserId" required={type !== "staff_internal"}>
              <option value="">Select a parent</option>
              {parents.map((parent) => (
                <option key={parent.userId} value={parent.userId}>
                  {parent.fullName}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label htmlFor="subject">Subject</label>
        <input id="subject" name="subject" required maxLength={200} />
        <label htmlFor="body">Message</label>
        <textarea id="body" name="body" rows={6} required maxLength={8000} />
        <button type="submit">Start conversation</button>
      </form>
    </>
  );
}
