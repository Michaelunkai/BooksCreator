// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBook } from "../src/lib/seed";
import {
  EMERGENCY_KEY,
  copyPreviousRecovery,
  createRecoveryIdentity,
  getEmergencyStorageKey,
  useWorkspace,
} from "../src/lib/useWorkspace";
import type { Workspace } from "../src/types";

function workspace(): Workspace {
  const book = createBook("Saved book");
  return { version: 1, books: [book], activeBookId: book.id };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function changeTitle(value: Workspace, title: string): Workspace {
  return { ...value, books: value.books.map((book) => ({ ...book, title })) };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable workspace saving", () => {
  it("preserves edits immediately, debounces writes, and records the confirmed revision", async () => {
    const original = workspace();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workspace: original, revision: 4 }))
      .mockResolvedValueOnce(response({ revision: 5 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));
    act(() =>
      hook.result.current.setWorkspace(changeTitle(original, "New title")),
    );
    expect(
      JSON.parse(localStorage.getItem(getEmergencyStorageKey())!).workspace
        .books[0].title,
    ).toBe("New title");
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"), {
      timeout: 1500,
    });
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.revision).toBe(4);
    expect(payload.workspace.books[0].title).toBe("New title");
    expect(localStorage.getItem(getEmergencyStorageKey())).toBeNull();
  });

  it("serializes edits made during a save and retains the newest content", async () => {
    const original = workspace();
    let completeFirst!: (value: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workspace: original, revision: 1 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(response({ revision: 3 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() =>
      hook.result.current.setWorkspace(changeTitle(original, "First edit")),
    );
    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.flush();
    });
    act(() =>
      hook.result.current.setWorkspace(changeTitle(original, "Second edit")),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      completeFirst(response({ revision: 2 }));
      await saving;
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      revision: 2,
      workspace: { books: [{ title: "Second edit" }] },
    });
    expect(hook.result.current.saveState).toBe("saved");
  });

  it("recovers same-revision edits and saves them even under StrictMode", async () => {
    const original = workspace();
    localStorage.setItem(
      getEmergencyStorageKey(),
      JSON.stringify({
        workspace: changeTitle(original, "Recovered title"),
        baseRevision: 7,
        updatedAt: new Date().toISOString(),
      }),
    );
    const fetch = vi.fn((_url: string, options?: RequestInit) =>
      Promise.resolve(
        response(
          options?.method === "PUT"
            ? { revision: 8 }
            : { workspace: original, revision: 7 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace(), {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    });
    await waitFor(() =>
      expect(hook.result.current.workspace?.books[0].title).toBe(
        "Recovered title",
      ),
    );
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"), {
      timeout: 1500,
    });
    expect(
      fetch.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(1);
  });

  it("does not overwrite a newer server revision with a recovered local draft", async () => {
    const original = workspace();
    localStorage.setItem(
      getEmergencyStorageKey(),
      JSON.stringify({
        workspace: changeTitle(original, "Local work"),
        baseRevision: 1,
        updatedAt: "",
      }),
    );
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        response({
          workspace: changeTitle(original, "Other window"),
          revision: 3,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.saveState).toBe("conflict"));
    expect(hook.result.current.workspace?.books[0].title).toBe("Local work");
    await act(async () => {
      await hook.result.current.flush();
    });
    act(() => hook.result.current.retrySave());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls.every((call) => call[1]?.method !== "PUT")).toBe(
      true,
    );
    expect(
      JSON.parse(localStorage.getItem(getEmergencyStorageKey())!).workspace
        .books[0].title,
    ).toBe("Local work");
  });

  it("keeps a failed library read as an error without silently creating an empty library", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.saveState).toBe("error"));
    expect(hook.result.current.workspace).toBeNull();
    expect(hook.result.current.error).toContain("No empty library");
    expect(localStorage.getItem(getEmergencyStorageKey())).toBeNull();
  });

  it("reconciles a lost save acknowledgment before retrying and never resends the mutation", async () => {
    const original = workspace();
    const changed = changeTitle(original, "Confirmed despite lost response");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workspace: original, revision: 1 }))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(response({ workspace: changed, revision: 2 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.setWorkspace(changed));
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(hook.result.current.saveState).toBe("error");
    act(() => hook.result.current.retrySave());
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));
    expect(
      fetch.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(1);
    expect(localStorage.getItem(getEmergencyStorageKey())).toBeNull();
  });

  it("retains dirty work when the server rejects a save conflict", async () => {
    const original = workspace();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ workspace: original, revision: 1 }))
        .mockResolvedValueOnce(response({ error: "Changed elsewhere" }, 409)),
    );
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() =>
      hook.result.current.setWorkspace(changeTitle(original, "My draft")),
    );
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(hook.result.current.saveState).toBe("conflict");
    expect(localStorage.getItem(getEmergencyStorageKey())).toContain(
      "My draft",
    );
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("never clears or overwrites a different tab recovery copy", async () => {
    const original = workspace();
    const foreignKey = `${EMERGENCY_KEY}:different-tab`;
    const foreignSnapshot = JSON.stringify({
      workspace: changeTitle(original, "Other tab unsaved"),
      baseRevision: 1,
      updatedAt: "",
    });
    localStorage.setItem(foreignKey, foreignSnapshot);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ workspace: original, revision: 1 }))
        .mockResolvedValueOnce(response({ revision: 2 })),
    );
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() =>
      hook.result.current.setWorkspace(changeTitle(original, "This tab edit")),
    );
    expect(localStorage.getItem(foreignKey)).toBe(foreignSnapshot);
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(localStorage.getItem(getEmergencyStorageKey())).toBeNull();
    expect(localStorage.getItem(foreignKey)).toBe(foreignSnapshot);
  });

  it("resolves conflict as a separate book while preserving the latest server book and remapping references", async () => {
    const original = workspace();
    const local = changeTitle(original, "My edited book");
    local.books[0].images = [
      {
        id: "image",
        url: "/media/00000000-0000-0000-0000-000000000001.png",
        prompt: "",
        style: "",
        caption: "",
        chapterId: local.books[0].chapters[0].id,
        createdAt: new Date().toISOString(),
      },
    ];
    const remote = changeTitle(original, "Latest server book");
    localStorage.setItem(
      getEmergencyStorageKey(),
      JSON.stringify({ workspace: local, baseRevision: 1, updatedAt: "" }),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workspace: remote, revision: 3 }))
      .mockResolvedValueOnce(response({ workspace: remote, revision: 3 }))
      .mockResolvedValueOnce(response({ revision: 4 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.saveState).toBe("conflict"));
    await act(async () => {
      await hook.result.current.recoverAsCopy();
    });
    expect(hook.result.current.saveState).toBe("saved");
    const recovered = hook.result.current.workspace!;
    expect(recovered.books).toHaveLength(2);
    expect(recovered.books[0]).toEqual(remote.books[0]);
    expect(recovered.books[1].title).toBe("My edited book (recovered copy)");
    expect(recovered.books[1].id).not.toBe(original.books[0].id);
    expect(recovered.books[1].images[0].chapterId).toBe(
      recovered.books[1].chapters[0].id,
    );
    expect(recovered.activeBookId).toBe(recovered.books[1].id);
    expect(JSON.parse(fetch.mock.calls[2][1].body).revision).toBe(3);
  });

  it("assigns each document a fresh key even when sessionStorage was cloned and copies recovery non-destructively", () => {
    const original = workspace();
    const first = createRecoveryIdentity("first-document");
    const snapshot = JSON.stringify({
      workspace: original,
      baseRevision: 1,
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem(first.key, snapshot);
    const second = createRecoveryIdentity("duplicated-document");
    expect(second.key).not.toBe(first.key);
    expect(second.previousKey).toBe(first.key);
    expect(copyPreviousRecovery(second)).toBe(snapshot);
    expect(localStorage.getItem(first.key)).toBe(snapshot);
    expect(localStorage.getItem(second.key)).toBe(snapshot);
    const third = createRecoveryIdentity("reloaded-document");
    expect(copyPreviousRecovery(third)).toBe(snapshot);
    expect(localStorage.getItem(first.key)).toBe(snapshot);
    expect(localStorage.getItem(second.key)).toBe(snapshot);
  });

  it("discovers recovery left by closed tabs and merges selected work without losing current pending edits", async () => {
    const original = workspace();
    const closed = changeTitle(original, "Closed tab draft");
    const closedKey = `${EMERGENCY_KEY}:closed-tab`;
    const snapshot = JSON.stringify({
      workspace: closed,
      baseRevision: 1,
      updatedAt: "2026-09-08T01:00:00.000Z",
    });
    localStorage.setItem(closedKey, snapshot);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ workspace: original, revision: 2 }))
      .mockResolvedValueOnce(response({ workspace: original, revision: 2 }))
      .mockResolvedValueOnce(response({ revision: 3 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.saveState).toBe("saved"));
    expect(hook.result.current.recoveryCopies).toEqual([
      {
        key: closedKey,
        title: "Closed tab draft",
        updatedAt: "2026-09-08T01:00:00.000Z",
      },
    ]);
    act(() =>
      hook.result.current.setWorkspace(
        changeTitle(original, "Current unsaved draft"),
      ),
    );
    await act(async () => {
      await hook.result.current.recoverStoredCopy(closedKey);
    });
    expect(hook.result.current.saveState).toBe("saved");
    const books = hook.result.current.workspace!.books;
    expect(books.map((book) => book.title)).toEqual([
      "Saved book",
      "Current unsaved draft (recovered copy)",
      "Closed tab draft (recovered copy)",
    ]);
    expect(books[0]).toEqual(original.books[0]);
    expect(hook.result.current.workspace!.activeBookId).toBe(books[2].id);
    expect(localStorage.getItem(closedKey)).toBe(snapshot);
    expect(localStorage.getItem(getEmergencyStorageKey())).toBeNull();
  });

  it("refreshes available recovery copies when another tab changes storage", async () => {
    const original = workspace();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ workspace: original, revision: 1 })),
    );
    const hook = renderHook(() => useWorkspace());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const key = `${EMERGENCY_KEY}:live-tab`;
    act(() => {
      localStorage.setItem(
        key,
        JSON.stringify({
          workspace: changeTitle(original, "Live work"),
          baseRevision: 1,
          updatedAt: "2026-09-08T01:00:00.000Z",
        }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(hook.result.current.recoveryCopies[0].title).toBe("Live work");
    act(() => {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(hook.result.current.recoveryCopies).toHaveLength(0);
  });

  it("shows a valid prior draft offline even when quota prevents copying it into the reloaded document key", async () => {
    const original = workspace();
    original.books[0].title = "Recovered despite full storage";
    original.books[0].chapters[0].content =
      "<p>This unsaved scene must remain visible.</p>";
    const previousKey = `${EMERGENCY_KEY}:previous-document-full-storage`;
    const snapshot = JSON.stringify({
      workspace: original,
      baseRevision: 6,
      updatedAt: "2026-09-08T01:00:00.000Z",
    });
    localStorage.setItem(previousKey, snapshot);
    sessionStorage.setItem("folio.recovery-tab.v1", previousKey);
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (
        this === localStorage &&
        key !== previousKey &&
        key.startsWith(EMERGENCY_KEY)
      ) {
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError",
        );
      }
      realSetItem.call(this, key, value);
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    vi.resetModules();
    const reloaded = await import("../src/lib/useWorkspace");
    const hook = renderHook(() => reloaded.useWorkspace(), {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.workspace?.books[0].title).toBe(
      "Recovered despite full storage",
    );
    expect(hook.result.current.workspace?.books[0].chapters[0].content).toBe(
      "<p>This unsaved scene must remain visible.</p>",
    );
    expect(hook.result.current.saveState).toBe("error");
    expect(hook.result.current.error).toMatch(/storage.*full/i);
    expect(localStorage.getItem(previousKey)).toBe(snapshot);
    expect(localStorage.getItem(reloaded.getEmergencyStorageKey())).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
});
