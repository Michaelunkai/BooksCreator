import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Workspace } from "../types";
import { ApiError, fetchJson } from "./api";
import { createSeedWorkspace } from "./seed";

export type SaveState = "loading" | "saving" | "saved" | "error" | "conflict";
export const EMERGENCY_KEY = "folio.emergency-workspace.v1";
const TAB_KEY = "folio.recovery-tab.v1";
interface RecoveryIdentity {
  key: string;
  previousKey: string | null;
}
let documentIdentity: RecoveryIdentity | undefined;

// A duplicated tab inherits sessionStorage, but never this freshly created document token.
export function createRecoveryIdentity(
  token: string = crypto.randomUUID(),
): RecoveryIdentity {
  const key = `${EMERGENCY_KEY}:${token}`;
  let previousKey: string | null = null;
  try {
    const previous = sessionStorage.getItem(TAB_KEY);
    previousKey = previous
      ? previous.startsWith(`${EMERGENCY_KEY}:`)
        ? previous
        : `${EMERGENCY_KEY}:${previous}`
      : null;
    sessionStorage.setItem(TAB_KEY, key);
  } catch {
    /* Document identity still prevents unrelated tabs from sharing a key. */
  }
  return { key, previousKey: previousKey === key ? null : previousKey };
}

export function getEmergencyStorageKey(): string {
  documentIdentity ||= createRecoveryIdentity();
  return documentIdentity.key;
}
interface Snapshot {
  workspace: Workspace;
  baseRevision: number;
  updatedAt: string;
}
interface ServerWorkspace {
  workspace: Workspace | null;
  revision: number;
}
export interface RecoveryCopy {
  key: string;
  title: string;
  updatedAt: string;
}

function readSnapshot(raw: string): Snapshot {
  const parsed = JSON.parse(raw) as Snapshot;
  if (
    !isWorkspace(parsed.workspace) ||
    !Number.isSafeInteger(parsed.baseRevision) ||
    parsed.baseRevision < 0 ||
    typeof parsed.updatedAt !== "string"
  )
    throw new Error(
      "This recovery copy is damaged or incomplete. Its stored data has been preserved.",
    );
  return parsed;
}

export function copyPreviousRecovery(
  identity: RecoveryIdentity,
  onStorageWarning?: (message: string) => void,
): string | null {
  const own = localStorage.getItem(identity.key);
  if (own || !identity.previousKey) return own;
  const previous = localStorage.getItem(identity.previousKey);
  if (!previous) return null;
  readSnapshot(previous);
  // Copying allows a reload to resume safely while a duplicate tab retains its own recovery.
  try {
    localStorage.setItem(identity.key, previous);
  } catch {
    onStorageWarning?.(
      "Browser recovery storage is full or unavailable. Your previous recovery copy is preserved, and its draft is shown here. Keep this window open until the server saves your work, or export a backup.",
    );
  }
  return previous;
}

function listRecoveryCopies(ownKey: string): RecoveryCopy[] {
  const copies: RecoveryCopy[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (
        !key ||
        key === ownKey ||
        !(key === EMERGENCY_KEY || key.startsWith(`${EMERGENCY_KEY}:`))
      )
        continue;
      try {
        const snapshot = readSnapshot(localStorage.getItem(key) || "");
        const active =
          snapshot.workspace.books.find(
            (book) => book.id === snapshot.workspace.activeBookId,
          ) || snapshot.workspace.books[0];
        if (!active) continue;
        copies.push({
          key,
          title: `${active.title}${snapshot.workspace.books.length > 1 ? ` (+${snapshot.workspace.books.length - 1} more)` : ""}`,
          updatedAt: snapshot.updatedAt,
        });
      } catch {
        /* Invalid recovery entries are retained rather than silently rewritten. */
      }
    }
  } catch {
    /* A storage access error is separately reported by the persistence path. */
  }
  return copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<Workspace>;
  return (
    workspace.version === 1 &&
    Array.isArray(workspace.books) &&
    workspace.books.length <= 100 &&
    workspace.books.every(
      (book) =>
        book &&
        [
          "id",
          "title",
          "subtitle",
          "author",
          "genre",
          "language",
          "voiceSample",
          "voiceNotes",
          "createdAt",
          "updatedAt",
        ].every((key) => typeof book[key as keyof typeof book] === "string") &&
        ["auto", "ltr", "rtl"].includes(book.direction) &&
        Number.isFinite(book.targetWords) &&
        Array.isArray(book.chapters) &&
        book.chapters.length > 0 &&
        book.chapters.every(
          (chapter) =>
            chapter &&
            ["id", "title", "content", "synopsis"].every(
              (key) => typeof chapter[key as keyof typeof chapter] === "string",
            ) &&
            ["draft", "revised", "final"].includes(chapter.status) &&
            Array.isArray(chapter.versions) &&
            chapter.versions.every(
              (version) =>
                version &&
                ["id", "name", "createdAt", "title", "content"].every(
                  (key) =>
                    typeof version[key as keyof typeof version] === "string",
                ),
            ),
        ) &&
        Array.isArray(book.bible) &&
        book.bible.every(
          (note) =>
            note &&
            ["id", "kind", "name", "details"].every(
              (key) => typeof note[key as keyof typeof note] === "string",
            ),
        ) &&
        Array.isArray(book.images) &&
        book.images.every(
          (image) =>
            image &&
            [
              "id",
              "url",
              "prompt",
              "style",
              "caption",
              "chapterId",
              "createdAt",
            ].every(
              (key) => typeof image[key as keyof typeof image] === "string",
            ),
        ),
    ) &&
    typeof workspace.activeBookId === "string" &&
    (workspace.books.length
      ? workspace.books.some((book) => book.id === workspace.activeBookId)
      : workspace.activeBookId === "")
  );
}

