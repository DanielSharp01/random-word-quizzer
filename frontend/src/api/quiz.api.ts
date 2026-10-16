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

export type Attempt = {
  id: string;
  documentId: string;
  title: string;
  percent: number;
  minLength: number;
  blankCount: number;
  blocks: { kind: BlockKind; segments: Segment[] }[];
  answers: Answer[];
};

export type AttemptSettings = { percent: number; minLength: number };

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
