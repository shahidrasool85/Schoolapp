"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { FinanceNav } from "../finance-nav";

type Rule = {
  id: string;
  kind: string;
  name: string;
  amountType: string;
  percentBps: number | null;
  amountMinor: number | null;
  stackingPriority: number;
  exclusiveGroup: string | null;
  isActive: boolean;
  tiers: Array<{ siblingPosition: number; percentBps: number | null; amountMinor: number | null }>;
};

export default function DiscountsPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function reload() {
    const body = await api<{ rules: Rule[] }>("/api/v1/finance/discount-rules");
    setRules(body.rules);
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load discounts.")));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind"));
    const amountType = String(form.get("amountType"));
    const percent = String(form.get("percent") || "");
    try {
      await api("/api/v1/finance/discount-rules", {
        method: "POST",
        body: JSON.stringify({
          kind,
          name: form.get("name"),
          amountType,
          percentBps: amountType === "percent" && percent ? Math.round(Number(percent) * 100) : kind === "sibling" ? 0 : null,
          amountMinor: amountType === "fixed" ? Math.round(Number(form.get("fixed") || 0) * 100) : null,
          stackingPriority: Number(form.get("priority") || 100),
          exclusiveGroup: form.get("exclusiveGroup") || null,
          staffScope: kind === "staff_child" ? form.get("staffScope") : null,
          tiers:
            kind === "sibling"
              ? [
                  { siblingPosition: 2, amountType: "percent", percentBps: 1000 },
                  { siblingPosition: 3, amountType: "percent", percentBps: 1500 },
                  { siblingPosition: 4, amountType: "percent", percentBps: 2000 },
                ]
              : undefined,
        }),
      });
      event.currentTarget.reset();
      setMessage("Discount rule saved. Stacking follows the school setting.");
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save the rule."));
    }
  }

  if (error && !rules) return <PageError title="Discounts unavailable" description={error} />;
  if (!rules) return <LoadingState label="Loading discounts…" />;

  return (
    <>
      <PageHeader
        title="Discounts and concessions"
        description="Sibling and staff-child rules use live family and employment links, never matching surnames or emails."
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      <SectionCard title="Add a rule">
        <form className="stack" onSubmit={create}>
          <label>
            Type
            <select name="kind" defaultValue="sibling">
              <option value="sibling">Sibling</option>
              <option value="staff_child">Staff child</option>
              <option value="scholarship">Scholarship</option>
              <option value="bursary">Bursary</option>
              <option value="promotional">Promotional</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Name
            <input name="name" required placeholder="Sibling discount" />
          </label>
          <label>
            Amount type
            <select name="amountType" defaultValue="percent">
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>
          <label>
            Percent
            <input name="percent" placeholder="10" />
          </label>
          <label>
            Fixed amount (£)
            <input name="fixed" placeholder="50.00" />
          </label>
          <label>
            Priority (lower applies first)
            <input name="priority" type="number" defaultValue={100} />
          </label>
          <label>
            Exclusive group
            <input name="exclusiveGroup" placeholder="family" />
          </label>
          <label>
            Staff scope
            <select name="staffScope" defaultValue="all_staff">
              <option value="all_staff">All staff</option>
              <option value="teachers">Teachers only</option>
            </select>
          </label>
          <button type="submit">Save rule</button>
        </form>
      </SectionCard>
      {rules.length === 0 ? (
        <EmptyState title="No discount rules" description="Add sibling or staff-child rules before the first billing run." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Name</th>
              <th>Type</th>
              <th>Value</th>
              <th>Priority</th>
              <th>Status</th>
            </>
          }
        >
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td>{rule.name}</td>
              <td>{rule.kind}</td>
              <td>
                {rule.kind === "sibling"
                  ? rule.tiers.map((tier) => `child ${tier.siblingPosition}: ${(tier.percentBps ?? 0) / 100}%`).join(", ")
                  : rule.amountType === "percent"
                    ? `${(rule.percentBps ?? 0) / 100}%`
                    : `£${((rule.amountMinor ?? 0) / 100).toFixed(2)}`}
              </td>
              <td>{rule.stackingPriority}</td>
              <td>
                <StatusBadge status={rule.isActive ? "active" : "inactive"} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
