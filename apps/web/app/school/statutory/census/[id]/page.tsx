"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Alert,
  ConfirmationDialog,
  DataTable,
  EmptyState,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { usePermissions } from "../../../../../lib/use-permissions";

type CensusDetail = {
  censusRun: {
    id: string;
    academicYearName: string | null;
    censusType: string;
    censusDate: string;
    status: string;
    currentSnapshotVersion: number;
    errorCount: number;
    warningCount: number;
    informationCount: number;
  };
  pupils: Array<{
    studentProfileId: string;
    legalName: string;
    upn: string | null;
    yearGroupCode: string | null;
    onRoll: boolean;
  }>;
  issues: Array<{ severity: string; message: string; entityId: string | null }>;
};

export default function CensusDetailPage() {
  const params = useParams<{ id: string }>();
  const permissions = usePermissions();
  const [data, setData] = useState<CensusDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"finalise" | "export" | null>(null);

  async function load() {
    const result = await api<CensusDetail>(`/api/v1/statutory/census/${params.id}`);
    setData(result);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load census run.")));
  }, [params.id]);

  async function snapshot() {
    setError("");
    setMessage("");
    try {
      const result = await api<{ snapshotVersion: number; pupilCount: number }>(
        `/api/v1/statutory/census/${params.id}/snapshot`,
        { method: "POST" },
      );
      await load();
      setMessage(`Snapshot v${result.snapshotVersion} stored ${result.pupilCount} pupils.`);
    } catch (err) {
      setError(userFacingError(err, "Could not generate snapshot."));
    }
  }

  async function validate() {
    setError("");
    setMessage("");
    try {
      const result = await api<{ counts: { errorCount: number; warningCount: number } }>(
        `/api/v1/statutory/census/${params.id}/validate`,
        { method: "POST" },
      );
      await load();
      setMessage(`Snapshot validation: ${result.counts.errorCount} errors, ${result.counts.warningCount} warnings.`);
    } catch (err) {
      setError(userFacingError(err, "Could not validate snapshot."));
    }
  }

  async function finalise() {
    setConfirm(null);
    try {
      await api(`/api/v1/statutory/census/${params.id}/finalise`, { method: "POST" });
      await load();
      setMessage("Census marked ready for export.");
    } catch (err) {
      setError(userFacingError(err, "Could not finalise census."));
    }
  }

  async function exportCsv() {
    setConfirm(null);
    try {
      await downloadAuthenticated(
        `/api/v1/statutory/census/${params.id}/export?format=csv`,
        `census-${params.id}.csv`,
      );
      await load();
      setMessage("Census snapshot CSV downloaded from stored snapshot values.");
    } catch (err) {
      setError(userFacingError(err, "Could not export census."));
    }
  }

  async function exportXml() {
    setError("");
    setMessage("");
    try {
      await downloadAuthenticated(
        `/api/v1/statutory/census/${params.id}/export?format=xml`,
        `census-preview-${params.id}.xml`,
      );
      await load();
      setMessage("Census-ready XML preview downloaded from stored snapshot values. Not a DfE-approved submission.");
    } catch (err) {
      setError(userFacingError(err, "Could not export XML preview."));
    }
  }

  if (error && !data) return <PageError title="Census run unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading census snapshot…" />;

  return (
    <>
      <PageHeader
        title={`${data.censusRun.censusType} census`}
        description={`Census date ${String(data.censusRun.censusDate).slice(0, 10)}. Snapshot values are stored separately from live pupil records.`}
        breadcrumbs={[
          { href: "/school/statutory", label: "Statutory data" },
          { href: "/school/statutory/census", label: "Census" },
          { label: String(data.censusRun.censusDate).slice(0, 10) },
        ]}
        actions={
          <>
            {permissions.has("statutory.census.create") ? (
              <button className="button secondary" type="button" onClick={() => void snapshot()}>
                Generate snapshot
              </button>
            ) : null}
            {permissions.has("statutory.validate") || permissions.has("statutory.manage") ? (
              <button className="button secondary" type="button" onClick={() => void validate()}>
                Validate snapshot
              </button>
            ) : null}
            {permissions.has("statutory.census.finalise") ? (
              <button className="button" type="button" onClick={() => setConfirm("finalise")}>
                Finalise
              </button>
            ) : null}
            {permissions.has("statutory.census.export") ? (
              <>
                <button className="button secondary" type="button" onClick={() => setConfirm("export")}>
                  Export CSV
                </button>
                <button className="button secondary" type="button" onClick={() => void exportXml()}>
                  Export XML preview
                </button>
              </>
            ) : null}
          </>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <div className="stat-grid">
        <div className="stat-card"><span>Status</span><strong><StatusBadge status={data.censusRun.status} /></strong></div>
        <div className="stat-card"><span>Snapshot version</span><strong>{data.censusRun.currentSnapshotVersion}</strong></div>
        <div className="stat-card"><span>Errors</span><strong>{data.censusRun.errorCount}</strong></div>
        <div className="stat-card"><span>Pupils in snapshot</span><strong>{data.pupils.length}</strong></div>
      </div>
      <SectionCard title="Snapshot validation">
        {data.issues.length === 0 ? (
          <EmptyState title="No stored snapshot issues" description="Generate and validate a snapshot to see results." />
        ) : (
          <DataTable
            headers={
              <>
                <th>Severity</th>
                <th>Message</th>
              </>
            }
          >
            {data.issues.slice(0, 50).map((issue, index) => (
              <tr key={`${issue.message}-${index}`}>
                <td><StatusBadge status={issue.severity} /></td>
                <td>{issue.message}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
      <SectionCard title="Snapshot pupils">
        {data.pupils.length === 0 ? (
          <EmptyState title="No snapshot yet" description="Generate a snapshot to freeze census-relevant values." />
        ) : (
          <DataTable
            headers={
              <>
                <th>Pupil</th>
                <th>UPN</th>
                <th>Year</th>
                <th>On roll</th>
              </>
            }
          >
            {data.pupils.map((pupil) => (
              <tr key={pupil.studentProfileId}>
                <td>{pupil.legalName}</td>
                <td>{pupil.upn ?? "—"}</td>
                <td>{pupil.yearGroupCode ?? "—"}</td>
                <td>{pupil.onRoll ? "Yes" : "No"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
      <ConfirmationDialog
        open={confirm === "finalise"}
        title="Finalise this census snapshot?"
        description="Ready snapshots can be exported. Exported history is not silently rewritten."
        confirmLabel="Finalise"
        onConfirm={() => void finalise()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmationDialog
        open={confirm === "export"}
        title="Export census snapshot CSV?"
        description="The file is generated from the stored snapshot, not from today's live records. This is a census-ready export, not a DfE-approved submission."
        confirmLabel="Export"
        onConfirm={() => void exportCsv()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
