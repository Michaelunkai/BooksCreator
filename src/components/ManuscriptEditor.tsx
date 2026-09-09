import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Quote,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  History,
  Search,
  X,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Settings2,
} from "lucide-react";
import type { Book, Chapter } from "../types";
import {
  safeImageSource,
  sanitizeHtml,
  stripHtml,
  wordCount,
} from "../lib/text";
import { fetchJson } from "../lib/api";

interface Props {
  book: Book;
  chapter: Chapter;
  chapterIndex: number;
  focus: boolean;
  onFocus: () => void;
  onNavigate?: (delta: number) => void;
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
  onChange: (patch: Partial<Chapter>) => void;
  onSelection: (value: string) => void;
  onEditor: (editor: Editor | null) => void;
  onHistory: () => void;
  onChapterDetails: () => void;
  onNotice: (message: string) => void;
}
export function ManuscriptEditor({
  book,
  chapter,
  chapterIndex,
  focus,
  onFocus,
  onNavigate = () => undefined,
  canNavigatePrevious = chapterIndex > 0,
  canNavigateNext = false,
  onChange,
  onSelection,
  onEditor,
  onHistory,
  onChapterDetails,
  onNotice,
}: Props) {
  const callbacks = useRef({ onChange, onSelection });
  callbacks.current = { onChange, onSelection };
  const [font, setFont] = useState("literary");
  const [fontSize, setFontSize] = useState("21");
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const [, setToolbarTick] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder:
          "Every story begins somewhere. Start writing, or develop an idea with your writing companion…",
      }),
    ],
    content: sanitizeHtml(chapter.content),
    editorProps: {
      attributes: {
        "aria-label": "Chapter manuscript",
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
        dir: book.direction,
      },
      transformPastedHTML: (html) => {
        const template = document.createElement("template");
        template.innerHTML = sanitizeHtml(html);
        let removed = false;
        for (const image of template.content.querySelectorAll("img")) {
          if (!safeImageSource(image.getAttribute("src") || "")) {
            image.remove();
            removed = true;
          }
        }
        if (removed)
          onNotice(
            "Use Illustrations → Upload to save embedded or external artwork with your book. The pasted text is kept.",
          );
        return template.innerHTML;
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file) return false;
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        ) {
          onNotice("Paste a PNG, JPEG, or WebP image up to 10 MB.");
          return true;
        }
        const target = editor;
        if (!target) return true;
        const reader = new FileReader();
        const controller = new AbortController();
        let insertionPosition = target.state.selection.from;
        let finished = false;
        const mapInsertion = ({
          transaction,
        }: {
          transaction: Transaction;
        }) => {
          if (transaction.docChanged)
            insertionPosition = transaction.mapping.map(insertionPosition, 1);
        };
        const stopTracking = () => {
          target.off("transaction", mapInsertion);
          target.off("destroy", cancelPaste);
        };
        const cancelPaste = () => {
          finished = true;
          controller.abort();
          if (reader.readyState === FileReader.LOADING) reader.abort();
          stopTracking();
        };
        target.on("transaction", mapInsertion);
        target.on("destroy", cancelPaste);
        onNotice("Saving your pasted illustration…");
        reader.onerror = () => {
          if (finished) return;
          finished = true;
          stopTracking();
          onNotice("Could not read this image. Try Illustrations → Upload.");
        };
        reader.onload = () => {
          if (finished || target.isDestroyed) return;
          void fetchJson<{ url: string }>("/api/images", {
            method: "POST",
            body: JSON.stringify({ dataUrl: reader.result }),
            signal: controller.signal,
          })
            .then((result) => {
              if (finished || controller.signal.aborted || target.isDestroyed)
                return;
              stopTracking();
              // Track the paste point through edits, then insert without replacing
              // or moving whichever selection the author has made meanwhile.
              const inserted = target.commands.insertContentAt(
                Math.min(insertionPosition, target.state.doc.content.size),
                {
                  type: "image",
                  attrs: {
                    src: result.url,
                    alt: file.name || "Pasted illustration",
                  },
                },
                { updateSelection: false },
              );
              onNotice(
                inserted
                  ? "Illustration pasted and saved."
                  : "The image was saved, but could not be inserted at the original paste point. Try Illustrations → Upload.",
              );
            })
            .catch((error) => {
              if (finished || controller.signal.aborted) return;
              onNotice(
                error instanceof Error ? error.message : "Image upload failed.",
              );
            })
            .finally(() => {
              finished = true;
              stopTracking();
            });
        };
        reader.readAsDataURL(file);
        return true;
      },
    },
    onUpdate: ({ editor }) =>
      callbacks.current.onChange({ content: editor.getHTML() }),
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      callbacks.current.onSelection(
        editor.state.doc.textBetween(from, to, "\n"),
      );
      setToolbarTick((v) => v + 1);
    },
    onTransaction: () => setToolbarTick((v) => v + 1),
  });
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      sanitizeHtml(chapter.content) !== sanitizeHtml(editor.getHTML())
    )
      editor.commands.setContent(sanitizeHtml(chapter.content), {
        emitUpdate: false,
      });
  }, [editor, chapter.content]);
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes: {
            "aria-label": "Chapter manuscript",
            role: "textbox",
            "aria-multiline": "true",
            spellcheck: "true",
            dir: book.direction,
          },
        },
      });
  }, [editor, book.direction]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "f" &&
        document.activeElement?.closest(".manuscript-workspace")
      ) {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);
  const findNext = () => {
    if (!editor || !query.trim()) return;
    const matches: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const text = node.text.toLocaleLowerCase(),
        q = query.toLocaleLowerCase();
      let start = 0;
      while (start < text.length) {
        const index = text.indexOf(q, start);
        if (index === -1) break;
        matches.push({ from: pos + index, to: pos + index + q.length });
        start = index + q.length;
      }
    });
    const match =
      matches.find((m) => m.from >= editor.state.selection.to) ?? matches[0];
    if (match) {
      editor.chain().focus().setTextSelection(match).scrollIntoView().run();
      setFindStatus(`${matches.indexOf(match) + 1} of ${matches.length}`);
    } else setFindStatus("No matches");
  };
  const words = wordCount(chapter.content);
  const tool = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
    toggle = true,
  ) => (
    <button
      type="button"
      className={`tool-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      {...(toggle ? { "aria-pressed": active } : {})}
      onClick={action}
      disabled={!editor || disabled}
    >
      {icon}
    </button>
  );
  return (
    <section className="manuscript-workspace" aria-label="Manuscript workspace">
      <div className="workspace-topline">
        <div className="workspace-context">
          <div className="breadcrumb">
            <span>Manuscript</span>
            <span aria-hidden="true">/</span>
            <span>Chapter {chapterIndex + 1}</span>
          </div>
          <strong className="workspace-chapter-name">
            {chapter.title || "Untitled chapter"}
          </strong>
        </div>
        <div className="chapter-actions">
          <div
            className="chapter-stepper"
            role="group"
            aria-label="Chapter navigation"
          >
            <button
              type="button"
              className="icon-button"
              aria-label="Previous chapter"
              title="Previous chapter"
              disabled={!canNavigatePrevious}
              onClick={() => onNavigate(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span aria-live="polite">{chapterIndex + 1}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Next chapter"
              title="Next chapter"
              disabled={!canNavigateNext}
              onClick={() => onNavigate(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            className="chapter-tools-button"
            aria-label="Chapter tools"
            title="Rename, plan, reorder, or manage this chapter"
            onClick={onChapterDetails}
          >
            <Settings2 size={15} />
            <span>Chapter tools</span>
          </button>
          <button type="button" className="text-button" onClick={onFocus}>
            {focus ? "Leave focus" : "Focus mode"}
            {focus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <select
          aria-label="Manuscript font"
          value={font}
          onChange={(e) => setFont(e.target.value)}
        >
          <option value="literary">EB Garamond</option>
          <option value="classic">Georgia</option>
          <option value="modern">DM Sans</option>
        </select>
        <select
          aria-label="Manuscript text size"
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
        >
          <option value="18">Small</option>
          <option value="21">Medium</option>
          <option value="24">Large</option>
          <option value="28">Extra large</option>
        </select>
        <span className="toolbar-divider" />
        {tool(
          "Bold",
          <Bold size={17} />,
          () => editor?.chain().focus().toggleBold().run(),
          editor?.isActive("bold"),
        )}
        {tool(
          "Italic",
          <Italic size={17} />,
          () => editor?.chain().focus().toggleItalic().run(),
          editor?.isActive("italic"),
        )}
        {tool(
          "Underline",
          <Underline size={17} />,
          () => editor?.chain().focus().toggleUnderline().run(),
          editor?.isActive("underline"),
        )}
        {tool(
          "Quotation",
          <Quote size={17} />,
          () => editor?.chain().focus().toggleBlockquote().run(),
          editor?.isActive("blockquote"),
        )}
        <span className="toolbar-divider" />
        {tool(
          "Bullet list",
          <List size={17} />,
          () => editor?.chain().focus().toggleBulletList().run(),
          editor?.isActive("bulletList"),
        )}
        {tool(
          "Numbered list",
          <ListOrdered size={17} />,
          () => editor?.chain().focus().toggleOrderedList().run(),
          editor?.isActive("orderedList"),
        )}
        {tool(
          "Align left",
          <AlignLeft size={17} />,
          () => editor?.chain().focus().setTextAlign("left").run(),
          editor?.isActive({ textAlign: "left" }),
        )}
        {tool(
          "Align center",
          <AlignCenter size={17} />,
          () => editor?.chain().focus().setTextAlign("center").run(),
          editor?.isActive({ textAlign: "center" }),
        )}
        {tool(
          "Align right",
          <AlignRight size={17} />,
          () => editor?.chain().focus().setTextAlign("right").run(),
          editor?.isActive({ textAlign: "right" }),
        )}
        <span className="toolbar-divider" />
        {tool(
          "Undo",
          <Undo2 size={17} />,
          () => editor?.chain().focus().undo().run(),
          false,
          !editor?.can().undo(),
          false,
        )}
        {tool(
          "Redo",
          <Redo2 size={17} />,
          () => editor?.chain().focus().redo().run(),
          false,
          !editor?.can().redo(),
          false,
        )}
        <div className="toolbar-end">
          {tool(
            "Find in chapter",
            <Search size={16} />,
            () => setFindOpen((v) => !v),
            findOpen,
          )}
          {tool(
            "Revision history",
            <History size={16} />,
            onHistory,
            false,
            false,
            false,
          )}
          {tool(
            "Chapter details",
            <MoreHorizontal size={17} />,
            onChapterDetails,
            false,
            false,
            false,
          )}
        </div>
      </div>
      {findOpen && (
        <form
          className="find-bar"
          onSubmit={(e) => {
            e.preventDefault();
            findNext();
          }}
        >
          <label htmlFor="find-text">Find</label>
          <input
            id="find-text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFindStatus("");
            }}
          />
          <span role="status">{findStatus}</span>
          <button className="button secondary" disabled={!query.trim()}>
            Next
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close find"
            onClick={() => setFindOpen(false)}
          >
            <X size={16} />
          </button>
        </form>
      )}
      <div className="paper-scroll">
        <article
          className={`manuscript-paper font-${font}`}
          style={{ "--document-size": `${fontSize}px` } as React.CSSProperties}
          dir={book.direction}
        >
          <div className="chapter-eyebrow">
            CHAPTER{" "}
            {[
              "ONE",
              "TWO",
              "THREE",
              "FOUR",
              "FIVE",
              "SIX",
              "SEVEN",
              "EIGHT",
              "NINE",
              "TEN",
            ][chapterIndex] ?? chapterIndex + 1}
          </div>
          <input
            className="chapter-title"
            aria-label="Chapter title"
            value={chapter.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Untitled chapter"
            dir={book.direction}
          />
          <div className="chapter-ornament" aria-hidden="true">
            <span>✧</span>
          </div>
          <EditorContent editor={editor} />
          <footer className="paper-footer">
            <span>{words.toLocaleString()} words</span>
            <span>
              {stripHtml(chapter.content).length.toLocaleString()} characters
            </span>
            <span>
              ≈ {Math.max(1, Math.ceil(words / 250))}{" "}
              {words > 250 ? "pages" : "page"}
            </span>
          </footer>
        </article>
      </div>
      <div className="editor-status">
        <span>
          {chapter.status === "final"
            ? "Final draft"
            : chapter.status === "revised"
              ? "Revised draft"
              : "First draft"}
        </span>
        <span>Page estimates use 250 words · Your words are yours</span>
      </div>
    </section>
  );
}
