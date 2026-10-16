import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as aiApi from "../../api/ai.api";
import { ApiError } from "../../api/client";
import { queryClient, useMe } from "../queries";

const statusKey = ["ai", "status"] as const;
const setStatus = (status: aiApi.AiStatus) => queryClient.setQueryData(statusKey, status);
const numbers = new Intl.NumberFormat("hu-HU");

const reasons: Record<string, string> = {
  not_configured: "A szerveren nincs beállítva az AI_TOKEN_KEY, így az AI ki van kapcsolva.",
  not_connected: "Nincs összekapcsolt ChatGPT-fiók.",
  reconnect: "A ChatGPT-kapcsolat lejárt. Jelentkezz be újra.",
  no_model: "Előbb válassz modellt a beállításoknál.",
  plan_limit: "A ChatGPT-előfizetés kerete most elfogyott.",
  expired: "Ez a bejelentkezés lejárt vagy már fel lett használva. Kezdd újra az összekapcsolást.",
  malformed: "Ez nem a ChatGPT visszairányított címe. A teljes címet másold be a címsorból.",
  denied: "A ChatGPT-bejelentkezést elutasították.",
};

function errorText(error: unknown) {
  if (!(error instanceof ApiError)) return "Valami hiba történt. Próbáld újra.";
  const reason = typeof error.body.reason === "string" ? error.body.reason : undefined;
  if (reason && reasons[reason]) return reasons[reason];
  if (error.status === 429) return `Elérted a${error.body.window === "day" ? " napi" : "z óránkénti"} tokenkeretet.`;
  if (error.status === 502) return "Az OpenAI hibát adott vissza. Nézd meg a szerver naplóját.";
  return error.message;
}

