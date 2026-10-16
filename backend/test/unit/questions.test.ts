import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../src/quiz/blanks";

// The real module reads the environment and the database; these tests only need what ask() answers.
const ask = vi.fn();
vi.mock("../../src/ai/connection", () => ({ ask: (...args: unknown[]) => ask(...args) }));
const { AiOutputRejected, evaluateAnswer, generateQuestions } = await import("../../src/quiz/questions");

const blocks: Block[] = [
  { kind: "heading", text: "Az ellenőrzés célja" },
  { kind: "paragraph", text: "Az ellenőrzés célja a feladatok törvényes végrehajtása." },
  { kind: "paragraph", text: "Alapelve a törvényesség és a szakszerűség." },
];

const generated = (questions: unknown[]) => ({ text: JSON.stringify({ questions }), truncated: false, usage: {} });

beforeEach(() => ask.mockReset());

describe("generateQuestions", () => {
  it("numbers each block in the input and asks for the schema", async () => {
    ask.mockResolvedValue(generated([{ question: "Mi a célja?", answer: "A törvényes végrehajtás.", keyPoints: ["törvényes"], sourceBlock: 1 }]));
    const questions = await generateQuestions(blocks, [{ fromBlock: 1, toBlock: 3 }], 2);

    expect(questions).toEqual([{ question: "Mi a célja?", answer: "A törvényes végrehajtás.", keyPoints: ["törvényes"], sourceBlock: 1 }]);
    const [request] = ask.mock.calls[0]!;
    expect(request.input).toBe("[1] Az ellenőrzés célja a feladatok törvényes végrehajtása.\n[2] Alapelve a törvényesség és a szakszerűség.");
    expect(request.instructions).toContain("pontosan 2 kérdést");
    expect(request.format.name).toBe("questions");
  });

  it("keeps no more than asked for, and points made-up blocks at the section's start", async () => {
    ask.mockResolvedValue(
      generated([
        { question: "A", answer: "a", keyPoints: ["a"], sourceBlock: 99 },
        { question: "B", answer: "b", keyPoints: ["b"], sourceBlock: 2 },
        { question: "C", answer: "c", keyPoints: ["c"], sourceBlock: 2 },
      ]),
    );
    expect((await generateQuestions(blocks, [{ fromBlock: 1, toBlock: 3 }], 2)).map((q) => [q.question, q.sourceBlock])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
  });

  it("sends separate runs of blocks apart, and says they come from different places", async () => {
    ask.mockResolvedValue(generated([{ question: "Q", answer: "a", keyPoints: ["a"], sourceBlock: 1 }]));
    await generateQuestions(blocks, [{ fromBlock: 0, toBlock: 1 }, { fromBlock: 2, toBlock: 3 }], 1);
    const [request] = ask.mock.calls[0]!;
    expect(request.input).toBe("[0] Az ellenőrzés célja\n\n[2] Alapelve a törvényesség és a szakszerűség.");
    expect(request.instructions).toContain("különböző helyeiről");
  });

  it("points a question at a block that wasn't sent back at the first one sent", async () => {
    ask.mockResolvedValue(generated([{ question: "Q", answer: "a", keyPoints: ["a"], sourceBlock: 1 }]));
    const [question] = await generateQuestions(blocks, [{ fromBlock: 0, toBlock: 1 }, { fromBlock: 2, toBlock: 3 }], 1);
    expect(question!.sourceBlock).toBe(0);
  });

  it("rejects an answer that isn't the expected JSON, or has no questions", async () => {
    ask.mockResolvedValue({ text: "nem JSON", truncated: false, usage: {} });
    await expect(generateQuestions(blocks, [{ fromBlock: 0, toBlock: 3 }], 2)).rejects.toBeInstanceOf(AiOutputRejected);
    ask.mockResolvedValue(generated([]));
    await expect(generateQuestions(blocks, [{ fromBlock: 0, toBlock: 3 }], 2)).rejects.toBeInstanceOf(AiOutputRejected);
  });
});

describe("evaluateAnswer", () => {
  const question = { question: "Mi az alapelve?", answer: "A törvényesség és a szakszerűség.", keyPoints: ["törvényesség", "szakszerűség"] };

  it("takes an answer close to the reference without asking AI", async () => {
    expect(await evaluateAnswer(question, "forrás", "a törvényesség és a szakszerüség")).toEqual({ verdict: "correct", feedback: null, checkedBy: "match" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("marks an empty answer wrong without asking AI", async () => {
    expect(await evaluateAnswer(question, "forrás", "  ")).toEqual({ verdict: "wrong", feedback: null, checkedBy: "match" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks AI with the key and the source passage otherwise", async () => {
    ask.mockResolvedValue({ text: JSON.stringify({ verdict: "almost", feedback: "A szakszerűség hiányzik." }), truncated: false, usage: {} });
    expect(await evaluateAnswer(question, "Alapelve a törvényesség.", "Törvényes legyen")).toEqual({
      verdict: "almost",
      feedback: "A szakszerűség hiányzik.",
      checkedBy: "ai",
    });
    const [request] = ask.mock.calls[0]!;
    expect(request.input).toContain("Kulcspontok: - törvényesség\n- szakszerűség");
    expect(request.input).toContain("Forrásszöveg: Alapelve a törvényesség.");
    expect(request.input).toContain("A tanuló válasza: Törvényes legyen");
  });

  it("rejects a verdict outside the three", async () => {
    ask.mockResolvedValue({ text: JSON.stringify({ verdict: "maybe", feedback: "" }), truncated: false, usage: {} });
    await expect(evaluateAnswer(question, "forrás", "valami")).rejects.toBeInstanceOf(AiOutputRejected);
  });
});
