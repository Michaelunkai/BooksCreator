// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { generateLocal } from "../src/lib/localWriter";
import {
  createLocalIllustration,
  localVisualCues,
} from "../src/lib/localIllustration";
import { createSeedWorkspace } from "../src/lib/seed";
import { wordCount } from "../src/lib/text";

describe("free offline writer", () => {
  it("builds a chapter summary from existing manuscript text", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "",
      selection: "",
      mode: "summary",
      length: 65,
      unit: "words",
      voice: "",
      perspective: "",
      tense: "",
      summaryScope: "chapter",
    });

    expect(result.source).toBe("local");
    expect(result.wordCount).toBe(wordCount(result.text));
    expect(result.text).toContain("letter");
    expect(result.text.split(/(?<=[.!?…])\s+/u).length).toBeGreaterThan(1);
  });

  it("changes summary source and respects requested page length", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "",
      selection: "The photograph was dated last Thursday.",
      mode: "summary",
      length: 1,
      unit: "pages",
      voice: "",
      perspective: "",
      tense: "",
      summaryScope: "passage",
    });

    expect(result.targetWords).toBe(250);
    expect(result.text).toContain("photograph");
    expect(result.wordCount).toBeLessThanOrEqual(250);
  });

  it("summarizes an idea directly when that scope is selected", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
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
    });

    expect(result.text).toContain("lighthouse keeper");
    expect(result.text).not.toContain("letter");
  });

  it("keeps a longer idea summary independent from the current book cast", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "A lighthouse keeper hears tomorrow's storm in an empty room.",
      selection: "",
      mode: "summary",
      length: 65,
      unit: "words",
      voice: "",
      perspective: "",
      tense: "",
      summaryScope: "idea",
    });

    expect(result.text).toContain("lighthouse keeper");
    expect(result.text).not.toContain("Mara Vale");
    expect(result.text).not.toContain("Bellweather");
  });

  it("keeps the shortest summary option to one sentence", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
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
    });

    expect(result.text.split(/(?<=[.!?…])\s+/u).filter(Boolean)).toHaveLength(
      1,
    );
  });

  it("does not substitute chapter text for a blank idea-only summary", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "",
      selection: "",
      mode: "summary",
      length: 65,
      unit: "words",
      voice: "",
      perspective: "",
      tense: "",
      summaryScope: "idea",
    });

    expect(result.text).not.toContain("Mara Vale");
    expect(result.text).not.toContain("Bellweather");
    expect(result.text).not.toContain("letter");
  });

  it("grounds offline prose in the idea and varies its paragraph openings", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "A compass points toward a room that moves while nobody watches.",
      selection: "",
      mode: "develop",
      length: 3,
      unit: "pages",
      voice: "",
      perspective: "",
      tense: "",
    });

    const paragraphs = result.text.split(/\n\n+/u).filter(Boolean);
    expect(result.text).toContain("compass");
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(
      new Set(paragraphs.map((paragraph) => paragraph.split(" ")[0])).size,
    ).toBeGreaterThan(1);
  });

  it("continues from context without copying an existing sentence", () => {
    const workspace = createSeedWorkspace();
    const book = workspace.books[0];
    const chapter = book.chapters[0];
    const existing = "The old door opened once, then never again.";
    const result = generateLocal({
      book,
      chapterId: chapter.id,
      idea: "The house keeps a promise.",
      selection: existing,
      mode: "continue",
      length: 1,
      unit: "words",
      voice: "",
      perspective: "",
      tense: "",
    });

    expect(result.text).not.toContain(existing);
  });

  it("chooses fallback art motifs from the supplied story moment", () => {
    expect(
      localVisualCues(
        "The lighthouse keeper carried a letter through the rain into the forest.",
      ),
    ).toMatchObject({
      water: true,
      forest: true,
      interior: false,
      figure: true,
      object: true,
      weather: true,
    });
  });

  it("carries art direction into the offline illustration study", async () => {
    const book = createSeedWorkspace().books[0];
    const chapter = book.chapters[0];
    const result = await createLocalIllustration({
      book,
      chapterId: chapter.id,
      excerpt: "A house waits beside the sea.",
      direction: "No house; keep the page open and quiet.",
      style: "Pen & ink",
      size: "1024x1024",
    });

    expect(result.prompt).toContain("No house; keep the page open and quiet.");
    expect(result.prompt).toContain("Mara Vale");
    expect(result.prompt).toContain("The impossible photograph");
    expect(result.prompt).toContain("The letter");
  });
});
