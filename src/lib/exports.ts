import type { ImageRun, Paragraph, TextRun, IRunOptions } from "docx";
import { z } from "zod";
import type { Book, Chapter } from "../types";
import { fetchJson } from "./api";
import { escapeHtml, safeImageSource, sanitizeHtml, stripHtml } from "./text";

export type ExportFormat =
  "txt" | "md" | "html" | "docx" | "epub" | "json" | "pdf";
const id = z.string().min(1).max(128);
const short = z.string().max(1000);
const text = z.string().max(100_000);
const timestamp = z.string().datetime({ offset: true });
// Embedded artwork can exceed the server's HTML limit; validate the stripped URL version before uploading.
const html = z
  .string()
  .max(100_000_000)
  .refine(
    (value) =>
      value.replace(
        /data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+/g,
        "/media/00000000-0000-0000-0000-000000000000.png",
      ).length <= 2_000_000,
    "Chapter text exceeds the supported size.",
  );
const revisionSchema = z.object({
  id,
  name: short,
  createdAt: timestamp,
  title: short,
  content: html,
});
const chapterSchema = z.object({
  id,
  title: short,
  content: html,
  synopsis: text.default(""),
  status: z.enum(["draft", "revised", "final"]).default("draft"),
  versions: z.array(revisionSchema).max(10000).default([]),
});
const imageSchema = z.object({
  id,
  url: z.string().max(40_000_000),
  prompt: z.string().max(40_000).default(""),
  style: short.default(""),
  caption: short.default(""),
  chapterId: z.string().max(128).default(""),
  createdAt: timestamp,
});
const bookSchema = z.object({
  id,
  title: short,
  subtitle: short.default(""),
  author: short.default(""),
  genre: short.default("Literary fiction"),
  language: short.default("English"),
  direction: z.enum(["auto", "ltr", "rtl"]).default("auto"),
  voiceSample: text.default(""),
  voiceNotes: text.default(""),
  targetWords: z.number().int().min(0).max(10_000_000).default(60000),
  chapters: z.array(chapterSchema).min(1).max(500),
  bible: z
    .array(
      z.object({
        id,
        kind: z.enum(["character", "place", "plot", "world", "note"]),
        name: short,
        details: text,
      }),
    )
    .max(2000)
    .default([]),
  images: z.array(imageSchema).max(2000).default([]),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const studioImagePattern =
  /^(?:\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)|\/assets\/tide-illustration\.png)$/;

function chapterHtml(book: Book, chapter: Chapter, index: number): string {
  return `<section class="chapter" id="chapter-${index + 1}"><p class="chapter-number">Chapter ${index + 1}</p><h1>${escapeHtml(chapter.title)}</h1>${sanitizeHtml(chapter.content)}</section>`;
}

export function buildHtml(book: Book): string {
  return `<!doctype html><html lang="${escapeHtml(languageCode(book.language))}" dir="${book.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(book.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f2e9;color:#24241f;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.75}main{max-width:760px;margin:auto;padding:80px 60px}.title-page{text-align:center;padding:15vh 0;break-after:page}h1{font-size:2.3em;line-height:1.2;font-weight:normal}h2,h3,h4{line-height:1.35}p{orphans:3;widows:3}.subtitle{font-style:italic;color:#62665b}.chapter{padding-top:48px;break-before:page}.chapter-number{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#747a68}figure{text-align:center;margin:2em 0;break-inside:avoid}img{display:block;max-width:100%;height:auto;margin:1.5em auto;max-height:80vh;object-fit:contain}figcaption,.caption{text-align:center;font-style:italic;font-size:.85em;color:#62665b}blockquote{border-inline-start:2px solid #c1c6b8;padding-inline-start:1.5em;margin-inline:1em}a{color:inherit}@media print{body{background:white;font-size:12pt}main{max-width:none;padding:0}.title-page{padding-top:25vh}.chapter{padding-top:0}img{max-height:8in}@page{size:auto;margin:22mm 20mm}}@media(max-width:600px){main{padding:32px 22px}h1{font-size:2em}}
  </style></head><body><main><header class="title-page"><h1>${escapeHtml(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ""}${book.author ? `<p>${escapeHtml(book.author)}</p>` : ""}</header>${book.chapters.map((chapter, index) => chapterHtml(book, chapter, index)).join("")}</main></body></html>`;
}

function languageCode(language: string): string {
  return (
    {
      english: "en",
      hebrew: "he",
      arabic: "ar",
      french: "fr",
      spanish: "es",
      german: "de",
      italian: "it",
      portuguese: "pt",
      russian: "ru",
      japanese: "ja",
      chinese: "zh",
      korean: "ko",
    }[language.toLowerCase()] ||
    (/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(language) ? language : "en")
  );
}

function mapContentImages(html: string, mapping: Map<string, string>): string {
  const doc = new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
  for (const image of Array.from(doc.images)) {
    const source = image.getAttribute("src") || "";
    if (mapping.has(source)) image.setAttribute("src", mapping.get(source)!);
  }
  return doc.body.innerHTML;
}

function imageSources(book: Book, includeAllArt = true): Set<string> {
  const sources = new Set(
    includeAllArt ? book.images.map((image) => image.url) : [],
  );
  for (const chapter of book.chapters)
    for (const content of [
      chapter.content,
      ...(includeAllArt
        ? chapter.versions.map((version) => version.content)
        : []),
    ]) {
      const doc = new DOMParser().parseFromString(
        sanitizeHtml(content),
        "text/html",
      );
      for (const image of Array.from(doc.images))
        sources.add(image.getAttribute("src") || "");
    }
  return sources;
}

function remapImages(book: Book, mapping: Map<string, string>): Book {
  return {
    ...book,
    images: book.images.map((image) => ({
      ...image,
      url: mapping.get(image.url) || image.url,
    })),
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      content: mapContentImages(chapter.content, mapping),
      versions: chapter.versions.map((version) => ({
        ...version,
        content: mapContentImages(version.content, mapping),
      })),
    })),
  };
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new Error(
          "An illustration could not be read. The export has been stopped to avoid an incomplete backup.",
        ),
      );
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function preparePortableBook(
  book: Book,
  includeAllArt = true,
): Promise<Book> {
  const mapping = new Map<string, string>();
  for (const source of imageSources(book, includeAllArt)) {
    if (!safeImageSource(source))
      throw new Error(
        "An illustration has an unsupported address. Remove or replace it before making a portable backup.",
      );
    if (source.startsWith("data:")) {
      mapping.set(source, source);
      continue;
    }
    const response = await fetch(source);
    if (!response.ok)
      throw new Error(
        `An illustration could not be loaded (${response.status}). Your book was not exported with missing art.`,
      );
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type))
      throw new Error("An illustration is not a supported image file.");
    mapping.set(source, await blobDataUrl(blob));
  }
  return remapImages(book, mapping);
}

