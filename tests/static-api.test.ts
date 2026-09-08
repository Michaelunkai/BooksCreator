// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson } from "../src/lib/api";
import { createSeedWorkspace } from "../src/lib/seed";
import type { Settings, Workspace } from "../src/types";

interface WorkspaceResponse {
  workspace: Workspace | null;
  revision: number;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("static-host API fallback", () => {
  it("loads, saves, and reopens a browser-local workspace after a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJson<WorkspaceResponse>("/api/workspace"),
    ).resolves.toEqual({ workspace: null, revision: 0 });

    const workspace = createSeedWorkspace();
    await expect(
      fetchJson<{ revision: number }>("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspace, revision: 0 }),
      }),
    ).resolves.toEqual({ revision: 1 });

    await expect(
      fetchJson<WorkspaceResponse>("/api/workspace"),
    ).resolves.toEqual({ workspace, revision: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the browser workspace for an HTML 404 and retains conflict protection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<!doctype html>", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJson<WorkspaceResponse>("/api/workspace"),
    ).resolves.toEqual({ workspace: null, revision: 0 });

    const workspace = createSeedWorkspace();
    await expect(
      fetchJson<{ revision: number }>("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspace, revision: 0 }),
      }),
    ).resolves.toEqual({ revision: 1 });

    const changed = createSeedWorkspace();
    await expect(
      fetchJson<{ revision: number }>("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspace: changed, revision: 0 }),
      }),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      fetchJson<WorkspaceResponse>("/api/workspace"),
    ).resolves.toEqual({ workspace, revision: 1 });
  });

  it("persists settings without retaining an API key and reports offline mode", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const settings = await fetchJson<Settings>("/api/settings");
    expect(settings).toMatchObject({
      configured: false,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      textModel: "gpt-6-astra",
      imageModel: "gpt-image-2",
    });

    const saved = await fetchJson<Settings>("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        provider: "compatible",
        baseUrl: "https://provider.example/v1",
        textModel: "text-model",
        imageModel: "image-model",
        apiKey: "do-not-persist-this-secret",
      }),
    });
    expect(saved).toMatchObject({
      configured: false,
      provider: "compatible",
      baseUrl: "https://provider.example/v1",
      textModel: "text-model",
      imageModel: "image-model",
    });

    await expect(fetchJson<Settings>("/api/settings")).resolves.toEqual(saved);
    const stored = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index) || ""),
    ).join("\n");
    expect(stored).not.toContain("do-not-persist-this-secret");
  });

  it("rethrows abort errors instead of entering the browser fallback", async () => {
    const abort = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(fetchJson("/api/workspace")).rejects.toBe(abort);
    expect(localStorage.length).toBe(0);
  });

  it("keeps non-workspace API failures on the existing error path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(
      fetchJson("/api/generate", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    ).rejects.toMatchObject({
      status: 0,
      message:
        "Cannot reach the writing studio server. Your unsaved work is kept in this browser; reconnect and retry.",
    } satisfies Partial<ApiError>);
    expect(localStorage.length).toBe(0);
  });

  it("preserves a server conflict instead of replacing it with local state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "server conflict" }, 409)),
    );

    await expect(
      fetchJson("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspace: createSeedWorkspace(), revision: 0 }),
      }),
    ).rejects.toMatchObject({ status: 409, message: "server conflict" });
    expect(localStorage.length).toBe(0);
  });
});
