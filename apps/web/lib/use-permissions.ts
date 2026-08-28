"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export function usePermissions() {
  const [permissions, setPermissions] = useState<string[] | null>(null);

  useEffect(() => {
    api<{ permissions: string[] }>("/api/v1/me")
      .then((me) => setPermissions(me.permissions ?? []))
      .catch(() => setPermissions([]));
  }, []);

  return {
    permissions,
    ready: permissions !== null,
    has: (key: string) => Boolean(permissions?.includes(key)),
    hasAny: (keys: string[]) => keys.some((key) => Boolean(permissions?.includes(key))),
  };
}