export function buildBackup(book: Book): string {
  return JSON.stringify(
    {
      format: "folio-book",
      version: 1,
      exportedAt: new Date().toISOString(),
      book,
    },
    null,
    2,
  );
}

export async function importBook(file: File): Promise<Book> {
  if (file.size > 150 * 1024 * 1024)
    throw new Error(
      "This backup is larger than 150 MB. Please import a smaller book backup.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error(
      "This file is not valid JSON. Choose a Folio book backup (.json).",
    );
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "format" in parsed &&
    ((parsed as { format: unknown }).format !== "folio-book" ||
      (parsed as { version?: unknown }).version !== 1)
  )
    throw new Error("This backup format or version is not supported.");
  const input =
    parsed && typeof parsed === "object" && "book" in parsed
      ? (parsed as { book: unknown }).book
      : parsed;
  const result = bookSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "This file does not contain a valid book. Its chapters or required book fields are missing or invalid.",
    );
  const original = result.data;
  if (
    new Set(original.chapters.map((chapter) => chapter.id)).size !==
    original.chapters.length
  )
    throw new Error(
      "The backup contains duplicate chapter identifiers and cannot be imported safely.",
    );
  const ids = new Map(
    original.chapters.map((chapter) => [chapter.id, crypto.randomUUID()]),
  );
  const mapping = new Map<string, string>();
  // Validate all addresses before performing uploads.
  for (const source of imageSources(original)) {
    if (!(
      studioImagePattern.test(source) ||
      /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(source)
    ))
      throw new Error(
        "The backup contains an unsupported image address. Only embedded PNG, JPEG, WebP or local studio images are allowed.",
      );
    if (source.startsWith("data:") && source.length > 14_000_000)
      throw new Error(
        "An embedded illustration exceeds the 10 MB upload limit. Import a backup with smaller images.",
      );
  }
  const placeholderMap = new Map(
    Array.from(imageSources(original), (source) => [
      source,
      "/media/00000000-0000-0000-0000-000000000000.png",
    ]),
  );
  if (
    new TextEncoder().encode(
      JSON.stringify(remapImages(original, placeholderMap)),
    ).length >
    24 * 1024 * 1024
  )
    throw new Error(
      "This book is too large for the 25 MB library limit. Keep a copy of this backup and reduce its archived snapshots before importing.",
    );
  const uploadedUrls: string[] = [];
  try {
    for (const source of imageSources(original)) {
      if (!source.startsWith("data:")) continue;
      const upload = await fetchJson<{ url: string; id?: string }>(
        "/api/images",
        { method: "POST", body: JSON.stringify({ dataUrl: source }) },
      );
      if (
        !studioImagePattern.test(upload.url) ||
        !upload.url.startsWith("/media/")
      )
        throw new Error(
          "The server did not return a valid saved illustration address.",
        );
      uploadedUrls.push(upload.url);
      mapping.set(source, upload.url);
    }
  } catch (error) {
    // Import is all-or-nothing from the author's point of view. Remove any
    // earlier uploads so a failed backup cannot leave unreferenced media in
    // the studio's data directory.
    await Promise.all(
      uploadedUrls.map((url) =>
        fetchJson(`/api/images${url.slice("/media".length)}`, {
          method: "DELETE",
        }).catch(() => undefined),
      ),
    );
    throw error;
  }
  const restored = remapImages(original, mapping);
  return {
    ...restored,
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    chapters: restored.chapters.map((chapter) => ({
      ...chapter,
      id: ids.get(chapter.id)!,
      versions: chapter.versions.map((version) => ({
        ...version,
        id: crypto.randomUUID(),
      })),
    })),
    bible: restored.bible.map((note) => ({ ...note, id: crypto.randomUUID() })),
    images: restored.images.map((image) => ({
      ...image,
      id: crypto.randomUUID(),
      chapterId: ids.get(image.chapterId) || ids.get(restored.chapters[0].id)!,
    })),
  };
}

function markdownNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeMarkdownText(node.textContent || "");
  if (!(node instanceof HTMLElement)) return "";
  const inner = Array.from(node.childNodes).map(markdownNode).join("");
  switch (node.tagName) {
    case "STRONG":
    case "B":
      return `**${inner}**`;
    case "EM":
    case "I":
      return `*${inner}*`;
    case "S":
      return `~~${inner}~~`;
    case "BR":
      return "  \n";
    case "H1":
    case "H2":
    case "H3":
    case "H4":
      return `${"#".repeat(Number(node.tagName[1]) + 1)} ${inner}\n\n`;
    case "BLOCKQUOTE":
      return `${inner
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "LI":
      return `${node.parentElement?.tagName === "OL" ? `${Array.from(node.parentElement.children).indexOf(node) + 1}.` : "-"} ${inner.trim()}\n`;
    case "IMG":
      return `\n\n![${escapeMarkdownInline(node.getAttribute("alt") || "Illustration")}](${(node.getAttribute("src") || "").replace(/\)/g, "%29")})\n\n`;
    case "A":
      return node.getAttribute("href")
        ? `[${inner}](${(node.getAttribute("href") || "").replace(/\)/g, "%29")})`
        : inner;
    case "HR":
      return "\n\n---\n\n";
    case "P":
    case "UL":
    case "OL":
    case "FIGURE":
    case "FIGCAPTION":
      return `${inner}\n\n`;
    default:
      return inner;
  }
}

function escapeMarkdownInline(value: string): string {
  return escapeMarkdownText(value).replace(/\r?\n/g, " ");
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[`*_<>|]/g, "\\$&")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/(^|\n)(#{1,6}|>|[-+*])(?=\s)/g, "$1\\$2")
    .replace(/(^|\n)(\d+)\.(?=\s)/g, "$1$2\\.");
}

