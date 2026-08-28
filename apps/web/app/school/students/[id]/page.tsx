"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  describeEnrolmentChange,
  enrolmentFormInitialState,
  filterFormClasses,
  formatPupilAddress,
  guardianAccountLabel,
  isSamePrimaryPlacement,
  lookedAfterPersistValue,
  portalAccessLabel,
  pupilIdentityGaps,
  pupilRecordHashCanonicalize,
  resetFormSafely,
  resolvePupilRecordTab,
  selectedEnrolmentClassId,
  statutoryIssueFix,
  visiblePupilRecordTabs,
  type PupilRecordTab,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  FormField,
  Input,
  InviteTokenAlert,
  LoadingState,
  PageError,
  PersonSummary,
  SectionCard,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
} from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { clientUpnError } from "../../../../lib/upn";
import { usePermissions } from "../../../../lib/use-permissions";
import {
  MedicationDietarySections,
  type DietaryRecord,
  type MedicationRecord,
} from "./medication-dietary";

type Guardian = {
  id: string;
  guardianUserId?: string;
  guardianFullName: string | null;
  guardianEmail: string | null;
  relationship: string;
  hasParentalResponsibility: boolean;
  portalAccess: boolean;
  membershipStatus: string | null;
  accountStatus?: string;
  pendingInvitation?: boolean;
  endedOn: string | null;
};

type Detail = {
  student: {
    id: string;
    legalName: string;
    preferredName: string | null;
    admissionNumber: string | null;
    enrolmentStatus: string;
    dateOfBirth: string | null;
    gender: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressTown: string | null;
    addressPostcode: string | null;
    currentYearGroupId: string | null;
    currentYearGroupName: string | null;
    currentFormClassId: string | null;
    currentFormClassName: string | null;
    currentAcademicYearId: string | null;
    currentAcademicYearName: string | null;
  };
  enrolments: Array<{
    id: string;
    academicYearId: string;
    academicYearName: string | null;
    yearGroupId: string;
    yearGroupName: string | null;
    status: string;
    isPrimary: boolean;
    placementKind: string;
    startedOn: string;
    endedOn: string | null;
  }>;
  classMemberships: Array<{
    id: string;
    className: string;
    classType: string;
    startedOn: string;
    endedOn: string | null;
  }>;
  guardians: Guardian[];
  attendanceSummary: {
    sessionsPossible: number;
    sessionsPresent: number;
    authorisedAbsence: number;
    unauthorisedAbsence: number;
    late: number;
    attendancePercentage: number | null;
  } | null;
  portalAccess: {
    enabled: boolean;
    source: string;
    hasLoginAlias?: boolean;
    alias?: string | null;
    hasCredentials?: boolean;
  };
  behaviourSummary: { incidentCount: number; openIncidents: number; positiveCount: number } | null;
  pastoralSummary: { openCount: number; latestPriority: string | null } | null;
};

type Option = { id: string; name: string; isCurrent?: boolean; code?: string };
type ClassOption = Option & { classType?: string; academicYearId?: string; yearGroupId?: string | null };

type LearningHistory = {
  items: Array<{
    assignmentId: string;
    title: string;
    dueAt: string | null;
    workTypeName: string | null;
    subjectName: string | null;
    submissionStatus: string;
    submittedAt: string | null;
    mark: { score: number | null; feedback: string | null } | null;
  }>;
};

type AttendanceHistory = {
  summary: {
    sessionsPossible: number;
    sessionsPresent: number;
    authorisedAbsence: number;
    unauthorisedAbsence: number;
    late: number;
    attendancePercentage: number | null;
  };
  marks: Array<{
    id: string;
    date: string;
    sessionName: string | null;
    codeName: string | null;
    category: string | null;
    className: string | null;
  }>;
};

type StatutoryRecord = {
  statutory: {
    upn: string | null;
    legalForename: string | null;
    legalSurname: string | null;
    middleNames: string | null;
    sex: string | null;
    ethnicityCode: string | null;
    languageCode: string | null;
    enrolmentStatusCode: string | null;
    dateOfAdmission: string | null;
    dateOfLeaving: string | null;
    sendProvisionCode: string | null;
    lookedAfterStatus: string | null;
    serviceChild: boolean | null;
    previousSchoolName: string | null;
    fsmPeriods: Array<{ startedOn: string; endedOn: string | null }>;
  };
  issues: Array<{
    severity: string;
    message: string;
    ruleKey?: string;
    field?: string | null;
    entityId?: string | null;
    fixPath?: string | null;
    fixLabel?: string | null;
  }>;
};

type InviteCreated = {
  name: string;
  email: string;
  relationship: string;
  token: string;
};

