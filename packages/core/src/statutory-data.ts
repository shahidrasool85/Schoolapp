import type pg from "pg";
import { STATUTORY_CODE_SET_VERSION } from "@schoolapp/domain";
import {
  buildStatutoryCodeLookup,
  type StatutoryCode,
  type StatutoryCodeLookup,
} from "./statutory-codes.js";
import {
  CENSUS_SNAPSHOT_SCHEMA_VERSION,
  fsmEligibleOnDate,
  splitLegalName,
  type PupilStatutoryRecord,
  type SchoolStatutoryRecord,
} from "./statutory.js";
import { isOnRollOnDate } from "./on-roll.js";

const SCHOOL_SQL = `
  select
    coalesce(osp.statutory_name, o.legal_name, o.name) as statutory_name,
    osp.establishment_number,
    osp.local_authority_number,
    osp.urn,
    osp.school_phase,
    osp.establishment_type,
    osp.establishment_status,
    osp.address_line1,
    osp.address_town,
    osp.address_postcode,
    coalesce(osp.timezone, o.timezone) as timezone,
    (select count(*)::int from attendance_session_types ast
      where ast.organisation_id = o.id and ast.is_active) as active_session_count,
    (select count(*)::int from attendance_codes ac
      where ac.organisation_id = o.id and ac.statutory_category is null) as unmapped_code_count
  from organisations o
  left join organisation_statutory_profiles osp on osp.organisation_id = o.id
  where o.id = $1
`;

const PUPIL_SQL = `
  select
    sp.id as student_profile_id,
    sp.legal_name,
    u.preferred_name,
    u.date_of_birth::text as date_of_birth,
    sp.admission_number,
    sp.enrolment_status,
    ssp.legal_surname,
    ssp.legal_forename,
    ssp.middle_names,
    ssp.sex,
    ssp.upn,
    ssp.former_upn,
    ssp.ethnicity_code,
    ssp.language_code,
    ssp.enrolment_status_code,
    ssp.date_of_admission::text as date_of_admission,
    ssp.date_of_leaving::text as date_of_leaving,
    ssp.leaving_reason_code,
    ssp.previous_school_name,
    ssp.send_provision_code,
    ssp.looked_after_status,
    ssp.service_child,
    san.send_notes,
    yg.id as year_group_id,
    yg.code as year_group_code,
    yg.name as year_group_name,
    form.id as class_id,
    form.name as class_name,
    se.academic_year_id
  from student_profiles sp
  join users u on u.id = sp.user_id
  left join student_statutory_profiles ssp
    on ssp.student_profile_id = sp.id and ssp.organisation_id = sp.organisation_id
  left join student_additional_needs san
    on san.student_profile_id = sp.id and san.organisation_id = sp.organisation_id
  left join lateral (
    select se.academic_year_id, se.year_group_id
    from student_enrolments se
    where se.student_profile_id = sp.id
      and se.organisation_id = sp.organisation_id
      and se.is_primary
    order by se.ended_on is null desc, se.started_on desc
    limit 1
  ) se on true
  left join year_groups yg on yg.id = se.year_group_id
  left join lateral (
    select c.id, c.name
    from class_memberships cm
    join classes c on c.id = cm.class_id
    where cm.student_profile_id = sp.id
      and cm.organisation_id = sp.organisation_id
      and c.class_type = 'form'
    order by cm.ended_on is null desc, cm.started_on desc
    limit 1
  ) form on true
  where sp.organisation_id = $1
    and ($2::uuid is null or sp.id = $2)
  order by sp.legal_name
`;

type PupilRow = {
  student_profile_id: string;
  legal_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  admission_number: string | null;
  enrolment_status: string;
  legal_surname: string | null;
  legal_forename: string | null;
  middle_names: string | null;
  sex: string | null;
  upn: string | null;
  former_upn: string | null;
  ethnicity_code: string | null;
  language_code: string | null;
  enrolment_status_code: string | null;
  date_of_admission: string | null;
  date_of_leaving: string | null;
  leaving_reason_code: string | null;
  previous_school_name: string | null;
  send_provision_code: string | null;
  looked_after_status: string | null;
  service_child: boolean | null;
  send_notes: string | null;
  year_group_id: string | null;
  year_group_code: string | null;
  year_group_name: string | null;
  class_id: string | null;
  class_name: string | null;
  academic_year_id: string | null;
};

