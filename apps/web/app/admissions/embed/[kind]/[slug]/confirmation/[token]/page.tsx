"use client";

import { useParams } from "next/navigation";
import { formTypeFromPublicKind } from "../../../../../../../lib/public-admissions-form";
import { PublicAdmissionsConfirmation } from "../../../../../../../lib/public-admissions-confirmation";

export default function EmbedAdmissionsConfirmationPage() {
  const params = useParams<{ kind: string; slug: string; token: string }>();
  const formType = formTypeFromPublicKind(params.kind);
  const token = typeof params.token === "string" ? decodeURIComponent(params.token) : "";
  if (!formType || !params.slug || !token) {
    return (
      <main className="admissions-app embed">
        <h1>Confirmation unavailable</h1>
        <p>This confirmation is no longer available.</p>
      </main>
    );
  }
  return <PublicAdmissionsConfirmation formType={formType} slug={params.slug} token={token} embed />;
}
