"use client";

import { useParams } from "next/navigation";
import { formTypeFromPublicKind, PublicAdmissionsForm } from "../../../../../lib/public-admissions-form";

export default function EmbedAdmissionsKindPage() {
  const params = useParams<{ kind: string; slug: string }>();
  const formType = formTypeFromPublicKind(params.kind);
  if (!formType) {
    return (
      <main className="public-form embed">
        <h1>Form unavailable</h1>
        <p>This form is not available.</p>
      </main>
    );
  }
  return <PublicAdmissionsForm formType={formType} slug={params.slug} embed />;
}
