import type { NavIconName } from "../components/icons";
import { hasAnyPermission, hasPermissionPrefix } from "@schoolapp/domain";

export type StaffNavLink = {
  href: string;
  label: string;
  icon?: NavIconName;
  exact?: boolean;
  permissionPrefix?: string;
  permissions?: string[];
  children?: StaffNavLink[];
};

export type StaffNavSection = {
  id: string;
  label?: string;
  items: StaffNavLink[];
};

const LMS_NAV_PERMISSIONS = [
  "lms.assignments.read",
  "lms.assignments.read_assigned",
  "lms.assignments.manage",
  "lms.assignments.manage_assigned",
  "lms.submissions.read",
  "lms.submissions.read_assigned",
  "lms.submissions.mark",
  "lms.submissions.mark_assigned",
];

const BEHAVIOUR_NAV_PERMISSIONS = [
  "behaviour.read",
  "behaviour.record",
  "behaviour.manage",
  "behaviour.read_assigned",
  "behaviour.positive.record",
];

const PASTORAL_NAV_PERMISSIONS = ["pastoral.read", "pastoral.manage", "pastoral.read_assigned"];

const SAFEGUARDING_NAV_PERMISSIONS = [
  "safeguarding.read",
  "safeguarding.record",
  "safeguarding.manage",
  "safeguarding.assign",
];

const TIMETABLE_NAV_PERMISSIONS = [
  "timetable.read",
  "timetable.read_assigned",
  "timetable.manage",
  "timetable.manage_school",
  "timetable.rooms.read",
  "timetable.cover.read",
];

const COMMUNICATION_NAV_PERMISSIONS = [
  "announcements.read",
  "announcements.read_assigned",
  "announcements.manage",
  "announcements.manage_assigned",
  "calendar.read",
  "calendar.read_assigned",
  "calendar.manage",
  "calendar.manage_assigned",
  "calendar.manage_school",
];

const MESSAGING_NAV_PERMISSIONS = [
  "messaging.read",
  "messaging.read_assigned",
  "messaging.create",
  "messaging.create_assigned",
  "messaging.manage",
  "messaging.staff_internal",
  "messaging.admissions",
];

const ASSESSMENT_NAV_PERMISSIONS = [
  "assessments.read",
  "assessments.read_assigned",
  "assessments.manage",
  "assessments.manage_assigned",
  "results.read",
  "results.read_assigned",
  "results.enter",
  "results.enter_assigned",
  "reports.read",
  "reports.read_assigned",
  "reports.manage",
  "reports.manage_assigned",
  "academic.oversight",
];

const STATUTORY_NAV_PERMISSIONS = [
  "statutory.read",
  "statutory.manage",
  "statutory.validate",
  "statutory.census.create",
  "statutory.census.export",
];

const REPORTS_NAV_PERMISSIONS = [
  "reports.pupils.read",
  "reports.attendance.read",
  "reports.admissions.read",
  "reports.send.read",
  "reports.exports.create",
];

const ENGAGEMENT_NAV_PERMISSIONS = [
  "engagement.settings.read",
  "engagement.settings.manage",
  "rewards.read",
  "rewards.read_assigned",
  "rewards.award",
  "rewards.award_assigned",
  "rewards.manage",
  "achievements.read",
  "achievements.read_assigned",
  "achievements.manage",
  "competitions.read",
  "competitions.read_assigned",
  "competitions.manage",
  "learning.practice.read",
  "learning.practice.read_assigned",
  "learning.practice.manage",
  "learning.practice.manage_assigned",
];

const ACTIVITY_NAV_PERMISSIONS = [
  "activities.read",
  "activities.read_assigned",
  "activities.manage",
  "activities.manage_assigned",
];

