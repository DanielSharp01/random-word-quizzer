import { api } from "./client";

export type AiStatus = {
  configured: boolean;
  connected: boolean;
  broken: boolean;
  accountEmail: string | null;
  model: string | null;
  hourlyTokenLimit: number;
  dailyTokenLimit: number;
  maxOutputTokens: number;
  usage: { lastHour: number; lastDay: number };
  usageByHour: { hour: string; calls: number; totalTokens: number; estimatedCalls: number }[];
};

export type AiSettings = Pick<AiStatus, "model" | "hourlyTokenLimit" | "dailyTokenLimit" | "maxOutputTokens">;

export type AiTry = { text: string; truncated: boolean; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };

export const getStatus = () => api.get<AiStatus>("/ai/connection");
export const startConnecting = () => api.post<{ authorizeUrl: string }>("/ai/connection/start");
export const finishConnecting = (callbackUrl: string) => api.post<AiStatus>("/ai/connection/finish", { callbackUrl });
export const disconnect = () => api.delete("/ai/connection");
export const getModels = () => api.get<{ models: { slug: string; name: string }[] }>("/ai/models");
export const saveSettings = (settings: AiSettings) => api.put<AiStatus>("/ai/settings", settings);
export const tryPrompt = (input: string) => api.post<AiTry>("/ai/try", { input });
