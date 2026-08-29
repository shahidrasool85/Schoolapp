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
import { SchoolBrandingForm } from "../../../components/school-branding-form";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import { loadPublicTenant } from "../../../lib/tenant";
import { usePermissions } from "../../../lib/use-permissions";

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
  const permissions = usePermissions();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<ReadinessItem[]>([]);
  const [ready, setReady] = useState(false);
  const [hostname, setHostname] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const canManage = permissions.has("org.settings.manage");

  async function load() {
    const [onboarding, body, tenant] = await Promise.all([
      api<{ readiness: { ready: boolean; items: ReadinessItem[] } }>("/api/v1/onboarding"),
      api<{ profile: Profile }>("/api/v1/onboarding/profile"),
      loadPublicTenant().catch(() => null),
    ]);
    setProfile(body.profile);
    setItems(onboarding.readiness.items);
    setReady(onboarding.readiness.ready);
    setHostname(tenant && "hostname" in tenant ? tenant.hostname : null);
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

  async function saveIdentity(name: string) {
    setError("");
    try {
      await api("/api/v1/onboarding/profile", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setNotice("School display name saved.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not save school name."));
    }
  }

  async function saveColours(input: {
    tagline: string | null;
    primaryColour: string;
    accentColour: string;
  }) {
    setError("");
    try {
      await api("/api/v1/onboarding/branding", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setNotice("Branding colours saved.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not save branding."));
    }
  }

  async function upload(kind: "logo" | "hero", file: File) {
    const data = new FormData();
    data.append("file", file);
    setError("");
    try {
      await api(`/api/v1/onboarding/branding/${kind}`, { method: "POST", body: data });
      setNotice(kind === "logo" ? "Logo uploaded." : "Login cover uploaded.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not upload image."));
    }
  }

  async function removeAsset(kind: "logo" | "hero") {
    setError("");
    try {
      await api(`/api/v1/onboarding/branding/${kind}`, { method: "DELETE" });
      setNotice(kind === "logo" ? "Logo removed." : "Login cover removed.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not remove image."));
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
          permissions.has("onboarding.manage") ? (
            <Link href="/school/setup" className="button secondary">
              School setup wizard
            </Link>
          ) : undefined
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

      <SectionCard
        id="branding"
        title="Branding"
        description="School identity for login and the staff, parent and student apps. Changing the display name does not change the school address or organisation ID."
      >
        <SchoolBrandingForm
          profile={{ ...profile, hostname }}
          canManage={canManage}
          onSaveIdentity={saveIdentity}
          onSaveColours={saveColours}
          onUpload={upload}
          onRemove={removeAsset}
        />
      </SectionCard>
    </>
  );
}
