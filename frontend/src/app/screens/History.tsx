import { Link, useSearchParams } from "react-router";
import type { PastAttempt } from "../../api/quiz.api";
import { useHistory } from "../queries";
import { percentOf } from "../score";

const dateTime = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short" });
const kindLabel: Record<PastAttempt["kind"], string> = { blanks: "Kitakart szavak", questions: "AI kérdések" };

function Row({ attempt }: { attempt: PastAttempt }) {
  const answered = attempt.score.correct + attempt.score.almost + attempt.score.wrong;
  const done = answered === attempt.itemCount;
  return (
    <li>
      <Link to={`/attempts/${attempt.id}`} className="card history-row">
        <div>
          <strong>{attempt.title}</strong>
          <div className="muted">
            {kindLabel[attempt.kind]} · {dateTime.format(new Date(attempt.createdAt))}
          </div>
        </div>
        <div className="history-score">
          <strong>{percentOf(attempt.score, attempt.itemCount)}%</strong>
          <div className="muted">
            {done ? "kész" : `${answered} / ${attempt.itemCount}`} · <span className="blank-correct">{attempt.score.correct}</span> /{" "}
            <span className="blank-almost">{attempt.score.almost}</span> / <span className="blank-wrong">{attempt.score.wrong}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function HistoryScreen() {
  const [params] = useSearchParams();
  const documentId = params.get("documentId") ?? undefined;
  const attempts = useHistory(documentId);
  return (
    <>
      <h1>Eredményeim</h1>
      {documentId && (
        <p>
          <Link to="/history">Az összes dokumentum eredményei</Link>
        </p>
      )}
      <p className="muted">A „majdnem” fél pontot ér. A befejezetlen kvízeket is innen folytathatod.</p>
      {attempts.length === 0 ? (
        <p className="muted">Még nincs eredményed. Indíts egy kvízt a dokumentumaid közül.</p>
      ) : (
        <ul className="history">
          {attempts.map((a) => (
            <Row key={a.id} attempt={a} />
          ))}
        </ul>
      )}
    </>
  );
}