export function buildMarkdown(book: Book): string {
  const html = new DOMParser().parseFromString(buildHtml(book), "text/html");
  html.querySelector(".title-page")?.remove();
  return (
    (
      `# ${escapeMarkdownInline(book.title)}\n\n${book.subtitle ? `${escapeMarkdownInline(book.subtitle)}\n\n` : ""}${book.author ? `${escapeMarkdownInline(book.author)}\n\n` : ""}` +
      Array.from(html.querySelector("main")!.childNodes)
        .map(markdownNode)
        .join("")
    )
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

export function buildText(book: Book): string {
  const html = new DOMParser().parseFromString(buildHtml(book), "text/html");
  for (const image of Array.from(html.images))
    image.replaceWith(
      html.createTextNode(
        `\n[Illustration: ${image.getAttribute("alt") || "Book illustration"}]\n`,
      ),
    );
  return stripHtml(html.querySelector("main")!.innerHTML) + "\n";
}

function dataBytes(source: string): {
  bytes: Uint8Array;
  type: "png" | "jpg" | "gif" | "webp";
} {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([\s\S]+)$/.exec(
    source,
  );
  if (!match) throw new Error("An illustration was not embedded correctly.");
  return {
    bytes: Uint8Array.from(atob(match[2].replace(/\s/g, "")), (character) =>
      character.charCodeAt(0),
    ),
    type: match[1] === "jpeg" ? "jpg" : (match[1] as "png" | "gif" | "webp"),
  };
}

async function docxImage(source: string): Promise<ImageRun> {
  const { ImageRun } = await import("docx");
  const decoded = dataBytes(source);
  const size = await new Promise<{
    width: number;
    height: number;
    png?: string;
  }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const ratio = Math.min(520 / image.width, 650 / image.height, 1);
      if (decoded.type === "webp") {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(
            new Error(
              "This browser cannot convert the WebP illustration for Word. Export HTML or EPUB instead.",
            ),
          );
          return;
        }
        context.drawImage(image, 0, 0);
        resolve({
          width: image.width * ratio,
          height: image.height * ratio,
          png: canvas.toDataURL("image/png"),
        });
      } else
        resolve({ width: image.width * ratio, height: image.height * ratio });
    };
    image.onerror = () =>
      reject(
        new Error(
          "An illustration could not be decoded for the Word document.",
        ),
      );
    image.src = source;
  });
  return new ImageRun({
    data: size.png ? dataBytes(size.png).bytes : decoded.bytes,
    type: size.png ? "png" : (decoded.type as "png" | "jpg" | "gif"),
    transformation: {
      width: Math.round(size.width),
      height: Math.round(size.height),
    },
  });
}

async function docxRuns(
  node: Node,
  options: IRunOptions = {},
): Promise<(TextRun | ImageRun)[]> {
  const { TextRun } = await import("docx");
  if (node.nodeType === Node.TEXT_NODE)
    return [new TextRun({ ...options, text: node.textContent || "" })];
  if (!(node instanceof HTMLElement)) return [];
  if (node.tagName === "IMG")
    return [await docxImage(node.getAttribute("src") || "")];
  if (node.tagName === "BR") return [new TextRun({ break: 1 })];
  const next = {
    ...options,
    ...(["STRONG", "B"].includes(node.tagName) ? { bold: true } : {}),
    ...(["EM", "I"].includes(node.tagName) ? { italics: true } : {}),
    ...(node.tagName === "S" ? { strike: true } : {}),
    ...(node.tagName === "U" ? { underline: {} } : {}),
  };
  return (
    await Promise.all(
      Array.from(node.childNodes).map((child) => docxRuns(child, next)),
    )
  ).flat();
}

