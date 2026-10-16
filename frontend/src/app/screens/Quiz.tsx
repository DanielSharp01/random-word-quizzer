import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { Answer, Attempt, Segment } from "../../api/quiz.api";
import { answerBlank, useAttempt } from "../queries";

const almostReason = { accent: "ékezethiba", typo: "elírás" } as const;

function verdictTitle(answer: Answer) {
  if (answer.verdict === "correct") return "Helyes";
  if (answer.verdict === "almost") return `Majdnem: ${almostReason[answer.reason ?? "typo"]} (te: ${answer.guess})`;
  return answer.guess ? `Helytelen (te: ${answer.guess})` : "Kihagyva";
}

function AnsweredBlank({ answer }: { answer: Answer }) {
  return (
    <span className={`blank-answered blank-${answer.verdict}`} title={verdictTitle(answer)}>
      {answer.answer}
    </span>
  );
}

/** Enter checks the guess; afterwards focus moves to the next blank still open. */
function OpenBlank({ attemptId, blank, length }: { attemptId: string; blank: number; length: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const next = [...document.querySelectorAll<HTMLInputElement>("input.blank")].find((el) => el !== input.current && el.compareDocumentPosition(input.current!) & Node.DOCUMENT_POSITION_PRECEDING);
    try {
      await answerBlank(attemptId, blank, input.current!.value);
      next?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      ref={input}
      className="blank"
      style={{ width: `${length + 1}ch` }}
      aria-label={`${blank + 1}. kitakart szó`}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      disabled={busy}
      onKeyDown={(e) => {
        if (e.key === "Enter") void submit();
      }}
    />
  );
}

function Segments({ attempt, segments, answers }: { attempt: Attempt; segments: Segment[]; answers: Map<number, Answer> }) {
  return segments.map((segment, i) => {
    if ("text" in segment) return <span key={i}>{segment.text}</span>;
    const answer = answers.get(segment.blank);
    return answer ? <AnsweredBlank key={i} answer={answer} /> : <OpenBlank key={i} attemptId={attempt.id} blank={segment.blank} length={segment.length} />;
  });
}

function Score({ attempt }: { attempt: Attempt }) {
  const count = (verdict: Answer["verdict"]) => attempt.answers.filter((a) => a.verdict === verdict).length;
  const done = attempt.answers.length === attempt.blankCount;
  return (
    <p className="score">
      {done ? "Kész! " : `${attempt.answers.length} / ${attempt.blankCount} kitöltve · `}
      <span className="blank-correct">{count("correct")} helyes</span> · <span className="blank-almost">{count("almost")} majdnem</span> ·{" "}
      <span className="blank-wrong">{count("wrong")} helytelen</span>
    </p>
  );
}

export function QuizScreen() {
  const attempt = useAttempt(useParams().id!);
  const answers = new Map(attempt.answers.map((a) => [a.blank, a]));
  return (
    <article className="quiz">
      <Link to="/" className="muted">
        ← Dokumentumaim
      </Link>
      <h1>{attempt.title}</h1>
      <Score attempt={attempt} />
      <p className="muted">Írd be a hiányzó szót, és nyomj Entert. Az ékezet- és kisebb elírásokat „majdnem” jónak számoljuk.</p>
      {attempt.blocks.map((block, i) => {
        const content = <Segments attempt={attempt} segments={block.segments} answers={answers} />;
        if (block.kind === "heading") return <h2 key={i}>{content}</h2>;
        return (
          <p key={i} className={block.kind === "listItem" ? "quiz-item" : undefined}>
            {content}
          </p>
        );
      })}
    </article>
  );
}
