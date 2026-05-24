import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

type CryptoLike = {
  getRandomValues?:
    | ((array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>)
    | undefined;
  randomUUID?: (() => string) | undefined;
};

let warnedMissingWebCrypto = false;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function uuidFromBytes(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function warnMissingWebCryptoOnce() {
  if (warnedMissingWebCrypto) {
    return;
  }
  warnedMissingWebCrypto = true;
  console.warn("[client-id] Web Crypto is unavailable");
}

export function createClientId(
  prefix = "id",
  cryptoApi: CryptoLike | null = globalThis.crypto,
) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `${prefix}-${uuidFromBytes(bytes)}`;
  }

  warnMissingWebCryptoOnce();
  throw new Error("Web Crypto is required for client ID generation");
}
