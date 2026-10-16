import { Fragment, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { Answer, BlanksAttempt, Question, QuestionsAttempt, Segment, Verdict } from "../../api/quiz.api";
import { aiErrorText } from "../aiErrors";
import { answerBlank, answerQuestion, useAttempt } from "../queries";

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

function Segments({ attempt, segments, answers }: { attempt: BlanksAttempt; segments: Segment[]; answers: Map<number, Answer> }) {
  return segments.map((segment, i) => {
    if ("text" in segment) return <span key={i}>{segment.text}</span>;
    const answer = answers.get(segment.blank);
    return answer ? <AnsweredBlank key={i} answer={answer} /> : <OpenBlank key={i} attemptId={attempt.id} blank={segment.blank} length={segment.length} />;
  });
}

const verdictLabel: Record<Verdict, string> = { correct: "Helyes", almost: "Majdnem", wrong: "Helytelen" };

function Score({ answered, total, verdicts }: { answered: number; total: number; verdicts: Verdict[] }) {
  const count = (verdict: Verdict) => verdicts.filter((v) => v === verdict).length;
  return (
    <p className="score">
      {answered === total ? "Kész! " : `${answered} / ${total} megválaszolva · `}
      <span className="blank-correct">{count("correct")} helyes</span> · <span className="blank-almost">{count("almost")} majdnem</span> ·{" "}
      <span className="blank-wrong">{count("wrong")} helytelen</span>
    </p>
  );
}

function BlanksQuiz({ attempt }: { attempt: BlanksAttempt }) {
  const answers = new Map(attempt.answers.map((a) => [a.blank, a]));
  return (
    <>
      <p className="muted">Ebből: {attempt.scope}</p>
      <Score answered={attempt.answers.length} total={attempt.blankCount} verdicts={attempt.answers.map((a) => a.verdict)} />
      <p className="muted">Írd be a hiányzó szót, és nyomj Entert. Az ékezet- és kisebb elírásokat „majdnem” jónak számoljuk.</p>
      {attempt.blocks.map((block, i) => {
        const content = <Segments attempt={attempt} segments={block.segments} answers={answers} />;
        const gap = block.gapBefore && (
          <p className="quiz-gap" aria-label="Kihagyott szöveg">
            …
          </p>
        );
        if (block.kind === "heading")
          return (
            <Fragment key={i}>
              {gap}
              <h2>{content}</h2>
            </Fragment>
          );
        return (
          <Fragment key={i}>
            {gap}
            <p className={block.kind === "listItem" ? "quiz-item" : undefined}>{content}</p>
          </Fragment>
        );
      })}
    </>
  );
}

function AnsweredQuestion({ answered }: { answered: NonNullable<Question["answered"]> }) {
  return (
    <div className={`question-result question-${answered.verdict}`}>
      <p className={`blank-${answered.verdict} question-verdict`}>{verdictLabel[answered.verdict]}</p>
      <p className="question-guess">
        <span className="muted">A válaszod:</span> {answered.guess || <em>(üres)</em>}
      </p>
      {answered.feedback && <p>{answered.feedback}</p>}
      <p>
        <span className="muted">Helyes válasz:</span> {answered.answer}
      </p>
      <details>
        <summary className="muted">Forrás a dokumentumból</summary>
        <blockquote>{answered.source}</blockquote>
      </details>
    </div>
  );
}

function QuestionCard({ attemptId, question }: { attemptId: string; question: Question }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await answerQuestion(attemptId, question.position, answer);
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card question">
      <p className="question-text">
        <span className="muted">{question.position + 1}.</span> {question.question}
      </p>
      {question.answered ? (
        <AnsweredQuestion answered={question.answered} />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            rows={3}
            value={answer}
            disabled={busy}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
            }}
            placeholder="A válaszod saját szavaiddal…"
          />
          <div className="row">
            <button className="button" disabled={busy}>
              {busy ? "Értékelés…" : "Ellenőrzés"}
            </button>
            <span className="muted">Ctrl+Enter</span>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </li>
  );
}

function QuestionsQuiz({ attempt }: { attempt: QuestionsAttempt }) {
  const answered = attempt.questions.flatMap((q) => (q.answered ? [q.answered.verdict] : []));
  return (
    <>
      <p className="muted">Kérdések ebből: {attempt.section}</p>
      <Score answered={answered.length} total={attempt.questions.length} verdicts={answered} />
      <p className="muted">Válaszolj saját szavaiddal. Az AI a dokumentum alapján értékel, és megmutatja, mi hiányzott.</p>
      <ol className="questions">
        {attempt.questions.map((q) => (
          <QuestionCard key={q.position} attemptId={attempt.id} question={q} />
        ))}
      </ol>
    </>
  );
}

export function QuizScreen() {
  const attempt = useAttempt(useParams().id!);
  return (
    <article className="quiz">
      <Link to="/" className="muted">
        ← Dokumentumaim
      </Link>
      <h1>{attempt.title}</h1>
      {attempt.kind === "blanks" ? <BlanksQuiz attempt={attempt} /> : <QuestionsQuiz attempt={attempt} />}
    </article>
  );
}
