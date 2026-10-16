import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { getSections, type DocumentSummary } from "../../api/quiz.api";
import { aiErrorText } from "../aiErrors";
import { deleteDocument, startAttempt, uploadDocument, useDocuments } from "../queries";

function uploadError(error: unknown) {
  if (error instanceof ApiError && error.status === 422) return "Ezt a fájlt nem sikerült beolvasni. Biztosan .docx?";
  if (error instanceof ApiError && error.status === 413) return "A fájl túl nagy (legfeljebb 10 MB).";
  return "A feltöltés nem sikerült. Próbáld újra.";
}

function Upload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await uploadDocument(file);
    } catch (e) {
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <label className="upload">
        <span className="button">{busy ? "Feltöltés…" : "Dokumentum feltöltése (.docx)"}</span>
        <input
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function BlanksSettings({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate();
  const [percent, setPercent] = useState(20);
  const [minLength, setMinLength] = useState(6);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const attempt = await startAttempt(document.id, { percent, minLength });
      navigate(`/attempts/${attempt.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="document-settings">
        <label>
          Kitakart szavak aránya
          <input type="number" min={5} max={60} step={5} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />%
        </label>
        <label>
          Legalább ennyi betűs szavak
          <input type="number" min={1} max={20} value={minLength} onChange={(e) => setMinLength(Number(e.target.value))} />
        </label>
      </div>
      <button className="button" disabled={busy} onClick={() => void start()}>
        Kvíz indítása
      </button>
    </>
  );
}

function QuestionsSettings({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate();
  const sections = useQuery({ queryKey: ["sections", document.id], queryFn: () => getSections(document.id) });
  const [section, setSection] = useState<number | null>(null);
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chosen = section === null ? undefined : sections.data?.sections[section];
  const chars = chosen?.chars ?? sections.data?.sections.reduce((sum, s) => sum + s.chars, 0) ?? 0;
  const tooLong = sections.data !== undefined && chars > sections.data.maxChars;

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const attempt = await startAttempt(document.id, { kind: "questions", section, count });
      navigate(`/attempts/${attempt.id}`);
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="document-settings">
        <label>
          Melyik részből?
          <select value={section ?? ""} onChange={(e) => setSection(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Teljes dokumentum</option>
            {sections.data?.sections.map((s) => (
              <option key={s.index} value={s.index}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kérdések száma
          <input type="number" min={1} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      </div>
      {tooLong && <p className="error">Ez a rész túl hosszú egyszerre. Válassz egy kisebb fejezetet.</p>}
      <button className="button" disabled={busy || tooLong || sections.isPending} onClick={() => void start()}>
        {busy ? "Kérdések készülnek…" : "Kérdések készítése"}
      </button>
      {busy && <p className="muted">Az AI most olvassa a szöveget, ez fél percig is eltarthat.</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function DocumentRow({ document }: { document: DocumentSummary }) {
  const [mode, setMode] = useState<"blanks" | "questions">("blanks");
  return (
    <li className="card document">
      <div className="document-head">
        <h2>{document.title}</h2>
        <span className="muted">{document.blockCount} bekezdés</span>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "blanks"} className={mode === "blanks" ? "tab tab-active" : "tab"} onClick={() => setMode("blanks")}>
          Kitakart szavak
        </button>
        <button role="tab" aria-selected={mode === "questions"} className={mode === "questions" ? "tab tab-active" : "tab"} onClick={() => setMode("questions")}>
          AI kérdések
        </button>
      </div>
      {mode === "blanks" ? <BlanksSettings document={document} /> : <QuestionsSettings document={document} />}
      <div className="document-actions">
        <Link className="button button-quiet" to={`/history?documentId=${document.id}`}>
          Korábbi eredmények
        </Link>
        <button
          className="button button-quiet"
          onClick={() => {
            if (confirm(`Biztosan törlöd: „${document.title}”? Az eredményei is törlődnek.`)) void deleteDocument(document.id);
          }}
        >
          Törlés
        </button>
      </div>
    </li>
  );
}

export function DocumentsScreen() {
  const documents = useDocuments();
  return (
    <>
      <h1>Dokumentumaim</h1>
      <Upload />
      {documents.length === 0 ? (
        <p className="muted">Még nincs dokumentumod. Tölts fel egy .docx fájlt, és kvízt készítünk belőle.</p>
      ) : (
        <ul className="documents">
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </ul>
      )}
    </>
  );
}
