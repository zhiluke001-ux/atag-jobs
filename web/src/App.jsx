import React, { useEffect, useState } from "react";
import Home from "./pages/Home";
import Available from "./pages/Available";
import Login from "./pages/Login";
import JobDetails from "./pages/JobDetails";
import MyJobs from "./pages/MyJobs";
import Payments from "./pages/Payments";
import PMJobDetails from "./pages/PMJobDetails";
import Admin from "./pages/Admin";
import Scanner from "./components/Scanner";        // 👈 add this import
import Header from "./components/Header";
import { apiGet } from "./api";

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

// Small hash-router helpers
function getHash() {
  return typeof window === "undefined" ? "#/" : window.location.hash || "#/";
}
function parseSegments(hash) {
  // "#/jobs/j2/scanner?x=1" -> ["jobs","j2","scanner"]
  return hash.replace(/^#\//, "").split("?")[0].split("/").filter(Boolean);
}

export default function App() {
  const [route, setRoute] = useState(getHash());
  const { user, setUser, loaded } = useAuth();

  useEffect(() => {
    function onHash() { setRoute(getHash()); }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(to) {
    window.location.hash = to;
  }

  function renderRoute() {
    if (!loaded) return <div className="container">Loading...</div>;

    const segs = parseSegments(route); // e.g., ["jobs","j2","scanner"]
    const path = segs[0] || "";        // "", "available", "jobs", etc.

    // Home
    if (path === "") return <Home navigate={navigate} user={user} />;

    // Simple top-level routes
    if (path === "available") return <Available navigate={navigate} user={user} />;
    if (path === "login") return <Login navigate={navigate} setUser={setUser} />;
    if (path === "my-jobs") return <MyJobs navigate={navigate} user={user} />;
    if (path === "payments") return <Payments navigate={navigate} user={user} />;
    if (path === "wages") return <Admin navigate={navigate} user={user} />;

    // Jobs routes
    if (path === "jobs") {
      const jobId = segs[1];
      const sub = segs[2]; // e.g., "scanner"

      if (!jobId) return <div className="container">Not Found</div>;

      // Canonical scanner route: #/jobs/:id/scanner
      if (sub === "scanner") {
        // PM/Admin only – if not, show Not Found
        if (user && (user.role === "pm" || user.role === "admin")) {
          return <Scanner navigate={navigate} user={user} />;
        }
        return <div className="container">Not Found</div>;
      }

      // Job details by role
      if (user && (user.role === "pm" || user.role === "admin")) {
        return <PMJobDetails jobId={jobId} navigate={navigate} user={user} />;
      } else {
        return <JobDetails jobId={jobId} navigate={navigate} user={user} />;
      }
    }

    // (Optional) PM create route if you have that page
    // if (path === "pm-create") return <PMCreate navigate={navigate} user={user} />;

    return <div className="container">Not Found</div>;
  }

  return (
    <div>
      <Header user={user} navigate={navigate} setUser={setUser} />
      {renderRoute()}
    </div>
  );
}
