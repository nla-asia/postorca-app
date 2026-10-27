export interface EmailInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export function composeEmail(input: EmailInput): string {
  for (const value of [input.to, input.subject, input.cc, input.bcc]) {
    if (value && /[\r\n]/.test(value)) {
      throw new Error("Email headers cannot contain newlines.");
    }
  }

  const headers = [
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];

  const encodedBody = Buffer.from(input.body).toString("base64");
  const formattedBody = encodedBody.match(/.{1,76}/g)?.join("\r\n") ?? "";

  const rfc2822Message = `${headers.join("\r\n")}\r\n\r\n${formattedBody}`;
  return Buffer.from(rfc2822Message).toString("base64url");
}
