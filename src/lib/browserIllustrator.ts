import type { IllustrateRequest } from "../types";

const modelName = "Janus 1.3B · free on-device art";

export interface BrowserIllustratorProgress {
  progress: number;
  text: string;
}

export interface BrowserIllustratorOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BrowserIllustratorProgress) => void;
}

export class BrowserIllustratorUnavailableError extends Error {
  constructor(message = "The free on-device art model is unavailable.") {
    super(message);
    this.name = "BrowserIllustratorUnavailableError";
  }
}

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: {
      powerPreference?: "low-power" | "high-performance";
    }) => Promise<unknown | null>;
  };
};

type JanusWorkerMessage = {
  status: string;
  data?: unknown;
  blob?: Blob;
};

let worker: Worker | null = null;
let loadPromise: Promise<void> | null = null;
let pending: {
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  options: BrowserIllustratorOptions;
} | null = null;

function hasWebGpu(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    Boolean((navigator as WebGpuNavigator).gpu)
  );
}

function notify(
  options: BrowserIllustratorOptions,
  progress: number,
  text: string,
): void {
  options.onProgress?.({ progress: Math.max(0, Math.min(1, progress)), text });
}

function resetWorker(): void {
  worker?.terminate();
  worker = null;
  loadPromise = null;
  pending = null;
}

function ensureWorker(options: BrowserIllustratorOptions): Promise<void> {
  if (loadPromise) return loadPromise;
  worker = new Worker(new URL("./janusWorker.ts", import.meta.url), {
    type: "module",
  });
  loadPromise = new Promise<void>((resolve, reject) => {
    const activeWorker = worker!;
    activeWorker.onmessage = (event: MessageEvent<JanusWorkerMessage>) => {
      const message = event.data;
      if (message.status === "loading") {
        notify(options, 0.02, String(message.data || "Loading the art model…"));
      } else if (message.status === "progress") {
        const report = (message.data || {}) as {
          progress?: number;
          file?: string;
        };
        const rawProgress = Number(report.progress || 0);
        const progress = rawProgress > 1 ? rawProgress / 100 : rawProgress;
        notify(
          options,
          Math.max(0.03, Math.min(0.72, progress * 0.69)),
          report.file
            ? `Downloading ${report.file}…`
            : "Preparing the art model…",
        );
      } else if (message.status === "capability") {
        notify(options, 0.05, "Checking this device’s graphics support…");
      } else if (message.status === "ready") {
        notify(options, 0.72, `${modelName} is ready.`);
        resolve();
      } else if (message.status === "error") {
        reject(
          new BrowserIllustratorUnavailableError(
            String(message.data || "The art model could not start."),
          ),
        );
      }
    };
    activeWorker.onerror = (event) => {
      reject(
        new BrowserIllustratorUnavailableError(
          event.message || "The art model worker stopped unexpectedly.",
        ),
      );
    };
    activeWorker.postMessage({ type: "load" });
  }).catch((error) => {
    resetWorker();
    throw error;
  });
  return loadPromise;
}

function promptFor(input: IllustrateRequest): string {
  const notePriority: Record<IllustrateRequest["book"]["bible"][number]["kind"], number> = {
    character: 0,
    plot: 1,
    place: 2,
    world: 3,
    note: 4,
  };
  const storyCues = input.book.bible
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => note.name.trim() || note.details.trim())
    .sort(
      (left, right) =>
        notePriority[left.note.kind] - notePriority[right.note.kind] ||
        left.index - right.index,
    )
    .slice(0, 12)
    .map(({ note }) => {
      const name = note.name.trim() || "unnamed note";
      const details = note.details.trim().slice(0, 480);
      return `${note.kind}: ${name}${details ? ` — ${details}` : ""}`;
    })
    .join("; ")
    .slice(0, 3600);
  const chapter = input.book.chapters.find(
    (item) => item.id === input.chapterId,
  );
  const chapterContext = chapter
    ? [chapter.title.trim(), chapter.synopsis.trim()]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 700)
    : "";
  return [
    "Create an original literary book illustration from this story moment.",
    `Visual medium: ${input.style}.`,
    `Story moment: ${input.excerpt.trim()}.`,
    `Printed composition: ${input.size}.`,
    input.direction.trim() ? `Art direction: ${input.direction.trim()}.` : "",
    chapterContext ? `Chapter context: ${chapterContext}.` : "",
    storyCues ? `Story-bible cues: ${storyCues}.` : "",
    "Prioritize the concrete people, place, weather, objects, light, and emotional atmosphere in the passage.",
    "Composition should leave calm negative space for a printed page. No words, letters, captions, logos, borders, or watermarks.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function browserIllustratorPrompt(input: IllustrateRequest): string {
  return promptFor(input);
}

