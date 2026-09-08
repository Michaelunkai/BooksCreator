import type {
  Book,
  Chapter,
  GenerateRequest,
  GenerateResult,
  SummaryScope,
} from "../types";
import { stripHtml, wordCount } from "./text";

/**
 * Folio's no-setup writing path.
 *
 * This is deliberately a small, deterministic writing aid rather than a
 * pretend cloud model. It gives an author a useful first pass when no paid or
 * hosted provider is connected, while keeping the provider path available for
 * users who want a larger model later.
 */

const stopWords = new Set(
  "a an and are as at be been before but by can could did do for from had has have he her hers him his i if in into is it its me more my no not of on or our she should so that the their them there these they this to was we were what when where which who will with would you your".split(
    " ",
  ),
);

const proseOpenings = [
  "The thought had been small when it first arrived, but it refused to stay that way.",
  "By morning, the idea had acquired a weight of its own.",
  "There are moments that ask for no permission before they alter a life.",
  "Nothing in the room announced a beginning, which was how beginnings often preferred to enter.",
  "The day carried on with its ordinary noises, leaving the important thing almost unnoticed.",
  "At first, there was only the detail that would not leave them alone.",
];

const continuationOpenings = [
  "The thought followed them into the next room, where it became harder to call accidental.",
  "At the edge of the familiar, the idea began to show its second shape.",
  "They returned to the matter slowly, giving each ordinary task a chance to explain it away.",
  "By then, the question had entered the day so completely that silence seemed to repeat it.",
  "The room offered its small facts first: dust in the corner, a cup gone cold, light caught on the latch.",
  "What had seemed like a private unease now had a place in the world, and the world was answering back.",
  "Nothing about the next step looked dramatic. That was what made it possible to take.",
  "They listened for an explanation and heard, instead, the beginning of a choice.",
];

const observations = [
  "A familiar object held the light differently, as if it had been waiting to be seen.",
  "Outside, the world supplied its quiet evidence: a passing engine, a bird on the wire, water moving under stone.",
  "They noticed the kind of detail that usually disappears—the worn edge, the unfinished cup, the mark beside the door.",
  "Memory did not return as a picture. It came back in textures, temperatures, and the names of things once taken for granted.",
  "The silence between one sound and the next seemed to make room for a decision.",
  "For a while, the simplest explanation was also the one they wanted most to believe.",
];

const movements = [
  "They moved closer, not because they were ready, but because distance had stopped protecting them.",
  "The next choice was modest enough to look harmless. It was still a choice.",
  "A question was asked and left unanswered long enough to become an answer of its own.",
  "They began with what could be touched, measured, or carried, and only then approached what could not.",
  "The old fear returned with a new face, and this time it had somewhere to go.",
  "When the practical work was done, the emotional work remained, patient as weather.",
];

const turns = [
  "Then one fact shifted, almost imperceptibly, and the whole arrangement of the day changed with it.",
  "The detail they had dismissed proved to be the hinge on which everything else turned.",
  "What arrived next was not an explanation, but an invitation to look again.",
  "They understood that the past was not asking to be forgiven. It was asking to be named accurately.",
  "Somewhere beyond the immediate trouble, another life was already making its quiet demand.",
  "The answer did not make the danger smaller. It made the next step possible.",
];

const endings = [
  "They kept going, carrying the uncertainty carefully, like a glass filled almost to the rim.",
  "Nothing was settled. Still, the world had acquired a direction.",
  "For the first time that day, the future felt less like a wall than a door left unlatched.",
  "They made a note of what mattered and left the rest for the morning.",
  "The ordinary world returned, changed only by the fact that they now knew where to look.",
  "Afterward, they would remember the smallness of the beginning and the size of what followed.",
];

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function pick<T>(items: T[], seed: number, offset: number): T {
  return items[(seed + offset * 31) % items.length];
}

function plain(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function sentences(value: string): string[] {
  return plain(value)
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12);
}

