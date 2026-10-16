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
  percent: number;
  minLength: number;
  blankCount: number;
  blocks: { kind: BlockKind; segments: Segment[] }[];
  answers: Answer[];
};

export type QuestionsAttempt = AttemptBase & { kind: "questions"; section: string; questions: Question[] };

export type Attempt = BlanksAttempt | QuestionsAttempt;

export type AttemptSettings = { kind?: "blanks"; percent: number; minLength: number } | { kind: "questions"; section: number | null; count: number };

export type Section = { index: number; title: string; fromBlock: number; toBlock: number; chars: number };

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

export const getSections = (documentId: string) => api.get<{ sections: Section[]; maxChars: number }>(`/documents/${documentId}/sections`);

export const getHistory = (documentId?: string) =>
  api.get<{ attempts: PastAttempt[] }>(`/attempts${documentId ? `?documentId=${documentId}` : ""}`);

export const answerQuestion = (attemptId: string, position: number, answer: string) =>
  api.post<Question>(`/attempts/${attemptId}/questions/${position}/answer`, { answer });
