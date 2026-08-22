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

export function mapAttendanceSessionType(row: Record<string, unknown>) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    typicalStartTime: row.typical_start_time ?? null,
    typicalEndTime: row.typical_end_time ?? null,
    isActive: row.is_active,
  };
}

export function mapAttendanceCode(row: Record<string, unknown>) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    requiresLateMinutes: row.requires_late_minutes,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export function mapAttendanceMark(row: Record<string, unknown>, options?: { includeInternal?: boolean }) {
  const includeInternal = options?.includeInternal !== false;
  const base = {
    id: row.id,
    studentProfileId: row.student_profile_id,
    studentLegalName: row.student_legal_name ?? null,
    academicYearId: row.academic_year_id,
    sessionTypeId: row.session_type_id,
    sessionKey: row.session_key ?? null,
    sessionName: row.session_name ?? null,
    date: row.mark_date,
    codeId: row.attendance_code_id,
    code: row.code ?? null,
    codeName: row.code_name ?? null,
    category: row.category ?? null,
    lateMinutes: row.late_minutes ?? null,
    reason: row.reason ?? null,
    parentNote: row.parent_visible_note ?? null,
    classId: row.class_id ?? null,
    className: row.class_name ?? null,
    yearGroupId: row.year_group_id ?? null,
    yearGroupName: row.year_group_name ?? null,
  };
  if (!includeInternal) {
    return base;
  }
  return {
    ...base,
    note: row.note ?? null,
    recordedBy: row.recorded_by ?? null,
    recordedByName: row.recorded_by_name ?? null,
    recordedAt: row.recorded_at ?? null,
    lastCorrectedBy: row.last_corrected_by ?? null,
    lastCorrectedByName: row.last_corrected_by_name ?? null,
    lastCorrectedAt: row.last_corrected_at ?? null,
  };
}

export function mapStudentDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentProfileId: row.student_profile_id,
    title: row.title,
    documentType: row.document_type,
    storageBackend: row.storage_backend,
    storageKey: row.storage_key ?? null,
    contentType: row.content_type ?? null,
    byteSize: row.byte_size ?? null,
    visibility: row.visibility,
    createdAt: row.created_at,
    binaryUploadAvailable: false,
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
    studentPortalOverride: row.portal_override === undefined ? undefined : row.portal_override,
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

export function mapEnquiry(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    pupilLegalName: row.pupil_legal_name,
    pupilPreferredName: row.pupil_preferred_name ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    intendedAcademicYearId: row.intended_academic_year_id ?? null,
    intendedAcademicYearName: row.intended_academic_year_name ?? null,
    intendedYearGroupId: row.intended_year_group_id ?? null,
    intendedYearGroupName: row.intended_year_group_name ?? null,
    guardianFullName: row.guardian_full_name,
    guardianEmail: row.guardian_email ?? null,
    guardianTelephone: row.guardian_telephone ?? null,
    enquiryDate: row.enquiry_date,
    source: row.source ?? null,
    notes: row.notes ?? null,
    assignedStaffProfileId: row.assigned_staff_profile_id ?? null,
    assignedStaffName: row.assigned_staff_name ?? null,
    convertedApplicationId: row.converted_application_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapApplication(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    enquiryId: row.enquiry_id ?? null,
    pupilLegalName: row.pupil_legal_name,
    pupilPreferredName: row.pupil_preferred_name ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    intendedAcademicYearId: row.intended_academic_year_id ?? null,
    intendedAcademicYearName: row.intended_academic_year_name ?? null,
    intendedYearGroupId: row.intended_year_group_id ?? null,
    intendedYearGroupName: row.intended_year_group_name ?? null,
    intendedEntryDate: row.intended_entry_date ?? null,
    previousSchool: row.previous_school ?? null,
    currentSchool: row.current_school ?? null,
    applicationDate: row.application_date ?? null,
    submittedAt: row.submitted_at ?? null,
    source: row.source ?? null,
    internalNotes: row.internal_notes ?? null,
    assignedStaffProfileId: row.assigned_staff_profile_id ?? null,
    assignedStaffName: row.assigned_staff_name ?? null,
    convertedStudentProfileId: row.converted_student_profile_id ?? null,
    convertedAt: row.converted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapApplicationContact(row: Record<string, unknown>) {
  return {
    id: row.id,
    applicationId: row.application_id,
    fullName: row.full_name,
    email: row.email ?? null,
    telephone: row.telephone ?? null,
    relationship: row.relationship,
    isPrimary: row.is_primary,
    hasParentalResponsibility: row.has_parental_responsibility,
    userId: row.user_id ?? null,
  };
}

export function mapApplicationHistory(row: Record<string, unknown>) {
  return {
    id: row.id,
    previousStatus: row.previous_status ?? null,
    newStatus: row.new_status,
    reason: row.reason ?? null,
    actorUserId: row.actor_user_id ?? null,
    actorName: row.actor_name ?? null,
    createdAt: row.created_at,
  };
}

export function mapAssessment(row: Record<string, unknown>) {
  return {
    id: row.id,
    applicationId: row.application_id,
    applicationReference: row.application_reference ?? null,
    pupilLegalName: row.pupil_legal_name ?? null,
    assessmentType: row.assessment_type,
    status: row.status,
    scheduledAt: row.scheduled_at ?? null,
    completedAt: row.completed_at ?? null,
    assignedStaffProfileId: row.assigned_staff_profile_id ?? null,
    assignedStaffName: row.assigned_staff_name ?? null,
    notes: row.notes ?? null,
    outcome: row.outcome ?? null,
    recommendation: row.recommendation ?? null,
    createdAt: row.created_at,
  };
}

export function mapWaitingListEntry(row: Record<string, unknown>) {
  return {
    id: row.id,
    applicationId: row.application_id,
    applicationReference: row.application_reference ?? null,
    pupilLegalName: row.pupil_legal_name ?? null,
    applicationStatus: row.application_status ?? null,
    intendedAcademicYearId: row.intended_academic_year_id ?? null,
    intendedAcademicYearName: row.intended_academic_year_name ?? null,
    intendedYearGroupId: row.intended_year_group_id ?? null,
    intendedYearGroupName: row.intended_year_group_name ?? null,
    status: row.status,
    priority: row.priority ?? null,
    notes: row.notes ?? null,
    addedAt: row.added_at,
  };
}

export function mapOffer(row: Record<string, unknown>) {
  return {
    id: row.id,
    applicationId: row.application_id,
    applicationReference: row.application_reference ?? null,
    pupilLegalName: row.pupil_legal_name ?? null,
    status: row.status,
    offeredAcademicYearId: row.offered_academic_year_id ?? null,
    offeredAcademicYearName: row.offered_academic_year_name ?? null,
    offeredYearGroupId: row.offered_year_group_id ?? null,
    offeredYearGroupName: row.offered_year_group_name ?? null,
    intendedStartDate: row.intended_start_date ?? null,
    offerMadeOn: row.offer_made_on,
    responseDeadline: row.response_deadline ?? null,
    acceptedAt: row.accepted_at ?? null,
    declinedAt: row.declined_at ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}