export async function loadStatutoryCodeLookup(
  client: pg.PoolClient,
  version = STATUTORY_CODE_SET_VERSION,
): Promise<StatutoryCodeLookup> {
  const result = await client.query<StatutoryCode>(
    `select s.catalogue, c.code, c.name, c.sort_order as "sortOrder"
     from statutory_codes c
     join statutory_code_sets s on s.id = c.code_set_id
     where s.version = $1 and c.is_active
     order by s.catalogue, c.sort_order, c.code`,
    [version],
  );
  return buildStatutoryCodeLookup(result.rows, version);
}

export async function loadSchoolStatutoryRecord(
  client: pg.PoolClient,
  organisationId: string,
): Promise<SchoolStatutoryRecord & { activeSessionCount: number; unmappedCodeCount: number }> {
  const result = await client.query<{
    statutory_name: string | null;
    establishment_number: string | null;
    local_authority_number: string | null;
    urn: string | null;
    school_phase: string | null;
    establishment_type: string | null;
    establishment_status: string | null;
    address_line1: string | null;
    address_town: string | null;
    address_postcode: string | null;
    timezone: string | null;
    active_session_count: number;
    unmapped_code_count: number;
  }>(SCHOOL_SQL, [organisationId]);
  const row = result.rows[0];
  if (!row) {
    return {
      establishmentNumber: null,
      localAuthorityNumber: null,
      urn: null,
      statutoryName: null,
      schoolPhase: null,
      establishmentType: null,
      establishmentStatus: null,
      addressLine1: null,
      addressTown: null,
      addressPostcode: null,
      timezone: null,
      activeSessionCount: 0,
      unmappedCodeCount: 0,
    };
  }
  return {
    establishmentNumber: row.establishment_number,
    localAuthorityNumber: row.local_authority_number,
    urn: row.urn,
    statutoryName: row.statutory_name,
    schoolPhase: row.school_phase,
    establishmentType: row.establishment_type,
    establishmentStatus: row.establishment_status,
    addressLine1: row.address_line1,
    addressTown: row.address_town,
    addressPostcode: row.address_postcode,
    timezone: row.timezone,
    activeSessionCount: Number(row.active_session_count ?? 0),
    unmappedCodeCount: Number(row.unmapped_code_count ?? 0),
  };
}

async function attachEnrolmentsAndFsm(
  client: pg.PoolClient,
  organisationId: string,
  pupils: PupilStatutoryRecord[],
): Promise<PupilStatutoryRecord[]> {
  if (pupils.length === 0) return pupils;
  const ids = pupils.map((row) => row.studentProfileId);
  const enrolments = await client.query<{
    student_profile_id: string;
    started_on: string;
    ended_on: string | null;
    is_primary: boolean;
    year_group_id: string;
    academic_year_id: string;
  }>(
    `select student_profile_id, started_on::text, ended_on::text, is_primary, year_group_id, academic_year_id
     from student_enrolments
     where organisation_id = $1 and student_profile_id = any($2::uuid[])
     order by is_primary desc, started_on`,
    [organisationId, ids],
  );
  const fsm = await client.query<{
    student_profile_id: string;
    started_on: string;
    ended_on: string | null;
  }>(
    `select student_profile_id, started_on::text, ended_on::text
     from student_fsm_periods
     where organisation_id = $1 and student_profile_id = any($2::uuid[])
     order by started_on`,
    [organisationId, ids],
  );
  const byEnrolment = new Map<string, PupilStatutoryRecord["enrolments"]>();
  for (const row of enrolments.rows) {
    const list = byEnrolment.get(row.student_profile_id) ?? [];
    list.push({
      startedOn: row.started_on,
      endedOn: row.ended_on,
      isPrimary: row.is_primary,
      yearGroupId: row.year_group_id,
      academicYearId: row.academic_year_id,
    });
    byEnrolment.set(row.student_profile_id, list);
  }
  const byFsm = new Map<string, PupilStatutoryRecord["fsmPeriods"]>();
  for (const row of fsm.rows) {
    const list = byFsm.get(row.student_profile_id) ?? [];
    list.push({ startedOn: row.started_on, endedOn: row.ended_on });
    byFsm.set(row.student_profile_id, list);
  }
  return pupils.map((pupil) => {
    const enrolments = byEnrolment.get(pupil.studentProfileId) ?? pupil.enrolments;
    const primary = enrolments.find((row) => row.isPrimary) ?? enrolments[0];
    return {
      ...pupil,
      dateOfAdmission: pupil.dateOfAdmission ?? primary?.startedOn ?? null,
      dateOfLeaving: pupil.dateOfLeaving ?? primary?.endedOn ?? null,
      enrolments,
      fsmPeriods: byFsm.get(pupil.studentProfileId) ?? [],
    };
  });
}

