/** Obviously labelled local-demo credentials. Never use these in production. */

export type DemoLogin = {
  key: string;
  role: string;
  school: string;
  email?: string;
  username?: string;
  organisationSlug?: string;
  password: string;
  fullName: string;
};

export const DEMO_PASSWORD_PLATFORM = "DemoPass-Platform-1";
export const DEMO_PASSWORD_GREENWOOD_ADMIN = "DemoPass-GreenwoodAdmin-1";
export const DEMO_PASSWORD_HEADTEACHER = "DemoPass-Headteacher-1";
export const DEMO_PASSWORD_TEACHER = "DemoPass-Teacher-1";
export const DEMO_PASSWORD_PARENT = "DemoPass-Parent-1";
export const DEMO_PASSWORD_STUDENT = "DemoPass-Student-1";
export const DEMO_PASSWORD_OAK_ADMIN = "DemoPass-OakAdmin-1";
export const DEMO_PASSWORD_OAK_TEACHER = "DemoPass-OakTeacher-1";
export const DEMO_PASSWORD_OAK_PARENT = "DemoPass-OakParent-1";
export const DEMO_PASSWORD_OAK_STUDENT = "DemoPass-OakStudent-1";

export const DEMO_SLUGS = ["greenwood", "oakacademy"] as const;

export const DEMO_ORGANISATIONS = {
  greenwood: { slug: "greenwood", name: "Greenwood Academy", legalName: "Greenwood Academy Trust" },
  oakacademy: { slug: "oakacademy", name: "Oak Academy", legalName: "Oak Academy Limited" },
} as const;

export const DEMO_ACCOUNTS = {
  platformAdmin: {
    key: "platformAdmin",
    role: "Platform Admin",
    school: "Platform (localhost)",
    email: "demo.platform@schoolapp.test",
    password: DEMO_PASSWORD_PLATFORM,
    fullName: "Demo Platform Admin",
  },
  greenwoodAdmin: {
    key: "greenwoodAdmin",
    role: "Greenwood School Admin",
    school: "Greenwood Academy",
    email: "demo.admin@greenwood.test",
    password: DEMO_PASSWORD_GREENWOOD_ADMIN,
    fullName: "Priya Sharma",
  },
  greenwoodHeadteacher: {
    key: "greenwoodHeadteacher",
    role: "Headteacher",
    school: "Greenwood Academy",
    email: "demo.head@greenwood.test",
    password: DEMO_PASSWORD_HEADTEACHER,
    fullName: "James Whitmore",
  },
  greenwoodTeacher: {
    key: "greenwoodTeacher",
    role: "Teacher",
    school: "Greenwood Academy",
    email: "demo.teacher@greenwood.test",
    password: DEMO_PASSWORD_TEACHER,
    fullName: "Hannah Cole",
  },
  greenwoodParent: {
    key: "greenwoodParent",
    role: "Parent",
    school: "Greenwood Academy",
    email: "demo.parent@greenwood.test",
    password: DEMO_PASSWORD_PARENT,
    fullName: "Aisha Khan",
  },
  greenwoodStudent: {
    key: "greenwoodStudent",
    role: "Student",
    school: "Greenwood Academy",
    username: "amelia.khan",
    organisationSlug: "greenwood",
    password: DEMO_PASSWORD_STUDENT,
    fullName: "Amelia Khan",
  },
  oakAdmin: {
    key: "oakAdmin",
    role: "Oak Academy School Admin",
    school: "Oak Academy",
    email: "demo.admin@oakacademy.test",
    password: DEMO_PASSWORD_OAK_ADMIN,
    fullName: "Rachel Adeyemi",
  },
} as const satisfies Record<string, DemoLogin>;

export const DEMO_EXTRA_ACCOUNTS = {
  oakTeacher: {
    key: "oakTeacher",
    role: "Oak Academy Teacher",
    school: "Oak Academy",
    email: "demo.teacher@oakacademy.test",
    password: DEMO_PASSWORD_OAK_TEACHER,
    fullName: "Mark Hughes",
  },
  oakParent: {
    key: "oakParent",
    role: "Oak Academy Parent",
    school: "Oak Academy",
    email: "demo.parent@oakacademy.test",
    password: DEMO_PASSWORD_OAK_PARENT,
    fullName: "Grace Okonkwo",
  },
  oakStudent: {
    key: "oakStudent",
    role: "Oak Academy Student",
    school: "Oak Academy",
    username: "niamh.okonkwo",
    organisationSlug: "oakacademy",
    password: DEMO_PASSWORD_OAK_STUDENT,
    fullName: "Niamh Okonkwo",
  },
} as const satisfies Record<string, DemoLogin>;

export const ALL_DEMO_LOGINS: DemoLogin[] = [
  ...Object.values(DEMO_ACCOUNTS),
  ...Object.values(DEMO_EXTRA_ACCOUNTS),
];

export const DEMO_USER_EMAILS: string[] = ALL_DEMO_LOGINS.map((account) => account.email).filter(
  (email): email is string => Boolean(email),
);

export const DEMO_EMAIL_DOMAINS = ["greenwood.test", "oakacademy.test", "schoolapp.test"] as const;

export function formatDemoCredentials(): string {
  const rows = ALL_DEMO_LOGINS.map((account) => {
    const login = account.email
      ? `email ${account.email}`
      : `student username ${account.username} (school code ${account.organisationSlug})`;
    return `- ${account.role}: ${login} / password ${account.password}`;
  });
  return [
    "Local demo logins (not for production):",
    ...rows,
    "",
    "Open Greenwood at http://greenwood.localhost:3000/login",
    "Open Oak Academy at http://oakacademy.localhost:3000/login",
    "Open the platform at http://localhost:3000/login",
  ].join("\n");
}
