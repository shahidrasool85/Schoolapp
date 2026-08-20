import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Schoolapp",
  description: "Multi-tenant school platform — people and school structure",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
