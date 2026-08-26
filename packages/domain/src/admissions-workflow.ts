export const APPLICATION_STATUSES = [
  "enquiry",
  "draft",
  "submitted",
  "under_review",
  "information_required",
  "assessment_pending",
  "assessment_completed",
  "waiting_list",
  "offer_pending",
  "offer_made",
  "accepted",
  "deferred",
  "rejected",
  "withdrawn",
  "enrolled",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Canonical application status machine. Must stay aligned with
 * `admissions_status_transition_allowed` in the Phase 4 migration.
 * `enrolled` is reachable only through `enrol_admitted_applicant`.
 */
export const APPLICATION_STATUS_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  enquiry: ["draft", "submitted", "withdrawn"],
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "information_required", "assessment_pending", "withdrawn"],
  under_review: [
    "information_required",
    "assessment_pending",
    "offer_pending",
    "offer_made",
    "waiting_list",
    "rejected",
    "withdrawn",
    "deferred",
  ],
  information_required: ["submitted", "under_review", "withdrawn"],
  assessment_pending: ["assessment_completed", "under_review", "withdrawn", "rejected"],
  assessment_completed: ["under_review", "offer_pending", "offer_made", "waiting_list", "rejected", "withdrawn"],
  waiting_list: ["offer_pending", "offer_made", "under_review", "rejected", "withdrawn", "deferred"],
  offer_pending: ["offer_made", "waiting_list", "withdrawn", "rejected"],
  offer_made: ["accepted", "rejected", "withdrawn", "waiting_list"],
  accepted: ["withdrawn"],
  deferred: ["under_review", "waiting_list", "withdrawn", "rejected", "offer_pending"],
  rejected: ["under_review"],
  withdrawn: ["draft", "under_review"],
  enrolled: [],
};

export type ApplicationTransitionChannel =
  | "direct"
  | "assessment"
  | "waiting_list"
  | "offer"
  | "offer_response"
  | "enrol"
  | "illegal";

export type ApplicationWorkflowPermission = "applications.manage" | "offers.manage" | "decide" | "convert";

export type ApplicationWorkflowAction = {
  id: string;
  label: string;
  description: string;
  kind: Exclude<ApplicationTransitionChannel, "illegal">;
  toStatus?: ApplicationStatus;
  tone: "primary" | "secondary" | "danger";
  permission: ApplicationWorkflowPermission;
};

const DOMAIN_ACTION_STATUSES = new Set<ApplicationStatus>([
  "assessment_pending",
  "assessment_completed",
  "waiting_list",
  "offer_made",
  "accepted",
  "enrolled",
]);

export const APPLICATION_STAGE_COPY: Record<ApplicationStatus, string> = {
  enquiry: "Still an enquiry. Convert or submit before review, offer, or enrolment.",
  draft: "Staff-held draft. Submit it to begin review.",
  submitted: "Ready for review. Start review, request information, or schedule an assessment.",
  under_review: "In review. Next: information, assessment, waiting list, offer, reject, or withdraw.",
  information_required: "Waiting for further information. Return to review when the file is complete.",
  assessment_pending: "An assessment or interview is outstanding. Complete it, or return to review.",
  assessment_completed: "Assessment recorded. Make an offer, waitlist, reject, or return to review.",
  waiting_list: "On the waiting list. Make an offer, return to review, defer, reject, or withdraw.",
  offer_pending: "Offer is being prepared. Record the offer, waitlist, reject, or withdraw.",
  offer_made: "An offer is open. Record the applicant response, withdraw the offer, or waitlist.",
  accepted: "Offer accepted. Enrol the pupil to create the live student record.",
  deferred: "Deferred to a later intake. Return to review, waitlist, reject, or withdraw.",
  rejected: "Rejected. Reopen to under review if the decision is reversed.",
  withdrawn: "Withdrawn. Restore to draft or under review if the application resumes.",
  enrolled: "Enrolled. The application is retained as history and cannot change status here.",
};

