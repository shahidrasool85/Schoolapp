import type pg from "pg";
import {
  CUSTOM_DATE_OUTSIDE_YEAR,
  NO_TERM_FOR_START,
  NO_TERMS_CONFIGURED,
  OCCURRENCE_COUNT_TOO_FEW,
  START_DATE_OUTSIDE_YEAR,
  customDateLabel,
  endOfAcademicYearLabel,
  endOfTermLabel,
  findTermContainingDate,
  occurrenceCountLabel,
  validateCustomRepeatUntilDate,
  validateOccurrenceCount,
  type RepeatUntilInput,
  type RepeatUntilKind,
} from "@schoolapp/domain";
import { listRecurrenceTeachingDates, loadSchoolClosureDates, loadTermWindows } from "./timetable-access.js";

export type RepeatUntilCalendarTerm = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
};

export type RepeatUntilAcademicYear = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
};

export type ResolvedRepeatUntil = {
  ok: true;
  kind: RepeatUntilKind;
  effectiveUntil: string;
  label: string;
  term: RepeatUntilCalendarTerm | null;
  academicYear: RepeatUntilAcademicYear;
  dates: string[];
};

export type RepeatUntilError = { ok: false; error: string };

type Queryable = Pick<pg.PoolClient, "query">;

export async function loadRepeatUntilAcademicYear(
  client: Queryable,
  organisationId: string,
  academicYearId: string,
): Promise<RepeatUntilAcademicYear | null> {
  const result = await client.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
    `select id, name, starts_on::text, ends_on::text
     from academic_years
     where id = $1 and organisation_id = $2`,
    [academicYearId, organisationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

export async function loadNamedTermWindows(
  client: Queryable,
  organisationId: string,
  academicYearId: string,
): Promise<RepeatUntilCalendarTerm[]> {
  const result = await client.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
    `select id, name, starts_on::text, ends_on::text
     from terms
     where organisation_id = $1 and academic_year_id = $2
     order by starts_on`,
    [organisationId, academicYearId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}

export async function listResolvedRecurrenceDates(
  client: Queryable,
  organisationId: string,
  input: {
    academicYearId: string;
    weekday: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
    termId?: string | null;
  },
): Promise<{ academicYear: RepeatUntilAcademicYear | null; dates: string[] }> {
  const academicYear = await loadRepeatUntilAcademicYear(client, organisationId, input.academicYearId);
  if (!academicYear) return { academicYear: null, dates: [] };
  const terms = await loadTermWindows(client, organisationId, input.academicYearId);
  const searchTo = input.effectiveUntil ?? academicYear.endsOn;
  const closures = await loadSchoolClosureDates(client, organisationId, input.effectiveFrom, searchTo);
  return {
    academicYear,
    dates: listRecurrenceTeachingDates({
      weekday: input.weekday,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      termId: input.termId ?? null,
      terms,
      closures,
      academicYear,
    }),
  };
}

export async function resolveRepeatUntilRule(
  client: Queryable,
  organisationId: string,
  input: {
    academicYearId: string;
    weekday: number;
    effectiveFrom: string;
    termId?: string | null;
    repeatUntil: RepeatUntilInput;
  },
): Promise<ResolvedRepeatUntil | RepeatUntilError> {
  const academicYear = await loadRepeatUntilAcademicYear(client, organisationId, input.academicYearId);
  if (!academicYear) return { ok: false, error: "The selected academic year could not be found." };
  if (input.effectiveFrom < academicYear.startsOn || input.effectiveFrom > academicYear.endsOn) {
    return { ok: false, error: START_DATE_OUTSIDE_YEAR };
  }

  const namedTerms = await loadNamedTermWindows(client, organisationId, input.academicYearId);
  const terms = namedTerms.map((term) => ({ id: term.id, startsOn: term.startsOn, endsOn: term.endsOn }));
  const closures = await loadSchoolClosureDates(
    client,
    organisationId,
    input.effectiveFrom,
    academicYear.endsOn,
  );

  const datesForWindow = (effectiveUntil: string) =>
    listRecurrenceTeachingDates({
      weekday: input.weekday,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil,
      termId: input.termId ?? null,
      terms,
      closures,
      academicYear,
    });

  if (input.repeatUntil.kind === "end_of_term") {
    if (namedTerms.length === 0) {
      return { ok: false, error: NO_TERMS_CONFIGURED };
    }
    const term = findTermContainingDate(input.effectiveFrom, namedTerms);
    if (!term) {
      return { ok: false, error: NO_TERM_FOR_START };
    }
    const dates = datesForWindow(term.endsOn);
    return {
      ok: true,
      kind: "end_of_term",
      effectiveUntil: term.endsOn,
      label: endOfTermLabel(term.name, term.endsOn),
      term,
      academicYear,
      dates,
    };
  }

  if (input.repeatUntil.kind === "end_of_academic_year") {
    const dates = datesForWindow(academicYear.endsOn);
    return {
      ok: true,
      kind: "end_of_academic_year",
      effectiveUntil: academicYear.endsOn,
      label: endOfAcademicYearLabel(academicYear.name, academicYear.endsOn),
      term: findTermContainingDate(input.effectiveFrom, namedTerms),
      academicYear,
      dates,
    };
  }

  if (input.repeatUntil.kind === "custom_date") {
    const valid = validateCustomRepeatUntilDate({
      date: input.repeatUntil.date,
      effectiveFrom: input.effectiveFrom,
      yearStartsOn: academicYear.startsOn,
      yearEndsOn: academicYear.endsOn,
    });
    if (!valid.ok) return valid;
    const dates = datesForWindow(input.repeatUntil.date);
    return {
      ok: true,
      kind: "custom_date",
      effectiveUntil: input.repeatUntil.date,
      label: customDateLabel(input.repeatUntil.date),
      term: findTermContainingDate(input.effectiveFrom, namedTerms),
      academicYear,
      dates,
    };
  }

  const countCheck = validateOccurrenceCount(input.repeatUntil.count);
  if (!countCheck.ok) return countCheck;
  const candidates = datesForWindow(academicYear.endsOn);
  if (candidates.length < input.repeatUntil.count) {
    return {
      ok: false,
      error:
        candidates.length === 0
          ? OCCURRENCE_COUNT_TOO_FEW
          : `Only ${candidates.length} valid teaching date${candidates.length === 1 ? "" : "s"} remain in this academic year.`,
    };
  }
  const dates = candidates.slice(0, input.repeatUntil.count);
  const last = dates[dates.length - 1]!;
  return {
    ok: true,
    kind: "occurrence_count",
    effectiveUntil: last,
    label: occurrenceCountLabel(input.repeatUntil.count, last),
    term: findTermContainingDate(input.effectiveFrom, namedTerms),
    academicYear,
    dates,
  };
}
