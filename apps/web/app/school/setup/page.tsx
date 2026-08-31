"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  captureSubmitTarget,
  mergeCompletedSteps,
  parseSetupStep,
  resetFormSafely,
  seedYearGroupsMessage,
  shouldOfferAcademicYearCreate,
  readinessTierLabel,
  setupProgressLabel,
  setupStatusLabel,
  setupStepHref,
  withSetupReturn,
  type OnboardingStep,
  type ReadinessTier,
  type SetupStatus,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  Input,
  InviteTokenAlert,
  LoadingState,
  PageError,
  PageHeader,
  Select,
  StatusBadge,
  WizardActions,
  WizardPanel,
  WizardProgress,
} from "../../../components/ui";
import { RequirePermission } from "../../../components/require-permission";
import { SchoolBrandingForm } from "../../../components/school-branding-form";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

const STEP_META: Array<{ key: OnboardingStep; label: string }> = [
  { key: "school_details", label: "School" },
  { key: "branding", label: "Branding" },
  { key: "academic_year", label: "Year" },
  { key: "academic_structure", label: "Structure" },
  { key: "school_day", label: "School day" },
  { key: "rooms", label: "Rooms" },
  { key: "staff", label: "Staff" },
  { key: "pupils", label: "Pupils" },
  { key: "portals", label: "Portals" },
  { key: "completion", label: "Ready" },
];

type ReadinessItem = {
  key: string;
  label: string;
  href: string;
  required: boolean;
  tier?: ReadinessTier;
  complete: boolean;
  status: "complete" | "needs_attention" | "recommended" | "optional";
};

type Profile = {
  name: string;
  legalName: string | null;
  schoolCode: string | null;
  timezone: string;
  locale: string;
  defaultCurrency: string;
  contactTelephone: string | null;
  contactEmail: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  branding: {
    tagline: string | null;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    heroImageUrl: string | null;
  };
};

function stepIndex(key: OnboardingStep): number {
  return STEP_META.findIndex((item) => item.key === key);
}

export default function SchoolSetupPage() {
  return (
    <RequirePermission anyOf={["onboarding.manage"]}>
      <Suspense fallback={<LoadingState label="Loading school setup…" />}>
        <SchoolSetupWizard />
      </Suspense>
    </RequirePermission>
  );
}

function SchoolSetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlStep = parseSetupStep(searchParams.get("step"));
  const [index, setIndex] = useState(() => (urlStep ? Math.max(stepIndex(urlStep), 0) : 0));
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);
  const [ready, setReady] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>("not_started");
  const [setupSummary, setSetupSummary] = useState({ completedCount: 0, totalSteps: 10, percent: 0 });
  const [satisfiedSteps, setSatisfiedSteps] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);
  const loaded = useRef(false);
  const lastPersisted = useRef<OnboardingStep | null>(null);

  const step = STEP_META[index]!.key;

  async function persist(
    nextIndex: number,
    extras?: { markComplete?: boolean; markReady?: boolean; completeCurrent?: boolean },
  ) {
    const nextStep = STEP_META[nextIndex]?.key;
    const payload: Record<string, unknown> = { currentStep: nextStep };
    if (extras?.completeCurrent) {
      payload.completedSteps = mergeCompletedSteps(completedSteps, STEP_META[index]!.key);
    }
    if (extras?.markComplete) payload.markComplete = true;
    if (extras?.markReady) payload.markReady = true;
    await api("/api/v1/onboarding/progress", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    lastPersisted.current = nextStep ?? null;
  }

  async function load(options?: { syncStep?: boolean }) {
    const seq = ++loadSeq.current;
    const [onboarding, body] = await Promise.all([
      api<{
        progress: { currentStep: string; completedSteps: string[] };
        readiness: { ready: boolean; items: ReadinessItem[] };
        setup: {
          status: SetupStatus;
          completedCount: number;
          totalSteps: number;
          percent: number;
          satisfiedSteps: string[];
        };
      }>("/api/v1/onboarding"),
      api<{ profile: Profile }>("/api/v1/onboarding/profile"),
    ]);
    if (seq !== loadSeq.current) return;
    setProfile(body.profile);
    setReadiness(onboarding.readiness.items);
    setReady(onboarding.readiness.ready);
    setCompletedSteps(onboarding.progress.completedSteps ?? []);
    if (onboarding.setup) {
      setSetupStatus(onboarding.setup.status);
      setSetupSummary({
        completedCount: onboarding.setup.completedCount,
        totalSteps: onboarding.setup.totalSteps,
        percent: onboarding.setup.percent,
      });
      setSatisfiedSteps(onboarding.setup.satisfiedSteps ?? []);
    }
    if (options?.syncStep && !urlStep) {
      const found = STEP_META.findIndex((item) => item.key === onboarding.progress.currentStep);
      if (found >= 0) {
        setIndex(found);
        router.replace(setupStepHref(STEP_META[found]!.key));
      }
    }
    loaded.current = true;
  }

  useEffect(() => {
    load({ syncStep: true })
      .catch((err: Error) => setError(userFacingError(err, "Could not load school setup.")))
      .finally(() => setLoading(false));
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlStep) return;
    const found = stepIndex(urlStep);
    if (found >= 0) setIndex(found);
    if (!loaded.current || lastPersisted.current === urlStep) return;
    void api("/api/v1/onboarding/progress", {
      method: "PATCH",
      body: JSON.stringify({ currentStep: urlStep }),
    })
      .then(() => {
        lastPersisted.current = urlStep;
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not update setup progress.")));
  }, [urlStep]);

  async function saveLater() {
    setNotice("");
    setError("");
    try {
      await persist(index);
      router.push("/school");
    } catch (err) {
      setError(userFacingError(err, "Could not save progress."));
    }
  }

  async function finishSetup() {
    setNotice("");
    setError("");
    try {
      await persist(index, { markComplete: true, markReady: true, completeCurrent: true });
      router.push("/school");
    } catch (err) {
      setError(userFacingError(err, "Could not finish school setup."));
    }
  }

  async function go(next: number, completeCurrent = false) {
    setError("");
    setNotice("");
    try {
      await persist(next, {
        completeCurrent,
      });
      setIndex(next);
      router.push(setupStepHref(STEP_META[next]!.key));
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update setup progress."));
    }
  }

  if (loading) return <LoadingState label="Loading school setup…" />;
  if (error && !profile) return <PageError title="Setup unavailable" description={error} />;
  if (!profile) return <EmptyState title="School profile not found" />;

  return (
    <>
      <PageHeader
        title="School setup"
        description={`${setupProgressLabel(setupSummary)} · Setup status: ${setupStatusLabel(setupStatus)}`}
        actions={
          <Link className="button secondary" href="/school">
            Go to dashboard
          </Link>
        }
      />
      <WizardProgress
        steps={STEP_META}
        currentIndex={index}
        completedKeys={satisfiedSteps}
        stepHref={(key) => setupStepHref(key as OnboardingStep)}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {step === "school_details" ? (
        <SchoolDetailsStep profile={profile} onSaved={load} />
      ) : null}
      {step === "branding" ? <BrandingStep profile={profile} onSaved={load} /> : null}
      {step === "academic_year" ? <AcademicYearStep setupStatus={setupStatus} /> : null}
      {step === "academic_structure" ? <AcademicStructureStep /> : null}
      {step === "school_day" ? <SchoolDayStep /> : null}
      {step === "rooms" ? <RoomsStep /> : null}
      {step === "staff" ? <StaffStep /> : null}
      {step === "pupils" ? <PupilsStep /> : null}
      {step === "portals" ? <PortalsStep /> : null}
      {step === "completion" ? (
        <CompletionStep items={readiness} ready={ready} onFinish={() => void finishSetup()} />
      ) : null}
      <WizardActions
        onBack={index > 0 ? () => void go(index - 1) : undefined}
        onSaveLater={saveLater}
        onContinue={index < STEP_META.length - 1 ? () => void go(index + 1, true) : undefined}
        continueLabel={index === STEP_META.length - 2 ? "Review readiness" : "Continue"}
      />
    </>
  );
}

function SchoolDetailsStep({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("/api/v1/onboarding/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          legalName: form.get("legalName") || null,
          schoolCode: form.get("schoolCode") || null,
          timezone: form.get("timezone"),
          locale: form.get("locale"),
          defaultCurrency: form.get("defaultCurrency"),
          contactTelephone: form.get("contactTelephone") || null,
          contactEmail: form.get("contactEmail") || null,
          website: form.get("website") || null,
          addressLine1: form.get("addressLine1") || null,
          city: form.get("city") || null,
          postcode: form.get("postcode") || null,
        }),
      });
      setNotice("School details saved.");
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not save school details."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <WizardPanel title="School details" description="Display name, contact details, timezone and currency for this tenant.">
      <form className="form-grid" onSubmit={onSubmit}>
        <FormField label="School display name"><Input name="name" defaultValue={profile.name} required /></FormField>
        <FormField label="Legal / official name"><Input name="legalName" defaultValue={profile.legalName ?? ""} /></FormField>
        <FormField label="School code"><Input name="schoolCode" defaultValue={profile.schoolCode ?? ""} /></FormField>
        <FormField label="Timezone"><Input name="timezone" defaultValue={profile.timezone} required /></FormField>
        <FormField label="Locale"><Input name="locale" defaultValue={profile.locale} required /></FormField>
        <FormField label="Default currency"><Input name="defaultCurrency" defaultValue={profile.defaultCurrency} maxLength={3} /></FormField>
        <FormField label="Telephone"><Input name="contactTelephone" defaultValue={profile.contactTelephone ?? ""} /></FormField>
        <FormField label="General email"><Input name="contactEmail" type="email" defaultValue={profile.contactEmail ?? ""} /></FormField>
        <FormField label="Website"><Input name="website" defaultValue={profile.website ?? ""} /></FormField>
        <FormField label="Address"><Input name="addressLine1" defaultValue={profile.addressLine1 ?? ""} /></FormField>
        <FormField label="City"><Input name="city" defaultValue={profile.city ?? ""} /></FormField>
        <FormField label="Postcode"><Input name="postcode" defaultValue={profile.postcode ?? ""} /></FormField>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <div><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save details"}</Button></div>
      </form>
    </WizardPanel>
  );
}