export function useWorkspace() {
  const [workspace, renderWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [error, setError] = useState("");
  const [storageKey] = useState(getEmergencyStorageKey);
  const [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>(() =>
    listRecoveryCopies(storageKey),
  );
  const current = useRef<Workspace | null>(null);
  const revision = useRef(0);
  const persisted = useRef("");
  const loaded = useRef(false);
  const blocked = useRef(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const recovering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snapshotError = useRef("");

  const keepEmergencyCopy = useCallback(
    (value: Workspace | null) => {
      if (!value) return;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            workspace: value,
            baseRevision: revision.current,
            updatedAt: new Date().toISOString(),
          } satisfies Snapshot),
        );
        snapshotError.current = "";
      } catch {
        snapshotError.current =
          "Browser recovery storage is full or unavailable. Keep this window open until the server saves your work, or export a backup.";
        if (mounted.current) setError(snapshotError.current);
      }
    },
    [storageKey],
  );

  const removeEmergencyCopy = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* Server copy is already confirmed. */
    }
  }, [storageKey]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (saving.current) return saving.current;
    if (!loaded.current || blocked.current || !current.current) return;
    const run = async () => {
      while (current.current && !blocked.current) {
        const sent = JSON.stringify(current.current);
        if (sent === persisted.current) break;
        if (mounted.current) {
          setSaveState("saving");
          setError(snapshotError.current);
        }
        try {
          const result = await fetchJson<{ revision: number }>(
            "/api/workspace",
            {
              method: "PUT",
              body: JSON.stringify({
                workspace: current.current,
                revision: revision.current,
              }),
            },
          );
          if (!Number.isSafeInteger(result.revision) || result.revision < 0)
            throw new Error(
              "The server did not confirm the saved revision. Your recovery copy is retained.",
            );
          revision.current = result.revision;
          persisted.current = sent;
          if (JSON.stringify(current.current) === sent) {
            removeEmergencyCopy();
            if (mounted.current) {
              setSaveState("saved");
              setError("");
            }
          } else keepEmergencyCopy(current.current);
        } catch (cause) {
          blocked.current = true;
          keepEmergencyCopy(current.current);
          if (mounted.current) {
            const conflict = cause instanceof ApiError && cause.status === 409;
            setSaveState(conflict ? "conflict" : "error");
            setError(
              conflict
                ? "Another window changed this library. Your edits are retained here. Export a book backup before resolving the other copy; retry checks for a safe recovery and never overwrites newer work."
                : `${cause instanceof Error ? cause.message : "Saving failed. Your edits are retained here."}${snapshotError.current ? ` ${snapshotError.current}` : ""}`,
            );
          }
          break;
        }
      }
    };
    const promise = run();
    saving.current = promise;
    try {
      await promise;
    } finally {
      saving.current = null;
    }
  }, [keepEmergencyCopy, removeEmergencyCopy]);

  const setWorkspace: Dispatch<SetStateAction<Workspace | null>> = useCallback(
    (update) => {
      const next =
        typeof update === "function" ? update(current.current) : update;
      current.current = next;
      keepEmergencyCopy(next);
      renderWorkspace(next);
      if (
        loaded.current &&
        !blocked.current &&
        next &&
        JSON.stringify(next) !== persisted.current
      )
        setSaveState("saving");
    },
    [keepEmergencyCopy],
  );

  const reconcile = useCallback(
    async (initial: boolean, signal?: AbortSignal) => {
      const attempt = ++requestVersion.current;
      let local: Snapshot | null = null;
      let recoveryReadError = "";
      if (initial) {
        try {
          const raw = copyPreviousRecovery(
            {
              key: storageKey,
              previousKey: documentIdentity?.previousKey || null,
            },
            (warning) => {
              snapshotError.current = warning;
            },
          );
          if (raw) {
            const parsed = readSnapshot(raw);
            local = parsed;
            current.current = parsed.workspace;
            revision.current = parsed.baseRevision;
            renderWorkspace(parsed.workspace);
          }
        } catch {
          recoveryReadError =
            "The browser recovery copy could not be read. It has been preserved; export the server copy before clearing browser storage.";
        }
      }
      try {
        const remote = await fetchJson<ServerWorkspace>("/api/workspace", {
          signal,
        });
        if (
          attempt !== requestVersion.current ||
          signal?.aborted ||
          !mounted.current
        )
          return;
        if (
          !Number.isSafeInteger(remote.revision) ||
          remote.revision < 0 ||
          (remote.workspace !== null && !isWorkspace(remote.workspace))
        )
          throw new Error(
            "The saved library could not be read safely. Existing data has not been replaced.",
          );
        loaded.current = true;
        const serverJson = remote.workspace
          ? JSON.stringify(remote.workspace)
          : "";
        const draft = current.current;
        const draftJson = draft ? JSON.stringify(draft) : "";
        if (
          draft &&
          draftJson !== serverJson &&
          revision.current !== remote.revision
        ) {
          blocked.current = true;
          setSaveState("conflict");
          setError(
            `Recovered edits belong to an earlier library revision. Your edits are shown here and preserved in this browser. Export a backup before resolving the other copy; newer server work has not been overwritten.${snapshotError.current ? ` ${snapshotError.current}` : ""}`,
          );
        } else if (recoveryReadError) {
          blocked.current = true;
          if (!draft) {
            current.current = remote.workspace;
            renderWorkspace(remote.workspace);
          }
          persisted.current = serverJson;
          revision.current = remote.revision;
          setSaveState("error");
          setError(recoveryReadError);
        } else {
          blocked.current = false;
          revision.current = remote.revision;
          persisted.current = serverJson;
          const next = draft || remote.workspace || createSeedWorkspace();
          current.current = next;
          renderWorkspace(next);
          if (JSON.stringify(next) === serverJson) {
            removeEmergencyCopy();
            setSaveState("saved");
            setError("");
          } else {
            keepEmergencyCopy(next);
            setSaveState("saving");
            setError(
              `${local ? "Recovered unsaved changes. Saving them to your library…" : ""}${snapshotError.current ? ` ${snapshotError.current}` : ""}`.trim(),
            );
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              void flush();
            }, 600);
          }
        }
      } catch (cause) {
        if (
          attempt !== requestVersion.current ||
          signal?.aborted ||
          !mounted.current
        )
          return;
        blocked.current = true;
        setSaveState("error");
        setError(
          `${cause instanceof Error ? cause.message : "Your library could not be loaded."}${current.current ? " Your recovered work is available below." : " No empty library has been created."}${snapshotError.current ? ` ${snapshotError.current}` : ""}`,
        );
      } finally {
        if (
          attempt === requestVersion.current &&
          mounted.current &&
          !signal?.aborted
        )
          setLoading(false);
      }
    },
    [flush, keepEmergencyCopy, removeEmergencyCopy, storageKey],
  );

  const recoverCopies = useCallback(
    async (sourceKey?: string): Promise<void> => {
      if (recovering.current || (!current.current && !sourceKey)) return;
      recovering.current = true;
      try {
        if (saving.current) await saving.current;
        blocked.current = true;
        clearTimeout(timer.current);
        let selected: Snapshot | null = null;
        if (sourceKey) {
          if (
            sourceKey !== EMERGENCY_KEY &&
            !sourceKey.startsWith(`${EMERGENCY_KEY}:`)
          )
            throw new Error("Choose a writing studio recovery copy.");
          const raw = localStorage.getItem(sourceKey);
          if (!raw)
            throw new Error(
              "This recovery copy is no longer available. Its original window may have saved it successfully.",
            );
          selected = readSnapshot(raw);
        }
        setError(
          "Checking the latest library and preserving your edits as separate books…",
        );
        const remote = await fetchJson<ServerWorkspace>("/api/workspace");
        if (
          !Number.isSafeInteger(remote.revision) ||
          remote.revision < 0 ||
          (remote.workspace !== null && !isWorkspace(remote.workspace))
        )
          throw new Error(
            "The saved library could not be read safely. Your edits are still retained.",
          );
        const local = current.current;
        const server = remote.workspace || {
          version: 1 as const,
          books: [],
          activeBookId: "",
        };
        let activeCopyId = "";
        const preferredId =
          selected?.workspace.activeBookId || local?.activeBookId;
        const uniqueBooks = new Map<string, Workspace["books"][number]>();
        for (const source of [local, selected?.workspace])
          for (const book of source?.books || [])
            uniqueBooks.set(JSON.stringify(book), book);
        const copies = Array.from(uniqueBooks.values())
          .filter(
            (book) =>
              JSON.stringify(book) !==
              JSON.stringify(
                server.books.find((saved) => saved.id === book.id),
              ),
          )
          .map((book) => {
            const ids = new Map(
              book.chapters.map((chapter) => [chapter.id, crypto.randomUUID()]),
            );
            const id = crypto.randomUUID();
            if (book.id === preferredId) activeCopyId = id;
            return {
              ...book,
              id,
              title: `${book.title.slice(0, 970)} (recovered copy)`,
              updatedAt: new Date().toISOString(),
              chapters: book.chapters.map((chapter) => ({
                ...chapter,
                id: ids.get(chapter.id)!,
                versions: chapter.versions.map((version) => ({
                  ...version,
                  id: crypto.randomUUID(),
                })),
              })),
              bible: book.bible.map((note) => ({
                ...note,
                id: crypto.randomUUID(),
              })),
              images: book.images.map((image) => ({
                ...image,
                id: crypto.randomUUID(),
                chapterId:
                  ids.get(image.chapterId) || ids.get(book.chapters[0].id)!,
              })),
            };
          });
        if (server.books.length + copies.length > 100)
          throw new Error(
            "The library is at its 100-book limit. Export your recovered book before removing an unwanted book in the other window, then retry recovery.",
          );
        const merged: Workspace = {
          version: 1,
          books: [...server.books, ...copies],
          activeBookId: activeCopyId || copies[0]?.id || server.activeBookId,
        };
        revision.current = remote.revision;
        persisted.current = remote.workspace
          ? JSON.stringify(remote.workspace)
          : "";
        loaded.current = true;
        blocked.current = false;
        current.current = merged;
        renderWorkspace(merged);
        if (JSON.stringify(merged) === persisted.current) {
          removeEmergencyCopy();
          setSaveState("saved");
          setError("");
        } else {
          keepEmergencyCopy(merged);
          setSaveState("saving");
          await flush();
        }
      } catch (cause) {
        blocked.current = true;
        setSaveState("conflict");
        setError(
          cause instanceof Error
            ? cause.message
            : "Recovery could not be completed. Your edits are still retained.",
        );
      } finally {
        recovering.current = false;
        setRecoveryCopies(listRecoveryCopies(storageKey));
      }
    },
    [flush, keepEmergencyCopy, removeEmergencyCopy, storageKey],
  );

  const recoverAsCopy = useCallback(() => recoverCopies(), [recoverCopies]);
  const recoverStoredCopy = useCallback(
    (key: string) => recoverCopies(key),
    [recoverCopies],
  );

  const retrySave = useCallback(() => {
    if (saving.current || recovering.current) return;
    setError("Checking the saved library before retrying…");
    void reconcile(!current.current);
  }, [reconcile]);

  useEffect(() => {
    const refresh = () => setRecoveryCopies(listRecoveryCopies(storageKey));
    const changed = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(EMERGENCY_KEY)) refresh();
    };
    refresh();
    window.addEventListener("storage", changed);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", refresh);
    };
  }, [storageKey]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void reconcile(true, controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(timer.current);
    };
  }, [reconcile]);

  useEffect(() => {
    if (
      !workspace ||
      !loaded.current ||
      blocked.current ||
      JSON.stringify(workspace) === persisted.current
    )
      return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 600);
    return () => clearTimeout(timer.current);
  }, [workspace, flush]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        current.current &&
        JSON.stringify(current.current) !== persisted.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return {
    workspace,
    setWorkspace,
    loading,
    saveState,
    error,
    retrySave,
    flush,
    recoverAsCopy,
    recoveryCopies,
    recoverStoredCopy,
  };
}
