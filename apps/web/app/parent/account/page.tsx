"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getOrgId, setOrgId, setToken } from "../../../lib/api";
import { pickMembership, type Membership } from "../../../lib/portal";

type Me = { user: { fullName: string; email: string | null; kind: string } };

export default function ParentAccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrg] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Me>("/api/v1/me"),
      api<{ memberships: Membership[] }>("/api/v1/me/memberships", { orgId: null }),
    ])
      .then(([profile, body]) => {
        const parentMemberships = body.memberships.filter(
          (m) => m.status === "active" && m.roleKeys.includes("school.parent"),
        );
        setMe(profile);
        setMemberships(parentMemberships);
        const current = pickMembership(parentMemberships, getOrgId());
        setOrg(current?.organisationId ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  function onOrgChange(event: FormEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
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

  if (error) return <p className="error">{error}</p>;
  if (!me) return <p>Loading…</p>;

  return (
    <>
      <h1>Account</h1>
      <div className="card">
        <p>
          <strong>{me.user.fullName}</strong>
        </p>
        <p className="muted">{me.user.email}</p>
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
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </p>
      </div>
    </>
  );
}
