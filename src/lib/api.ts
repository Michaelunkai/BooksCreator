import type { Settings, Workspace } from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const BROWSER_WORKSPACE_KEY = "folio.browser-workspace.v1";
export const BROWSER_SETTINGS_KEY = "folio.browser-settings.v1";

const CANNOT_REACH_SERVER =
  "Cannot reach the writing studio server. Your unsaved work is kept in this browser; reconnect and retry.";

const DEFAULT_SETTINGS: Settings = {
  configured: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  textModel: "gpt-6-astra",
  imageModel: "gpt-image-2",
};

type WorkspaceResponse = {
  workspace: Workspace | null;
  revision: number;
};

type StoredSettings = Pick<
  Settings,
  "provider" | "baseUrl" | "textModel" | "imageModel"
>;

type FallbackOperation =
  | "workspace-read"
  | "workspace-write"
  | "settings-read"
  | "settings-write"
  | "image-write";

// A private in-memory copy keeps the static build usable in browsers that
// expose localStorage but reject it (for example, a blocked private context).
// It is only a session fallback; localStorage remains the durable browser copy
// whenever the browser permits it.
const volatileStorage = new Map<string, string>();

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readBrowserValue(key: string): string | null {
  const volatile = volatileStorage.get(key);
  if (volatile !== undefined) return volatile;
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeBrowserValue(key: string, value: string): void {
  try {
    const storage = browserStorage();
    if (storage) {
      storage.setItem(key, value);
      volatileStorage.delete(key);
      return;
    }
  } catch {
    // Fall through to the session-only copy below.
  }
  volatileStorage.set(key, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseStoredJson(raw: string, message: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(message, 503);
  }
}

function parseWorkspaceResponse(): WorkspaceResponse {
  const raw = readBrowserValue(BROWSER_WORKSPACE_KEY);
  if (!raw) return { workspace: null, revision: 0 };
  const value = parseStoredJson(
    raw,
    "The browser library copy is damaged. Export or restore a known backup before saving again.",
  );
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !(value.workspace === null || isRecord(value.workspace))
  )
    throw new ApiError(
      "The browser library copy is damaged. Export or restore a known backup before saving again.",
      503,
    );
  return {
    workspace: value.workspace as Workspace | null,
    revision: value.revision as number,
  };
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string")
    throw new ApiError(
      "The local writing studio request could not be read. Your existing work has not changed.",
      400,
    );
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError("The request contains invalid JSON.", 400);
  }
}

function saveWorkspaceFallback(init: RequestInit): { revision: number } {
  const input = parseRequestBody(init.body);
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["workspace", "revision"]) ||
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    !isRecord(input.workspace)
  )
    throw new ApiError(
      "The local writing studio workspace request is invalid. Your existing work has not changed.",
      400,
    );
  const current = parseWorkspaceResponse();
  if (input.revision !== current.revision)
    throw new ApiError(
      "This workspace changed in another window. Reload the saved workspace before saving again.",
      409,
    );
  const nextRevision = current.revision + 1;
  if (!Number.isSafeInteger(nextRevision))
    throw new ApiError(
      "The browser library revision is exhausted. Export a backup before continuing.",
      409,
    );
  writeBrowserValue(
    BROWSER_WORKSPACE_KEY,
    JSON.stringify({
      workspace: input.workspace as unknown as Workspace,
      revision: nextRevision,
    } satisfies WorkspaceResponse),
  );
  return { revision: nextRevision };
}

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function normalizeSettings(value: unknown, stored: boolean): StoredSettings {
  if (!isRecord(value))
    throw new ApiError(
      stored
        ? "The browser connection settings are damaged. Existing settings have been preserved."
        : "The local connection settings are invalid. Existing settings have not changed.",
      stored ? 503 : 400,
    );
  const allowedKeys = stored
    ? ["provider", "baseUrl", "textModel", "imageModel"]
    : ["provider", "baseUrl", "textModel", "imageModel", "apiKey"];
  const provider = value.provider;
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
  const textModel =
    typeof value.textModel === "string" ? value.textModel.trim() : "";
  const imageModel =
    typeof value.imageModel === "string" ? value.imageModel.trim() : "";
  const apiKey = value.apiKey;
  if (
    !hasOnlyKeys(value, allowedKeys) ||
    (!stored &&
      "apiKey" in value &&
      (typeof apiKey !== "string" || apiKey.trim().length > 2000)) ||
    (provider !== "openai" && provider !== "compatible") ||
    baseUrl.length > 2000 ||
    !validBaseUrl(baseUrl) ||
    !textModel ||
    textModel.length > 200 ||
    !imageModel ||
    imageModel.length > 200
  )
    throw new ApiError(
      stored
        ? "The browser connection settings are damaged. Existing settings have been preserved."
        : "The local connection settings are invalid. Existing settings have not changed.",
      stored ? 503 : 400,
    );
  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    textModel,
    imageModel,
  };
}

