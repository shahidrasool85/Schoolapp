import { preventCsvInjection, toCsv } from "./statutory-export.js";
import {
  mapImportedStaffRole,
  type ImportKind,
  type ImportableStaffRoleKey,
} from "@schoolapp/domain";

export type ImportIssue = {
  field: string;
  message: string;
  code: string;
};

export type ImportRowPreview = {
  rowNumber: number;
  payload: Record<string, string>;
  status: "valid" | "error" | "duplicate";
  issues: ImportIssue[];
  match?: { kind: string; id?: string; label: string } | null;
};

const STAFF_HEADERS = ["full_name", "email", "job_title", "role"] as const;
const PUPIL_HEADERS = [
  "legal_name",
  "preferred_name",
  "date_of_birth",
  "admission_number",
  "academic_year",
  "year_group",
  "form_class",
  "address_line1",
  "address_town",
  "address_postcode",
  "fee_schedule",
  "sibling_priority",
  "concession_note",
] as const;
const GUARDIAN_HEADERS = [
  "admission_number",
  "pupil_legal_name",
  "guardian_name",
  "email",
  "relationship",
  "parental_responsibility",
] as const;

export const IMPORT_TEMPLATES: Record<ImportKind, readonly string[]> = {
  staff: STAFF_HEADERS,
  pupils: PUPIL_HEADERS,
  guardians: GUARDIAN_HEADERS,
};

export function importTemplateCsv(kind: ImportKind): string {
  const headers = IMPORT_TEMPLATES[kind];
  const example =
    kind === "staff"
      ? [["Alex Teacher", "alex.teacher@school.example", "Class teacher", "teacher"]]
      : kind === "pupils"
        ? [
            [
              "Jordan Smith",
              "Jordan",
              "2016-04-12",
              "ADM1001",
              "2026/27",
              "3",
              "3A",
              "1 High Street",
              "London",
              "SW1A 1AA",
              "",
              "",
              "",
            ],
          ]
        : [["ADM1001", "Jordan Smith", "Sam Smith", "sam.smith@family.example", "mother", "true"]];
  return toCsv(headers, example);
}

export function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const normalised = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < normalised.length; i += 1) {
    const ch = normalised[i]!;
    if (ch === '"') {
      if (inQuotes && normalised[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += '"';
      }
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || normalised.endsWith("\n")) lines.push(current);
  const parsed = lines
    .map((line) => splitCsvLine(line))
    .filter((cols, index) => index === 0 || cols.some((col) => col.trim().length > 0));
  const headers = (parsed[0] ?? []).map((header) => header.trim().toLowerCase().replace(/\s+/g, "_"));
  return { headers, rows: parsed.slice(1) };
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cols.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cols.push(current);
  return cols;
}

export function rowToRecord(headers: string[], cols: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = (cols[index] ?? "").trim();
  });
  return record;
}

export function validateStaffImportRow(record: Record<string, string>): {
  issues: ImportIssue[];
  roleKey: ImportableStaffRoleKey | null;
} {
  const issues: ImportIssue[] = [];
  if (!record.full_name) issues.push({ field: "full_name", message: "Full name is required", code: "required" });
  if (!record.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    issues.push({ field: "email", message: "A valid email is required", code: "invalid_email" });
  }
  const roleKey = mapImportedStaffRole(record.role || "teacher");
  if (!roleKey) {
    issues.push({
      field: "role",
      message: "This role cannot be assigned through import",
      code: "role_not_importable",
    });
  }
  return { issues, roleKey };
}

export function validatePupilImportRow(record: Record<string, string>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!record.legal_name) issues.push({ field: "legal_name", message: "Legal name is required", code: "required" });
  if (record.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(record.date_of_birth)) {
    issues.push({ field: "date_of_birth", message: "Date of birth must be YYYY-MM-DD", code: "invalid_date" });
  }
  return issues;
}

export function validateGuardianImportRow(record: Record<string, string>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!record.guardian_name) {
    issues.push({ field: "guardian_name", message: "Guardian name is required", code: "required" });
  }
  if (!record.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    issues.push({ field: "email", message: "A valid email is required", code: "invalid_email" });
  }
  if (!record.admission_number && !record.pupil_legal_name) {
    issues.push({
      field: "admission_number",
      message: "Admission number or pupil legal name is required",
      code: "required",
    });
  }
  return issues;
}

export function csvFormulaSafe(value: string): string {
  return preventCsvInjection(value);
}