export async function buildDocx(book: Book): Promise<Blob> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } =
    await import("docx");
  const children: Paragraph[] = [
    new Paragraph({
      text: book.title,
      heading: HeadingLevel.TITLE,
      alignment: "center",
      bidirectional: book.direction === "rtl",
    }),
  ];
  if (book.subtitle)
    children.push(
      new Paragraph({
        text: book.subtitle,
        alignment: "center",
        bidirectional: book.direction === "rtl",
      }),
    );
  if (book.author)
    children.push(
      new Paragraph({
        text: book.author,
        alignment: "center",
        bidirectional: book.direction === "rtl",
      }),
    );
  for (const chapter of book.chapters) {
    children.push(
      new Paragraph({
        text: chapter.title,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        bidirectional: book.direction === "rtl",
      }),
    );
    const doc = new DOMParser().parseFromString(
      sanitizeHtml(chapter.content),
      "text/html",
    );
    const addBlock = async (element: Element) => {
      if (["UL", "OL", "FIGURE"].includes(element.tagName)) {
        for (const child of Array.from(element.children)) await addBlock(child);
        return;
      }
      const heading = {
        H1: HeadingLevel.HEADING_1,
        H2: HeadingLevel.HEADING_2,
        H3: HeadingLevel.HEADING_3,
        H4: HeadingLevel.HEADING_4,
      }[element.tagName];
      const ordered =
        element.tagName === "LI" && element.parentElement?.tagName === "OL";
      const alignment = (element as HTMLElement).style.textAlign;
      children.push(
        new Paragraph({
          children: [
            ...(ordered
              ? [
                  new TextRun(
                    `${Array.from(element.parentElement!.children).indexOf(element) + 1}. `,
                  ),
                ]
              : []),
            ...(await docxRuns(
              element,
              element.tagName === "FIGCAPTION" ? { italics: true } : {},
            )),
          ],
          heading,
          bullet:
            element.tagName === "LI" && !ordered ? { level: 0 } : undefined,
          bidirectional: book.direction === "rtl",
          alignment:
            alignment === "justify"
              ? "both"
              : ["left", "right", "center"].includes(alignment)
                ? (alignment as "left" | "right" | "center")
                : undefined,
          spacing: { after: 180, line: 360 },
        }),
      );
    };
    for (const node of Array.from(doc.body.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent?.trim();
        if (value)
          children.push(
            new Paragraph({
              children: [new TextRun({ text: value })],
              bidirectional: book.direction === "rtl",
              spacing: { after: 180, line: 360 },
            }),
          );
      } else if (node instanceof Element) await addBlock(node);
    }
  }
  return Packer.toBlob(
    new Document({
      creator: book.author,
      title: book.title,
      description: book.subtitle,
      styles: {
        default: {
          document: {
            run: { font: "Georgia", size: 24 },
            paragraph: { spacing: { line: 360 } },
          },
        },
      },
      sections: [{ children }],
    }),
  );
}

function xhtmlFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const serializer = new XMLSerializer();
  return Array.from(doc.body.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join("");
}

