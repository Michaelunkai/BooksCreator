// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Companion } from "../src/components/Companion";
import { Illustrations } from "../src/components/Illustrations";
import { SettingsDialog } from "../src/components/SettingsDialog";
import { fetchJson } from "../src/lib/api";
import { generateBrowser } from "../src/lib/browserWriter";
import type { Book, Chapter } from "../src/types";

vi.mock("../src/lib/api", () => ({ fetchJson: vi.fn() }));
vi.mock("../src/lib/browserWriter", () => ({
  generateBrowser: vi
    .fn()
    .mockRejectedValue(new Error("Browser model unavailable")),
}));
const fetchMock = vi.mocked(fetchJson);
const browserMock = vi.mocked(generateBrowser);
const chapter: Chapter = {
  id: "chapter-one",
  title: "The letter",
  content: "<p>A letter waited beneath the door.</p>",
  synopsis: "",
  status: "draft",
  versions: [],
};
const secondChapter: Chapter = {
  ...chapter,
  id: "chapter-two",
  title: "The sea",
  content: "<p>The sea remembered.</p>",
};
const book: Book = {
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
  chapters: [chapter, secondChapter],
  bible: [],
  images: [],
  createdAt: "2026-09-08T00:00:00Z",
  updatedAt: "2026-09-08T00:00:00Z",
};
const settings = {
  configured: true,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  textModel: "gpt-6-astra",
  imageModel: "gpt-image-2",
};
const localModelSettings = {
  ...settings,
  configured: false,
  localModelAvailable: true,
  localModelName: "Qwen3.8 27B",
  localModelContext: 8_192,
};

