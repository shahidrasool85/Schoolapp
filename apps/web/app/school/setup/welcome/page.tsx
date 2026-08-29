"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onboardingWelcomeCopy, setupProgressLabel } from "@schoolapp/domain";
import { LuvLearnMark } from "../../../../components/luvlearn-mark";
import { RequirePermission } from "../../../../components/require-permission";
import { Alert, Button, LoadingState, PageError } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import {
  SCHOOL_DASHBOARD_PATH,
  setupContinueHref,
  type SchoolOnboardingResponse,
} from "../../../../lib/onboarding";

export default function SchoolSetupWelcomePage() {
  return (
    <RequirePermission anyOf={["onboarding.manage"]}>
      <WelcomeExperience />
    </RequirePermission>
  );
}

function WelcomeExperience() {
  const router = useRouter();
  const [data, setData] = useState<SchoolOnboardingResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SchoolOnboardingResponse>("/api/v1/onboarding")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load school setup.")));
  }, []);

  async function dismissAutomatic() {
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/onboarding/preference", {
        method: "PATCH",
        body: JSON.stringify({ dismissAutomatic: true }),
      });
      router.push(SCHOOL_DASHBOARD_PATH);
    } catch (err) {
      setError(userFacingError(err, "Could not save that preference."));
      setBusy(false);
    }
  }

  if (error && !data) return <PageError title="Setup unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading school setup…" />;

  const copy = onboardingWelcomeCopy({
    schoolName: data.setup.schoolName,
    status: data.setup.status,
    completedCount: data.setup.completedCount,
    totalSteps: data.setup.totalSteps,
    currentStep: data.progress.currentStep,
    completedSteps: data.progress.completedSteps,
  });
  const continueHref = setupContinueHref(data.setup);

  return (
    <div className="setup-welcome">
      <section className="setup-welcome-card" aria-labelledby="setup-welcome-heading">
        <LuvLearnMark compact />
        <p className="setup-welcome-eyebrow">School setup</p>
        <h1 id="setup-welcome-heading">{copy.heading}</h1>
        <p className="setup-welcome-title">{copy.title}</p>
        <p className="muted">{copy.lede}</p>
        {data.setup.status !== "not_started" || data.setup.completedCount > 0 ? (
          <p className="setup-welcome-progress" aria-label={setupProgressLabel(data.setup)}>
            {setupProgressLabel(data.setup)}
            <span className="setup-welcome-percent">{data.setup.percent}%</span>
          </p>
        ) : null}
        <div className="setup-welcome-actions">
          <Link className="button" href={continueHref}>
            {copy.primaryLabel}
          </Link>
          <Link className="button secondary" href={SCHOOL_DASHBOARD_PATH}>
            Go to dashboard
          </Link>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="setup-welcome-dismiss">
          <Button type="button" variant="ghost" onClick={() => void dismissAutomatic()} disabled={busy}>
            {busy ? "Saving…" : "Don't show setup automatically again"}
          </Button>
          <p className="muted">You can always reopen School Setup from the menu.</p>
        </div>
      </section>
    </div>
  );
}
