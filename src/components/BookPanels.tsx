import { useState, type ChangeEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Download,
  FilePlus2,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
  MapPin,
  Route,
  Globe2,
  StickyNote,
  Check,
} from "lucide-react";
import type { Book, Chapter, StoryNote } from "../types";
import { Modal } from "./Modal";
import { wordCount, stripHtml, sanitizeHtml } from "../lib/text";
import { exportBook, importBook } from "../lib/exports";
import { createBook } from "../lib/seed";

export function Library({
  books,
  activeId,
  onOpen,
  onCreate,
  onClose,
  recoveryCopies = [],
  onRecover,
}: {
  books: Book[];
  activeId: string;
  onOpen: (id: string) => void;
  onCreate: (book: Book) => void;
  onClose: () => void;
  recoveryCopies?: { key: string; title: string; updatedAt: string }[];
  onRecover?: (key: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onCreate(await importBook(file));
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not import this book.",
      );
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <Modal title="My library" onClose={onClose} wide>
      <div className="modal-body">
        <p className="intro-text">A home for every story you want to tell.</p>
        <div className="library-tools">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search books"
              placeholder="Find a book…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="button secondary upload-button">
            <Upload size={16} />
            {busy ? "Importing…" : "Import backup"}
            <input
              type="file"
              accept=".json,application/json"
              onChange={upload}
              disabled={busy}
            />
          </label>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="library-list">
          {books
            .filter((b) =>
              `${b.title} ${b.author}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((book) => (
              <button
                className={`library-book ${book.id === activeId ? "selected" : ""}`}
                key={book.id}
                onClick={() => {
                  onOpen(book.id);
                  onClose();
                }}
              >
                <div className="book-spine">
                  <BookOpen size={25} />
                </div>
                <div>
                  <h3>{book.title || "Untitled book"}</h3>
                  <p>
                    {book.author || "A novel by you"} · {book.chapters.length}{" "}
                    chapters ·{" "}
                    {book.chapters
                      .reduce((sum, c) => sum + wordCount(c.content), 0)
                      .toLocaleString()}{" "}
                    words
                  </p>
                  {book.id === "sample-book" && (
                    <small>
                      Editable sample · Create a book below for your own story
                    </small>
                  )}
                </div>
                {book.id === activeId && <Check size={18} />}
              </button>
            ))}
        </div>
        <div className="recovery-library">
          {recoveryCopies.length > 0 && (
            <>
              <h3>Recoverable drafts</h3>
              <p className="hint">
                Unsaved work from another session. Recovering creates separate
                books and preserves your saved library.
              </p>
              {recoveryCopies.map((copy) => (
                <div className="recovery-library-row" key={copy.key}>
                  <span>
                    <strong>{copy.title}</strong>
                    <small>{new Date(copy.updatedAt).toLocaleString()}</small>
                  </span>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onRecover?.(copy.key);
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Recover as copies
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        <form
          className="new-book-form"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate(createBook(title.trim() || "Untitled book"));
            onClose();
          }}
        >
          <h3>Begin a new story</h3>
          <label className="field">
            Book title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A title, or just a working idea"
              maxLength={200}
            />
          </label>
          <button className="button primary">
            <FilePlus2 size={16} />
            Create book
          </button>
        </form>
      </div>
    </Modal>
  );
}

export function BookSettings({
  book,
  onChange,
  onClose,
  onDelete,
}: {
  book: Book;
  onChange: (patch: Partial<Book>) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(book);
  return (
    <Modal title="Your book & your voice" onClose={onClose} wide>
      <form
        className="modal-body settings-form"
        dir={draft.direction === "auto" ? undefined : draft.direction}
        onSubmit={(e) => {
          e.preventDefault();
          onChange({
            title: draft.title,
            subtitle: draft.subtitle,
            author: draft.author,
            genre: draft.genre,
            language: draft.language,
            direction: draft.direction,
            targetWords: draft.targetWords,
            voiceSample: draft.voiceSample,
            voiceNotes: draft.voiceNotes,
          });
          onClose();
        }}
      >
        <p className="intro-text">
          Give your writing companion a sense of the book only you could write.
        </p>
        <div className="field-row">
          <label className="field">
            Book title
            <input
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={200}
            />
          </label>
          <label className="field">
            Author
            <input
              value={draft.author}
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
              maxLength={200}
              placeholder="Your name or pen name"
            />
          </label>
        </div>
        <label className="field">
          Subtitle
          <input
            value={draft.subtitle}
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
            maxLength={300}
          />
        </label>
        <div className="field-row">
          <label className="field">
            Genre
            <input
              list="book-genres"
              value={draft.genre}
              onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
            />
            <datalist id="book-genres">
              {[
                "Literary fiction",
                "Fantasy",
                "Romance",
                "Mystery",
                "Memoir",
                "Children’s fiction",
                "Nonfiction",
                "Poetry",
              ].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </datalist>
          </label>
          <label className="field">
            Writing language
            <input
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
              placeholder="English, Hebrew, or any language"
              required
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            Text direction
            <select
              value={draft.direction}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  direction: e.target.value as Book["direction"],
                })
              }
            >
              <option value="auto">Automatic</option>
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left (Hebrew / Arabic)</option>
            </select>
          </label>
          <label className="field">
            Chapter word goal
            <input
              type="number"
              min="1"
              max="100000"
              value={draft.targetWords}
              onChange={(e) =>
                setDraft({ ...draft, targetWords: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="field">
          A sample of your voice
          <textarea
            rows={5}
            value={draft.voiceSample}
            onChange={(e) =>
              setDraft({ ...draft, voiceSample: e.target.value })
            }
            placeholder="Paste something you wrote. A paragraph is enough to begin noticing your rhythm, vocabulary, and personality."
            maxLength={10000}
          />
        </label>
        <label className="field">
          What should your writing feel like?
          <textarea
            rows={3}
            value={draft.voiceNotes}
            onChange={(e) => setDraft({ ...draft, voiceNotes: e.target.value })}
            placeholder="For example: Quiet humor. Concrete details. Let characters leave things unsaid. Avoid flowery descriptions."
            maxLength={5000}
          />
        </label>
        <div className="dialog-actions">
          {onDelete && (
            <button
              type="button"
              className="button danger"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the entire book “${book.title}”, including chapters, notes and saved versions? Export a backup first if you might need it.`,
                  )
                ) {
                  onDelete();
                  onClose();
                }
              }}
            >
              <Trash2 size={15} />
              Delete book
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save book details</button>
        </div>
      </form>
    </Modal>
  );
}

