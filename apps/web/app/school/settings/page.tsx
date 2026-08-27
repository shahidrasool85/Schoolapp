"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

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
  addressLine2: string | null;
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

type ReadinessItem = {
  key: string;
  label: string;
  href: string;
  required: boolean;
  complete: boolean;
  status: "complete" | "needs_attention" | "optional";
};

export default function SchoolSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<ReadinessItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [onboarding, body] = await Promise.all([
      api<{ readiness: { ready: boolean; items: ReadinessItem[] } }>("/api/v1/onboarding"),
      api<{ profile: Profile }>("/api/v1/onboarding/profile"),
    ]);
    setProfile(body.profile);
    setItems(onboarding.readiness.items);
    setReady(onboarding.readiness.ready);
  }

  useEffect(() => {
    load()
      .catch((err: Error) => setError(userFacingError(err, "Could not load school settings.")))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api("/api/v1/onboarding/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          legalName: form.get("legalName") || null,
          schoolCode: form.get("schoolCode") || null,
          timezone: form.get("timezone"),
          locale: form.get("locale"),
          defaultCurrency: String(form.get("defaultCurrency") || "GBP").toUpperCase(),
          contactTelephone: form.get("contactTelephone") || null,
          contactEmail: form.get("contactEmail") || null,
          website: form.get("website") || null,
          addressLine1: form.get("addressLine1") || null,
          city: form.get("city") || null,
          postcode: form.get("postcode") || null,
        }),
      });
      setNotice("School details saved.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not save school details."));
    }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api("/api/v1/onboarding/branding", {
        method: "PATCH",
        body: JSON.stringify({
          tagline: form.get("tagline") || null,
          primaryColour: form.get("primaryColour"),
          accentColour: form.get("accentColour"),
        }),
      });
      setNotice("Branding saved.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not save branding."));
    }
  }

  async function upload(kind: "logo" | "hero", file: File | null) {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    setError("");
    try {
      await api(`/api/v1/onboarding/branding/${kind}`, { method: "POST", body: data });
      setNotice(kind === "logo" ? "Logo uploaded." : "Login image uploaded.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not upload image."));
    }
  }

  if (loading) return <LoadingState label="Loading school settings…" />;
  if (error && !profile) return <PageError title="Settings unavailable" description={error} />;
  if (!profile) return <EmptyState title="School profile not found" />;

  return (
    <>
      <PageHeader
        title="School settings"
        description="School identity and branding. Academic years, classes, timetable and portals stay on their own pages."
        actions={
          <Link href="/school/setup" className="button secondary">
            School setup wizard
          </Link>
        }
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard
        title="School readiness"
        description={ready ? "Required setup is complete. Optional items can wait." : "Finish required items before treating this school as production-ready."}
      >
        <ul className="stack">
          {items.map((item) => (
            <li key={item.key} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <StatusBadge status={item.status} />
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="School details">
        <form className="form-grid" onSubmit={saveProfile}>
          <FormField label="Display name">
            <Input name="name" defaultValue={profile.name} required />
          </FormField>
          <FormField label="Legal / official name">
            <Input name="legalName" defaultValue={profile.legalName ?? ""} />
          </FormField>
          <FormField label="School code">
            <Input name="schoolCode" defaultValue={profile.schoolCode ?? ""} />
          </FormField>
          <FormField label="Telephone">
            <Input name="contactTelephone" defaultValue={profile.contactTelephone ?? ""} />
          </FormField>
          <FormField label="General email">
            <Input name="contactEmail" type="email" defaultValue={profile.contactEmail ?? ""} />
          </FormField>
          <FormField label="Website">
            <Input name="website" defaultValue={profile.website ?? ""} />
          </FormField>
          <FormField label="Address">
            <Input name="addressLine1" defaultValue={profile.addressLine1 ?? ""} />
          </FormField>
          <FormField label="City">
            <Input name="city" defaultValue={profile.city ?? ""} />
          </FormField>
          <FormField label="Postcode">
            <Input name="postcode" defaultValue={profile.postcode ?? ""} />
          </FormField>
          <FormField label="Timezone">
            <Input name="timezone" defaultValue={profile.timezone} required />
          </FormField>
          <FormField label="Locale">
            <Input name="locale" defaultValue={profile.locale} />
          </FormField>
          <FormField label="Default currency">
            <Input name="defaultCurrency" defaultValue={profile.defaultCurrency} maxLength={3} />
          </FormField>
          <div>
            <Button type="submit">Save school details</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Branding" description="Display-only. Login, staff, parent and student shells use these colours and images with professional fallbacks.">
        <form className="form-grid" onSubmit={saveBranding}>
          <FormField label="Tagline">
            <Input name="tagline" defaultValue={profile.branding.tagline ?? ""} />
          </FormField>
          <FormField label="Primary colour">
            <Input name="primaryColour" defaultValue={profile.branding.primaryColor} />
          </FormField>
          <FormField label="Accent colour">
            <Input name="accentColour" defaultValue={profile.branding.accentColor} />
          </FormField>
          <div>
            <Button type="submit">Save branding</Button>
          </div>
        </form>
        <div className="form-grid" style={{ marginTop: "1rem" }}>
          <FormField label="Logo">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload("logo", e.target.files?.[0] ?? null)} />
          </FormField>
          <FormField label="Login / hero image">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload("hero", e.target.files?.[0] ?? null)} />
          </FormField>
        </div>
      </SectionCard>
    </>
  );
}
