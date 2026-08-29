import {
  ONBOARDING_WELCOME_PATH,
  SCHOOL_DASHBOARD_PATH,
  SETUP_PATH,
  setupStepHref,
  setupWelcomePrimaryHref,
  type OnboardingPresentation,
  type OnboardingStep,
  type SetupProgressView,
} from "@schoolapp/domain";

export { setupSidebarBadge } from "@schoolapp/domain";

export type SchoolOnboardingResponse = {
  schoolName: string;
  progress: {
    currentStep: string;
    completedSteps: string[];
    completedAt: string | null;
    readyMarkedAt: string | null;
  };
  readiness: {
    ready: boolean;
    items: Array<{
      key: string;
      label: string;
      href: string;
      required: boolean;
      tier?: "required" | "recommended" | "optional";
      complete: boolean;
      status: "complete" | "needs_attention" | "recommended" | "optional";
    }>;
  };
  setup: SetupProgressView & { schoolName: string };
  presentation: OnboardingPresentation;
};

export { ONBOARDING_WELCOME_PATH, SCHOOL_DASHBOARD_PATH, SETUP_PATH, setupStepHref };

export function setupContinueHref(
  setup: Pick<SetupProgressView, "resumeStep" | "status">,
): string {
  return setupWelcomePrimaryHref({
    status: setup.status,
    resumeStep: setup.resumeStep as OnboardingStep,
  });
}

