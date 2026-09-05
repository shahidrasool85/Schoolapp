"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, Badge, Button, FormField, Input, LoadingState, PageError, PageHeader, SectionCard } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";
import { FinanceNav } from "../finance-nav";

type Settings = {
  tuitionEnabled: boolean;
  defaultBillingFrequency: string;
  currency: string;
  invoicePrefix: string;
  receiptPrefix: string;
  paymentDueDays: number;
  gracePeriodDays: number;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
  parentsCanViewInvoices: boolean;
  parentsCanViewBalances: boolean;
  studentsCanViewFinance: boolean;
  discountStackingMode: string;
  siblingOrderMode: string;
  midPeriodJoinPolicy: string;
  midPeriodLeavePolicy: string;
  monthlyInstalmentCount: number;
  financeEmail: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankSortCode: string | null;
  vatEnabled: boolean;
  vatRegistrationNumber: string | null;
  vatRatePercent: number;
  vatPricesInclusive: boolean;
};

export default function FinanceSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ settings: Settings }>("/api/v1/finance/settings")
      .then((body) =>
        setSettings({
          ...body.settings,
          vatEnabled: Boolean(body.settings.vatEnabled),
          vatRegistrationNumber: body.settings.vatRegistrationNumber ?? null,
          vatRatePercent: Number(body.settings.vatRatePercent ?? 0),
          vatPricesInclusive: body.settings.vatPricesInclusive !== false,
        }),
      )
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
            Invoice prefix
            <input
              value={settings.invoicePrefix}
              maxLength={12}
              onChange={(event) => setSettings({ ...settings, invoicePrefix: event.target.value })}
            />
          </label>
          <label>
            Receipt prefix
            <input
              value={settings.receiptPrefix ?? "RCT"}
              maxLength={12}
              onChange={(event) => setSettings({ ...settings, receiptPrefix: event.target.value })}
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
          <label>
            <input
              type="checkbox"
              checked={Boolean(settings.studentsCanViewFinance)}
              onChange={(event) => setSettings({ ...settings, studentsCanViewFinance: event.target.checked })}
            />{" "}
            Students can view their own fee invoices (off by default; family payment detail stays in the parent portal)
          </label>
          <button type="submit">Save settings</button>
        </form>
      </SectionCard>
      <SectionCard title="Invoice & Receipt details">
        <p className="muted">
          School name, address, phone, website and logo come from School Settings. Bank details are optional payment
          instructions for this school’s invoices and receipts. They are not Stripe or card credentials.
        </p>
        <form className="stack" onSubmit={save}>
          <FormField label="Finance / bursar email" hint="Shown on invoices and receipts. Leave blank to use the school contact email.">
            <Input
              type="email"
              value={settings.financeEmail ?? ""}
              onChange={(event) => setSettings({ ...settings, financeEmail: event.target.value || null })}
            />
          </FormField>
          <FormField label="Bank name">
            <Input
              value={settings.bankName ?? ""}
              onChange={(event) => setSettings({ ...settings, bankName: event.target.value || null })}
            />
          </FormField>
          <FormField label="Account name">
            <Input
              value={settings.bankAccountName ?? ""}
              onChange={(event) => setSettings({ ...settings, bankAccountName: event.target.value || null })}
            />
          </FormField>
          <FormField label="Account number">
            <Input
              value={settings.bankAccountNumber ?? ""}
              autoComplete="off"
              onChange={(event) => setSettings({ ...settings, bankAccountNumber: event.target.value || null })}
            />
          </FormField>
          <FormField label="Sort code">
            <Input
              value={settings.bankSortCode ?? ""}
              autoComplete="off"
              onChange={(event) => setSettings({ ...settings, bankSortCode: event.target.value || null })}
            />
          </FormField>
          <FormField label="Payment instructions" hint="Shown on outstanding invoices. Leave blank to omit.">
            <textarea
              value={settings.paymentInstructions ?? ""}
              onChange={(event) => setSettings({ ...settings, paymentInstructions: event.target.value || null })}
            />
          </FormField>
          <FormField label="Invoice footer note" hint="Optional legal or payment note printed under the totals.">
            <textarea
              value={settings.invoiceFooter ?? ""}
              onChange={(event) => setSettings({ ...settings, invoiceFooter: event.target.value || null })}
            />
          </FormField>
          <Button type="submit">Save invoice details</Button>
        </form>
      </SectionCard>
      <SectionCard title="VAT / Tax">
        <p className="muted">
          VAT is optional and school-specific. Do not enable it unless this school should issue VAT invoices. Changing
          these settings does not rewrite invoices that have already been issued.
        </p>
        <form className="stack" onSubmit={save}>
          <FormField label="Use VAT on invoices?">
            <select
              value={settings.vatEnabled ? "yes" : "no"}
              onChange={(event) => setSettings({ ...settings, vatEnabled: event.target.value === "yes" })}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </FormField>
          {settings.vatEnabled ? (
            <>
              <FormField
                label="VAT registration number"
                hint="Shown on VAT invoices. Format is not restricted to a UK number."
              >
                <Input
                  value={settings.vatRegistrationNumber ?? ""}
                  maxLength={40}
                  onChange={(event) => setSettings({ ...settings, vatRegistrationNumber: event.target.value || null })}
                />
              </FormField>
              <FormField label="Default VAT rate (%)" hint="Enter the percentage this school uses. It is not fixed at 20%.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={Number.isFinite(settings.vatRatePercent) ? settings.vatRatePercent : 0}
                  onChange={(event) => setSettings({ ...settings, vatRatePercent: Number(event.target.value) })}
                />
              </FormField>
              <FormField label="Are the fee amounts you enter inclusive of VAT?">
                <label>
                  <input
                    type="radio"
                    name="vatPricesInclusive"
                    checked={settings.vatPricesInclusive}
                    onChange={() => setSettings({ ...settings, vatPricesInclusive: true })}
                  />{" "}
                  Yes — the amount entered already includes VAT
                </label>
                <label>
                  <input
                    type="radio"
                    name="vatPricesInclusive"
                    checked={!settings.vatPricesInclusive}
                    onChange={() => setSettings({ ...settings, vatPricesInclusive: false })}
                  />{" "}
                  No — VAT is added to the amount entered
                </label>
              </FormField>
              <VatExamples ratePercent={settings.vatRatePercent} inclusive={settings.vatPricesInclusive} />
            </>
          ) : (
            <p className="muted">Invoices will continue to say “This is not a VAT invoice.” Fee amounts are unchanged.</p>
          )}
          <Button type="submit">Save VAT settings</Button>
        </form>
      </SectionCard>
      <PaymentProviderSettings />
    </>
  );
}

