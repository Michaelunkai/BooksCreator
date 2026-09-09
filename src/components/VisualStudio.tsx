import {
  ArrowDownToLine,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  MapPin,
  Palette,
  PenLine,
  Sparkles,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  Book,
  Chapter,
  Illustration,
  IllustrationKind,
  IllustrateRequest,
} from "../types";
import { fetchJson } from "../lib/api";
import { assetUrl, isBundledAssetUrl } from "../lib/assetUrl";
import { createLocalIllustration } from "../lib/localIllustration";
import {
  browserIllustratorModelName,
  browserIllustratorPrompt,
  generateBrowserIllustration,
} from "../lib/browserIllustrator";

type VisualKind = Exclude<IllustrationKind, "scene">;
type VisualFilter = "all" | IllustrationKind;

interface VisualPreset {
  value: VisualKind;
  label: string;
  detail: string;
  Icon: LucideIcon;
  size: IllustrateRequest["size"];
}

const visualPresets: VisualPreset[] = [
  {
    value: "cover",
    label: "Book cover",
    detail: "A memorable world to open the book",
    Icon: BookOpen,
    size: "1024x1536",
  },
  {
    value: "page",
    label: "Page art",
    detail: "A scene to live inside the story",
    Icon: ImageIcon,
    size: "1536x1024",
  },
  {
    value: "character",
    label: "Character",
    detail: "A face, presence, or quiet study",
    Icon: UserRound,
    size: "1024x1536",
  },
  {
    value: "setting",
    label: "Setting",
    detail: "A place with its own atmosphere",
    Icon: MapPin,
    size: "1536x1024",
  },
  {
    value: "opening",
    label: "Opening spread",
    detail: "A welcoming first impression",
    Icon: Layers3,
    size: "1536x1024",
  },
  {
    value: "vignette",
    label: "Vignette",
    detail: "A small motif, object, or feeling",
    Icon: Sparkles,
    size: "1024x1024",
  },
];

const visualStyles = [
  "Painterly literary",
  "Watercolor",
  "Pen & ink",
  "Woodcut",
  "Oil painting",
  "Pencil sketch",
  "Children’s illustration",
];

const visualPalettes = [
  "Natural and muted",
  "Coastal dusk",
  "Warm paper and ink",
  "Deep night and candlelight",
  "Moss, stone, and weather",
  "Clear and luminous",
];

const filterOptions: { value: VisualFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "cover", label: "Covers" },
  { value: "page", label: "Page art" },
  { value: "character", label: "Characters" },
  { value: "setting", label: "Settings" },
  { value: "opening", label: "Openings" },
  { value: "vignette", label: "Vignettes" },
  { value: "scene", label: "Chapter art" },
];

const kindLabels: Record<IllustrationKind, string> = {
  scene: "Chapter art",
  cover: "Book cover",
  page: "Page art",
  character: "Character",
  setting: "Setting",
  opening: "Opening spread",
  vignette: "Vignette",
};

