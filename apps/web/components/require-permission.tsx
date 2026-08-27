"use client";

import type { ReactNode } from "react";
import { usePermissions } from "../lib/use-permissions";
import { LoadingState, PageError } from "./ui";

export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: ReactNode;
}) {
  const permissions = usePermissions();
  if (!permissions.ready) return <LoadingState label="Checking access…" />;
  if (!permissions.hasAny(anyOf)) {
    return (
      <PageError
        title="You do not have permission to do that"
        description="This area is limited to authorised school administrators."
      />
    );
  }
  return children;
}
