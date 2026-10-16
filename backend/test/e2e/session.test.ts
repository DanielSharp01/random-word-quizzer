import { describe, expect, it } from "vitest";
import { anonymous, newUser } from "../support/helpers";

describe("session", () => {
  it("refuses calls without a session", async () => {
    expect((await anonymous("/api/me")).status).toBe(401);
  });

  it("sends Google back to API_HOST, whatever host the request came in on", async () => {
    const res = await anonymous("/auth/google/authorize?returnTo=/");
    expect(res.status).toBe(302);
    const google = new URL(res.headers.get("location")!);
    expect(google.searchParams.get("redirect_uri")).toBe("http://localhost:5173/auth/google/callback");
  });

  it("tells a signed-in person who they are", async () => {
    const u = await newUser();
    const res = await u.get("/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: u.id, email: expect.stringContaining("@example.com"), name: "Test" });
  });
});