function formatPounds(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

function VatExamples({ ratePercent, inclusive }: { ratePercent: number; inclusive: boolean }) {
  const enteredInclusive = 60000;
  const enteredExclusive = 50000;
  const rate = Number.isFinite(ratePercent) ? ratePercent : 0;
  const rateBps = Math.round(rate * 100);
  const exclusiveVat = rateBps <= 0 ? 0 : Math.round((enteredExclusive * rateBps) / 10000);
  const inclusiveVat = rateBps <= 0 ? 0 : Math.round((enteredInclusive * rateBps) / (10000 + rateBps));
  return (
    <div className="muted">
      <p>Example at {rate.toFixed(2)}%:</p>
      <p>
        VAT inclusive — entered {formatPounds(enteredInclusive)}, net {formatPounds(enteredInclusive - inclusiveVat)}, VAT{" "}
        {formatPounds(inclusiveVat)}, parent pays {formatPounds(enteredInclusive)}.
      </p>
      <p>
        VAT exclusive — entered {formatPounds(enteredExclusive)}, net {formatPounds(enteredExclusive)}, VAT{" "}
        {formatPounds(exclusiveVat)}, parent pays {formatPounds(enteredExclusive + exclusiveVat)}.
      </p>
      <p>No VAT — entered {formatPounds(enteredInclusive)}, parent pays {formatPounds(enteredInclusive)}.</p>
      <p>
        Current setting: {inclusive ? "amounts you enter already include VAT." : "VAT is added to the amounts you enter."}
      </p>
    </div>
  );
}

type PaymentProvider = {
  provider: "stripe";
  configured: boolean;
  enabled: boolean;
  mode: "test" | "live" | null;
  connectionStatus: "not_configured" | "test_mode_configured" | "connected" | "attention_required";
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeyHint: string | null;
  providerAccountId: string | null;
  displayName: string | null;
  webhookEndpointId: string | null;
  webhookPath: string | null;
  webhookUrl: string | null;
  lastConnectionTestedAt: string | null;
  lastWebhookAt: string | null;
  lastWebhookEventType: string | null;
  lastWebhookErrorCode: string | null;
  lastConnectionErrorCode: string | null;
};

const STATUS_LABEL: Record<PaymentProvider["connectionStatus"], string> = {
  not_configured: "Not configured",
  test_mode_configured: "Test mode configured",
  connected: "Connected",
  attention_required: "Attention required",
};

const STATUS_TONE: Record<PaymentProvider["connectionStatus"], "neutral" | "success" | "warning" | "danger"> = {
  not_configured: "neutral",
  test_mode_configured: "warning",
  connected: "success",
  attention_required: "danger",
};

function PaymentProviderSettings() {
  const permissions = usePermissions();
  const canManage = permissions.has("finance.settings.manage");
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ paymentProvider: PaymentProvider }>("/api/v1/finance/payment-provider")
      .then((body) => {
        setProvider(body.paymentProvider);
        if (body.paymentProvider.mode) setMode(body.paymentProvider.mode);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load payment settings.")));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await api<{ paymentProvider: PaymentProvider }>("/api/v1/finance/payment-provider", {
        method: "PUT",
        body: JSON.stringify({
          mode,
          ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}),
          ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        }),
      });
      setProvider(body.paymentProvider);
      setSecretKey("");
      setWebhookSecret("");
      setMessage("Payment settings saved. Secret keys are stored encrypted and are not shown again.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save payment settings."));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (!canManage) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await api<{ result: string; paymentProvider: PaymentProvider }>("/api/v1/finance/payment-provider/test", {
        method: "POST",
        body: "{}",
      });
      setProvider(body.paymentProvider);
      if (body.result === "connected") setMessage("Stripe connection succeeded.");
      else if (body.result === "configuration_incomplete") setError("Configuration incomplete. Save a Stripe secret key first.");
      else setError("Stripe authentication failed. Check the secret key and try again.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not test the Stripe connection."));
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    if (!canManage) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await api<{ paymentProvider: PaymentProvider }>(
        enabled ? "/api/v1/finance/payment-provider/enable" : "/api/v1/finance/payment-provider/disable",
        { method: "POST", body: "{}" },
      );
      setProvider(body.paymentProvider);
      setMessage(enabled ? "Stripe is enabled for this school." : "Stripe is disabled for this school.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not update Stripe."));
    } finally {
      setBusy(false);
    }
  }

  if (error && !provider) return null;
  if (!provider) return null;

  return (
    <SectionCard title="Online payments">
      <p className="muted">
        Each school connects its own Stripe account. Parents at this school are charged only through this school’s
        credentials. Never enter another school’s Stripe key here.
      </p>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p>
        <strong>Payment provider:</strong> Stripe{" "}
        <Badge tone={STATUS_TONE[provider.connectionStatus]}>{STATUS_LABEL[provider.connectionStatus]}</Badge>
        {provider.enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}
      </p>
      <dl className="stack">
        {provider.displayName ? (
          <div>
            <dt>Stripe account</dt>
            <dd>{provider.displayName}</dd>
          </div>
        ) : null}
        <div>
          <dt>Mode</dt>
          <dd>{provider.mode === "live" ? "Live" : provider.mode === "test" ? "Test" : "Not set"}</dd>
        </div>
        <div>
          <dt>Secret key</dt>
          <dd>{provider.secretKeyConfigured ? provider.secretKeyHint ?? "Configured" : "Not configured"}</dd>
        </div>
        <div>
          <dt>Webhook signing secret</dt>
          <dd>{provider.webhookSecretConfigured ? "Configured" : "Not configured"}</dd>
        </div>
        {provider.webhookUrl ? (
          <div>
            <dt>Webhook URL</dt>
            <dd>
              <code>{provider.webhookUrl}</code>
              <div className="muted">Create this endpoint in the school’s Stripe dashboard, then paste the signing secret.</div>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Webhook URL</dt>
            <dd className="muted">Save a Stripe secret key to generate this school’s unique webhook URL.</dd>
          </div>
        )}
        <div>
          <dt>Last successful webhook</dt>
          <dd>
            {provider.lastWebhookAt
              ? `${new Date(provider.lastWebhookAt).toLocaleString()}${provider.lastWebhookEventType ? ` (${provider.lastWebhookEventType})` : ""}`
              : "None yet"}
          </dd>
        </div>
        {provider.lastWebhookErrorCode || provider.lastConnectionErrorCode ? (
          <div>
            <dt>Last error</dt>
            <dd>{provider.lastWebhookErrorCode ?? provider.lastConnectionErrorCode}</dd>
          </div>
        ) : null}
      </dl>
      {canManage ? (
        <form className="stack" onSubmit={save}>
          <FormField label="Mode" hint="Use Test while connecting a Stripe sandbox. Live keys must be marked Live.">
            <select value={mode} onChange={(event) => setMode(event.target.value as "test" | "live")}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </FormField>
          <FormField
            label="Stripe secret key"
            hint={provider.secretKeyConfigured ? `Saved as ${provider.secretKeyHint}. Leave blank to keep the current key.` : "Starts with sk_test_ or sk_live_. It is stored encrypted and never shown again."}
          >
            <Input
              type="password"
              autoComplete="off"
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder={provider.secretKeyConfigured ? "••••••••" : "sk_test_…"}
            />
          </FormField>
          <FormField
            label="Webhook signing secret"
            hint={provider.webhookSecretConfigured ? "Configured. Leave blank to keep the current secret." : "From the school’s Stripe webhook endpoint. Starts with whsec_."}
          >
            <Input
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder={provider.webhookSecretConfigured ? "••••••••" : "whsec_…"}
            />
          </FormField>
          <div className="row">
            <Button type="submit" disabled={busy}>
              Save Stripe settings
            </Button>
            <Button type="button" disabled={busy || !provider.secretKeyConfigured} onClick={testConnection}>
              Test Stripe connection
            </Button>
            {provider.enabled ? (
              <Button type="button" disabled={busy} onClick={() => setEnabled(false)}>
                Disable Stripe
              </Button>
            ) : (
              <Button type="button" disabled={busy || !provider.secretKeyConfigured || !provider.webhookSecretConfigured} onClick={() => setEnabled(true)}>
                Enable Stripe
              </Button>
            )}
          </div>
        </form>
      ) : (
        <p className="muted">Only a School Admin can change payment-provider credentials.</p>
      )}
    </SectionCard>
  );
}
