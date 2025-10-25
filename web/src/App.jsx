// web/src/App.jsx
import React, { useEffect, useState } from "react";
import { apiGet } from "./api";

/* ---------- Shared UI ---------- */
import Header from "./components/Header";

/* ---------- Main pages ---------- */
import Home from "./pages/Home";
import Available from "./pages/Available";
import MyJobs from "./pages/MyJobs";
import Payments from "./pages/Payments";
import JobDetails from "./pages/JobDetails";
import PMJobDetails from "./pages/PMJobDetails";
import Admin from "./pages/Admin"; // Wages
import Scanner from "./components/Scanner";


/* ---------- Auth ---------- */
import Login from "./pages/Login";
import Register from "./pages/Register";
import Forgot from "./pages/Forgot";
import Reset from "./pages/Reset";

/* ---------------- Auth hook ---------------- */
function useAuth() {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiGet("/me")
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { user, setUser, loaded };
}

/* ---------------- Mini hash router ---------------- */
function getHash() {
  return typeof window === "undefined" ? "#/" : window.location.hash || "#/";
}
function parseSegments(hash) {
  return hash.replace(/^#\//, "").split("?")[0].split("/").filter(Boolean);
}

export default function App() {
  const [route, setRoute] = useState(getHash());
  const { user, setUser, loaded } = useAuth();

  useEffect(() => {
    const onHash = () => setRoute(getHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (to) => (window.location.hash = to);

  function renderRoute() {
    if (!loaded) return <div className="container">Loading...</div>;

    const segs = parseSegments(route);
    const path = segs[0] || ""; // e.g. "", "available", "jobs", ...

    /* -------- Top-level main pages -------- */
    if (path === "" || path === "home") return <Home navigate={navigate} user={user} />;
    if (path === "available") return <Available navigate={navigate} user={user} />;
    if (path === "my-jobs") return <MyJobs navigate={navigate} user={user} />;
    if (path === "payments") return <Payments navigate={navigate} user={user} />;

    /* -------- Admin suite -------- */
    // Support multiple aliases for links that might exist in your Header
    if (path === "admin-users" || path === "users" || path === "users-audit")
      return <AdminUsers user={user} />;
    if (path === "wages") return <Admin navigate={navigate} user={user} />;

    /* -------- Auth -------- */
    if (path === "login") return <Login navigate={navigate} setUser={setUser} />;
    if (path === "register") return <Register navigate={navigate} setUser={setUser} />;
    if (path === "forgot") return <Forgot navigate={navigate} />;
    if (path === "reset") return <Reset navigate={navigate} />;

    /* -------- Jobs (detail + PM + scanner) -------- */
    if (path === "jobs") {
      const jobId = segs[1];
      const sub = segs[2]; // "scanner" etc.

      if (!jobId) return <div className="container">Not Found</div>;

      // Canonical scanner route: #/jobs/:id/scanner
      if (sub === "scanner") {
        if (user && (user.role === "pm" || user.role === "admin")) {
          return <Scanner navigate={navigate} user={user} />;
        }
        return <div className="container">Not Found</div>;
      }

      // PM/Admin vs Part-timer views
      if (user && (user.role === "pm" || user.role === "admin")) {
        return <PMJobDetails jobId={jobId} navigate={navigate} user={user} />;
      }
      return <JobDetails jobId={jobId} navigate={navigate} user={user} />;
    }

    /* -------- Fallback -------- */
    return <div className="container">Not Found</div>;
  }

  return (
    <div>
      {/* Keep navigate for backward-compat; harmless if Header ignores it */}
      <Header user={user} navigate={navigate} setUser={setUser} />
      {renderRoute()}
    </div>
  );
}
