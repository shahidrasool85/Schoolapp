"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseSafeReturnTo, setupReturnLeaveMessage } from "@schoolapp/domain";

export function readSetupReturnTo(search = typeof window === "undefined" ? "" : window.location.search): string | null {
  return parseSafeReturnTo(new URLSearchParams(search).get("returnTo"));
}

export function SetupReturnBanner({
  dirty = false,
  afterSave = false,
}: {
  dirty?: boolean;
  afterSave?: boolean;
}) {
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    setReturnTo(readSetupReturnTo(window.location.search));
  }, []);

  if (!returnTo) return null;

  function confirmLeave(): boolean {
    if (!dirty || afterSave) return true;
    return window.confirm(setupReturnLeaveMessage());
  }

  return (
    <div className="setup-return-banner">
      <Link
        href={returnTo}
        className="setup-return-link"
        onClick={(event) => {
          if (!confirmLeave()) event.preventDefault();
        }}
      >
        ← Back to School Setup
      </Link>
      {afterSave ? (
        <Link href={returnTo} className="button">
          Return to School Setup
        </Link>
      ) : null}
    </div>
  );
}
