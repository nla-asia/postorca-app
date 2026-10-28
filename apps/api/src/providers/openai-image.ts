import { usageFetch } from "../api-usage/ledger.js";
import OpenAI, { toFile } from "openai";
import { z } from "zod";

export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";
export const imageOptionsSchema = z.object({
  prompt: z.string().trim().min(1).max(32000),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
});
export type ImageOptions = z.input<typeof imageOptionsSchema>;
export type RequestOptions = { signal?: AbortSignal; safetyIdentifier?: string };

/** Validates a source image or mask and wraps it for a multipart upload. */
export async function imageUpload(blob: Blob, masked = false) {
  if (
    !(blob instanceof Blob) ||
    blob.size === 0 ||
    blob.size > 50 * 1024 * 1024 ||
    !["image/png", "image/jpeg"].includes(blob.type) ||
    (masked && blob.type !== "image/png")
  )
    throw new Error("Use a nonempty PNG/JPEG under 50 MB; masks must be PNG.");
  return toFile(blob, blob.type === "image/png" ? "image.png" : "image.jpg");
}

/** Reads the single base64 PNG of an Images API response. */
export function decodeImageResponse(
  response: OpenAI.Images.ImagesResponse & { _request_id?: string | null },
  provider: string,
) {
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error(`${provider} returned no valid image.`);
  const data = Buffer.from(encoded, "base64");
  if (
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error(`${provider} returned an invalid PNG.`);
  return {
    data,
    mimeType: "image/png" as const,
    requestId: response._request_id ?? null,
    usage: response.usage ?? null,
  };
}

/** Media credentials are independent of the conversational model's credentials. */
export class OpenAIImageProvider {
  readonly supportsMask = true;
  #client: OpenAI;
  constructor(
    key: string,
    private model: string = DEFAULT_IMAGE_MODEL,
  ) {
    if (!key.trim()) throw new Error("OPENAI_IMAGE_API_KEY is required.");
    this.#client = new OpenAI({
      apiKey: key.trim(),
      fetch: usageFetch,
      maxRetries: 0,
      timeout: 300_000,
    });
  }

  async generateImage(input: ImageOptions, options: RequestOptions = {}) {
    const args = imageOptionsSchema.strict().parse(input);
    const response = await this.#client.images.generate(
      {
        ...args,
        model: this.model,
        n: 1,
        size: args.size ?? "1024x1024",
        quality: args.quality ?? "medium",
        output_format: "png",
        safety_identifier: options.safetyIdentifier,
      },
      { signal: options.signal },
    );
    return decodeImageResponse(response, "OpenAI");
  }

  async editImage(
    input: ImageOptions & { image: Blob; mask?: Blob },
    options: RequestOptions = {},
  ) {
    const { image, mask, ...inputOptions } = input;
    const args = imageOptionsSchema.strict().parse(inputOptions);
    const imageFile = await imageUpload(image);
    const maskFile =
      mask === undefined ? undefined : await imageUpload(mask, true);
    return decodeImageResponse(
      await this.#client.images.edit(
        {
          ...args,
          model: this.model,
          n: 1,
          image: imageFile,
          mask: maskFile,
          quality: args.quality ?? "medium",
          output_format: "png",
          safety_identifier: options.safetyIdentifier,
        },
        { signal: options.signal },
      ),
      "OpenAI",
    );
  }
}

