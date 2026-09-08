import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Download,
  ImagePlus,
  LoaderCircle,
  Palette,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { Book, Chapter, IllustrateRequest, Illustration } from "../types";
import { fetchJson } from "../lib/api";
import { isBundledAssetUrl } from "../lib/assetUrl";
import { stripHtml as plainText } from "../lib/text";
import { createLocalIllustration } from "../lib/localIllustration";
import {
  browserIllustratorModelName,
  browserIllustratorPrompt,
  generateBrowserIllustration,
} from "../lib/browserIllustrator";
import { Modal } from "./Modal";
import "../companion.css";

interface IllustrationsProps {
  book: Book;
  chapter: Chapter;
  onChange: (images: Illustration[]) => void;
  onInsert: (image: Illustration) => void;
}
const artStyles = [
  {
    value: "Watercolor",
    detail: "Soft washes, quiet atmosphere",
    className: "watercolor",
  },
  {
    value: "Pen & ink",
    detail: "Fine lines, timeless detail",
    className: "ink",
  },
  {
    value: "Woodcut",
    detail: "Bold texture, folklore charm",
    className: "woodcut",
  },
  {
    value: "Oil painting",
    detail: "Rich color, painterly depth",
    className: "oil",
  },
  {
    value: "Pencil sketch",
    detail: "Delicate, intimate marks",
    className: "pencil",
  },
  {
    value: "Children’s illustration",
    detail: "Warm and full of wonder",
    className: "storybook",
  },
];
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("The generated image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function downloadName(id: string, url: string): string {
  const dataType = /^data:image\/(png|jpeg|webp);/i.exec(url)?.[1];
  const pathType = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1];
  const extension = (dataType || pathType || "png").toLowerCase();
  return `folio-${id}.${extension === "jpeg" ? "jpg" : extension}`;
}

