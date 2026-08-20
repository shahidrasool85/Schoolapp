export {
  canReadStudentProfile,
  canReadRestrictedContact,
} from "./students-access.js";

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
  if (code === "42501" || message.includes("tenant_context_membership_required")) {
    return new AppError(403, "org_membership_required", "Active organisation membership is required");
  }
  if (code === "P0002" || message.includes("invitation_invalid")) {
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
  return null;
}