const ACTIONS: Record<ApplicationStatus, readonly ApplicationWorkflowAction[]> = {
  enquiry: [
    action("submit", "Mark submitted", "direct", "submitted", "applications.manage", "Move this enquiry-stage record into a submitted application."),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  draft: [
    action("submit", "Mark submitted", "direct", "submitted", "applications.manage", "Submit the application so admissions staff can review it.", "primary"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  submitted: [
    action("start_review", "Start review", "direct", "under_review", "applications.manage", "Begin formal review of this application.", "primary"),
    action("request_information", "Request information", "direct", "information_required", "applications.manage", "Ask the applicant for missing information."),
    action("schedule_assessment", "Schedule assessment", "assessment", "assessment_pending", "applications.manage", "Book an interview, visit, or assessment."),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  under_review: [
    action("request_information", "Request information", "direct", "information_required", "applications.manage", "Pause review until further information is provided."),
    action("schedule_assessment", "Schedule assessment", "assessment", "assessment_pending", "applications.manage", "Book an interview, visit, or assessment."),
    action("waiting_list", "Place on waiting list", "waiting_list", "waiting_list", "decide", "Add this applicant to the active waiting list."),
    action("make_offer", "Make offer", "offer", "offer_made", "offers.manage", "Create an admissions offer with year group and dates.", "primary"),
    action("defer", "Defer", "direct", "deferred", "decide", "Defer this application to a later intake."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  information_required: [
    action("start_review", "Return to review", "direct", "under_review", "applications.manage", "Resume review now that information has been received.", "primary"),
    action("submit", "Mark submitted", "direct", "submitted", "applications.manage", "Return the file to submitted if it should re-enter the queue."),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  assessment_pending: [
    action("complete_assessment", "Record assessment outcome", "assessment", "assessment_completed", "applications.manage", "Complete the scheduled assessment and record a recommendation.", "primary"),
    action("start_review", "Return to review", "direct", "under_review", "applications.manage", "Return to review without completing the assessment."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  assessment_completed: [
    action("make_offer", "Make offer", "offer", "offer_made", "offers.manage", "Create an admissions offer with year group and dates.", "primary"),
    action("waiting_list", "Place on waiting list", "waiting_list", "waiting_list", "decide", "Add this applicant to the active waiting list."),
    action("start_review", "Return to review", "direct", "under_review", "applications.manage", "Return to review."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  waiting_list: [
    action("make_offer", "Make offer", "offer", "offer_made", "offers.manage", "Make an offer from the waiting list.", "primary"),
    action("start_review", "Return to review", "direct", "under_review", "applications.manage", "Take the applicant off the waiting list and resume review."),
    action("defer", "Defer", "direct", "deferred", "decide", "Defer this application to a later intake."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  offer_pending: [
    action("make_offer", "Make offer", "offer", "offer_made", "offers.manage", "Record the outstanding offer.", "primary"),
    action("waiting_list", "Place on waiting list", "waiting_list", "waiting_list", "decide", "Move this applicant to the waiting list instead."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  offer_made: [
    action("accept_offer", "Record accepted", "offer_response", "accepted", "offers.manage", "Record that the applicant accepted the open offer.", "primary"),
    action("decline_offer", "Record declined", "offer_response", "rejected", "offers.manage", "Record that the applicant declined. Optionally waitlist instead."),
    action("withdraw_offer", "Withdraw offer", "offer_response", "withdrawn", "offers.manage", "Withdraw the open offer. The application becomes withdrawn.", "danger"),
    action("waiting_list", "Place on waiting list", "waiting_list", "waiting_list", "decide", "Withdraw the current path and place the applicant on the waiting list."),
  ],
  accepted: [
    action("enrol", "Enrol pupil", "enrol", "enrolled", "convert", "Create the live pupil record. The application is kept as history.", "primary"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Withdraw after acceptance. Enrolment will no longer be available.", "danger"),
  ],
  deferred: [
    action("start_review", "Return to review", "direct", "under_review", "applications.manage", "Resume review for a later intake.", "primary"),
    action("waiting_list", "Place on waiting list", "waiting_list", "waiting_list", "decide", "Add this applicant to the waiting list."),
    action("reject", "Reject", "direct", "rejected", "decide", "Reject this application.", "danger"),
    action("withdraw", "Withdraw", "direct", "withdrawn", "applications.manage", "Close this application as withdrawn.", "danger"),
  ],
  rejected: [
    action("start_review", "Reopen review", "direct", "under_review", "decide", "Reverse the rejection and return to under review.", "primary"),
  ],
  withdrawn: [
    action("restore_draft", "Restore to draft", "direct", "draft", "applications.manage", "Reopen the application as a draft."),
    action("start_review", "Restore to review", "direct", "under_review", "applications.manage", "Reopen the application under review.", "primary"),
  ],
  enrolled: [],
};

function action(
  id: string,
  label: string,
  kind: ApplicationWorkflowAction["kind"],
  toStatus: ApplicationStatus | undefined,
  permission: ApplicationWorkflowPermission,
  description: string,
  tone: ApplicationWorkflowAction["tone"] = "secondary",
): ApplicationWorkflowAction {
  return { id, label, kind, toStatus, permission, description, tone };
}

export function allowedApplicationTransitions(from: ApplicationStatus): readonly ApplicationStatus[] {
  return APPLICATION_STATUS_TRANSITIONS[from] ?? [];
}

export function isApplicationStatusTransitionAllowed(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return true;
  return allowedApplicationTransitions(from).includes(to);
}

export function applicationTransitionChannel(
  from: ApplicationStatus,
  to: ApplicationStatus,
): ApplicationTransitionChannel {
  if (from === to) return "direct";
  if (!isApplicationStatusTransitionAllowed(from, to) && to !== "enrolled") return "illegal";
  if (to === "enrolled") return from === "accepted" || from === "enrolled" ? "enrol" : "illegal";
  if (to === "offer_made") return "offer";
  if (to === "accepted") return "offer_response";
  if (to === "waiting_list") return "waiting_list";
  if (to === "assessment_pending" || to === "assessment_completed") return "assessment";
  return "direct";
}

export function applicationWorkflowActions(from: ApplicationStatus): readonly ApplicationWorkflowAction[] {
  return ACTIONS[from] ?? [];
}

export function isDomainActionStatus(status: ApplicationStatus): boolean {
  return DOMAIN_ACTION_STATUSES.has(status);
}

export function directCorrectionStatuses(from: ApplicationStatus): readonly ApplicationStatus[] {
  return allowedApplicationTransitions(from).filter((to) => !DOMAIN_ACTION_STATUSES.has(to));
}

export function workflowActionVisible(
  action: ApplicationWorkflowAction,
  permissions: readonly string[],
): boolean {
  const set = new Set(permissions);
  const decide = set.has("admissions.decide");
  switch (action.permission) {
    case "applications.manage":
      return decide || set.has("admissions.applications.manage");
    case "offers.manage":
      return decide || set.has("admissions.offers.manage");
    case "decide":
      return decide;
    case "convert":
      return set.has("admissions.convert");
    default:
      return false;
  }
}

export function canUseAdministrativeCorrection(permissions: readonly string[]): boolean {
  return permissions.includes("admissions.decide") || permissions.includes("admissions.applications.manage");
}

export type ApplicationWorkflowViewContext = {
  hasOpenOffer?: boolean;
  hasScheduledAssessment?: boolean;
};

export function applicationWorkflowActionsForView(
  status: ApplicationStatus,
  permissions: readonly string[],
  context: ApplicationWorkflowViewContext = {},
): ApplicationWorkflowAction[] {
  let actions = applicationWorkflowActions(status).filter((action) => workflowActionVisible(action, permissions));
  if (context.hasOpenOffer) {
    actions = actions.filter((action) => action.id !== "make_offer");
    const existing = new Set(actions.map((action) => action.id));
    const offerResponses = applicationWorkflowActions("offer_made").filter((action) => {
      if (action.id !== "accept_offer" && action.id !== "decline_offer" && action.id !== "withdraw_offer") {
        return false;
      }
      if (!workflowActionVisible(action, permissions) || existing.has(action.id)) return false;
      if (action.id === "accept_offer") return isApplicationStatusTransitionAllowed(status, "accepted");
      if (action.id === "decline_offer") {
        return isApplicationStatusTransitionAllowed(status, "rejected") || status === "waiting_list";
      }
      return true;
    });
    actions = [...offerResponses, ...actions];
  }
  if (!context.hasScheduledAssessment) {
    actions = actions.filter((action) => action.id !== "complete_assessment");
  }
  return actions;
}