function BrandingStep({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function onSaveIdentity(name: string) {
    try {
      await api("/api/v1/onboarding/profile", { method: "PATCH", body: JSON.stringify({ name }) });
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not save school name."));
      throw err;
    }
  }
  async function onSaveColours(input: {
    tagline: string | null;
    primaryColour: string;
    accentColour: string;
  }) {
    try {
      await api("/api/v1/onboarding/branding", { method: "PATCH", body: JSON.stringify(input) });
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not save branding."));
      throw err;
    }
  }
  async function upload(kind: "logo" | "hero", file: File) {
    const data = new FormData();
    data.append("file", file);
    try {
      await api(`/api/v1/onboarding/branding/${kind}`, { method: "POST", body: data });
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not upload image."));
    }
  }
  async function removeAsset(kind: "logo" | "hero") {
    try {
      await api(`/api/v1/onboarding/branding/${kind}`, { method: "DELETE" });
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not remove image."));
    }
  }
  return (
    <WizardPanel title="Branding" description="Logo, colours and optional login cover. Public pages only receive display-safe fields.">
      <SchoolBrandingForm
        profile={profile}
        canManage
        error={error}
        onSaveIdentity={onSaveIdentity}
        onSaveColours={onSaveColours}
        onUpload={upload}
        onRemove={removeAsset}
      />
    </WizardPanel>
  );
}

function AcademicYearStep({ setupStatus }: { setupStatus: SetupStatus }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [years, setYears] = useState<
    Array<{ id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean; status?: string }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  async function loadYears() {
    const body = await api<{
      academicYears: Array<{ id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean; status?: string }>;
    }>("/api/v1/academic-years");
    setYears(body.academicYears);
  }

  useEffect(() => {
    loadYears()
      .catch((err: Error) => setError(userFacingError(err, "Could not load academic years.")))
      .finally(() => setLoaded(true));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const year = await api<{ academicYear: { id: string } }>("/api/v1/academic-years", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
          isCurrent: true,
        }),
      });
      if (form.get("termName") && form.get("termStartsOn") && form.get("termEndsOn")) {
        await api(`/api/v1/academic-years/${year.academicYear.id}/terms`, {
          method: "POST",
          body: JSON.stringify({
            name: form.get("termName"),
            startsOn: form.get("termStartsOn"),
            endsOn: form.get("termEndsOn"),
          }),
        });
      }
      resetFormSafely(formEl);
      setNotice("Academic year created.");
      await loadYears();
    } catch (err) {
      setError(userFacingError(err, "Could not create the academic year. You can also use Academic setup."));
    } finally {
      setSaving(false);
    }
  }

  const current = years.find((year) => year.isCurrent) ?? years[0];
  const offerCreate = shouldOfferAcademicYearCreate(years.length);
  const reviewing = setupStatus === "completed" && !offerCreate;

  if (!loaded && !error) {
    return (
      <WizardPanel title="Academic year" description="Checking whether this school already has an academic year.">
        <LoadingState label="Loading academic years…" />
      </WizardPanel>
    );
  }

  if (!offerCreate && current) {
    return (
      <WizardPanel
        title={reviewing ? "Academic year" : "Academic year"}
        description={
          reviewing
            ? "School setup is complete. Review the current academic year here; do not recreate it."
            : "This school already has an academic year. Continue, or open Academic years to manage dates and terms."
        }
      >
        <div className="card">
          <p>
            <strong>{current.name}</strong>
            {current.isCurrent ? " · Current" : ""}
            {current.status ? ` · ${current.status}` : ""}
          </p>
          <p className="muted">
            {current.startsOn} → {current.endsOn}
          </p>
          {years.length > 1 ? <p className="muted">{years.length} academic years are configured for this school.</p> : null}
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <p>
          <Link className="button secondary" href={withSetupReturn("/school/academic-years", "academic_year")}>
            Open Academic years
          </Link>
        </p>
        <p className="muted">Use Continue to keep moving through setup. Term dates are managed under Academic years → Terms.</p>
      </WizardPanel>
    );
  }

  return (
    <WizardPanel title="Academic year" description="Creates the first current year using the existing academic-year API. Add term dates here or later under Academic years.">
      <form className="form-grid" onSubmit={onSubmit}>
        <FormField label="Year name"><Input name="name" placeholder="2026/27" required /></FormField>
        <FormField label="Starts"><Input name="startsOn" type="date" required /></FormField>
        <FormField label="Ends"><Input name="endsOn" type="date" required /></FormField>
        <FormField label="First term name"><Input name="termName" placeholder="Autumn" /></FormField>
        <FormField label="Term starts"><Input name="termStartsOn" type="date" /></FormField>
        <FormField label="Term ends"><Input name="termEndsOn" type="date" /></FormField>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <div><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create academic year"}</Button></div>
      </form>
      <p className="muted">
        <Link href={withSetupReturn("/school/academic-years", "academic_year")}>Open Academic years</Link>
      </p>
    </WizardPanel>
  );
}