beforeEach(() => {
  fetchMock.mockReset();
  browserMock.mockReset();
  browserMock.mockRejectedValue(new Error("Browser model unavailable"));
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("writing companion", () => {
  it("uses the free offline writer immediately when no key exists", async () => {
    const onSettings = vi.fn();
    const onInsert = vi.fn();
    fetchMock.mockResolvedValueOnce({ configured: false });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={onSettings}
        onInsert={onInsert}
      />,
    );
    expect(
      screen.getByText(/Free writing, summaries and art are ready without setup/i),
    ).toBeTruthy();
    const action = screen.getByRole("button", { name: "Develop this idea" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A lost sailor returns after fifty years." },
    });
    fireEvent.click(action);
    await screen.findByText(/free offline draft is ready/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /connect a larger model/i }),
    );
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("uses an available automatic local model before browser generation", async () => {
    fetchMock.mockResolvedValueOnce(localModelSettings).mockResolvedValueOnce({
      text: "The lantern kept watch.",
      wordCount: 4,
      targetWords: 2,
      incomplete: false,
      source: "local-model",
    });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A lantern keeps watch through the storm." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(/automatic local model draft is ready/i);
    expect(screen.getByText(/Automatic local model/)).toBeTruthy();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/generate");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sizes staged local passes from the model context reported by the server", async () => {
    fetchMock
      .mockResolvedValueOnce(localModelSettings)
      .mockResolvedValueOnce({
        text: "The first local section held its ground.",
        wordCount: 8,
        targetWords: 901,
        incomplete: false,
        source: "local-model",
      })
      .mockResolvedValueOnce({
        text: "The final local section found its natural close.",
        wordCount: 9,
        targetWords: 99,
        incomplete: false,
        source: "local-model",
      });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A lantern keeps watch through the storm." },
    });
    fireEvent.change(screen.getByLabelText("Length unit"), {
      target: { value: "words" },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(/automatic local model draft is ready/i);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(firstBody).toMatchObject({ length: 901, unit: "words" });
    expect(secondBody).toMatchObject({ length: 99, unit: "words" });
  });

  it("falls back when the automatic local model stops after the settings probe", async () => {
    fetchMock
      .mockResolvedValueOnce(localModelSettings)
      .mockRejectedValueOnce(new Error("Loopback model stopped."));
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A lantern keeps watch through the storm." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(/free offline draft is ready/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (
        screen.getByLabelText(
          "Generated draft to review and edit",
        ) as HTMLTextAreaElement
      ).value,
    ).toBeTruthy();
  });

  it("switches to browser-safe sections if the automatic model disappears mid-draft", async () => {
    fetchMock
      .mockResolvedValueOnce(localModelSettings)
      .mockRejectedValueOnce(new Error("Loopback model stopped."));
    browserMock
      .mockResolvedValueOnce({
        text: "The browser kept the first fallback section moving.",
        wordCount: 8,
        targetWords: 600,
        incomplete: false,
        source: "browser",
      })
      .mockResolvedValueOnce({
        text: "The remaining passage found its own quiet ending.",
        wordCount: 8,
        targetWords: 400,
        incomplete: false,
        source: "browser",
      });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A lantern keeps watch through the storm." },
    });
    fireEvent.change(screen.getByLabelText("Length unit"), {
      target: { value: "words" },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(/free on-device draft is ready/i);
    expect(browserMock).toHaveBeenCalledTimes(2);
    expect(browserMock.mock.calls[0][0]).toMatchObject({
      length: 600,
      unit: "words",
    });
    expect(browserMock.mock.calls[1][0]).toMatchObject({
      length: 400,
      unit: "words",
    });
  });

  it("reviews editable output before insertion and prevents replacing a changed selection", async () => {
    const onInsert = vi.fn();
    fetchMock.mockResolvedValueOnce(settings).mockResolvedValueOnce({
      text: "The sea kept its own counsel.",
      wordCount: 6,
      targetWords: 500,
      incomplete: true,
    });
    const props = {
      book,
      chapter,
      selection: "A letter waited",
      onSettings: vi.fn(),
      onInsert,
    };
    const { rerender } = render(<Companion {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Polish the prose" })
        .find((button) => button.getAttribute("type") === "submit")!,
    );
    await screen.findByLabelText("Generated draft to review and edit");
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByText(/returned a partial passage/)).toBeTruthy();
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      selection: "A letter waited",
      chapterId: chapter.id,
      mode: "polish",
      length: 2,
      unit: "pages",
    });
    rerender(<Companion {...props} selection="different words" />);
    expect(
      (
        screen.getByRole("button", {
          name: "Replace selected passage",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByLabelText("Generated draft to review and edit"),
      { target: { value: "I had learned to listen to the sea." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to manuscript" }));
    expect(onInsert).toHaveBeenCalledWith(
      "I had learned to listen to the sea.",
      false,
    );
  });

  it("keeps a separate idea for each chapter", () => {
    const props = {
      book,
      selection: "",
      onSettings: vi.fn(),
      onInsert: vi.fn(),
    };
    const { rerender } = render(<Companion {...props} chapter={chapter} />);
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "The letter bears her own handwriting." },
    });
    rerender(<Companion {...props} chapter={secondChapter} />);
    expect(
      (screen.getByLabelText("Your idea") as HTMLTextAreaElement).value,
    ).toBe("");
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "The sea has gone silent." },
    });
    rerender(<Companion {...props} chapter={chapter} />);
    expect(
      (screen.getByLabelText("Your idea") as HTMLTextAreaElement).value,
    ).toBe("The letter bears her own handwriting.");
  });

  it("recovers an uninserted idea after leaving and reopening the manuscript view", () => {
    const props = {
      book,
      chapter,
      selection: "",
      onSettings: vi.fn(),
      onInsert: vi.fn(),
    };
    const { unmount } = render(<Companion {...props} />);
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "The letter bears her own handwriting." },
    });
    unmount();
    render(<Companion {...props} />);
    expect(
      (screen.getByLabelText("Your idea") as HTMLTextAreaElement).value,
    ).toBe("The letter bears her own handwriting.");
  });

  it("cancels generation without inserting or losing the idea", async () => {
    const onInsert = vi.fn();
    fetchMock
      .mockResolvedValueOnce(settings)
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      );
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={onInsert}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "The sea has gone silent." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText(/Generation cancelled/);
    expect(onInsert).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Your idea") as HTMLTextAreaElement).value,
    ).toBe("The sea has gone silent.");
  });

  it("limits long draft estimates to one hundred thousand words", () => {
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A long journey." },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "401" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Develop this idea",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Choose a length between 1 and 100,000 words/),
    ).toBeTruthy();
  });

  it("builds a few-sentence chapter summary without a provider", async () => {
    const onInsert = vi.fn();
    fetchMock.mockResolvedValueOnce({ configured: false });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={onInsert}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(
      (
        screen.getByRole("button", {
          name: /A few sentences/,
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText("The idea to shape"), {
      target: { value: "A missing letter points to an old promise." },
    });
    fireEvent.click(screen.getByRole("button", { name: /A few sentences/ }));
    expect(
      (screen.getByLabelText("Summary scope") as HTMLSelectElement).value,
    ).toBe("chapter");
    expect(
      screen.getByRole("option", { name: "Your idea or premise" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Build a summary" }));
    await screen.findByText(/free offline draft is ready/i);
    const preview = screen.getByLabelText(
      "Generated draft to review and edit",
    ) as HTMLTextAreaElement;
    expect(preview.value).toContain("missing letter");
    expect(
      preview.value.split(/[.!?]+/).filter(Boolean).length,
    ).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("starts a summary on the selected passage when one is available", () => {
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection="A letter waited beneath the door."
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(
      (screen.getByLabelText("Summary scope") as HTMLSelectElement).value,
    ).toBe("passage");
    expect(
      (
        screen.getByRole("button", {
          name: /A few sentences/,
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("requires an idea before running an idea-only summary", () => {
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    fireEvent.change(screen.getByLabelText("Summary scope"), {
      target: { value: "idea" },
    });

    expect(
      screen.getByText(/Add an idea to build an idea-only summary/i),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Build a summary" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("builds a longer draft in bounded parts using the original chapter and received prose as context", async () => {
    const onInsert = vi.fn();
    fetchMock
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({
        text: "The letter led her down to the sea.",
        wordCount: 9,
        targetWords: 5000,
        incomplete: false,
      })
      .mockResolvedValueOnce({
        text: "Beyond the harbor, a window filled with light.",
        wordCount: 8,
        targetWords: 1000,
        incomplete: false,
      });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={onInsert}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A letter from the vanished house." },
    });
    fireEvent.change(screen.getByLabelText("Length unit"), {
      target: { value: "words" },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "6000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(
      "Your draft is ready. Read it, edit it, make it yours.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const first = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(first).toMatchObject({
      mode: "develop",
      length: 5000,
      unit: "words",
    });
    expect(second).toMatchObject({
      mode: "continue",
      length: 1000,
      unit: "words",
      selection: "",
    });
    expect(second.book.chapters[0].content).toContain(chapter.content);
    expect(second.book.chapters[0].content).toContain(
      "The letter led her down to the sea.",
    );
    expect(second.idea).toContain("A letter from the vanished house.");
    expect(second.idea).toContain("section 2 of 2");
    expect(
      (
        screen.getByLabelText(
          "Generated draft to review and edit",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(
      "The letter led her down to the sea.\n\nBeyond the harbor, a window filled with light.",
    );
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("keeps the first received section when a later long-draft request is cancelled", async () => {
    fetchMock
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({
        text: "The letter led her down to the sea.",
        wordCount: 9,
        targetWords: 5000,
        incomplete: false,
      })
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      );
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A letter from the vanished house." },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Writing section 2 of 2…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText(/Generation cancelled. 1 of 2 sections are kept/);
    const preview = screen.getByLabelText(
      "Generated draft to review and edit",
    ) as HTMLTextAreaElement;
    expect(preview.value).toBe("The letter led her down to the sea.");
    expect(preview.readOnly).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Add to manuscript",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retains received sections after an error without retrying a failed provider request", async () => {
    fetchMock
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({
        text: "A light burned beyond the harbor.",
        wordCount: 6,
        targetWords: 5000,
        incomplete: false,
      })
      .mockRejectedValueOnce(new Error("Provider quota reached."));
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A journey to the vanished house." },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText("Provider quota reached.");
    expect(
      (
        screen.getByLabelText(
          "Generated draft to review and edit",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("A light burned beyond the harbor.");
    expect(
      screen.getByText(/no request will be retried automatically/),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops a staged draft immediately when a provider returns a partial passage", async () => {
    fetchMock.mockResolvedValueOnce(settings).mockResolvedValueOnce({
      text: "The harbor was empty, except",
      wordCount: 5,
      targetWords: 5000,
      incomplete: true,
    });
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your idea"), {
      target: { value: "A journey to the vanished house." },
    });
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Develop this idea" }));
    await screen.findByText(/Generation has stopped so you can review it/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (
        screen.getByLabelText(
          "Generated draft to review and edit",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("The harbor was empty, except");
  });

  it("explains the smaller passage limit for refinement", () => {
    render(
      <Companion
        book={book}
        chapter={chapter}
        selection=""
        onSettings={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    fireEvent.change(screen.getByLabelText("Desired length"), {
      target: { value: "24" },
    });
    expect(
      screen.getByText(/Refine works on one passage at a time/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Choose a length between 1 and 5,000 words/),
    ).toBeTruthy();
    expect(
      (
        screen
          .getAllByRole("button", { name: "Polish the prose" })
          .find(
            (button) => button.getAttribute("type") === "submit",
          ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("illustration workspace", () => {
  it("grounds the request in editable chapter text and keeps the returned artwork", async () => {
    const onChange = vi.fn();
    const result = {
      id: "picture-one",
      url: "/media/picture-one.png",
      prompt: "A letter beneath a door",
      style: "Pen & ink",
      caption: "",
      chapterId: chapter.id,
      createdAt: book.createdAt,
    };
    fetchMock.mockResolvedValueOnce(result);
    render(
      <Illustrations
        book={book}
        chapter={chapter}
        onChange={onChange}
        onInsert={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("Passage to illustrate") as HTMLTextAreaElement)
        .value,
    ).toBe("A letter waited beneath the door.");
    fireEvent.click(screen.getByRole("button", { name: /Pen & ink/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create illustration" }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([result]));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      chapterId: chapter.id,
      excerpt: "A letter waited beneath the door.",
      style: "Pen & ink",
      size: "1536x1024",
    });
  });

  it("creates a free local art study when no image provider is configured", async () => {
    const onChange = vi.fn();
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("No provider configured"), { status: 428 }),
    );
    render(
      <Illustrations
        book={book}
        chapter={chapter}
        onChange={onChange}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create illustration" }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const [image] = onChange.mock.calls[0][0];
    expect(image.url).toBe("/assets/tide-illustration.png");
    expect(image.style).toContain("local study");
    expect(image.prompt).toContain("local art study");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the artwork format in download filenames", () => {
    const image = {
      id: "webp-art",
      url: "/media/webp-art.webp",
      prompt: "A quiet shore",
      style: "Watercolor",
      caption: "WebP art",
      chapterId: chapter.id,
      createdAt: book.createdAt,
    };
    render(
      <Illustrations
        book={{ ...book, images: [image] }}
        chapter={chapter}
        onChange={vi.fn()}
        onInsert={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Download WebP art").getAttribute("download"),
    ).toBe("folio-webp-art.webp");
  });

  it("rejects unsupported uploads before sending them", async () => {
    render(
      <Illustrations
        book={book}
        chapter={chapter}
        onChange={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Upload book artwork"), {
      target: {
        files: [new File(["<svg/>"], "art.svg", { type: "image/svg+xml" })],
      },
    });
    await screen.findByText("Choose a PNG, JPEG or WebP image.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores an upload that resolves after the illustration view has unmounted", async () => {
    const onChange = vi.fn();
    let finishUpload: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const { unmount } = render(
      <Illustrations
        book={book}
        chapter={chapter}
        onChange={onChange}
        onInsert={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Upload book artwork"), {
      target: {
        files: [new File(["png-image"], "scene.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finishUpload({ id: "late-image", url: "/media/late-image.png" });
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("provider settings", () => {
  it("saves a supplied key then clears the secret input", async () => {
    fetchMock
      .mockResolvedValueOnce({ ...settings, configured: false })
      .mockResolvedValueOnce(settings);
    render(<SettingsDialog onClose={vi.fn()} />);
    const key = await screen.findByLabelText("API key");
    fireEvent.change(key, { target: { value: "test-secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await screen.findByText("Settings saved");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      apiKey: "test-secret-key",
      provider: "openai",
    });
    expect((key as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("test-secret-key")).toBeNull();
  });
});
