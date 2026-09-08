// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  browserModelCandidates,
  browserPrompt,
  BrowserModelUnavailableError,
  generateBrowser,
} from "../src/lib/browserWriter";
import { createSeedWorkspace } from "../src/lib/seed";

describe("free on-device writer", () => {
  it("uses the strongest supported Qwen3.5 candidate first", () => {
    expect(browserModelCandidates[0]).toBe("Qwen3.5-9B-q4f32_1-MLC");
    expect(browserModelCandidates).toContain("Qwen3.5-9B-q4f16_1-MLC");
    expect(browserModelCandidates).toContain("Qwen3.5-4B-q4f16_1-MLC");
  });

  it("builds a bounded literary prompt from the book context", () => {
    const book = createSeedWorkspace().books[0];
    const chapter = book.chapters[0];
    const prompt = browserPrompt(
      {
        book,
        chapterId: chapter.id,
        idea: "A vanished bell rings beneath the harbor.",
        selection: "The tide withdrew from the steps.",
        mode: "summary",
        length: 65,
        unit: "words",
        voice: "Lyrical & intimate",
        perspective: "Follow the chapter",
        tense: "Follow the chapter",
        summaryScope: "passage",
      },
      65,
    );
    expect(prompt.system).toContain("literary writing partner");
    expect(prompt.user).toContain("vanished bell");
    expect(prompt.user).toContain("Story bible");
    expect(prompt.user).toContain("Summary material (passage)");
    expect(prompt.user).toContain("The tide withdrew from the steps.");
    expect(prompt.user.length).toBeLessThan(16000);
  });

  it("keeps an idea-only summary focused on the supplied premise", () => {
    const book = createSeedWorkspace().books[0];
    const chapter = book.chapters[0];
    const prompt = browserPrompt(
      {
        book,
        chapterId: chapter.id,
        idea: "A lighthouse keeper hears tomorrow's storm in an empty room.",
        selection: "",
        mode: "summary",
        length: 28,
        unit: "words",
        voice: "",
        perspective: "",
        tense: "",
        summaryScope: "idea",
      },
      28,
    );

    expect(prompt.user).toContain("Summary material (idea)");
    expect(prompt.user).toContain("lighthouse keeper");
    expect(prompt.user).toContain("omitted for an idea-only summary");
    expect(prompt.user).not.toContain("Mara Vale");
    expect(prompt.system).toContain("exactly one grammatical sentence");
    expect(prompt.system).toContain("idea-only summary");
    expect(prompt.system).toContain("Stay close to the requested size");
  });

  it("does not substitute chapter text for a blank idea-only summary", () => {
    const book = createSeedWorkspace().books[0];
    const chapter = book.chapters[0];
    const prompt = browserPrompt(
      {
        book,
        chapterId: chapter.id,
        idea: "",
        selection: "",
        mode: "summary",
        length: 28,
        unit: "words",
        voice: "",
        perspective: "",
        tense: "",
        summaryScope: "idea",
      },
      28,
    );

    expect(prompt.user).not.toContain("Mara Vale");
    expect(prompt.user).not.toContain("The impossible photograph");
    expect(prompt.user).not.toContain("The letter arrived on a Tuesday");
  });

  it("fails closed to the deterministic writer when WebGPU is unavailable", async () => {
    const book = createSeedWorkspace().books[0];
    const chapter = book.chapters[0];
    await expect(
      generateBrowser({
        book,
        chapterId: chapter.id,
        idea: "A small beginning.",
        selection: "",
        mode: "develop",
        length: 1,
        unit: "words",
        voice: "",
        perspective: "",
        tense: "",
      }),
    ).rejects.toBeInstanceOf(BrowserModelUnavailableError);
  });
});
