"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ONBOARDING_STEPS, type OnboardingStep, captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
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
  Textarea,
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
  complete: boolean;
  status: "complete" | "needs_attention" | "optional";
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

export default function SchoolSetupPage() {
  return (
    <RequirePermission anyOf={["onboarding.manage"]}>
      <SchoolSetupWizard />
    </RequirePermission>
  );
}

function SchoolSetupWizard() {
  const [index, setIndex] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);

  const step = STEP_META[index]!.key;

  async function persist(nextIndex = index, extras?: { markComplete?: boolean; markReady?: boolean }) {
    await api("/api/v1/onboarding/progress", {
      method: "PATCH",
      body: JSON.stringify({
        currentStep: STEP_META[nextIndex]?.key,
        completedSteps: STEP_META.slice(0, nextIndex + 1).map((item) => item.key),
        ...extras,
      }),
    });
  }

  async function load(options?: { syncStep?: boolean }) {
    const seq = ++loadSeq.current;
    const [onboarding, body] = await Promise.all([
      api<{
        progress: { currentStep: string };
        readiness: { ready: boolean; items: ReadinessItem[] };
      }>("/api/v1/onboarding"),
      api<{ profile: Profile }>("/api/v1/onboarding/profile"),
    ]);
    if (seq !== loadSeq.current) return;
    setProfile(body.profile);
    setReadiness(onboarding.readiness.items);
    setReady(onboarding.readiness.ready);
    if (options?.syncStep) {
      const found = STEP_META.findIndex((item) => item.key === onboarding.progress.currentStep);
      if (found >= 0) setIndex(found);
    }
  }

  useEffect(() => {
    load({ syncStep: true })
      .catch((err: Error) => setError(userFacingError(err, "Could not load school setup.")))
      .finally(() => setLoading(false));
  }, []);

  async function saveLater() {
    setNotice("");
    try {
      await persist(index);
      setNotice("Progress saved. You can return to this wizard at any time.");
    } catch (err) {
      setError(userFacingError(err, "Could not save progress."));
    }
  }

  async function go(next: number) {
    setError("");
    try {
      await persist(next, next === STEP_META.length - 1 ? { markComplete: true, markReady: ready } : undefined);
      setIndex(next);
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
        description="A resumable first-run wizard. Existing Academic Years, Year Groups, Classes, Subjects, Timetable and Portal pages remain the source of truth."
      />
      <WizardProgress steps={STEP_META} currentIndex={index} />
      {notice ? <Alert>{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {step === "school_details" ? (
        <SchoolDetailsStep profile={profile} onSaved={load} />
      ) : null}
      {step === "branding" ? <BrandingStep profile={profile} onSaved={load} /> : null}
      {step === "academic_year" ? <AcademicYearStep /> : null}
      {step === "academic_structure" ? <AcademicStructureStep /> : null}
      {step === "school_day" ? <SchoolDayStep /> : null}
      {step === "rooms" ? <RoomsStep /> : null}
      {step === "staff" ? <StaffStep /> : null}
      {step === "pupils" ? <PupilsStep /> : null}
      {step === "portals" ? <PortalsStep /> : null}
      {step === "completion" ? <CompletionStep items={readiness} ready={ready} /> : null}
      <WizardActions
        onBack={index > 0 ? () => void go(index - 1) : undefined}
        onSaveLater={saveLater}
        onContinue={index < STEP_META.length - 1 ? () => void go(index + 1) : undefined}
        continueLabel={index === STEP_META.length - 2 ? "Review readiness" : "Continue"}
      />
    </>
  );
}

function SchoolDetailsStep({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      await onSaved();
    } catch (err) {
      setError(userFacingError(err, "Could not save school details."));
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
        <div><Button type="submit">Save details</Button></div>
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

function AcademicYearStep() {
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
            key: "t1",
            name: form.get("termName"),
            startsOn: form.get("termStartsOn"),
            endsOn: form.get("termEndsOn"),
          }),
        });
      }
    } catch (err) {
      setError(userFacingError(err, "Could not create the academic year. You can also use Academic setup."));
    }
  }
  return (
    <WizardPanel title="Academic year" description="Creates the current year using the existing academic-year API. Add term dates here or later.">
      <form className="form-grid" onSubmit={onSubmit}>
        <FormField label="Year name"><Input name="name" placeholder="2026/27" required /></FormField>
        <FormField label="Starts"><Input name="startsOn" type="date" required /></FormField>
        <FormField label="Ends"><Input name="endsOn" type="date" required /></FormField>
        <FormField label="First term name"><Input name="termName" placeholder="Autumn" /></FormField>
        <FormField label="Term starts"><Input name="termStartsOn" type="date" /></FormField>
        <FormField label="Term ends"><Input name="termEndsOn" type="date" /></FormField>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div><Button type="submit">Create academic year</Button></div>
      </form>
      <p className="muted"><Link href="/school/academic-years">Open Academic years</Link></p>
    </WizardPanel>
  );
}

