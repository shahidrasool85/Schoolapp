"use client";

import { useEffect, useState } from "react";
import { api, downloadAuthenticated } from "../../../lib/api";
import type { PortalChild } from "../../../lib/portal";
import { PageHeader, PersonSummary, SectionCard } from "../../../components/ui";
import { ProfileAvatar } from "../../../components/profile-avatar";
import { ReadOnlyDl } from "../../../components/profile-details-form";

export default function StudentProfilePage() {
  const [student, setStudent] = useState<PortalChild | null>(null);
  const [documents, setDocuments] = useState<
    Array<{ id: string; filename: string; title: string | null; downloadPath: string | null }>
  >([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ student: PortalChild }>("/api/v1/student/me")
      .then((body) => setStudent(body.student))
      .catch((err: Error) => setError(err.message));
    api<{ documents: Array<{ id: string; filename: string; title: string | null; downloadPath: string | null }> }>(
      "/api/v1/student/documents",
    )
      .then((body) => setDocuments(body.documents))
      .catch(() => setDocuments([]));
  }, []);

  if (error && !student) return <p className="error">{error}</p>;
  if (!student) return <p>Loading…</p>;

  return (
    <>
      {error ? <p className="error">{error}</p> : null}
      <PageHeader title="My profile" description="Your official school record. The school manages your photo and details." />
      <PersonSummary
        name={student.displayName}
        photo={<ProfileAvatar name={student.displayName} photoUrl={student.photoUrl} size="lg" />}
        meta={student.currentFormClassName ?? student.currentYearGroupName ?? student.school.name}
      />
      <SectionCard title="School details">
        <ReadOnlyDl
          items={[
            { label: "Name", value: student.displayName },
            { label: "Legal name", value: student.legalName },
            { label: "School", value: student.school.name },
            { label: "Academic year", value: student.currentAcademicYearName },
            { label: "Year group", value: student.currentYearGroupName },
            { label: "Class / form", value: student.currentFormClassName },
          ]}
        />
      </SectionCard>
      <SectionCard title="Documents">
        {documents.length === 0 ? (
          <p className="muted">No documents have been shared with you.</p>
        ) : (
          <ul>
            {documents.map((doc) => (
              <li key={doc.id}>
                {doc.title ?? doc.filename}
                {doc.downloadPath ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        downloadAuthenticated(doc.downloadPath!, doc.filename).catch((err: Error) => setError(err.message))
                      }
                    >
                      Download
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