export const STAFF_NAV_SECTIONS: StaffNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ href: "/school", label: "Dashboard", icon: "home", exact: true }],
  },
  {
    id: "operations",
    label: "School operations",
    items: [
      {
        href: "/school/admissions",
        label: "Admissions",
        icon: "clipboard",
        exact: true,
        permissionPrefix: "admissions.",
        children: [
          { href: "/school/admissions/forms", label: "Forms", permissionPrefix: "admissions." },
          { href: "/school/admissions/campaigns", label: "Sources / Campaigns", permissionPrefix: "admissions." },
          { href: "/school/admissions/enquiries", label: "Enquiries", permissionPrefix: "admissions." },
          { href: "/school/admissions/applications", label: "Applications", permissionPrefix: "admissions." },
          { href: "/school/admissions/assessments", label: "Assessments", permissionPrefix: "admissions." },
          { href: "/school/admissions/waiting-list", label: "Waiting list", permissionPrefix: "admissions." },
          { href: "/school/admissions/offers", label: "Offers", permissionPrefix: "admissions." },
        ],
      },
      {
        href: "/school/students",
        label: "Pupils",
        icon: "users",
        permissions: ["students.profiles.read", "students.profiles.read_assigned", "students.profiles.manage"],
      },
      {
        href: "/school/attendance",
        label: "Attendance",
        icon: "check",
        exact: true,
        permissionPrefix: "attendance.",
        children: [
          {
            href: "/school/attendance/registers",
            label: "My registers",
            permissions: ["attendance.record.manage_assigned", "attendance.record.manage"],
          },
          {
            href: "/school/attendance/school",
            label: "School attendance",
            permissions: ["attendance.record.read", "attendance.record.manage", "attendance.record.correct"],
          },
        ],
      },
      {
        href: "/school/statutory",
        label: "Statutory data",
        icon: "layers",
        exact: true,
        permissions: STATUTORY_NAV_PERMISSIONS,
        children: [
          { href: "/school/statutory", label: "Overview", exact: true, permissions: STATUTORY_NAV_PERMISSIONS },
          { href: "/school/statutory/data-quality", label: "Data quality", permissions: STATUTORY_NAV_PERMISSIONS },
          { href: "/school/statutory/census", label: "Census", permissions: STATUTORY_NAV_PERMISSIONS },
          {
            href: "/school/settings/statutory",
            label: "School profile",
            permissions: ["statutory.read", "statutory.manage"],
          },
        ],
      },
      {
        href: "/school/reports",
        label: "Reports",
        icon: "chart",
        exact: true,
        permissions: REPORTS_NAV_PERMISSIONS,
        children: [
          { href: "/school/reports", label: "Overview", exact: true, permissions: REPORTS_NAV_PERMISSIONS },
          { href: "/school/reports/pupils", label: "Pupils", permissions: ["reports.pupils.read"] },
          { href: "/school/reports/attendance", label: "Attendance", permissions: ["reports.attendance.read"] },
          { href: "/school/reports/admissions", label: "Admissions", permissions: ["reports.admissions.read"] },
          { href: "/school/reports/send", label: "SEND", permissions: ["reports.send.read"] },
          { href: "/school/reports/exports", label: "Exports", permissions: ["reports.exports.create", "statutory.read"] },
        ],
      },
      {
        href: "/school/timetable",
        label: "Timetable",
        icon: "calendar",
        exact: true,
        permissions: TIMETABLE_NAV_PERMISSIONS,
        children: [
          { href: "/school/timetable", label: "Overview", exact: true, permissions: TIMETABLE_NAV_PERMISSIONS },
          {
            href: "/school/timetable/school-day",
            label: "School day / Periods",
            permissions: ["timetable.read", "timetable.read_assigned", "timetable.manage_school"],
          },
          { href: "/school/timetable/schedule", label: "Timetable", permissions: TIMETABLE_NAV_PERMISSIONS },
          { href: "/school/timetable/mine", label: "My Timetable", permissions: TIMETABLE_NAV_PERMISSIONS },
          { href: "/school/timetable/rooms", label: "Rooms", permissions: ["timetable.rooms.read", "timetable.rooms.manage"] },
          {
            href: "/school/timetable/cover",
            label: "Cover / Changes",
            permissions: ["timetable.cover.read", "timetable.cover.manage"],
          },
        ],
      },
    ],
  },
  {
    id: "teaching",
    label: "Teaching",
    items: [
      {
        href: "/school/teaching",
        label: "Teaching & Learning",
        icon: "book",
        exact: true,
        permissions: LMS_NAV_PERMISSIONS,
        children: [
          { href: "/school/teaching", label: "My Teaching", exact: true, permissions: LMS_NAV_PERMISSIONS },
          { href: "/school/teaching/assignments", label: "Assignments", permissions: LMS_NAV_PERMISSIONS },
          { href: "/school/teaching/submissions", label: "Submissions / Marking", permissions: LMS_NAV_PERMISSIONS },
        ],
      },
      {
        href: "/school/assessment",
        label: "Assessment & Progress",
        icon: "chart",
        exact: true,
        permissions: ASSESSMENT_NAV_PERMISSIONS,
        children: [
          { href: "/school/assessment", label: "Overview", exact: true, permissions: ASSESSMENT_NAV_PERMISSIONS },
          { href: "/school/assessment/assessments", label: "Assessments", permissions: ASSESSMENT_NAV_PERMISSIONS },
          { href: "/school/assessment/results", label: "Results", permissions: ASSESSMENT_NAV_PERMISSIONS },
          { href: "/school/assessment/reports", label: "Reports", permissions: ASSESSMENT_NAV_PERMISSIONS },
          { href: "/school/assessment/periods", label: "Reporting periods", permissions: ASSESSMENT_NAV_PERMISSIONS },
        ],
      },
    ],
  },
  {
    id: "support",
    label: "Student support",
    items: [
      {
        href: "/school/pastoral",
        label: "Pastoral & Behaviour",
        icon: "heart",
        exact: true,
        permissions: [...BEHAVIOUR_NAV_PERMISSIONS, ...PASTORAL_NAV_PERMISSIONS],
        children: [
          { href: "/school/pastoral/behaviour", label: "Behaviour", permissions: BEHAVIOUR_NAV_PERMISSIONS },
          { href: "/school/pastoral/achievements", label: "Achievements", permissions: BEHAVIOUR_NAV_PERMISSIONS },
          { href: "/school/pastoral/concerns", label: "Pastoral", permissions: PASTORAL_NAV_PERMISSIONS },
        ],
      },
      {
        href: "/school/safeguarding",
        label: "Safeguarding",
        icon: "shield",
        permissions: SAFEGUARDING_NAV_PERMISSIONS,
      },
    ],
  },
  {
    id: "engagement",
    label: "Engagement",
    items: [
      {
        href: "/school/engagement",
        label: "Rewards & learning",
        icon: "chart",
        exact: true,
        permissions: ENGAGEMENT_NAV_PERMISSIONS,
        children: [
          { href: "/school/engagement", label: "Overview", exact: true, permissions: ENGAGEMENT_NAV_PERMISSIONS },
          { href: "/school/engagement/rewards", label: "Rewards", permissions: ENGAGEMENT_NAV_PERMISSIONS },
          { href: "/school/engagement/achievements", label: "Achievements", permissions: ENGAGEMENT_NAV_PERMISSIONS },
          { href: "/school/engagement/competitions", label: "Competitions", permissions: ENGAGEMENT_NAV_PERMISSIONS },
          { href: "/school/engagement/learning", label: "Early learning", permissions: ENGAGEMENT_NAV_PERMISSIONS },
          {
            href: "/school/engagement/settings",
            label: "Settings",
            permissions: ["engagement.settings.read", "engagement.settings.manage"],
          },
        ],
      },
      {
        href: "/school/activities",
        label: "Activities",
        icon: "flag",
        exact: true,
        permissions: ACTIVITY_NAV_PERMISSIONS,
        children: [
          { href: "/school/activities", label: "All activities", exact: true, permissions: ACTIVITY_NAV_PERMISSIONS },
          { href: "/school/activities?type=trips", label: "Trips & visits", permissions: ACTIVITY_NAV_PERMISSIONS },
          { href: "/school/activities?type=club", label: "Clubs", permissions: ACTIVITY_NAV_PERMISSIONS },
        ],
      },
      {
        href: "/school/communications",
        label: "Communications",
        icon: "megaphone",
        exact: true,
        permissions: COMMUNICATION_NAV_PERMISSIONS,
        children: [
          { href: "/school/communications/announcements", label: "Notices", permissions: COMMUNICATION_NAV_PERMISSIONS },
          { href: "/school/communications/calendar", label: "Calendar", permissions: COMMUNICATION_NAV_PERMISSIONS },
        ],
      },
      {
        href: "/school/messages",
        label: "Messages",
        icon: "mail",
        exact: true,
        permissions: MESSAGING_NAV_PERMISSIONS,
        children: [
          { href: "/school/messages", label: "Inbox", exact: false, permissions: MESSAGING_NAV_PERMISSIONS },
          { href: "/school/messages?folder=archived", label: "Archived", permissions: MESSAGING_NAV_PERMISSIONS },
        ],
      },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      {
        href: "/school/staff",
        label: "Staff / Teachers",
        icon: "briefcase",
        permissions: ["org.members.read", "academic.structure.manage"],
      },
      {
        href: "/school/parents",
        label: "Parents / Guardians",
        icon: "users",
        permissions: ["guardianships.manage", "org.members.read", "students.profiles.read"],
      },
      {
        href: "/school/setup",
        label: "School setup",
        icon: "layers",
        permissions: ["onboarding.manage"],
      },
      {
        href: "/school/settings",
        label: "School settings",
        icon: "layers",
        permissions: ["org.settings.read", "org.settings.manage"],
      },
      {
        href: "/school/imports",
        label: "Bulk import",
        permissions: ["imports.manage"],
      },
      {
        href: "/school/academic-years",
        label: "Academic setup",
        icon: "layers",
        permissions: ["academic.structure.manage"],
        exact: true,
        children: [
          { href: "/school/academic-years", label: "Academic years", permissions: ["academic.structure.manage"] },
          { href: "/school/year-groups", label: "Year groups", permissions: ["academic.structure.manage"] },
          { href: "/school/classes", label: "Classes", permissions: ["academic.structure.manage"] },
          { href: "/school/subjects", label: "Subjects", permissions: ["academic.structure.manage"] },
        ],
      },
      {
        href: "/school/finance",
        label: "Finance",
        icon: "card",
        exact: true,
        permissions: [
          "finance.charges.read",
          "finance.transactions.read",
          "finance.reports.read",
          "finance.charges.manage",
          "finance.invoices.read",
          "finance.accounts.read",
        ],
        children: [
          { href: "/school/finance", label: "Dashboard", exact: true, permissions: ["finance.reports.read", "finance.charges.read", "finance.invoices.read"] },
          { href: "/school/finance/fee-schedules", label: "Fee schedules", permissions: ["finance.invoices.read", "finance.fee_schedules.manage"] },
          { href: "/school/finance/billing-runs", label: "Billing runs", permissions: ["finance.invoices.read", "finance.billing_runs.manage"] },
          { href: "/school/finance/discounts", label: "Discounts", permissions: ["finance.invoices.read", "finance.discounts.manage"] },
          { href: "/school/finance/accounts", label: "Family accounts", permissions: ["finance.accounts.read", "finance.invoices.read"] },
          { href: "/school/finance/invoices", label: "Invoices", permissions: ["finance.invoices.read"] },
          { href: "/school/finance/arrears", label: "Arrears", permissions: ["finance.invoices.read", "finance.reports.read"] },
          { href: "/school/finance/charges", label: "Other payments", permissions: ["finance.charges.read", "finance.charges.manage"] },
          { href: "/school/finance/outstanding", label: "Outstanding charges", permissions: ["finance.charges.read", "finance.reports.read"] },
          { href: "/school/finance/transactions", label: "Charge transactions", permissions: ["finance.transactions.read"] },
          { href: "/school/finance/refunds", label: "Charge refunds", permissions: ["finance.refunds.manage", "finance.transactions.read"] },
          { href: "/school/finance/settings", label: "Settings", permissions: ["finance.settings.manage", "finance.invoices.read"] },
        ],
      },
      {
        href: "/school/student-portal",
        label: "Student portal",
        permissions: ["students.portal_access.manage"],
      },
    ],
  },
];

export function staffLinkVisible(permissions: string[], link: StaffNavLink): boolean {
  if (link.permissionPrefix) return hasPermissionPrefix(permissions, link.permissionPrefix);
  if (link.permissions) return hasAnyPermission(permissions, link.permissions);
  return true;
}

export function visibleStaffNav(permissions: string[]): StaffNavSection[] {
  return STAFF_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => staffLinkVisible(permissions, item))
      .map((item) => ({
        ...item,
        children: (item.children ?? []).filter((child) => staffLinkVisible(permissions, child)),
      })),
  })).filter((section) => section.items.length > 0);
}
