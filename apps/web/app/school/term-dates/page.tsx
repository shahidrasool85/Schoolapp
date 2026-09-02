"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState, PageError, PageHeader } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import Link from "next/link";

export default function TermDatesRedirectPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<{ academicYear: { id: string } }>("/api/v1/academic-years/current")
      .then((body) => {
        router.replace(`/school/academic-years/${body.academicYear.id}/terms`);
      })
      .catch((err: Error) => {
        const message = userFacingError(err, "Could not open term dates.");
        if (message.toLowerCase().includes("no current academic year") || (err as { status?: number }).status === 404) {
          setMissing(true);
          return;
        }
        setError(message);
      });
  }, [router]);

  if (error) return <PageError title="Term dates unavailable" description={error} />;
  if (missing) {
    return (
      <>
        <PageHeader title="Term dates" description="Choose the current academic year first, then manage Autumn, Spring and Summer dates." />
        <EmptyState
          title="No current academic year"
          description="Create or mark a current academic year, then return here to manage term dates."
          action={<Link href="/school/academic-years">Academic years</Link>}
        />
      </>
    );
  }
  return <LoadingState label="Opening this year’s term dates…" />;
}
