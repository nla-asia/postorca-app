export type MediaAttachment = {
  file: string;
  mime_type: string;
  title: string;
  filename?: string;
  bytes?: number;
};
/** Media artifacts contain server-validated file metadata, never arbitrary remote URLs. */
export function artifactMedia(artifact: {
  kind: string;
  title: string;
  content: string;
}): MediaAttachment | null {
  if (!["image", "audio", "video"].includes(artifact.kind)) return null;
  try {
    const value = JSON.parse(artifact.content);
    if (
      typeof value.mime_type !== "string" ||
      !value.mime_type.startsWith(`${artifact.kind}/`)
    )
      return null;
    return (
      messageMedia({
        kind: "tool_result",
        content: {
          result: {
            attachments: [
              {
                ...value,
                kind: "download",
                title: artifact.title,
              },
            ],
          },
        },
      })[0] ?? null
    );
  } catch {
    return null;
  }
}
/** Only structured tool attachments may render media; agent-written URLs cannot. */
export function messageMedia(message: {
  kind: string;
  content: { result?: unknown };
}): MediaAttachment[] {
  if (message.kind !== "tool_result") return [];
  const result = message.content.result as
    { attachments?: unknown } | undefined;
  if (!Array.isArray(result?.attachments)) return [];
  return result.attachments.flatMap((item) => {
    if (
      !item ||
      typeof item.file !== "string" ||
      typeof item.mime_type !== "string" ||
      !/^users\/[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}\.(png|jpg|mp3|mp4|bin)$/.test(
        item.file,
      ) ||
      (!(
        item.kind === "download" &&
        item.file.includes("/downloads/") &&
        item.file.endsWith(".bin")
      ) &&
        !["image/png", "image/jpeg", "audio/mpeg", "video/mp4"].includes(
          item.mime_type,
        ))
    )
      return [];
    return [
      {
        file: item.file,
        mime_type: item.mime_type,
        title: typeof item.title === "string" ? item.title : "Attachment",
        filename: typeof item.filename === "string" ? item.filename : undefined,
        bytes: typeof item.bytes === "number" ? item.bytes : undefined,
      },
    ];
  });
}
