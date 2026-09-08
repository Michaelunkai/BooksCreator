// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  browserIllustratorModelName,
  browserIllustratorPrompt,
  generateBrowserIllustration,
} from "../src/lib/browserIllustrator";
import type { IllustrateRequest } from "../src/types";

const request: IllustrateRequest = {
  book: {
    id: "book-one",
    title: "The House of Tides",
    subtitle: "",
    author: "",
    genre: "Literary fiction",
    language: "English",
    direction: "auto",
    voiceSample: "",
    voiceNotes: "",
    targetWords: 50000,
    chapters: [
      {
        id: "chapter-one",
        title: "The Long Warning",
        content: "",
        synopsis: "Mara weighs a warning that could expose the lighthouse secret.",
        status: "draft",
        versions: [],
      },
    ],
    bible: [
      {
        id: "place-one",
        kind: "place",
        name: "Greyhaven",
        details: "A wind-bent village beneath a lighthouse.",
      },
      {
        id: "character-one",
        kind: "character",
        name: "Mara Vale",
        details: "The lighthouse keeper who hears weather before it arrives.",
      },
      {
        id: "plot-one",
        kind: "plot",
        name: "The returning storm",
        details: "Mara must choose whether to warn the village or protect the secret below the lighthouse.",
      },
    ],
    images: [],
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  },
  chapterId: "chapter-one",
  excerpt: "The keeper hears tomorrow's storm inside the empty room.",
  direction: "Muted sea greens, a single warm window, no lettering.",
  style: "Watercolor",
  size: "1536x1024",
};

describe("browser illustration model", () => {
  it("builds a story-grounded prompt with the chosen medium and composition", () => {
    const prompt = browserIllustratorPrompt(request);
    expect(prompt).toContain("Watercolor");
    expect(prompt).toContain("tomorrow's storm");
    expect(prompt).toContain("Greyhaven");
    expect(prompt).toContain("Mara Vale");
    expect(prompt).toContain("The returning storm");
    expect(prompt).toContain("The Long Warning");
    expect(prompt).toContain("1536x1024");
    expect(prompt).toContain("No words");
    expect(browserIllustratorModelName()).toContain("Janus 1.3B");
  });

  it("fails over cleanly when this browser has no WebGPU", async () => {
    await expect(generateBrowserIllustration(request)).rejects.toThrow(
      /WebGPU|art model/i,
    );
  });

  it("streams a worker image and cleans up after a successful generation", async () => {
    const originalWorker = (globalThis as { Worker?: unknown }).Worker;
    const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly posted: unknown[] = [];
      private readonly listeners = new Map<string, Set<EventListener>>();

      constructor() {
        FakeWorker.instances.push(this);
      }

      postMessage(message: unknown): void {
        this.posted.push(message);
        const typed = message as { type?: string };
        if (typed.type === "load")
          queueMicrotask(() => this.emit({ status: "ready" }));
        if (typed.type === "generate")
          queueMicrotask(() => {
            this.emit({ status: "generating", data: "Painting" });
            this.emit({
              status: "image",
              blob: new Blob(["png"], { type: "image/png" }),
            });
          });
      }

      addEventListener(type: string, listener: EventListener): void {
        const bucket = this.listeners.get(type) || new Set<EventListener>();
        bucket.add(listener);
        this.listeners.set(type, bucket);
      }

      removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
      }

      terminate(): void {
        this.listeners.clear();
      }

      private emit(data: unknown): void {
        const event = { data } as MessageEvent;
        this.onmessage?.(event);
        for (const listener of this.listeners.get("message") || [])
          listener(event);
      }
    }
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({}) },
    });
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    const progress: string[] = [];
    try {
      const blob = await generateBrowserIllustration(request, {
        onProgress: (item) => progress.push(item.text),
      });
      expect(blob.type).toBe("image/png");
      expect(progress).toContain("Your free on-device illustration is ready.");
      const posted = FakeWorker.instances[0].posted as Array<{
        type?: string;
        prompt?: string;
      }>;
      expect(posted.map((item) => item.type)).toEqual(["load", "generate"]);
      expect(posted[1].prompt).toContain("tomorrow's storm");
    } finally {
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: originalGpu,
      });
    }
  });
});
