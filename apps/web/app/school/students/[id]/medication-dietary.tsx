"use client";

import { FormEvent, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  FormField,
  FormSection,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";

export type MedicationRecord = {
  id: string;
  medicationName: string;
  dosage: string | null;
  route: string;
  scheduleText: string | null;
  isPrn: boolean;
  startedOn: string | null;
  endedOn: string | null;
  instructions: string | null;
  administrationResponsibility: string;
  parentConsentStatus: string;
  parentConsentOn: string | null;
  reviewOn: string | null;
  status: string;
  stoppedReason: string | null;
  parentVisible?: boolean;
  internalNotes?: string | null;
  revisions?: Array<{ id: string; changeKind: string; changedFields: string[]; createdAt: string }>;
};

export type DietaryRecord = {
  id: string;
  requirementType: string;
  requirement: string;
  foodsToAvoid: string | null;
  safeAlternatives: string | null;
  isReligiousOrCultural: boolean;
  relatedAllergy: string | null;
  textureFeedingNotes: string | null;
  parentConfirmedOn: string | null;
  reviewOn: string | null;
  status: string;
  endedOn: string | null;
  parentVisible?: boolean;
  internalNotes?: string | null;
  revisions?: Array<{ id: string; changeKind: string; changedFields: string[]; createdAt: string }>;
};

export function MedicationDietarySections({
  studentId,
  view,
  canManage,
  medications,
  dietaryRequirements,
  onChanged,
}: {
  studentId: string;
  view: "full" | "operational" | "parent";
  canManage: boolean;
  medications: MedicationRecord[];
  dietaryRequirements: DietaryRecord[];
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [editingMedicationId, setEditingMedicationId] = useState<string | null>(null);
  const [editingDietaryId, setEditingDietaryId] = useState<string | null>(null);
  const full = view === "full";

  async function submitMedication(event: FormEvent<HTMLFormElement>, medicationId?: string) {
    event.preventDefault();
    setError("");
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    const payload = {
      medicationName: String(form.get("medicationName") ?? ""),
      dosage: String(form.get("dosage") || "") || null,
      route: String(form.get("route") || "other"),
      scheduleText: String(form.get("scheduleText") || "") || null,
      isPrn: form.get("isPrn") === "on",
      startedOn: String(form.get("startedOn") || "") || null,
      instructions: String(form.get("instructions") || "") || null,
      administrationResponsibility: String(form.get("administrationResponsibility") || "school_staff"),
      parentConsentStatus: String(form.get("parentConsentStatus") || "pending"),
      parentConsentOn: String(form.get("parentConsentOn") || "") || null,
      reviewOn: String(form.get("reviewOn") || "") || null,
      internalNotes: full ? String(form.get("internalNotes") || "") || null : undefined,
      parentVisible: full ? form.get("parentVisible") === "on" : undefined,
    };
    try {
      if (medicationId) {
        await api(`/api/v1/students/${studentId}/medications/${medicationId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setEditingMedicationId(null);
      } else {
        await api(`/api/v1/students/${studentId}/medications`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        resetFormSafely(formEl);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save medication");
    }
  }

  async function stopMedication(medicationId: string) {
    setError("");
    try {
      await api(`/api/v1/students/${studentId}/medications/${medicationId}/stop`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop medication");
    }
  }

  async function submitDietary(event: FormEvent<HTMLFormElement>, dietaryId?: string) {
    event.preventDefault();
    setError("");
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    const payload = {
      requirementType: String(form.get("requirementType") || "other"),
      requirement: String(form.get("requirement") ?? ""),
      foodsToAvoid: String(form.get("foodsToAvoid") || "") || null,
      safeAlternatives: String(form.get("safeAlternatives") || "") || null,
      isReligiousOrCultural: form.get("isReligiousOrCultural") === "on",
      relatedAllergy: String(form.get("relatedAllergy") || "") || null,
      textureFeedingNotes: String(form.get("textureFeedingNotes") || "") || null,
      parentConfirmedOn: String(form.get("parentConfirmedOn") || "") || null,
      reviewOn: String(form.get("reviewOn") || "") || null,
      internalNotes: full ? String(form.get("internalNotes") || "") || null : undefined,
      parentVisible: full ? form.get("parentVisible") === "on" : undefined,
    };
    try {
      if (dietaryId) {
        await api(`/api/v1/students/${studentId}/dietary-requirements/${dietaryId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setEditingDietaryId(null);
      } else {
        await api(`/api/v1/students/${studentId}/dietary-requirements`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        resetFormSafely(formEl);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save dietary requirement");
    }
  }

  async function stopDietary(dietaryId: string) {
    setError("");
    try {
      await api(`/api/v1/students/${studentId}/dietary-requirements/${dietaryId}/stop`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop dietary requirement");
    }
  }

  const activeMeds = medications.filter((row) => row.status === "active");
  const previousMeds = medications.filter((row) => row.status !== "active");
  const activeDiet = dietaryRequirements.filter((row) => row.status === "active");
  const previousDiet = dietaryRequirements.filter((row) => row.status !== "active");

  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <FormSection
        title="Medication"
        description={
          canManage
            ? "Canonical medication records for this pupil. Stopping a record keeps history."
            : "Operational medication information you are permitted to see. Internal notes are not included."
        }
      >
        <div id="medication" className="span-2 health-records">
          {activeMeds.length === 0 ? (
            <EmptyState title="No active medication" description="Active medication records will appear here." />
          ) : (
            activeMeds.map((row) => (
              <article key={row.id} className="health-record" data-testid="medication-record">
                <header>
                  <h3>{row.medicationName}</h3>
                  <StatusBadge status={row.status} />
                </header>
                <dl>
                  <div><dt>Dosage</dt><dd>{row.dosage ?? "—"}</dd></div>
                  <div><dt>Route</dt><dd>{row.route}</dd></div>
                  <div><dt>Schedule</dt><dd>{row.isPrn ? `PRN / as required${row.scheduleText ? ` · ${row.scheduleText}` : ""}` : (row.scheduleText ?? "—")}</dd></div>
                  <div><dt>Administered by</dt><dd>{row.administrationResponsibility.replaceAll("_", " ")}</dd></div>
                  <div><dt>Consent</dt><dd>{row.parentConsentStatus.replaceAll("_", " ")}{row.parentConsentOn ? ` · ${row.parentConsentOn}` : ""}</dd></div>
                  <div><dt>Review</dt><dd>{row.reviewOn ?? "—"}</dd></div>
                </dl>
                {row.instructions ? <p>{row.instructions}</p> : null}
                {full && row.internalNotes ? <p className="muted">Internal notes: {row.internalNotes}</p> : null}
                {full && row.revisions && row.revisions.length > 0 ? (
                  <p className="muted">History: {row.revisions.length} previous change{row.revisions.length === 1 ? "" : "s"} preserved</p>
                ) : null}
                {canManage ? (
                  <div className="health-record-actions">
                    <Button type="button" variant="secondary" onClick={() => setEditingMedicationId(row.id)}>
                      Edit
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => stopMedication(row.id)}>
                      Stop
                    </Button>
                  </div>
                ) : null}
                {canManage && editingMedicationId === row.id ? (
                  <MedicationForm
                    key={row.id}
                    record={row}
                    full={full}
                    submitLabel="Save medication"
                    onSubmit={(event) => submitMedication(event, row.id)}
                    onCancel={() => setEditingMedicationId(null)}
                  />
                ) : null}
              </article>
            ))
          )}
          {previousMeds.length > 0 ? (
            <div className="health-history">
              <h3>Previous medication</h3>
              {previousMeds.map((row) => (
                <article key={row.id} className="health-record is-stopped" data-testid="medication-history">
                  <header>
                    <h3>{row.medicationName}</h3>
                    <StatusBadge status={row.status} />
                  </header>
                  <p className="muted">
                    {row.dosage ?? "—"} · {row.route} · {row.startedOn ?? "—"} to {row.endedOn ?? "—"}
                    {row.stoppedReason ? ` · ${row.stoppedReason}` : ""}
                  </p>
                  {full && row.revisions && row.revisions.length > 0 ? (
                    <p className="muted">History preserved ({row.revisions.length} change{row.revisions.length === 1 ? "" : "s"})</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
          {canManage && !editingMedicationId ? (
            <MedicationForm full={full} submitLabel="Add medication" onSubmit={(event) => submitMedication(event)} />
          ) : null}
        </div>
      </FormSection>

      <FormSection
        title="Dietary requirements"
        description={
          canManage
            ? "Canonical dietary records for this pupil. Deactivating a record keeps history."
            : "Operational dietary information you are permitted to see. Internal notes are not included."
        }
      >
        <div id="dietary" className="span-2 health-records">
          {activeDiet.length === 0 ? (
            <EmptyState title="No active dietary requirements" description="Active dietary records will appear here." />
          ) : (
            activeDiet.map((row) => (
              <article key={row.id} className="health-record" data-testid="dietary-record">
                <header>
                  <h3>{row.requirement}</h3>
                  <StatusBadge status={row.status} />
                </header>
                <dl>
                  <div><dt>Type</dt><dd>{row.requirementType}{row.isReligiousOrCultural ? " · religious/cultural" : ""}</dd></div>
                  <div><dt>Foods to avoid</dt><dd>{row.foodsToAvoid ?? "—"}</dd></div>
                  <div><dt>Safe alternatives</dt><dd>{row.safeAlternatives ?? "—"}</dd></div>
                  <div><dt>Allergy link</dt><dd>{row.relatedAllergy ?? "—"}</dd></div>
                  <div><dt>Texture / feeding</dt><dd>{row.textureFeedingNotes ?? "—"}</dd></div>
                  <div><dt>Parent confirmed</dt><dd>{row.parentConfirmedOn ?? "—"}</dd></div>
                </dl>
                {full && row.internalNotes ? <p className="muted">Internal notes: {row.internalNotes}</p> : null}
                {canManage ? (
                  <div className="health-record-actions">
                    <Button type="button" variant="secondary" onClick={() => setEditingDietaryId(row.id)}>
                      Edit
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => stopDietary(row.id)}>
                      Stop
                    </Button>
                  </div>
                ) : null}
                {canManage && editingDietaryId === row.id ? (
                  <DietaryForm
                    key={row.id}
                    record={row}
                    full={full}
                    submitLabel="Save dietary requirement"
                    onSubmit={(event) => submitDietary(event, row.id)}
                    onCancel={() => setEditingDietaryId(null)}
                  />
                ) : null}
              </article>
            ))
          )}
          {previousDiet.length > 0 ? (
            <div className="health-history">
              <h3>Previous dietary requirements</h3>
              {previousDiet.map((row) => (
                <article key={row.id} className="health-record is-stopped" data-testid="dietary-history">
                  <header>
                    <h3>{row.requirement}</h3>
                    <StatusBadge status={row.status} />
                  </header>
                  <p className="muted">{row.requirementType} · ended {row.endedOn ?? "—"}</p>
                </article>
              ))}
            </div>
          ) : null}
          {canManage && !editingDietaryId ? (
            <DietaryForm full={full} submitLabel="Add dietary requirement" onSubmit={(event) => submitDietary(event)} />
          ) : null}
        </div>
      </FormSection>
    </>
  );
}

function MedicationForm({
  record,
  full,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  record?: MedicationRecord;
  full: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  return (
    <form className="health-form" onSubmit={onSubmit}>
      <FormField label="Medication name">
        <Input name="medicationName" required defaultValue={record?.medicationName ?? ""} />
      </FormField>
      <FormField label="Dosage">
        <Input name="dosage" defaultValue={record?.dosage ?? ""} />
      </FormField>
      <FormField label="Route">
        <Select name="route" defaultValue={record?.route ?? "oral"}>
          <option value="oral">Oral</option>
          <option value="inhaled">Inhaled</option>
          <option value="topical">Topical</option>
          <option value="injection">Injection</option>
          <option value="buccal">Buccal</option>
          <option value="other">Other</option>
        </Select>
      </FormField>
      <FormField label="Schedule / time to administer">
        <Input name="scheduleText" defaultValue={record?.scheduleText ?? ""} />
      </FormField>
      <Checkbox name="isPrn" label="PRN / as required" defaultChecked={record?.isPrn ?? false} />
      <FormField label="Start date">
        <Input type="date" name="startedOn" defaultValue={record?.startedOn ?? ""} />
      </FormField>
      <FormField label="Instructions">
        <Textarea name="instructions" rows={3} defaultValue={record?.instructions ?? ""} />
      </FormField>
      <FormField label="Administration responsibility">
        <Select name="administrationResponsibility" defaultValue={record?.administrationResponsibility ?? "school_staff"}>
          <option value="school_staff">School staff</option>
          <option value="parent">Parent</option>
          <option value="pupil">Pupil</option>
          <option value="shared">Shared</option>
          <option value="other">Other</option>
        </Select>
      </FormField>
      <FormField label="Parent consent">
        <Select name="parentConsentStatus" defaultValue={record?.parentConsentStatus ?? "pending"}>
          <option value="pending">Pending</option>
          <option value="granted">Granted</option>
          <option value="declined">Declined</option>
          <option value="not_required">Not required</option>
        </Select>
      </FormField>
      <FormField label="Consent date">
        <Input type="date" name="parentConsentOn" defaultValue={record?.parentConsentOn ?? ""} />
      </FormField>
      <FormField label="Review / expiry date">
        <Input type="date" name="reviewOn" defaultValue={record?.reviewOn ?? ""} />
      </FormField>
      {full ? (
        <>
          <FormField label="Internal notes">
            <Textarea name="internalNotes" rows={2} defaultValue={record?.internalNotes ?? ""} />
          </FormField>
          <Checkbox name="parentVisible" label="Visible on Parent Portal" defaultChecked={record?.parentVisible ?? false} />
        </>
      ) : null}
      <div className="health-record-actions">
        <Button type="submit">{submitLabel}</Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function DietaryForm({
  record,
  full,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  record?: DietaryRecord;
  full: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  return (
    <form className="health-form" onSubmit={onSubmit}>
      <FormField label="Type / category">
        <Select name="requirementType" defaultValue={record?.requirementType ?? "other"}>
          <option value="allergy">Allergy</option>
          <option value="intolerance">Intolerance</option>
          <option value="religious">Religious</option>
          <option value="cultural">Cultural</option>
          <option value="medical">Medical</option>
          <option value="preference">Preference</option>
          <option value="texture">Texture / feeding</option>
          <option value="other">Other</option>
        </Select>
      </FormField>
      <FormField label="Specific dietary requirement">
        <Input name="requirement" required defaultValue={record?.requirement ?? ""} />
      </FormField>
      <FormField label="Foods to avoid">
        <Textarea name="foodsToAvoid" rows={2} defaultValue={record?.foodsToAvoid ?? ""} />
      </FormField>
      <FormField label="Safe alternatives / instructions">
        <Textarea name="safeAlternatives" rows={2} defaultValue={record?.safeAlternatives ?? ""} />
      </FormField>
      <Checkbox
        name="isReligiousOrCultural"
        label="Religious or cultural requirement"
        defaultChecked={record?.isReligiousOrCultural ?? false}
      />
      <FormField label="Allergy / intolerance relationship">
        <Input name="relatedAllergy" defaultValue={record?.relatedAllergy ?? ""} />
      </FormField>
      <FormField label="Texture / feeding needs">
        <Textarea name="textureFeedingNotes" rows={2} defaultValue={record?.textureFeedingNotes ?? ""} />
      </FormField>
      <FormField label="Parent-confirmed date">
        <Input type="date" name="parentConfirmedOn" defaultValue={record?.parentConfirmedOn ?? ""} />
      </FormField>
      <FormField label="Review date">
        <Input type="date" name="reviewOn" defaultValue={record?.reviewOn ?? ""} />
      </FormField>
      {full ? (
        <>
          <FormField label="Internal notes">
            <Textarea name="internalNotes" rows={2} defaultValue={record?.internalNotes ?? ""} />
          </FormField>
          <Checkbox name="parentVisible" label="Visible on Parent Portal" defaultChecked={record?.parentVisible ?? false} />
        </>
      ) : null}
      <div className="health-record-actions">
        <Button type="submit">{submitLabel}</Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
