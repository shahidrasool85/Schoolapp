"use client";

import { useParams } from "next/navigation";
import { PublicAdmissionsForm } from "../../../../../lib/public-admissions-form";

export default function EmbedApplicationPage() {
  const params = useParams<{ slug: string }>();
  return <PublicAdmissionsForm formType="application" slug={params.slug} embed />;
}
