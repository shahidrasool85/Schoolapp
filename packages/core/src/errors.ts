export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
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
    message.includes("academic_result_actor_required")
  ) {
    return new AppError(400, "validation_failed", "The request violates a data constraint");
  }
  if (message.includes("assignment_not_assigned") || message.includes("assessment_pupil_not_included")) {
    return new AppError(404, "not_found", "Not found");
  }
  if (message.includes("learning_score_out_of_range") || message.includes("academic_score_out_of_range")) {
    return new AppError(400, "validation_failed", "Score must be between 0 and the maximum marks");
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
  if (message.includes("student_already_in_form_class")) {
    return new AppError(409, "conflict", "Student already has an active form class in this academic year");
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
  if (message.includes("payload_too_large")) {
    return new AppError(413, "payload_too_large", "Request is too large");
  }
  if (code === "23505") {
    return new AppError(409, "conflict", "Resource already exists");
  }
  if (code === "23514" || code === "23503") {
    return new AppError(400, "validation_failed", "The request violates a data constraint");
  }
  return null;
}