const kindIcons = {
  character: UserRound,
  place: MapPin,
  plot: Route,
  world: Globe2,
  note: StickyNote,
};
export function StoryBible({
  book,
  onChange,
  onVoice,
}: {
  book: Book;
  onChange: (notes: StoryNote[]) => void;
  onVoice: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<StoryNote | null>(null);
  const save = () => {
    if (!editing) return;
    onChange(
      book.bible.some((n) => n.id === editing.id)
        ? book.bible.map((n) => (n.id === editing.id ? editing : n))
        : [...book.bible, editing],
    );
    setEditing(null);
  };
  return (
    <section
      className="feature-page"
      dir={book.direction === "auto" ? undefined : book.direction}
    >
      <div className="feature-heading">
        <div>
          <h1>Your story, held together.</h1>
          <p>People, places, and little truths worth remembering.</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              kind: "character",
              name: "",
              details: "",
            })
          }
        >
          <Plus size={16} />
          Add a note
        </button>
      </div>
      <div className="bible-tabs" role="tablist" aria-label="Story note types">
        {[
          ["all", "Everything"],
          ["character", "Characters"],
          ["place", "Places"],
          ["plot", "Plot"],
          ["world", "World"],
          ["note", "Notes"],
        ].map(([value, label], index, tabs) => (
          <button
            key={value}
            id={`story-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={filter === value}
            aria-controls="story-notes-panel"
            tabIndex={filter === value ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              event.preventDefault();
              const nextIndex =
                (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
              const next = tabs[nextIndex][0];
              setFilter(next);
              document.getElementById(`story-tab-${next}`)?.focus();
            }}
            onClick={() => setFilter(value)}
            className={filter === value ? "active" : ""}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="bible-list"
        id="story-notes-panel"
        role="tabpanel"
        aria-labelledby={`story-tab-${filter}`}
        tabIndex={0}
      >
        {book.bible
          .filter((n) => filter === "all" || n.kind === filter)
          .map((note) => {
            const Icon = kindIcons[note.kind];
            return (
              <button
                key={note.id}
                className="bible-note"
                onClick={() => setEditing({ ...note })}
              >
                <span className="note-icon">
                  <Icon size={22} />
                </span>
                <div>
                  <small>{note.kind}</small>
                  <h3>{note.name}</h3>
                  <p>{note.details}</p>
                </div>
                <span className="edit-note">Edit</span>
              </button>
            );
          })}
        {!book.bible.some((n) => filter === "all" || n.kind === filter) && (
          <div className="empty-state">
            <BookOpen size={34} />
            <h3>Leave a thread to follow.</h3>
            <p>
              Add a character, a setting, or the smallest detail. Your writing
              companion uses these notes to keep your story consistent.
            </p>
          </div>
        )}
      </div>
      <aside className="voice-callout">
        <div>
          <h3>There’s no voice quite like yours.</h3>
          <p>Add a writing sample and your preferences to guide every draft.</p>
        </div>
        <button className="button secondary" onClick={onVoice}>
          Shape your voice
        </button>
      </aside>
      {editing && (
        <Modal
          title={
            book.bible.some((n) => n.id === editing.id)
              ? "Edit story note"
              : "Add to your story bible"
          }
          onClose={() => setEditing(null)}
        >
          <form
            className="modal-body settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="field">
              Type
              <select
                value={editing.kind}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    kind: e.target.value as StoryNote["kind"],
                  })
                }
              >
                {Object.keys(kindIcons).map((kind) => (
                  <option key={kind} value={kind}>
                    {kind[0].toUpperCase() + kind.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Name
              <input
                autoFocus
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                required
                maxLength={200}
              />
            </label>
            <label className="field">
              Details
              <textarea
                rows={9}
                value={editing.details}
                onChange={(e) =>
                  setEditing({ ...editing, details: e.target.value })
                }
                placeholder="Motives, memories, appearance, relationships, rules…"
                maxLength={15000}
              />
            </label>
            <div className="dialog-actions">
              {book.bible.some((n) => n.id === editing.id) && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() => {
                    if (window.confirm(`Delete the note “${editing.name}”?`)) {
                      onChange(book.bible.filter((n) => n.id !== editing.id));
                      setEditing(null);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              )}
              <button className="button primary">Save note</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function RevisionHistory({
  chapter,
  onChange,
  onClose,
}: {
  chapter: Chapter;
  onChange: (patch: Partial<Chapter>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const snapshot = (label: string) => ({
    id: crypto.randomUUID(),
    name: label,
    createdAt: new Date().toISOString(),
    title: chapter.title,
    content: chapter.content,
  });
  const selectedVersion = chapter.versions.find((v) => v.id === selected);
  return (
    <Modal title="Revision history" onClose={onClose} wide>
      <div className="modal-body">
        <p className="intro-text">
          Keep a version you can return to. Restoring also saves your current
          draft.
        </p>
        <form
          className="revision-form"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({
              versions: [
                snapshot(name.trim() || "Saved draft"),
                ...chapter.versions,
              ],
            });
            setName("");
          }}
        >
          <input
            aria-label="Revision name"
            placeholder="Give this draft a name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
          />
          <button className="button primary">Save a version</button>
        </form>
        <div className="revision-list">
          {chapter.versions.length === 0 && (
            <p className="empty-state">
              No versions yet. Save your first above.
            </p>
          )}
          {chapter.versions.map((v) => (
            <button
              key={v.id}
              className={`revision-row ${v.id === selected ? "selected" : ""}`}
              onClick={() => setSelected(v.id)}
            >
              <span>
                <strong>{v.name}</strong>
                <small>{new Date(v.createdAt).toLocaleString()}</small>
              </span>
              <span>{wordCount(v.content)} words</span>
            </button>
          ))}
        </div>
        {selectedVersion && (
          <div className="revision-preview">
            <h3>{selectedVersion.title}</h3>
            <div
              className="prose-preview"
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(selectedVersion.content),
              }}
            />
            <button
              className="button primary"
              onClick={() => {
                onChange({
                  title: selectedVersion.title,
                  content: selectedVersion.content,
                  versions: [
                    snapshot("Before restoring " + selectedVersion.name),
                    ...chapter.versions,
                  ],
                });
                onClose();
              }}
            >
              Restore this version
            </button>
            <button
              className="button danger"
              style={{ marginInlineStart: 12 }}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the saved version “${selectedVersion.name}”? The current chapter will stay unchanged.`,
                  )
                ) {
                  onChange({
                    versions: chapter.versions.filter(
                      (v) => v.id !== selectedVersion.id,
                    ),
                  });
                  setSelected(null);
                }
              }}
            >
              Delete saved version
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ChapterDetails({
  chapter,
  index,
  count,
  onChange,
  onMove,
  onDelete,
  onClose,
}: {
  chapter: Chapter;
  index: number;
  count: number;
  onChange: (patch: Partial<Chapter>) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Chapter details" onClose={onClose}>
      <div className="modal-body settings-form">
        <label className="field">
          Title
          <input
            value={chapter.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
        <label className="field">
          Draft status
          <select
            value={chapter.status}
            onChange={(e) =>
              onChange({ status: e.target.value as Chapter["status"] })
            }
          >
            <option value="draft">First draft</option>
            <option value="revised">Revised</option>
            <option value="final">Final draft</option>
          </select>
        </label>
        <label className="field">
          What happens in this chapter?
          <textarea
            rows={5}
            value={chapter.synopsis}
            onChange={(e) => onChange({ synopsis: e.target.value })}
            placeholder="A brief plan, turning points, or a question to answer."
          />
        </label>
        <div className="field">
          <span>Position in your book</span>
          <div className="inline-actions">
            <button
              className="button secondary"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={16} />
              Move earlier
            </button>
            <button
              className="button secondary"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={16} />
              Move later
            </button>
          </div>
        </div>
        <div className="dialog-actions">
          <button
            className="button danger"
            disabled={count < 2}
            onClick={() => {
              if (
                window.confirm(
                  `Delete chapter “${chapter.title}” and its saved versions? Download a book backup first if you may need it.`,
                )
              ) {
                onDelete();
                onClose();
              }
            }}
          >
            <Trash2 size={16} />
            Delete chapter
          </button>
          <button className="button primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ExportDialog({
  book,
  onClose,
}: {
  book: Book;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const formats = [
    ["docx", "Word document", ".docx · Keep editing in Word"],
    ["epub", "Ebook", ".epub · Read on your e-reader"],
    ["pdf", "Print / save as PDF", "Choose your page size in the print dialog"],
    ["html", "Formatted manuscript", ".html · A standalone illustrated book"],
    ["md", "Markdown", ".md · Portable text and formatting"],
    ["txt", "Plain text", ".txt · Just your words"],
    [
      "json",
      "Complete book backup",
      ".json · Chapters, notes, art, and saved versions",
    ],
  ] as const;
  return (
    <Modal title="Let your story travel" onClose={onClose}>
      <div className="modal-body">
        <p className="intro-text">
          {book.title || "Untitled book"} ·{" "}
          {book.chapters
            .reduce((n, c) => n + wordCount(c.content), 0)
            .toLocaleString()}{" "}
          words
        </p>
        <div className="export-options">
          {formats.map(([format, label, hint]) => (
            <button
              key={format}
              disabled={!!busy}
              className="export-option"
              onClick={async () => {
                setBusy(format);
                setError("");
                setDone("");
                try {
                  await exportBook(book, format);
                  setDone(
                    format === "pdf"
                      ? "Print preview opened. Choose “Save as PDF” to save a PDF."
                      : `${label} prepared for download.`,
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Export failed. Your manuscript is unchanged.",
                  );
                } finally {
                  setBusy("");
                }
              }}
            >
              <Download size={20} />
              <span>
                <strong>{busy === format ? "Preparing…" : label}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="success-message" role="status">
            {done}
          </p>
        )}
        <p className="hint">
          Keep a complete backup somewhere safe. You can restore it from My
          library → Import backup.
        </p>
      </div>
    </Modal>
  );
}