function newId(prefix: string): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${prefix}-${Date.now()}`;
}

function selectedKind(image: Illustration): IllustrationKind {
  if (image.kind) return image.kind;
  const value = `${image.style} ${image.caption}`.toLowerCase();
  if (value.includes("cover")) return "cover";
  if (value.includes("character")) return "character";
  if (value.includes("setting")) return "setting";
  if (value.includes("opening")) return "opening";
  if (value.includes("vignette")) return "vignette";
  if (value.includes("page")) return "page";
  return "scene";
}

function defaultBrief(kind: VisualKind, book: Book, chapter: Chapter): string {
  const bookTitle = book.title.trim() || "this book";
  const chapterTitle = chapter.title.trim() || "the current chapter";
  const mood = book.voiceNotes.trim();
  const moodHint = mood ? ` Keep the feeling of: ${mood.slice(0, 260)}.` : "";
  const briefs: Record<VisualKind, string> = {
    cover: `A literary cover image for ${bookTitle}. Find one striking visual metaphor for the book’s world and emotional weather. Leave calm negative space for the title.${moodHint}`,
    page: `A beautiful full-page moment from ${chapterTitle} in ${bookTitle}. Show the concrete place, people, objects, and light that make this scene feel lived in.${moodHint}`,
    character: `A thoughtful character study from ${bookTitle}. Show a person from ${chapterTitle} through posture, expression, clothing, and the world around them rather than a generic portrait.${moodHint}`,
    setting: `A richly observed setting from ${bookTitle}, grounded in the places named or implied by ${chapterTitle}. Let weather, architecture, texture, and light carry the story.${moodHint}`,
    opening: `An inviting opening-spread image for ${bookTitle}, suggesting the first threshold of ${chapterTitle} without explaining the story. Leave generous breathing room for printed pages.${moodHint}`,
    vignette: `A small, elegant story vignette for ${bookTitle}: choose one meaningful object, natural motif, or trace of a moment from ${chapterTitle}.${moodHint}`,
  };
  return briefs[kind];
}

function downloadName(id: string, url: string, kind: IllustrationKind): string {
  const dataType = /^data:image\/(png|jpeg|webp);/i.exec(url)?.[1];
  const pathType = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1];
  const extension = (dataType || pathType || "png").toLowerCase();
  const suffix = kind === "scene" ? "art" : kind;
  return `folio-${suffix}-${id}.${extension === "jpeg" ? "jpg" : extension}`;
}

function coverSubtitle(book: Book): string {
  return book.subtitle.trim() || book.genre.trim() || "A novel by you";
}

interface VisualStudioProps {
  book: Book;
  chapter: Chapter;
  onChange: (images: Illustration[]) => void;
  onInsert: (image: Illustration) => void;
}

export function VisualStudio({
  book,
  chapter,
  onChange,
  onInsert,
}: VisualStudioProps) {
  const [kind, setKind] = useState<VisualKind>("cover");
  const [brief, setBrief] = useState(() =>
    defaultBrief("cover", book, chapter),
  );
  const [style, setStyle] = useState("Painterly literary");
  const [palette, setPalette] = useState("Natural and muted");
  const [size, setSize] = useState<IllustrateRequest["size"]>("1024x1536");
  const [filter, setFilter] = useState<VisualFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentBook = useRef(book);
  const latestOnChange = useRef(onChange);
  const previousScope = useRef(`${book.id}:${chapter.id}`);
  currentBook.current = book;
  latestOnChange.current = onChange;

  useEffect(() => {
    const scope = `${book.id}:${chapter.id}`;
    if (previousScope.current !== scope) {
      request.current?.abort();
      previousScope.current = scope;
      setBrief(defaultBrief(kind, book, chapter));
      setError("");
      setStatus("");
      setSelectedId(null);
    }
  }, [book, chapter, kind]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const selectedPreset =
    visualPresets.find((preset) => preset.value === kind) ?? visualPresets[0];
  const visibleImages = useMemo(
    () =>
      book.images.filter(
        (image) => filter === "all" || selectedKind(image) === filter,
      ),
    [book.images, filter],
  );
  const preview =
    book.images.find((image) => image.id === selectedId) ??
    visibleImages[0] ??
    book.images[0];

  function choosePreset(next: VisualPreset): void {
    setKind(next.value);
    setSize(next.size);
    setBrief(defaultBrief(next.value, book, chapter));
    setError("");
    setStatus("");
  }

  function useChapterContext(): void {
    setBrief(
      `A visual moment from ${chapter.title.trim() || "this chapter"}: ${
        chapter.content
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000) ||
        "Show the place, people, and feeling of this chapter."
      }`,
    );
    setStatus("The current chapter is now part of your creative brief.");
  }

  function useBookMood(): void {
    const notes = book.voiceNotes.trim();
    setBrief(
      `${defaultBrief(kind, book, chapter)}${
        notes
          ? ` Keep the atmosphere close to this book note: ${notes.slice(0, 700)}.`
          : " Keep the atmosphere consistent with the book’s voice, places, and story bible."
      }`,
    );
    setStatus("The book’s voice and atmosphere are now part of your brief.");
  }

  async function generate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !brief.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const bookId = book.id;
    const preset = selectedPreset;
    const body: IllustrateRequest = {
      book,
      chapterId: chapter.id,
      excerpt: brief.trim(),
      direction: [
        `Asset purpose: ${preset.label}.`,
        `Color feeling: ${palette}.`,
        `Composition: ${preset.detail}.`,
        kind === "cover"
          ? "Portrait artwork for a literary cover; reserve calm negative space for typesetting."
          : kind === "opening"
            ? "Wide artwork for an opening spread; leave generous breathing room for printed pages."
            : "Keep the composition intentional, readable, and useful inside a real book.",
        "Do not render words, letters, logos, borders, captions, or watermarks.",
      ].join(" "),
      style,
      size,
    };
    setBusy(true);
    setError("");
    setStatus("Finding the right visual language…");
    try {
      let result: Illustration;
      try {
        const generated = await fetchJson<Illustration>("/api/illustrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        result = {
          ...generated,
          kind,
          style: generated.style || style,
          caption: generated.caption || preset.label,
          chapterId: chapter.id,
        };
      } catch (generationError) {
        const statusCode =
          generationError &&
          typeof generationError === "object" &&
          "status" in generationError
            ? Number((generationError as { status?: unknown }).status)
            : 0;
        if (
          controller.signal.aborted ||
          (statusCode && ![200, 404, 428].includes(statusCode))
        )
          throw generationError;
        try {
          setStatus("Preparing the free on-device art model…");
          const blob = await generateBrowserIllustration(body, {
            signal: controller.signal,
            onProgress: ({ progress, text }) => {
              if (mounted.current)
                setStatus(`${text} ${Math.round(progress * 100)}%`);
            },
          });
          const saved = await fetchJson<{ id: string; url: string }>(
            "/api/images",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataUrl: await blobToDataUrl(blob) }),
              signal: controller.signal,
            },
          );
          result = {
            ...saved,
            kind,
            prompt: browserIllustratorPrompt(body),
            style: `${style} · ${browserIllustratorModelName()}`,
            caption: preset.label,
            chapterId: chapter.id,
            createdAt: new Date().toISOString(),
          };
        } catch (browserError) {
          if (controller.signal.aborted) throw browserError;
          const local = await createLocalIllustration(body);
          const saved = isBundledAssetUrl(local.dataUrl)
            ? { id: newId("local-visual"), url: local.dataUrl }
            : await fetchJson<{ id: string; url: string }>("/api/images", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl: local.dataUrl }),
                signal: controller.signal,
              });
          result = {
            ...saved,
            kind,
            prompt: local.prompt,
            style: `${style} · local study`,
            caption: preset.label,
            chapterId: chapter.id,
            createdAt: new Date().toISOString(),
          };
        }
      }
      if (controller.signal.aborted || currentBook.current.id !== bookId)
        return;
      latestOnChange.current([...currentBook.current.images, result]);
      setSelectedId(result.id);
      setStatus(`${preset.label} ready and saved with your book.`);
    } catch (generationError) {
      if (controller.signal.aborted)
        setStatus("Visual cancelled. Your existing artwork is safe.");
      else
        setError(
          generationError instanceof Error
            ? generationError.message
            : "The visual could not be created.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function updateImage(id: string, patch: Partial<Illustration>): void {
    onChange(
      book.images.map((image) =>
        image.id === id ? { ...image, ...patch, id: image.id } : image,
      ),
    );
  }

  function removeImage(image: Illustration): void {
    const label =
      image.caption || kindLabels[selectedKind(image)].toLowerCase();
    if (
      !window.confirm(
        `Remove “${label}” from this book? The manuscript will stay unchanged.`,
      )
    )
      return;
    onChange(book.images.filter((item) => item.id !== image.id));
    if (selectedId === image.id) setSelectedId(null);
    setStatus("Visual removed from this book. Your manuscript is unchanged.");
  }

  function duplicateImage(image: Illustration): void {
    const copy: Illustration = {
      ...image,
      id: newId("visual-copy"),
      caption: `${image.caption || kindLabels[selectedKind(image)]} copy`,
      createdAt: new Date().toISOString(),
    };
    onChange([...book.images, copy]);
    setSelectedId(copy.id);
    setStatus("A copy is ready to rename or reshape.");
  }

  return (
    <section
      className="visual-studio"
      aria-label="Visual studio"
      dir={book.direction === "auto" ? undefined : book.direction}
    >
      <header className="visual-studio-heading">
        <div>
          <h1>Visual studio</h1>
          <p>Make the book visible, one beautiful detail at a time.</p>
        </div>
        <div
          className="visual-studio-count"
          aria-label={`${book.images.length} saved visuals`}
        >
          <Sparkles size={17} />
          <span>
            <strong>{book.images.length}</strong> saved visual
            {book.images.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="visual-studio-layout">
        <form
          className="visual-brief-panel"
          onSubmit={(event) => void generate(event)}
        >
          <div className="visual-panel-title">
            <span>01</span>
            <div>
              <h2>Start with a creative brief</h2>
              <p>The more concrete the idea, the more personal the result.</p>
            </div>
          </div>
          <label className="field">
            <span>Creative brief</span>
            <textarea
              aria-label="Creative brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={7}
              maxLength={12_000}
              placeholder="Describe the image you want to make, or start with one of Folio’s suggestions…"
            />
            <small className="visual-character-count">
              {brief.length.toLocaleString()} / 12,000
            </small>
          </label>
          <div className="visual-brief-actions">
            <button
              type="button"
              className="companion-text-button"
              onClick={useChapterContext}
            >
              <BookOpen size={14} /> Use this chapter
            </button>
            <button
              type="button"
              className="companion-text-button"
              onClick={useBookMood}
            >
              <Palette size={14} /> Use book mood
            </button>
          </div>

          <div className="visual-panel-title visual-panel-title-spaced">
            <span>02</span>
            <div>
              <h2>Choose what to make</h2>
              <p>Folio will keep the visual tied to this book’s world.</p>
            </div>
          </div>
          <div
            className="visual-preset-grid"
            role="group"
            aria-label="Visual type"
          >
            {visualPresets.map((preset) => {
              const Icon = preset.Icon;
              return (
                <button
                  key={preset.value}
                  type="button"
                  className={`visual-preset ${kind === preset.value ? "selected" : ""}`}
                  aria-pressed={kind === preset.value}
                  onClick={() => choosePreset(preset)}
                >
                  <Icon size={19} />
                  <strong>{preset.label}</strong>
                  <small>{preset.detail}</small>
                  {kind === preset.value && (
                    <Check size={14} className="visual-preset-check" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="visual-panel-title visual-panel-title-spaced">
            <span>03</span>
            <div>
              <h2>Give it a visual language</h2>
              <p>These choices guide the medium, atmosphere, and shape.</p>
            </div>
          </div>
          <div className="visual-control-grid">
            <label className="field">
              <span>Style &amp; medium</span>
              <select
                aria-label="Visual style"
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                {visualStyles.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Color feeling</span>
              <select
                aria-label="Visual palette"
                value={palette}
                onChange={(event) => setPalette(event.target.value)}
              >
                {visualPalettes.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Composition &amp; format</span>
            <select
              aria-label="Visual composition"
              value={size}
              onChange={(event) =>
                setSize(event.target.value as IllustrateRequest["size"])
              }
            >
              <option value="1024x1536">
                Portrait · cover or full-page art
              </option>
              <option value="1536x1024">Landscape · across a spread</option>
              <option value="1024x1024">Square · a quiet vignette</option>
            </select>
          </label>

          <div className="visual-generate-row">
            <button
              className="button primary"
              type="submit"
              disabled={busy || !brief.trim()}
            >
              {busy ? (
                <LoaderCircle size={17} className="spinning" />
              ) : (
                <Sparkles size={17} />
              )}
              {busy ? "Bringing it to life…" : "Create visual"}
            </button>
            {busy && (
              <button
                className="button secondary"
                type="button"
                onClick={() => request.current?.abort()}
              >
                <X size={14} /> Cancel
              </button>
            )}
          </div>
          <p className="visual-local-note">
            <CheckCircle2 size={15} />
            <span>
              Free on-device generation is tried first. If your browser cannot
              run it, Folio keeps a private offline study ready.
            </span>
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="companion-status" role="status">
              {status}
            </p>
          )}
        </form>

        <section className="visual-stage" aria-label="Visual preview">
          <div className="visual-stage-header">
            <div>
              <span>Preview</span>
              <strong>
                {preview
                  ? kindLabels[selectedKind(preview)]
                  : "Your next visual"}
              </strong>
            </div>
            {preview && (
              <span className="visual-stage-number">
                {book.images.findIndex((image) => image.id === preview.id) + 1}{" "}
                / {book.images.length}
              </span>
            )}
          </div>
          <div
            className={`visual-stage-frame ${preview && selectedKind(preview) === "cover" ? "is-cover" : ""}`}
          >
            {preview ? (
              <>
                <img
                  src={preview.url}
                  alt={
                    preview.caption ||
                    `${kindLabels[selectedKind(preview)]} preview`
                  }
                />
                {selectedKind(preview) === "cover" && (
                  <div
                    className="visual-cover-type"
                    aria-label="Cover typography preview"
                  >
                    <span>{book.genre || "A novel"}</span>
                    <strong>{book.title || "Untitled book"}</strong>
                    <small>{coverSubtitle(book)}</small>
                  </div>
                )}
              </>
            ) : (
              <div className="visual-stage-empty">
                <img src={assetUrl("assets/tide-illustration.png")} alt="" />
                <div>
                  <Sparkles size={22} />
                  <strong>Give the next page a face.</strong>
                  <span>
                    Your first visual will appear here for review before you add
                    it to the book.
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="visual-stage-footer">
            <div className="visual-stage-copy">
              <span>{preview ? preview.style : selectedPreset.label}</span>
              <strong>
                {preview?.caption ||
                  "A place for the image your story is asking for"}
              </strong>
              <p>
                {preview
                  ? "Preview the artwork, rename it, or send it into a chapter when it feels right."
                  : "Folio keeps the brief editable, so you can keep shaping the idea before you commit it."}
              </p>
            </div>
            {preview && (
              <div className="visual-stage-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    const previewKind = selectedKind(preview);
                    setBrief(
                      preview.prompt ||
                        defaultBrief(
                          previewKind === "scene" ? "page" : previewKind,
                          book,
                          chapter,
                        ),
                    );
                  }}
                >
                  <PenLine size={15} /> Use this brief
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => onInsert(preview)}
                >
                  <ArrowDownToLine size={15} /> Add to chapter
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <section
        className="visual-library"
        aria-labelledby="saved-visuals-heading"
      >
        <div className="visual-library-heading">
          <div>
            <h2 id="saved-visuals-heading">Saved visuals</h2>
            <p>
              Keep a visual vocabulary for the whole book, not just one scene.
            </p>
          </div>
          <span>{visibleImages.length} shown</span>
        </div>
        <div
          className="visual-filter-row"
          role="group"
          aria-label="Filter saved visuals"
        >
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? "active" : ""}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {visibleImages.length ? (
          <div className="visual-asset-grid">
            {visibleImages.map((image) => {
              const imageKind = selectedKind(image);
              const label = image.caption || kindLabels[imageKind];
              return (
                <article
                  key={image.id}
                  className={`visual-asset-card ${selectedId === image.id ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    className="visual-asset-thumb"
                    onClick={() => setSelectedId(image.id)}
                    aria-label={`Preview ${label}`}
                  >
                    <img src={image.url} alt={label} loading="lazy" />
                    {imageKind === "cover" && (
                      <span className="visual-thumb-title">
                        {book.title || "Untitled book"}
                      </span>
                    )}
                  </button>
                  <div className="visual-asset-body">
                    <div className="visual-asset-meta">
                      <span>{kindLabels[imageKind]}</span>
                      <small>{image.style.split(" · ")[0]}</small>
                    </div>
                    <label className="field">
                      <span className="sr-only">
                        Name for {kindLabels[imageKind]}
                      </span>
                      <input
                        aria-label={`Name for ${label}`}
                        value={image.caption}
                        onChange={(event) =>
                          updateImage(image.id, { caption: event.target.value })
                        }
                        placeholder="Name this visual…"
                        maxLength={500}
                      />
                    </label>
                    <div className="visual-asset-actions">
                      <button
                        type="button"
                        title="Use this visual’s brief"
                        aria-label={`Use ${label} brief`}
                        onClick={() =>
                          setBrief(
                            image.prompt ||
                              defaultBrief(
                                imageKind === "scene" ? "page" : imageKind,
                                book,
                                chapter,
                              ),
                          )
                        }
                      >
                        <PenLine size={15} />
                      </button>
                      <button
                        type="button"
                        title="Duplicate visual"
                        aria-label={`Duplicate ${label}`}
                        onClick={() => duplicateImage(image)}
                      >
                        <Copy size={15} />
                      </button>
                      <a
                        href={image.url}
                        download={downloadName(image.id, image.url, imageKind)}
                        title="Download visual"
                        aria-label={`Download ${label}`}
                      >
                        <Download size={15} />
                      </a>
                      <button
                        type="button"
                        title="Add to chapter"
                        aria-label={`Add ${label} to chapter`}
                        onClick={() => onInsert(image)}
                      >
                        <ArrowDownToLine size={15} />
                      </button>
                      <button
                        type="button"
                        className="visual-asset-delete"
                        title="Remove from book"
                        aria-label={`Remove ${label} from book`}
                        onClick={() => removeImage(image)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            <button
              type="button"
              className="visual-create-another"
              onClick={() =>
                document
                  .querySelector<HTMLTextAreaElement>(
                    'textarea[aria-label="Creative brief"]',
                  )
                  ?.focus()
              }
            >
              <Sparkles size={24} />
              <strong>Create another</strong>
              <span>Bring one more detail to life.</span>
            </button>
          </div>
        ) : (
          <div className="visual-library-empty">
            <div>
              <ImageIcon size={29} />
            </div>
            <h3>
              No{" "}
              {filter === "all" ? "visuals" : kindLabels[filter].toLowerCase()}{" "}
              yet.
            </h3>
            <p>
              Choose a visual type above, make the brief yours, and keep the
              result here with the rest of your book.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("The generated visual could not be read."));
    reader.readAsDataURL(blob);
  });
}
