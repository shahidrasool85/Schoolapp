import type { CSSProperties } from "react";

type IconProps = {
  className?: string;
  title?: string;
};

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function SchoolMarkIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3 10.5 12 5l9 5.5-9 5.5-9-5.5Z" />
      <path d="M7 12.8v4.3c0 .4.7 1.6 5 2.6 4.3-1 5-2.2 5-2.6v-4.3" />
      <path d="M21 10.5v6" />
    </svg>
  );
}

export function PlatformMarkIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M12 3 5 6v6.2c0 4.1 2.8 7.2 7 8.8 4.2-1.6 7-4.7 7-8.8V6l-7-3Z" />
      <path d="m9 12 2.1 2.1L15.5 9.7" />
    </svg>
  );
}

export function StaffIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M8 7V6.2A4 4 0 0 1 16 6.2V7" />
      <path d="M3.5 12h17" />
    </svg>
  );
}

export function ParentIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="9" cy="8" r="2.4" />
      <path d="M4.5 18.5c.4-3 2.4-4.7 4.5-4.7s4.1 1.7 4.5 4.7" />
      <circle cx="16.2" cy="8.6" r="2" />
      <path d="M14.4 18.5c.3-2.2 1.6-3.5 3.3-3.5 1.2 0 2.2.6 2.8 1.7" />
    </svg>
  );
}

export function StudentIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3 10.2 12 6l9 4.2-9 4.2-9-4.2Z" />
      <path d="M7.2 12.4v3.6c0 .8 2.1 2.2 4.8 2.2s4.8-1.4 4.8-2.2v-3.6" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3 4.5 20.5 22" />
      <path d="M9.3 6.3C10.2 6.1 11.1 6 12 6c6.1 0 9.5 6 9.5 6a16 16 0 0 1-3.3 3.9" />
      <path d="M6.6 8.4A16.4 16.4 0 0 0 2.5 12s3.4 6 9.5 6c1.3 0 2.5-.2 3.6-.6" />
      <path d="M10.2 10.4a2.4 2.4 0 0 0 3.4 3.4" />
    </svg>
  );
}

export function brandPanelStyle(options: {
  primaryColor: string;
  heroImageUrl: string | null;
}): CSSProperties {
  const navy = "#122C4A";
  const overlay =
    "linear-gradient(165deg, rgba(18, 44, 74, 0.82), rgba(10, 24, 42, 0.92))";
  if (options.heroImageUrl) {
    return {
      ["--login-brand" as string]: navy,
      ["--login-hero-image" as string]: `url("${options.heroImageUrl}")`,
      backgroundColor: navy,
      backgroundImage: `${overlay}, var(--login-hero-image)`,
    };
  }
  return {
    ["--login-brand" as string]: navy,
    backgroundColor: navy,
  };
}
