export type ChapterStatus = "draft" | "revised" | "final";
export interface Revision {
  id: string;
  name: string;
  createdAt: string;
  title: string;
  content: string;
}
export interface Chapter {
  id: string;
  title: string;
  content: string;
  synopsis: string;
  status: ChapterStatus;
  versions: Revision[];
}
export interface StoryNote {
  id: string;
  kind: "character" | "place" | "plot" | "world" | "note";
  name: string;
  details: string;
}
export interface Illustration {
  id: string;
  url: string;
  prompt: string;
  style: string;
  caption: string;
  chapterId: string;
  createdAt: string;
}
export interface Book {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  genre: string;
  language: string;
  direction: "auto" | "ltr" | "rtl";
  voiceSample: string;
  voiceNotes: string;
  targetWords: number;
  chapters: Chapter[];
  bible: StoryNote[];
  images: Illustration[];
  createdAt: string;
  updatedAt: string;
}
export interface Workspace {
  version: 1;
  books: Book[];
  activeBookId: string;
}
export interface Settings {
  configured: boolean;
  provider: "openai" | "compatible";
  baseUrl: string;
  textModel: string;
  imageModel: string;
  localModelAvailable?: boolean;
  localModelName?: string;
  localModelContext?: number;
}
export type GenerationMode =
  | "develop"
  | "continue"
  | "scene"
  | "polish"
  | "dialogue"
  | "shorten"
  | "outline"
  | "summary";
export type SummaryScope = "idea" | "book" | "chapter" | "passage";
export interface GenerateRequest {
  book: Book;
  chapterId: string;
  idea: string;
  selection: string;
  mode: GenerationMode;
  length: number;
  unit: "words" | "lines" | "pages";
  voice: string;
  perspective: string;
  tense: string;
  summaryScope?: SummaryScope;
}
export interface GenerateResult {
  text: string;
  wordCount: number;
  targetWords: number;
  incomplete: boolean;
  source?: "local" | "browser" | "local-model" | "provider";
}
export interface IllustrateRequest {
  book: Book;
  chapterId: string;
  excerpt: string;
  direction: string;
  style: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
}
