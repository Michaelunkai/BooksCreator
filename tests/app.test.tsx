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
import type { Editor } from "@tiptap/react";
import App from "../src/App";
import {
  createBook,
  createChapter,
  createSeedWorkspace,
} from "../src/lib/seed";
import { BookSettings } from "../src/components/BookPanels";
import { ManuscriptEditor } from "../src/components/ManuscriptEditor";
import type { Workspace } from "../src/types";

let stored: Workspace | null;
let revision: number;
beforeEach(() => {
  stored = createSeedWorkspace();
  revision = 1;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/workspace" && options?.method === "PUT") {
        const input = JSON.parse(options.body as string);
        stored = input.workspace;
        revision++;
        return new Response(JSON.stringify({ revision }), { status: 200 });
      }
      if (url === "/api/workspace")
        return new Response(JSON.stringify({ workspace: stored, revision }), {
          status: 200,
        });
      if (url === "/api/settings")
        return new Response(
          JSON.stringify({
            configured: false,
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
            textModel: "gpt-6-astra",
            imageModel: "gpt-image-2",
          }),
          { status: 200 },
        );
      throw Error(`Unexpected API ${url}`);
    }),
  );
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("integrated writing workspace", () => {
  it("opens the real editor, creates a book and chapter, saves edits and reopens them", async () => {
    const first = render(<App />);
    await screen.findByRole("textbox", { name: "Chapter manuscript" });
    expect(screen.getByRole("textbox", { name: "Chapter title" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "My library" }));
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "A beginning of my own" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create book" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Chapter title") as HTMLInputElement).value,
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add chapter" }));
    fireEvent.change(screen.getByLabelText("Chapter title"), {
      target: { value: "The first door" },
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(
        stored?.books.find((b) => b.title === "A beginning of my own")
          ?.chapters[1].title,
      ).toBe("The first door"),
    );
    first.unmount();
    render(<App />);
    await screen.findByRole("textbox", { name: "Chapter manuscript" });
    fireEvent.click(screen.getByRole("button", { name: "02 The first door" }));
    expect(
      (screen.getByLabelText("Chapter title") as HTMLInputElement).value,
    ).toBe("The first door");
    expect(
      screen.getByLabelText("Chapter manuscript").textContent,
    ).not.toContain("The letter arrived");
  });

  it("keeps chapter work approachable from the desk and exposes the repository link", async () => {
    render(<App />);
    await screen.findByRole("textbox", { name: "Chapter manuscript" });

    const github = screen.getByRole("link", {
      name: "Open Michaelunkai on GitHub",
    });
    expect(github.getAttribute("href")).toBe(
      "https://github.com/Michaelunkai/BooksCreator",
    );
    expect(github.getAttribute("target")).toBe("_blank");

    expect(screen.getByRole("button", { name: "Add chapter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chapter tools" })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Next chapter",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Chapter title") as HTMLInputElement).value,
      ).toBe("A familiar stranger"),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Previous chapter",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Chapter tools" }));
    expect(screen.getByRole("dialog", { name: "Chapter tools" })).toBeTruthy();
    expect(screen.getByLabelText("Chapter plan")).toBeTruthy();
  });

  it("retains manuscripts when switching chapters and restores a named revision", async () => {
    render(<App />);
    await screen.findByRole("textbox", { name: "Chapter manuscript" });
    fireEvent.click(screen.getByRole("button", { name: "Revision history" }));
    fireEvent.change(screen.getByLabelText("Revision name"), {
      target: { value: "Before the edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save a version" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.change(screen.getByLabelText("Chapter title"), {
      target: { value: "Changed title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revision history" }));
    fireEvent.click(screen.getByRole("button", { name: /Before the edit/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" }),
    );
    expect(
      (screen.getByLabelText("Chapter title") as HTMLInputElement).value,
    ).toBe("The letter");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(stored?.books[0].chapters[0].versions[0].title).toBe(
        "Changed title",
      ),
    );
  });
});

describe("editor integrity", () => {
  it("inserts a delayed pasted image at its mapped paste point without replacing a later selection or stealing focus", async () => {
    const book = createBook("Test");
    const chapter = createChapter("Chapter one");
    chapter.content =
      "<p>Original opening words.</p><p>Later selected prose survives.</p>";
    let editor: Editor | null = null;
    let finishUpload!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    render(
      <ManuscriptEditor
        book={book}
        chapter={chapter}
        chapterIndex={0}
        focus={false}
        onFocus={vi.fn()}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onEditor={(value) => {
          editor = value;
        }}
        onHistory={vi.fn()}
        onChapterDetails={vi.fn()}
        onNotice={vi.fn()}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.commands.setTextSelection(1);
    });
    fireEvent.paste(screen.getByLabelText("Chapter manuscript"), {
      clipboardData: {
        files: [new File(["image bytes"], "scene.png", { type: "image/png" })],
        getData: () => "",
        types: ["Files"],
      },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => {
      editor!.commands.insertContentAt(1, "New ");
      editor!.state.doc.descendants((node, position) => {
        if (!node.isText || !node.text?.includes("selected")) return;
        const from = position + node.text.indexOf("selected");
        editor!.commands.setTextSelection({
          from,
          to: from + "selected".length,
        });
      });
      (screen.getByLabelText("Chapter title") as HTMLInputElement).focus();
    });
    const focusedInput = document.activeElement;
    await act(async () => {
      finishUpload(
        new Response(
          JSON.stringify({
            url: "/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png",
          }),
          { status: 201 },
        ),
      );
    });
    await waitFor(() => expect(editor!.getHTML()).toContain("<img"));
    expect(editor!.getText()).toContain("Original opening words.");
    expect(editor!.getText()).toContain("Later selected prose survives.");
    const html = editor!.getHTML();
    expect(html.indexOf("New ")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<img")).toBeLessThan(
      html.indexOf("Original opening words."),
    );
    const { from, to } = editor!.state.selection;
    expect(editor!.state.doc.textBetween(from, to)).toBe("selected");
    expect(document.activeElement).toBe(focusedInput);
  });

  it("cancels a pasted image upload when its chapter editor is destroyed", async () => {
    const book = createBook("Test");
    const chapter = createChapter("Chapter one");
    chapter.content = "<p>The original chapter.</p>";
    const nextChapter = createChapter("Chapter two");
    nextChapter.content = "<p>A different chapter stays untouched.</p>";
    let editor: Editor | null = null;
    let finishUpload!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const onChange = vi.fn();
    const props = {
      book,
      chapterIndex: 0,
      focus: false,
      onFocus: vi.fn(),
      onChange,
      onSelection: vi.fn(),
      onEditor: (value: Editor | null) => {
        editor = value;
      },
      onHistory: vi.fn(),
      onChapterDetails: vi.fn(),
      onNotice: vi.fn(),
    };
    const view = render(
      <ManuscriptEditor key={chapter.id} {...props} chapter={chapter} />,
    );
    await waitFor(() => expect(editor).not.toBeNull());
    fireEvent.paste(screen.getByLabelText("Chapter manuscript"), {
      clipboardData: {
        files: [new File(["image bytes"], "scene.png", { type: "image/png" })],
        getData: () => "",
        types: ["Files"],
      },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const oldEditor = editor!;
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.rerender(
      <ManuscriptEditor
        key={nextChapter.id}
        {...props}
        chapter={nextChapter}
      />,
    );
    await waitFor(() => expect(oldEditor.isDestroyed).toBe(true));
    expect(signal?.aborted).toBe(true);
    onChange.mockClear();
    await act(async () => {
      finishUpload(
        new Response(
          JSON.stringify({
            url: "/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png",
          }),
          { status: 201 },
        ),
      );
    });
    expect(editor!.getText()).toBe("A different chapter stays untouched.");
    expect(editor!.getHTML()).not.toContain("<img");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits literary text with formatting and undo, then restores external content without another mutation", async () => {
    const book = createBook("Test");
    const chapter = createChapter("Chapter one");
    chapter.content = "<p>My first real sentence.</p>";
    let editor: Editor | null = null;
    const onChange = vi.fn();
    const props = {
      book,
      chapter,
      chapterIndex: 0,
      focus: false,
      onFocus: vi.fn(),
      onChange,
      onSelection: vi.fn(),
      onEditor: (value: Editor | null) => {
        editor = value;
      },
      onHistory: vi.fn(),
      onChapterDetails: vi.fn(),
      onNotice: vi.fn(),
    };
    const view = render(<ManuscriptEditor {...props} />);
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.chain().setTextSelection({ from: 1, to: 3 }).toggleBold().run();
    });
    expect(onChange.mock.calls.at(-1)?.[0].content).toContain(
      "<strong>My</strong>",
    );
    act(() => {
      editor!.commands.undo();
    });
    expect(editor!.getText()).toBe("My first real sentence.");
    onChange.mockClear();
    view.rerender(
      <ManuscriptEditor
        {...props}
        chapter={{ ...chapter, content: "<p>Restored words.</p>" }}
      />,
    );
    expect(editor!.getText()).toBe("Restored words.");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("saves only metadata from book settings, never stale manuscript or gallery arrays", () => {
    const book = createBook("Before");
    const onChange = vi.fn();
    render(<BookSettings book={book} onChange={onChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "After" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save book details" }));
    expect(onChange.mock.calls[0][0]).toMatchObject({ title: "After" });
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("chapters");
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("images");
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("id");
  });
});
