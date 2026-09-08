export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
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
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "Cannot reach the writing studio server. Your unsaved work is kept in this browser; reconnect and retry.",
      0,
    );
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
