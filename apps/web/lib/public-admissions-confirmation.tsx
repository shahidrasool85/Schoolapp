"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import { AdmissionsSubmissionConfirmation } from "./admissions-submission-confirmation";
import type { PublicFormType } from "./public-admissions-form";

type ConfirmationPayload = {
  confirmation: {
    heading: string;
    message: string;
    additionalMessage?: string | null;
    button?: { label: string; url: string } | null;
    referenceLabel: string;
    reference: string;
    showSystemReference: boolean;
  };
  organisation: { name: string };
  branding?: { primaryColor?: string; logoUrl?: string | null };
};

export function PublicAdmissionsConfirmation({
  formType,
  slug,
  token,
  embed = false,
}: {
  formType: PublicFormType;
  slug: string;
  token: string;
  embed?: boolean;
}) {
  const [payload, setPayload] = useState<ConfirmationPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<ConfirmationPayload>(
      `/api/v1/public/admissions/forms/${formType}/${slug}/confirmation/${encodeURIComponent(token)}`,
      { orgId: null },
    )
      .then((body) => {
        if (!cancelled) setPayload(body);
      })
      .catch(() => {
        if (!cancelled) setError("This confirmation is no longer available.");
      });
    return () => {
      cancelled = true;
    };
  }, [formType, slug, token]);

  const brandStyle = useMemo(
    () =>
      payload?.branding?.primaryColor
        ? ({ ["--brand" as string]: payload.branding.primaryColor } as CSSProperties)
        : undefined,
    [payload],
  );

  if (error) {
    return (
      <main className={`admissions-app${embed ? " embed" : ""}`}>
        <h1>Confirmation unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!payload) {
    return (
      <main className={`admissions-app${embed ? " embed" : ""}`}>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className={`admissions-app${embed ? " embed" : ""}`} style={brandStyle}>
      <AdmissionsSubmissionConfirmation
        view={{
          schoolName: payload.organisation.name,
          logoUrl: payload.branding?.logoUrl,
          heading: payload.confirmation.heading,
          message: payload.confirmation.message,
          additionalMessage: payload.confirmation.additionalMessage,
          button: payload.confirmation.button,
          referenceLabel: payload.confirmation.referenceLabel,
          reference: payload.confirmation.reference,
          showSystemReference: payload.confirmation.showSystemReference,
        }}
      />
    </main>
  );
}
