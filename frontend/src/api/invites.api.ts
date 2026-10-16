import { api } from "./client";

export type IssuedInvite = { id: string; url: string; expiresAt: string };
export type PendingInvite = { id: string; name: string | null; expiresAt: string | null; createdAt: string };

export const getInvites = () => api.get<{ invites: PendingInvite[] }>("/invites");
export const createInvite = (name: string) => api.post<IssuedInvite>("/invites", { name });
export const renewInvite = (id: string) => api.post<IssuedInvite>(`/invites/${id}/renew`);
export const cancelInvite = (id: string) => api.delete(`/invites/${id}`);
