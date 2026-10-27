import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextStore {
  googleAccessToken: string;
}

export const providerRequestContext = new AsyncLocalStorage<RequestContextStore>();

export function getGoogleAccessToken(): string {
  const token = providerRequestContext.getStore()?.googleAccessToken;
  if (!token) {
    throw new Error("Google access token was not supplied by the PostOrca backend");
  }
  return token;
}
