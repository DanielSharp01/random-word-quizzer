import { describe, expect, it } from "vitest";
import { buildDocx } from "../support/docx";
import { newUser, type Client } from "../support/helpers";

type Segment = { text: string } | { blank: number };

/** The blanked words in order, found by matching each block's segments against its original text. */
function blankedWords(blocks: { segments: Segment[] }[], originals: { text: string }[]) {
  return blocks.flatMap(({ segments }, i) => {
    const pattern = segments.map((s) => ("text" in s ? s.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "([\\p{L}\\p{N}]+)")).join("");
    return new RegExp(`^${pattern}$`, "u").exec(originals[i]!.text)!.slice(1);
  });
}

async function upload(u: Client, name = "Ellenőrzési Szabályzat.docx") {
  const file = await buildDocx([
    { text: "Az ellenőrzés alapelvei", style: "Heading1" },
    { text: "Törvényesség, szakszerűség: bármely típusú, szintű vagy módszerű ellenőrzés kizárólag a vonatkozó jogszabályok figyelembevételével végezhető." },
    { text: "Célszerűség, tervszerűség: az ellenőrzés nem lehet öncélú.", listLevel: 0 },
  ]);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file)], name));
  return u.postForm("/documents", form);
}

describe("documents", () => {
  it("reads an uploaded .docx into blocks named after the file", async () => {
    const u = await newUser();
    const res = await upload(u);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Ellenőrzési Szabályzat", blockCount: 3 });

    const doc = await u.get(`/documents/${res.body.id}`);
    expect(doc.body.blocks[0]).toEqual({ kind: "heading", text: "Az ellenőrzés alapelvei" });
    expect((await u.get("/documents")).body.documents.map((d: { id: string }) => d.id)).toEqual([res.body.id]);
  });

  it("refuses a file that isn't a .docx", async () => {
    const u = await newUser();
    const form = new FormData();
    form.append("file", new File(["just text"], "notes.txt"));
    expect((await u.postForm("/documents", form)).status).toBe(422);
  });

  it("keeps each person's documents to themselves", async () => {
    const [owner, other] = [await newUser(), await newUser()];
    const { body } = await upload(owner);
    expect((await other.get(`/documents/${body.id}`)).status).toBe(404);
    expect((await other.post(`/documents/${body.id}/attempts`, {})).status).toBe(404);
    expect((await other.delete(`/documents/${body.id}`)).status).toBe(404);
    expect((await owner.delete(`/documents/${body.id}`)).status).toBe(204);
    expect((await owner.get(`/documents/${body.id}`)).status).toBe(404);
  });
});

describe("attempts", () => {
  it("blanks words, checks each guess once and reveals the word after", async () => {
    const u = await newUser();
    const { body: doc } = await upload(u);
    const { status, body: attempt } = await u.post(`/documents/${doc.id}/attempts`, { percent: 60, minLength: 5 });
    expect(status).toBe(201);
    expect(attempt.blankCount).toBeGreaterThan(0);
    expect(JSON.stringify(attempt.blocks)).not.toContain('"answer"');

    const wrong = await u.post(`/attempts/${attempt.id}/answers`, { blank: 0, guess: "valami egészen más" });
    expect(wrong.status).toBe(201);
    expect(wrong.body).toMatchObject({ blank: 0, verdict: "wrong", reason: null });
    expect(wrong.body.answer.length).toBeGreaterThan(0);

    expect((await u.post(`/attempts/${attempt.id}/answers`, { blank: 0, guess: wrong.body.answer })).status).toBe(409);
    expect((await u.post(`/attempts/${attempt.id}/answers`, { blank: 9999, guess: "x" })).status).toBe(400);

    const resumed = await u.get(`/attempts/${attempt.id}`);
    expect(resumed.body.blocks).toEqual(attempt.blocks);
    expect(resumed.body.answers).toEqual([wrong.body]);
  });

  it("accepts the right word in any case, and calls a dropped letter almost right", async () => {
    const u = await newUser();
    const { body: doc } = await upload(u);
    const { body: document } = await u.get(`/documents/${doc.id}`);
    const { body: attempt } = await u.post(`/documents/${doc.id}/attempts`, { percent: 60, minLength: 5 });
    const words = blankedWords(attempt.blocks, document.blocks);
    expect(words.length).toBeGreaterThanOrEqual(2);

    const right = await u.post(`/attempts/${attempt.id}/answers`, { blank: 0, guess: words[0]!.toLocaleUpperCase("hu") });
    expect(right.body).toMatchObject({ verdict: "correct", answer: words[0] });
    const close = await u.post(`/attempts/${attempt.id}/answers`, { blank: 1, guess: words[1]!.slice(0, -1) });
    expect(close.body).toMatchObject({ verdict: "almost", reason: "typo", answer: words[1] });
  });

  it("keeps attempts to their owner", async () => {
    const [owner, other] = [await newUser(), await newUser()];
    const { body: doc } = await upload(owner);
    const { body: attempt } = await owner.post(`/documents/${doc.id}/attempts`, {});
    expect((await other.get(`/attempts/${attempt.id}`)).status).toBe(404);
    expect((await other.post(`/attempts/${attempt.id}/answers`, { blank: 0, guess: "x" })).status).toBe(404);
  });
});
