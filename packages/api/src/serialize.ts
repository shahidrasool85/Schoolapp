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

export function mapLearningWorkType(row: Record<string, unknown>) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    isSystem: row.is_system,
  };
}

export function mapLearningAssignment(
  row: Record<string, unknown>,
  options?: { includeTeacherNotes?: boolean },
) {
  const base = {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    workTypeId: row.work_type_id,
    workTypeKey: row.work_type_key ?? null,
    workTypeName: row.work_type_name ?? null,
    subjectId: row.subject_id ?? null,
    subjectName: row.subject_name ?? null,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    intendedYearGroupId: row.intended_year_group_id ?? null,
    intendedYearGroupName: row.intended_year_group_name ?? null,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    dueAt: row.due_at ?? null,
    availableFrom: row.available_from ?? null,
    status: row.status,
    publishedAt: row.published_at ?? null,
    estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
    maximumMarks: row.maximum_marks != null ? Number(row.maximum_marks) : null,
    submissionRequired: row.submission_required ?? true,
  };
  if (options?.includeTeacherNotes) {
    return { ...base, teacherNotes: row.teacher_notes ?? null };
  }
  return base;
}

export function mapLearningTarget(row: Record<string, unknown>) {
  return {
    id: row.id,
    targetType: row.target_type,
    classId: row.class_id ?? null,
    className: row.class_name ?? null,
    yearGroupId: row.year_group_id ?? null,
    yearGroupName: row.year_group_name ?? null,
    studentProfileId: row.student_profile_id ?? null,
    studentLegalName: row.student_legal_name ?? null,
  };
}

export function mapLearningResource(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    resourceKind: row.resource_kind,
    url: row.url ?? null,
    contentType: row.content_type ?? null,
    byteSize: row.byte_size ?? null,
    storageBackend: row.storage_backend ?? "unconfigured",
    binaryUploadAvailable: false,
  };
}

export function mapLearningMark(
  row: Record<string, unknown> | null | undefined,
  options: { audience: "staff" | "student" | "parent" },
) {
  if (!row) return null;
  const releasedToStudent = Boolean(row.released_to_student);
  const releasedToParent = Boolean(row.released_to_parent);
  if (options.audience === "student" && !releasedToStudent) return null;
  if (options.audience === "parent" && !releasedToParent) return null;
  const mark = {
    score: row.score != null ? Number(row.score) : null,
    maximumMarks: row.maximum_marks != null ? Number(row.maximum_marks) : null,
    feedback: (row.feedback as string | null) ?? null,
    status: row.submission_status ?? null,
    releasedToStudent,
    releasedToParent,
    markedAt: row.marked_at ?? null,
  };
  if (options.audience === "staff") {
    return {
      ...mark,
      id: row.id,
      markedBy: row.marked_by ?? null,
      markedByName: row.marked_by_name ?? null,
      resubmissionRequested: Boolean(row.resubmission_requested),
    };
  }
  return {
    score: mark.score,
    maximumMarks: mark.maximumMarks,
    feedback: mark.feedback,
    markedAt: mark.markedAt,
  };
}

export function mapLearningSubmission(
  row: Record<string, unknown>,
  options: { audience: "staff" | "student" | "parent" },
) {
  const base = {
    id: row.id,
    assignmentId: row.assignment_id,
    studentProfileId: row.student_profile_id,
    studentLegalName: row.student_legal_name ?? null,
    status: row.status,
    submittedAt: row.submitted_at ?? null,
    currentRevisionId: row.current_revision_id ?? null,
  };
  if (options.audience === "staff") {
    return {
      ...base,
      submittedBy: row.submitted_by ?? null,
      textResponse: row.text_response ?? null,
      comment: row.comment ?? null,
      revisionNumber: row.revision_number ?? null,
    };
  }
  return {
    ...base,
    textResponse: row.text_response ?? null,
    comment: row.comment ?? null,
    revisionNumber: row.revision_number ?? null,
  };
}