function mapPupilRow(row: PupilRow): PupilStatutoryRecord {
  const split = splitLegalName(row.legal_name);
  return {
    studentProfileId: row.student_profile_id,
    legalName: row.legal_name,
    preferredName: row.preferred_name,
    legalSurname: row.legal_surname ?? split.legalSurname,
    legalForename: row.legal_forename ?? split.legalForename,
    middleNames: row.middle_names ?? split.middleNames,
    dateOfBirth: row.date_of_birth,
    sex: row.sex,
    upn: row.upn,
    formerUpn: row.former_upn,
    ethnicityCode: row.ethnicity_code,
    languageCode: row.language_code,
    enrolmentStatus: row.enrolment_status,
    enrolmentStatusCode: row.enrolment_status_code,
    admissionNumber: row.admission_number,
    dateOfAdmission: row.date_of_admission,
    dateOfLeaving: row.date_of_leaving,
    leavingReasonCode: row.leaving_reason_code,
    previousSchoolName: row.previous_school_name,
    yearGroupId: row.year_group_id,
    yearGroupCode: row.year_group_code,
    yearGroupName: row.year_group_name,
    classId: row.class_id,
    className: row.class_name,
    academicYearId: row.academic_year_id,
    sendProvisionCode: row.send_provision_code,
    sendNotes: row.send_notes,
    lookedAfterStatus: row.looked_after_status ?? "none",
    serviceChild: row.service_child,
    fsmPeriods: [],
    enrolments: [],
  };
}

export async function loadLiveStatutoryPupils(
  client: pg.PoolClient,
  organisationId: string,
  studentProfileId?: string | null,
): Promise<PupilStatutoryRecord[]> {
  const result = await client.query<PupilRow>(PUPIL_SQL, [organisationId, studentProfileId ?? null]);
  return attachEnrolmentsAndFsm(client, organisationId, result.rows.map(mapPupilRow));
}

export function pupilToSnapshotRow(pupil: PupilStatutoryRecord, asOf: string) {
  const onRoll = isOnRollOnDate(
    {
      enrolmentStatus: pupil.enrolmentStatus,
      dateOfAdmission: pupil.dateOfAdmission,
      dateOfLeaving: pupil.dateOfLeaving,
      enrolments: pupil.enrolments,
    },
    asOf,
  );
  return {
    studentProfileId: pupil.studentProfileId,
    admissionNumber: pupil.admissionNumber,
    upn: pupil.upn,
    formerUpn: pupil.formerUpn,
    legalSurname: pupil.legalSurname,
    legalForename: pupil.legalForename,
    middleNames: pupil.middleNames,
    preferredName: pupil.preferredName,
    dateOfBirth: pupil.dateOfBirth,
    sex: pupil.sex,
    ethnicityCode: pupil.ethnicityCode,
    languageCode: pupil.languageCode,
    enrolmentStatusCode: pupil.enrolmentStatusCode,
    yearGroupCode: pupil.yearGroupCode,
    className: pupil.className,
    dateOfAdmission: pupil.dateOfAdmission,
    dateOfLeaving: pupil.dateOfLeaving,
    leavingReasonCode: pupil.leavingReasonCode,
    sendProvisionCode: pupil.sendProvisionCode,
    fsmEligible: fsmEligibleOnDate(pupil.fsmPeriods, asOf),
    lookedAfterStatus: pupil.lookedAfterStatus,
    serviceChild: pupil.serviceChild,
    onRoll,
    payload: {
      schemaVersion: CENSUS_SNAPSHOT_SCHEMA_VERSION,
      enrolmentStatus: pupil.enrolmentStatus,
      yearGroupName: pupil.yearGroupName,
      fsmPeriods: pupil.fsmPeriods,
      enrolments: pupil.enrolments.map((row) => ({
        startedOn: row.startedOn,
        endedOn: row.endedOn,
        isPrimary: row.isPrimary,
      })),
    },
  };
}

