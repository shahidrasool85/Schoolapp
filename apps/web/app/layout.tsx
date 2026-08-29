import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "LuvLearn",
  description: "LuvLearn school management system — staff, parent and student portals",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
