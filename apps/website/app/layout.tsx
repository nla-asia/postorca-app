import type { Metadata } from "next";
import Script from "next/script";
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
      <body>
        {/* Static hosting falls back to this document for bare /privacy. */}
        <Script id="static-privacy-route" strategy="beforeInteractive">
          {`if (window.location.pathname === "/privacy") {
  window.location.replace("/privacy/" + window.location.search + window.location.hash);
}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
