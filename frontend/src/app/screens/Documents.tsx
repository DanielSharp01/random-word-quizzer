import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import type { DocumentSummary } from "../../api/quiz.api";
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

function DocumentRow({ document }: { document: DocumentSummary }) {
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
    <li className="card document">
      <div className="document-head">
        <h2>{document.title}</h2>
        <span className="muted">{document.blockCount} bekezdés</span>
      </div>
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
      <div className="document-actions">
        <button className="button" disabled={busy} onClick={() => void start()}>
          Kvíz indítása
        </button>
        <button
          className="button button-quiet"
          onClick={() => {
            if (confirm(`Biztosan törlöd: „${document.title}”?`)) void deleteDocument(document.id);
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
