export type Canonical = {
  child?: {
    legalName?: string;
    preferredName?: string;
    dateOfBirth?: string;
    gender?: string;
    address?: { line1?: string; line2?: string; town?: string; postcode?: string };
    intendedAcademicYearId?: string;
    intendedYearGroupId?: string;
    proposedStartDate?: string;
    currentSchool?: string;
    previousSchool?: string;
  };
  guardians?: Array<{
    fullName?: string;
    relationship?: string;
    parentalResponsibility?: boolean;
    email?: string;
    phone?: string;
    primaryContact?: boolean;
    address?: { line1?: string; line2?: string; town?: string; postcode?: string };
  }>;
  previousEducation?: {
    schoolName?: string;
    startDate?: string;
    endDate?: string;
    reportDetails?: string;
  };
  emergency?: {
    fullName?: string;
    relationship?: string;
    telephone?: string;
    authorisedCollection?: boolean;
  };
  medical?: {
    allergies?: string;
    conditions?: string;
    medication?: string;
    dietary?: string;
    sendNotes?: string;
  };
  notes?: string;
};

export type ApplicationContact = {
  id: string;
  fullName: string;
  email: string | null;
  telephone: string | null;
  relationship: string;
  isPrimary: boolean;
  hasParentalResponsibility: boolean;
  isEmergency: boolean;
  authorisedCollection: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  addressTown: string | null;
  addressPostcode: string | null;
  userId: string | null;
};

export type ApplicationOffer = {
  id: string;
  status: string;
  offeredAcademicYearId: string | null;
  offeredAcademicYearName: string | null;
  offeredYearGroupId: string | null;
  offeredYearGroupName: string | null;
  intendedStartDate: string | null;
  offerMadeOn: string;
  responseDeadline: string | null;
  notes: string | null;
};

export type ApplicationAssessment = {
  id: string;
  assessmentType: string;
  status: string;
  scheduledAt: string | null;
  notes: string | null;
  outcome: string | null;
  recommendation: string | null;
};

export type ApplicationHistoryRow = {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
};

export type ApplicationDocument = {
  id: string;
  fieldKey: string;
  purpose: string;
  filename: string;
  contentType: string | null;
  byteSize: number | null;
  createdAt: string;
  status: string | null;
  downloadPath: string | null;
};

export type ApplicationDetail = {
  application: {
    id: string;
    reference: string;
    status: string;
    pupilLegalName: string;
    pupilPreferredName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressTown: string | null;
    addressPostcode: string | null;
    intendedAcademicYearId: string | null;
    intendedAcademicYearName: string | null;
    intendedYearGroupId: string | null;
    intendedYearGroupName: string | null;
    intendedEntryDate: string | null;
    previousSchool: string | null;
    currentSchool: string | null;
    internalNotes: string | null;
    convertedStudentProfileId: string | null;
    completenessStatus: string | null;
    source: string | null;
    publicFormName: string | null;
    campaignLabel: string | null;
    submittedAt: string | null;
    extraFields: { canonical?: Canonical } | null;
  };
  formSubmission?: {
    answers: Record<string, unknown>;
    canonicalSnapshot?: Canonical;
    declarationSnapshot?: {
      capturedAt?: string;
      privacyNoticeText?: string | null;
      declarations?: Array<{ fieldKey: string; label: string; accepted: boolean }>;
    } | null;
    sourceCode?: string | null;
    campaignLabel?: string | null;
    formName?: string | null;
    completenessStatus?: string;
    submittedAt?: string | null;
  } | null;
  contacts: ApplicationContact[];
  history: ApplicationHistoryRow[];
  assessments: ApplicationAssessment[];
  offers: ApplicationOffer[];
  documents?: ApplicationDocument[];
};

export type Option = { id: string; name: string };
