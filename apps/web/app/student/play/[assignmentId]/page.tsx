"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EarlyLearnPlayer } from "../../../../components/early-learn-player";
import { LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

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

export default function StudentPracticePlayerPage() {
  const params = useParams<{ assignmentId: string }>();
  const [data, setData] = useState<Playable | null>(null);
  const [childFriendly, setChildFriendly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.assignmentId) return;
    Promise.all([
      api<Playable>(`/api/v1/student/practice/${params.assignmentId}`),
      api<{ childFriendlyUi: boolean }>("/api/v1/student/practice").catch(() => ({ childFriendlyUi: false })),
    ])
      .then(([playable, list]) => {
        setData(playable);
        setChildFriendly(Boolean(list.childFriendlyUi));
      })
      .catch((err: Error) => setError(userFacingError(err, "This activity is not available.")));
  }, [params.assignmentId]);

  if (error) return <PageError title="Activity unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading activity…" />;

  return (
    <>
      <PageHeader
        title={data.activity.title}
        description="Answers are checked by the school. You cannot award yourself points."
        actions={<Link href="/student/play">Back</Link>}
      />
      <EarlyLearnPlayer
        title={data.activity.title}
        instructions={data.activity.instructions}
        items={data.items}
        childFriendly={childFriendly}
        startPath={`/api/v1/student/practice/${params.assignmentId}/start`}
        submitPath={(attemptId) => `/api/v1/student/practice/attempts/${attemptId}/submit`}
      />
    </>
  );
}
