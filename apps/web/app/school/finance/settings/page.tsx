"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, LoadingState, PageError, PageHeader, SectionCard } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { FinanceNav } from "../finance-nav";

type Settings = {
  tuitionEnabled: boolean;
  defaultBillingFrequency: string;
  currency: string;
  invoicePrefix: string;
  paymentDueDays: number;
  gracePeriodDays: number;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
  parentsCanViewInvoices: boolean;
  parentsCanViewBalances: boolean;
  discountStackingMode: string;
  siblingOrderMode: string;
  midPeriodJoinPolicy: string;
  midPeriodLeavePolicy: string;
  monthlyInstalmentCount: number;
};

export default function FinanceSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ settings: Settings }>("/api/v1/finance/settings")
      .then((body) => setSettings(body.settings))
      .catch((err: Error) => setError(userFacingError(err, "Could not load finance settings.")));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setMessage("");
    try {
      const body = await api<{ settings: Settings }>("/api/v1/finance/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSettings(body.settings);
      setMessage("Settings saved. Existing invoices are not changed.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save settings."));
    }
  }

  if (error && !settings) return <PageError title="Settings unavailable" description={error} />;
  if (!settings) return <LoadingState label="Loading settings…" />;

  return (
    <>
      <PageHeader
        title="Finance settings"
        description="Tuition is optional. State-funded schools can leave it off without affecting trips, clubs or other charges."
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      <SectionCard title="School fees">
        <form className="stack" onSubmit={save}>
          <label>
            <input
              type="checkbox"
              checked={settings.tuitionEnabled}
              onChange={(event) => setSettings({ ...settings, tuitionEnabled: event.target.checked })}
            />{" "}
            Enable tuition / school-fee billing
          </label>
          <label>
            Default frequency
            <select
              value={settings.defaultBillingFrequency}
              onChange={(event) => setSettings({ ...settings, defaultBillingFrequency: event.target.value })}
            >
              <option value="monthly">Monthly</option>
              <option value="termly">Termly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Monthly instalments in a year
            <input
              type="number"
              min={1}
              max={12}
              value={settings.monthlyInstalmentCount}
              onChange={(event) => setSettings({ ...settings, monthlyInstalmentCount: Number(event.target.value) })}
            />
          </label>
          <label>
            Currency
            <input value={settings.currency} maxLength={3} onChange={(event) => setSettings({ ...settings, currency: event.target.value.toUpperCase() })} />
          </label>
          <label>
            Payment due days
            <input
              type="number"
              min={0}
              value={settings.paymentDueDays}
              onChange={(event) => setSettings({ ...settings, paymentDueDays: Number(event.target.value) })}
            />
          </label>
          <label>
            Grace period (days)
            <input
              type="number"
              min={0}
              value={settings.gracePeriodDays}
              onChange={(event) => setSettings({ ...settings, gracePeriodDays: Number(event.target.value) })}
            />
          </label>
          <label>
            Discount stacking
            <select
              value={settings.discountStackingMode}
              onChange={(event) => setSettings({ ...settings, discountStackingMode: event.target.value })}
            >
              <option value="stack">Apply all eligible discounts</option>
              <option value="highest">Highest eligible discount only</option>
              <option value="priority">Priority / exclusive groups</option>
            </select>
          </label>
          <label>
            Sibling order
            <select
              value={settings.siblingOrderMode}
              onChange={(event) => setSettings({ ...settings, siblingOrderMode: event.target.value })}
            >
              <option value="oldest_first">Oldest first (first child usually no discount)</option>
              <option value="youngest_first">Youngest first</option>
              <option value="year_group">Year group order</option>
              <option value="explicit">Explicit priority only</option>
            </select>
          </label>
          <label>
            Pupil joins mid-period
            <select
              value={settings.midPeriodJoinPolicy}
              onChange={(event) => setSettings({ ...settings, midPeriodJoinPolicy: event.target.value })}
            >
              <option value="full">Charge the full period</option>
              <option value="prorate">Prorate by days</option>
              <option value="manual">Skip and flag for manual adjustment</option>
            </select>
          </label>
          <label>
            Payment instructions
            <textarea
              value={settings.paymentInstructions ?? ""}
              onChange={(event) => setSettings({ ...settings, paymentInstructions: event.target.value })}
            />
          </label>
          <label>
            Invoice footer
            <textarea value={settings.invoiceFooter ?? ""} onChange={(event) => setSettings({ ...settings, invoiceFooter: event.target.value })} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.parentsCanViewInvoices}
              onChange={(event) => setSettings({ ...settings, parentsCanViewInvoices: event.target.checked })}
            />{" "}
            Parents can view invoices
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.parentsCanViewBalances}
              onChange={(event) => setSettings({ ...settings, parentsCanViewBalances: event.target.checked })}
            />{" "}
            Parents can view account balances
          </label>
          <button type="submit">Save settings</button>
        </form>
      </SectionCard>
    </>
  );
}
