export const LINK_KINDS = [
  "instagram",
  "facebook",
  "threads",
  "x",
  "linkedin",
  "website",
  "other",
] as const;
export type BrandLink = {
  id?: string;
  name: string;
  url: string;
  kind: (typeof LINK_KINDS)[number];
  publishing_method: string;
  publishing_instructions: string;
  access_status: "not_granted" | "granted";
};
/** A folder on the founder's computer where they build, read by Orca's file tools. */
export type BrandProject = {
  id: string;
  name: string;
  /** Local to the founder's computer; only the desktop app opens it. */
  path: string;
  description: string;
};
export type Brand = {
  name: string;
  company: string;
  audience: string;
  voice: string;
  topics: string;
  /** Brand colours used in videos, as #RRGGBB. */
  colors: { background?: string; text?: string; highlight?: string };
  links: BrandLink[];
  projects: BrandProject[];
  onboarding_status: "not_started" | "in_progress" | "completed";
};