/** Runs an action, keeping its error message for the section that started it. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Connection({ status }: { status: aiApi.AiStatus }) {
  const { busy, error, run } = useAction();
  const [waiting, setWaiting] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");

  if (!status.configured) return <p className="error">{reasons.not_configured}</p>;

  return (
    <>
      <p>
        {status.broken ? (
          <span className="error">{reasons.reconnect}</span>
        ) : status.connected ? (
          <>
            Összekapcsolva: <strong>{status.accountEmail ?? "ismeretlen fiók"}</strong>
          </>
        ) : (
          "Nincs összekapcsolt ChatGPT-fiók."
        )}
      </p>
      {waiting ? (
        <div className="stack">
          <p className="muted">
            Jelentkezz be a megnyílt lapon. Utána a böngésző egy <code>127.0.0.1</code> kezdetű, „nem érhető el” oldalra visz: másold ide a teljes
            címét a címsorból.
          </p>
          <textarea rows={3} value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="http://127.0.0.1:1455/auth/callback?code=…" />
          <div className="row">
            <button
              className="button"
              disabled={busy || !callbackUrl.trim()}
              onClick={() =>
                void run(async () => {
                  setStatus(await aiApi.finishConnecting(callbackUrl.trim()));
                  setWaiting(false);
                  setCallbackUrl("");
                  await queryClient.invalidateQueries({ queryKey: ["ai", "models"] });
                })
              }
            >
              Összekapcsolás befejezése
            </button>
            <button className="button button-quiet" onClick={() => setWaiting(false)}>
              Mégse
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { authorizeUrl } = await aiApi.startConnecting();
                window.open(authorizeUrl, "_blank", "noopener");
                setWaiting(true);
              })
            }
          >
            {status.connected || status.broken ? "Újra bejelentkezés" : "ChatGPT összekapcsolása"}
          </button>
          {status.connected && (
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => {
                if (confirm("Leválasztod a ChatGPT-fiókot? Az AI funkciók addig nem működnek.")) {
                  void run(async () => {
                    await aiApi.disconnect();
                    await queryClient.invalidateQueries({ queryKey: statusKey });
                  });
                }
              }}
            >
              Leválasztás
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Settings({ status }: { status: aiApi.AiStatus }) {
  const models = useQuery({ queryKey: ["ai", "models"], queryFn: aiApi.getModels, enabled: status.connected && !status.broken, retry: false });
  const [settings, setSettings] = useState<aiApi.AiSettings>({
    model: status.model,
    hourlyTokenLimit: status.hourlyTokenLimit,
    dailyTokenLimit: status.dailyTokenLimit,
    maxOutputTokens: status.maxOutputTokens,
  });
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const number = (key: Exclude<keyof aiApi.AiSettings, "model">, label: string) => (
    <label className="field">
      {label}
      <input type="number" min={0} value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="stack">
      <label className="field">
        Modell
        <select value={settings.model ?? ""} onChange={(e) => setSettings({ ...settings, model: e.target.value || null })}>
          <option value="">{models.isPending && status.connected ? "Betöltés…" : "Válassz modellt"}</option>
          {/* Keeps the saved model selectable while the list loads, or if it's gone from the list. */}
          {settings.model && !models.data?.models.some((m) => m.slug === settings.model) && <option value={settings.model}>{settings.model}</option>}
          {models.data?.models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {number("hourlyTokenLimit", "Token keret óránként (csúszó ablak)")}
      {number("dailyTokenLimit", "Token keret naponta (csúszó ablak)")}
      {number("maxOutputTokens", "Legfeljebb ennyi token egy válaszban")}
      <div className="row">
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setStatus(await aiApi.saveSettings(settings));
              setSaved(true);
            })
          }
        >
          Mentés
        </button>
        {saved && !busy && !error && <span className="muted">Elmentve.</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {numbers.format(used)} / {numbers.format(limit)} token
        </span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill${share >= 1 ? " meter-full" : share >= 0.8 ? " meter-high" : ""}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function Usage({ status }: { status: aiApi.AiStatus }) {
  const time = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="stack">
      <Meter label="Az elmúlt órában" used={status.usage.lastHour} limit={status.hourlyTokenLimit} />
      <Meter label="Az elmúlt 24 órában" used={status.usage.lastDay} limit={status.dailyTokenLimit} />
      {status.usageByHour.length === 0 ? (
        <p className="muted">Az elmúlt 24 órában nem volt AI-hívás.</p>
      ) : (
        <table className="usage">
          <thead>
            <tr>
              <th>Óra</th>
              <th>Hívás</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {status.usageByHour.map((h) => (
              <tr key={h.hour}>
                <td>{time.format(new Date(h.hour))}</td>
                <td>
                  {h.calls}
                  {h.estimatedCalls > 0 && <span className="muted" title="Levágott válasz, a tokenszám becsült"> ({h.estimatedCalls} becsült)</span>}
                </td>
                <td>{numbers.format(h.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TryIt() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<aiApi.AiTry>();
  const { busy, error, run } = useAction();
  return (
    <div className="stack">
      <p className="muted">A kérdés pontosan így megy el, utasítás és környezet nélkül, a kiválasztott modellnek.</p>
      <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pl. Mi a különbség az ellenőrzés és a vizsgálat között?" />
      <div className="row">
        <button
          className="button"
          disabled={busy || !input.trim()}
          onClick={() =>
            void run(async () => {
              setResult(undefined);
              setResult(await aiApi.tryPrompt(input.trim()));
              await queryClient.invalidateQueries({ queryKey: statusKey });
            })
          }
        >
          {busy ? "Válaszra vár…" : "Küldés"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="card answer">
          <p className="answer-text">{result.text}</p>
          <p className="muted">
            {numbers.format(result.usage.inputTokens)} be + {numbers.format(result.usage.outputTokens)} ki = {numbers.format(result.usage.totalTokens)}{" "}
            token{result.truncated && " · levágva a válaszkeretnél, a tokenszám becsült"}
          </p>
        </div>
      )}
    </div>
  );
}

/** The owner shares their ChatGPT plan here, and checks that it works and what it's used for. */
export function ManageAiScreen() {
  if (!useMe().isOwner) return <p>Ezt az oldalt csak a tulajdonos látja.</p>;
  return <OwnerScreen />;
}

function OwnerScreen() {
  const status = useSuspenseQuery({ queryKey: statusKey, queryFn: aiApi.getStatus }).data;
  return (
    <div className="manage-ai">
      <h1>AI kezelése</h1>
      <section className="card">
        <h2>ChatGPT-kapcsolat</h2>
        <Connection status={status} />
      </section>
      <section className="card">
        <h2>Beállítások</h2>
        <Settings key={status.model ?? ""} status={status} />
      </section>
      <section className="card">
        <h2>Használat</h2>
        <Usage status={status} />
      </section>
      <section className="card">
        <h2>Kipróbálás</h2>
        <TryIt />
      </section>
    </div>
  );
}
