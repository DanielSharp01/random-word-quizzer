import { QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import "../styles.css";
import "./app.css";
import { meQuery, queryClient, useMe } from "./queries";
import { DocumentsScreen } from "./screens/Documents";
import { HistoryScreen } from "./screens/History";
import { InvitesScreen } from "./screens/Invites";
import { ManageAiScreen } from "./screens/ManageAi";
import { QuizScreen } from "./screens/Quiz";

// A missing session sends the browser to /login before this resolves.
void queryClient.prefetchQuery(meQuery);

function Header() {
  const me = useMe();
  return (
    <header className="header">
      <nav className="header-inner">
        <Link to="/" className="header-title">
          Quizzer
        </Link>
        <NavLink to="/" end className="nav-link">
          Dokumentumaim
        </NavLink>
        <NavLink to="/history" className="nav-link">
          Eredményeim
        </NavLink>
        {me.isOwner && (
          <>
            <NavLink to="/invites" className="nav-link">
              Meghívók
            </NavLink>
            <NavLink to="/manage-ai" className="nav-link">
              AI kezelése
            </NavLink>
          </>
        )}
        <span className="header-user">{me.name ?? me.email}</span>
        <a className="header-signout" href="/auth/logout">
          Kijelentkezés
        </a>
      </nav>
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
          <Route path="/history" element={<HistoryScreen />} />
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