export async function loadSnapshotPupils(
  client: pg.PoolClient,
  organisationId: string,
  censusRunId: string,
  snapshotVersion: number,
): Promise<PupilStatutoryRecord[]> {
  const result = await client.query<{
    student_profile_id: string;
    admission_number: string | null;
    upn: string | null;
    former_upn: string | null;
    legal_surname: string | null;
    legal_forename: string | null;
    middle_names: string | null;
    preferred_name: string | null;
    date_of_birth: string | null;
    sex: string | null;
    ethnicity_code: string | null;
    language_code: string | null;
    enrolment_status_code: string | null;
    year_group_code: string | null;
    class_name: string | null;
    date_of_admission: string | null;
    date_of_leaving: string | null;
    leaving_reason_code: string | null;
    send_provision_code: string | null;
    looked_after_status: string | null;
    service_child: boolean | null;
    payload: {
      enrolmentStatus?: string;
      yearGroupName?: string | null;
      fsmPeriods?: PupilStatutoryRecord["fsmPeriods"];
      enrolments?: Array<{ startedOn: string; endedOn: string | null; isPrimary: boolean }>;
    };
  }>(
    `select student_profile_id, admission_number, upn, former_upn, legal_surname, legal_forename,
            middle_names, preferred_name, date_of_birth::text, sex, ethnicity_code, language_code,
            enrolment_status_code, year_group_code, class_name, date_of_admission::text,
            date_of_leaving::text, leaving_reason_code, send_provision_code, looked_after_status,
            service_child, payload
     from census_snapshot_pupils
     where organisation_id = $1 and census_run_id = $2 and snapshot_version = $3
     order by legal_surname, legal_forename`,
    [organisationId, censusRunId, snapshotVersion],
  );
  return result.rows.map((row) => ({
    studentProfileId: row.student_profile_id,
    legalName: [row.legal_forename, row.legal_surname].filter(Boolean).join(" "),
    preferredName: row.preferred_name,
    legalSurname: row.legal_surname,
    legalForename: row.legal_forename,
    middleNames: row.middle_names,
    dateOfBirth: row.date_of_birth,
    sex: row.sex,
    upn: row.upn,
    formerUpn: row.former_upn,
    ethnicityCode: row.ethnicity_code,
    languageCode: row.language_code,
    enrolmentStatus: row.payload?.enrolmentStatus ?? "enrolled",
    enrolmentStatusCode: row.enrolment_status_code,
    admissionNumber: row.admission_number,
    dateOfAdmission: row.date_of_admission,
    dateOfLeaving: row.date_of_leaving,
    leavingReasonCode: row.leaving_reason_code,
    previousSchoolName: null,
    yearGroupId: null,
    yearGroupCode: row.year_group_code,
    yearGroupName: row.payload?.yearGroupName ?? null,
    classId: null,
    className: row.class_name,
    academicYearId: null,
    sendProvisionCode: row.send_provision_code,
    sendNotes: null,
    lookedAfterStatus: row.looked_after_status,
    serviceChild: row.service_child,
    fsmPeriods: row.payload?.fsmPeriods ?? [],
    enrolments: (row.payload?.enrolments ?? []).map((enrolment) => ({
      startedOn: enrolment.startedOn,
      endedOn: enrolment.endedOn,
      isPrimary: enrolment.isPrimary,
      yearGroupId: "",
      academicYearId: "",
    })),
  }));
}

export async function loadSnapshotSchool(
  client: pg.PoolClient,
  organisationId: string,
  censusRunId: string,
  snapshotVersion: number,
): Promise<SchoolStatutoryRecord | null> {
  const result = await client.query<{
    statutory_name: string | null;
    establishment_number: string | null;
    local_authority_number: string | null;
    urn: string | null;
    school_phase: string | null;
    establishment_type: string | null;
    establishment_status: string | null;
    address_line1: string | null;
    address_town: string | null;
    address_postcode: string | null;
    timezone: string | null;
  }>(
    `select statutory_name, establishment_number, local_authority_number, urn, school_phase,
            establishment_type, establishment_status, address_line1, address_town, address_postcode, timezone
     from census_snapshot_schools
     where organisation_id = $1 and census_run_id = $2 and snapshot_version = $3`,
    [organisationId, censusRunId, snapshotVersion],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    statutoryName: row.statutory_name,
    establishmentNumber: row.establishment_number,
    localAuthorityNumber: row.local_authority_number,
    urn: row.urn,
    schoolPhase: row.school_phase,
    establishmentType: row.establishment_type,
    establishmentStatus: row.establishment_status,
    addressLine1: row.address_line1,
    addressTown: row.address_town,
    addressPostcode: row.address_postcode,
    timezone: row.timezone,
  };
}
