const TOKEN_KEY = "schoolapp.accessToken";
const ORG_KEY = "schoolapp.organisationId";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ORG_KEY);
}

export function setOrgId(id: string | null): void {
  if (id) sessionStorage.setItem(ORG_KEY, id);
  else sessionStorage.removeItem(ORG_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { orgId?: string | null } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const orgId = options.orgId === undefined ? getOrgId() : options.orgId;
  if (orgId) headers.set("X-Organisation-Id", orgId);

  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(response.status, error?.code ?? "error", error?.message ?? "Request failed");
  }
  return body as T;
}
