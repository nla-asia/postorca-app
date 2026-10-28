import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://orca.atpa.site"),
  title: "PostOrca — Your personal brand, with a partner",
  description:
    "Meet Orca, your personal brand agent. Find ideas, draft in your own voice, and build a consistent presence while you keep building your startup.",
  alternates: { canonical: "/" },
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Meet Orca. Your personal brand, with a partner.",
    description:
      "Meet Orca, your personal brand agent. Find ideas, draft in your own voice, and build a consistent presence while you keep building your startup.",
    type: "website",
    url: "https://orca.atpa.site",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
