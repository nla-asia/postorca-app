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
      <head>
        {/* Run before the Next runtime: the static host falls back to this document. */}
        <script
          id="static-privacy-route"
          dangerouslySetInnerHTML={{
            __html: `if (window.location.pathname === "/privacy") {
  window.location.replace("/privacy/" + window.location.search + window.location.hash);
}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
