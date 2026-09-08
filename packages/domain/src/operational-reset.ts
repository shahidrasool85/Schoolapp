/**
 * Platform Admin operational tenant reset (operational_reset_v1).
 *
 * Destructive, organisation-scoped wipe of UAT/test operational records.
 * Does not delete the organisation, hostnames, branding, provider config,
 * or active School Admin memberships. Not a generic TRUNCATE.
 *
 * There is no platform/system organisation row. Platform identity is
 * `platform_admins` + reserved slugs. Reset must never target a missing
 * or reserved-slug organisation.
 */

export const OPERATIONAL_RESET_MODE = "operational_reset_v1" as const;
export type OperationalResetMode = typeof OPERATIONAL_RESET_MODE;

/** Tables whose organisation rows must never be deleted by this reset. */
export const OPERATIONAL_RESET_PRESERVED_TABLES = [
  "organisations",
  "organisation_settings",
  "organisation_identifiers",
  "organisation_feature_flags",
  "organisation_hostnames",
  "organisation_slug_history",
  "organisation_subscriptions",
  "organisation_statutory_profiles",
  "organisation_transactional_email_templates",
  "organisation_transactional_email_settings",
  "organisation_transactional_email_template_attachments",
  "organisation_admissions_submission_confirmations",
  "school_payment_provider_configs",
  "school_finance_settings",
  "audit_events",
  "support_access_grants",
  "student_portal_policies",
  "organisation_setup_progress",
] as const;

/** Organisation-scoped operational tables wiped by operational_reset_v1. */
export const OPERATIONAL_RESET_TABLES = [
  "academic_assessment_classes",
  "academic_assessment_inclusions",
  "academic_assessment_status_history",
  "academic_assessment_types",
  "academic_assessments",
  "academic_grade_scheme_levels",
  "academic_grade_schemes",
  "academic_report_publications",
  "academic_report_sections",
  "academic_report_status_history",
  "academic_reporting_periods",
  "academic_reports",
  "academic_result_revisions",
  "academic_results",
  "academic_targets",
  "academic_years",
  "achievement_definitions",
  "admissions_application_contacts",
  "admissions_application_status_history",
  "admissions_applications",
  "admissions_assessments",
  "admissions_campaigns",
  "admissions_counters",
  "admissions_documents",
  "admissions_enquiries",
  "admissions_form_documents",
  "admissions_form_fields",
  "admissions_form_sections",
  "admissions_form_submissions",
  "admissions_forms",
  "admissions_offers",
  "admissions_waiting_list_entries",
  "announcement_recipient_subjects",
  "announcement_recipients",
  "announcement_resources",
  "announcement_status_history",
  "announcement_targets",
  "announcements",
  "attendance_mark_revisions",
  "attendance_marks",
  "behaviour_action_revisions",
  "behaviour_actions",
  "behaviour_incident_related_pupils",
  "behaviour_incident_revisions",
  "behaviour_incident_witnesses",
  "behaviour_incidents",
  "census_runs",
  "census_snapshot_pupils",
  "census_snapshot_schools",
  "census_validation_issues",
  "class_memberships",
  "class_staff_assignments",
  "class_subjects",
  "classes",
  "competition_manual_scores",
  "competition_results",
  "competition_targets",
  "competitions",
  "data_exports",
  "data_import_rows",
  "data_imports",
  "engagement_year_group_policies",
  "external_identifiers",
  "guardianships",
  "half_terms",
  "houses",
  "inter_school_competition_network_members",
  "invitations",
  "learning_activity_answers",
  "learning_activity_assignments",
  "learning_activity_attempts",
  "learning_activity_definitions",
  "learning_activity_items",
  "learning_activity_recipients",
  "learning_activity_targets",
  "learning_assignment_recipients",
  "learning_assignment_resources",
  "learning_assignment_status_history",
  "learning_assignment_targets",
  "learning_assignments",
  "learning_marks",
  "learning_resources",
  "learning_submission_attachments",
  "learning_submission_revisions",
  "learning_submissions",
  "learning_work_types",
  "message_attachments",
  "message_conversations",
  "message_counters",
  "message_participants",
  "messages",
  "notifications",
  "pastoral_concern_revisions",
  "pastoral_concerns",
  "pastoral_interventions",
  "pastoral_record_attachments",
  "positive_behaviour_records",
  "pupil_achievements",
  "pupil_rewards",
  "pupil_xp_events",
  "reward_categories",
  "rooms",
  "safeguarding_attachments",
  "safeguarding_chronology_entries",
  "safeguarding_concern_revisions",
  "safeguarding_concerns",
  "school_activity_consent_clauses",
  "school_activity_documents",
  "school_activity_eligible_pupils",
  "school_activity_participants",
  "school_activity_responses",
  "school_activity_staff",
  "school_activity_status_history",
  "school_activity_targets",
  "school_activity_updates",
  "school_activities",
  "school_billing_account_payers",
  "school_billing_account_pupils",
  "school_billing_accounts",
  "school_billing_run_items",
  "school_billing_runs",
  "school_charge_adjustments",
  "school_charges",
  "school_day_periods",
  "school_day_profiles",
  "school_discount_rule_tiers",
  "school_discount_rules",
  "school_event_audience",
  "school_event_audience_subjects",
  "school_event_resources",
  "school_event_status_history",
  "school_event_targets",
  "school_events",
  "school_fee_schedule_instalments",
  "school_fee_schedules",
  "school_finance_counters",
  "school_invoice_credits",
  "school_invoice_lines",
  "school_invoice_payments",
  "school_invoices",
  "school_payment_provider_events",
  "school_payment_receipts",
  "school_payment_refunds",
  "school_payment_sessions",
  "school_payment_transactions",
  "school_pupil_concessions",
  "school_pupil_fee_profiles",
  "school_staff_child_links",
  "student_additional_needs",
  "student_dietary_requirement_revisions",
  "student_dietary_requirements",
  "student_documents",
  "student_enrolments",
  "student_fsm_periods",
  "student_medication_revisions",
  "student_medications",
  "student_portal_class_overrides",
  "student_portal_student_overrides",
  "student_portal_year_group_overrides",
  "student_profiles",
  "student_statutory_profiles",
  "subjects",
  "terms",
  "timetable_covers",
  "timetable_entries",
  "timetable_entry_teachers",
  "timetable_exceptions",
  "year_groups",
] as const;

