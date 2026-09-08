import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  PenLine,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  Book,
  Chapter,
  GenerateRequest,
  GenerateResult,
  GenerationMode,
  SummaryScope,
} from "../types";
import { fetchJson } from "../lib/api";
import { assetUrl } from "../lib/assetUrl";
import { textToHtml, wordCount as countWords } from "../lib/text";
import { generateLocal } from "../lib/localWriter";
import { generateBrowser } from "../lib/browserWriter";
import "../companion.css";

interface CompanionProps {
  book: Book;
  chapter: Chapter;
  selection: string;
  onInsert: (text: string, replace: boolean) => void;
  onSettings: () => void;
}
interface Draft {
  idea: string;
  mode: GenerationMode;
  length: number;
  unit: GenerateRequest["unit"];
  voice: string;
  perspective: string;
  tense: string;
  summaryScope: SummaryScope;
  result: GenerateResult | null;
  parts: { completed: number; total: number } | null;
  originalSelection: string;
  error: string;
  status: string;
  needsSettings: boolean;
}
const initialDraft = (): Draft => ({
  idea: "",
  mode: "develop",
  length: 2,
  unit: "pages",
  voice: "Lyrical & intimate",
  perspective: "Follow the chapter",
  tense: "Follow the chapter",
  summaryScope: "chapter",
  result: null,
  parts: null,
  originalSelection: "",
  error: "",
  status: "",
  needsSettings: false,
});
const modes: { value: GenerationMode; label: string; refine?: boolean }[] = [
  { value: "develop", label: "Develop this idea" },
  { value: "continue", label: "Continue the story" },
  { value: "scene", label: "Build a scene" },
  { value: "dialogue", label: "Write dialogue" },
  { value: "outline", label: "Explore an outline" },
  { value: "polish", label: "Polish the prose", refine: true },
  { value: "shorten", label: "Make it more concise", refine: true },
  { value: "summary", label: "Build a summary" },
];
const factor = { words: 1, lines: 12, pages: 250 };
const providerWordsPerPart = 5000;
// Keep browser requests inside a conservative 4,096-token budget. Smaller
// sections leave room for story context and keep long no-provider drafts moving.
const browserWordsPerPart = 600;
// Local runtimes report their usable context when they expose it. Reserve most
// of that window for the author's story context and response, while retaining
// a bounded ceiling for unusually large local runtimes.
const maximumLocalModelWordsPerPart = 2400;
const defaultLocalModelContext = 8192;
function localWordsPerPart(contextLength?: number): number {
  const context =
    Number.isFinite(contextLength) && (contextLength || 0) >= 1024
      ? Number(contextLength)
      : defaultLocalModelContext;
  return Math.min(
    maximumLocalModelWordsPerPart,
    Math.max(browserWordsPerPart, Math.floor(context * 0.11)),
  );
}
const maximumDraftWords = 100000;
const draftStorageKey = "folio:companion-drafts:v1";
function readDrafts(): Record<string, Draft> {
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem(draftStorageKey) ?? "{}",
    );
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const restored: Record<string, Draft> = {};
    for (const [key, value] of Object.entries(saved)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Partial<Draft>;
      if (
        typeof entry.idea !== "string" ||
        !modes.some((mode) => mode.value === entry.mode) ||
        !["words", "lines", "pages"].includes(entry.unit ?? "") ||
        typeof entry.length !== "number"
      )
        continue;
      const summaryScope =
        entry.summaryScope === "idea" ||
        entry.summaryScope === "book" ||
        entry.summaryScope === "chapter" ||
        entry.summaryScope === "passage"
          ? entry.summaryScope
          : "chapter";
      const result =
        entry.result &&
        typeof entry.result.text === "string" &&
        typeof entry.result.targetWords === "number"
          ? entry.result
          : null;
      const parts =
        entry.parts &&
        Number.isInteger(entry.parts.completed) &&
        Number.isInteger(entry.parts.total) &&
        entry.parts.completed >= 0 &&
        entry.parts.completed <= entry.parts.total &&
        entry.parts.total <= 200
          ? entry.parts
          : null;
      restored[key] = {
        ...initialDraft(),
        idea: entry.idea.slice(0, 12000),
        mode: entry.mode!,
        length: entry.length,
        unit: entry.unit!,
        summaryScope,
        ...Object.fromEntries(
          ["voice", "perspective", "tense", "originalSelection"]
            .filter((field) => typeof entry[field as keyof Draft] === "string")
            .map((field) => [field, entry[field as keyof Draft]]),
        ),
        result,
        parts,
      };
    }
    return restored;
  } catch {
    return {};
  }
}

