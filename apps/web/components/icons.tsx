import type { CSSProperties, ReactNode, SVGProps } from "react";

type IconProps = {
  className?: string;
  title?: string;
};

const svgProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} {...svgProps}>
      {children}
    </svg>
  );
}

export function SchoolMarkIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 10.5 12 5l9 5.5-9 5.5-9-5.5Z" />
      <path d="M7 12.8v4.3c0 .4.7 1.6 5 2.6 4.3-1 5-2.2 5-2.6v-4.3" />
      <path d="M21 10.5v6" />
    </Svg>
  );
}

export function IconHome({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
    </Svg>
  );
}

export function IconClipboard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5h6v2.2H9z" />
      <path d="M9 11h6M9 14.5h4" />
    </Svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8" r="2.3" />
      <path d="M4.6 18.5c.4-3 2.3-4.6 4.4-4.6s4 1.6 4.4 4.6" />
      <circle cx="16.2" cy="8.7" r="1.9" />
      <path d="M14.6 18.5c.25-2.1 1.5-3.4 3.1-3.4 1.15 0 2.1.55 2.7 1.6" />
    </Svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8 12.2 2.4 2.4 5.4-5.6" />
    </Svg>
  );
}

export function IconCalendar({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M8 3.8v3.2M16 3.8v3.2M4 10h16" />
    </Svg>
  );
}

export function IconBook({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 5.5h6.5A3.5 3.5 0 0 1 15 9v10.5H8.2A3.2 3.2 0 0 0 5 16.3V5.5Z" />
      <path d="M15 9h4v10.5h-6.8" />
    </Svg>
  );
}

export function IconChart({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 19h16" />
      <path d="M7 16v-4.5M12 16V8M17 16v-7" />
    </Svg>
  );
}

export function IconHeart({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 19s-7-4.4-7-9.1A3.7 3.7 0 0 1 12 7.2 3.7 3.7 0 0 1 19 9.9C19 14.6 12 19 12 19Z" />
    </Svg>
  );
}

export function IconShield({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 5 6v6.2c0 4.1 2.8 7.2 7 8.8 4.2-1.6 7-4.7 7-8.8V6l-7-3Z" />
    </Svg>
  );
}

export function IconMegaphone({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 11.5v2.2l3 .8 6.5 3.8V6.9L7 10.7l-3 .8Z" />
      <path d="M13.5 8.2c1.6.7 2.6 1.9 2.6 3.8s-1 3.1-2.6 3.8" />
      <path d="M7.2 14.8 8 19h2.2l.6-3.2" />
    </Svg>
  );
}

export function IconMail({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="m4 8 8 5.2L20 8" />
    </Svg>
  );
}

export function IconFlag({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 4.5v16" />
      <path d="M6 5.2h9.5l-1.6 3.3 1.6 3.3H6" />
    </Svg>
  );
}

export function IconCard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17" />
    </Svg>
  );
}

export function IconBriefcase({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="8" width="17" height="11.5" rx="2" />
      <path d="M9 8V6.6A2.4 2.4 0 0 1 11.4 4.2h1.2A2.4 2.4 0 0 1 15 6.6V8" />
    </Svg>
  );
}

export function IconLayers({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m4 9 8-4.5L20 9l-8 4.5L4 9Z" />
      <path d="m4 13.2 8 4.5 8-4.5" />
    </Svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.5 16.5h11l-.8-1.4a6.4 6.4 0 0 1-.7-3V10a4 4 0 0 0-8 0v2.1c0 1.05-.24 2.08-.7 3l-.8 1.4Z" />
      <path d="M10 16.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </Svg>
  );
}

export function IconInbox({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 13.5 6.4 5.8A2 2 0 0 1 8.3 4.5h7.4a2 2 0 0 1 1.9 1.3L20 13.5v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-5Z" />
      <path d="M4 13.5h4.2l1.3 2.2h5l1.3-2.2H20" />
    </Svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="5.5" />
      <path d="m15.2 15.2 4.3 4.3" />
    </Svg>
  );
}

export function IconEmpty({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4.5" y="6" width="15" height="12.5" rx="2" />
      <path d="M8 10h8M8 13.5h5" />
    </Svg>
  );
}

export const NAV_ICONS = {
  home: IconHome,
  clipboard: IconClipboard,
  users: IconUsers,
  check: IconCheck,
  calendar: IconCalendar,
  book: IconBook,
  chart: IconChart,
  heart: IconHeart,
  shield: IconShield,
  megaphone: IconMegaphone,
  mail: IconMail,
  flag: IconFlag,
  card: IconCard,
  briefcase: IconBriefcase,
  layers: IconLayers,
  bell: IconBell,
  inbox: IconInbox,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

export function NavIcon({ name, className }: { name?: NavIconName; className?: string }) {
  if (!name) return null;
  const Icon = NAV_ICONS[name];
  return <Icon className={className} />;
}

export function brandColorStyle(color?: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return { ["--brand" as string]: color, ["--sidebar" as string]: color, ["--navy" as string]: color };
}
