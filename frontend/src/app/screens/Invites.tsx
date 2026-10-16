import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as invitesApi from "../../api/invites.api";
import { queryClient, useMe } from "../queries";

const invitesKey = ["invites"] as const;
const refresh = () => queryClient.invalidateQueries({ queryKey: invitesKey });
const dateTime = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short" });

/** A fresh link is only shown once, right after it's made: only its hash is stored. */
function IssuedLink({ name, invite }: { name: string; invite: invitesApi.IssuedInvite }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card issued">
      <p>
        Meghívó link <strong>{name}</strong> részére, {dateTime.format(new Date(invite.expiresAt))}-ig érvényes, egyszer használható:
      </p>
      <div className="row">
        <input className="issued-url" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
        <button
          className="button"
          onClick={() =>
            void navigator.clipboard.writeText(invite.url).then(() => {
              setCopied(true);
            })
          }
        >
          {copied ? "Kimásolva" : "Másolás"}
        </button>
      </div>
      <p className="muted">Ezt a linket később nem tudod újra megnézni. Ha elveszik, kérj újat a listában.</p>
    </div>
  );
}

function PendingRow({ invite, onIssued }: { invite: invitesApi.PendingInvite; onIssued: (issued: invitesApi.IssuedInvite) => void }) {
  const [busy, setBusy] = useState(false);
  const expired = invite.expiresAt !== null && new Date(invite.expiresAt).getTime() < Date.now();
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="pending">
      <div>
        <strong>{invite.name ?? "Névtelen"}</strong>
        <div className={expired ? "error" : "muted"}>
          {expired ? "Lejárt" : invite.expiresAt ? `Érvényes: ${dateTime.format(new Date(invite.expiresAt))}` : ""}
        </div>
      </div>
      <div className="row">
        <button className="button" disabled={busy} onClick={() => void act(async () => onIssued(await invitesApi.renewInvite(invite.id)))}>
          Új link
        </button>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => {
            if (confirm(`Visszavonod ${invite.name ?? "a"} meghívóját? A link azonnal megszűnik.`)) {
              void act(async () => {
                await invitesApi.cancelInvite(invite.id);
                await refresh();
              });
            }
          }}
        >
          Visszavonás
        </button>
      </div>
    </li>
  );
}

function OwnerInvites() {
  const invites = useSuspenseQuery({ queryKey: invitesKey, queryFn: () => invitesApi.getInvites().then((r) => r.invites) }).data;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; invite: invitesApi.IssuedInvite }>();
  const [error, setError] = useState(false);

  async function create() {
    setBusy(true);
    setError(false);
    try {
      const invite = await invitesApi.createInvite(name.trim());
      setIssued({ name: name.trim(), invite });
      setName("");
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manage-ai">
      <h1>Meghívók</h1>
      <section className="card stack">
        <p className="muted">A Quizzer csak meghívóval érhető el. A meghívott a linkkel egyszer jelentkezhet be Google-fiókkal, utána már a linkre nincs szüksége.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input className="field-inline" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kinek szól? (pl. Anna)" maxLength={100} />
          <button className="button" disabled={busy || !name.trim()}>
            Meghívó készítése
          </button>
        </form>
        {error && <p className="error">Nem sikerült a meghívót elkészíteni. Próbáld újra.</p>}
      </section>
      {issued && <IssuedLink key={issued.invite.url} name={issued.name} invite={issued.invite} />}
      <section className="card">
        <h2>Még fel nem használt meghívók</h2>
        {invites.length === 0 ? (
          <p className="muted">Nincs függő meghívó.</p>
        ) : (
          <ul className="pendings">
            {invites.map((invite) => (
              <PendingRow
                key={invite.id}
                invite={invite}
                onIssued={(renewed) => {
                  setIssued({ name: invite.name ?? "Névtelen", invite: renewed });
                  void refresh();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function InvitesScreen() {
  if (!useMe().isOwner) return <p>Ezt az oldalt csak a tulajdonos látja.</p>;
  return <OwnerInvites />;
}
