import Link from "next/link";
import { setupProgressLabel } from "@schoolapp/domain";
import { setupContinueHref, type SchoolOnboardingResponse } from "../lib/onboarding";

export function SetupReminderCard({ data }: { data: SchoolOnboardingResponse }) {
  if (!data.presentation.showDashboardCard || data.setup.status === "completed") return null;
  const started = data.setup.status !== "not_started" || data.setup.completedCount > 0;
  return (
    <section className="setup-reminder-card" aria-label="School setup reminder">
      <div>
        <p className="setup-reminder-eyebrow">School setup</p>
        <h2>{started ? `Finish setting up ${data.setup.schoolName}` : "Set up your school"}</h2>
        <p className="muted">
          {started
            ? setupProgressLabel(data.setup)
            : `Complete the essential settings for ${data.setup.schoolName}.`}
        </p>
      </div>
      <Link className="button" href={setupContinueHref(data.setup)}>
        {started ? "Continue setup" : "Start setup"}
      </Link>
    </section>
  );
}
