import { api, ApiError } from "./api";

export async function optionalApi<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export function userFacingError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Please sign in again.";
    if (error.status === 403) return "You do not have permission to do that.";
    if (error.status === 404) return "That record could not be found.";
    if (error.status >= 500) return "The school system is temporarily unavailable. Please try again.";
    if (error.code === "validation_failed" && error.message) return error.message;
    if (error.message && !looksInternal(error.message)) return error.message;
  }
  if (error instanceof Error && error.message && !looksInternal(error.message)) return error.message;
  return fallback;
}

function looksInternal(message: string): boolean {
  return /sql|stack|ECONN|postgres|TypeError|at Object\.|ENOENT/i.test(message);
}
