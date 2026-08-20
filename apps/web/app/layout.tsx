import type { ReactNode } from "react";

export const metadata = {
  title: "Schoolapp",
  description: "Multi-tenant school platform — Phase 1 foundation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
