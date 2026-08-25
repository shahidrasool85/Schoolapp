export type TimetableConflictDetail = {
  kind: string;
  message: string;
  entryId?: string;
  classId?: string;
  roomId?: string;
  staffProfileId?: string;
};

export type AppErrorDetails = {
  fieldKey?: string;
  sectionKey?: string;
  conflicts?: TimetableConflictDetail[];
  retryAfterSeconds?: number;
};

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: AppErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function pgErrorToAppError(error: unknown): AppError | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = String((error as { code: string }).code);
  const message = "message" in error ? String((error as { message: string }).message) : "";
  if (message.includes("session_invalid") || message.includes("tenant_context_user_disabled")) {
    return new AppError(401, "unauthenticated", "Authentication required");
  }
  if (message.includes("tenant_context_support_grant_required")) {
    return new AppError(
      403,
      "support_grant_required",
      "Break-glass support access is required to enter this organisation",
    );
  }
  if (message.includes("invitation_user_disabled")) {
    return new AppError(403, "forbidden", "This account cannot accept invitations");
  }
  if (message === "forbidden" || message.startsWith("forbidden")) {
    return new AppError(403, "forbidden", "Missing permission");
  }
  if (code === "42501" || message.includes("tenant_context_membership_required")) {
    return new AppError(403, "org_membership_required", "Active organisation membership is required");
  }
  if (code === "P0002" || message.includes("invitation_invalid") || message.includes("not_found")) {
    return new AppError(404, "not_found", "Not found");
  }
  if (message.includes("platform_admin_required")) {
    return new AppError(403, "forbidden", "Platform administrator required");
  }
  if (message.includes("support_reason_required")) {
    return new AppError(400, "validation_failed", "A support access reason of at least 8 characters is required");
  }
  if (message.includes("support_scope_invalid")) {
    return new AppError(400, "validation_failed", "Support access scope is invalid");
  }
  if (message.includes("student_login_disabled") || message.includes("student_portal_disabled")) {
    return new AppError(
      401,
      "unauthenticated",
      "Invalid email or password",
    );
  }
  if (message.includes("attendance_date_outside_year")) {
    return new AppError(400, "validation_failed", "Attendance date is outside the academic year");
  }
  if (
    message.includes("attendance_actor_required") ||
    message.includes("learning_actor_required") ||
    message.includes("learning_mark_actor_required") ||
    message.includes("academic_actor_required") ||
    message.includes("academic_result_actor_required") ||
    message.includes("communication_actor_required") ||
    message.includes("behaviour_actor_required") ||
    message.includes("pastoral_actor_required") ||
    message.includes("safeguarding_actor_required") ||
    message.includes("timetable_actor_required") ||
    message.includes("activity_actor_required") ||
    message.includes("finance_actor_required") ||
    message.includes("messaging_actor_required") ||
    message.includes("statutory_actor_required") ||
    message.includes("engagement_actor_required")
  ) {
    return new AppError(400, "validation_failed", "The request violates a data constraint");
  }
  if (message.includes("engagement_xp_immutable") || message.includes("competition_results_frozen")) {
    return new AppError(409, "conflict", "This record can no longer be changed");
  }
  if (message.includes("learning_attempt_completed")) {
    return new AppError(409, "conflict", "This activity has already been submitted");
  }
  if (message.includes("engagement_revoke_reason_required")) {
    return new AppError(400, "validation_failed", "A correction reason is required");
  }
  if (message.includes("assignment_not_assigned") || message.includes("assessment_pupil_not_included")) {
    return new AppError(404, "not_found", "Not found");
  }
  if (message.includes("learning_score_out_of_range") || message.includes("academic_score_out_of_range")) {
    return new AppError(400, "validation_failed", "Score must be between 0 and the maximum marks");
  }
  if (message.includes("acknowledgement_not_required")) {
    return new AppError(400, "validation_failed", "Acknowledgement is not required for this notice");
  }
  if (message.includes("activity_capacity_exceeded")) {
    return new AppError(409, "activity_full", "This activity is full");
  }
  if (message.includes("activity_guardian_required")) {
    return new AppError(400, "validation_failed", "A guardian identity is required for this response");
  }
  if (message.includes("event_dates_invalid")) {
    return new AppError(400, "validation_failed", "Event end must be on or after the start");
  }
  if (message.includes("academic_report_locked")) {
    return new AppError(409, "conflict", "Published report content cannot be edited");
  }
  if (message.includes("year_group_above_maximum")) {
    return new AppError(
      400,
      "validation_failed",
      "Year group is above the school's configured maximum",
    );
  }
  if (message.includes("year_group_code_invalid")) {
    return new AppError(400, "validation_failed", "Year group code is invalid");
  }
  if (message.includes("student_invite_not_supported") || message.includes("invalid_role_key")) {
    return new AppError(400, "validation_failed", "One or more role keys are invalid");
  }
  if (message.includes("organisation_mismatch") || message.includes("class_year_mismatch")) {
    return new AppError(400, "validation_failed", "Referenced records must belong to this organisation");
  }
  if (message.includes("timetable_conflict")) {
    const detailText =
      "detail" in error && typeof (error as { detail?: unknown }).detail === "string"
        ? String((error as { detail: string }).detail)
        : "";
    let conflicts: AppErrorDetails["conflicts"];
    try {
      const parsed = detailText ? (JSON.parse(detailText) as { conflicts?: AppErrorDetails["conflicts"] }) : null;
      conflicts = parsed?.conflicts;
    } catch {
      conflicts = undefined;
    }
    return new AppError(409, "conflict", "This timetable change conflicts with an existing lesson", {
      conflicts,
    });
  }
  if (message.includes("school_day_weekday_overlap")) {
    return new AppError(409, "conflict", "Another active school-day profile already covers one of these weekdays");
  }
  if (message.includes("timetable_dates_outside_year")) {
    return new AppError(400, "validation_failed", "Timetable dates must fall inside the academic year");
  }
  if (message.includes("timetable_cover_weekday_mismatch")) {
    return new AppError(400, "validation_failed", "Cover date must fall on the lesson weekday");
  }
  if (message.includes("timetable_cover_outside_entry")) {
    return new AppError(400, "validation_failed", "Cover date must fall inside the timetable entry effective range");
  }
  if (message.includes("student_already_in_form_class")) {
    return new AppError(409, "conflict", "Student already has an active form class in this academic year");
  }
  if (message.includes("safeguarding_history_immutable")) {
    return new AppError(409, "conflict", "Safeguarding chronology entries cannot be overwritten");
  }
  if (message.includes("message_immutable")) {
    return new AppError(409, "conflict", "Sent messages cannot be edited");
  }
  if (message.includes("census_snapshot_immutable")) {
    return new AppError(409, "conflict", "Finalised census snapshots cannot be rewritten");
  }
  if (message.includes("invalid_status_transition") || message.includes("application_status_invalid")) {
    return new AppError(409, "invalid_status_transition", "This status change is not allowed");
  }
  if (message.includes("application_not_accepted")) {
    return new AppError(409, "conflict", "Only an accepted application can be enrolled");
  }
  if (message.includes("application_already_converted")) {
    return new AppError(409, "conflict", "This application has already been converted");
  }
  if (message.includes("enquiry_already_converted")) {
    return new AppError(409, "conflict", "This enquiry has already been converted");
  }
  if (message.includes("admissions_enrolment_required")) {
    return new AppError(400, "validation_failed", "Enrolment must use the dedicated conversion endpoint");
  }
  if (message.includes("slug_reserved")) {
    return new AppError(400, "reserved_slug", "This subdomain is reserved for the platform");
  }
  if (message.includes("slug_invalid") || message.includes("slug_punycode") || message.includes("slug_malformed")) {
    return new AppError(
      400,
      "validation_failed",
      "School slugs must be 2–63 lowercase DNS labels (letters, digits, hyphens)",
    );
  }
  if (message.includes("slug_in_history")) {
    return new AppError(409, "conflict", "This school slug cannot be reused");
  }
  if (message.includes("hostname_reserved") || message.includes("hostname_platform_collision")) {
    return new AppError(400, "validation_failed", "This hostname is reserved or collides with the platform domain");
  }
  if (message.includes("hostname_unverified")) {
    return new AppError(404, "tenant_not_found", "Not found");
  }
  if (message.includes("hostname_not_pending")) {
    return new AppError(409, "conflict", "Only pending hostnames can be changed this way");
  }
  if (message.includes("hostname_not_verified")) {
    return new AppError(
      409,
      "conflict",
      "Custom hostnames must be verified before they can be activated",
    );
  }
  if (message.includes("hostname_invalid")) {
    return new AppError(400, "validation_failed", "Hostname is not a valid DNS name");
  }
  if (message.includes("public_form_unavailable") || message.includes("public_form_not_accepting")) {
    return new AppError(404, "not_found", "Not found");
  }
  if (message.includes("public_form_draft_invalid")) {
    return new AppError(404, "not_found", "Not found");
  }
  if (message.includes("public_form_document_missing")) {
    return new AppError(400, "validation_failed", "A required document has not been uploaded");
  }
  if (message.includes("public_form_document_invalid")) {
    return new AppError(400, "validation_failed", "The uploaded document could not be verified");
  }
  if (message.includes("payload_too_large")) {
    return new AppError(413, "payload_too_large", "Request is too large");
  }
  if (code === "23505") {
    if (message.includes("admissions_offers_one_open")) {
      return new AppError(
        409,
        "conflict",
        "This application already has an open offer. Record a decision on that offer before making another.",
      );
    }
    if (message.includes("admissions_waiting_list_one_active")) {
      return new AppError(409, "conflict", "This application is already on the waiting list.");
    }
    if (message.includes("student_profiles_org_admission_number_idx")) {
      return new AppError(409, "conflict", "That admission number is already in use at this school.");
    }
    return new AppError(409, "conflict", "Resource already exists");
  }
  if (code === "23514" || code === "23503") {
    return new AppError(400, "validation_failed", "The request violates a data constraint");
  }
  return null;
}