function fitWords(value: string, target: number): string {
  if (target <= 0) return "";
  const normalized = value.trim();
  const tokens = Array.from(normalized.matchAll(/\S+/gu));
  if (tokens.length <= target) return normalized;
  const last = tokens[target - 1];
  const end = (last.index ?? 0) + last[0].length;
  let result = normalized
    .slice(0, end)
    .trim()
    .replace(/[,:;—-]+$/u, "");
  if (!/[.!?…]$/u.test(result)) result += "…";
  return result;
}

function ideaCore(request: GenerateRequest): string {
  const source = plain(
    request.summaryScope === "idea"
      ? request.idea
      : request.idea || request.selection || "",
  );
  if (!source) return "something long kept hidden";
  const tokens = source
    .replace(/[^\p{L}\p{N}'’\-\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token.toLowerCase()));
  return tokens.slice(0, 12).join(" ") || source;
}

function ideaPhrase(request: GenerateRequest): string {
  const source = plain(
    request.summaryScope === "idea"
      ? request.idea
      : request.idea || request.selection || "",
  );
  return (source || ideaCore(request)).replace(/[.!?…]+$/u, "");
}

function lowerFirst(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function leadCharacter(book: Book): string {
  return (
    book.bible.find((note) => note.kind === "character")?.name ||
    "the main character"
  );
}

function placeName(book: Book): string {
  return (
    book.bible.find((note) => note.kind === "place")?.name ||
    "the place they had tried not to remember"
  );
}

function illustrationStoryCues(book: Book): string {
  const notePriority: Record<Book["bible"][number]["kind"], number> = {
    character: 0,
    plot: 1,
    place: 2,
    world: 3,
    note: 4,
  };
  return book.bible
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => note.name.trim() || note.details.trim())
    .sort(
      (left, right) =>
        notePriority[left.note.kind] - notePriority[right.note.kind] ||
        left.index - right.index,
    )
    .slice(0, 12)
    .map(({ note }) => {
      const name = note.name.trim() || "unnamed note";
      const details = note.details.trim().slice(0, 480);
      return `${note.kind}: ${name}${details ? ` — ${details}` : ""}`;
    })
    .join("; ")
    .slice(0, 3600);
}

function chapterText(chapter: Chapter): string {
  return plain(stripHtml(chapter.content));
}

function targetWords(request: GenerateRequest): number {
  return Math.max(
    1,
    Math.round(
      request.length * { words: 1, lines: 12, pages: 250 }[request.unit],
    ),
  );
}

function sourceForSummary(request: GenerateRequest): string {
  const chapter = request.book.chapters.find(
    (item) => item.id === request.chapterId,
  );
  const scope: SummaryScope = request.summaryScope || "chapter";
  if (scope === "idea")
    return request.idea.trim();
  if (scope === "passage")
    return (
      request.selection.trim() ||
      request.idea.trim() ||
      (chapter ? chapterText(chapter) : "")
    );
  if (scope === "book") {
    return request.book.chapters
      .map((item) =>
        [item.title, item.synopsis, chapterText(item)]
          .filter(Boolean)
          .join(". "),
      )
      .join(" ");
  }
  return [chapter?.synopsis, chapter ? chapterText(chapter) : ""]
    .filter(Boolean)
    .join(" ");
}

function makeSummary(request: GenerateRequest, target: number): string {
  const source = sentences(sourceForSummary(request));
  const core = ideaPhrase(request);
  const scope = request.summaryScope || "chapter";
  const hasAuthorIdea =
    scope === "idea"
      ? Boolean(request.idea.trim())
      : Boolean(request.idea.trim() || request.selection.trim());
  const character = scope === "idea" ? "the central figure" : leadCharacter(request.book);
  const place = scope === "idea" ? "an uncertain place" : placeName(request.book);
  const first = source[0] || `The story begins with ${core}.`;
  const second = source[1] || `It draws ${character} toward ${place}.`;
  const third =
    source[2] ||
    "A choice brings the hidden consequences into view, and the character must decide what can still be changed.";
  const fourth =
    "The result is a human story about what we inherit, what we refuse, and what we choose to carry forward.";
  const opening =
    scope === "idea"
      ? hasAuthorIdea
        ? `The premise is this: ${lowerFirst(core)}.`
        : `The story begins with ${character} and a question they cannot set aside.`
      : scope === "book"
        ? hasAuthorIdea
          ? `A ${request.book.genre || "literary"} story in which ${lowerFirst(core)}.`
          : `A ${request.book.genre || "literary"} story about ${character} and the choices waiting in ${place}.`
        : scope === "passage"
          ? hasAuthorIdea
            ? `This passage asks what happens when ${lowerFirst(core)}.`
            : `This passage captures a turning point for ${character}.`
          : hasAuthorIdea
            ? `This chapter follows ${character} as ${lowerFirst(core)}.`
            : `This chapter follows ${character} through a moment of change.`;
  // The shortest summary option is a single, polished sentence. Keep the
  // premise and its consequence in one breath instead of truncating a
  // multi-sentence template at an arbitrary word boundary.
  if (target <= 40) {
    const premise = lowerFirst(core)
      .replace(/[.!?…]+/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const single =
      scope === "idea"
        ? `When ${premise}, the story turns on a choice that changes what can be carried forward.`
        : scope === "book"
          ? `A ${request.book.genre || "literary"} story follows ${character} as ${premise}, and the choices waiting in ${place} begin to matter.`
          : `When ${premise}, ${character} is drawn toward ${place}, where a small choice begins to change what can be carried forward.`;
    return fitWords(single, target);
  }
  if (scope === "idea" && hasAuthorIdea) {
    return fitWords(
      [
        `The premise begins when ${lowerFirst(core)}.`,
        source[0] ||
          "The first disturbance makes an ordinary explanation impossible to keep.",
        "As its consequences gather, the central figure must decide what the new truth asks them to risk.",
        "The story's pressure comes from the distance between what seemed possible and what the choice finally makes necessary.",
      ].join(" "),
      target,
    );
  }
  return fitWords([opening, first, second, third, fourth].join(" "), target);
}

function makeOutline(request: GenerateRequest, target: number): string {
  const core = lowerFirst(ideaPhrase(request));
  const character = leadCharacter(request.book);
  const place = placeName(request.book);
  const lines = [
    `1. Opening image — establish ${character} in ${place}, with a central question: ${core}.`,
    `2. Complication — a concrete discovery makes the original explanation insufficient.`,
    `3. Choice — ${character} must act before certainty arrives, revealing what they value.`,
    `4. Consequence — the action changes a relationship and exposes a larger question beneath the plot.`,
    `5. Turn — a specific detail from the opening returns with a different meaning.`,
    `6. Next movement — leave the story with a reachable objective and one cost that cannot be avoided.`,
  ];
  return fitWords(lines.join("\n"), target);
}

function makeDialogue(request: GenerateRequest, target: number): string {
  const core = lowerFirst(ideaPhrase(request));
  const character = leadCharacter(request.book);
  const other =
    request.book.bible.find(
      (note) => note.kind === "character" && note.name !== character,
    )?.name || "the other voice";
  const dialogue = [
    `“You said it was over,” ${character} said.`,
    `${other} looked toward the window. “I said I wanted it to be.”`,
    `“That is not the same thing.”`,
    `“No,” ${other} said. “It is the part that comes before the same thing.”`,
    `The silence made room for the thought neither of them had named: ${core}.`,
    `“Then tell me what happens next.”`,
    `${other} took a breath. “We find out what the truth is willing to cost.”`,
  ];
  return fitWords(dialogue.join("\n\n"), target);
}

function makePolished(request: GenerateRequest, target: number): string {
  const source =
    request.selection.trim() ||
    chapterText(
      request.book.chapters.find((item) => item.id === request.chapterId) ||
        request.book.chapters[0],
    );
  if (!source)
    return fitWords(`Hold on to this thought: ${ideaCore(request)}.`, target);
  const polished = plain(source)
    .replace(/\b(very|really|quite|just|perhaps)\s+/gi, "")
    .replace(/\b(\w+)\s+\1\b/gi, "$1");
  return fitWords(polished, target);
}

function makeShorter(request: GenerateRequest, target: number): string {
  const source =
    request.selection.trim() ||
    chapterText(
      request.book.chapters.find((item) => item.id === request.chapterId) ||
        request.book.chapters[0],
    );
  const selected = sentences(source).slice(0, 8).join(" ");
  return fitWords(
    selected || `The essential thought is ${ideaCore(request)}.`,
    target,
  );
}

function makeProse(
  request: GenerateRequest,
  target: number,
  scene: boolean,
): string {
  const seed = hash(
    [
      request.book.title,
      request.chapterId,
      request.idea,
      request.selection,
    ].join("|") || "folio",
  );
  const character = leadCharacter(request.book);
  const core = ideaPhrase(request).replace(/[.!?…]+$/u, "");
  const existing = sentences(
    request.selection ||
      chapterText(
        request.book.chapters.find((item) => item.id === request.chapterId) ||
          request.book.chapters[0],
      ),
  );
  const paragraphs: string[] = [];
  let produced = 0;
  let index = 0;
  while (produced < target && index < 1200) {
    // A continuation should use the chapter as context without copying its
    // sentences into the new passage. Repeating an existing sentence makes a
    // reviewable draft feel stitched together and can duplicate manuscript
    // text when it is inserted.
    const contextualDetail =
      request.mode === "continue"
        ? pick(observations, seed, index + 2)
        : existing[index % Math.max(1, existing.length)] ||
          pick(observations, seed, index + 2);
    const opening =
      index === 0
        ? pick(proseOpenings, seed, index)
        : pick(continuationOpenings, seed, index + 1);
    const ideaAnchor =
      index === 0
        ? `At the center of the thought was ${lowerFirst(core)}, though it had not yet found its consequence.`
        : "";
    const paragraph = [
      opening,
      ideaAnchor,
      contextualDetail,
      scene
        ? `In the space between one movement and the next, ${character} noticed what the room was asking them to admit.`
        : pick(movements, seed, index + 3),
      index % 3 === 1
        ? pick(turns, seed, index + 4)
        : pick(observations, seed, index + 5),
      pick(endings, seed, index + 6),
    ].filter(Boolean).join(" ");
    paragraphs.push(paragraph);
    produced += wordCount(paragraph);
    index += 1;
  }
  return fitWords(paragraphs.join("\n\n"), target);
}

export function generateLocal(request: GenerateRequest): GenerateResult {
  const target = targetWords(request);
  let text: string;
  switch (request.mode) {
    case "summary":
      text = makeSummary(request, target);
      break;
    case "outline":
      text = makeOutline(request, target);
      break;
    case "dialogue":
      text = makeDialogue(request, target);
      break;
    case "polish":
      text = makePolished(request, target);
      break;
    case "shorten":
      text = makeShorter(request, target);
      break;
    case "continue":
      text = makeProse(request, target, false);
      break;
    case "scene":
      text = makeProse(request, target, true);
      break;
    case "develop":
    default:
      text = makeProse(request, target, false);
      break;
  }
  return {
    text: text.trim(),
    wordCount: wordCount(text),
    targetWords: target,
    incomplete: false,
    source: "local",
  };
}

export function localIllustrationPrompt(
  request: Pick<
    GenerateRequest,
    "book" | "chapterId" | "selection" | "idea"
  > & {
    excerpt?: string;
    style?: string;
    direction?: string;
  },
): string {
  const chapter = request.book.chapters.find(
    (item) => item.id === request.chapterId,
  );
  const chapterContext = chapter
    ? [chapter.title.trim(), chapter.synopsis.trim()]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 700)
    : "";
  const storyCues = illustrationStoryCues(request.book);
  return [
    "Folio local art study — a text-grounded illustration generated on this computer.",
    `Style: ${request.style || "literary mixed media"}.`,
    `Story moment: ${plain(request.excerpt || request.selection || request.idea || chapter?.synopsis || "a quiet turning point")}.`,
    request.direction?.trim()
      ? `Art direction: ${plain(request.direction)}.`
      : "",
    chapterContext ? `Chapter context: ${chapterContext}.` : "",
    storyCues ? `Story-bible cues: ${storyCues}.` : `Setting cues: ${placeName(request.book)}.`,
    "This is a visual starting point for the author to review and make their own.",
  ].join(" ");
}
