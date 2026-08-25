"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Alert,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type Profile = {
  statutoryName: string | null;
  establishmentNumber: string | null;
  localAuthorityNumber: string | null;
  urn: string | null;
  schoolPhase: string | null;
  establishmentType: string | null;
  establishmentStatus: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressTown: string | null;
  addressPostcode: string | null;
  telephone: string | null;
  email: string | null;
  timezone: string | null;
  defaultCensusType: string;
};

type CodeCat = { catalogue: string; codes: Array<{ code: string; name: string }> };

export default function SchoolStatutorySettingsPage() {
  const permissions = usePermissions();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [codes, setCodes] = useState<CodeCat[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ profile: Profile }>("/api/v1/statutory/profile"),
      api<{ catalogues: CodeCat[] }>("/api/v1/statutory/codes"),
    ])
      .then(([profileResult, codeResult]) => {
        setProfile(profileResult.profile);
        setCodes(codeResult.catalogues);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load statutory profile.")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissions.has("statutory.manage")) return;
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/statutory/profile", {
        method: "PATCH",
        body: JSON.stringify({
          statutoryName: form.get("statutoryName") || null,
          establishmentNumber: form.get("establishmentNumber") || null,
          localAuthorityNumber: form.get("localAuthorityNumber") || null,
          urn: form.get("urn") || null,
          schoolPhase: form.get("schoolPhase") || null,
          establishmentType: form.get("establishmentType") || null,
          establishmentStatus: form.get("establishmentStatus") || null,
          addressLine1: form.get("addressLine1") || null,
          addressLine2: form.get("addressLine2") || null,
          addressTown: form.get("addressTown") || null,
          addressPostcode: form.get("addressPostcode") || null,
          telephone: form.get("telephone") || null,
          email: form.get("email") || null,
          timezone: form.get("timezone") || null,
          defaultCensusType: form.get("defaultCensusType"),
        }),
      });
      setMessage("Statutory school profile saved.");
    } catch (err) {
      setError(userFacingError(err, "Could not save statutory profile."));
    }
  }

  if (error && !profile) return <PageError title="Statutory profile unavailable" description={error} />;
  if (!profile) return <LoadingState label="Loading school identifiers…" />;

  const options = (catalogue: string) => codes.find((row) => row.catalogue === catalogue)?.codes ?? [];

  return (
    <>
      <PageHeader
        title="School statutory profile"
        description="Tenant-scoped identifiers used for census-ready exports. Demo schools use clearly synthetic numbers. Do not invent DfE identifiers for a real school."
        breadcrumbs={[
          { href: "/school/statutory", label: "Statutory data" },
          { label: "School profile" },
        ]}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <SectionCard title="Identifiers">
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Statutory school name
            <input name="statutoryName" defaultValue={profile.statutoryName ?? ""} />
          </label>
          <label>
            Local authority number
            <input name="localAuthorityNumber" defaultValue={profile.localAuthorityNumber ?? ""} maxLength={3} />
          </label>
          <label>
            Establishment number
            <input name="establishmentNumber" defaultValue={profile.establishmentNumber ?? ""} maxLength={4} />
          </label>
          <label>
            URN
            <input name="urn" defaultValue={profile.urn ?? ""} maxLength={6} />
          </label>
          <label>
            Phase
            <select name="schoolPhase" defaultValue={profile.schoolPhase ?? ""}>
              <option value="">Select</option>
              {options("school_phase").map((row) => (
                <option key={row.code} value={row.code}>{row.name}</option>
              ))}
            </select>
          </label>
          <label>
            Establishment type
            <select name="establishmentType" defaultValue={profile.establishmentType ?? ""}>
              <option value="">Select</option>
              {options("establishment_type").map((row) => (
                <option key={row.code} value={row.code}>{row.name}</option>
              ))}
            </select>
          </label>
          <label>
            Establishment status
            <select name="establishmentStatus" defaultValue={profile.establishmentStatus ?? ""}>
              <option value="">Select</option>
              {options("establishment_status").map((row) => (
                <option key={row.code} value={row.code}>{row.name}</option>
              ))}
            </select>
          </label>
          <label>
            Timezone
            <input name="timezone" defaultValue={profile.timezone ?? "Europe/London"} />
          </label>
          <label>
            Address line 1
            <input name="addressLine1" defaultValue={profile.addressLine1 ?? ""} />
          </label>
          <label>
            Address line 2
            <input name="addressLine2" defaultValue={profile.addressLine2 ?? ""} />
          </label>
          <label>
            Town
            <input name="addressTown" defaultValue={profile.addressTown ?? ""} />
          </label>
          <label>
            Postcode
            <input name="addressPostcode" defaultValue={profile.addressPostcode ?? ""} />
          </label>
          <label>
            Telephone
            <input name="telephone" defaultValue={profile.telephone ?? ""} />
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue={profile.email ?? ""} />
          </label>
          <label>
            Default census
            <select name="defaultCensusType" defaultValue={profile.defaultCensusType}>
              <option value="autumn">Autumn</option>
              <option value="spring">Spring</option>
              <option value="summer">Summer</option>
            </select>
          </label>
          {permissions.has("statutory.manage") ? (
            <button className="button" type="submit">Save profile</button>
          ) : (
            <p className="muted">You can view this profile. Saving requires statutory.manage.</p>
          )}
        </form>
      </SectionCard>
    </>
  );
}
