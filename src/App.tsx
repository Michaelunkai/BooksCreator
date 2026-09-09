import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Feather,
  FileText,
  Image as ImageIcon,
  Library as LibraryIcon,
  LoaderCircle,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Download,
  AlertCircle,
  X,
  PanelRightClose,
  Github,
} from "lucide-react";
import type { Book, Chapter, Illustration } from "./types";
import { useWorkspace } from "./lib/useWorkspace";
import { assetUrl } from "./lib/assetUrl";
import { createBook, createChapter } from "./lib/seed";
import { escapeHtml, textToHtml, wordCount } from "./lib/text";
import { ManuscriptEditor } from "./components/ManuscriptEditor";
import { Companion } from "./components/Companion";
import { Illustrations } from "./components/Illustrations";
import { SettingsDialog } from "./components/SettingsDialog";
import {
  BookSettings,
  ChapterDetails,
  ExportDialog,
  Library,
  RevisionHistory,
  StoryBible,
} from "./components/BookPanels";

type View = "manuscript" | "bible" | "illustrations";
type Dialog =
  "library" | "settings" | "book" | "history" | "chapter" | "export" | null;

const chapterStatusLabel: Record<Chapter["status"], string> = {
  draft: "First draft",
  revised: "Revised",
  final: "Final draft",
};

