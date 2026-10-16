import { api } from "./client";

export type BlockKind = "heading" | "paragraph" | "listItem";

export type DocumentSummary = { id: string; title: string; blockCount: number; createdAt: string };

export type Segment = { text: string } | { blank: number; length: number };

export type Answer = {
  blank: number;
  guess: string;
  verdict: "correct" | "almost" | "wrong";
  reason: "accent" | "typo" | null;
  answer: string;
};

export type Verdict = "correct" | "almost" | "wrong";

export type Question = {
  position: number;
  question: string;
  answered: {
    guess: string;
    verdict: Verdict;
    feedback: string | null;
    checkedBy: "match" | "ai";
    answer: string;
    keyPoints: string[];
    source: string;
  } | null;
};

type AttemptBase = { id: string; documentId: string; title: string; createdAt: string };

export type BlanksAttempt = AttemptBase & {
  kind: "blanks";
  scope: string;
  percent: number;
  minLength: number;
  blankCount: number;
  /** `gapBefore`: text was skipped between this block and the one before it. */
  blocks: { kind: BlockKind; segments: Segment[]; gapBefore?: true }[];
  answers: Answer[];
};

export type QuestionsAttempt = AttemptBase & { kind: "questions"; section: string; questions: Question[] };

export type Attempt = BlanksAttempt | QuestionsAttempt;

export type BlanksScope = { kind: "document" } | { kind: "section"; index: number } | { kind: "random"; count: number };

export type AttemptSettings =
  | { kind?: "blanks"; percent: number; minLength: number; scope: BlanksScope }
  | { kind: "questions"; section: number | null; count: number };

/** `candidates[n]`: words of n letters the blanking rules could pick (the last slot: n or more). */
export type BlankStats = { candidates: number[]; total: number };

export type Section = { index: number; title: string; titled: boolean; fromBlock: number; toBlock: number; chars: number; blankStats: BlankStats };

export type PastAttempt = {
  id: string;
  kind: Attempt["kind"];
  documentId: string;
  title: string;
  itemCount: number;
  score: Record<Verdict, number>;
  createdAt: string;
};

export const getDocuments = () => api.get<{ documents: DocumentSummary[] }>("/documents");

export function uploadDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api.postForm<DocumentSummary>("/documents", form);
}

export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);

export const startAttempt = (documentId: string, settings: AttemptSettings) => api.post<Attempt>(`/documents/${documentId}/attempts`, settings);

export const getAttempt = (id: string) => api.get<Attempt>(`/attempts/${id}`);

export const postAnswer = (attemptId: string, blank: number, guess: string) => api.post<Answer>(`/attempts/${attemptId}/answers`, { blank, guess });

/** `wholeIsSampled`: the document is too long to send at once, so each attempt draws on random sections. */
export const getSections = (documentId: string) =>
  api.get<{ sections: Section[]; wholeIsSampled: boolean; blankStats: BlankStats }>(`/documents/${documentId}/sections`);

export const getHistory = (documentId?: string) =>
  api.get<{ attempts: PastAttempt[] }>(`/attempts${documentId ? `?documentId=${documentId}` : ""}`);

export const answerQuestion = (attemptId: string, position: number, answer: string) =>
  api.post<Question>(`/attempts/${attemptId}/questions/${position}/answer`, { answer });
