export const GLOBAL_SEARCH_MIN_QUERY = 1;
export const GLOBAL_SEARCH_RECORD_MIN_QUERY = 2;

export type GlobalSearchGroup = "pages" | "pupils" | "staff" | "classes" | "finance";

export type GlobalSearchDestination = {
  id: string;
  group: "pages";
  title: string;
  href: string;
  keywords: string[];
  permissions?: string[];
  permissionPrefix?: string;
  portal: "staff" | "parent" | "student";
};

function staffPage(
  id: string,
  title: string,
  href: string,
  keywords: string[],
  access: { permissions?: string[]; permissionPrefix?: string } = {},
): GlobalSearchDestination {
  return { id, group: "pages", title, href, keywords, portal: "staff", ...access };
}

export const STAFF_SEARCH_DESTINATIONS: readonly GlobalSearchDestination[] = [
  staffPage("term-dates", "Term dates / Academic calendar", "/school/term-dates", [
    "term dates",
    "academic calendar",
    "terms",
    "half term",
    "closures",
  ], { permissions: ["academic.structure.read", "academic.structure.manage"] }),
  staffPage("academic-years", "Academic years", "/school/academic-years", [
    "academic years",
    "academic year",
  ], { permissions: ["academic.structure.read", "academic.structure.manage"] }),
  staffPage("add-lesson", "Add recurring lesson", "/school/timetable/schedule", [
    "add lesson",
    "add recurring lesson",
    "new lesson",
  ], { permissionPrefix: "timetable." }),
  staffPage("timetable", "School Timetable", "/school/timetable/schedule", [
    "timetable",
    "school timetable",
    "lessons",
  ], { permissionPrefix: "timetable." }),
  staffPage("pupils", "Pupils", "/school/students", [
    "student records",
    "pupils",
    "students",
  ], { permissions: ["students.profiles.read", "students.profiles.read_assigned", "students.profiles.manage"] }),
  staffPage("attendance", "Attendance", "/school/attendance", [
    "attendance",
    "register",
  ], { permissionPrefix: "attendance." }),
  staffPage("finance", "Finance", "/school/finance", [
    "fees",
    "finance",
    "billing",
  ], { permissionPrefix: "finance." }),
  staffPage("fee-schedules", "Fee schedules", "/school/finance/fee-schedules", [
    "fee schedule",
    "fee schedules",
    "tuition",
  ], { permissions: ["finance.fee_schedules.manage", "finance.invoices.read", "finance.read"] }),
  staffPage("invoices", "Finance invoices", "/school/finance/invoices", [
    "invoices",
    "invoice",
    "charges",
  ], { permissions: ["finance.invoices.read", "finance.read"] }),
  staffPage("receipts", "Finance receipts", "/school/finance/receipts", [
    "receipts",
    "receipt",
  ], { permissions: ["finance.payments.read", "finance.transactions.read", "finance.read"] }),
  staffPage("payments", "Payments", "/school/finance/payments", [
    "payments",
    "payment",
  ], { permissions: ["finance.payments.read", "finance.transactions.read", "finance.read"] }),
  staffPage("statements", "Family statements", "/school/finance/statements", [
    "statements",
    "statement",
  ], { permissions: ["finance.accounts.read", "finance.read", "finance.reports.read"] }),
  staffPage("families", "Family accounts", "/school/finance/accounts", [
    "families",
    "family accounts",
    "billing accounts",
  ], { permissions: ["finance.accounts.read", "finance.read"] }),
  staffPage("safeguarding", "Safeguarding", "/school/safeguarding", [
    "safeguarding",
  ], { permissionPrefix: "safeguarding." }),
  staffPage("pastoral", "Pastoral", "/school/pastoral", [
    "pastoral",
    "behaviour",
  ], { permissionPrefix: "pastoral." }),
];

export const PARENT_SEARCH_DESTINATIONS: readonly GlobalSearchDestination[] = [
  {
    id: "parent-finance",
    group: "pages",
    title: "Fees & Payments",
    href: "/parent/finance",
    keywords: ["fees", "finance", "invoices", "receipts", "payments", "statement"],
    portal: "parent",
    permissions: ["finance.read_own_children"],
  },
  {
    id: "parent-children",
    group: "pages",
    title: "My Children",
    href: "/parent/children",
    keywords: ["children", "pupils", "students"],
    portal: "parent",
  },
  {
    id: "parent-payments",
    group: "pages",
    title: "Other payments",
    href: "/parent/payments",
    keywords: ["charges", "trips", "clubs"],
    portal: "parent",
    permissions: ["finance.read_own_children"],
  },
];

export const STUDENT_SEARCH_DESTINATIONS: readonly GlobalSearchDestination[] = [
  {
    id: "student-timetable",
    group: "pages",
    title: "My Timetable",
    href: "/student/timetable",
    keywords: ["timetable", "lessons"],
    portal: "student",
  },
  {
    id: "student-attendance",
    group: "pages",
    title: "Attendance",
    href: "/student/attendance",
    keywords: ["attendance"],
    portal: "student",
  },
  {
    id: "student-learning",
    group: "pages",
    title: "My Learning",
    href: "/student/learning",
    keywords: ["learning", "homework"],
    portal: "student",
  },
];

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function destinationVisible(
  destination: GlobalSearchDestination,
  permissions: readonly string[],
): boolean {
  const permissionPrefix = destination.permissionPrefix;
  if (permissionPrefix) {
    return permissions.some((key) => key === permissionPrefix || key.startsWith(permissionPrefix));
  }
  if (!destination.permissions?.length) return true;
  return destination.permissions.some((key) => permissions.includes(key));
}

export function matchSearchDestinations(
  query: string,
  destinations: readonly GlobalSearchDestination[],
  permissions: readonly string[],
): GlobalSearchDestination[] {
  const q = normalizeSearchText(query);
  if (q.length < GLOBAL_SEARCH_MIN_QUERY) return [];
  return destinations.filter((destination) => {
    if (!destinationVisible(destination, permissions)) return false;
    if (normalizeSearchText(destination.title).includes(q)) return true;
    return destination.keywords.some((keyword) => {
      const key = normalizeSearchText(keyword);
      return key.includes(q) || q.includes(key);
    });
  });
}
