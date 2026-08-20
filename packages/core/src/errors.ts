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
  if (message.includes("student_login_disabled")) {
    return new AppError(
      400,
      "validation_failed",
      "Student login is disabled for this year group",
    );
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
    return new AppError(409, "invalid_status_transition", "This application status change is not allowed");
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
  if (code === "23505") {
    return new AppError(409, "conflict", "Resource already exists");
  }
  if (code === "23514" || code === "23503") {
    return new AppError(400, "validation_failed", "The request violates a data constraint");
  }
  return null;
}
