"use client";

import { useEffect, useState } from "react";
import { fetchAuthenticatedBlobUrl } from "../lib/api";

function initialsFromName(name?: string | null): string {
  return (
    (name ?? "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function ProfileAvatar({
  name,
  photoUrl,
  size = "md",
}: {
  name?: string | null;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const initials = initialsFromName(name);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!photoUrl) {
      setSrc(null);
      return;
    }
    fetchAuthenticatedBlobUrl(photoUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [photoUrl]);

  return (
    <span className={`user-avatar user-avatar-${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}
