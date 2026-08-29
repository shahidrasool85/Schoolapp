"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { brandHexError, hexForColorInput, normalizeBrandHex } from "@schoolapp/domain";
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
  const primaryPickerId = useId();
  const accentPickerId = useId();
  const [tagline, setTagline] = useState(profile.branding.tagline ?? "");
  const [primary, setPrimary] = useState(profile.branding.primaryColor);
  const [accent, setAccent] = useState(profile.branding.accentColor);
  const [colourError, setColourError] = useState("");
  const [colourNotice, setColourNotice] = useState("");
  const [savingColours, setSavingColours] = useState(false);

  useEffect(() => {
    setTagline(profile.branding.tagline ?? "");
    setPrimary(profile.branding.primaryColor);
    setAccent(profile.branding.accentColor);
  }, [profile.branding.tagline, profile.branding.primaryColor, profile.branding.accentColor]);

  const primaryError = brandHexError(primary);
  const accentError = brandHexError(accent);
  const previewPrimary = normalizeBrandHex(primary) ?? profile.branding.primaryColor;
  const previewAccent = normalizeBrandHex(accent) ?? profile.branding.accentColor;
  const draftDirty =
    tagline !== (profile.branding.tagline ?? "") ||
    (normalizeBrandHex(primary) ?? primary) !== profile.branding.primaryColor ||
    (normalizeBrandHex(accent) ?? accent) !== profile.branding.accentColor;

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSaveIdentity(String(form.get("name") ?? "").trim());
  }

  async function saveColours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaveColours) return;
    const nextPrimary = normalizeBrandHex(primary);
    const nextAccent = normalizeBrandHex(accent);
    const nextError = brandHexError(primary) ?? brandHexError(accent);
    if (!nextPrimary || !nextAccent || nextError) {
      setColourNotice("");
      setColourError(nextError ?? "Enter valid colours before saving.");
      return;
    }
    setSavingColours(true);
    setColourError("");
    setColourNotice("");
    try {
      await onSaveColours({
        tagline: tagline.trim() || null,
        primaryColour: nextPrimary,
        accentColour: nextAccent,
      });
      setColourNotice("Colours saved.");
    } catch (err) {
      setColourError(err instanceof Error ? err.message : "Could not save branding.");
    } finally {
      setSavingColours(false);
    }
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
        <p className="branding-help">
          {draftDirty
            ? "Preview of unsaved colour changes. Click Save colours to keep them."
            : "Shows how the login panel uses the current logo, cover and colours."}
        </p>
        <div
          className="login-brand-preview"
          style={{
            backgroundColor: previewPrimary,
            backgroundImage: profile.branding.heroImageUrl
              ? `linear-gradient(165deg, rgba(18, 44, 74, 0.55), rgba(10, 24, 42, 0.88)), url("${profile.branding.heroImageUrl}")`
              : `linear-gradient(165deg, ${previewPrimary} 0%, #0a182a 100%)`,
          }}
        >
          <div className="login-brand-preview-inner">
            {profile.branding.logoUrl ? (
              <img src={profile.branding.logoUrl} alt="" className="login-brand-preview-logo" />
            ) : null}
            <span>School portal</span>
            <strong>{profile.name || "School name"}</strong>
            {profile.hostname ? <em>{profile.hostname}</em> : null}
            <span>{tagline.trim() || "Welcome to your school portal."}</span>
            <span className="login-brand-preview-cta" style={{ backgroundColor: previewAccent }}>
              Sign in
            </span>
          </div>
        </div>
      </div>

      {onSaveColours ? (
        <form className="form-grid" onSubmit={(event) => void saveColours(event)}>
          <FormField label="Tagline">
            <Input
              name="tagline"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <FormField
            label="Primary colour"
            hint="Used for the login panel and school chrome."
            error={primaryError ?? undefined}
          >
            <div className="colour-field">
              <span className="colour-swatch">
                <span className="colour-swatch-face" style={{ backgroundColor: previewPrimary }} />
                <input
                  id={primaryPickerId}
                  type="color"
                  aria-label="Choose primary colour"
                  value={hexForColorInput(primary, profile.branding.primaryColor)}
                  onChange={(event) => setPrimary(event.target.value.toUpperCase())}
                  disabled={!canManage}
                />
              </span>
              <Input
                name="primaryColour"
                value={primary}
                onChange={(event) => setPrimary(event.target.value)}
                disabled={!canManage}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(primaryError)}
              />
            </div>
          </FormField>
          <FormField
            label="Accent colour"
            hint="Used for buttons and highlights."
            error={accentError ?? undefined}
          >
            <div className="colour-field">
              <span className="colour-swatch">
                <span className="colour-swatch-face" style={{ backgroundColor: previewAccent }} />
                <input
                  id={accentPickerId}
                  type="color"
                  aria-label="Choose accent colour"
                  value={hexForColorInput(accent, profile.branding.accentColor)}
                  onChange={(event) => setAccent(event.target.value.toUpperCase())}
                  disabled={!canManage}
                />
              </span>
              <Input
                name="accentColour"
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
                disabled={!canManage}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(accentError)}
              />
            </div>
          </FormField>
          {colourError ? <Alert tone="danger">{colourError}</Alert> : null}
          {colourNotice ? <Alert tone="success">{colourNotice}</Alert> : null}
          <div>
            <Button type="submit" disabled={!canManage || savingColours}>
              {savingColours ? "Saving…" : "Save colours"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
