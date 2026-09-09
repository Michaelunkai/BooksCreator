import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const localImagePattern = /^\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/;
const safeImagePattern =
  /^(?:\/media\/[a-f0-9-]{36}\.(?:png|jpg|webp)|\/assets\/tide-illustration\.png)$/;
export function cleanManuscript(
  html: string,
  onUnsupportedImage?: () => void,
): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "hr",
      "a",
      "img",
      "span",
      "div",
      "pre",
      "code",
    ],
    allowedAttributes: {
      "*": ["dir"],
      p: ["style"],
      div: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      span: ["style"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
    },
    allowedStyles: {
      "*": { "text-align": [/^(?:left|right|center|justify)$/] },
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => {
      const unsupported =
        frame.tag === "img" && !safeImagePattern.test(frame.attribs.src || "");
      if (unsupported) onUnsupportedImage?.();
      return unsupported;
    },
  });
}

const id = z.string().min(1).max(128);
const short = z.string().max(1000);
const text = z.string().max(100_000);
const html = z
  .string()
  .max(2_000_000)
  .transform((value, ctx) => {
    let unsupportedImage = false;
    const clean = cleanManuscript(value, () => {
      unsupportedImage = true;
    });
    if (unsupportedImage) {
      ctx.addIssue({
        code: "custom",
        message:
          "This manuscript contains an unsupported image source. Upload the image through the Art studio before adding it to your book; existing saved text has not changed.",
      });
      return z.NEVER;
    }
    return clean;
  });
const timestamp = z.string().datetime({ offset: true });
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
  synopsis: text,
  status: z.enum(["draft", "revised", "final"]),
  versions: z.array(revisionSchema).max(10_000),
});
export const illustrationSchema = z.object({
  id,
  url: z.string().regex(safeImagePattern),
  prompt: z.string().max(40_000),
  style: short,
  caption: short,
  chapterId: id,
  createdAt: timestamp,
  kind: z
    .enum([
      "scene",
      "cover",
      "page",
      "character",
      "setting",
      "opening",
      "vignette",
    ])
    .optional(),
});
export const bookSchema = z
  .object({
    id,
    title: short,
    subtitle: short,
    author: short,
    genre: short,
    language: short,
    direction: z.enum(["auto", "ltr", "rtl"]),
    voiceSample: text,
    voiceNotes: text,
    targetWords: z.number().int().min(0).max(10_000_000),
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
      .max(2000),
    images: z.array(illustrationSchema).max(2000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .superRefine((book, ctx) => {
    for (const [name, items] of [
      ["chapters", book.chapters],
      ["bible", book.bible],
      ["images", book.images],
    ] as const) {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "Identifiers must be unique.",
        });
    }
  });
export const workspaceSchema = z
  .object({
    version: z.literal(1),
    books: z.array(bookSchema).max(100),
    activeBookId: z.string().max(128),
  })
  .superRefine((workspace, ctx) => {
    if (
      new Set(workspace.books.map((book) => book.id)).size !==
      workspace.books.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["books"],
        message: "Book identifiers must be unique.",
      });
    if (
      workspace.books.length
        ? !workspace.books.some((book) => book.id === workspace.activeBookId)
        : workspace.activeBookId !== ""
    )
      ctx.addIssue({
        code: "custom",
        path: ["activeBookId"],
        message: "The active book must belong to this workspace.",
      });
  });
export const envelopeSchema = z.object({
  revision: z.number().int().nonnegative(),
  workspace: workspaceSchema,
});
export const generateSchema = z
  .object({
    book: bookSchema,
    chapterId: id,
    idea: text,
    selection: text,
    mode: z.enum([
      "develop",
      "continue",
      "scene",
      "polish",
      "dialogue",
      "shorten",
      "outline",
      "summary",
    ]),
    length: z.number().finite().positive().max(5000),
    unit: z.enum(["words", "lines", "pages"]),
    voice: short,
    perspective: short,
    tense: short,
    summaryScope: z.enum(["idea", "book", "chapter", "passage"]).optional(),
  })
  .superRefine((request, ctx) => {
    if (
      request.length * { words: 1, lines: 12, pages: 250 }[request.unit] >
      5000
    )
      ctx.addIssue({
        code: "custom",
        path: ["length"],
        message:
          "Choose a length up to 5,000 words (about 417 lines or 20 pages).",
      });
    if (
      !request.book.chapters.some((chapter) => chapter.id === request.chapterId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "Chapter does not belong to this book.",
      });
    if (
      request.mode === "summary" &&
      request.summaryScope === "idea" &&
      !request.idea.trim()
    )
      ctx.addIssue({
        code: "custom",
        path: ["idea"],
        message: "Add an idea before requesting an idea-only summary.",
      });
  });
export const illustrateSchema = z
  .object({
    book: bookSchema,
    chapterId: id,
    excerpt: text,
    direction: z.string().max(8000),
    style: short,
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]),
  })
  .superRefine((request, ctx) => {
    if (
      !request.book.chapters.some((chapter) => chapter.id === request.chapterId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "Chapter does not belong to this book.",
      });
  });

export function validateBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export const providerSchema = z.object({
  provider: z.enum(["openai", "compatible"]),
  baseUrl: z
    .string()
    .max(2000)
    .refine(
      validateBaseUrl,
      "Use an HTTPS endpoint or an HTTP endpoint on localhost.",
    )
    .transform((value) => value.replace(/\/+$/, "")),
  textModel: z.string().trim().min(1).max(200),
  imageModel: z.string().trim().min(1).max(200),
});
export const settingsInputSchema = providerSchema
  .extend({ apiKey: z.string().trim().max(2000).optional() })
  .strict();
