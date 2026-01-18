// web/src/App.jsx
import React, { useEffect, useState } from "react";
import { fetchCurrentUser } from "./auth";

import Header from "./components/Header";

import Home from "./pages/Home";
import Available from "./pages/Available";
import MyJobs from "./pages/MyJobs";
import Payments from "./pages/Payments";
import JobDetails from "./pages/JobDetails";
import PMJobDetails from "./pages/PMJobDetails";
import Admin from "./pages/Admin";
import Scanner from "./components/Scanner";
import AdminUsers from "./pages/AdminUsers";
import AdminAudit from "./pages/AdminAudit";
import Profile from "./pages/Profile"; // now "Status" page

import Login from "./pages/Login";
import Register from "./pages/Register";
import Forgot from "./pages/Forgot";
import Reset from "./pages/Reset";

function useAuth() {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setUser(u || null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { user, setUser, loaded };
}

function getHash() {
  return typeof window === "undefined" ? "#/" : window.location.hash || "#/";
}
function parseSegments(hash) {
  return hash.replace(/^#\//, "").split("?")[0].split("/").filter(Boolean);
}

function isVerifiedUser(u) {
  if (!u) return false;
  if (u.verified === true) return true;
  const s = String(u.verificationStatus || u.verifyStatus || "").toLowerCase();
  return ["verified", "approved", "approve"].includes(s);
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
    const path = segs[0] || "";

    const authed = !!user;
    const verified = isVerifiedUser(user);

    // ✅ If logged in but NOT verified, force them to Status page (Profile route)
    const needsVerificationGate = authed && !verified;
    const allowWhenUnverified = new Set(["profile", "login", "register", "forgot", "reset"]);
    if (needsVerificationGate && !allowWhenUnverified.has(path)) {
      return <Profile navigate={navigate} user={user} setUser={setUser} />;
    }

    if (path === "" || path === "home") return <Home navigate={navigate} user={user} />;
    if (path === "available") return <Available navigate={navigate} user={user} />;
    if (path === "my-jobs") return <MyJobs navigate={navigate} user={user} />;
    if (path === "payments") return <Payments navigate={navigate} user={user} />;

    if (path === "profile") {
      if (!user) return <Login navigate={navigate} setUser={setUser} />;
      return <Profile navigate={navigate} user={user} setUser={setUser} />;
    }

    if (path === "admin-users" || path === "users") {
      return <AdminUsers user={user} />;
    }

    if (path === "admin-audit" || path === "audit") return <AdminAudit user={user} />;

    if (path === "wages" || path === "users-audit") {
      return <Admin navigate={navigate} user={user} />;
    }

    if (path === "login") return <Login navigate={navigate} setUser={setUser} />;
    if (path === "register") return <Register navigate={navigate} setUser={setUser} />;
    if (path === "forgot") return <Forgot navigate={navigate} />;
    if (path === "reset") return <Reset navigate={navigate} />;

    if (path === "jobs") {
      const jobId = segs[1];
      const sub = segs[2];

      if (!jobId) return <div className="container">Not Found</div>;

      if (sub === "scanner") {
        if (user && (user.role === "pm" || user.role === "admin")) {
          return <Scanner navigate={navigate} user={user} />;
        }
        return <div className="container">Not Found</div>;
      }

      if (user && (user.role === "pm" || user.role === "admin")) {
        return <PMJobDetails jobId={jobId} navigate={navigate} user={user} />;
      }
      return <JobDetails jobId={jobId} navigate={navigate} user={user} />;
    }

    return <div className="container">Not Found</div>;
  }

  return (
    <div>
      <Header user={user} navigate={navigate} setUser={setUser} />
      {renderRoute()}
    </div>
  );
}
