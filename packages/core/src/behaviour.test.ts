import { describe, expect, it } from "vitest";
import {
  auditSafeSafeguardingAfter,
  buildSafeguardingAttachmentKey,
  isActionStatusTransitionAllowed,
  isIncidentStatusTransitionAllowed,
  isPastoralStatusTransitionAllowed,
  isSafeguardingStatusTransitionAllowed,
  pastoralNotificationBody,
  safeguardingNotificationBody,
} from "./behaviour.js";

describe("behaviour / pastoral / safeguarding domain", () => {
  it("allows the incident lifecycle and blocks closed reopen", () => {
    expect(isIncidentStatusTransitionAllowed("open", "in_progress")).toBe(true);
    expect(isIncidentStatusTransitionAllowed("in_progress", "resolved")).toBe(true);
    expect(isIncidentStatusTransitionAllowed("resolved", "closed")).toBe(true);
    expect(isIncidentStatusTransitionAllowed("resolved", "open")).toBe(true);
    expect(isIncidentStatusTransitionAllowed("closed", "open")).toBe(false);
  });

  it("keeps action completions terminal", () => {
    expect(isActionStatusTransitionAllowed("planned", "completed")).toBe(true);
    expect(isActionStatusTransitionAllowed("completed", "planned")).toBe(false);
    expect(isActionStatusTransitionAllowed("cancelled", "planned")).toBe(false);
  });

  it("allows pastoral monitoring without treating it as behaviour", () => {
    expect(isPastoralStatusTransitionAllowed("open", "monitoring")).toBe(true);
    expect(isPastoralStatusTransitionAllowed("monitoring", "resolved")).toBe(true);
    expect(isPastoralStatusTransitionAllowed("closed", "open")).toBe(false);
  });

  it("keeps safeguarding status moves conservative", () => {
    expect(isSafeguardingStatusTransitionAllowed("open", "referred_internal")).toBe(true);
    expect(isSafeguardingStatusTransitionAllowed("referred_internal", "closed")).toBe(true);
    expect(isSafeguardingStatusTransitionAllowed("closed", "open")).toBe(false);
  });

  it("omits narrative from safeguarding audit metadata", () => {
    expect(
      auditSafeSafeguardingAfter({
        id: "concern-1",
        studentProfileId: "pupil-1",
        status: "open",
        assignedUserId: "dsl-1",
      }),
    ).toEqual({
      id: "concern-1",
      studentProfileId: "pupil-1",
      status: "open",
      categoryId: null,
      assignedUserId: "dsl-1",
    });
    expect(JSON.stringify(auditSafeSafeguardingAfter({
      id: "concern-1",
      studentProfileId: "pupil-1",
    }))).not.toMatch(/description|note|narrative/i);
  });

  it("keeps assignment notifications free of concern text", () => {
    expect(safeguardingNotificationBody("assigned")).toBe("A safeguarding item has been assigned to you.");
    expect(pastoralNotificationBody("assigned")).toBe("A pastoral item has been assigned to you.");
    expect(safeguardingNotificationBody("assigned")).not.toMatch(/disclos|injur|home/i);
  });

  it("builds safeguarding storage keys outside the generic student-document path", () => {
    expect(
      buildSafeguardingAttachmentKey({
        organisationId: "org-1",
        concernId: "concern-1",
        attachmentId: "att-1",
        filename: "note.pdf",
      }),
    ).toBe("org/org-1/safeguarding/concern-1/att-1/note.pdf");
  });
});