function parseSettingsFallback(): Settings {
  const raw = readBrowserValue(BROWSER_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    ...normalizeSettings(
      parseStoredJson(
        raw,
        "The browser connection settings are damaged. Existing settings have been preserved.",
      ),
      true,
    ),
    // A static build cannot safely keep a provider key in browser storage.
    configured: false,
  };
}

function saveSettingsFallback(init: RequestInit): Settings {
  const settings = normalizeSettings(parseRequestBody(init.body), false);
  // Deliberately whitelist provider preferences. In particular, apiKey is
  // accepted by the server contract but is never written to browser storage.
  writeBrowserValue(BROWSER_SETTINGS_KEY, JSON.stringify(settings));
  return { ...settings, configured: false };
}

function saveImageFallback(init: RequestInit): { id: string; url: string } {
  const input = parseRequestBody(init.body);
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["dataUrl"]) ||
    typeof input.dataUrl !== "string" ||
    !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/u.test(
      input.dataUrl,
    ) ||
    input.dataUrl.length > 14_000_000
  )
    throw new ApiError(
      "The local illustration is invalid or too large. Your existing work has not changed.",
      400,
    );
  const id =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `local-image-${Date.now()}`;
  // A data URL is self-contained and survives reload when the workspace is
  // persisted. No image bytes or provider credentials are written separately.
  return { id, url: input.dataUrl };
}

function fallbackOperation(
  url: string,
  init: RequestInit,
): FallbackOperation | null {
  let path: string;
  try {
    const base =
      typeof location === "undefined" ? "http://localhost/" : location.href;
    path = new URL(url, base).pathname.replace(/\/+$/u, "") || "/";
  } catch {
    path = url.split("?", 1)[0].replace(/\/+$/u, "") || "/";
  }
  const method = (init.method || "GET").toUpperCase();
  if (path === "/api/workspace") {
    if (method === "GET") return "workspace-read";
    if (method === "PUT") return "workspace-write";
  }
  if (path === "/api/settings") {
    if (method === "GET") return "settings-read";
    if (method === "POST") return "settings-write";
  }
  if (path === "/api/images" && method === "POST") return "image-write";
  return null;
}

function runFallback(operation: FallbackOperation, init: RequestInit): unknown {
  switch (operation) {
    case "workspace-read":
      return parseWorkspaceResponse();
    case "workspace-write":
      return saveWorkspaceFallback(init);
    case "settings-read":
      return parseSettingsFallback();
    case "settings-write":
      return saveSettingsFallback(init);
    case "image-write":
      return saveImageFallback(init);
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError",
  );
}

function isRemoteBrowserHost(): boolean {
  try {
    if (typeof location === "undefined") return false;
    const current = new URL(location.href);
    if (current.protocol === "file:") return true;
    return Boolean(
      current.hostname &&
      !["localhost", "127.0.0.1", "[::1]"].includes(
        current.hostname.toLowerCase(),
      ),
    );
  } catch {
    return false;
  }
}

function isNativeNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? (error as { name?: unknown }).name : null;
  const message =
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  return (
    name === "TypeError" &&
    /failed to fetch|fetch failed|load failed|networkerror|network error/i.test(
      message,
    )
  );
}

function shouldUseNetworkFallback(
  operation: FallbackOperation | null,
  error: unknown,
): boolean {
  if (!operation) return false;
  // A remote/file-hosted bundle has no reason to depend on this app's local
  // API. On localhost, retain the established server-backed error path for
  // arbitrary thrown errors while recognizing native fetch network failures.
  return isRemoteBrowserHost() || isNativeNetworkFailure(error);
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) return;
  throw (
    signal.reason || new DOMException("The operation was aborted", "AbortError")
  );
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const operation = fallbackOperation(url, init);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (init.signal?.aborted) throw init.signal.reason || error;
    if (shouldUseNetworkFallback(operation, error))
      return runFallback(operation!, init) as T;
    throw new ApiError(CANNOT_REACH_SERVER, 0);
  }
  if (!response.ok && response.status === 404 && operation) {
    throwIfAborted(init.signal);
    return runFallback(operation, init) as T;
  }
  const body = await response.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new ApiError(
      "The server returned an unreadable response. Your current work has been kept.",
      response.status,
    );
  }
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? (data as { error: unknown }).error
        : null;
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : `The request could not be completed (${response.status}). Please try again.`,
      response.status,
    );
  }
  return data as T;
}