export function mapLearningRevision(row: Record<string, unknown>) {
  return {
    id: row.id,
    revisionNumber: row.revision_number,
    textResponse: row.text_response ?? null,
    comment: row.comment ?? null,
    submittedAt: row.submitted_at,
  };
}

export function mapAssessmentType(row: Record<string, unknown>) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    isSystem: row.is_system,
  };
}

export function mapGradeScheme(
  row: Record<string, unknown>,
  levels: Array<Record<string, unknown>> = [],
) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    schemeKind: row.scheme_kind,
    subjectId: row.subject_id ?? null,
    yearGroupId: row.year_group_id ?? null,
    isNumeric: Boolean(row.is_numeric),
    isSystem: Boolean(row.is_system),
    levels: levels.map((level) => ({
      id: level.id,
      code: level.code,
      label: level.label,
      sortOrder: level.sort_order,
      numericValue: level.numeric_value != null ? Number(level.numeric_value) : null,
      minPercentage: level.min_percentage != null ? Number(level.min_percentage) : null,
      maxPercentage: level.max_percentage != null ? Number(level.max_percentage) : null,
    })),
  };
}

export function mapReportingPeriod(row: Record<string, unknown>) {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    termId: row.term_id ?? null,
    termName: row.term_name ?? null,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    publishStartsOn: row.publish_starts_on ?? null,
    publishEndsOn: row.publish_ends_on ?? null,
  };
}

export function mapFormalAssessment(
  row: Record<string, unknown>,
  options?: { includeInternalNotes?: boolean },
) {
  const base = {
    id: row.id,
    title: row.title,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    reportingPeriodId: row.reporting_period_id ?? null,
    reportingPeriodName: row.reporting_period_name ?? null,
    subjectId: row.subject_id,
    subjectName: row.subject_name ?? null,
    yearGroupId: row.year_group_id,
    yearGroupName: row.year_group_name ?? null,
    assessmentTypeId: row.assessment_type_id,
    assessmentTypeKey: row.assessment_type_key ?? null,
    assessmentTypeName: row.assessment_type_name ?? null,
    assessmentDate: row.assessment_date,
    dueOn: row.due_on ?? null,
    maximumMarks: row.maximum_marks != null ? Number(row.maximum_marks) : null,
    weighting: row.weighting != null ? Number(row.weighting) : null,
    gradeSchemeId: row.grade_scheme_id ?? null,
    gradeSchemeName: row.grade_scheme_name ?? null,
    gradeSchemeKind: row.grade_scheme_kind ?? null,
    gradeSchemeIsNumeric: row.grade_scheme_is_numeric != null ? Boolean(row.grade_scheme_is_numeric) : null,
    status: row.status,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
    sourceLearningAssignmentId: row.source_learning_assignment_id ?? null,
  };
  if (options?.includeInternalNotes) {
    return { ...base, internalNotes: row.internal_notes ?? null };
  }
  return base;
}

export function mapAcademicResult(
  row: Record<string, unknown> | null | undefined,
  options: { audience: "staff" | "student" | "parent" },
) {
  if (!row) return null;
  const releasedToStudent = Boolean(row.released_to_student);
  const releasedToParent = Boolean(row.released_to_parent);
  const publishedAt = row.assessment_published_at ?? null;
  if (options.audience === "student" && (!releasedToStudent || !publishedAt)) return null;
  if (options.audience === "parent" && (!releasedToParent || !publishedAt)) return null;
  const visible = {
    assessmentId: row.assessment_id,
    assessmentTitle: row.assessment_title ?? null,
    subjectId: row.subject_id ?? null,
    subjectName: row.subject_name ?? null,
    assessmentDate: row.assessment_date ?? null,
    rawScore: row.raw_score != null ? Number(row.raw_score) : null,
    maximumScore: row.maximum_score != null ? Number(row.maximum_score) : null,
    percentage: row.percentage != null ? Number(row.percentage) : null,
    gradeLabel: row.grade_label ?? null,
    gradeCode: row.grade_code ?? null,
    teacherJudgement: (row.teacher_judgement as string | null) ?? null,
    comment: (row.comment as string | null) ?? null,
  };
  if (options.audience === "staff") {
    return {
      ...visible,
      id: row.id,
      studentProfileId: row.student_profile_id,
      studentLegalName: row.student_legal_name ?? null,
      gradeSchemeLevelId: row.grade_scheme_level_id ?? null,
      reviewStatus: row.review_status,
      internalReviewNote: row.internal_review_note ?? null,
      releasedToStudent,
      releasedToParent,
      enteredBy: row.entered_by ?? null,
      enteredByName: row.entered_by_name ?? null,
      enteredAt: row.entered_at,
      amendedBy: row.amended_by ?? null,
      amendedAt: row.amended_at ?? null,
      reviewedBy: row.reviewed_by ?? null,
      reviewedAt: row.reviewed_at ?? null,
    };
  }
  return visible;
}

