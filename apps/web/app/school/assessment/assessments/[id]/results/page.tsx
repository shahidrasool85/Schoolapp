"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../../../lib/api";

type SchemeLevel = { id: string; label: string };
type Pupil = {
  studentProfileId: string;
  legalName: string;
  className: string | null;
  result: {
    rawScore: number | null;
    gradeSchemeLevelId: string | null;
    teacherJudgement: string | null;
    comment: string | null;
    releasedToStudent: boolean;
    releasedToParent: boolean;
    reviewStatus: string;
  } | null;
};

export default function ResultEntryPage() {
  const params = useParams<{ id: string }>();
  const [pupils, setPupils] = useState<Pupil[]>([]);
  const [levels, setLevels] = useState<SchemeLevel[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function load() {
    const [grid, schemes] = await Promise.all([
      api<{ pupils: Pupil[] }>(`/api/v1/assessments/${params.id}/results`),
      api<{ schemes: Array<{ id: string; levels: SchemeLevel[] }> }>("/api/v1/assessments/grade-schemes"),
    ]);
    const detail = await api<{ assessment: { gradeSchemeId: string | null } }>(`/api/v1/assessments/${params.id}`);
    const scheme = schemes.schemes.find((row) => row.id === detail.assessment.gradeSchemeId);
    setLevels(scheme?.levels ?? schemes.schemes.flatMap((row) => row.levels).slice(0, 0));
    setPupils(grid.pupils);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const results = pupils.map((pupil) => ({
      studentProfileId: pupil.studentProfileId,
      rawScore: form.get(`score-${pupil.studentProfileId}`)
        ? Number(form.get(`score-${pupil.studentProfileId}`))
        : null,
      gradeSchemeLevelId: String(form.get(`grade-${pupil.studentProfileId}`) || "") || null,
      teacherJudgement: String(form.get(`judgement-${pupil.studentProfileId}`) || "") || null,
      comment: String(form.get(`comment-${pupil.studentProfileId}`) || "") || null,
      releasedToStudent: form.get(`relS-${pupil.studentProfileId}`) === "on",
      releasedToParent: form.get(`relP-${pupil.studentProfileId}`) === "on",
    })).filter((row) =>
      row.rawScore != null || row.gradeSchemeLevelId || row.teacherJudgement || row.comment,
    );
    try {
      await api(`/api/v1/assessments/${params.id}/results`, {
        method: "PUT",
        body: JSON.stringify({ results }),
      });
      setSaved("Results saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save results");
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Enter results</h1>
      {saved ? <p className="muted">{saved}</p> : null}
      <form onSubmit={onSubmit}>
        <table>
          <thead>
            <tr>
              <th>Pupil</th>
              <th>Score</th>
              <th>Grade / judgement</th>
              <th>Comment</th>
              <th>Student</th>
              <th>Parent</th>
            </tr>
          </thead>
          <tbody>
            {pupils.map((pupil) => (
              <tr key={pupil.studentProfileId}>
                <td>
                  {pupil.legalName}
                  <div className="muted">{pupil.className ?? ""}{pupil.result ? ` · ${pupil.result.reviewStatus}` : " · missing"}</div>
                </td>
                <td>
                  <input
                    name={`score-${pupil.studentProfileId}`}
                    type="number"
                    min="0"
                    step="0.5"
                    defaultValue={pupil.result?.rawScore ?? ""}
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  {levels.length > 0 ? (
                    <select name={`grade-${pupil.studentProfileId}`} defaultValue={pupil.result?.gradeSchemeLevelId ?? ""}>
                      <option value="">—</option>
                      {levels.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
                    </select>
                  ) : (
                    <input
                      name={`judgement-${pupil.studentProfileId}`}
                      defaultValue={pupil.result?.teacherJudgement ?? ""}
                    />
                  )}
                </td>
                <td>
                  <input name={`comment-${pupil.studentProfileId}`} defaultValue={pupil.result?.comment ?? ""} />
                </td>
                <td>
                  <input
                    name={`relS-${pupil.studentProfileId}`}
                    type="checkbox"
                    defaultChecked={pupil.result?.releasedToStudent}
                  />
                </td>
                <td>
                  <input
                    name={`relP-${pupil.studentProfileId}`}
                    type="checkbox"
                    defaultChecked={pupil.result?.releasedToParent}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><button type="submit">Save results</button></p>
      </form>
    </>
  );
}
