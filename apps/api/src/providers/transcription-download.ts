import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { HttpError } from "../handlers/errors.js";
import { MAX_AUDIO_BYTES } from "./transcription-audio.js";

/** Meta has no source_url field. Fetch only public HTTPS audio, pinning checked
 * DNS addresses to the socket and checking each redirect before following it. */
export async function downloadTranscriptionAudio(
  source: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Blob> {
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    redirects > 5
  )
    throw new HttpError(
      400,
      "Use a public HTTPS audio URL without credentials or excessive redirects.",
    );
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await dns.lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => ipaddr.process(address).range() !== "unicast",
    )
  )
    throw new HttpError(
      400,
      "The audio URL must resolve to a public internet address.",
    );
  const address = addresses[0];
  return new Promise<Blob>((resolve, reject) => {
    const request = https.get(
      url,
      {
        signal,
        family: address.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.destroy();
          if (!response.headers.location)
            return reject(
              new HttpError(400, "Audio redirect has no destination."),
            );
          downloadTranscriptionAudio(
            new URL(response.headers.location, url).href,
            signal,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            new HttpError(
              400,
              `Audio download failed (HTTP ${response.statusCode}). Supply a public audio URL or a saved audio file.`,
            ),
          );
          return;
        }
        if (Number(response.headers["content-length"]) > MAX_AUDIO_BYTES) {
          response.destroy();
          reject(new HttpError(400, "Audio download exceeds 32 MB."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_AUDIO_BYTES) {
            response.destroy();
            reject(new HttpError(400, "Audio download exceeds 32 MB."));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("aborted", () =>
          reject(new Error("Audio download interrupted.")),
        );
        response.on("end", () =>
          resolve(new Blob(chunks.map((chunk) => new Uint8Array(chunk)))),
        );
      },
    );
    request.on("error", reject);
  });
}
