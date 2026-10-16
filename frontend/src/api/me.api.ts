import { api } from "./client";

export type Me = { id: string; email: string | null; name: string | null; isOwner: boolean };

export const getMe = () => api.get<Me>("/me");
