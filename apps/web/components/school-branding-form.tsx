"use client";

import { FormEvent, useRef } from "react";
import { Alert, Button, FormField, Input } from "./ui";

export type SchoolBrandingProfile = {
  name: string;
  hostname?: string | null;
  branding: {
    tagline: string | null;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    heroImageUrl: string | null;
  };
};

export function SchoolBrandingForm({
  profile,
  canManage,
  error,
  onSaveIdentity,
  onSaveColours,
  onUpload,
  onRemove,
}: {
  profile: SchoolBrandingProfile;
  canManage: boolean;
  error?: string;
  onSaveIdentity: (name: string) => Promise<void>;
  onSaveColours?: (input: { tagline: string | null; primaryColour: string; accentColour: string }) => Promise<void>;
  onUpload: (kind: "logo" | "hero", file: File) => Promise<void>;
  onRemove: (kind: "logo" | "hero") => Promise<void>;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const heroInput = useRef<HTMLInputElement>(null);

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSaveIdentity(String(form.get("name") ?? "").trim());
  }

  async function saveColours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaveColours) return;
    const form = new FormData(event.currentTarget);
    await onSaveColours({
      tagline: String(form.get("tagline") ?? "").trim() || null,
      primaryColour: String(form.get("primaryColour") ?? ""),
      accentColour: String(form.get("accentColour") ?? ""),
    });
  }

  return (
    <div className="stack">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <form className="form-grid" onSubmit={(event) => void saveIdentity(event)}>
        <FormField label="School display name" hint="Shown on login and inside the school portals. Does not change the school address.">
          <Input name="name" defaultValue={profile.name} required disabled={!canManage} />
        </FormField>
        <div className="form-control-action">
          <Button type="submit" disabled={!canManage}>
            Save display name
          </Button>
        </div>
      </form>

      <div className="branding-asset">
        <h3>School logo</h3>
        <p className="branding-help">
          PNG, JPG or WebP. Between 32×32 and 4096×4096 pixels, up to 5 MB. Used on login and in
          staff, parent and student navigation.
        </p>
        <div className="branding-preview">
          {profile.branding.logoUrl ? (
            <img src={profile.branding.logoUrl} alt={`${profile.name} logo`} />
          ) : (
            <p className="branding-fallback">No logo uploaded. The generic school icon will be used.</p>
          )}
        </div>
        {canManage ? (
          <div className="button-row">
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onUpload("logo", file);
              }}
            />
            <Button type="button" onClick={() => logoInput.current?.click()}>
              {profile.branding.logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {profile.branding.logoUrl ? (
              <Button type="button" variant="secondary" onClick={() => void onRemove("logo")}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="branding-asset">
        <h3>Login cover image</h3>
        <p className="branding-help">
          Optional image for the dark login panel. PNG, JPG or WebP, at least 200×120 pixels, up to
          5 MB. A navy overlay keeps the school name readable.
        </p>
        <div className={profile.branding.heroImageUrl ? "branding-preview is-hero" : "branding-preview"}>
          {profile.branding.heroImageUrl ? (
            <img src={profile.branding.heroImageUrl} alt={`${profile.name} login cover`} />
          ) : (
            <p className="branding-fallback">No cover image. The clean navy login panel will be used.</p>
          )}
        </div>
        {canManage ? (
          <div className="button-row">
            <input
              ref={heroInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onUpload("hero", file);
              }}
            />
            <Button type="button" onClick={() => heroInput.current?.click()}>
              {profile.branding.heroImageUrl ? "Replace cover" : "Upload cover"}
            </Button>
            {profile.branding.heroImageUrl ? (
              <Button type="button" variant="secondary" onClick={() => void onRemove("hero")}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="branding-asset">
        <h3>Login preview</h3>
        <div
          className="login-brand-preview"
          style={
            profile.branding.heroImageUrl
              ? { backgroundImage: `url("${profile.branding.heroImageUrl}")` }
              : undefined
          }
        >
          <div className="login-brand-preview-inner">
            <span>School portal</span>
            <strong>{profile.name || "School name"}</strong>
            {profile.hostname ? <em>{profile.hostname}</em> : null}
            <span>{profile.branding.tagline || "Welcome to your school portal."}</span>
          </div>
        </div>
      </div>

      {onSaveColours ? (
        <form className="form-grid" onSubmit={(event) => void saveColours(event)}>
          <FormField label="Tagline">
            <Input name="tagline" defaultValue={profile.branding.tagline ?? ""} disabled={!canManage} />
          </FormField>
          <FormField label="Primary colour">
            <Input name="primaryColour" defaultValue={profile.branding.primaryColor} disabled={!canManage} />
          </FormField>
          <FormField label="Accent colour">
            <Input name="accentColour" defaultValue={profile.branding.accentColor} disabled={!canManage} />
          </FormField>
          <div>
            <Button type="submit" disabled={!canManage}>
              Save colours
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
