import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Schoolapp",
  description: "Multi-tenant school platform — parent and student portals",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
