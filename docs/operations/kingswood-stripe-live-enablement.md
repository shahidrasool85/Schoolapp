# Kingswood Stripe live enablement runbook

Do **not** put secrets in this document. Do **not** enable LIVE Stripe until the Kingswood operational-data reset has completed.

Operational sequence:

1. Deploy the Stripe live-readiness PR.
2. Perform the Kingswood operational-data reset (blocked if Stripe is already LIVE or live-payment evidence exists).
3. Only then configure and enable LIVE Stripe as a School Admin.

Reset never calls Stripe. There is no School Admin override.

## After PR deployment and after the Kingswood reset

1. Confirm the operational reset completed for Kingswood (Platform Admin reset preview shows a clean operational tenant; live-financial block is false).
2. Confirm School Admin login on the Kingswood host.
3. Verify school finance settings (currency, parents can view invoices, fee/VAT settings as agreed).
4. Verify Stripe account identity and business branding in the Stripe Dashboard (see below). The Checkout header merchant name comes from Stripe, not from a hardcoded LuvLearn school name.
5. Obtain the school’s **LIVE** secret key (`sk_live_…`) from the Stripe Dashboard. Never paste a test key into LIVE mode.
6. Create a LIVE webhook endpoint pointing at this school’s unique LuvLearn URL (`/api/v1/webhooks/payments/stripe/{endpointId}` shown on Finance → Settings → Online payments after credentials are saved).
7. Obtain the LIVE webhook signing secret (`whsec_…`) for that endpoint.
8. In LuvLearn, open Finance → Settings → Online payments. Select **Live**, paste the LIVE secret key and LIVE webhook signing secret, and save. Saving credentials does **not** enable payments.
9. Click **Test Stripe connection**. This calls Stripe `/v1/account` only. It must not create a charge.
10. Tick **I understand that LIVE mode processes real payments**, then **Enable Stripe**. The server independently checks readiness (decrypt, live key shape, webhook secret, endpoint, successful connection test, usable finance settings). A checkbox alone is not enough.
11. Confirm webhook status on the same page (endpoint URL, signing secret configured, last successful webhook after the first event).
12. If appropriate, take one controlled real-payment test against a small invoice using a real card in LIVE Stripe. Do this only after reset. Record the invoice, payment, and receipt in LuvLearn.
13. Confirm invoice paid/outstanding, receipt amount equals the actual payment, and webhook reconciliation succeeded.
14. Confirm the matching transaction in the Stripe Dashboard and the school’s bank/payout view as required by the school.
15. Refund or reverse that test transaction in the **Stripe Dashboard** if it should not remain. LuvLearn records Stripe invoice refunds from the webhook. Do not pretend LuvLearn refunded money if Stripe did not.
16. Final readiness sign-off: LIVE enabled, connection tested, webhook received, one controlled payment reconciled (or explicitly deferred by the school).

## Stripe Dashboard settings (human)

These cannot be faked in application code and must not misrepresent the merchant of record.

| Need | Stripe Dashboard location |
| --- | --- |
| Checkout header / business name (the “Limra Nexus” label seen in TEST UAT) | Settings → Public details → **Business name**, and Settings → Branding |
| Statement descriptor on card statements | Settings → Public details → **Statement descriptor** |
| LIVE secret key | Developers → API keys (switch the Dashboard to Live) |
| LIVE webhook endpoint | Developers → Webhooks (Live mode) |
| LIVE webhook signing secret | The webhook endpoint’s signing secret |
| Test refund of a live payment | Payments → the charge → Refund |

LuvLearn Checkout line items use the school’s organisation name plus “LuvLearn school fees”. That does not replace Stripe account legal identity.

Do not type arbitrary statement descriptors in LuvLearn. Use the Stripe account statement descriptor.

## Encryption key rotation (future)

See [ADR 0033](../adr/0033-per-school-stripe.md). Do not rotate `SCHOOLAPP_SECRETS_ENCRYPTION_KEY` as part of this enablement.
