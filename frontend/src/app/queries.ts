import { QueryClient, queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getMe } from "../api/me.api";
import * as quiz from "../api/quiz.api";

export const queryClient = new QueryClient();

const keys = {
  me: ["me"] as const,
  documents: ["documents"] as const,
  attempt: (id: string) => ["attempts", id] as const,
  history: ["history"] as const,
};

export const meQuery = queryOptions({ queryKey: keys.me, queryFn: getMe });
export const useMe = () => useSuspenseQuery(meQuery).data;

const documentsQuery = queryOptions({ queryKey: keys.documents, queryFn: () => quiz.getDocuments().then((r) => r.documents) });
export const useDocuments = () => useSuspenseQuery(documentsQuery).data;

export const useAttempt = (id: string) => useSuspenseQuery({ queryKey: keys.attempt(id), queryFn: () => quiz.getAttempt(id) }).data;

export async function uploadDocument(file: File) {
  await quiz.uploadDocument(file);
  await queryClient.invalidateQueries({ queryKey: keys.documents });
}

export async function deleteDocument(id: string) {
  await quiz.deleteDocument(id);
  await queryClient.invalidateQueries({ queryKey: keys.documents });
}

export async function startAttempt(documentId: string, settings: quiz.AttemptSettings) {
  const attempt = await quiz.startAttempt(documentId, settings);
  queryClient.setQueryData(keys.attempt(attempt.id), attempt);
  void queryClient.invalidateQueries({ queryKey: keys.history });
  return attempt;
}

export async function answerBlank(attemptId: string, blank: number, guess: string) {
  const answer = await quiz.postAnswer(attemptId, blank, guess);
  queryClient.setQueryData<quiz.Attempt>(keys.attempt(attemptId), (attempt) =>
    attempt?.kind === "blanks" ? { ...attempt, answers: [...attempt.answers, answer] } : attempt,
  );
  void queryClient.invalidateQueries({ queryKey: keys.history });
  return answer;
}

export async function answerQuestion(attemptId: string, position: number, answer: string) {
  const question = await quiz.answerQuestion(attemptId, position, answer);
  queryClient.setQueryData<quiz.Attempt>(keys.attempt(attemptId), (attempt) =>
    attempt?.kind === "questions" ? { ...attempt, questions: attempt.questions.map((q) => (q.position === position ? question : q)) } : attempt,
  );
  void queryClient.invalidateQueries({ queryKey: keys.history });
  return question;
}

export const useHistory = (documentId?: string) =>
  useSuspenseQuery({ queryKey: [...keys.history, documentId ?? "all"], queryFn: () => quiz.getHistory(documentId).then((r) => r.attempts) }).data;
