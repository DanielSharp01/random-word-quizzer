import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getMe, type Me } from "../api/me.api";
import "../styles.css";
import "./app.css";

function App() {
  const [me, setMe] = useState<Me>();
  const [failed, setFailed] = useState(false);

  // A missing session sends the browser to /login before this resolves.
  useEffect(() => {
    getMe().then(setMe, () => setFailed(true));
  }, []);

  if (failed) return <main className="app">Couldn't load your account. Try reloading.</main>;
  if (!me) return null;
  return (
    <main className="app">
      <h1>Hi, {me.name ?? me.email ?? "there"}</h1>
      <a className="app-signout" href="/auth/logout">
        Sign out
      </a>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
