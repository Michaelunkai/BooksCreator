import DOMPurify from "dompurify";

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function safeImageSource(value: string): boolean {
  return (
    (/^\/(?:media|assets)\/[a-zA-Z0-9_./%-]+$/.test(value) &&
      !value.includes("..")) ||
    /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)
  );
}

export function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "ul",
      "ol",
      "li",
      "hr",
      "img",
      "figure",
      "figcaption",
      "a",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "dir", "style"],
    FORBID_ATTR: ["srcset"],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const image of template.content.querySelectorAll("img")) {
    if (!safeImageSource(image.getAttribute("src") || "")) image.remove();
  }
  for (const element of template.content.querySelectorAll("[style]")) {
    const alignment = (element as HTMLElement).style.textAlign;
    element.removeAttribute("style");
    if (["left", "center", "right", "justify"].includes(alignment))
      element.setAttribute("style", `text-align: ${alignment}`);
  }
  for (const anchor of template.content.querySelectorAll("a")) {
    if (!/^(?:https?:\/\/|mailto:)/i.test(anchor.getAttribute("href") || ""))
      anchor.removeAttribute("href");
  }
  return template.innerHTML;
}

export function stripHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|li|blockquote|figcaption)>/gi, "\n\n");
  return (template.content.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wordCount(text: string): number {
  const plain = /<[^>]+>/.test(text) ? stripHtml(text) : text;
  // Segmenter counts words in Hebrew and languages that do not separate every word with a space.
  if ("Segmenter" in Intl) {
    const segmenter = new (
      Intl as unknown as {
        Segmenter: new (
          locale: undefined,
          options: { granularity: string },
        ) => { segment(value: string): Iterable<{ isWordLike?: boolean }> };
      }
    ).Segmenter(undefined, { granularity: "word" });
    return Array.from(segmenter.segment(plain)).filter(
      (segment) => segment.isWordLike,
    ).length;
  }
  return plain.trim().match(/\S+/g)?.length || 0;
}

export function textToHtml(text: string): string {
  return (
    text
      .trim()
      .split(/\n\s*\n/)
      .map(
        (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
      )
      .join("") || "<p></p>"
  );
}
