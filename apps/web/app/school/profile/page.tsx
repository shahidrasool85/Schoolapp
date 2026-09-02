"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  LoadingState,
  PageError,
  PageHeader,
  PersonSummary,
  SectionCard,
  StatusBadge,
} from "../../../components/ui";
import { ProfileAvatar } from "../../../components/profile-avatar";
import { ProfilePhotoEditor } from "../../../components/profile-photo-editor";
import { ProfileDetailsForm, ReadOnlyDl } from "../../../components/profile-details-form";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Profile = {
  userId: string;
  title: string | null;
  fullName: string;
  preferredName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressTown: string | null;
  addressCounty: string | null;
  addressPostcode: string | null;
  photoUrl: string | null;
  jobTitle: string | null;
  employeeNumber: string | null;
  roleKeys: string[];
  personaLabel: string | null;
  membershipStatus: string | null;
  editableFields: string[];
  assignments: Array<{
    id: string;
    className: string | null;
    assignmentRole: string;
    endedOn: string | null;
  }>;
};

export default function StaffOwnProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const body = await api<{ profile: Profile }>("/api/v1/me/profile");
    setProfile(body.profile);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load your profile.")));
  }, []);

  if (error && !profile) return <PageError description={error} />;
  if (!profile) return <LoadingState label="Loading profile…" />;

  const canEditPersonal = profile.editableFields.some((field) =>
    ["title", "preferredName", "phone", "addressLine1"].includes(field),
  );

  return (
    <>
      <PageHeader title="My profile" description="Personal details you can maintain. School-controlled fields stay read-only." />
      <PersonSummary
        name={profile.displayName}
        photo={<ProfileAvatar name={profile.displayName} photoUrl={profile.photoUrl} size="lg" />}
        meta={
          <>
            {profile.jobTitle ?? profile.personaLabel ?? "Staff"}
            {profile.email ? ` · ${profile.email}` : ""}
          </>
        }
        actions={profile.membershipStatus ? <StatusBadge status={profile.membershipStatus} /> : null}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard title="Profile photo">
        <ProfilePhotoEditor
          name={profile.displayName}
          photoUrl={profile.photoUrl}
          uploadPath="/api/v1/me/profile/photo"
          deletePath="/api/v1/me/profile/photo"
          canEdit={profile.editableFields.includes("photo")}
          onChanged={load}
        />
      </SectionCard>

      <SectionCard title="Personal details">
        {canEditPersonal ? (
          <ProfileDetailsForm
            values={profile}
            editableFields={profile.editableFields}
            onSubmit={async (payload) => {
              setError("");
              try {
                await api("/api/v1/me/profile", { method: "PATCH", body: JSON.stringify(payload) });
                setNotice("Personal details saved.");
                await load();
              } catch (err) {
                setError(userFacingError(err, "Could not save your details."));
              }
            }}
          />
        ) : (
          <p className="muted">Personal details are managed by the school.</p>
        )}
      </SectionCard>

      <SectionCard title="School details" description="These fields are controlled by School Admin.">
        <ReadOnlyDl
          items={[
            { label: "Full name", value: profile.fullName },
            { label: "Email", value: profile.email },
            { label: "Job title", value: profile.jobTitle },
            { label: "Employee number", value: profile.employeeNumber },
            { label: "Roles", value: profile.roleKeys.join(", ") },
          ]}
        />
      </SectionCard>

      {profile.assignments.length > 0 ? (
        <SectionCard title="Teaching assignments" description="Assignments are managed through academic and timetable workflows.">
          <ul>
            {profile.assignments.map((item) => (
              <li key={item.id}>
                {item.className ?? "Class"} · {item.assignmentRole.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  );
}
