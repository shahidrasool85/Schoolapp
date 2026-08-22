"use client";

import { useParams } from "next/navigation";
import { PublicAdmissionsForm } from "../../../../../lib/public-admissions-form";

export default function EmbedEnquiryPage() {
  const params = useParams<{ slug: string }>();
  return <PublicAdmissionsForm formType="enquiry" slug={params.slug} embed />;
}
