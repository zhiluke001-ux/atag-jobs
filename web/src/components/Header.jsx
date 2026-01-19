// web/src/components/Header.jsx
import React, { useEffect, useMemo, useState } from "react";
import { logout } from "../auth";
import NotificationsBell from "./NotifyBell";

// fallback avatar if missing
function fallbackAvatar(user) {
  const base = user?.name || user?.email || user?.username || "User";
  const initials =
    base
      .replace(/[_.-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase() || "U";

  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    initials
  )}&size=128&background=random&color=fff&bold=true`;
}

function useHashPath() {
  const read = () => {
    const h = window.location.hash || "#/";
    const raw = h.startsWith("#") ? h.slice(1) : h;
    const clean = (raw || "/").split("?")[0];
    return clean === "" ? "/" : clean;
  };

  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : read()
  );

  useEffect(() => {
    const onHash = () => setPath(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return path;
}

export default function Header({ user, setUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hashPath = useHashPath();

  function doLogout() {
    try {
      logout();
    } catch {}
    if (setUser) setUser(null);
    window.location.hash = "#/";
    setMenuOpen(false);
  }

  const role = user?.role || "";
  const isAdmin = role === "admin";
  const isPartTimer = role === "part-timer";

  const avatarUrl = useMemo(
    () => (user?.avatarUrl ? user.avatarUrl : fallbackAvatar(user)),
    [user]
  );

  const toPath = (href) => {
    const p = href.startsWith("#") ? href.slice(1) : href;
    return (p || "/").split("?")[0] || "/";
  };

  const isActive = (to) => {
    const p = (hashPath || "/").split("?")[0] || "/";
    const t = (to || "/").split("?")[0] || "/";
    if (t === "/") return p === "/" || p === "";
    return p === t || p.startsWith(t + "/");
  };

  function NavLink({ href, children }) {
    const active = isActive(toPath(href));
    return (
      <a
        href={href}
        className={`nav-link${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={() => setMenuOpen(false)}
      >
        {children}
      </a>
    );
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* Brand */}
        <a className="brand" href="#/" onClick={() => setMenuOpen(false)}>
          <span className="brand-box">ATAG</span>
          <span className="brand-text">Jobs</span>
        </a>

        {/* Desktop Nav */}
        <nav className="nav-links" aria-label="Primary">
          <NavLink href="#/">Home</NavLink>
          {isPartTimer && <NavLink href="#/my-jobs">My Jobs</NavLink>}
          {!!user && <NavLink href="#/profile">Profile</NavLink>}
          {isAdmin && (
            <>
              <NavLink href="#/wages">Wages</NavLink>
              <NavLink href="#/admin-users">User Management</NavLink>
              <NavLink href="#/admin-audit">Audit Log</NavLink>
            </>
          )}
        </nav>

        {/* Right Side */}
        <div className="right-side">
          <div className="socials">
            {/* keep your svg icons same here */}
          </div>

          <div className="v-sep" />

          <div className="auth">
            {user ? (
              <>
                <a href="#/profile" className="avatar-link">
                  <img className="avatar" src={avatarUrl} alt="Profile avatar" />
                </a>

                <span className="hi">
                  Hi, {user.name} <span className="role">· {role}</span>
                </span>

                <button className="btn" onClick={doLogout}>
                  Log out
                </button>
              </>
            ) : (
              <a className="btn" href="#/login">
                Log in
              </a>
            )}
          </div>

          {/* Menu button only on mobile */}
          <button
            className="btn menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen ? "true" : "false"}
            onClick={() => setMenuOpen(true)}
          >
            Menu
          </button>

          <NotificationsBell user={user} />
        </div>
      </div>

      {/* Mobile menu modal */}
      {menuOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="modal" onClick={() => setMenuOpen(false)}>
            <div
              className="modal-card modal-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">Menu</div>
              <div className="modal-body">
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <a className="btn" href="#/" onClick={() => setMenuOpen(false)}>Home</a>
                  {isPartTimer && (
                    <a className="btn" href="#/my-jobs" onClick={() => setMenuOpen(false)}>My Jobs</a>
                  )}
                  {!!user && (
                    <a className="btn" href="#/profile" onClick={() => setMenuOpen(false)}>Profile</a>
                  )}
                  {isAdmin && (
                    <>
                      <a className="btn" href="#/wages" onClick={() => setMenuOpen(false)}>Wages</a>
                      <a className="btn" href="#/admin-users" onClick={() => setMenuOpen(false)}>User Management</a>
                      <a className="btn" href="#/admin-audit" onClick={() => setMenuOpen(false)}>Audit Log</a>
                    </>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  {!user ? (
                    <a className="btn primary" href="#/login" onClick={() => setMenuOpen(false)}>Log in</a>
                  ) : (
                    <button className="btn danger" onClick={doLogout}>Log out</button>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn" onClick={() => setMenuOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
