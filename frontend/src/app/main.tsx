import { QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import "../styles.css";
import "./app.css";
import { meQuery, queryClient, useMe } from "./queries";
import { DocumentsScreen } from "./screens/Documents";
import { InvitesScreen } from "./screens/Invites";
import { ManageAiScreen } from "./screens/ManageAi";
import { QuizScreen } from "./screens/Quiz";

// A missing session sends the browser to /login before this resolves.
void queryClient.prefetchQuery(meQuery);

function Header() {
  const me = useMe();
  return (
    <header className="header">
      <Link to="/" className="header-title">
        Quizzer
      </Link>
      {me.isOwner && (
        <>
          <Link to="/invites" className="header-link">
            Meghívók
          </Link>
          <Link to="/manage-ai" className="header-link">
            AI kezelése
          </Link>
        </>
      )}
      <span className="header-user">{me.name ?? me.email}</span>
      <a className="header-signout" href="/auth/logout">
        Kijelentkezés
      </a>
    </header>
  );
}

function App() {
  return (
    <>
      <Header />
      <main className="page">
        <Routes>
          <Route path="/" element={<DocumentsScreen />} />
          <Route path="/attempts/:id" element={<QuizScreen />} />
          <Route path="/manage-ai" element={<ManageAiScreen />} />
          <Route path="/invites" element={<InvitesScreen />} />
          <Route path="*" element={<p>Ez az oldal nem létezik.</p>} />
        </Routes>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Suspense fallback={<div className="loading" aria-busy />}>
        <App />
      </Suspense>
    </BrowserRouter>
  </QueryClientProvider>,
);
