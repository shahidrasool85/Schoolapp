import {
  STATUTORY_CODE_CATALOGUES,
  STATUTORY_CODE_SET_VERSION,
  type StatutoryCodeCatalogue,
} from "@schoolapp/domain";

export type StatutoryCode = {
  catalogue: StatutoryCodeCatalogue;
  code: string;
  name: string;
  sortOrder: number;
};

export type StatutoryCodeLookup = {
  version: string;
  byCatalogue: Map<StatutoryCodeCatalogue, Map<string, StatutoryCode>>;
};

export const DEFAULT_STATUTORY_CODES: StatutoryCode[] = [
  { catalogue: "sex", code: "M", name: "Male", sortOrder: 1 },
  { catalogue: "sex", code: "F", name: "Female", sortOrder: 2 },
  { catalogue: "enrolment_status", code: "C", name: "Current (single registration)", sortOrder: 1 },
  { catalogue: "enrolment_status", code: "G", name: "Guest pupil", sortOrder: 2 },
  { catalogue: "enrolment_status", code: "M", name: "Main — dual registration", sortOrder: 3 },
  { catalogue: "enrolment_status", code: "S", name: "Subsidiary — dual registration", sortOrder: 4 },
  { catalogue: "enrolment_status", code: "F", name: "FE college", sortOrder: 5 },
  { catalogue: "send_provision", code: "N", name: "No special educational need", sortOrder: 1 },
  { catalogue: "send_provision", code: "K", name: "SEN support", sortOrder: 2 },
  { catalogue: "send_provision", code: "E", name: "Education, health and care plan", sortOrder: 3 },
  { catalogue: "looked_after", code: "none", name: "Not looked after", sortOrder: 1 },
  { catalogue: "looked_after", code: "looked_after", name: "Looked after / child in care", sortOrder: 2 },
  {
    catalogue: "looked_after",
    code: "previously_looked_after",
    name: "Previously looked after",
    sortOrder: 3,
  },
  { catalogue: "school_phase", code: "PS", name: "Primary", sortOrder: 1 },
  { catalogue: "school_phase", code: "MP", name: "Middle deemed primary", sortOrder: 2 },
  { catalogue: "school_phase", code: "MS", name: "Middle deemed secondary", sortOrder: 3 },
  { catalogue: "school_phase", code: "SS", name: "Secondary", sortOrder: 4 },
  { catalogue: "school_phase", code: "AT", name: "All-through", sortOrder: 5 },
  { catalogue: "establishment_type", code: "01", name: "Community school", sortOrder: 1 },
  { catalogue: "establishment_type", code: "02", name: "Voluntary aided school", sortOrder: 2 },
  { catalogue: "establishment_type", code: "03", name: "Voluntary controlled school", sortOrder: 3 },
  { catalogue: "establishment_type", code: "06", name: "Foundation school", sortOrder: 4 },
  { catalogue: "establishment_type", code: "11", name: "Other independent school", sortOrder: 5 },
  { catalogue: "establishment_status", code: "1", name: "Open", sortOrder: 1 },
  { catalogue: "establishment_status", code: "2", name: "Closed", sortOrder: 2 },
  { catalogue: "establishment_status", code: "3", name: "Open, but proposed to close", sortOrder: 3 },
  { catalogue: "establishment_status", code: "4", name: "Proposed to open", sortOrder: 4 },
  { catalogue: "leaving_reason", code: "SC", name: "Transfer to another school", sortOrder: 1 },
  { catalogue: "leaving_reason", code: "FE", name: "Further education / other provider", sortOrder: 2 },
  { catalogue: "leaving_reason", code: "HE", name: "Elective home education", sortOrder: 3 },
  { catalogue: "leaving_reason", code: "EM", name: "Emigrated", sortOrder: 4 },
  { catalogue: "leaving_reason", code: "DE", name: "Deceased", sortOrder: 5 },
  { catalogue: "leaving_reason", code: "PE", name: "Permanent exclusion (placeholder)", sortOrder: 6 },
  { catalogue: "leaving_reason", code: "OT", name: "Other", sortOrder: 7 },
  { catalogue: "ethnicity", code: "WBRI", name: "White — British", sortOrder: 1 },
  { catalogue: "ethnicity", code: "WIRI", name: "White — Irish", sortOrder: 2 },
  { catalogue: "ethnicity", code: "WIRT", name: "White — Irish Traveller", sortOrder: 3 },
  { catalogue: "ethnicity", code: "WOTH", name: "White — any other White background", sortOrder: 4 },
  { catalogue: "ethnicity", code: "MWBC", name: "Mixed — White and Black Caribbean", sortOrder: 5 },
  { catalogue: "ethnicity", code: "MWBA", name: "Mixed — White and Black African", sortOrder: 6 },
  { catalogue: "ethnicity", code: "MWAS", name: "Mixed — White and Asian", sortOrder: 7 },
  { catalogue: "ethnicity", code: "MOTH", name: "Mixed — any other Mixed background", sortOrder: 8 },
  { catalogue: "ethnicity", code: "AIND", name: "Asian — Indian", sortOrder: 9 },
  { catalogue: "ethnicity", code: "APKN", name: "Asian — Pakistani", sortOrder: 10 },
  { catalogue: "ethnicity", code: "ABAN", name: "Asian — Bangladeshi", sortOrder: 11 },
  { catalogue: "ethnicity", code: "AOTH", name: "Asian — any other Asian background", sortOrder: 12 },
  { catalogue: "ethnicity", code: "BCRB", name: "Black — Caribbean", sortOrder: 13 },
  { catalogue: "ethnicity", code: "BAFR", name: "Black — African", sortOrder: 14 },
  { catalogue: "ethnicity", code: "BOTH", name: "Black — any other Black background", sortOrder: 15 },
  { catalogue: "ethnicity", code: "CHNE", name: "Chinese", sortOrder: 16 },
  { catalogue: "ethnicity", code: "OOTH", name: "Any other ethnic group", sortOrder: 17 },
  { catalogue: "ethnicity", code: "REFU", name: "Refused", sortOrder: 18 },
  { catalogue: "ethnicity", code: "NOBT", name: "Information not yet obtained", sortOrder: 19 },
  { catalogue: "language", code: "ENG", name: "English", sortOrder: 1 },
  { catalogue: "language", code: "ENB", name: "Believed to be English", sortOrder: 2 },
  { catalogue: "language", code: "OTB", name: "Believed to be other than English", sortOrder: 3 },
  { catalogue: "language", code: "URD", name: "Urdu", sortOrder: 4 },
  { catalogue: "language", code: "PAN", name: "Panjabi", sortOrder: 5 },
  { catalogue: "language", code: "ARA", name: "Arabic", sortOrder: 6 },
  { catalogue: "language", code: "SOM", name: "Somali", sortOrder: 7 },
  { catalogue: "language", code: "BEN", name: "Bengali", sortOrder: 8 },
  { catalogue: "language", code: "POL", name: "Polish", sortOrder: 9 },
  { catalogue: "language", code: "POR", name: "Portuguese", sortOrder: 10 },
  { catalogue: "language", code: "YOR", name: "Yoruba", sortOrder: 11 },
  { catalogue: "language", code: "TAM", name: "Tamil", sortOrder: 12 },
  { catalogue: "language", code: "GUJ", name: "Gujarati", sortOrder: 13 },
  { catalogue: "language", code: "ZHO", name: "Chinese", sortOrder: 14 },
  { catalogue: "language", code: "FRA", name: "French", sortOrder: 15 },
  { catalogue: "language", code: "SPA", name: "Spanish", sortOrder: 16 },
  { catalogue: "language", code: "NOT", name: "Information not obtained", sortOrder: 17 },
  { catalogue: "language", code: "REF", name: "Refused", sortOrder: 18 },
];

export function buildStatutoryCodeLookup(
  codes: readonly StatutoryCode[],
  version = STATUTORY_CODE_SET_VERSION,
): StatutoryCodeLookup {
  const byCatalogue = new Map<StatutoryCodeCatalogue, Map<string, StatutoryCode>>();
  for (const catalogue of STATUTORY_CODE_CATALOGUES) {
    byCatalogue.set(catalogue, new Map());
  }
  for (const code of codes) {
    byCatalogue.get(code.catalogue)?.set(code.code, code);
  }
  return { version, byCatalogue };
}

export const defaultStatutoryCodeLookup = buildStatutoryCodeLookup(DEFAULT_STATUTORY_CODES);

export function isStatutoryCode(
  lookup: StatutoryCodeLookup,
  catalogue: StatutoryCodeCatalogue,
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return lookup.byCatalogue.get(catalogue)?.has(code) === true;
}

export function statutoryCodeName(
  lookup: StatutoryCodeLookup,
  catalogue: StatutoryCodeCatalogue,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return lookup.byCatalogue.get(catalogue)?.get(code)?.name ?? null;
}
