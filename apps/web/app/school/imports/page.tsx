"use client";

import { FormEvent, useState } from "react";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FormField,
  PageHeader,
  SectionCard,
  Select,
  StatusBadge,
  Textarea,
} from "../../../components/ui";
import { api, downloadAuthenticated } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type ImportKind = "staff" | "pupils" | "guardians";

type PreviewRow = {
  rowNumber: number;
  payload: Record<string, string>;
  status: string;
  issues: Array<{ field: string; message: string }>;
  match: { kind: string; label: string } | null;
};

type Preview = {
  importId: string;
  kind: ImportKind;
  headers: string[];
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  rows: PreviewRow[];
};

type Report = {
  imported: number;
  skipped: number;
  failed: number;
  report: Array<{ rowNumber: number; status: string; detail?: string }>;
};

export default function ImportsPage() {
  const [kind, setKind] = useState<ImportKind>("pupils");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function downloadTemplate() {
    setError("");
    try {
      await downloadAuthenticated(`/api/v1/imports/templates/${kind}`, `${kind}-import-template.csv`);
    } catch (err) {
      setError(userFacingError(err, "Could not download template."));
    }
  }

  async function parse(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const body = await api<Preview>(`/api/v1/imports/${kind}`, {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setPreview(body);
    } catch (err) {
      setError(userFacingError(err, "Could not parse CSV."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const body = await api<Report>(`/api/v1/imports/${preview.importId}/confirm`, { method: "POST" });
      setReport(body);
    } catch (err) {
      setError(userFacingError(err, "Could not confirm import."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Bulk import"
        description="Upload, preview, and confirm staff, pupil, or guardian CSVs. Duplicates are flagged, not merged. Admin roles cannot be imported."
      />
      <SectionCard title="1. Upload">
        <form className="form-grid" onSubmit={parse}>
          <FormField label="Import type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
              <option value="pupils">Pupils</option>
              <option value="staff">Staff</option>
              <option value="guardians">Guardians</option>
            </Select>
          </FormField>
          <div>
            <Button type="button" variant="secondary" onClick={downloadTemplate}>
              Download template
            </Button>
          </div>
          <FormField label="CSV">
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              placeholder="Paste CSV text, including the header row."
              required
            />
          </FormField>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Preview and validate"}
            </Button>
          </div>
        </form>
      </SectionCard>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {preview ? (
        <SectionCard
          title="2. Preview"
          description={`${preview.validCount} valid · ${preview.duplicateCount} possible duplicates · ${preview.errorCount} errors`}
        >
          {preview.rows.length === 0 ? (
            <EmptyState title="No rows" description="The CSV had no data rows." />
          ) : (
            <DataTable
              headers={
                <>
                  <th>#</th>
                  <th>Status</th>
                  <th>Record</th>
                  <th>Notes</th>
                </>
              }
            >
              {preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>
                    <StatusBadge status={row.status === "valid" ? "complete" : row.status} />
                  </td>
                  <td>
                    {row.payload.full_name || row.payload.legal_name || row.payload.guardian_name || "—"}
                    {row.match ? <div className="muted">Possible match: {row.match.label}</div> : null}
                  </td>
                  <td>{row.issues.map((issue) => issue.message).join("; ") || "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
          <div style={{ marginTop: "1rem" }}>
            <Button type="button" onClick={confirm} disabled={busy || preview.validCount === 0}>
              Confirm import of {preview.validCount} valid rows
            </Button>
          </div>
        </SectionCard>
      ) : null}
      {report ? (
        <SectionCard title="3. Completion report">
          <p>
            Imported {report.imported}. Skipped {report.skipped}. Failed {report.failed}.
          </p>
          <DataTable
            headers={
              <>
                <th>#</th>
                <th>Status</th>
                <th>Detail</th>
              </>
            }
          >
            {report.report.map((row) => (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>{row.detail ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}
    </>
  );
}
