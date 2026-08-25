"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  APPLICATION_STAGE_COPY,
  ASSESSMENT_RECOMMENDATIONS,
  ASSESSMENT_TYPES,
  applicationWorkflowActionsForView,
  canUseAdministrativeCorrection,
  captureSubmitTarget,
  directCorrectionStatuses,
  formatStatusLabel,
  resetFormSafely,
  type ApplicationStatus,
  type ApplicationWorkflowAction,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { formatDate, formatDateTime } from "../../../../../lib/dates";
import { userFacingError } from "../../../../../lib/errors";
import type { ApplicationAssessment, ApplicationContact, ApplicationDetail, ApplicationOffer, Option } from "./types";

type Panel =
  | "request_information"
  | "schedule_assessment"
  | "complete_assessment"
  | "waiting_list"
  | "make_offer"
  | "accept_offer"
  | "decline_offer"
  | "withdraw_offer"
  | "enrol"
  | "submit"
  | "start_review"
  | "defer"
  | "reject"
  | "withdraw"
  | "restore_draft"
  | "correction"
  | null;

export function ApplicationWorkflowPanel({
  data,
  years,
  groups,
  classes,
  permissions,
  onReload,
}: {
  data: ApplicationDetail;
  years: Option[];
  groups: Option[];
  classes: Option[];
  permissions: string[];
  onReload: () => Promise<void>;
}) {
  const app = data.application;
  const status = app.status as ApplicationStatus;
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [waitlistOnDecline, setWaitlistOnDecline] = useState(false);

  const openOffer = data.offers.find((offer) => offer.status === "made") ?? null;
  const currentOffer = openOffer ?? data.offers[0] ?? null;
  const openAssessment = data.assessments.find((item) => item.status === "scheduled") ?? null;
  const guardians = data.contacts.filter((contact) => !contact.isEmergency);
  const canCorrect = canUseAdministrativeCorrection(permissions);

  const actions = useMemo(
    () =>
      applicationWorkflowActionsForView(status, permissions, {
        hasOpenOffer: Boolean(openOffer),
        hasScheduledAssessment: Boolean(openAssessment),
      }),
    [status, permissions, openOffer, openAssessment],
  );
  const correctionStatuses = useMemo(() => directCorrectionStatuses(status), [status]);

  async function run(label: string, work: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setMessage("");
    setFieldError("");
    try {
      const result = await work();
      setMessage(result || label);
      setPanel(null);
      await onReload();
    } catch (err) {
      setError(userFacingError(err, "That action could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: ApplicationStatus, reason?: string) {
    await api(`/api/v1/admissions/applications/${app.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: next, reason: reason || undefined }),
    });
  }

  function openAction(action: ApplicationWorkflowAction) {
    setError("");
    setFieldError("");
    setPanel(action.id as Panel);
  }

  async function onDirectStatus(event: FormEvent<HTMLFormElement>, next: ApplicationStatus, success: string) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    await run(success, () => changeStatus(next, reason));
  }

  async function onSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    const scheduledAt = String(payload.get("scheduledAt") ?? "");
    if (!scheduledAt) {
      setFieldError("Choose a date and time to schedule this assessment.");
      return;
    }
    await run("Assessment scheduled.", async () => {
      await api(`/api/v1/admissions/applications/${app.id}/assessments`, {
        method: "POST",
        body: JSON.stringify({
          assessmentType: payload.get("assessmentType"),
          scheduledAt: new Date(scheduledAt).toISOString(),
          notes: payload.get("notes") || undefined,
        }),
      });
      resetFormSafely(form);
    });
  }

  async function onCompleteAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openAssessment) return;
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    await run("Assessment outcome recorded.", async () => {
      await api(`/api/v1/admissions/assessments/${openAssessment.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          outcome: payload.get("outcome") || undefined,
          recommendation: payload.get("recommendation") || undefined,
        }),
      });
    });
  }

  async function onWaitingList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const notes = String(new FormData(form).get("notes") ?? "").trim();
    await run("Placed on waiting list.", async () => {
      await api(`/api/v1/admissions/applications/${app.id}/waiting-list`, {
        method: "POST",
        body: JSON.stringify({ notes: notes || undefined }),
      });
    });
  }

  async function onMakeOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    const offeredAcademicYearId = String(payload.get("offeredAcademicYearId") ?? "");
    const offeredYearGroupId = String(payload.get("offeredYearGroupId") ?? "");
    const responseDeadline = String(payload.get("responseDeadline") ?? "");
    if (!offeredAcademicYearId || !offeredYearGroupId) {
      setFieldError("Choose the offered academic year and year group.");
      return;
    }
    if (!responseDeadline) {
      setFieldError("Set a response deadline for this offer.");
      return;
    }
    await run("Offer recorded.", async () => {
      await api(`/api/v1/admissions/applications/${app.id}/offers`, {
        method: "POST",
        body: JSON.stringify({
          offeredAcademicYearId,
          offeredYearGroupId,
          intendedStartDate: payload.get("intendedStartDate") || undefined,
          responseDeadline,
          notes: payload.get("notes") || undefined,
        }),
      });
      resetFormSafely(form);
    });
  }

  async function onOfferDecision(next: "accepted" | "declined" | "withdrawn") {
    if (!openOffer || openOffer.status !== "made") {
      setError("There is no open offer to update.");
      return;
    }
    await run(
      next === "accepted" ? "Offer accepted." : next === "declined" ? "Offer declined." : "Offer withdrawn.",
      async () => {
        await api(`/api/v1/admissions/offers/${openOffer.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: next,
            waitlistOnDecline: next === "declined" ? waitlistOnDecline : undefined,
          }),
        });
      },
    );
  }

  async function onEnrol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    const guardianLinks = guardians
      .filter((contact) => payload.get(`link-${contact.id}`) === "on")
      .map((contact) => ({
        contactId: contact.id,
        portalAccess: payload.get(`portal-${contact.id}`) === "on",
      }));
    await run("Applicant enrolled.", async () => {
      const body = await api<{ studentProfileId: string }>(`/api/v1/admissions/applications/${app.id}/enrol`, {
        method: "POST",
        body: JSON.stringify({
          academicYearId: payload.get("academicYearId") || undefined,
          yearGroupId: payload.get("yearGroupId") || undefined,
          classId: payload.get("classId") || undefined,
          admissionNumber: payload.get("admissionNumber") || undefined,
          guardianLinks,
        }),
      });
      return `Applicant enrolled. Pupil record ${body.studentProfileId} is ready.`;
    });
  }

  async function onCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    const next = String(payload.get("status") ?? "") as ApplicationStatus;
    if (!next || next === status) {
      setFieldError("Choose a different status.");
      return;
    }
    await run("Status updated.", () => changeStatus(next, String(payload.get("reason") ?? "")));
  }

  const dialogTitle: Record<Exclude<Panel, null>, string> = {
    request_information: "Request information",
    schedule_assessment: "Schedule assessment",
    complete_assessment: "Record assessment outcome",
    waiting_list: "Place on waiting list",
    make_offer: "Make offer",
    accept_offer: "Record accepted",
    decline_offer: "Record declined",
    withdraw_offer: "Withdraw offer",
    enrol: "Enrol pupil",
    submit: "Mark submitted",
    start_review: status === "rejected" ? "Reopen review" : status === "withdrawn" ? "Restore to review" : "Start review",
    defer: "Defer application",
    reject: "Reject application",
    withdraw: "Withdraw application",
    restore_draft: "Restore to draft",
    correction: "Administrative status correction",
  };

  return (
    <aside className="record-sidebar workflow-panel">
      <section className="section-card">
        <h2 style={{ margin: 0 }}>Application workflow</h2>
        <p className="muted" style={{ margin: "0.35rem 0 0.75rem" }}>
          {APPLICATION_STAGE_COPY[status]}
        </p>
        <p>
          <StatusBadge status={status} />
        </p>

        {currentOffer ? (
          <div className="offer-summary">
            <h3 style={{ margin: 0 }}>Offer</h3>
            <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>
              <StatusBadge status={currentOffer.status} />
            </p>
            <dl className="profile-list">
              <div>
                <dt>Year group</dt>
                <dd>{currentOffer.offeredYearGroupName ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Intake</dt>
                <dd>{currentOffer.offeredAcademicYearName ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Start date</dt>
                <dd>{formatDate(currentOffer.intendedStartDate) || "Not provided"}</dd>
              </div>
              <div>
                <dt>Response deadline</dt>
                <dd>{formatDate(currentOffer.responseDeadline) || "Not provided"}</dd>
              </div>
              <div>
                <dt>Made</dt>
                <dd>{formatDate(currentOffer.offerMadeOn)}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {openAssessment && status === "assessment_pending" ? (
          <p className="muted">
            {formatStatusLabel(openAssessment.assessmentType)} · {formatDateTime(openAssessment.scheduledAt) || "Date not set"}
          </p>
        ) : null}

        {app.status === "enrolled" ? (
          <p className="muted">
            Enrolled. Status can no longer be changed here.
            {app.convertedStudentProfileId ? (
              <>
                {" "}
                <a href={`/school/students/${app.convertedStudentProfileId}`}>Open pupil record</a>
              </>
            ) : null}
          </p>
        ) : (
          <div className="workflow-actions">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant={action.tone === "danger" ? "danger" : action.tone === "primary" ? "primary" : "secondary"}
                disabled={busy}
                title={action.description}
                onClick={() => openAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {canCorrect && correctionStatuses.length > 0 && app.status !== "enrolled" ? (
          <p style={{ marginTop: "0.85rem" }}>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setPanel("correction")}>
              Administrative correction
            </Button>
          </p>
        ) : null}

        {message ? (
          <Alert tone="success">{message}</Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </section>

      <ScheduledList assessments={data.assessments} offers={data.offers} />

      <Dialog
        open={panel !== null}
        title={panel ? dialogTitle[panel] : ""}
        description={actions.find((action) => action.id === panel)?.description}
        onClose={() => !busy && setPanel(null)}
      >
        {fieldError ? <p className="error">{fieldError}</p> : null}
        {error && panel ? <Alert tone="danger">{error}</Alert> : null}

        {panel === "schedule_assessment" ? (
          <form className="form-grid" onSubmit={onSchedule}>
            <FormField label="Type" htmlFor="assessmentType">
              <Select id="assessmentType" name="assessmentType" required>
                {ASSESSMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatStatusLabel(type)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Scheduled" htmlFor="scheduledAt" error={fieldError || undefined}>
              <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required />
            </FormField>
            <FormField label="Notes" htmlFor="assessmentNotes">
              <Input id="assessmentNotes" name="notes" />
            </FormField>
            <div className="span-2 dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Schedule
              </Button>
            </div>
          </form>
        ) : null}

        {panel === "complete_assessment" ? (
          openAssessment ? (
            <form className="stack" onSubmit={onCompleteAssessment}>
              <p>
                {formatStatusLabel(openAssessment.assessmentType)} ·{" "}
                {formatDateTime(openAssessment.scheduledAt) || "Unscheduled"}
              </p>
              <FormField label="Outcome" htmlFor="outcome">
                <Textarea id="outcome" name="outcome" />
              </FormField>
              <FormField label="Recommendation" htmlFor="recommendation">
                <Select id="recommendation" name="recommendation">
                  <option value="">Undecided</option>
                  {ASSESSMENT_RECOMMENDATIONS.map((item) => (
                    <option key={item} value={item}>
                      {formatStatusLabel(item)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="dialog-actions">
                <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  Record outcome
                </Button>
              </div>
            </form>
          ) : (
            <p className="muted">No scheduled assessment was found on this application.</p>
          )
        ) : null}

        {panel === "waiting_list" ? (
          <form className="stack" onSubmit={onWaitingList}>
            <FormField label="Note" htmlFor="waitNotes">
              <Input id="waitNotes" name="notes" />
            </FormField>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Place on waiting list
              </Button>
            </div>
          </form>
        ) : null}

        {panel === "make_offer" ? (
          <form className="form-grid" onSubmit={onMakeOffer}>
            <FormField label="Offered year" htmlFor="offeredAcademicYearId">
              <Select
                id="offeredAcademicYearId"
                name="offeredAcademicYearId"
                required
                defaultValue={app.intendedAcademicYearId ?? ""}
              >
                <option value="">Select</option>
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Offered year group" htmlFor="offeredYearGroupId">
              <Select
                id="offeredYearGroupId"
                name="offeredYearGroupId"
                required
                defaultValue={app.intendedYearGroupId ?? ""}
              >
                <option value="">Select</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Start date" htmlFor="intendedStartDate">
              <Input
                id="intendedStartDate"
                name="intendedStartDate"
                type="date"
                defaultValue={app.intendedEntryDate ?? ""}
              />
            </FormField>
            <FormField label="Response deadline" htmlFor="responseDeadline">
              <Input id="responseDeadline" name="responseDeadline" type="date" required />
            </FormField>
            <FormField label="Notes" htmlFor="offerNotes">
              <Input id="offerNotes" name="notes" />
            </FormField>
            <div className="span-2 dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Make offer
              </Button>
            </div>
          </form>
        ) : null}

        {panel === "accept_offer" || panel === "decline_offer" || panel === "withdraw_offer" ? (
          <div className="stack">
            {panel === "decline_offer" ? (
              <Checkbox
                label="Place on waiting list instead of rejecting"
                checked={waitlistOnDecline}
                onChange={(event) => setWaitlistOnDecline(event.target.checked)}
              />
            ) : null}
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={panel === "accept_offer" ? "primary" : "danger"}
                disabled={busy || !openOffer || openOffer.status !== "made"}
                onClick={() =>
                  onOfferDecision(
                    panel === "accept_offer" ? "accepted" : panel === "decline_offer" ? "declined" : "withdrawn",
                  )
                }
              >
                {panel === "accept_offer" ? "Record accepted" : panel === "decline_offer" ? "Record declined" : "Withdraw offer"}
              </Button>
            </div>
          </div>
        ) : null}

        {panel === "enrol" ? (
          app.convertedStudentProfileId ? (
            <p>
              Already enrolled. <a href={`/school/students/${app.convertedStudentProfileId}`}>Open pupil record</a>
            </p>
          ) : (
            <EnrolForm
              app={app}
              years={years}
              groups={groups}
              classes={classes}
              guardians={guardians}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSubmit={onEnrol}
            />
          )
        ) : null}

        {panel === "request_information" ||
        panel === "submit" ||
        panel === "start_review" ||
        panel === "defer" ||
        panel === "reject" ||
        panel === "withdraw" ||
        panel === "restore_draft" ? (
          <DirectStatusForm
            busy={busy}
            danger={panel === "reject" || panel === "withdraw"}
            confirmLabel={dialogTitle[panel]}
            onCancel={() => setPanel(null)}
            onSubmit={(event) =>
              onDirectStatus(
                event,
                (
                  {
                    request_information: "information_required",
                    submit: "submitted",
                    start_review: "under_review",
                    defer: "deferred",
                    reject: "rejected",
                    withdraw: "withdrawn",
                    restore_draft: "draft",
                  } as const
                )[panel],
                `${dialogTitle[panel]}.`,
              )
            }
          />
        ) : null}

        {panel === "correction" ? (
          <form className="form-grid" onSubmit={onCorrection}>
            <FormField label="New status" htmlFor="correctionStatus">
              <Select id="correctionStatus" name="status" required defaultValue="">
                <option value="">Select a legal status</option>
                {correctionStatuses.map((item) => (
                  <option key={item} value={item}>
                    {formatStatusLabel(item)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Reason / note" htmlFor="correctionReason">
              <Input id="correctionReason" name="reason" />
            </FormField>
            <div className="span-2 dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Update status
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </aside>
  );
}

function DirectStatusForm({
  busy,
  danger,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  danger?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="stack" onSubmit={onSubmit}>
      <FormField label="Reason / note" htmlFor="statusReason">
        <Input id="statusReason" name="reason" />
      </FormField>
      <div className="dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

function EnrolForm({
  app,
  years,
  groups,
  classes,
  guardians,
  busy,
  onCancel,
  onSubmit,
}: {
  app: ApplicationDetail["application"];
  years: Option[];
  groups: Option[];
  classes: Option[];
  guardians: ApplicationContact[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="stack" onSubmit={onSubmit}>
      <p className="muted">
        This creates or reuses the live pupil record. The application stays as admissions history. Parent portal
        access is not granted unless you tick it below.
      </p>
      <div className="form-grid">
        <FormField label="Academic year" htmlFor="enrolYear">
          <Select id="enrolYear" name="academicYearId" defaultValue={app.intendedAcademicYearId ?? ""}>
            <option value="">Select</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Year group" htmlFor="enrolGroup">
          <Select id="enrolGroup" name="yearGroupId" defaultValue={app.intendedYearGroupId ?? ""}>
            <option value="">Select</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Form class" htmlFor="enrolClass">
          <Select id="enrolClass" name="classId">
            <option value="">None</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Admission number" htmlFor="enrolAdmission">
          <Input id="enrolAdmission" name="admissionNumber" />
        </FormField>
      </div>
      {guardians.map((contact) => (
        <div key={contact.id} className="stack">
          <Checkbox name={`link-${contact.id}`} label={`Create guardianship for ${contact.fullName}`} defaultChecked={Boolean(contact.email)} />
          <Checkbox name={`portal-${contact.id}`} label={`Enable parent portal access for ${contact.fullName}`} />
        </div>
      ))}
      <div className="dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Enrol pupil
        </Button>
      </div>
    </form>
  );
}

function ScheduledList({
  assessments,
  offers,
}: {
  assessments: ApplicationAssessment[];
  offers: ApplicationOffer[];
}) {
  if (assessments.length === 0 && offers.length <= 1) return null;
  return (
    <section className="section-card">
      {assessments.length > 0 ? (
        <>
          <h3>Assessments</h3>
          <ul className="timeline">
            {assessments.map((item) => (
              <li key={item.id} className="timeline-item">
                <strong>
                  {formatStatusLabel(item.assessmentType)} · <StatusBadge status={item.status} />
                </strong>
                <span className="muted">{formatDateTime(item.scheduledAt) || "Date not set"}</span>
                {item.recommendation ? <p>{formatStatusLabel(item.recommendation)}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {offers.length > 1 ? (
        <>
          <h3>Previous offers</h3>
          <ul className="timeline">
            {offers.slice(1).map((offer) => (
              <li key={offer.id} className="timeline-item">
                <strong>
                  <StatusBadge status={offer.status} />
                </strong>
                <span className="muted">
                  Made {formatDate(offer.offerMadeOn)}
                  {offer.responseDeadline ? ` · deadline ${formatDate(offer.responseDeadline)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
