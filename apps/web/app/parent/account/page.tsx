"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, LoadingState, PageError, PageHeader, PersonSummary, SectionCard } from "../../../components/ui";
import { ProfileAvatar } from "../../../components/profile-avatar";
import { ProfilePhotoEditor } from "../../../components/profile-photo-editor";
import { ProfileDetailsForm, ReadOnlyDl } from "../../../components/profile-details-form";
import { api, getOrgId, setOrgId, setToken } from "../../../lib/api";
import { pickMembership, type Membership } from "../../../lib/portal";
import { loadPublicTenant, membershipForHost, switchSchoolLocation } from "../../../lib/tenant";
import { userFacingError } from "../../../lib/errors";

type Profile = {
  displayName: string;
  fullName: string;
  preferredName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressTown: string | null;
  addressCounty: string | null;
  addressPostcode: string | null;
  photoUrl: string | null;
  editableFields: string[];
  children: Array<{
    studentProfileId: string;
    legalName: string;
    relationship: string;
    photoUrl: string | null;
  }>;
};

export default function ParentAccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [platformDomain, setPlatformDomain] = useState<string | null>(null);

  async function loadProfile() {
    const body = await api<{ profile: Profile }>("/api/v1/parent/profile");
    setProfile(body.profile);
  }

  useEffect(() => {
    Promise.all([
      loadPublicTenant(),
      api<{ memberships: Membership[] }>("/api/v1/me/memberships", { orgId: null }),
      api<{ profile: Profile }>("/api/v1/parent/profile"),
    ])
      .then(([tenant, body, profileBody]) => {
        const parentMemberships = body.memberships.filter(
          (m) => m.status === "active" && m.roleKeys.includes("school.parent"),
        );
        setProfile(profileBody.profile);
        setMemberships(parentMemberships);
        if (tenant.kind === "unknown") {
          setError("This school is not available.");
          return;
        }
        setPlatformDomain(tenant.platformDomain);
        const current =
          tenant.kind === "school"
            ? membershipForHost(parentMemberships, tenant)
            : pickMembership(parentMemberships, getOrgId());
        setOrg(current?.organisationId ?? null);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load your profile.")));
  }, []);

  function onOrgChange(event: FormEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    const selected = memberships.find((m) => m.organisationId === value);
    if (platformDomain && selected) {
      switchSchoolLocation(selected.slug, platformDomain, "/parent");
      return;
    }
    setOrgId(value);
    setOrg(value);
    window.location.assign("/parent");
  }

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST", orgId: null });
    setToken(null);
    setOrgId(null);
    router.replace("/login");
  }

  if (error && !profile) return <PageError description={error} />;
  if (!profile) return <LoadingState label="Loading profile…" />;

  return (
    <>
      <PageHeader title="My profile" description="Update your own contact details. Relationship and portal access stay school-controlled." />
      <PersonSummary
        name={profile.displayName}
        photo={<ProfileAvatar name={profile.displayName} photoUrl={profile.photoUrl} size="lg" />}
        meta={profile.email}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard title="Profile photo">
        <ProfilePhotoEditor
          name={profile.displayName}
          photoUrl={profile.photoUrl}
          uploadPath="/api/v1/parent/profile/photo"
          deletePath="/api/v1/parent/profile/photo"
          canEdit={profile.editableFields.includes("photo")}
          onChanged={loadProfile}
        />
      </SectionCard>

      <SectionCard title="Personal details">
        <ProfileDetailsForm
          values={profile}
          editableFields={profile.editableFields}
          onSubmit={async (payload) => {
            setError("");
            try {
              await api("/api/v1/parent/profile", { method: "PATCH", body: JSON.stringify(payload) });
              setNotice("Your details were saved.");
              await loadProfile();
            } catch (err) {
              setError(userFacingError(err, "Could not save your details."));
            }
          }}
        />
      </SectionCard>

      <SectionCard title="School-controlled">
        <ReadOnlyDl items={[{ label: "Full name", value: profile.fullName }, { label: "Email", value: profile.email }]} />
        <p className="muted">Parental responsibility, emergency contact, and portal access can only be changed by the school.</p>
      </SectionCard>

      <SectionCard title="Linked children">
        {profile.children.length === 0 ? (
          <p className="muted">No children are linked for this school.</p>
        ) : (
          <ul>
            {profile.children.map((child) => (
              <li key={child.studentProfileId} className="name-with-avatar">
                <ProfileAvatar name={child.legalName} photoUrl={child.photoUrl} size="sm" />
                <a href={`/parent/children/${child.studentProfileId}`}>{child.legalName}</a>
                <span className="muted"> · {child.relationship}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Account">
        {memberships.length > 0 ? (
          <label>
            School
            <select value={orgId ?? ""} onChange={onOrgChange}>
              {memberships.map((m) => (
                <option key={m.organisationId} value={m.organisationId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p style={{ marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
        </p>
      </SectionCard>
    </>
  );
}