function AcademicStructureStep() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function seed() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = await api<{ created: number }>("/api/v1/year-groups/seed", {
        method: "POST",
        body: "{}",
      });
      setNotice(seedYearGroupsMessage(body.created));
    } catch (err) {
      setError(userFacingError(err, "Could not seed standard year groups."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardPanel title="Academic structure" description="Year groups, classes and subjects stay on their canonical pages.">
      <p>
        <Button type="button" onClick={() => void seed()} disabled={busy}>
          {busy ? "Seeding…" : "Seed standard year groups"}
        </Button>
      </p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul>
        <li><Link href={withSetupReturn("/school/year-groups", "academic_structure")}>Year groups</Link></li>
        <li><Link href={withSetupReturn("/school/classes", "academic_structure")}>Classes / forms</Link></li>
        <li><Link href={withSetupReturn("/school/subjects", "academic_structure")}>Subjects</Link></li>
      </ul>
    </WizardPanel>
  );
}

function SchoolDayStep() {
  return (
    <WizardPanel title="School day" description="School-day profiles and periods live on the Timetable pages so this wizard does not duplicate that model.">
      <p>
        <Link className="button" href={withSetupReturn("/school/timetable/school-day", "school_day")}>
          Configure school day / periods
        </Link>
      </p>
    </WizardPanel>
  );
}

function RoomsStep() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setNotice("");
    try {
      await api("/api/v1/timetable/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          shortCode: form.get("code") || String(form.get("name")).slice(0, 12),
        }),
      });
      resetFormSafely(formEl);
      setNotice("Room added.");
    } catch (err) {
      setError(userFacingError(err, "Could not create a room."));
    }
  }
  return (
    <WizardPanel title="Rooms" description="Add at least one teaching room, or continue and do this later.">
      <form className="form-grid" onSubmit={onSubmit}>
        <FormField label="Room name"><Input name="name" required /></FormField>
        <FormField label="Code"><Input name="code" /></FormField>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <div><Button type="submit">Add room</Button></div>
      </form>
      <p className="muted">
        <Link href={withSetupReturn("/school/timetable/rooms", "rooms")}>Open rooms</Link>
      </p>
    </WizardPanel>
  );
}

