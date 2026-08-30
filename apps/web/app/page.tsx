import { redirect } from "next/navigation";
import { readLoginHostKind } from "../lib/login-host-kind";
import { tenantLoginPath } from "../lib/safe-next";
import { PublicLandingPage } from "./public-landing";
import { SchoolNotFoundPage } from "./school-not-found";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const hostKind = await readLoginHostKind();
  const params = await searchParams;

  if (hostKind === "school") {
    redirect(tenantLoginPath(params.next));
  }

  if (hostKind === "unknown") {
    return <SchoolNotFoundPage />;
  }

  return <PublicLandingPage platformDomain={(process.env.PLATFORM_DOMAIN ?? "localhost").trim() || "localhost"} />;
}