export function Illustrations({
  book,
  chapter,
  onChange,
  onInsert,
}: IllustrationsProps) {
  const [excerpt, setExcerpt] = useState(() =>
    plainText(chapter.content).slice(0, 12000),
  );
  const [direction, setDirection] = useState("");
  const [style, setStyle] = useState("Watercolor");
  const [size, setSize] = useState<IllustrateRequest["size"]>("1536x1024");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  const currentBook = useRef(book);
  const latestOnChange = useRef(onChange);
  const previousScope = useRef(`${book.id}:${chapter.id}`);
  currentBook.current = book;
  latestOnChange.current = onChange;
  const preview = book.images.find((image) => image.id === previewId);
  useEffect(() => {
    const scope = `${book.id}:${chapter.id}`;
    if (previousScope.current !== scope) {
      request.current?.abort();
      uploadRequest.current?.abort();
      previousScope.current = scope;
      setExcerpt(plainText(chapter.content).slice(0, 12000));
      setDirection("");
      setError("");
      setStatus("");
      setPreviewId(null);
    }
  }, [book.id, chapter.id, chapter.content]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      uploadRequest.current?.abort();
    };
  }, []);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !excerpt.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const bookId = book.id;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const body: IllustrateRequest = {
        book,
        chapterId: chapter.id,
        excerpt: excerpt.trim(),
        direction,
        style,
        size,
      };
      let result: Illustration;
      try {
        result = await fetchJson<Illustration>("/api/illustrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status?: unknown }).status)
            : 0;
        if (controller.signal.aborted || (status && ![428].includes(status)))
          throw error;
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
            prompt: browserIllustratorPrompt(body),
            style: `${style} · ${browserIllustratorModelName()}`,
            caption: "",
            chapterId: chapter.id,
            createdAt: new Date().toISOString(),
          };
        } catch (browserError) {
          if (controller.signal.aborted) throw browserError;
          // The deterministic study is the final zero-setup path. It remains
          // useful when WebGPU, model downloads, or the local API are absent.
          const local = await createLocalIllustration(body);
          const saved = isBundledAssetUrl(local.dataUrl)
            ? {
                id:
                  typeof globalThis.crypto?.randomUUID === "function"
                    ? globalThis.crypto.randomUUID()
                    : `local-${Date.now()}`,
                url: local.dataUrl,
              }
            : await fetchJson<{ id: string; url: string }>("/api/images", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl: local.dataUrl }),
                signal: controller.signal,
              });
          result = {
            ...saved,
            prompt: local.prompt,
            style: `${style} · local study`,
            caption: "",
            chapterId: chapter.id,
            createdAt: new Date().toISOString(),
          };
        }
      }
      if (controller.signal.aborted || currentBook.current.id !== bookId)
        return;
      latestOnChange.current([...currentBook.current.images, result]);
      setPreviewId(result.id);
      setStatus("Your illustration is ready and has been added to this book.");
    } catch (error) {
      if (controller.signal.aborted)
        setStatus("Illustration cancelled. Your existing artwork is safe.");
      else
        setError(
          error instanceof Error
            ? error.message
            : "The illustration could not be created.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function upload(file?: File) {
    if (!file || uploading) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Please choose an image smaller than 10 MB.");
      return;
    }
    setUploading(true);
    setError("");
    const controller = new AbortController();
    uploadRequest.current = controller;
    const bookId = book.id;
    const chapterId = chapter.id;
    try {
      const dataUrl = await readFile(file);
      if (
        controller.signal.aborted ||
        !mounted.current ||
        currentBook.current.id !== bookId
      )
        return;
      const saved = await fetchJson<{ id: string; url: string }>(
        "/api/images",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
          signal: controller.signal,
        },
      );
      if (
        controller.signal.aborted ||
        !mounted.current ||
        currentBook.current.id !== bookId
      )
        return;
      const image: Illustration = {
        ...saved,
        prompt: "",
        style: "Your artwork",
        caption: file.name.replace(/\.[^.]+$/, ""),
        chapterId,
        createdAt: new Date().toISOString(),
      };
      latestOnChange.current([...currentBook.current.images, image]);
      setStatus("Your artwork has been added to the book.");
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "This image could not be uploaded.",
        );
    } finally {
      if (uploadRequest.current === controller) uploadRequest.current = null;
      if (mounted.current) {
        setUploading(false);
        if (uploadRef.current) uploadRef.current.value = "";
      }
    }
  }
  function updateCaption(id: string, caption: string) {
    onChange(
      book.images.map((image) =>
        image.id === id ? { ...image, caption } : image,
      ),
    );
  }

  return (
    <section
      className="illustrations-workspace"
      aria-label="Book illustrations"
      dir={book.direction === "auto" ? undefined : book.direction}
    >
      <div className="illustrations-heading">
        <div>
          <span className="companion-eyebrow">
            <Palette size={13} /> THE VISUAL STORY
          </span>
          <h1>A world in every page</h1>
          <p>Let your story find its color, texture and light.</p>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() => uploadRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <LoaderCircle className="spinning" size={16} />
          ) : (
            <Upload size={16} />
          )}{" "}
          {uploading ? "Uploading…" : "Add your artwork"}
        </button>
        <input
          ref={uploadRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Upload book artwork"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
      <div className="illustrations-layout">
        <form className="illustration-form" onSubmit={generate}>
          <div className="illustration-section-title">
            <span>01</span>
            <h2>Start with your story</h2>
          </div>
          <label className="field">
            <span>Passage to illustrate</span>
            <textarea
              rows={6}
              value={excerpt}
              onChange={(event) => setExcerpt(event.target.value)}
              maxLength={12000}
              placeholder="Write a scene in your chapter, or describe a moment you would love to see…"
            />
          </label>
          <div className="illustration-excerpt-note">
            <span className="hint">
              From “{chapter.title || "Untitled chapter"}” · editable
            </span>
            <button
              type="button"
              className="companion-text-button"
              onClick={() =>
                setExcerpt(plainText(chapter.content).slice(0, 12000))
              }
            >
              Use current chapter
            </button>
          </div>
          <div className="illustration-section-title">
            <span>02</span>
            <h2>Choose a visual language</h2>
          </div>
          <div
            className="art-style-grid"
            role="group"
            aria-label="Illustration style"
          >
            {artStyles.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`art-style ${style === option.value ? "selected" : ""}`}
                aria-pressed={style === option.value}
                onClick={() => setStyle(option.value)}
              >
                <span
                  className={`art-style-swatch ${option.className}`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 80 42" fill="none">
                    <path
                      d="M3 38 23 17 36 28 49 9 77 38Z"
                      fill="currentColor"
                      opacity=".35"
                    />
                    <path
                      d="M0 38 18 24 28 30 42 13 78 39M23 31l4-3M44 19l6 3"
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                    <circle
                      cx="18"
                      cy="10"
                      r="5"
                      fill="currentColor"
                      opacity=".4"
                    />
                  </svg>
                </span>
                <span className="art-style-name">{option.value}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
          <div className="illustration-section-title">
            <span>03</span>
            <h2>Make it yours</h2>
          </div>
          <label className="field">
            <span>
              Art direction{" "}
              <small className="settings-optional">· optional</small>
            </span>
            <textarea
              rows={3}
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              placeholder="Muted sea greens, a distant house, room for the imagination. No lettering."
              maxLength={4000}
            />
          </label>
          <label className="field">
            <span>Composition</span>
            <select
              value={size}
              onChange={(event) =>
                setSize(event.target.value as IllustrateRequest["size"])
              }
            >
              <option value="1536x1024">Landscape · across the page</option>
              <option value="1024x1536">
                Portrait · a full-page illustration
              </option>
              <option value="1024x1024">Square · a quiet vignette</option>
            </select>
          </label>
          <div className="illustration-generate-row">
            <button
              className="button primary"
              type="submit"
              disabled={busy || !excerpt.trim()}
            >
              {busy ? (
                <LoaderCircle size={17} className="spinning" />
              ) : (
                <Sparkles size={17} />
              )}
              {busy ? "Bringing your scene to life…" : "Create illustration"}
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
          <p className="hint">
            Folio first tries a free on-device art model grounded in this
            passage, then keeps a private local study ready if WebGPU is
            unavailable. A connected image model is optional.
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
        <div className="illustration-gallery">
          <div className="illustration-gallery-title">
            <h2>Your book’s artwork</h2>
            <span>
              {book.images.length}{" "}
              {book.images.length === 1 ? "illustration" : "illustrations"}
            </span>
          </div>
          {book.images.length ? (
            <div className="illustration-cards">
              {book.images.map((image) => (
                <article key={image.id} className="illustration-card">
                  <button
                    type="button"
                    className="illustration-preview-button"
                    onClick={() => setPreviewId(image.id)}
                    aria-label={`Preview ${image.caption || image.style + " illustration"}`}
                  >
                    <img
                      src={image.url}
                      alt={
                        image.caption ||
                        `${image.style} illustration for ${book.title}`
                      }
                      loading="lazy"
                    />
                  </button>
                  <div className="illustration-card-details">
                    <span className="illustration-style-label">
                      {image.style}
                    </span>
                    <label className="field">
                      <span className="sr-only">
                        Caption for {image.style} illustration
                      </span>
                      <input
                        value={image.caption}
                        onChange={(event) =>
                          updateCaption(image.id, event.target.value)
                        }
                        placeholder="Give this moment a caption…"
                        aria-label={`Caption for illustration ${image.id}`}
                        maxLength={500}
                      />
                    </label>
                    <div className="illustration-card-actions">
                      <button
                        type="button"
                        className="companion-text-button"
                        onClick={() => {
                          onInsert(image);
                          setStatus("Illustration added to your manuscript.");
                        }}
                      >
                        <Plus size={15} /> Add to chapter
                      </button>
                      <a
                        href={image.url}
                        download={downloadName(image.id, image.url)}
                        className="illustration-download"
                        aria-label={`Download ${image.caption || "illustration"}`}
                      >
                        <Download size={16} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="illustration-empty">
              <div className="illustration-empty-frame">
                <ImagePlus size={36} strokeWidth={1} />
              </div>
              <h3>Some stories ask to be seen.</h3>
              <p>
                Create an illustration from a passage, or bring in artwork of
                your own. Every image you add will live here with your book.
              </p>
              <span className="illustration-empty-rule" />
            </div>
          )}
        </div>
      </div>
      {preview && (
        <Modal
          title={preview.caption || "Your illustration"}
          onClose={() => setPreviewId(null)}
          wide
        >
          <div className="illustration-modal-content modal-body">
            <img
              src={preview.url}
              alt={preview.caption || `${preview.style} illustration`}
            />
            <label className="field">
              <span>Caption</span>
              <input
                value={preview.caption}
                onChange={(event) =>
                  updateCaption(preview.id, event.target.value)
                }
                maxLength={500}
                placeholder="A few words for this moment…"
              />
            </label>
            <div className="illustration-preview-actions">
              <span className="hint">{preview.style}</span>
              <a
                className="button secondary"
                href={preview.url}
                download={downloadName(preview.id, preview.url)}
              >
                <Download size={15} /> Download
              </a>
              <button
                className="button primary"
                type="button"
                onClick={() => {
                  onInsert(preview);
                  setPreviewId(null);
                }}
              >
                <ArrowDownToLine size={15} /> Add to chapter
              </button>
            </div>
            {preview.prompt && (
              <details className="illustration-prompt">
                <summary>View art direction</summary>
                <p>{preview.prompt}</p>
              </details>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