function actionError(err: unknown, fallback: string): string {
  return userFacingError(err, fallback);
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const permissions = usePermissions();
  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<PupilRecordTab>("overview");
  const [attendance, setAttendance] = useState<AttendanceHistory | null>(null);
  const [learning, setLearning] = useState<LearningHistory | null>(null);
  const [learningStatus, setLearningStatus] = useState<"loading" | "ready" | "error">("loading");
  const [academic, setAcademic] = useState<{
    results: Array<{
      assessmentTitle: string | null;
      subjectName: string | null;
      assessmentDate: string | null;
      percentage: number | null;
      gradeLabel: string | null;
      teacherJudgement: string | null;
      releasedToStudent: boolean;
      releasedToParent: boolean;
    }>;
    targets: Array<{ subjectName: string | null; targetLabel: string | null; baselineLabel: string | null }>;
    reports: Array<{ reportingPeriodName: string | null; status: string }>;
  } | null>(null);
  const [academicStatus, setAcademicStatus] = useState<"loading" | "ready" | "error">("loading");
  const [behaviour, setBehaviour] = useState<{
    incidents: Array<{ id: string; occurredAt: string; categoryName: string | null; severity: string; status: string }>;
    positives: Array<{ id: string; occurredOn: string; categoryName: string | null }>;
  } | null>(null);
  const [pastoral, setPastoral] = useState<{
    concerns: Array<{ id: string; concernOn: string; categoryName: string | null; priority: string; status: string; summary: string }>;
  } | null>(null);
  const [safeguardingLink, setSafeguardingLink] = useState(false);
  const [statutory, setStatutory] = useState<StatutoryRecord | null>(null);
  const [medicalView, setMedicalView] = useState<"full" | "operational" | "parent" | null>(null);
  const [medications, setMedications] = useState<MedicationRecord[]>([]);
  const [dietaryRequirements, setDietaryRequirements] = useState<DietaryRecord[]>([]);
  const [documents, setDocuments] = useState<Array<{
    id: string;
    title: string;
    documentType: string;
    visibility: string;
    originalFilename: string | null;
    byteSize: number | null;
    createdAt: string;
    downloadPath: string | null;
    fileStatus: string | null;
  }>>([]);
  const [uploadState, setUploadState] = useState("");
  const [years, setYears] = useState<Array<Option & { isCurrent?: boolean }>>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [error, setError] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [invite, setInvite] = useState<InviteCreated | null>(null);
  const [studentLoginToken, setStudentLoginToken] = useState("");
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [movingEnrolment, setMovingEnrolment] = useState(false);
  const [enrolYearId, setEnrolYearId] = useState("");
  const [enrolGroupId, setEnrolGroupId] = useState("");
  const [enrolClassId, setEnrolClassId] = useState("");
  const [enrolKind, setEnrolKind] = useState("primary");
  const [upnError, setUpnError] = useState("");
  const [copyState, setCopyState] = useState("");
  const loadSeq = useRef(0);
  const [sectionsReady, setSectionsReady] = useState(false);
  const canManagePupil = permissions.has("students.profiles.manage");
  const canManageGuardians = permissions.has("guardianships.manage");
  const canManagePortal = permissions.has("students.portal_access.manage");
  const canManageStatutory = permissions.has("pupils.statutory.manage");

  function goToTab(next: PupilRecordTab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  }

  async function load() {
    const seq = ++loadSeq.current;
    const studentId = params.id;
    const [detail, yr, yg, cl] = await Promise.all([
      api<Detail>(`/api/v1/students/${studentId}`),
      api<{ academicYears: Array<Option & { isCurrent?: boolean }> }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: ClassOption[] }>("/api/v1/classes"),
    ]);
    if (seq !== loadSeq.current) return;
    setData(detail);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
    const initial = enrolmentFormInitialState({
      currentAcademicYearId: detail.student.currentAcademicYearId,
      currentYearGroupId: detail.student.currentYearGroupId,
      currentFormClassId: detail.student.currentFormClassId,
      academicYears: yr.academicYears,
    });
    setEnrolYearId(initial.academicYearId);
    setEnrolGroupId(initial.yearGroupId);
    setEnrolClassId(initial.classId);
    if (detail.attendanceSummary) {
      try {
        const history = await api<AttendanceHistory>(`/api/v1/attendance/students/${studentId}`);
        if (seq !== loadSeq.current) return;
        setAttendance(history);
      } catch {
        if (seq !== loadSeq.current) return;
        setAttendance(null);
      }
    } else {
      setAttendance(null);
    }
    try {
      const learningHistory = await api<LearningHistory>(`/api/v1/students/${studentId}/learning`);
      if (seq !== loadSeq.current) return;
      setLearning(learningHistory);
      setLearningStatus("ready");
    } catch {
      if (seq !== loadSeq.current) return;
      setLearning(null);
      setLearningStatus("error");
    }
    try {
      const behaviourHistory = await api<{
        incidents: Array<{ id: string; occurredAt: string; categoryName: string | null; severity: string; status: string }>;
        positives: Array<{ id: string; occurredOn: string; categoryName: string | null }>;
      }>(`/api/v1/students/${studentId}/behaviour`);
      if (seq !== loadSeq.current) return;
      setBehaviour(behaviourHistory);
    } catch {
      if (seq !== loadSeq.current) return;
      setBehaviour(null);
    }
    try {
      const pastoralHistory = await api<{
        concerns: Array<{ id: string; concernOn: string; categoryName: string | null; priority: string; status: string; summary: string }>;
      }>(`/api/v1/students/${studentId}/pastoral`);
      if (seq !== loadSeq.current) return;
      setPastoral(pastoralHistory);
    } catch {
      if (seq !== loadSeq.current) return;
      setPastoral(null);
    }
    try {
      await api(`/api/v1/students/${studentId}/safeguarding`);
      if (seq !== loadSeq.current) return;
      setSafeguardingLink(true);
    } catch {
      if (seq !== loadSeq.current) return;
      setSafeguardingLink(false);
    }
    try {
      const docs = await api<{ documents: typeof documents }>(`/api/v1/students/${studentId}/documents`);
      if (seq !== loadSeq.current) return;
      setDocuments(docs.documents);
    } catch {
      if (seq !== loadSeq.current) return;
      setDocuments([]);
    }
    try {
      const academicHistory = await api<{
        results: Array<{
          assessmentTitle: string | null;
          subjectName: string | null;
          assessmentDate: string | null;
          percentage: number | null;
          gradeLabel: string | null;
          teacherJudgement: string | null;
          releasedToStudent: boolean;
          releasedToParent: boolean;
        }>;
        targets: Array<{ subjectName: string | null; targetLabel: string | null; baselineLabel: string | null }>;
        reports: Array<{ reportingPeriodName: string | null; status: string }>;
      }>(`/api/v1/students/${studentId}/academic`);
      if (seq !== loadSeq.current) return;
      setAcademic(academicHistory);
      setAcademicStatus("ready");
    } catch {
      if (seq !== loadSeq.current) return;
      setAcademic(null);
      setAcademicStatus("error");
    }
    try {
      const statutoryRecord = await api<StatutoryRecord>(`/api/v1/students/${studentId}/statutory`);
      if (seq !== loadSeq.current) return;
      setStatutory(statutoryRecord);
    } catch {
      if (seq !== loadSeq.current) return;
      setStatutory(null);
    }
    try {
      const [meds, diet] = await Promise.all([
        api<{ view: "full" | "operational" | "parent"; medications: MedicationRecord[] }>(
          `/api/v1/students/${studentId}/medications`,
        ),
        api<{ view: "full" | "operational" | "parent"; dietaryRequirements: DietaryRecord[] }>(
          `/api/v1/students/${studentId}/dietary-requirements`,
        ),
      ]);
      if (seq !== loadSeq.current) return;
      setMedicalView(meds.view);
      setMedications(meds.medications);
      setDietaryRequirements(diet.dietaryRequirements);
    } catch {
      if (seq !== loadSeq.current) return;
      setMedicalView(null);
      setMedications([]);
      setDietaryRequirements([]);
    }
    if (seq !== loadSeq.current) return;
    setSectionsReady(true);
  }

  useEffect(() => {
    setData(null);
    setAttendance(null);
    setLearning(null);
    setLearningStatus("loading");
    setAcademic(null);
    setAcademicStatus("loading");
    setBehaviour(null);
    setPastoral(null);
    setSafeguardingLink(false);
    setStatutory(null);
    setMedicalView(null);
    setMedications([]);
    setDietaryRequirements([]);
    setError("");
    setActionErrorMessage("");
    setInvite(null);
    setEditingIdentity(false);
    setMovingEnrolment(false);
    setSectionsReady(false);
    load().catch((err: unknown) => setError(actionError(err, "Could not load this pupil record.")));
    return () => {
      loadSeq.current += 1;
    };
  }, [params.id]);

  const filteredClasses = useMemo(
    () => filterFormClasses(classes, { academicYearId: enrolYearId, yearGroupId: enrolGroupId }),
    [classes, enrolYearId, enrolGroupId],
  );
  const visibleTabs = useMemo(
    () =>
      visiblePupilRecordTabs({
        canViewHealth: Boolean(medicalView),
        canViewStatutory: Boolean(statutory),
        canViewPastoral: Boolean(data?.behaviourSummary || data?.pastoralSummary || safeguardingLink),
      }),
    [medicalView, statutory, data, safeguardingLink],
  );
  const activeTab = visibleTabs.includes(tab) ? tab : (visibleTabs[0] ?? "overview");

  useEffect(() => {
    setEnrolClassId((current) => selectedEnrolmentClassId(current, filteredClasses));
  }, [filteredClasses]);

  useEffect(() => {
    function applyHash() {
      if (!sectionsReady) return;
      const { tab: next, nextHash } = pupilRecordHashCanonicalize(window.location.hash, visibleTabs);
      setTab(next);
      if (nextHash) {
        window.history.replaceState(null, "", `#${nextHash}`);
      }
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [sectionsReady, visibleTabs]);

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManagePupil) return;
    const form = new FormData(event.currentTarget);
    setActionErrorMessage("");
    try {
      await api(`/api/v1/students/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          legalName: form.get("legalName"),
          preferredName: form.get("preferredName") || null,
          admissionNumber: form.get("admissionNumber") || null,
          dateOfBirth: form.get("dateOfBirth") || null,
          gender: form.get("gender") || null,
          addressLine1: form.get("addressLine1") || null,
          addressLine2: form.get("addressLine2") || null,
          addressTown: form.get("addressTown") || null,
          addressPostcode: form.get("addressPostcode") || null,
        }),
      });
      setEditingIdentity(false);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not save pupil details."));
    }
  }

  async function enrol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManagePupil || !data) return;
    setActionErrorMessage("");
    if (
      isSamePrimaryPlacement({
        currentAcademicYearId: data.student.currentAcademicYearId,
        currentYearGroupId: data.student.currentYearGroupId,
        currentFormClassId: data.student.currentFormClassId,
        academicYearId: enrolYearId,
        yearGroupId: enrolGroupId,
        classId: selectedEnrolmentClassId(enrolClassId, filteredClasses) || null,
        placementKind: enrolKind,
      })
    ) {
      setActionErrorMessage("The pupil is already in this placement.");
      return;
    }
    const classId = selectedEnrolmentClassId(enrolClassId, filteredClasses);
    try {
      await api(`/api/v1/students/${params.id}/enrolments`, {
        method: "POST",
        body: JSON.stringify({
          academicYearId: enrolYearId,
          yearGroupId: enrolGroupId,
          classId: classId || undefined,
          placementKind: enrolKind || "primary",
        }),
      });
      setMovingEnrolment(false);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not update enrolment."));
    }
  }

  async function togglePortal(guardianId: string, portalAccess: boolean) {
    setActionErrorMessage("");
    try {
      await api(`/api/v1/guardianships/${guardianId}`, {
        method: "PATCH",
        body: JSON.stringify({ portalAccess }),
      });
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not update parent portal access."));
    }
  }

  async function addGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageGuardians) return;
    const form = event.currentTarget;
    const payload = new FormData(form);
    const name = String(payload.get("fullName") ?? "");
    const email = String(payload.get("email") ?? "");
    const relationship = String(payload.get("relationship") || "other");
    setActionErrorMessage("");
    try {
      const created = await api<{
        invitationToken?: string | null;
        alreadyLinked?: boolean;
        guardianship: Guardian | null;
      }>(`/api/v1/students/${params.id}/guardians`, {
        method: "POST",
        body: JSON.stringify({
          email,
          fullName: name,
          relationship,
          hasParentalResponsibility: payload.get("hasParentalResponsibility") === "on",
          portalAccess: payload.get("portalAccess") === "on",
        }),
      });
      if (created.guardianship) {
        setData((current) =>
          current
            ? {
                ...current,
                guardians: current.guardians.some((row) => row.id === created.guardianship?.id)
                  ? current.guardians
                  : [...current.guardians, created.guardianship!],
              }
            : current,
        );
      }
      if (created.invitationToken) {
        setInvite({ name, email, relationship, token: created.invitationToken });
      } else {
        setInvite(null);
      }
      resetFormSafely(form);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not invite or link this parent."));
    }
  }

  async function inviteGuardian(guardianId: string) {
    setActionErrorMessage("");
    try {
      const body = await api<{ invitationToken: string }>(`/api/v1/guardianships/${guardianId}/invite`, {
        method: "POST",
      });
      setInvite({ name: "Parent", email: "", relationship: "", token: body.invitationToken });
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not invite parent."));
    }
  }

  async function revokeGuardianInvite(guardianId: string) {
    setActionErrorMessage("");
    try {
      await api(`/api/v1/guardianships/${guardianId}/invite/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not revoke invitation."));
    }
  }

  async function linkExistingGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageGuardians) return;
    const form = event.currentTarget;
    const payload = new FormData(form);
    setActionErrorMessage("");
    try {
      await api(`/api/v1/students/${params.id}/guardians/link-existing`, {
        method: "POST",
        body: JSON.stringify({
          guardianUserId: payload.get("guardianUserId"),
          relationship: payload.get("relationship") || "other",
          hasParentalResponsibility: payload.get("hasParentalResponsibility") === "on",
          portalAccess: payload.get("portalAccess") === "on",
        }),
      });
      resetFormSafely(form);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not link existing parent."));
    }
  }

  async function createStudentLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const alias = String(new FormData(form).get("alias") ?? "");
    setActionErrorMessage("");
    try {
      const body = await api<{ activationToken: string }>(`/api/v1/students/${params.id}/portal-login`, {
        method: "POST",
        body: JSON.stringify({ alias }),
      });
      setStudentLoginToken(body.activationToken);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not create student login."));
    }
  }

  async function resetStudentLogin() {
    setActionErrorMessage("");
    try {
      const body = await api<{ activationToken: string }>(`/api/v1/students/${params.id}/portal-login/reset`, {
        method: "POST",
      });
      setStudentLoginToken(body.activationToken);
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not reset student access."));
    }
  }

  async function disableStudentLogin() {
    setActionErrorMessage("");
    try {
      await api(`/api/v1/students/${params.id}/portal-login/disable`, { method: "POST" });
      await load();
    } catch (err) {
      setActionErrorMessage(actionError(err, "Could not disable student login."));
    }
  }

  async function saveStatutory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageStatutory) return;
    const form = new FormData(event.currentTarget);
    const upn = String(form.get("upn") ?? "");
    const clientError = clientUpnError(upn);
    setUpnError(clientError ?? "");
    setActionErrorMessage("");
    if (clientError) return;
    try {
      await api(`/api/v1/students/${params.id}/statutory`, {
        method: "PATCH",
        body: JSON.stringify({
          upn: upn || null,
          legalForename: form.get("legalForename") || null,
          legalSurname: form.get("legalSurname") || null,
          middleNames: form.get("middleNames") || null,
          sex: form.get("sex") || null,
          ethnicityCode: form.get("ethnicityCode") || null,
          languageCode: form.get("languageCode") || null,
          enrolmentStatusCode: form.get("enrolmentStatusCode") || null,
          dateOfAdmission: form.get("dateOfAdmission") || null,
          sendProvisionCode: form.get("sendProvisionCode") || null,
          previousSchoolName: form.get("previousSchoolName") || null,
          lookedAfterStatus: lookedAfterPersistValue(String(form.get("lookedAfterStatus") ?? "")),
          serviceChild: form.get("serviceChild") === "on",
        }),
      });
      await load();
    } catch (err) {
      const message = actionError(err, "Could not save the statutory record.");
      setActionErrorMessage(message);
      if (/UPN/i.test(message)) setUpnError(message);
    }
  }

  if (error && !data) {
    return <PageError title="Could not open pupil record" description={error} />;
  }
  if (!data) return <LoadingState label="Loading pupil record…" />;

  const identityGaps = pupilIdentityGaps({
    legalName: data.student.legalName,
    dateOfBirth: data.student.dateOfBirth,
    gender: data.student.gender,
    sex: statutory?.statutory.sex ?? null,
  });
  const address = formatPupilAddress(data.student);
  const nextYearName = years.find((year) => year.id === enrolYearId)?.name ?? null;
  const nextGroupName = groups.find((group) => group.id === enrolGroupId)?.name ?? null;
  const nextClassName = filteredClasses.find((row) => row.id === selectedEnrolmentClassId(enrolClassId, filteredClasses))?.name ?? null;
  const tabLabels: Record<PupilRecordTab, string> = {
    overview: "Overview",
    attendance: "Attendance",
    learning: "Learning",
    academic: "Academic",
    documents: "Documents",
    health: "Medication & dietary",
    statutory: "Statutory",
    pastoral: "Pastoral",
  };

  return (
    <>
      {actionErrorMessage ? <Alert tone="danger">{actionErrorMessage}</Alert> : null}
      <PersonSummary
        name={data.student.preferredName || data.student.legalName}
        meta={
          <>
            {data.student.currentYearGroupName ?? "No current year group"}
            {data.student.currentFormClassName ? ` · ${data.student.currentFormClassName}` : ""}
            {data.student.admissionNumber ? ` · ${data.student.admissionNumber}` : ""}
            {` · ${data.student.enrolmentStatus}`}
          </>
        }
        actions={<StatusBadge status={data.student.enrolmentStatus} />}
      />
      <p className="muted">
        Student portal: {data.portalAccess.enabled ? "enabled" : "disabled"}
        {data.portalAccess.hasLoginAlias ? ` · login alias ${data.portalAccess.alias}` : " · no student login yet"}
        {data.portalAccess.hasCredentials ? " · credentials set" : ""}
        {" · "}
        <a href="/school/student-portal">Student Portal policy</a>
      </p>
      {studentLoginToken ? <InviteTokenAlert token={studentLoginToken} kind="activation" /> : null}
      {canManagePortal ? (
        <SectionCard title="Student Portal account" description="Policy is rechecked on every request. Passwords are never shown after this one-time token.">
          {data.portalAccess.hasLoginAlias ? (
            <div className="button-row">
              <Button type="button" variant="secondary" onClick={resetStudentLogin}>
                Reset / reissue access
              </Button>
              <Button type="button" variant="danger" onClick={disableStudentLogin}>
                Disable account
              </Button>
            </div>
          ) : (
            <form className="form-grid" onSubmit={createStudentLogin}>
              <FormField label="Login username">
                <Input name="alias" required minLength={3} pattern="[a-z0-9._-]+" placeholder="j.smith" />
              </FormField>
              <div>
                <Button type="submit">Create student login</Button>
              </div>
            </form>
          )}
        </SectionCard>
      ) : null}
      <Tabs>
        {visibleTabs.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeTab === id ? "active" : undefined}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                goToTab(id);
              }}
            >
              {tabLabels[id]}
            </a>
          ))}
      </Tabs>

      {activeTab === "overview" ? (
        <div className="pupil-tab-panel" id="overview">
          {identityGaps.length > 0 ? (
            <Alert tone="warning">
              Complete pupil details: {identityGaps.join(", ")}.
              {canManagePupil ? (
                <>
                  {" "}
                  <Button type="button" variant="secondary" onClick={() => setEditingIdentity(true)}>
                    Edit pupil details
                  </Button>
                </>
              ) : null}
            </Alert>
          ) : null}
          <SectionCard
            title="Personal details"
            description="Canonical pupil identity. Date of birth is stored on the pupil user record, not the census form."
            actions={
              canManagePupil ? (
                <Button type="button" variant="secondary" onClick={() => setEditingIdentity((open) => !open)}>
                  {editingIdentity ? "Cancel" : "Edit"}
                </Button>
              ) : null
            }
          >
            <div id="pupil-details">
              {editingIdentity && canManagePupil ? (
                <form className="form-grid" onSubmit={saveIdentity}>
                  <FormField label="Legal name">
                    <Input name="legalName" defaultValue={data.student.legalName} required />
                  </FormField>
                  <FormField label="Preferred name">
                    <Input name="preferredName" defaultValue={data.student.preferredName ?? ""} />
                  </FormField>
                  <FormField label="Date of birth">
                    <Input type="date" name="dateOfBirth" defaultValue={data.student.dateOfBirth ?? ""} />
                  </FormField>
                  <FormField label="Sex / gender" hint="Operational value from admissions. Statutory sex (M/F) is edited on the Statutory tab.">
                    <Select name="gender" defaultValue={data.student.gender ?? ""}>
                      <option value="">Not recorded</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </Select>
                  </FormField>
                  <FormField label="Admission number">
                    <Input name="admissionNumber" defaultValue={data.student.admissionNumber ?? ""} />
                  </FormField>
                  <FormField label="Address line 1">
                    <Input name="addressLine1" defaultValue={data.student.addressLine1 ?? ""} />
                  </FormField>
                  <FormField label="Address line 2">
                    <Input name="addressLine2" defaultValue={data.student.addressLine2 ?? ""} />
                  </FormField>
                  <FormField label="Town">
                    <Input name="addressTown" defaultValue={data.student.addressTown ?? ""} />
                  </FormField>
                  <FormField label="Postcode">
                    <Input name="addressPostcode" defaultValue={data.student.addressPostcode ?? ""} />
                  </FormField>
                  <div>
                    <Button type="submit">Save pupil details</Button>
                  </div>
                </form>
              ) : (
                <dl className="profile-list">
                  <div>
                    <dt>Legal name</dt>
                    <dd>{data.student.legalName}</dd>
                  </div>
                  <div>
                    <dt>Preferred name</dt>
                    <dd>{data.student.preferredName || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Date of birth</dt>
                    <dd>{data.student.dateOfBirth || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Sex / gender</dt>
                    <dd>{data.student.gender || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Admission number</dt>
                    <dd>{data.student.admissionNumber || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{address || "Not provided"}</dd>
                  </div>
                </dl>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Current placement"
            actions={
              canManagePupil ? (
                <Button type="button" variant="secondary" onClick={() => setMovingEnrolment((open) => !open)}>
                  {movingEnrolment ? "Close" : "Add / move enrolment"}
                </Button>
              ) : null
            }
          >
            <dl className="profile-list">
              <div>
                <dt>Academic year</dt>
                <dd>{data.student.currentAcademicYearName || "Not enrolled"}</dd>
              </div>
              <div>
                <dt>Year group</dt>
                <dd>{data.student.currentYearGroupName || "Not provided"}</dd>
              </div>
              <div>
                <dt>Form class</dt>
                <dd>{data.student.currentFormClassName || "None"}</dd>
              </div>
              <div>
                <dt>Enrolment status</dt>
                <dd>{data.student.enrolmentStatus}</dd>
              </div>
            </dl>
            {movingEnrolment && canManagePupil ? (
              <form className="form-grid" onSubmit={enrol} style={{ marginTop: "1rem" }}>
                <FormField label="Academic year">
                  <Select
                    value={enrolYearId}
                    onChange={(event) => {
                      setEnrolYearId(event.target.value);
                      setEnrolClassId("");
                    }}
                    required
                  >
                    <option value="">Select…</option>
                    {years.map((year) => (
                      <option key={year.id} value={year.id}>
                        {year.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Year group">
                  <Select
                    value={enrolGroupId}
                    onChange={(event) => {
                      setEnrolGroupId(event.target.value);
                      setEnrolClassId("");
                    }}
                    required
                  >
                    <option value="">Select…</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Form class">
                  <Select value={selectedEnrolmentClassId(enrolClassId, filteredClasses)} onChange={(event) => setEnrolClassId(event.target.value)}>
                    <option value="">None</option>
                    {filteredClasses.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Placement">
                  <Select value={enrolKind} onChange={(event) => setEnrolKind(event.target.value)}>
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="exceptional">Exceptional</option>
                  </Select>
                </FormField>
                {enrolYearId && enrolGroupId ? (
                  <p className="muted">
                    {describeEnrolmentChange({
                      currentAcademicYearName: data.student.currentAcademicYearName,
                      currentYearGroupName: data.student.currentYearGroupName,
                      currentFormClassName: data.student.currentFormClassName,
                      nextAcademicYearName: nextYearName,
                      nextYearGroupName: nextGroupName,
                      nextFormClassName: nextClassName,
                      placementKind: enrolKind,
                    })}
                  </p>
                ) : (
                  <p className="muted">Choose an academic year and year group. The form does not default to Nursery or the first catalogue row.</p>
                )}
                <div>
                  <Button type="submit">Save enrolment change</Button>
                </div>
              </form>
            ) : null}
          </SectionCard>

          <SectionCard title="Parents / guardians">
            {data.guardians.length === 0 ? (
              <p className="muted">No guardians linked yet.</p>
            ) : (
              <DataTable
                headers={
                  <>
                    <th>Name</th>
                    <th>Relationship</th>
                    <th>Account</th>
                    <th>Portal</th>
                    <th>PR</th>
                    <th>Status</th>
                  </>
                }
              >
                {data.guardians.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.guardianFullName}
                      <div className="muted">{row.guardianEmail}</div>
                    </td>
                    <td>{row.relationship}</td>
                    <td>{guardianAccountLabel(row.membershipStatus)}</td>
                    <td>
                      {row.endedOn || !canManageGuardians ? (
                        portalAccessLabel(row.portalAccess)
                      ) : (
                        <Button type="button" variant="secondary" onClick={() => togglePortal(row.id, !row.portalAccess)}>
                          {portalAccessLabel(row.portalAccess)}
                        </Button>
                      )}
                    </td>
                    <td>{row.hasParentalResponsibility ? "Yes" : "No"}</td>
                    <td>
                      {row.endedOn ?? "current"}
                      {canManageGuardians && !row.endedOn ? (
                        <div className="button-row">
                          <Button type="button" variant="ghost" onClick={() => inviteGuardian(row.id)}>
                            {row.pendingInvitation ? "Resend" : "Invite"}
                          </Button>
                          {row.pendingInvitation ? (
                            <Button type="button" variant="ghost" onClick={() => revokeGuardianInvite(row.id)}>
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
            {canManageGuardians ? (
              <form className="form-grid" onSubmit={addGuardian} style={{ marginTop: "1rem" }}>
                <FormField label="Name">
                  <Input name="fullName" required />
                </FormField>
                <FormField label="Email">
                  <Input name="email" type="email" required />
                </FormField>
                <FormField label="Relationship">
                  <Select name="relationship" defaultValue="mother">
                    <option value="mother">Mother</option>
                    <option value="father">Father</option>
                    <option value="carer">Carer</option>
                    <option value="other">Other</option>
                  </Select>
                </FormField>
                <Checkbox name="hasParentalResponsibility" label="Parental responsibility" />
                <Checkbox name="portalAccess" label="Enable parent portal access" />
                <div>
                  <Button type="submit">Invite / link parent</Button>
                </div>
              </form>
            ) : null}
            {canManageGuardians ? (
              <form className="form-grid" onSubmit={linkExistingGuardian} style={{ marginTop: "1rem" }}>
                <FormField label="Existing parent user id (same school only)">
                  <Input name="guardianUserId" required placeholder="uuid" />
                </FormField>
                <FormField label="Relationship">
                  <Select name="relationship" defaultValue="other">
                    <option value="mother">Mother</option>
                    <option value="father">Father</option>
                    <option value="carer">Carer</option>
                    <option value="other">Other</option>
                  </Select>
                </FormField>
                <Checkbox name="hasParentalResponsibility" label="Parental responsibility" />
                <Checkbox name="portalAccess" label="Enable parent portal access" />
                <div>
                  <Button type="submit">Link existing parent</Button>
                </div>
              </form>
            ) : null}
          </SectionCard>

          <SectionCard title="Enrolment history">
            <DataTable
              headers={
                <>
                  <th>Year</th>
                  <th>Year group</th>
                  <th>Kind</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Status</th>
                </>
              }
            >
              {data.enrolments.map((row) => (
                <tr key={row.id}>
                  <td>{row.academicYearName}</td>
                  <td>{row.yearGroupName}</td>
                  <td>
                    {row.placementKind}
                    {row.isPrimary ? " (primary)" : ""}
                  </td>
                  <td>{row.startedOn}</td>
                  <td>{row.endedOn ?? "current"}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </DataTable>
            <h3>Class memberships</h3>
            <DataTable
              headers={
                <>
                  <th>Class</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                </>
              }
            >
              {data.classMemberships.map((row) => (
                <tr key={row.id}>
                  <td>{row.className}</td>
                  <td>{row.classType}</td>
                  <td>{row.startedOn}</td>
                  <td>{row.endedOn ?? "current"}</td>
                </tr>
              ))}
            </DataTable>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "attendance" ? (
        <div className="pupil-tab-panel" id="attendance">
          {data.attendanceSummary ? (
            <div className="cards">
              <StatCard label="Attendance" value={`${data.attendanceSummary.attendancePercentage ?? "—"}${data.attendanceSummary.attendancePercentage != null ? "%" : ""}`} />
              <StatCard label="Possible sessions" value={data.attendanceSummary.sessionsPossible} />
              <StatCard label="Present" value={data.attendanceSummary.sessionsPresent} />
              <StatCard label="Unauthorised" value={data.attendanceSummary.unauthorisedAbsence} />
            </div>
          ) : (
            <p className="muted">No attendance summary is available for this pupil.</p>
          )}
          {attendance && attendance.marks.length > 0 ? (
            <SectionCard title="Attendance history">
              <DataTable
                headers={
                  <>
                    <th>Date</th>
                    <th>Session</th>
                    <th>Mark</th>
                    <th>Class</th>
                  </>
                }
              >
                {attendance.marks.slice(0, 24).map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.sessionName}</td>
                    <td>{row.codeName}</td>
                    <td>{row.className ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {activeTab === "learning" ? (
        <div className="pupil-tab-panel" id="learning">
          <SectionCard title="Learning">
            {learningStatus === "loading" ? (
              <p className="muted">Loading learning history…</p>
            ) : learningStatus === "error" ? (
              <p className="muted">Unable to load learning history.</p>
            ) : learning && learning.items.length > 0 ? (
              <DataTable
                headers={
                  <>
                    <th>Work</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Feedback</th>
                  </>
                }
              >
                {learning.items.map((row) => (
                  <tr key={row.assignmentId}>
                    <td>
                      {row.title}
                      <div className="muted">{row.subjectName ?? row.workTypeName}</div>
                    </td>
                    <td>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "—"}</td>
                    <td>{row.submissionStatus.replaceAll("_", " ")}</td>
                    <td>{row.mark?.score != null ? String(row.mark.score) : row.mark?.feedback ? "Feedback" : "—"}</td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <p className="muted">No assigned learning work recorded for this pupil.</p>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "academic" ? (
        <div className="pupil-tab-panel" id="academic">
          <SectionCard title="Academic / Results">
            {academicStatus === "loading" ? (
              <p className="muted">Loading formal assessment history…</p>
            ) : academicStatus === "error" ? (
              <p className="muted">Unable to load formal assessment history.</p>
            ) : academic && academic.results.length > 0 ? (
              <DataTable
                headers={
                  <>
                    <th>Assessment</th>
                    <th>Date</th>
                    <th>Result</th>
                    <th>Release</th>
                  </>
                }
              >
                {academic.results.map((row, index) => (
                  <tr key={`${row.assessmentTitle}-${index}`}>
                    <td>
                      {row.assessmentTitle}
                      <div className="muted">{row.subjectName}</div>
                    </td>
                    <td>{row.assessmentDate ?? "—"}</td>
                    <td>{row.gradeLabel ?? row.teacherJudgement ?? (row.percentage != null ? `${row.percentage}%` : "—")}</td>
                    <td>
                      {row.releasedToStudent ? "student" : "—"}
                      {row.releasedToParent ? " / parent" : ""}
                    </td>
                  </tr>
                ))}
              </DataTable>
            ) : (
              <p className="muted">No formal assessment results recorded for this pupil.</p>
            )}
          </SectionCard>
          {academic && academic.targets.length > 0 ? (
            <SectionCard title="Targets">
              <DataTable
                headers={
                  <>
                    <th>Subject</th>
                    <th>Target</th>
                    <th>Baseline</th>
                  </>
                }
              >
                {academic.targets.map((row, index) => (
                  <tr key={`${row.subjectName}-${index}`}>
                    <td>{row.subjectName}</td>
                    <td>{row.targetLabel ?? "—"}</td>
                    <td>{row.baselineLabel ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            </SectionCard>
          ) : null}
          {academic && academic.reports.length > 0 ? (
            <SectionCard title="Reports">
              <DataTable
                headers={
                  <>
                    <th>Period</th>
                    <th>Status</th>
                  </>
                }
              >
                {academic.reports.map((row, index) => (
                  <tr key={`${row.reportingPeriodName}-${index}`}>
                    <td>{row.reportingPeriodName}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </DataTable>
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="pupil-tab-panel" id="documents">
          <SectionCard title="Documents">
            {documents.length === 0 ? (
              <p className="muted">No pupil documents yet.</p>
            ) : (
              <DataTable
                headers={
                  <>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Visibility</th>
                    <th>File</th>
                    <th></th>
                  </>
                }
              >
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.title}</td>
                    <td>{doc.documentType}</td>
                    <td>{doc.visibility.replaceAll("_", " ")}</td>
                    <td>
                      {doc.originalFilename ?? "Metadata only"}
                      {doc.byteSize ? ` · ${Math.round(doc.byteSize / 1024)} KB` : ""}
                    </td>
                    <td>
                      {doc.downloadPath ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            downloadAuthenticated(doc.downloadPath!, doc.originalFilename ?? "document").catch((err: unknown) =>
                              setActionErrorMessage(actionError(err, "Download failed.")),
                            )
                          }
                        >
                          Download
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
            <form
              className="form-grid"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const payload = new FormData(form);
                setUploadState("Uploading…");
                setActionErrorMessage("");
                try {
                  await api(`/api/v1/students/${params.id}/documents`, { method: "POST", body: payload });
                  form.reset();
                  setUploadState("Uploaded");
                  const docs = await api<{ documents: typeof documents }>(`/api/v1/students/${params.id}/documents`);
                  setDocuments(docs.documents);
                } catch (err) {
                  setUploadState("");
                  setActionErrorMessage(actionError(err, "Upload failed."));
                }
              }}
            >
              <FormField label="Title">
                <Input name="title" required />
              </FormField>
              <FormField label="Type">
                <Select name="documentType" defaultValue="report">
                  <option value="report">Report</option>
                  <option value="letter">Letter</option>
                  <option value="consent">Consent</option>
                  <option value="support">Support</option>
                  <option value="school_record">School record</option>
                  <option value="other">Other</option>
                </Select>
              </FormField>
              <FormField label="Visibility">
                <Select name="visibility" defaultValue="staff">
                  <option value="staff">Staff only</option>
                  <option value="staff_and_parents">Staff and parents</option>
                  <option value="staff_parents_and_student">Staff, parents and pupil</option>
                </Select>
              </FormField>
              <FormField label="File">
                <Input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt" />
              </FormField>
              <div>
                <Button type="submit">Upload document</Button>
              </div>
              {uploadState ? <p className="muted">{uploadState}</p> : null}
            </form>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "health" && medicalView ? (
        <div className="pupil-tab-panel" id="health">
          <MedicationDietarySections
            studentId={params.id}
            view={medicalView}
            canManage={permissions.has("students.additional_needs.manage")}
            medications={medications}
            dietaryRequirements={dietaryRequirements}
            onChanged={load}
          />
        </div>
      ) : null}

      {activeTab === "statutory" && statutory ? (
        <form id="statutory" className="pupil-tab-panel" onSubmit={saveStatutory} key={`${statutory.statutory.upn ?? ""}-${statutory.statutory.sex ?? ""}-${statutory.statutory.lookedAfterStatus ?? ""}`}>
          <SectionCard
            title="Statutory record"
            description="Permission-gated census fields. Preferred name stays operational and is not a substitute for legal name. Date of birth is edited in Personal details."
          >
            {statutory.issues.length > 0 ? (
              <Alert tone="warning">
                {statutory.issues.map((issue) => {
                  const fix = statutoryIssueFix({
                    ruleKey: issue.ruleKey,
                    field: issue.field,
                    entityId: issue.entityId ?? params.id,
                  });
                  return (
                    <p key={`${issue.ruleKey}-${issue.message}`}>
                      <StatusBadge status={issue.severity} /> {issue.message}{" "}
                      {fix ? (
                        <a
                          href={fix.href}
                          onClick={(event) => {
                            event.preventDefault();
                            const next = resolvePupilRecordTab(fix.href.split("#")[1], visibleTabs);
                            goToTab(next);
                            if (next === "overview") setEditingIdentity(true);
                          }}
                        >
                          {issue.fixLabel ?? fix.label}
                        </a>
                      ) : null}
                    </p>
                  );
                })}
              </Alert>
            ) : (
              <p className="muted">No statutory validation issues for this pupil.</p>
            )}
            <div className="form-grid">
              <FormField label="UPN" error={upnError || undefined}>
                <Input
                  name="upn"
                  defaultValue={statutory.statutory.upn ?? ""}
                  readOnly={!canManageStatutory}
                  onChange={() => setUpnError("")}
                />
              </FormField>
              <FormField label="Legal forename">
                <Input name="legalForename" defaultValue={statutory.statutory.legalForename ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="Legal surname">
                <Input name="legalSurname" defaultValue={statutory.statutory.legalSurname ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="Middle names">
                <Input name="middleNames" defaultValue={statutory.statutory.middleNames ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="Sex" hint="Census sex (M/F). This is not filled from an untouched default.">
                <Select id="statutory-sex" name="sex" defaultValue={statutory.statutory.sex ?? ""} disabled={!canManageStatutory}>
                  <option value="">Select…</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </Select>
              </FormField>
              <FormField label="Ethnicity code">
                <Input name="ethnicityCode" defaultValue={statutory.statutory.ethnicityCode ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="Language code">
                <Input name="languageCode" defaultValue={statutory.statutory.languageCode ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="Enrolment status">
                <Select name="enrolmentStatusCode" defaultValue={statutory.statutory.enrolmentStatusCode ?? ""} disabled={!canManageStatutory}>
                  <option value="">Select…</option>
                  <option value="C">Current</option>
                  <option value="G">Guest</option>
                  <option value="M">Main dual</option>
                  <option value="S">Subsidiary dual</option>
                  <option value="F">FE</option>
                </Select>
              </FormField>
              <FormField label="Admission date">
                <Input type="date" name="dateOfAdmission" defaultValue={statutory.statutory.dateOfAdmission ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <FormField label="SEND provision">
                <Select name="sendProvisionCode" defaultValue={statutory.statutory.sendProvisionCode ?? ""} disabled={!canManageStatutory}>
                  <option value="">Not recorded</option>
                  <option value="N">None</option>
                  <option value="K">SEN support</option>
                  <option value="E">EHC plan</option>
                </Select>
              </FormField>
              <FormField label="Looked-after status" hint="Never inferred from the first option. Not recorded saves as none.">
                <Select
                  name="lookedAfterStatus"
                  defaultValue={statutory.statutory.lookedAfterStatus && statutory.statutory.lookedAfterStatus !== "none" ? statutory.statutory.lookedAfterStatus : statutory.statutory.lookedAfterStatus === "none" ? "none" : ""}
                  disabled={!canManageStatutory}
                >
                  <option value="">Not recorded</option>
                  <option value="none">Not looked after</option>
                  <option value="looked_after">Looked after</option>
                  <option value="previously_looked_after">Previously looked after</option>
                </Select>
              </FormField>
              <FormField label="Previous school">
                <Input name="previousSchoolName" defaultValue={statutory.statutory.previousSchoolName ?? ""} readOnly={!canManageStatutory} />
              </FormField>
              <Checkbox
                name="serviceChild"
                label="Service child"
                defaultChecked={Boolean(statutory.statutory.serviceChild)}
                disabled={!canManageStatutory}
              />
            </div>
            {canManageStatutory ? (
              <div>
                <Button type="submit">Save statutory record</Button>
              </div>
            ) : (
              <p className="muted">You can view this statutory record. Saving requires pupils.statutory.manage.</p>
            )}
            <p className="muted">
              FSM periods:{" "}
              {statutory.statutory.fsmPeriods.length === 0
                ? "none"
                : statutory.statutory.fsmPeriods.map((period) => `${period.startedOn}–${period.endedOn ?? "ongoing"}`).join("; ")}
            </p>
          </SectionCard>
        </form>
      ) : null}

      {activeTab === "pastoral" ? (
        <div className="pupil-tab-panel" id="pastoral">
          {data.behaviourSummary ? (
            <div className="cards">
              <StatCard label="Behaviour incidents" value={data.behaviourSummary.incidentCount} />
              <StatCard label="Open incidents" value={data.behaviourSummary.openIncidents} />
              <StatCard label="Achievements" value={data.behaviourSummary.positiveCount} />
            </div>
          ) : null}
          {behaviour && (behaviour.incidents.length > 0 || behaviour.positives.length > 0) ? (
            <SectionCard title="Behaviour">
              <DataTable
                headers={
                  <>
                    <th>When</th>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Status</th>
                  </>
                }
              >
                {behaviour.incidents.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.occurredAt).toLocaleString()}</td>
                    <td>{row.categoryName}</td>
                    <td>{row.severity}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </DataTable>
            </SectionCard>
          ) : null}
          {data.pastoralSummary ? (
            <SectionCard title="Pastoral">
              <p className="muted">
                Open concerns: {data.pastoralSummary.openCount}
                {data.pastoralSummary.latestPriority ? ` · latest priority ${data.pastoralSummary.latestPriority}` : ""}
              </p>
              {pastoral && pastoral.concerns.length > 0 ? (
                <ul>
                  {pastoral.concerns.map((row) => (
                    <li key={row.id}>
                      {row.concernOn} · {row.categoryName} · {row.priority} · {row.status} — {row.summary}
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionCard>
          ) : null}
          {safeguardingLink ? (
            <p>
              <a href={`/school/safeguarding?studentId=${data.student.id}`}>Open safeguarding records</a>
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={Boolean(invite)}
        title="Parent invitation created"
        description="Copy this invitation now. For security it will not be shown again."
        onClose={() => {
          setInvite(null);
          setCopyState("");
        }}
      >
        {invite ? (
          <div className="invite-token-panel">
            <dl className="profile-list">
              <div>
                <dt>Name</dt>
                <dd>{invite.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{invite.email}</dd>
              </div>
              <div>
                <dt>Relationship</dt>
                <dd>{invite.relationship}</dd>
              </div>
            </dl>
            <p className="muted">Invitation token / link</p>
            <p>
              <a href={`/invite?token=${encodeURIComponent(invite.token)}`}>Open invitation link</a>
            </p>
            <code>{invite.token}</code>
            <Alert tone="warning">Copy this invitation now. For security it will not be shown again.</Alert>
            <div className="dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invite.token);
                    setCopyState("Copied");
                  } catch {
                    setCopyState("Copy failed — select the token manually");
                  }
                }}
              >
                Copy
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setInvite(null);
                  setCopyState("");
                }}
              >
                Done
              </Button>
            </div>
            {copyState ? <p className="muted">{copyState}</p> : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