export default function App() {
  const {
    workspace,
    setWorkspace,
    loading,
    saveState,
    error,
    retrySave,
    flush,
    recoverAsCopy,
    recoveryCopies,
    recoverStoredCopy,
  } = useWorkspace();
  const [view, setView] = useState<View>("manuscript");
  const [chapterId, setChapterId] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focus, setFocus] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [toast, setToast] = useState("");
  const editorRef = useRef<Editor | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const companionTriggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const companionRef = useRef<HTMLElement>(null);
  const navWasOpen = useRef(false);
  const companionWasOpen = useRef(false);
  const selectionRef = useRef<{
    from: number;
    to: number;
    text: string;
    chapterId: string;
  } | null>(null);
  const book =
    workspace?.books.find((b) => b.id === workspace.activeBookId) ??
    workspace?.books[0];
  const chapter =
    book?.chapters.find((c) => c.id === chapterId) ?? book?.chapters[0];
  const chapterIndex =
    book?.chapters.findIndex((c) => c.id === chapter?.id) ?? 0;
  useEffect(() => {
    if (!book) return;
    const language = book.language.trim().toLowerCase();
    const languageCode =
      (
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
        } as Record<string, string>
      )[language] ||
      (/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(language) ? language : "en");
    const previous = document.documentElement.lang;
    document.documentElement.lang = languageCode;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [book?.language]);
  const bookRef = useRef(book);
  bookRef.current = book;
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const navigateChapter = useCallback((delta: number) => {
    const currentBook = bookRef.current;
    const currentChapter = chapterRef.current;
    if (!currentBook || !currentChapter) return;
    const currentIndex = currentBook.chapters.findIndex(
      (item) => item.id === currentChapter.id,
    );
    const nextChapter = currentBook.chapters[currentIndex + delta];
    if (!nextChapter) return;
    setChapterId(nextChapter.id);
    setView("manuscript");
    setNavOpen(false);
  }, []);
  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);
  const onSelection = useCallback((text: string) => {
    setSelection(text);
    const editor = editorRef.current;
    selectionRef.current =
      editor && text
        ? {
            from: editor.state.selection.from,
            to: editor.state.selection.to,
            text,
            chapterId: chapterRef.current?.id ?? "",
          }
        : null;
  }, []);
  useEffect(() => {
    setSelection("");
    selectionRef.current = null;
  }, [chapter?.id]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (navOpen) {
      navWasOpen.current = true;
      navRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    } else if (navWasOpen.current) {
      navWasOpen.current = false;
      navTriggerRef.current?.focus();
    }
  }, [navOpen]);
  useEffect(() => {
    if (companionOpen) {
      companionWasOpen.current = true;
      companionRef.current
        ?.querySelector<HTMLElement>(
          "button:not(:disabled),textarea,input,select",
        )
        ?.focus();
    } else if (companionWasOpen.current) {
      companionWasOpen.current = false;
      companionTriggerRef.current?.focus();
    }
  }, [companionOpen]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"]')
      ) {
        setFocus(false);
        setNavOpen(false);
        setCompanionOpen(false);
      }
      if (event.key === "Tab" && !document.querySelector('[role="dialog"]')) {
        const panel = navOpen
          ? navRef.current
          : companionOpen
            ? companionRef.current
            : null;
        if (!panel) return;
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [companionOpen, flush, navOpen]);
  const updateBook = useCallback(
    (patch: Partial<Book>) => {
      const id = bookRef.current?.id;
      if (!id) return;
      setWorkspace((current) =>
        current
          ? {
              ...current,
              books: current.books.map((b) =>
                b.id === id
                  ? {
                      ...b,
                      ...patch,
                      id: b.id,
                      updatedAt: new Date().toISOString(),
                    }
                  : b,
              ),
            }
          : current,
      );
    },
    [setWorkspace],
  );
  const updateChapter = useCallback(
    (patch: Partial<Chapter>) => {
      const b = bookRef.current,
        c = chapterRef.current;
      if (!b || !c) return;
      setWorkspace((current) =>
        current
          ? {
              ...current,
              books: current.books.map((book) =>
                book.id === b.id
                  ? {
                      ...book,
                      updatedAt: new Date().toISOString(),
                      chapters: book.chapters.map((ch) =>
                        ch.id === c.id ? { ...ch, ...patch, id: ch.id } : ch,
                      ),
                    }
                  : book,
              ),
            }
          : current,
      );
    },
    [setWorkspace],
  );
  const addChapter = () => {
    if (!book) return;
    const c = createChapter(`Chapter ${book.chapters.length + 1}`);
    updateBook({ chapters: [...book.chapters, c] });
    setChapterId(c.id);
    setView("manuscript");
    setNavOpen(false);
  };
  const insertDraft = (text: string, replace: boolean) => {
    const editor = editorRef.current,
      c = chapterRef.current;
    if (!editor || !c) return;
    const snapshot = {
      id: crypto.randomUUID(),
      name: replace ? "Before refining passage" : "Before inserting draft",
      createdAt: new Date().toISOString(),
      title: c.title,
      content: editor.getHTML(),
    };
    const savedSelection = selectionRef.current;
    if (replace) {
      if (
        !savedSelection ||
        savedSelection.chapterId !== c.id ||
        editor.state.doc.textBetween(
          savedSelection.from,
          savedSelection.to,
          "\n",
        ) !== savedSelection.text
      ) {
        setToast(
          "The selected passage changed. Select it again before replacing.",
        );
        return;
      }
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: savedSelection.from, to: savedSelection.to },
          textToHtml(text),
        )
        .run();
    } else
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, textToHtml(text))
        .run();
    updateChapter({
      content: editor.getHTML(),
      versions: [snapshot, ...c.versions],
    });
    setToast(
      replace
        ? "Passage updated. Your earlier draft is in revision history."
        : "Draft added to your chapter. Make it yours.",
    );
  };
  const insertImage = (image: Illustration) => {
    const c = chapterRef.current;
    if (!c) return;
    const html = `<p></p><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || "Story illustration")}" title="${escapeHtml(image.caption)}"/><p><em>${escapeHtml(image.caption)}</em></p><p></p>`;
    updateChapter({
      content: c.content + html,
      versions: [
        {
          id: crypto.randomUUID(),
          name: "Before adding illustration",
          createdAt: new Date().toISOString(),
          title: c.title,
          content: c.content,
        },
        ...c.versions,
      ],
    });
    setView("manuscript");
    setToast("Illustration added to the end of your chapter.");
  };
  if (loading)
    return (
      <div className="app-loading">
        <Feather size={38} />
        <h1>Folio</h1>
        <p>Opening your writing desk…</p>
        <LoaderCircle className="spin" size={19} />
      </div>
    );
  if (!workspace || !book || !chapter)
    return (
      <div className="app-loading">
        <AlertCircle size={32} />
        <h1>Your writing is waiting.</h1>
        <p>{error || "The writing studio could not load."}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Try opening again
        </button>
      </div>
    );
  const words = wordCount(chapter.content);
  const saveLabel =
    saveState === "saved"
      ? "Saved to this computer"
      : saveState === "saving"
        ? "Saving your words…"
        : saveState === "conflict"
          ? "Another copy changed"
          : saveState === "error"
            ? "Save needs attention"
            : "Opening your book…";
  const closeDialog = () => setDialog(null);
  return (
    <div
      className={`app-shell ${focus ? "focus-mode" : ""}`}
      dir={book.direction === "auto" ? undefined : book.direction}
      lang={book.language || "en"}
    >
      <header className="app-header">
        <div className="brand-wrap">
          <button
            ref={navTriggerRef}
            className="icon-button mobile-menu"
            aria-label="Open chapters"
            aria-expanded={navOpen}
            aria-controls="chapters-drawer"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={21} />
          </button>
          <button
            className="brand"
            onClick={() => setDialog("library")}
            aria-label="Folio library"
          >
            <Feather size={30} strokeWidth={1.2} />
            <span>Folio</span>
          </button>
          <span className="brand-tagline">Your story, thoughtfully told.</span>
          <a
            className="github-link"
            href="https://github.com/Michaelunkai/BooksCreator"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Michaelunkai on GitHub"
            title="Open the Folio repository on GitHub"
          >
            <Github size={16} strokeWidth={1.8} />
            <span>Michaelunkai</span>
          </a>
        </div>
        <div className="header-actions">
          <button
            className={`save-status ${saveState === "error" || saveState === "conflict" ? "needs-attention" : ""}`}
            onClick={() => void flush()}
            title="Save now (Ctrl+S)"
            aria-label={saveLabel}
            aria-live="polite"
            aria-atomic="true"
          >
            {saveState === "saved" ? (
              <CheckCircle2 size={17} />
            ) : saveState === "saving" ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <AlertCircle size={17} />
            )}
            <span>{saveLabel}</span>
          </button>
          <button
            className="button secondary export-button"
            onClick={() => setDialog("export")}
          >
            <Download size={16} />
            <span>Export</span>
          </button>
          <button
            className="icon-button"
            aria-label="Connection settings"
            onClick={() => setDialog("settings")}
          >
            <Settings size={21} strokeWidth={1.5} />
          </button>
        </div>
      </header>
      {(saveState === "error" || saveState === "conflict") && (
        <div className="save-warning" role="alert">
          <AlertCircle size={18} />
          <span>
            {error} Keep this tab open and download a backup to protect your
            latest work.
          </span>
          <button onClick={() => setDialog("export")}>Back up book</button>
          {saveState === "conflict" ? (
            <button onClick={() => void recoverAsCopy()}>
              Keep my edits as a separate book
            </button>
          ) : (
            <button onClick={retrySave}>Retry save</button>
          )}
        </div>
      )}
      <div className="desk-layout">
        {navOpen && (
          <button
            className="drawer-shade"
            aria-label="Close chapters"
            onClick={() => setNavOpen(false)}
          />
        )}
        <aside
          ref={navRef}
          id="chapters-drawer"
          className={`sidebar ${navOpen ? "mobile-open" : ""}`}
          role={navOpen ? "dialog" : undefined}
          aria-modal={navOpen ? "true" : undefined}
          aria-label={navOpen ? "Chapters and book navigation" : undefined}
        >
          <button
            className="icon-button mobile-close"
            aria-label="Close chapters panel"
            onClick={() => setNavOpen(false)}
          >
            <X size={19} />
          </button>
          <button
            className="current-book"
            onClick={() => setDialog("book")}
            title="Edit book details and voice"
          >
            <span className="mini-cover">
              <span>{book.title || "Your story"}</span>
              <img src={assetUrl("assets/tide-illustration.png")} alt="" />
            </span>
            <span>
              <strong>{book.title || "Untitled book"}</strong>
              <em>{book.author ? `By ${book.author}` : "A novel by you"}</em>
            </span>
          </button>
          <nav className="primary-nav" aria-label="Book sections">
            {(
              [
                { id: "manuscript", name: "Manuscript", Icon: FileText },
                { id: "bible", name: "Story bible", Icon: BookOpen },
                { id: "illustrations", name: "Illustrations", Icon: ImageIcon },
              ] as const
            ).map(({ id, name, Icon }) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                aria-current={view === id ? "page" : undefined}
                onClick={() => {
                  setView(id);
                  setNavOpen(false);
                }}
              >
                <Icon size={21} strokeWidth={1.4} />
                {name}
              </button>
            ))}
          </nav>
          <div className="chapter-list-header">
            <div className="chapter-heading-copy">
              <h2>Chapters</h2>
              <span
                className="chapter-count"
                aria-label={`${book.chapters.length} chapters`}
              >
                {book.chapters.length}
              </span>
            </div>
            <button
              className="chapter-add-button"
              aria-label="Add chapter"
              title="Add a new chapter"
              onClick={addChapter}
            >
              <Plus size={19} />
              <span>Add chapter</span>
            </button>
          </div>
          <nav className="chapter-list" aria-label="Chapters">
            {book.chapters.map((c, i) => (
              <button
                key={c.id}
                className={chapter.id === c.id ? "active" : ""}
                aria-current={chapter.id === c.id ? "step" : undefined}
                aria-label={`${String(i + 1).padStart(2, "0")} ${c.title || "Untitled chapter"}`}
                title={`Open ${c.title || "Untitled chapter"}. ${chapterStatusLabel[c.status]} · ${wordCount(c.content).toLocaleString()} words.`}
                onClick={() => {
                  setChapterId(c.id);
                  setView("manuscript");
                  setNavOpen(false);
                }}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span className="chapter-row-copy">
                  <strong>{c.title || "Untitled chapter"}</strong>
                  <small>
                    <span
                      className={`chapter-status-dot status-${c.status}`}
                      aria-hidden="true"
                    />
                    {chapterStatusLabel[c.status]} ·{" "}
                    {wordCount(c.content).toLocaleString()} words
                  </small>
                </span>
                <ChevronRight
                  className="chapter-row-arrow"
                  size={14}
                  aria-hidden="true"
                />
              </button>
            ))}
          </nav>
          <p className="chapter-list-hint">
            Select a chapter to write. Chapter tools let you rename, plan,
            reorder, or finish it.
          </p>
          <div className="sidebar-bottom">
            <button
              className="writing-goal"
              onClick={() => setDialog("book")}
              title="Change your chapter word goal"
            >
              <span>
                {words.toLocaleString()}{" "}
                <span>/ {book.targetWords.toLocaleString()} words</span>
              </span>
              <span className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, (words / book.targetWords) * 100)}%`,
                  }}
                />
              </span>
              <small>
                {words >= book.targetWords
                  ? "A little milestone. Well done."
                  : "One word, then the next."}
              </small>
            </button>
            <button
              className="library-link"
              onClick={() => setDialog("library")}
            >
              <LibraryIcon size={22} strokeWidth={1.4} />
              <span>My library</span>
              <ChevronRight size={17} />
            </button>
          </div>
        </aside>
        <main
          className={`main-content ${view !== "manuscript" ? "full-width" : ""}`}
        >
          {view === "manuscript" ? (
            <ManuscriptEditor
              key={chapter.id}
              book={book}
              chapter={chapter}
              chapterIndex={chapterIndex}
              focus={focus}
              onFocus={() => setFocus((v) => !v)}
              onNavigate={navigateChapter}
              canNavigatePrevious={chapterIndex > 0}
              canNavigateNext={chapterIndex < book.chapters.length - 1}
              onChange={updateChapter}
              onSelection={onSelection}
              onEditor={onEditor}
              onNotice={setToast}
              onHistory={() => setDialog("history")}
              onChapterDetails={() => setDialog("chapter")}
            />
          ) : view === "bible" ? (
            <StoryBible
              key={book.id}
              book={book}
              onChange={(bible) => updateBook({ bible })}
              onVoice={() => setDialog("book")}
            />
          ) : (
            <Illustrations
              book={book}
              chapter={chapter}
              onChange={(images) => {
                const targetBookId = book.id;
                setWorkspace((w) =>
                  w
                    ? {
                        ...w,
                        books: w.books.map((b) =>
                          b.id === targetBookId
                            ? {
                                ...b,
                                images,
                                updatedAt: new Date().toISOString(),
                              }
                            : b,
                        ),
                      }
                    : w,
                );
              }}
              onInsert={insertImage}
            />
          )}
        </main>
        {view === "manuscript" && (
          <aside
            ref={companionRef}
            id="writing-companion-drawer"
            className={`companion-rail ${companionOpen ? "mobile-open" : ""}`}
            aria-label="Writing companion"
            role={companionOpen ? "dialog" : undefined}
            aria-modal={companionOpen ? "true" : undefined}
          >
            <button
              className="icon-button companion-close"
              aria-label="Close writing companion"
              onClick={() => setCompanionOpen(false)}
            >
              <PanelRightClose size={20} />
            </button>
            <Companion
              book={book}
              chapter={chapter}
              selection={selection}
              onInsert={insertDraft}
              onSettings={() => setDialog("settings")}
            />
          </aside>
        )}
      </div>
      {view === "manuscript" && companionOpen && (
        <button
          className="companion-shade"
          aria-label="Close writing companion"
          onClick={() => setCompanionOpen(false)}
        />
      )}
      {view === "manuscript" && !focus && (
        <button
          ref={companionTriggerRef}
          className="mobile-companion button primary"
          aria-expanded={companionOpen}
          aria-controls="writing-companion-drawer"
          onClick={() => setCompanionOpen(true)}
        >
          <Sparkles size={17} />
          Writing companion
        </button>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog === "library" && (
        <Library
          recoveryCopies={recoveryCopies}
          onRecover={recoverStoredCopy}
          books={workspace.books}
          activeId={book.id}
          onClose={closeDialog}
          onOpen={(id) => {
            setWorkspace((w) => (w ? { ...w, activeBookId: id } : w));
            setChapterId("");
            setView("manuscript");
          }}
          onCreate={(newBook) => {
            setWorkspace((w) =>
              w
                ? {
                    ...w,
                    activeBookId: newBook.id,
                    books: [...w.books, newBook],
                  }
                : w,
            );
            setChapterId("");
            setView("manuscript");
          }}
        />
      )}
      {dialog === "book" && (
        <BookSettings
          book={book}
          onChange={updateBook}
          onClose={closeDialog}
          onDelete={() => {
            setWorkspace((w) => {
              if (!w) return w;
              const books = w.books.filter((b) => b.id !== book.id);
              if (!books.length) books.push(createBook());
              return { ...w, books, activeBookId: books[0].id };
            });
            setChapterId("");
            setView("manuscript");
          }}
        />
      )}
      {dialog === "settings" && <SettingsDialog onClose={closeDialog} />}
      {dialog === "history" && (
        <RevisionHistory
          chapter={chapter}
          onChange={updateChapter}
          onClose={closeDialog}
        />
      )}
      {dialog === "chapter" && (
        <ChapterDetails
          chapter={chapter}
          index={chapterIndex}
          count={book.chapters.length}
          onChange={updateChapter}
          onClose={closeDialog}
          onMove={(delta) => {
            const next = [...book.chapters];
            const index = next.findIndex((c) => c.id === chapter.id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= next.length) return;
            [next[index], next[target]] = [next[target], next[index]];
            updateBook({ chapters: next });
          }}
          onDelete={() => {
            updateBook({
              chapters: book.chapters.filter((c) => c.id !== chapter.id),
            });
            setChapterId("");
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog book={book} onClose={closeDialog} />
      )}
    </div>
  );
}