export async function buildEpub(book: Book): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const mapping = new Map<string, string>();
  const imageManifest: string[] = [];
  let imageIndex = 0;
  for (const source of imageSources(book, false)) {
    const { bytes, type } = dataBytes(source);
    const path = `images/art-${++imageIndex}.${type}`;
    mapping.set(source, path);
    zip.file(`OEBPS/${path}`, bytes);
    imageManifest.push(
      `<item id="art-${imageIndex}" href="${path}" media-type="image/${type === "jpg" ? "jpeg" : type}"/>`,
    );
  }
  // Remap after sanitation; relative packaged image paths are intentionally EPUB-only.
  const replaceForEpub = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const image of Array.from(doc.images))
      image.setAttribute(
        "src",
        mapping.get(image.getAttribute("src") || "") || "",
      );
    return doc.body.innerHTML;
  };
  const wrap = (title: string, content: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${languageCode(book.language)}" dir="${book.direction}"><head><title>${escapeHtml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${xhtmlFragment(content)}</body></html>`;
  zip.file(
    "OEBPS/style.css",
    "body{font-family:serif;line-height:1.6;margin:5%}h1{font-weight:normal;line-height:1.2}img{max-width:100%;height:auto}figure{text-align:center;margin:1.5em 0}figcaption,.caption{font-style:italic;text-align:center}.chapter-number{font-size:.8em;letter-spacing:.1em}.title-page{text-align:center;padding-top:20%}",
  );
  zip.file(
    "OEBPS/title.xhtml",
    wrap(
      book.title,
      `<section class="title-page"><h1>${escapeHtml(book.title)}</h1><p>${escapeHtml(book.subtitle)}</p><p>${escapeHtml(book.author)}</p></section>`,
    ),
  );
  const chapters = book.chapters.map((chapter, index) => ({
    title: chapter.title,
    file: `chapter-${index + 1}.xhtml`,
    html: chapterHtml(book, chapter, index),
  }));
  for (const chapter of chapters)
    zip.file(
      `OEBPS/${chapter.file}`,
      wrap(chapter.title, replaceForEpub(chapter.html)),
    );
  zip.file(
    "OEBPS/nav.xhtml",
    wrap(
      "Contents",
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="title.xhtml">${escapeHtml(book.title)}</a></li>${chapters.map((chapter) => `<li><a href="${chapter.file}">${escapeHtml(chapter.title)}</a></li>`).join("")}</ol></nav>`,
    ),
  );
  zip.file(
    "OEBPS/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${escapeHtml(book.id)}</dc:identifier><dc:title>${escapeHtml(book.title)}</dc:title><dc:creator>${escapeHtml(book.author || "Unknown")}</dc:creator><dc:language>${languageCode(book.language)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${chapters.map((chapter, index) => `<item id="ch-${index}" href="${chapter.file}" media-type="application/xhtml+xml"/>`).join("")}${imageManifest.join("")}</manifest><spine${book.direction === "rtl" ? ' page-progression-direction="rtl"' : ""}><itemref idref="title"/>${chapters.map((_, index) => `<itemref idref="ch-${index}"/>`).join("")}</spine></package>`,
  );
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportBook(
  book: Book,
  format: ExportFormat,
): Promise<void> {
  const filename =
    book.title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .trim()
      .slice(0, 120) || "My book";
  if (format === "txt") {
    download(
      new Blob([buildText(book)], { type: "text/plain;charset=utf-8" }),
      `${filename}.txt`,
    );
    return;
  }
  const portable = await preparePortableBook(book, format === "json");
  if (format === "pdf") {
    const iframe = document.createElement("iframe");
    iframe.title = "Book print preview";
    iframe.style.cssText =
      "position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0;";
    document.body.append(iframe);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        fail(
          new Error(
            "The print preview took too long to open. Export HTML and print that file instead.",
          ),
        );
      }, 15_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        iframe.remove();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(
                "The print preview could not be opened. Export HTML and print that file instead.",
              ),
        );
      };
      iframe.onload = async () => {
        try {
          const target = iframe.contentWindow;
          if (!target)
            throw new Error(
              "The print preview could not be opened. Export HTML and print that file instead.",
            );
          await Promise.all(
            Array.from(target.document.images).map((image) =>
              image.complete
                ? Promise.resolve()
                : new Promise<void>((done) => {
                    image.onload = () => done();
                    image.onerror = () => done();
                  }),
            ),
          );
          target.addEventListener(
            "afterprint",
            () => setTimeout(() => iframe.remove(), 1000),
            { once: true },
          );
          target.focus();
          target.print();
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          fail(error);
        }
      };
      iframe.onerror = () =>
        fail(
          new Error(
            "The print preview could not be opened. Export HTML and print that file instead.",
          ),
        );
      iframe.srcdoc = buildHtml(portable);
    });
    return;
  }
  const blob =
    format === "docx"
      ? await buildDocx(portable)
      : format === "epub"
        ? await buildEpub(portable)
        : new Blob(
            [
              format === "json"
                ? buildBackup(portable)
                : format === "md"
                  ? buildMarkdown(portable)
                  : buildHtml(portable),
            ],
            {
              type:
                format === "json"
                  ? "application/json"
                  : format === "md"
                    ? "text/markdown;charset=utf-8"
                    : "text/html;charset=utf-8",
            },
          );
  download(blob, `${filename}.${format}`);
}
