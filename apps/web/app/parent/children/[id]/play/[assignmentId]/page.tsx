"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EarlyLearnPlayer } from "../../../../../../components/early-learn-player";
import { LoadingState, PageError, PageHeader } from "../../../../../../components/ui";
import { api } from "../../../../../../lib/api";
import { userFacingError } from "../../../../../../lib/errors";

type Playable = {
  assignment: { id: string; title: string };
  activity: { title: string; instructions: string | null };
  items: Array<{
    id: string;
    promptText: string;
    promptEmoji?: string | null;
    itemType: string;
    choices: Array<{ id: string; label: string; emoji?: string | null }>;
    hint?: string | null;
  }>;
};

export default function ParentAssistedPlayPage() {
  const params = useParams<{ id: string; assignmentId: string }>();
  const [data, setData] = useState<Playable | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id || !params.assignmentId) return;
    api<Playable>(`/api/v1/parent/children/${params.id}/practice/${params.assignmentId}`)
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "This activity is not available.")));
  }, [params.id, params.assignmentId]);

  if (error) return <PageError title="Activity unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading activity…" />;

  return (
    <>
      <PageHeader
        title={`Learning together · ${data.activity.title}`}
        description="You are helping as a parent. The attempt is recorded for this child, not as a student login."
        actions={<Link href={`/parent/children/${params.id}/engagement`}>Back</Link>}
      />
      <EarlyLearnPlayer
        title={data.activity.title}
        instructions={data.activity.instructions}
        items={data.items}
        childFriendly
        startPath={`/api/v1/parent/children/${params.id}/practice/${params.assignmentId}/start`}
        submitPath={(attemptId) => `/api/v1/parent/children/${params.id}/practice/attempts/${attemptId}/submit`}
      />
    </>
  );
}