/**
 * School-level catalogues/config that survive so the school remains
 * configurable after reset. Operational rows that use them are still deleted.
 */
export const OPERATIONAL_RESET_CATALOGUE_TABLES = [
  "school_event_types",
  "school_charge_categories",
  "school_activity_types",
  "attendance_session_types",
  "attendance_codes",
  "behaviour_incident_categories",
  "behaviour_action_categories",
  "positive_behaviour_categories",
  "behaviour_locations",
  "pastoral_concern_categories",
  "safeguarding_concern_categories",
  "engagement_settings",
] as const;

/**
 * Global / non-tenant tables that must never be deleted or truncated.
 * `users` is global identity (ADR 0003); memberships are organisation-scoped.
 */
export const OPERATIONAL_RESET_GLOBAL_TABLES = [
  "users",
  "user_credentials",
  "auth_sessions",
  "platform_admins",
  "permissions",
  "roles",
  "role_permissions",
  "plans",
  "billing_accounts",
  "platform_settings",
  "reserved_subdomains",
  "statutory_code_sets",
  "statutory_codes",
  "inter_school_competition_networks",
] as const;

export const OPERATIONAL_RESET_PRESERVED_CATEGORIES = [
  { key: "organisation", label: "Organisation identity, UUID, slug, name, status, legal fields" },
  { key: "routing", label: "School hostname and tenant routing" },
  { key: "branding", label: "Public branding, logo, hero, and contact details" },
  { key: "school_admins", label: "All active School Admin accounts, memberships, and roles" },
  { key: "platform", label: "Platform Admin records and platform configuration" },
  { key: "email_config", label: "Transactional email wording, logo visibility, B4 send flags, attachments" },
  { key: "stripe_config", label: "Encrypted Stripe/provider configuration (test/live mode, webhook config)" },
  { key: "finance_config", label: "VAT, invoice/receipt template, footer, and school bank details" },
  { key: "audit", label: "Historical audit_events (including this reset event)" },
  { key: "setup_entry", label: "School Setup remains available to rebuild academics and people" },
] as const;

export const OPERATIONAL_RESET_COUNT_CATEGORIES = [
  { key: "pupils", label: "Pupils" },
  { key: "guardianships", label: "Guardian relationships" },
  { key: "staffToRemove", label: "Staff users to remove" },
  { key: "admissionsEnquiries", label: "Admissions enquiries" },
  { key: "admissionsApplications", label: "Applications" },
  { key: "attendanceMarks", label: "Attendance marks" },
  { key: "timetableLessons", label: "Timetable lessons" },
  { key: "assignments", label: "Assignments" },
  { key: "safeguardingRecords", label: "Safeguarding records" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "receipts", label: "Receipts" },
  { key: "storedDocuments", label: "Stored operational documents" },
  { key: "mailOutbox", label: "Emails/outbox records" },
  { key: "academicYears", label: "Academic years" },
  { key: "classes", label: "Classes/forms" },
  { key: "notices", label: "Notices" },
  { key: "messages", label: "Messages" },
] as const;

export type OperationalResetCountKey = (typeof OPERATIONAL_RESET_COUNT_CATEGORIES)[number]["key"];

export type OperationalResetSchoolAdmin = {
  userId: string;
  email: string | null;
  fullName: string;
  membershipStatus: string;
};

export function confirmationMatchesOrganisation(input: {
  typed: string;
  slug: string;
  name: string;
}): boolean {
  const typed = input.typed.trim();
  if (!typed) return false;
  return (
    typed.toLowerCase() === input.slug.trim().toLowerCase() ||
    typed.toLowerCase() === input.name.trim().toLowerCase()
  );
}
