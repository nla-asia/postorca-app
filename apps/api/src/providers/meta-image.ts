import OpenAI from "openai";
import { usageFetch } from "../api-usage/ledger.js";
import { META_BASE_URL } from "./meta.js";
import { imagesFromEnv } from "../config.js";
import {
  OpenAIImageProvider,
  decodeImageResponse,
  imageOptionsSchema,
  imageUpload,
  type ImageOptions,
  type RequestOptions,
} from "./openai-image.js";

export const META_IMAGE_MODEL = "muse-image-1.0";

/** Muse Image through Meta Model API's Images endpoints. Size sets only the aspect
 * ratio, there are no masks, and quality has no direct equivalent: low quality makes
 * a single fast pass instead of several refining ones. */
export class MetaImageProvider {
  readonly supportsMask = false;
  #client: OpenAI;
  constructor(
    key: string,
    private model: string = META_IMAGE_MODEL,
  ) {
    if (!key.trim()) throw new Error("META_MODEL_API_KEY is required.");
    this.#client = new OpenAI({
      apiKey: key.trim(),
      baseURL: META_BASE_URL,
      fetch: usageFetch,
      maxRetries: 0,
      timeout: 300_000,
    });
  }

  async generateImage(input: ImageOptions, options: RequestOptions = {}) {
    const { quality, ...args } = imageOptionsSchema.strict().parse(input);
    const request = {
      ...args,
      model: this.model,
      n: 1,
      size: args.size ?? "1024x1024",
      output_format: "png" as const,
      reasoning_strength: quality === "low" ? "low" : "high",
      user: options.safetyIdentifier,
    };
    return decodeImageResponse(
      await this.#client.images.generate(request, { signal: options.signal }),
      "Meta",
    );
  }

  async editImage(
    input: ImageOptions & { image: Blob; mask?: Blob },
    options: RequestOptions = {},
  ) {
    const { image, mask, ...inputOptions } = input;
    if (mask !== undefined)
      throw new Error("Muse Image edits from the prompt alone; it takes no mask.");
    const { quality, ...args } = imageOptionsSchema
      .strict()
      .parse(inputOptions);
    const request = {
      ...args,
      model: this.model,
      n: 1,
      image: await imageUpload(image),
      output_format: "png" as const,
      reasoning_strength: quality === "low" ? "low" : "high",
    };
    return decodeImageResponse(
      await this.#client.images.edit(request, { signal: options.signal }),
      "Meta",
    );
  }
}

/** The image provider chosen with IMAGE_PROVIDER and IMAGE_MODEL, or null when image
 * generation is off. Read on each call so a changed environment takes effect. */
export function createImageProviderFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const images = imagesFromEnv(env);
  if (!images) return null;
  return images.provider === "meta"
    ? new MetaImageProvider(images.apiKey, images.model)
    : new OpenAIImageProvider(images.apiKey, images.model);
}