function StaffStep() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      const created = await api<{ invitationToken: string }>("/api/v1/staff", {
        method: "POST",
        body: JSON.stringify({
          fullName: form.get("fullName"),
          email: form.get("email"),
          jobTitle: form.get("jobTitle") || undefined,
          roleKeys: [String(form.get("roleKey") || "school.teacher")],
        }),
      });
      setToken(created.invitationToken);
      resetFormSafely(formEl);
    } catch (err) {
      setError(userFacingError(err, "Could not invite staff."));
    }
  }
  return (
    <WizardPanel title="Staff" description="Invite a teacher or other staff member. The invitation token is shown once.">
      <form className="form-grid" onSubmit={onSubmit}>
        <FormField label="Full name"><Input name="fullName" required /></FormField>
        <FormField label="Email"><Input name="email" type="email" required /></FormField>
        <FormField label="Job title"><Input name="jobTitle" /></FormField>
        <FormField label="Role">
          <Select name="roleKey" defaultValue="school.teacher">
            <option value="school.teacher">Teacher</option>
            <option value="school.staff">Staff</option>
            <option value="school.admissions">Admissions</option>
            <option value="school.headteacher">Headteacher</option>
          </Select>
        </FormField>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div><Button type="submit">Invite staff</Button></div>
      </form>
      {token ? <InviteTokenAlert token={token} /> : null}
      <p className="muted">
        <Link href={withSetupReturn("/school/staff", "staff")}>Open staff</Link>
        {" · "}
        <Link href={withSetupReturn("/school/imports", "staff")}>Bulk import</Link>
      </p>
    </WizardPanel>
  );
}

function PupilsStep() {
  return (
    <WizardPanel title="Pupils" description="Add a pupil now, or import many records from CSV.">
      <p>
        <Link className="button" href={withSetupReturn("/school/students", "pupils")}>Add pupils</Link>{" "}
        <Link className="button secondary" href={withSetupReturn("/school/imports", "pupils")}>Import CSV</Link>
      </p>
    </WizardPanel>
  );
}

function PortalsStep() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  async function enableStudentPortal() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await api("/api/v1/student-portal-policy", {
        method: "PATCH",
        body: JSON.stringify({ defaultEnabled: true }),
      });
      setNotice("School-wide Student Portal default is now enabled.");
    } catch (err) {
      setError(userFacingError(err, "Could not update Student Portal policy."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <WizardPanel title="Portal configuration" description="Parent Portal access stays off until you enable it on a guardianship. Student Portal uses the existing year/policy rules.">
      <p className="muted">Parent Portal: omitted or unchecked portal access remains false. Enable it from Parents / Guardians or a pupil record.</p>
      <div>
        <Button type="button" onClick={() => void enableStudentPortal()} disabled={saving}>
          {saving ? "Saving…" : "Enable school-wide Student Portal default"}
        </Button>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p className="muted">
        <Link href={withSetupReturn("/school/student-portal", "portals")}>Student Portal policy</Link>
        {" · "}
        <Link href={withSetupReturn("/school/parents", "portals")}>Parents</Link>
      </p>
    </WizardPanel>
  );
}

function CompletionStep({
  items,
  ready,
  onFinish,
}: {
  items: ReadinessItem[];
  ready: boolean;
  onFinish: () => void;
}) {
  const tone = useMemo(() => (ready ? "success" : "warning"), [ready]);
  return (
    <WizardPanel title={ready ? "School ready" : "Readiness checklist"} description="Required foundation items must be complete before you can finish setup. Recommended and optional items stay visible but never block Finish setup.">
      <Alert tone={tone === "success" ? "success" : "warning"}>
        {ready
          ? "The school's foundation is configured. Finish setup when you are ready. Staff, pupils and other operational data can be added afterwards."
          : "Some required foundation setup still needs attention. The rest of the product stays available — use Go to dashboard or Save and continue later at any time."}
      </Alert>
      <div className="readiness-list">
        {items.map((item) => (
          <div key={item.key} className="readiness-item">
            <div>
              <strong>{item.label}</strong>
              <div className="muted">{readinessTierLabel(item.tier ?? (item.required ? "required" : "optional"))}</div>
            </div>
            <div>
              <StatusBadge status={item.status} />{" "}
              <Link href={item.href}>{item.complete ? "Review" : "Fix"}</Link>
            </div>
          </div>
        ))}
      </div>
      <p className="muted">
        Setup is complete only when the required items above are done and you choose Finish setup.
        Visiting every screen is not enough.
      </p>
      <div>
        <Button type="button" onClick={onFinish} disabled={!ready}>
          Finish setup
        </Button>
      </div>
    </WizardPanel>
  );
}
