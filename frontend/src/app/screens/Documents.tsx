import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { getSections, type BlanksScope, type BlankStats, type DocumentSummary } from "../../api/quiz.api";
import { aiErrorText } from "../aiErrors";
import { estimateBlanks } from "../estimate";
import { Picker, type PickerOption } from "../ui/Picker";
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
    <div>
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
    </div>
  );
}

/** Above this many blanks a quiz turns into an afternoon; the page says so before starting it. */
const MANY_BLANKS = 150;

const useSections = (documentId: string) => useQuery({ queryKey: ["sections", documentId], queryFn: () => getSections(documentId) });

function BlanksSettings({ document, footerEnd }: { document: DocumentSummary; footerEnd: ReactNode }) {
  const navigate = useNavigate();
  const sections = useSections(document.id);
  const [part, setPart] = useState("random");
  const [randomCount, setRandomCount] = useState(3);
  const [percent, setPercent] = useState(20);
  const [minLength, setMinLength] = useState(6);
  const [busy, setBusy] = useState(false);

  const list = sections.data?.sections ?? [];
  const hasSections = list.length > 1;
  const chosen = hasSections ? part : "document";
  const estimate = (stats: BlankStats) => estimateBlanks(stats, percent, minLength);
  const perSection = list.length > 0 ? list.reduce((sum, s) => sum + estimate(s.blankStats), 0) / list.length : 0;
  const count = Math.min(randomCount, list.length);
  const estimated =
    !sections.data
      ? undefined
      : chosen === "document"
        ? estimate(sections.data.blankStats)
        : chosen === "random"
          ? Math.round(perSection * count)
          : estimate(list[Number(chosen)]!.blankStats);

  const options: PickerOption[] = [
    ...(hasSections ? [{ key: "random", label: "Véletlenszerű fejezetek", detail: "Minden kvíz más fejezetekből" }] : []),
    { key: "document", label: "Teljes dokumentum", detail: sections.data ? `kb. ${estimate(sections.data.blankStats)} kitakart szó` : undefined },
    ...list.map((s, i) => ({ key: String(s.index), label: s.title, detail: `kb. ${estimate(s.blankStats)} kitakart szó`, separated: i === 0 })),
  ];

  async function start() {
    setBusy(true);
    try {
      const scope: BlanksScope =
        chosen === "document" ? { kind: "document" } : chosen === "random" ? { kind: "random", count: randomCount } : { kind: "section", index: Number(chosen) };
      const attempt = await startAttempt(document.id, { percent, minLength, scope });
      navigate(`/attempts/${attempt.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fields">
        <Picker label="Melyik részből?" options={options} value={chosen} onChange={setPart} />
        {chosen === "random" && (
          <label>
            Hány fejezet?
            <input type="number" min={1} max={Math.min(20, list.length)} value={randomCount} onChange={(e) => setRandomCount(Number(e.target.value))} />
          </label>
        )}
        <label>
          Kitakart szavak aránya
          <span className="input-suffix">
            <input type="number" min={5} max={60} step={5} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />%
          </span>
        </label>
        <label>
          Legalább ennyi betűs szavak
          <input type="number" min={1} max={20} value={minLength} onChange={(e) => setMinLength(Number(e.target.value))} />
        </label>
      </div>
      {estimated !== undefined &&
        (estimated > MANY_BLANKS ? (
          <p className="notice">
            Ez nagyon hosszú lesz: kb. {estimated} kitakart szó egy oldalon. Érdemes egy fejezetet vagy néhány véletlenszerű fejezetet választani.
          </p>
        ) : (
          <p className="estimate">Kb. {estimated} kitakart szó.</p>
        ))}
      <div className="card-footer">
        <button className="button" disabled={busy || sections.isPending} onClick={() => void start()}>
          Kvíz indítása
        </button>
        {footerEnd}
      </div>
    </>
  );
}

function QuestionsSettings({ document, footerEnd }: { document: DocumentSummary; footerEnd: ReactNode }) {
  const navigate = useNavigate();
  const sections = useSections(document.id);
  const [part, setPart] = useState("document");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const list = sections.data?.sections ?? [];
  const sampled = sections.data?.wholeIsSampled ?? false;

  const options: PickerOption[] = [
    { key: "document", label: "Teljes dokumentum", detail: sampled ? "Hosszú, ezért mindig más részekből kérdez" : `${document.blockCount} bekezdés` },
    ...list.map((s, i) => ({ key: String(s.index), label: s.title, detail: `${s.toBlock - s.fromBlock} bekezdés`, separated: i === 0 })),
  ];

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const attempt = await startAttempt(document.id, { kind: "questions", section: part === "document" ? null : Number(part), count });
      navigate(`/attempts/${attempt.id}`);
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fields">
        <Picker label="Melyik részből?" options={options} value={part} onChange={setPart} />
        <label>
          Kérdések száma
          <input type="number" min={1} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      </div>
      <div className="card-footer">
        <button className="button" disabled={busy || sections.isPending} onClick={() => void start()}>
          {busy ? "Kérdések készülnek…" : "Kérdések készítése"}
        </button>
        {footerEnd}
      </div>
      {busy && <p className="muted">Az AI most olvassa a szöveget, ez fél percig is eltarthat.</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function DocumentRow({ document }: { document: DocumentSummary }) {
  const [mode, setMode] = useState<"blanks" | "questions">("blanks");
  const footerEnd = (
    <div className="card-footer-end">
      <Link className="button button-quiet" to={`/history?documentId=${document.id}`}>
        Korábbi eredmények
      </Link>
      <button
        className="button button-quiet button-danger"
        onClick={() => {
          if (confirm(`Biztosan törlöd: „${document.title}”? Az eredményei is törlődnek.`)) void deleteDocument(document.id);
        }}
      >
        Törlés
      </button>
    </div>
  );
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
      {mode === "blanks" ? <BlanksSettings document={document} footerEnd={footerEnd} /> : <QuestionsSettings document={document} footerEnd={footerEnd} />}
    </li>
  );
}

export function DocumentsScreen() {
  const documents = useDocuments();
  return (
    <>
      <div className="page-head">
        <h1>Dokumentumaim</h1>
        <Upload />
      </div>
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
