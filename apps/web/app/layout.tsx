import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "LuvLearn",
  description: "LuvLearn school management system — staff, parent and student portals",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/branding/luvlearn-icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/branding/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
