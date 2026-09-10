export const STUDENT_FEE_STATUSES = [
  "paid",
  "part_paid",
  "unpaid",
  "overdue",
  "due_soon",
  "not_yet_due",
  "no_fee_assigned",
  "schedule_conflict",
] as const;

export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];

export const STUDENT_FEE_STATUS_LABELS: Record<StudentFeeStatus, string> = {
  paid: "Paid",
  part_paid: "Part paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  due_soon: "Due soon",
  not_yet_due: "Not yet due",
  no_fee_assigned: "No fee assigned",
  schedule_conflict: "Schedule conflict",
};

export const STUDENT_FEE_SORTS = ["name", "balance", "overdue", "nextDue"] as const;
export type StudentFeeSort = (typeof STUDENT_FEE_SORTS)[number];

export const PARENT_PAYMENT_AVAILABILITY = [
  "online_payment_available",
  "online_payments_disabled",
  "stripe_unavailable",
  "invoices_hidden",
  "no_payer",
  "no_portal_access",
  "not_invoiced",
  "paid",
] as const;

export type ParentPaymentAvailability = (typeof PARENT_PAYMENT_AVAILABILITY)[number];

export const PARENT_PAYMENT_AVAILABILITY_LABELS: Record<ParentPaymentAvailability, string> = {
  online_payment_available: "Online payment available",
  online_payments_disabled: "Online payments off",
  stripe_unavailable: "Online payment unavailable",
  invoices_hidden: "Parent invoice view off",
  no_payer: "No payer",
  no_portal_access: "No parent portal access",
  not_invoiced: "Not yet invoiced",
  paid: "Paid",
};

export const STUDENT_FEES_PATH = "/school/finance/student-fees";
export const FINANCE_ADVANCED_PATH = "/school/finance/advanced";
export const FINANCE_REPORTS_PATH = "/school/finance/reports";

export const FINANCE_PRIMARY_NAV_HREFS = [
  "/school/finance",
  STUDENT_FEES_PATH,
  "/school/finance/invoices",
  "/school/finance/payments",
  "/school/finance/receipts",
  FINANCE_REPORTS_PATH,
  "/school/finance/settings",
] as const;

export const FINANCE_ADVANCED_NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/school/finance/fee-schedules", label: "Fee schedules" },
  { href: "/school/finance/billing-runs", label: "Billing runs" },
  { href: "/school/finance/accounts", label: "Family accounts" },
  { href: "/school/finance/discounts", label: "Discounts" },
  { href: "/school/finance/charges", label: "Other payments" },
];

export const FINANCE_ADVANCED_HREFS = FINANCE_ADVANCED_NAV_LINKS.map((link) => link.href);

export function isStudentFeeStatus(value: string): value is StudentFeeStatus {
  return (STUDENT_FEE_STATUSES as readonly string[]).includes(value);
}

export function isStudentFeeSort(value: string): value is StudentFeeSort {
  return (STUDENT_FEE_SORTS as readonly string[]).includes(value);
}

export function studentFeeStatusLabel(status: string): string {
  if (isStudentFeeStatus(status)) return STUDENT_FEE_STATUS_LABELS[status];
  return status.replaceAll("_", " ");
}

export function isFinanceAdvancedPath(pathname: string | null | undefined): boolean {
  const path = pathname ?? "";
  return FINANCE_ADVANCED_HREFS.some((href) => path === href || path.startsWith(`${href}/`));
}

export function financeInvoicePayPath(invoiceId: string): string {
  return `/parent/finance/invoices/${invoiceId}`;
}
