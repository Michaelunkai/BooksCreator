// @vitest-environment jsdom
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBackup,
  buildDocx,
  buildEpub,
  buildHtml,
  buildMarkdown,
  buildText,
  importBook,
  preparePortableBook,
} from "../src/lib/exports";
import { createBook, createSeedWorkspace } from "../src/lib/seed";
import {
  sanitizeHtml,
  stripHtml,
  textToHtml,
  wordCount,
} from "../src/lib/text";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=";
function backupFile(value: unknown): File {
  const file = new File([JSON.stringify(value)], "book.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(JSON.stringify(value)),
  });
  return file;
}
async function bytes(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("manuscript text and sanitation", () => {
  it("counts text rather than markup and supports Hebrew and CJK", () => {
    expect(wordCount("<p>A quiet <strong>sea</strong>.</p>")).toBe(3);
    expect(wordCount("שלום עולם")).toBe(2);
    expect(wordCount("你好世界")).toBeGreaterThan(1);
    expect(wordCount("   ")).toBe(0);
    expect(stripHtml("<p>First &amp; second.</p><p>Third.</p>")).toBe(
      "First & second.\n\nThird.",
    );
  });

  it("rejects executable content, remote trackers, SVGs and CSS while preserving literary formatting", () => {
    const clean = sanitizeHtml(
      '<h2>Title</h2><p style="text-align: right; background:url(https://evil.test/x)"><strong>Text</strong><script>alert(1)</script><img src="/media/book.png" onerror="alert(1)"><img src="https://evil.test/track"><img src="data:image/svg+xml;base64,WA=="><a href="javascript:alert(1)">link</a></p>',
    );
    expect(clean).toContain("<h2>Title</h2>");
    expect(clean).toContain("text-align: right");
    expect(clean).toContain("/media/book.png");
    for (const fragment of [
      "script",
      "onerror",
      "evil.test",
      "svg",
      "javascript",
      "background",
    ])
      expect(clean).not.toContain(fragment);
    expect(textToHtml("<script>alert(1)</script>\n\nHello")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>Hello</p>",
    );
  });

  it("starts new books blank and gives the sample an original literary opening and useful notes", () => {
    expect(stripHtml(createBook().chapters[0].content)).toBe("");
    const sample = createSeedWorkspace().books[0];
    expect(stripHtml(sample.chapters[0].content)).toMatch(
      /^The letter arrived on a Tuesday, which seemed an ordinary sort of day for a life to come undone\./,
    );
    expect(wordCount(sample.chapters[0].content)).toBeGreaterThanOrEqual(250);
    expect(wordCount(sample.chapters[0].content)).toBeLessThanOrEqual(330);
    expect(sample.bible.length).toBeGreaterThanOrEqual(4);
  });
});

describe("book export and import", () => {
  it("preserves headings, emphasis, Hebrew, image captions and safe titles across reading formats", () => {
    const book = createBook("A <quiet> sea");
    book.chapters[0].title = "The arrival";
    book.chapters[0].content =
      '<h2>A beginning</h2><p><strong>שלום</strong> <em>world</em>.</p><figure><img src="' +
      pixel +
      '" alt="Low tide"><figcaption>Low tide</figcaption></figure>';
    book.images = [
      {
        id: "art",
        url: pixel,
        prompt: "",
        style: "Etching",
        caption: "Low tide",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
    ];
    const html = buildHtml(book);
    expect(html).toContain("A &lt;quiet&gt; sea");
    expect(html).toContain("<figcaption>Low tide</figcaption>");
    expect(html).toContain("<strong>שלום</strong>");
    expect(buildMarkdown(book)).toContain("**שלום** *world*");
    expect(buildMarkdown(book)).toContain("## The arrival");
    expect(buildText(book)).toContain("שלום world.");
    expect(buildText(book)).toContain("[Illustration: Low tide]");
  });

  it("escapes Markdown metadata and prose control characters", () => {
    const book = createBook("# [A title]");
    book.subtitle = "A *subtitle* with <angle> markers";
    book.chapters[0].content = "<p># not a heading | still prose</p>";
    const markdown = buildMarkdown(book);

    expect(markdown).toContain("# \\# \\[A title\\]");
    expect(markdown).toContain("A \\*subtitle\\* with \\<angle\\> markers");
    expect(markdown).toContain("\\# not a heading \\| still prose");
  });

  it("exports only manuscript-inserted artwork and keeps its caption exactly once", () => {
    const book = createBook("Chosen art");
    book.chapters[0].content =
      '<p>A story.</p><img src="' +
      pixel +
      '" alt="Chosen image"><p><em>A chosen caption</em></p>';
    book.images = [
      {
        id: "chosen",
        url: pixel,
        prompt: "",
        style: "",
        caption: "A chosen caption",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
      {
        id: "unused",
        url: "/media/00000000-0000-0000-0000-000000000099.png",
        prompt: "",
        style: "",
        caption: "Rejected art",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
    ];
    const html = buildHtml(book);
    expect((html.match(/A chosen caption/g) || []).length).toBe(1);
    expect(html).not.toContain("Rejected art");
    expect(html).not.toContain("000000000099");
    expect(JSON.parse(buildBackup(book)).book.images).toHaveLength(2);
  });

  it("embeds gallery, inline and revision images and restores them with fresh identifiers", async () => {
    const book = createBook("Portable");
    book.chapters[0].content =
      '<p>Keep this.</p><img src="/media/00000000-0000-0000-0000-000000000001.png">';
    book.chapters[0].versions = [
      {
        id: "version-old",
        name: "Before",
        createdAt: new Date().toISOString(),
        title: "Before",
        content:
          '<p>Earlier.</p><img src="/media/00000000-0000-0000-0000-000000000001.png">',
      },
    ];
    book.images = [
      {
        id: "art-old",
        url: "/media/00000000-0000-0000-0000-000000000002.png",
        caption: "The bay",
        prompt: "",
        style: "",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
    ];
    const fetch = vi.fn((_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                id: "uploaded",
                url: "/media/00000000-0000-0000-0000-000000000003.png",
              }),
            ),
          )
        : Promise.resolve({
            ok: true,
            blob: async () =>
              new Blob([new Uint8Array([137, 80, 78, 71])], {
                type: "image/png",
              }),
          }),
    );
    vi.stubGlobal("fetch", fetch);
    const portable = await preparePortableBook(book);
    expect(portable.images[0].url).toMatch(/^data:image\/png;base64,/);
    expect(portable.chapters[0].content).toContain("data:image/png;base64,");
    expect(portable.chapters[0].versions[0].content).toContain(
      "data:image/png;base64,",
    );
    const restored = await importBook(
      backupFile(JSON.parse(buildBackup(portable))),
    );
    expect(restored.id).not.toBe(book.id);
    expect(restored.chapters[0].id).not.toBe(book.chapters[0].id);
    expect(restored.images[0].chapterId).toBe(restored.chapters[0].id);
    expect(restored.images[0].url).toBe(
      "/media/00000000-0000-0000-0000-000000000003.png",
    );
    expect(restored.chapters[0].versions[0].id).not.toBe("version-old");
    expect(restored.chapters[0].content).toContain(
      "/media/00000000-0000-0000-0000-000000000003.png",
    );
    expect(
      fetch.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
  });

  it("cleans up earlier image uploads when a backup import fails", async () => {
    const book = createBook("Transactional import");
    const secondPixel = pixel.replace("iVBORw0KGgo", "iVBORw0KGgA");
    book.images = [
      {
        id: "art-one",
        url: pixel,
        caption: "One",
        prompt: "",
        style: "",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
      {
        id: "art-two",
        url: secondPixel,
        caption: "Two",
        prompt: "",
        style: "",
        chapterId: book.chapters[0].id,
        createdAt: new Date().toISOString(),
      },
    ];
    let uploads = 0;
    const fetch = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === "DELETE")
        return Promise.resolve(new Response(null, { status: 204 }));
      uploads += 1;
      if (uploads === 1)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "uploaded-one",
              url: "/media/00000000-0000-0000-0000-000000000005.png",
            }),
          ),
        );
      return Promise.reject(new Error("disk full"));
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      importBook(backupFile(JSON.parse(buildBackup(book)))),
    ).rejects.toThrow("Cannot reach the writing studio server");
    expect(
      fetch.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("validates imports before upload and sanitizes every current and archived chapter", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(importBook(backupFile({ title: "Broken" }))).rejects.toThrow(
      "valid book",
    );
    const book = createBook();
    book.chapters.push({ ...book.chapters[0] });
    await expect(importBook(backupFile(book))).rejects.toThrow(
      "duplicate chapter",
    );
    expect(fetch).not.toHaveBeenCalled();
    book.chapters.pop();
    book.chapters[0].content = "<p>Hello<script>alert(1)</script></p>";
    book.chapters[0].versions = [
      {
        id: "old",
        name: "Before",
        createdAt: new Date().toISOString(),
        title: "",
        content:
          '<img src="/media/00000000-0000-0000-0000-000000000004.png" onerror="alert(1)">',
      },
    ];
    const restored = await importBook(backupFile(book));
    expect(restored.chapters[0].content).toBe("<p>Hello</p>");
    expect(restored.chapters[0].versions[0].content).not.toContain("onerror");
  });

  it("produces a Word package with real text, hierarchy and emphasis", async () => {
    const book = createBook("My manuscript");
    book.author = "An Author";
    book.chapters[0].title = "The shore";
    book.chapters[0].content =
      "<h2>Morning</h2><p>It was <strong>quiet</strong>.</p>";
    const zip = await JSZip.loadAsync(await bytes(await buildDocx(book)));
    const document = await zip.file("word/document.xml")!.async("string");
    expect(document).toContain("The shore");
    expect(document).toContain("Morning");
    expect(document).toContain("quiet");
    expect(document).toContain("<w:b/>");
    expect(document).toContain("Heading2");
    expect(document).toContain("w:pageBreakBefore");
  });

  it("keeps top-level chapter text when building Word output", async () => {
    const book = createBook("Loose text");
    book.chapters[0].content =
      "A sentence outside a paragraph.<p>A paragraph follows.</p>";
    const zip = await JSZip.loadAsync(await bytes(await buildDocx(book)));
    const document = await zip.file("word/document.xml")!.async("string");

    expect(document).toContain("A sentence outside a paragraph.");
    expect(document).toContain("A paragraph follows.");
  });

  it("marks title-page metadata and manuscript paragraphs as bidirectional in RTL Word output", async () => {
    const book = createBook("كتاب");
    book.direction = "rtl";
    book.subtitle = "عنوان فرعي";
    book.author = "كاتب";
    book.chapters[0].title = "الفصل الأول";
    book.chapters[0].content = "<p>بداية الحكاية.</p>";
    const zip = await JSZip.loadAsync(await bytes(await buildDocx(book)));
    const document = await zip.file("word/document.xml")!.async("string");

    expect(document.match(/<w:bidi\/>/g)).toHaveLength(5);
  });

  it("produces an EPUB with valid XML, navigation, reading order and packaged illustrations", async () => {
    const book = createBook("A book & a sea");
    book.direction = "rtl";
    book.language = "Hebrew";
    book.chapters[0].content =
      '<p>שלום &amp; hello.</p><img src="' + pixel + '">';
    const zip = await JSZip.loadAsync(await bytes(await buildEpub(book)));
    expect(await zip.file("mimetype")!.async("string")).toBe(
      "application/epub+zip",
    );
    const opf = await zip.file("OEBPS/package.opf")!.async("string");
    expect(opf).toContain('page-progression-direction="rtl"');
    expect(opf).toContain("<dc:language>he</dc:language>");
    expect(opf).toContain("image/png");
    const chapter = await zip.file("OEBPS/chapter-1.xhtml")!.async("string");
    expect(chapter).toContain("images/art-1.png");
    expect(chapter).toContain("שלום &amp; hello.");
    for (const name of Object.keys(zip.files).filter((name) =>
      /\.(?:xml|opf|xhtml)$/.test(name),
    )) {
      const parsed = new DOMParser().parseFromString(
        await zip.file(name)!.async("string"),
        "application/xml",
      );
      expect(parsed.querySelector("parsererror"), name).toBeNull();
    }
    expect(zip.file("OEBPS/images/art-1.png")).not.toBeNull();
  });
});
