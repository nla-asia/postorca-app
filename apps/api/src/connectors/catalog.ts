export const connectors = {
  gmail: {
    name: "Gmail",
    description: "Read and send email",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  google_drive: {
    name: "Google Drive",
    description: "Find, read, and save files",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
} as const;

export type Connector = keyof typeof connectors;

export function googleConfig() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    CONNECTOR_ENCRYPTION_KEY,
  } = process.env;
  const key = Buffer.from(CONNECTOR_ENCRYPTION_KEY ?? "", "base64");
  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    key.length !== 32
  )
    return null;
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
    key,
  };
}
