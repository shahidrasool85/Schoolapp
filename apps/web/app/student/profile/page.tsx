"use client";

import { useEffect, useState } from "react";
import { api, downloadAuthenticated } from "../../../lib/api";
import type { PortalChild } from "../../../lib/portal";

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

  if (error) return <p className="error">{error}</p>;
  if (!student) return <p>Loading…</p>;

  return (
    <>
      <h1>My profile</h1>
      <div className="card">
        <dl className="profile-list">
          <div>
            <dt>Name</dt>
            <dd>{student.displayName}</dd>
          </div>
          <div>
            <dt>Legal name</dt>
            <dd>{student.legalName}</dd>
          </div>
          <div>
            <dt>School</dt>
            <dd>{student.school.name}</dd>
          </div>
          <div>
            <dt>Academic year</dt>
            <dd>{student.currentAcademicYearName ?? "—"}</dd>
          </div>
          <div>
            <dt>Year group</dt>
            <dd>{student.currentYearGroupName ?? "—"}</dd>
          </div>
          <div>
            <dt>Class / form</dt>
            <dd>{student.currentFormClassName ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <h2>Documents</h2>
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
    </>
  );
}
