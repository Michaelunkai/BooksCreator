import type { Book, Chapter, Workspace } from "../types";
import { textToHtml } from "./text";

export function createChapter(title = "Untitled chapter"): Chapter {
  return {
    id: crypto.randomUUID(),
    title,
    content: "<p></p>",
    synopsis: "",
    status: "draft",
    versions: [],
  };
}

export function createBook(title = "Untitled book"): Book {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    subtitle: "",
    author: "",
    genre: "Literary fiction",
    language: "English",
    direction: "auto",
    voiceSample: "",
    voiceNotes: "",
    targetWords: 500,
    chapters: [createChapter("Chapter one")],
    bible: [],
    images: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createSeedWorkspace(): Workspace {
  const book = createBook("The House of Tides");
  book.id = "sample-book";
  book.subtitle = "Some things the sea gives back.";
  book.genre = "Literary mystery";
  book.voiceNotes =
    "Intimate, observant prose. Concrete coastal details, quiet tension, and warmth beneath the grief. Let objects carry memory. Avoid explaining every feeling.";
  book.chapters = [
    createChapter("The letter"),
    createChapter("A familiar stranger"),
    createChapter("What the sea kept"),
  ];
  book.chapters[0].content =
    textToHtml(`The letter arrived on a Tuesday, which seemed an ordinary sort of day for a life to come undone.

Mara found it beneath a gas bill and a leaflet advertising windows. The envelope was the colour of weak tea. Her name had been written in blue ink, in a hand she knew before she allowed herself to know it.

Outside, someone was trying to start a motorcycle. The engine caught, failed, caught again. She stood in the narrow hall with her coat still on and listened until the street fell quiet.

Her mother had been dead for eleven years.

Mara put the letter on the kitchen table. She filled the kettle. Emptied it. Filled it again. There were sensible explanations for a thing like this, and she intended to give them every opportunity to arrive.

At last she slid a thumbnail beneath the flap.

Inside was a key, a photograph, and a single sheet of paper. The photograph showed the house at Bellweather as she remembered it: windows silver with reflected water, the crooked drainpipe, the steps that disappeared at high tide. On the back, in the same blue ink, someone had written a date. Last Thursday.

She turned to the letter.

My darling girl,

Before you decide what you believe, come and see the house.

That was all. No explanation. No apology. Nothing about the winter morning when the police had come to their door, or the years Mara had spent learning to say had instead of has.

The key was cold against her palm. She remembered its particular weight. Her mother used to leave it in a cracked cup beside the stove, beneath a handful of foreign coins they had never spent.

Mara took out her phone. Then she put it away.

There was no one she could call who would know what to do with a mother returned by post.`);
  book.chapters[0].synopsis =
    "Mara receives a letter in her late mother’s handwriting, containing the key to their old coastal house and a photograph apparently taken last week.";
  book.chapters[1].synopsis =
    "Mara returns to Bellweather after eleven years. The town remembers more than she does.";
  book.chapters[2].synopsis =
    "The tide uncovers a clue below the house. Mara must decide whom to trust.";
  book.voiceSample =
    "The envelope was the colour of weak tea. Her name had been written in blue ink, in a hand she knew before she allowed herself to know it.";
  book.bible = [
    {
      id: crypto.randomUUID(),
      kind: "character",
      name: "Mara Vale",
      details:
        "Thirty-four. A book conservator living inland. Left Bellweather after her mother’s death eleven years ago. Practical with objects, evasive with feelings. Has not yet told anyone about the letter.",
    },
    {
      id: crypto.randomUUID(),
      kind: "character",
      name: "Eleanor Vale",
      details:
        "Mara’s mother, presumed dead after a winter disappearance eleven years earlier. Kept foreign coins in a cracked cup. Her handwriting uses blue ink. Whether she is alive is an unresolved mystery; do not decide prematurely.",
    },
    {
      id: crypto.randomUUID(),
      kind: "place",
      name: "The house at Bellweather",
      details:
        "An old coastal house with a crooked drainpipe and stone steps submerged at high tide. Its windows reflect the sea. A key was kept in a cracked cup beside the stove.",
    },
    {
      id: crypto.randomUUID(),
      kind: "plot",
      name: "The impossible photograph",
      details:
        "Arrives on Tuesday. The handwritten date is the previous Thursday. Establish who took it and why it was sent. The envelope contains only a key, a photograph, and a short letter.",
    },
    {
      id: crypto.randomUUID(),
      kind: "world",
      name: "Grounding the mystery",
      details:
        "Contemporary coastal Britain. Begin with plausible human explanations. Weather and tides affect access to the house. Keep the exact town and geography fictional.",
    },
  ];
  book.images = [
    {
      id: crypto.randomUUID(),
      url: "/assets/tide-illustration.png",
      prompt:
        "An atmospheric coastal house above tidal stone steps, seen across a quiet bay.",
      style: "Etching",
      caption: "The house at Bellweather",
      chapterId: book.chapters[0].id,
      createdAt: new Date().toISOString(),
    },
  ];
  return { version: 1, books: [book], activeBookId: book.id };
}
