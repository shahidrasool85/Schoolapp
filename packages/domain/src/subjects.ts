export const SUBJECT_KEY_MAX_LENGTH = 64;
export const SUBJECT_NAME_MAX_LENGTH = 80;
export const SUBJECT_KEY_PATTERN = /^[a-z0-9-]+$/;

export const SUBJECT_KEY_HINT =
  "Letters, numbers, and hyphens. Stored in lowercase — Eng becomes eng.";

export type SubjectField = "name" | "key";

export type SubjectCreateInput =
  | { ok: true; name: string; key: string }
  | { ok: false; field: SubjectField; error: string };

function collapseDerivedKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSubjectKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateSubjectKey(raw: string): { ok: true; key: string } | { ok: false; error: string } {
  const key = normalizeSubjectKey(raw);
  if (!key) return { ok: false, error: "Enter a subject key." };
  if (key.length > SUBJECT_KEY_MAX_LENGTH) {
    return { ok: false, error: `Subject key must be ${SUBJECT_KEY_MAX_LENGTH} characters or fewer.` };
  }
  if (!SUBJECT_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      error: "Subject key may only use letters, numbers, and hyphens.",
    };
  }
  return { ok: true, key };
}

export function parseSubjectCreateInput(input: { name?: unknown; key?: unknown }): SubjectCreateInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, field: "name", error: "Enter a subject name." };
  if (name.length > SUBJECT_NAME_MAX_LENGTH) {
    return { ok: false, field: "name", error: `Subject name must be ${SUBJECT_NAME_MAX_LENGTH} characters or fewer.` };
  }

  const typedKey = typeof input.key === "string" ? input.key : "";
  const rawKey = typedKey.trim() ? typedKey : collapseDerivedKey(name);
  const parsed = validateSubjectKey(rawKey);
  if (!parsed.ok) {
    return {
      ok: false,
      field: "key",
      error: typedKey.trim() ? parsed.error : "Enter a subject key using letters, numbers, or hyphens.",
    };
  }
  return { ok: true, name, key: parsed.key };
}
