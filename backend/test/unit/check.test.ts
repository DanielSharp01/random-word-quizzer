import { describe, expect, it } from "vitest";
import { checkAnswer } from "../../src/quiz/check";

describe("checkAnswer", () => {
  it("accepts the word whatever its case and surrounding spaces", () => {
    expect(checkAnswer("Ellenőrzés", "  ellenőrzés ")).toEqual({ verdict: "correct" });
  });

  it("treats composed and decomposed accents as the same letter", () => {
    expect(checkAnswer("ellenőrzés", "ellenőrzés".normalize("NFD"))).toEqual({ verdict: "correct" });
  });

  it("calls missing or swapped accents almost right", () => {
    expect(checkAnswer("ellenőrzés", "ellenorzes")).toEqual({ verdict: "almost", reason: "accent" });
    expect(checkAnswer("ellenőrzés", "ellenörzés")).toEqual({ verdict: "almost", reason: "accent" });
  });

  it("forgives a typo in a longer word, and two in a long one", () => {
    expect(checkAnswer("szakszerű", "szakszerü")).toEqual({ verdict: "almost", reason: "accent" });
    expect(checkAnswer("szakszerű", "szaksezrű")).toEqual({ verdict: "almost", reason: "typo" });
    expect(checkAnswer("törvényesség", "törvényeség")).toEqual({ verdict: "almost", reason: "typo" });
    expect(checkAnswer("törvényesség", "törvényeseg")).toEqual({ verdict: "almost", reason: "typo" });
  });

  it("doesn't forgive a different short word", () => {
    expect(checkAnswer("cél", "cel")).toEqual({ verdict: "almost", reason: "accent" });
    expect(checkAnswer("cél", "tél")).toEqual({ verdict: "wrong" });
  });

  it("marks a blank or unrelated guess wrong", () => {
    expect(checkAnswer("ellenőrzés", "")).toEqual({ verdict: "wrong" });
    expect(checkAnswer("ellenőrzés", "vizsgálat")).toEqual({ verdict: "wrong" });
  });
});
