import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://orca.atpa.site"),
  title: "PostOrca — From your code to launch videos",
  description:
    "Orca reads your project, writes the script for a launch video, a feature announcement or a how-to, and once you approve it, records your real app and edits the video.",
  alternates: { canonical: "/" },
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Meet Orca. You ship it. Orca shows it.",
    description:
      "Orca reads your project, writes the script for a launch video, a feature announcement or a how-to, and once you approve it, records your real app and edits the video.",
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
