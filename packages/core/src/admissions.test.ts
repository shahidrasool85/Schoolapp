import { describe, expect, it } from "vitest";
import type { Actor } from "@schoolapp/domain";
import {
  APPLICATION_STATUS_TRANSITIONS,
  APPLICATION_STATUSES,
  allowedApplicationTransitions,
  applicationTransitionChannel,
  applicationWorkflowActions,
  applicationWorkflowActionsForView,
  canUseAdministrativeCorrection,
  captureSubmitTarget,
  directCorrectionStatuses,
  isApplicationStatusTransitionAllowed,
  isDomainActionStatus,
  resetFormSafely,
  workflowActionVisible,
} from "@schoolapp/domain";
import { assertApplicationStatusTransition } from "./admissions.js";
import { AppError } from "./errors.js";

function actor(permissions: string[]): Actor {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    userKind: "staff",
    isPlatformAdmin: false,
    organisationId: "00000000-0000-0000-0000-000000000002",
    membershipId: null,
    roleKeys: ["school.admin"],
    permissions: new Set(permissions),
    supportAccessGrantId: null,
  };
}

describe("admissions application state machine", () => {
  it("covers every canonical status exactly once", () => {
    expect(Object.keys(APPLICATION_STATUS_TRANSITIONS).sort()).toEqual([...APPLICATION_STATUSES].sort());
  });

  it("does not allow under_review to jump to accepted", () => {
    expect(isApplicationStatusTransitionAllowed("under_review", "accepted")).toBe(false);
    expect(applicationTransitionChannel("under_review", "accepted")).toBe("illegal");
    expect(applicationWorkflowActions("under_review").some((action) => action.toStatus === "accepted")).toBe(
      false,
    );
    expect(() =>
      assertApplicationStatusTransition(
        actor(["admissions.decide", "admissions.applications.manage"]),
        "under_review",
        "accepted",
      ),
    ).toThrow(AppError);
  });

  it("routes offer, waiting list, assessment, and enrolment through domain actions", () => {
    expect(applicationTransitionChannel("under_review", "offer_made")).toBe("offer");
    expect(applicationTransitionChannel("under_review", "waiting_list")).toBe("waiting_list");
    expect(applicationTransitionChannel("under_review", "assessment_pending")).toBe("assessment");
    expect(applicationTransitionChannel("offer_made", "accepted")).toBe("offer_response");
    expect(applicationTransitionChannel("accepted", "enrolled")).toBe("enrol");
    expect(isDomainActionStatus("offer_made")).toBe(true);
    expect(directCorrectionStatuses("under_review")).not.toContain("accepted");
    expect(directCorrectionStatuses("under_review")).not.toContain("offer_made");
    expect(directCorrectionStatuses("under_review")).toContain("information_required");
  });

  it("exposes only legal workflow actions for under_review", () => {
    const next = applicationWorkflowActions("under_review").map((action) => action.toStatus);
    for (const status of next) {
      if (!status) continue;
      expect(allowedApplicationTransitions("under_review")).toContain(status);
    }
    expect(applicationWorkflowActions("waiting_list").some((action) => action.id === "waiting_list")).toBe(false);
    expect(applicationWorkflowActions("offer_made").some((action) => action.id === "make_offer")).toBe(false);
    expect(applicationWorkflowActions("enrolled")).toEqual([]);
  });

  it("hides make-offer when an open offer exists and hides complete-assessment without a schedule", () => {
    const perms = ["admissions.decide", "admissions.offers.manage", "admissions.applications.manage"];
    const waiting = applicationWorkflowActionsForView("waiting_list", perms, { hasOpenOffer: true });
    expect(waiting.some((action) => action.id === "make_offer")).toBe(false);
    expect(waiting.some((action) => action.id === "accept_offer")).toBe(false);
    expect(waiting.map((action) => action.id)).toEqual(
      expect.arrayContaining(["decline_offer", "withdraw_offer"]),
    );
    const pending = applicationWorkflowActionsForView("assessment_pending", perms, {
      hasScheduledAssessment: false,
    });
    expect(pending.some((action) => action.id === "complete_assessment")).toBe(false);
    const scheduled = applicationWorkflowActionsForView("assessment_pending", perms, {
      hasScheduledAssessment: true,
    });
    expect(scheduled.some((action) => action.id === "complete_assessment")).toBe(true);
  });

  it("hides decide actions from staff who can only manage applications", () => {
    const perms = ["admissions.applications.manage"];
    const visible = applicationWorkflowActions("under_review").filter((action) =>
      workflowActionVisible(action, perms),
    );
    expect(visible.map((action) => action.id)).toEqual([
      "request_information",
      "schedule_assessment",
      "withdraw",
    ]);
    expect(canUseAdministrativeCorrection(perms)).toBe(true);
    expect(canUseAdministrativeCorrection(["admissions.read"])).toBe(false);
  });

  it("blocks enrolled via the generic status path", () => {
    expect(() =>
      assertApplicationStatusTransition(actor(["admissions.decide"]), "accepted", "enrolled"),
    ).toThrow(/Enrolment must use the dedicated conversion endpoint/);
  });
});

describe("form reset after async submit", () => {
  it("resets a captured form even when currentTarget is later null", async () => {
    let calls = 0;
    const reset = () => {
      calls += 1;
    };
    const event = { currentTarget: { reset } };
    const { form } = { form: captureSubmitTarget(event) };
    event.currentTarget = null as unknown as { reset: () => void };
    await Promise.resolve();
    expect(() => event.currentTarget.reset()).toThrow();
    resetFormSafely(form);
    expect(calls).toBe(1);
    resetFormSafely(null);
    expect(calls).toBe(1);
  });
});
