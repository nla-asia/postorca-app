import { z } from "zod";
/** Brand profile input, validated the same way for the HTTP API and Orca's tools. */
export const brandLinkSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(120),
    url: z.url({ protocol: /^https?$/ }).max(2048),
    kind: z
      .enum([
        "instagram",
        "facebook",
        "threads",
        "x",
        "linkedin",
        "website",
        "other",
      ])
      .optional(),
    publishing_method: z.string().max(5000).optional(),
    publishing_instructions: z.string().max(10000).optional(),
    access_status: z.enum(["not_granted", "granted"]).optional(),
  })
  .strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour.");
/** Brand colours used in videos; each is optional. */
export const brandColorsSchema = z
  .object({ background: color, text: color, highlight: color })
  .partial()
  .strict();
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().max(5000),
  audience: z.string().max(5000),
  topics: z.string().max(5000),
  colors: brandColorsSchema.default({}),
  links: z.array(brandLinkSchema).max(50),
  onboarding_status: z.enum(["not_started", "in_progress", "completed"]),
});
/** A folder on the founder's computer where they build; see brand_projects. */
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    path: z.string().trim().min(1).max(1000),
    description: z.string().trim().max(500).default(""),
  })
  .strict();
export type ProjectInput = z.infer<typeof projectSchema>;
export type BrandLinkInput = z.infer<typeof brandLinkSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
