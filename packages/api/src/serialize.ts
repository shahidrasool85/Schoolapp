export function mapAcademicYear(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isCurrent: row.is_current,
    createdAt: row.created_at,
  };
}

export function mapYearGroup(row: Record<string, unknown>) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    keyStage: row.key_stage,
    sortOrder: row.sort_order,
    studentLoginEnabled: row.student_login_enabled,
  };
}

export function mapSubject(row: Record<string, unknown>) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
  };
}

export function mapHouse(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
  };
}

export function mapClass(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    classType: row.class_type,
    academicYearId: row.academic_year_id,
    yearGroupId: row.year_group_id,
    yearGroupName: row.year_group_name ?? null,
    academicYearName: row.academic_year_name ?? null,
  };
}

export function mapTerm(row: Record<string, unknown>) {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    key: row.key,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    sortOrder: row.sort_order,
  };
}

export function mapStaff(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    jobTitle: row.job_title,
    employeeNumber: row.employee_number,
    startedOn: row.started_on,
    membershipStatus: row.membership_status ?? null,
    roleKeys: row.role_keys ?? [],
  };
}

export function mapStudent(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    legalName: row.legal_name,
    preferredName: row.preferred_name ?? null,
    admissionNumber: row.admission_number,
    enrolmentStatus: row.enrolment_status,
    dateOfBirth: row.date_of_birth ?? null,
    currentYearGroupId: row.year_group_id ?? null,
    currentYearGroupName: row.year_group_name ?? null,
    currentFormClassId: row.form_class_id ?? null,
    currentFormClassName: row.form_class_name ?? null,
    currentAcademicYearId: row.academic_year_id ?? null,
  };
}

export function mapEnrolment(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentProfileId: row.student_profile_id,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    yearGroupId: row.year_group_id,
    yearGroupName: row.year_group_name ?? null,
    houseId: row.house_id,
    houseName: row.house_name ?? null,
    status: row.status,
    isPrimary: row.is_primary,
    placementKind: row.placement_kind,
    startedOn: row.started_on,
    endedOn: row.ended_on,
  };
}

export function mapGuardianship(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentProfileId: row.student_profile_id,
    studentLegalName: row.student_legal_name ?? null,
    guardianUserId: row.guardian_user_id,
    guardianFullName: row.full_name ?? null,
    guardianEmail: row.email ?? null,
    relationship: row.relationship,
    hasParentalResponsibility: row.has_parental_responsibility,
    isEmergencyContact: row.is_emergency_contact,
    livesWithStudent: row.lives_with_student,
    portalAccess: row.portal_access,
    priority: row.priority,
    startedOn: row.started_on,
    endedOn: row.ended_on,
  };
}

export function mapClassMembership(row: Record<string, unknown>) {
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name ?? null,
    classType: row.class_type ?? null,
    studentProfileId: row.student_profile_id,
    academicYearId: row.academic_year_id,
    startedOn: row.started_on,
    endedOn: row.ended_on,
  };
}

export function mapStaffAssignment(row: Record<string, unknown>) {
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name ?? null,
    staffProfileId: row.staff_profile_id,
    assignmentRole: row.assignment_role,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    subjects: row.subjects ?? [],
  };
}
