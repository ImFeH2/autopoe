import { dispatchAccessDeniedEvent } from "@/lib/accessEvents";

interface ApiRequestOptions<TResponse, TResult> extends Omit<
  RequestInit,
  "body"
> {
  body?: unknown;
  errorMessage: string;
  fallback?: TResult;
  map?: (data: TResponse | null) => TResult;
  swallowHttpError?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(data: unknown): string | null {
  if (!isPlainObject(data)) return null;

  for (const key of ["error", "message", "detail"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (isPlainObject(value) && Array.isArray(value.errors)) {
      const messages = value.errors
        .map((item) =>
          isPlainObject(item) && typeof item.message === "string"
            ? item.message.trim()
            : "",
        )
        .filter(Boolean);
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }
  }

  return null;
}

async function parseJson<TResponse>(
  response: Response,
): Promise<TResponse | null> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as TResponse;
  } catch {
    throw new Error("Invalid JSON response");
  }
}

function buildHeaders(
  body: unknown,
  headers?: HeadersInit,
): HeadersInit | undefined {
  if (body === undefined || body instanceof FormData) return headers;

  const next = new Headers(headers);
  if (!next.has("Content-Type")) {
    next.set("Content-Type", "application/json");
  }
  return next;
}

export async function requestJson<TResponse, TResult = TResponse>(
  url: string,
  options: ApiRequestOptions<TResponse, TResult>,
): Promise<TResult> {
  const {
    body,
    errorMessage,
    fallback,
    headers,
    map,
    swallowHttpError = false,
    ...init
  } = options;

  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(body, headers),
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });

  const data = await parseJson<TResponse>(response);

  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/api/access/")) {
      dispatchAccessDeniedEvent();
    }
    if (swallowHttpError && fallback !== undefined) {
      return fallback;
    }

    const detail = extractErrorMessage(data);
    throw new Error(detail ? `${errorMessage}: ${detail}` : errorMessage);
  }

  const hasMap = typeof map === "function";
  const result = hasMap
    ? map(data)
    : ((data ?? fallback) as TResult | undefined);

  if (hasMap || result !== undefined) {
    return result as TResult;
  }

  throw new Error(errorMessage);
}

export async function requestVoid(
  url: string,
  options: Omit<ApiRequestOptions<unknown, void>, "fallback" | "map">,
): Promise<void> {
  await requestJson<unknown, void>(url, {
    ...options,
    map: () => undefined,
  });
}
