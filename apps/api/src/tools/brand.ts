import { z } from "zod";
import {
  deleteBrandLink,
  getProfile,
  saveBrandLink,
  saveProfile,
} from "../repositories/brand.js";
import { brandLinkSchema, profileSchema } from "../schemas/brand.js";
import { object, type Tool } from "./shared.js";

export const brandTools: Tool[] = [
  {
    definition: {
      name: "read_brand_profile",
      description: "Read the founder’s saved brand profile.",
      parameters: object({}, []),
    },
    run: ({ db, userId }) => getProfile(db, userId),
  },
  {
    definition: {
      name: "update_brand_profile",
      description:
        "Save founder details on the server. Supply only changed fields. This tool does not change links; use save_brand_link or delete_brand_link for individual account and website links. Set onboarding_status=completed only after the founder confirms their company, primary topics, and actual account/site links.",
      parameters: object(
        {
          name: { type: "string" },
          company: {
            type: "string",
            description:
              "What the founder is building: their company, product, or business description. A company name is not required.",
          },
          audience: { type: "string" },
          voice: { type: "string" },
          topics: {
            type: "string",
            description: "The founder's primary content topics.",
          },
          colors: {
            type: "object",
            description:
              "Brand colours used in the founder's videos, as #RRGGBB. Replaces all saved colours, so include every colour to keep. background and text style text cards; highlight marks the spoken word and accents.",
            properties: {
              background: { type: "string" },
              text: { type: "string" },
              highlight: { type: "string" },
            },
            additionalProperties: false,
          },
          onboarding_status: {
            type: "string",
            enum: ["in_progress", "completed"],
          },
        },
        [],
      ),
    },
    run: async ({ db, userId }, args) => {
      const changes = profileSchema
        .omit({ links: true })
        .partial()
        .strict()
        .parse(args);
      const { profile, createdRoutines } = await saveProfile(
        db,
        userId,
        profileSchema.parse({ ...(await getProfile(db, userId)), ...changes }),
        { saveLinks: false },
      );
      return createdRoutines.length
        ? { ...profile, default_routines_created: createdRoutines }
        : profile;
    },
  },
  {
    definition: {
      name: "save_brand_link",
      description:
        "Save one actual social account or website link on the server. Omit id to create; include its existing id to update. Supply name and the exact HTTP(S) URL established with the founder. kind is a defined value for routing. publishing_method and publishing_instructions are free text describing the workflow agreed with the founder, including for blogs and websites. During onboarding, record publishing intent without checking tool availability or requesting login/access verification; unavailable tools and not_granted access do not block saving intent. Only save access_status=granted after the founder explicitly confirms access or an actual tool verifies it; adding a URL or choosing a workflow does not grant access. New links default to not_granted. Changing the URL resets access to not_granted. Omitted publishing fields are preserved on updates. Returns the saved link with its id and details. Other links are unchanged. Read the profile to find IDs; never invent an ID or URL. Do not store credentials in these text fields.",
      parameters: object(
        {
          id: { type: "string" },
          name: { type: "string" },
          url: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "instagram",
              "facebook",
              "threads",
              "x",
              "linkedin",
              "website",
              "other",
            ],
          },
          publishing_method: {
            type: "string",
            description:
              "Free-text description, e.g. WordPress API or browser using the site's editor.",
          },
          publishing_instructions: {
            type: "string",
            description:
              "Account/site-specific publishing steps agreed with the founder.",
          },
          access_status: { type: "string", enum: ["not_granted", "granted"] },
        },
        ["name", "url"],
      ),
    },
    run: ({ db, userId }, args) =>
      saveBrandLink(db, userId, brandLinkSchema.parse(args)),
  },
  {
    definition: {
      name: "delete_brand_link",
      description:
        "Delete one saved account or website link by its existing id when the founder asks to remove it. Other links are unchanged. Read the profile to find the ID. Removing the last link reopens onboarding because setup requires at least one link.",
      parameters: object({ id: { type: "string" } }, ["id"]),
    },
    run: ({ db, userId }, args) =>
      deleteBrandLink(
        db,
        userId,
        z.object({ id: z.uuid() }).strict().parse(args).id,
      ),
  },
];
