"use client";

import { useState } from "react";
import { Alert, Button } from "./ui";
import { ProfileAvatar } from "./profile-avatar";
import { api } from "../lib/api";
import { userFacingError } from "../lib/errors";

export function ProfilePhotoEditor({
  name,
  photoUrl,
  uploadPath,
  deletePath,
  canEdit,
  onChanged,
}: {
  name: string;
  photoUrl?: string | null;
  uploadPath: string;
  deletePath: string;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      await api(uploadPath, { method: "POST", body });
      setNotice("Profile photo saved.");
      await onChanged();
    } catch (err) {
      setError(userFacingError(err, "Could not upload that photo."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(deletePath, { method: "DELETE" });
      setNotice("Profile photo removed.");
      await onChanged();
    } catch (err) {
      setError(userFacingError(err, "Could not remove the photo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-photo-editor">
      <ProfileAvatar name={name} photoUrl={photoUrl} size="lg" />
      {canEdit ? (
        <div className="button-row">
          <label className="button secondary">
            {busy ? "Uploading…" : photoUrl ? "Change photo" : "Upload photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void upload(file);
              }}
            />
          </label>
          {photoUrl ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove photo
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="muted">{photoUrl ? "Official school photo" : "No profile photo"}</p>
      )}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