export function Companion({
  book,
  chapter,
  selection,
  onInsert,
  onSettings,
}: CompanionProps) {
  const scope = `${book.id}:${chapter.id}`;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(readDrafts);
  const [storageError, setStorageError] = useState(false);
  const draft = drafts[scope] ?? initialDraft();
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    part: 1,
    total: 1,
    completed: 0,
    words: 0,
  });
  const request = useRef<AbortController | null>(null);
  const latestScope = useRef(scope);
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = pendingScope === scope;
  const refining = draft.mode === "polish" || draft.mode === "shorten";
  const summarizing = draft.mode === "summary";
  const targetWords = draft.length * factor[draft.unit];
  const maximumWords = refining ? providerWordsPerPart : maximumDraftWords;
  const validLength =
    Number.isInteger(draft.length) &&
    draft.length > 0 &&
    targetWords <= maximumWords;
  const validIdeaOnlySummary =
    !summarizing || draft.summaryScope !== "idea" || Boolean(draft.idea.trim());
  const resultWordCount = useMemo(
    () => countWords(draft.result?.text ?? ""),
    [draft.result?.text],
  );
  const patch = (changes: Partial<Draft>, key = scope) =>
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? initialDraft()), ...changes },
    }));

  useEffect(() => {
    if (latestScope.current !== scope) {
      request.current?.abort();
      latestScope.current = scope;
    }
  }, [scope]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftStorageKey, JSON.stringify(drafts));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [drafts]);

  async function generate() {
    if (busy || !validLength) return;
    if (!validIdeaOnlySummary) {
      patch({ error: "Add an idea to build an idea-only summary." });
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const currentScope = scope;
    let totalParts = Math.ceil(targetWords / providerWordsPerPart);
    let staged = totalParts > 1;
    const received: string[] = [];
    let localWordsPerPass = localWordsPerPart();
    patch({ error: "", status: "", needsSettings: false });
    setPendingScope(scope);
    setProgress({ part: 1, total: totalParts, completed: 0, words: 0 });
    try {
      let providerConfigured = false;
      let automaticLocalModel = false;
      try {
        const settings = await fetchJson<{
          configured: boolean;
          localModelAvailable?: boolean;
          localModelContext?: number;
        }>("/api/settings", { signal: controller.signal });
        providerConfigured = Boolean(settings.configured);
        automaticLocalModel =
          !providerConfigured && Boolean(settings.localModelAvailable);
        if (automaticLocalModel)
          localWordsPerPass = localWordsPerPart(settings.localModelContext);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // The built-in writer remains available when the optional status
        // endpoint is unreachable.
        providerConfigured = false;
        automaticLocalModel = false;
      }
      let serverModelConfigured = providerConfigured || automaticLocalModel;
      let wordsPerPart = providerWordsPerPart;
      if (!serverModelConfigured) {
        wordsPerPart = browserWordsPerPart;
        totalParts = Math.ceil(targetWords / browserWordsPerPart);
        staged = totalParts > 1;
        setProgress({ part: 1, total: totalParts, completed: 0, words: 0 });
      } else if (automaticLocalModel) {
        wordsPerPart = localWordsPerPass;
        totalParts = Math.ceil(targetWords / wordsPerPart);
        staged = totalParts > 1;
        setProgress({ part: 1, total: totalParts, completed: 0, words: 0 });
      }
      const browserOptions = {
        signal: controller.signal,
        onProgress: (report: { progress: number; text: string }) => {
          if (latestScope.current !== currentScope) return;
          const percent = Math.round(report.progress * 100);
          patch(
            {
              status: report.text
                ? `${report.text}${percent > 0 && percent < 100 ? ` ${percent}%` : ""}`
                : "Preparing the free on-device writing model…",
            },
            currentScope,
          );
        },
      };
      for (let part = 0; part < totalParts; part += 1) {
        if (controller.signal.aborted)
          throw new DOMException("Generation cancelled", "AbortError");
        const accumulated = received.join("\n\n");
        const contextualBook =
          part === 0
            ? book
            : {
                ...book,
                chapters: book.chapters.map((item) =>
                  item.id === chapter.id
                    ? {
                        ...item,
                        content: chapter.content + textToHtml(accumulated),
                      }
                    : item,
                ),
              };
        const stagedIdea = [
          draft.idea,
          `Original writing task: ${modes.find((mode) => mode.value === draft.mode)?.label}. This is section ${part + 1} of ${totalParts} of one cohesive draft targeting approximately ${targetWords} words overall.`,
          part === 0
            ? "Begin the requested draft with room for its later development."
            : "Continue from the new prose at the end of the supplied chapter. Preserve established events, character voices, chronology and tone. Do not repeat, recap or restart previous sections.",
          draft.mode === "outline"
            ? "Keep the readable outline structure throughout and continue its progression."
            : "Return literary prose without section labels, progress announcements or commentary.",
          part === totalParts - 1
            ? "Reach a natural stopping point for the requested development; do not force an ending to the whole book unless the author asked for one."
            : "Maintain narrative movement and leave room for the next section instead of wrapping up the whole draft.",
        ]
          .filter(Boolean)
          .join("\n\n");
        let body: GenerateRequest = {
          book: contextualBook,
          chapterId: chapter.id,
          idea: staged ? stagedIdea : draft.idea,
          selection: part === 0 ? selection : "",
          mode: summarizing ? "summary" : part === 0 ? draft.mode : "continue",
          length: staged
            ? Math.min(wordsPerPart, targetWords - part * wordsPerPart)
            : draft.length,
          unit: staged ? "words" : draft.unit,
          voice: draft.voice,
          perspective: draft.perspective,
          tense: draft.tense,
          ...(summarizing ? { summaryScope: draft.summaryScope } : {}),
        };
        setProgress({
          part: part + 1,
          total: totalParts,
          completed: received.length,
          words: countWords(accumulated),
        });
        let result: GenerateResult;
        if (serverModelConfigured) {
          try {
            result = await fetchJson<GenerateResult>("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
          } catch (error) {
            // A loopback model can disappear between the settings probe and
            // the generation request. Drop to the browser model, then the
            // deterministic writer, so an outage never strands the author.
            if (!automaticLocalModel || controller.signal.aborted) throw error;
            automaticLocalModel = false;
            serverModelConfigured = false;
            const receivedWords = countWords(received.join("\n\n"));
            const remainingWords = Math.max(1, targetWords - receivedWords);
            wordsPerPart = browserWordsPerPart;
            totalParts =
              part + Math.ceil(remainingWords / browserWordsPerPart);
            staged = totalParts > 1;
            body = {
              ...body,
              idea: body.idea.replace(
                /This is section \d+ of \d+ of one cohesive draft targeting approximately \d+ words overall\./u,
                `This is section ${part + 1} of ${totalParts} of one cohesive draft targeting approximately ${targetWords} words overall.`,
              ),
              length: Math.min(browserWordsPerPart, remainingWords),
              unit: "words",
            };
            setProgress({
              part: part + 1,
              total: totalParts,
              completed: received.length,
              words: receivedWords,
            });
            try {
              result = await generateBrowser(body, browserOptions);
            } catch (browserError) {
              if (controller.signal.aborted) throw browserError;
              result = generateLocal(body);
            }
          }
        } else {
          try {
            result = await generateBrowser(body, browserOptions);
          } catch (error) {
            if (controller.signal.aborted) throw error;
            // A model load can fail because of a browser GPU reset or a
            // transient download problem. Keep the no-setup route usable.
            result = generateLocal(body);
          }
        }
        if (controller.signal.aborted)
          throw new DOMException("Generation cancelled", "AbortError");
        if (!result.text?.trim())
          throw new Error(
            "The provider returned an empty section. Generation stopped; any completed sections are kept below.",
          );
        received.push(result.text.trim());
        const text = received.join("\n\n");
        const finished = received.length === totalParts;
        const source =
          result.source ||
          (providerConfigured
            ? "provider"
            : automaticLocalModel
              ? "local-model"
              : "local");
        patch(
          {
            result: {
              text,
              wordCount: countWords(text),
              targetWords,
              incomplete: result.incomplete || !finished,
              source,
            },
            parts: staged
              ? { completed: received.length, total: totalParts }
              : null,
            originalSelection: selection,
            status: result.incomplete
              ? "Generation has stopped so you can review it."
              : finished
                ? source === "provider"
                  ? "Your draft is ready. Read it, edit it, make it yours."
                  : source === "local-model"
                    ? "Your automatic local model draft is ready. Read it, edit it, make it yours."
                    : source === "browser"
                      ? "Your free on-device draft is ready. Read it, edit it, make it yours."
                      : "Your free offline draft is ready. Read it, edit it, make it yours."
                : `${received.length} of ${totalParts} sections received. Continuing from the last passage…`,
          },
          currentScope,
        );
        if (
          (received.length === 1 || finished) &&
          latestScope.current === currentScope
        )
          window.setTimeout(
            () =>
              resultRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              }),
            60,
          );
        // A server-model response marked incomplete is surfaced for review.
        // For the browser model, a length stop can safely flow into the next
        // context-safe section so a long no-provider draft still reaches its
        // requested target when the model needs more than one pass.
        if (
          result.incomplete &&
          (serverModelConfigured || part === totalParts - 1)
        )
          break;
      }
    } catch (error) {
      if (controller.signal.aborted)
        patch(
          {
            status: received.length
              ? `Generation cancelled. ${received.length} of ${totalParts} sections are kept in your preview. Your manuscript has not changed.`
              : "Generation cancelled. Your manuscript and previous draft are safe.",
          },
          currentScope,
        );
      else
        patch(
          {
            error:
              error instanceof Error
                ? error.message
                : "The writing service could not be reached. Please try again.",
            ...(received.length
              ? {
                  status: `Stopped after ${received.length} of ${totalParts} sections. Your completed text is kept below; no request will be retried automatically.`,
                }
              : {}),
          },
          currentScope,
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPendingScope(null);
      }
    }
  }

  function insert(replace: boolean) {
    if (busy || !draft.result?.text.trim()) return;
    if (
      replace &&
      (!draft.originalSelection || selection !== draft.originalSelection)
    ) {
      patch({
        error:
          "The selection has changed. Select the original passage again, or add this draft to the end of this chapter.",
      });
      return;
    }
    onInsert(draft.result.text, replace);
    patch({
      status: replace
        ? "Replacement sent to your manuscript."
        : "Draft added to your manuscript.",
    });
  }

  function enterSummary() {
    patch({
      mode: "summary",
      length: 65,
      unit: "words",
      summaryScope: selection.trim() ? "passage" : "chapter",
    });
  }

  return (
    <aside
      className="companion"
      aria-label="Writing companion"
      dir={book.direction === "auto" ? undefined : book.direction}
    >
      <div className="companion-heading">
        <h2>A little inspiration</h2>
        <p>Big stories begin with small ideas.</p>
        <div className="companion-ready" role="status">
          <CheckCircle2 size={14} />
          <span>Free writing, summaries and art are ready without setup.</span>
        </div>
      </div>
      <div className="companion-tabs" role="group" aria-label="Writing task">
        <button
          type="button"
          aria-pressed={!refining && !summarizing}
          className={!refining && !summarizing ? "active" : ""}
          onClick={() => patch({ mode: "develop" })}
        >
          Write
        </button>
        <button
          type="button"
          aria-pressed={summarizing}
          className={summarizing ? "active" : ""}
          onClick={enterSummary}
        >
          Summarize
        </button>
        <button
          type="button"
          aria-pressed={refining}
          className={refining ? "active" : ""}
          onClick={() => patch({ mode: "polish" })}
        >
          Refine
        </button>
      </div>
      <form
        className="companion-form"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <label className="field companion-idea">
          <span>
            {summarizing
              ? "The idea to shape"
              : refining
                ? "What would you like to change?"
                : "Your idea"}
          </span>
          <textarea
            value={draft.idea}
            onChange={(event) => patch({ idea: event.target.value })}
            rows={4}
            placeholder={
              refining
                ? "Keep the tenderness, but let the tension show through the dialogue…"
                : "A woman receives a letter from a house that no longer exists…"
            }
            maxLength={12000}
          />
        </label>
        {summarizing && draft.summaryScope === "idea" && !draft.idea.trim() && (
          <p className="error-message">
            Add an idea to build an idea-only summary.
          </p>
        )}
        {selection && (
          <div className="selection-note">
            <PenLine size={13} />
            <span>
              {countWords(selection).toLocaleString()} selected words will guide
              this draft.
            </span>
          </div>
        )}
        {summarizing && (
          <label className="field summary-scope-field">
            <span>What should the summary cover?</span>
            <select
              aria-label="Summary scope"
              value={draft.summaryScope}
              onChange={(event) =>
                patch({ summaryScope: event.target.value as SummaryScope })
              }
            >
              <option value="idea">Your idea or premise</option>
              <option value="book">The whole book</option>
              <option value="chapter">This chapter</option>
              <option value="passage">This page or selected passage</option>
            </select>
            <small className="hint">
              Give Folio a rough idea, then choose how much of your story it
              should hold.
            </small>
          </label>
        )}
        {refining && !selection && (
          <p className="hint">
            Select a passage in your manuscript to refine it. Without a
            selection, your current chapter provides the context.
          </p>
        )}
        {!summarizing && (
          <div className="companion-mode-grid">
            {(refining
              ? modes.filter((mode) => mode.refine)
              : modes.filter((mode) =>
                  ["continue", "scene"].includes(mode.value),
                )
            ).map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={`companion-mode ${draft.mode === mode.value ? "selected" : ""}`}
                onClick={() => patch({ mode: mode.value })}
                aria-pressed={draft.mode === mode.value}
              >
                {mode.value === "continue" ? (
                  <WandSparkles size={17} />
                ) : (
                  <PenLine size={17} />
                )}
                <span>{mode.label}</span>
                {draft.mode === mode.value && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
        {!refining && !summarizing && (
          <label className="field companion-more">
            <span className="sr-only">Writing mode</span>
            <select
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as GenerationMode;
                if (mode === "summary") enterSummary();
                else patch({ mode });
              }}
            >
              {modes
                .filter((mode) => !mode.refine)
                .map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className={`field ${summarizing ? "summary-length-field" : ""}`}>
          <span>{summarizing ? "Summary length" : "Length"}</span>
          {summarizing && (
            <div
              className="summary-lengths"
              role="group"
              aria-label="Summary length"
            >
              {[
                { label: "One sentence", words: 28 },
                { label: "A few sentences", words: 65 },
                { label: "Short paragraph", words: 120 },
                { label: "Detailed page", words: 250 },
              ].map((option) => (
                <button
                  type="button"
                  key={option.label}
                  className={
                    draft.unit === "words" && draft.length === option.words
                      ? "selected"
                      : ""
                  }
                  aria-pressed={
                    draft.unit === "words" && draft.length === option.words
                  }
                  onClick={() => patch({ unit: "words", length: option.words })}
                >
                  <strong>{option.label}</strong>
                  <small>{option.words} words</small>
                </button>
              ))}
            </div>
          )}
          <div className="companion-length">
            <input
              aria-label="Desired length"
              type="number"
              min="1"
              max={Math.floor(maximumWords / factor[draft.unit])}
              step="1"
              value={draft.length || ""}
              onChange={(event) =>
                patch({ length: Number(event.target.value) })
              }
            />
            <select
              aria-label="Length unit"
              value={draft.unit}
              onChange={(event) => {
                const unit = event.target.value as Draft["unit"];
                patch({
                  unit,
                  length: Math.min(
                    Math.max(1, draft.length),
                    Math.floor(maximumWords / factor[unit]),
                  ),
                });
              }}
            >
              <option value="words">Words</option>
              <option value="lines">Lines</option>
              <option value="pages">Pages</option>
            </select>
          </div>
          <small className={validLength ? "hint" : "error-message"}>
            {validLength
              ? `About ${targetWords.toLocaleString()} words · ${draft.unit === "words" ? "a target, not an exact count" : "an estimate"}`
              : `Choose a length between 1 and ${maximumWords.toLocaleString()} words.`}
          </small>
          {refining && (
            <small className="hint">
              Refine works on one passage at a time, up to 5,000 target words.
              Choose Write to develop a longer draft.
            </small>
          )}
          {!refining &&
            !summarizing &&
            validLength &&
            targetWords > browserWordsPerPart && (
              <small className="hint">
                Written in bounded sections, each kept as it arrives. Long
                drafts can take a while and use more model time. Add story bible
                notes and a chapter synopsis to help maintain continuity.
              </small>
            )}
        </div>
        <label className="field">
          <span>Voice &amp; atmosphere</span>
          <select
            value={draft.voice}
            onChange={(event) => patch({ voice: event.target.value })}
          >
            {[
              "Lyrical & intimate",
              "Clear & understated",
              "Atmospheric & mysterious",
              "Warm & observant",
              "Sharp & compelling",
              "Playful & imaginative",
              "Follow my own voice",
            ].map((voice) => (
              <option key={voice}>{voice}</option>
            ))}
          </select>
        </label>
        <details className="companion-advanced">
          <summary>
            Fine-tune the perspective <ChevronDown size={13} />
          </summary>
          <div className="companion-advanced-fields">
            <label className="field">
              <span>Point of view</span>
              <select
                value={draft.perspective}
                onChange={(event) => patch({ perspective: event.target.value })}
              >
                {[
                  "Follow the chapter",
                  "First person",
                  "Third person limited",
                  "Third person omniscient",
                  "Second person",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tense</span>
              <select
                value={draft.tense}
                onChange={(event) => patch({ tense: event.target.value })}
              >
                {["Follow the chapter", "Past tense", "Present tense"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <p className="hint">
              Your book language, voice notes, story bible and chapter context
              travel with the request.
            </p>
          </div>
        </details>
        {busy ? (
          <div className="companion-busy">
            <div role="status">
              <LoaderCircle size={17} className="spinning" />
              <span>
                {progress.total > 1
                  ? `Writing section ${progress.part} of ${progress.total}…`
                  : "Finding the words…"}
              </span>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => request.current?.abort()}
            >
              <X size={14} /> Cancel
            </button>
            {progress.total > 1 && (
              <progress
                className="companion-progress"
                aria-label="Draft sections completed"
                value={progress.completed}
                max={progress.total}
              />
            )}
            <p className="hint">
              {progress.total > 1
                ? `${progress.words.toLocaleString()} words received. Cancel at any time to review or insert completed sections.`
                : "Longer passages can take a little time."}
            </p>
          </div>
        ) : (
          <button
            className="button primary companion-generate"
            type="submit"
            disabled={
              !validLength ||
              !validIdeaOnlySummary ||
              (!summarizing && draft.mode === "develop" && !draft.idea.trim())
            }
          >
            <Sparkles size={17} />
            {modes.find((mode) => mode.value === draft.mode)?.label}
          </button>
        )}
        {draft.error && (
          <div className="error-message" role="alert">
            {draft.error}
            {draft.needsSettings && (
              <button
                type="button"
                className="companion-text-button"
                onClick={onSettings}
              >
                Optional: connect a larger model{" "}
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        )}
      </form>
      {draft.result && (
        <div className="companion-result" ref={resultRef}>
          <div className="companion-result-header">
            <h3>
              {summarizing
                ? "A clear shape for your story"
                : draft.parts
                  ? "Your unfolding draft"
                  : "A possible beginning"}
            </h3>
            <span>
              {draft.result.source === "local-model"
                ? "Automatic local model · "
                : draft.result.source === "browser"
                  ? "Free on-device model · "
                  : draft.result.source === "local"
                    ? "Free offline draft · "
                    : draft.result.source === "provider"
                      ? "Connected model · "
                      : ""}
              {resultWordCount.toLocaleString()} words
            </span>
          </div>
          {draft.result.incomplete && !busy && (
            <p className="companion-partial" role="status">
              {draft.parts
                ? `This draft stopped with ${draft.parts.completed} of ${draft.parts.total} sections received. The received text is kept below, including any partial passage. Review it before inserting, then use Continue to develop it further.`
                : "The provider returned a partial passage. Review it before inserting, then use Continue to develop it further."}
            </p>
          )}
          <textarea
            aria-label="Generated draft to review and edit"
            value={draft.result.text}
            readOnly={busy}
            onChange={(event) =>
              patch({ result: { ...draft.result!, text: event.target.value } })
            }
            rows={11}
            dir={book.direction === "auto" ? "auto" : book.direction}
          />
          <p className="hint">
            {busy
              ? "Preview updates as sections arrive · cancel to edit"
              : "Editable preview"}{" "}
            · target {draft.result.targetWords.toLocaleString()} words
          </p>
          <div className="companion-result-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => insert(false)}
              disabled={busy || !draft.result.text.trim()}
            >
              <ArrowDownToLine size={15} /> Add to manuscript
            </button>
            {draft.originalSelection && (
              <button
                type="button"
                className="button secondary"
                onClick={() => insert(true)}
                disabled={
                  busy ||
                  selection !== draft.originalSelection ||
                  !draft.result.text.trim()
                }
              >
                Replace selected passage
              </button>
            )}
          </div>
          {draft.originalSelection && selection !== draft.originalSelection && (
            <p className="hint">
              Your selection has changed. Re-select the original passage to
              replace it.
            </p>
          )}
        </div>
      )}
      {draft.status && (
        <p className="companion-status" role="status">
          {draft.status}
        </p>
      )}
      {storageError && (
        <p className="error-message" role="alert">
          Your browser could not keep this preview for reopening. Add any words
          you want to keep to your manuscript before leaving this page.
        </p>
      )}
      {draft.result?.source === "local" && !busy && (
        <button
          type="button"
          className="companion-text-button companion-upgrade"
          onClick={onSettings}
        >
          Optional: connect a larger model for another pass{" "}
          <span aria-hidden="true">→</span>
        </button>
      )}
      <div className="companion-footer">
        <h3>Make it your own</h3>
        <p>
          Your free writing partner is ready offline, with an on-device model
          loading automatically when your browser supports WebGPU. Use your
          voice and keep your story consistent.
          <br />
          You’re in control—always.
        </p>
        <img
          className="companion-landscape"
          src={assetUrl("assets/tide-illustration.png")}
          alt=""
          aria-hidden="true"
        />
      </div>
    </aside>
  );
}