function AcademicStructureStep() {
  return (
    <WizardPanel title="Academic structure" description="Year groups, classes and subjects stay on their canonical pages.">
      <p>
        <Button type="button" onClick={() => void api("/api/v1/year-groups/seed", { method: "POST", body: "{}" })}>
          Seed standard year groups
        </Button>
      </p>
      <ul>
        <li><Link href="/school/year-groups">Year groups</Link></li>
        <li><Link href="/school/classes">Classes / forms</Link></li>
        <li><Link href="/school/subjects">Subjects</Link></li>
      </ul>
    </WizardPanel>
  );
}

function SchoolDayStep() {
  return (
    <WizardPanel title="School day" description="School-day profiles and periods live on the Timetable pages so this wizard does not duplicate that model.">
      <p>
        <Link className="button" href="/school/timetable/school-day">
          Configure school day / periods
        </Link>
      </p>
    </WizardPanel>
  );
}

function RoomsStep() {
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api("/api/v1/timetable/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          shortCode: form.get("code") || String(form.get("name")).slice(0, 12),
        }),
      });
      resetFormSafely(formEl);
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
        <div><Button type="submit">Add room</Button></div>
      </form>
      <p className="muted"><Link href="/school/timetable/rooms">Open rooms</Link></p>
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
      <p className="muted"><Link href="/school/staff">Open staff</Link> · <Link href="/school/imports">Bulk import</Link></p>
    </WizardPanel>
  );
}

function PupilsStep() {
  return (
    <WizardPanel title="Pupils" description="Add a pupil now, or import many records from CSV.">
      <p>
        <Link className="button" href="/school/students">Add pupils</Link>{" "}
        <Link className="button secondary" href="/school/imports">Import CSV</Link>
      </p>
    </WizardPanel>
  );
}

function PortalsStep() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function enableStudentPortal() {
    setError("");
    setNotice("");
    try {
      await api("/api/v1/student-portal-policy", {
        method: "PATCH",
        body: JSON.stringify({ defaultEnabled: true }),
      });
      setNotice("School-wide Student Portal default is now enabled.");
    } catch (err) {
      setError(userFacingError(err, "Could not update Student Portal policy."));
    }
  }
  return (
    <WizardPanel title="Portal configuration" description="Parent Portal access stays off until you enable it on a guardianship. Student Portal uses the existing year/policy rules.">
      <p className="muted">Parent Portal: omitted or unchecked portal access remains false. Enable it from Parents / Guardians or a pupil record.</p>
      <div><Button type="button" onClick={() => void enableStudentPortal()}>Enable school-wide Student Portal default</Button></div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p className="muted"><Link href="/school/student-portal">Student Portal policy</Link> · <Link href="/school/parents">Parents</Link></p>
    </WizardPanel>
  );
}

function CompletionStep({ items, ready }: { items: ReadinessItem[]; ready: boolean }) {
  const tone = useMemo(() => (ready ? "success" : "warning"), [ready]);
  return (
    <WizardPanel title={ready ? "School ready" : "Readiness checklist"} description="Optional items never block Admissions, Attendance or Teaching. Required items should be completed first.">
      <Alert tone={tone === "success" ? "success" : "warning"}>
        {ready
          ? "Required setup is complete. You can start using Admissions, Attendance, Timetable and Teaching & Learning."
          : "Some required setup still needs attention. The rest of the product stays available."}
      </Alert>
      <div className="readiness-list">
        {items.map((item) => (
          <div key={item.key} className="readiness-item">
            <div>
              <strong>{item.label}</strong>
              <div className="muted">{item.required ? "Required" : "Optional"}</div>
            </div>
            <div>
              <StatusBadge status={item.status} />{" "}
              <Link href={item.href}>Fix</Link>
            </div>
          </div>
        ))}
      </div>
    </WizardPanel>
  );
}