export function browserIllustratorModelName(): string {
  return modelName;
}

export async function generateBrowserIllustration(
  input: IllustrateRequest,
  options: BrowserIllustratorOptions = {},
): Promise<Blob> {
  if (options.signal?.aborted)
    throw new DOMException("Generation cancelled", "AbortError");
  if (!hasWebGpu())
    throw new BrowserIllustratorUnavailableError(
      "This browser does not expose WebGPU, so Folio will use its offline art study.",
    );
  const gpu = (navigator as WebGpuNavigator).gpu!;
  if (!(await gpu.requestAdapter({ powerPreference: "high-performance" })))
    throw new BrowserIllustratorUnavailableError(
      "No compatible graphics adapter was available for the art model.",
    );
  if (pending)
    throw new BrowserIllustratorUnavailableError(
      "Another illustration is already being composed.",
    );
  await ensureWorker(options);
  if (options.signal?.aborted)
    throw new DOMException("Generation cancelled", "AbortError");
  if (pending)
    throw new BrowserIllustratorUnavailableError(
      "Another illustration is already being composed.",
    );
  if (!worker) throw new BrowserIllustratorUnavailableError();
  return await new Promise<Blob>((resolve, reject) => {
    const activeWorker = worker!;
    pending = { resolve, reject, options };
    let settled = false;
    const cleanup = () => {
      activeWorker.removeEventListener("message", onMessage);
      activeWorker.removeEventListener("error", onError);
      options.signal?.removeEventListener("abort", abort);
      if (pending?.resolve === resolve) pending = null;
    };
    const onError = (event: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      resetWorker();
      reject(
        new BrowserIllustratorUnavailableError(
          event.message || "The art model worker stopped unexpectedly.",
        ),
      );
    };
    const onMessage = (event: MessageEvent<JanusWorkerMessage>) => {
      const message = event.data;
      if (message.status === "generating") {
        notify(options, 0.74, String(message.data || "Composing the scene…"));
      } else if (message.status === "image-progress") {
        const progress = (message.data as { progress?: number } | undefined)
          ?.progress;
        notify(
          options,
          0.74 + Math.max(0, Math.min(1, Number(progress || 0))) * 0.25,
          "Painting the scene…",
        );
      } else if (message.status === "image" && message.blob) {
        settled = true;
        notify(options, 1, "Your free on-device illustration is ready.");
        cleanup();
        resolve(message.blob);
      } else if (message.status === "error") {
        settled = true;
        cleanup();
        resetWorker();
        reject(
          new BrowserIllustratorUnavailableError(
            String(message.data || "The art model could not create an image."),
          ),
        );
      }
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      activeWorker.postMessage({ type: "interrupt" });
      cleanup();
      reject(new DOMException("Generation cancelled", "AbortError"));
    };
    activeWorker.addEventListener("message", onMessage);
    activeWorker.addEventListener("error", onError);
    options.signal?.addEventListener("abort", abort, { once: true });
    activeWorker.postMessage({ type: "generate", prompt: promptFor(input) });
  });
}
