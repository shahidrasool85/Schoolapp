"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Alert,
  LoadingState,
  PageError,
  PageHeader,
  PersonSummary,
  SectionCard,
  StatusBadge,
} from "../../../../components/ui";
import { ProfileAvatar } from "../../../../components/profile-avatar";
import { ProfilePhotoEditor } from "../../../../components/profile-photo-editor";
import { ProfileDetailsForm, ReadOnlyDl } from "../../../../components/profile-details-form";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Guardian = {
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
  membershipStatus: string | null;
};

type Child = {
  guardianshipId: string;
  studentProfileId: string;
  legalName: string;
  relationship: string;
  hasParentalResponsibility: boolean;
  portalAccess: boolean;
};

export default function SchoolParentDetailPage() {
  const params = useParams<{ userId: string }>();
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const body = await api<{ guardian: Guardian; children: Child[] }>(`/api/v1/guardians/users/${params.userId}`);
    setGuardian(body.guardian);
    setChildren(body.children);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load this parent.")));
  }, [params.userId]);

  if (error && !guardian) return <PageError description={error} />;
  if (!guardian) return <LoadingState label="Loading parent…" />;

  return (
    <>
      <PageHeader
        title={guardian.displayName}
        description="School-controlled relationship fields stay on the pupil record."
        actions={
          <Link href="/school/parents" className="button secondary">
            All parents
          </Link>
        }
      />
      <PersonSummary
        name={guardian.displayName}
        photo={<ProfileAvatar name={guardian.displayName} photoUrl={guardian.photoUrl} size="lg" />}
        meta={<>{guardian.email}{guardian.phone ? ` · ${guardian.phone}` : ""}</>}
        actions={guardian.membershipStatus ? <StatusBadge status={guardian.membershipStatus} /> : null}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <SectionCard title="Profile photo">
        <ProfilePhotoEditor
          name={guardian.displayName}
          photoUrl={guardian.photoUrl}
          uploadPath={`/api/v1/guardians/users/${guardian.userId}/photo`}
          deletePath={`/api/v1/guardians/users/${guardian.userId}/photo`}
          canEdit
          onChanged={load}
        />
      </SectionCard>

      <SectionCard title="Contact details">
        <ProfileDetailsForm
          values={guardian}
          includeFullName
          editableFields={[
            "fullName",
            "title",
            "preferredName",
            "phone",
            "addressLine1",
            "addressLine2",
            "addressTown",
            "addressCounty",
            "addressPostcode",
          ]}
          onSubmit={async (payload) => {
            setError("");
            try {
              await api(`/api/v1/guardians/users/${guardian.userId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
              });
              setNotice("Parent contact details saved.");
              await load();
            } catch (err) {
              setError(userFacingError(err, "Could not save parent details."));
            }
          }}
        />
      </SectionCard>

      <SectionCard title="Linked children" description="Parental responsibility and portal access are not editable here.">
        {children.length === 0 ? (
          <p className="muted">No linked pupils.</p>
        ) : (
          <ul>
            {children.map((child) => (
              <li key={child.guardianshipId}>
                <Link href={`/school/students/${child.studentProfileId}`}>{child.legalName}</Link>
                {` · ${child.relationship}`}
                {child.hasParentalResponsibility ? " · PR" : ""}
                {child.portalAccess ? " · portal access" : ""}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="School-controlled">
        <ReadOnlyDl items={[{ label: "Email", value: guardian.email }]} />
      </SectionCard>
    </>
  );
}