export function mapAcademicTarget(row: Record<string, unknown>) {
  return {
    id: row.id,
    studentProfileId: row.student_profile_id,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    subjectId: row.subject_id,
    subjectName: row.subject_name ?? null,
    gradeSchemeId: row.grade_scheme_id ?? null,
    targetLevelId: row.target_level_id ?? null,
    targetLabel: row.target_label ?? row.target_value ?? null,
    targetValue: row.target_value ?? null,
    baselineLevelId: row.baseline_level_id ?? null,
    baselineLabel: row.baseline_label ?? row.baseline_value ?? null,
    baselineValue: row.baseline_value ?? null,
    note: row.note ?? null,
  };
}

export function mapAcademicReport(
  row: Record<string, unknown>,
  options?: { includeWorkflow?: boolean },
) {
  const base = {
    id: row.id,
    studentProfileId: row.student_profile_id,
    studentLegalName: row.student_legal_name ?? null,
    academicYearId: row.academic_year_id,
    academicYearName: row.academic_year_name ?? null,
    reportingPeriodId: row.reporting_period_id,
    reportingPeriodName: row.reporting_period_name ?? null,
    status: row.status,
    generalComment: row.general_comment ?? null,
    publishedAt: row.published_at ?? null,
  };
  if (options?.includeWorkflow) {
    return {
      ...base,
      createdBy: row.created_by ?? null,
      createdByName: row.created_by_name ?? null,
      createdAt: row.created_at,
      submittedAt: row.submitted_at ?? null,
      reviewedAt: row.reviewed_at ?? null,
      publishedBy: row.published_by ?? null,
    };
  }
  return base;
}

export function mapAcademicReportSection(row: Record<string, unknown>) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectName: row.subject_name ?? null,
    teacherUserId: row.teacher_user_id ?? null,
    teacherName: row.teacher_name ?? null,
    attainmentSummary: row.attainment_summary ?? null,
    progressJudgement: row.progress_judgement ?? null,
    teacherComment: row.teacher_comment ?? null,
    targetNextSteps: row.target_next_steps ?? null,
    sortOrder: row.sort_order,
  };
}

export function mapPublishedReportSection(section: Record<string, unknown>) {
  return {
    id: section.id ?? null,
    subjectId: section.subjectId ?? section.subject_id ?? null,
    subjectName: section.subjectName ?? section.subject_name ?? null,
    teacherUserId: section.teacherUserId ?? section.teacher_user_id ?? null,
    teacherName: section.teacherName ?? section.teacher_name ?? null,
    attainmentSummary: section.attainmentSummary ?? section.attainment_summary ?? null,
    progressJudgement: section.progressJudgement ?? section.progress_judgement ?? null,
    teacherComment: section.teacherComment ?? section.teacher_comment ?? null,
    targetNextSteps: section.targetNextSteps ?? section.target_next_steps ?? null,
    sortOrder: section.sortOrder ?? section.sort_order ?? 0,
  };
}
