// web/src/components/Header.jsx
import React, { useEffect, useMemo, useState } from "react";
import { logout } from "../auth";
import NotificationsBell from "./NotifyBell";

// Tiny fallback if user.avatarUrl is missing
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

function isActiveHash(currentHash, href) {
  const h = currentHash || "#/";
  if (href === "#/") return h === "#/" || h === "" || h.startsWith("#/?");
  return h.startsWith(href);
}

export default function Header({ user, setUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState(() => window.location.hash || "#/");

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  const navItems = useMemo(() => {
    const items = [{ href: "#/", label: "Home" }];

    if (isPartTimer) items.push({ href: "#/my-jobs", label: "My Jobs" });
    if (user) items.push({ href: "#/profile", label: "Profile" });

    if (isAdmin) {
      items.push(
        { href: "#/wages", label: "Wages" },
        { href: "#/admin-users", label: "User Management" },
        { href: "#/admin-audit", label: "Audit Log" }
      );
    }
    return items;
  }, [isAdmin, isPartTimer, user]);

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* Left: Brand */}
        <a className="brand" href="#/" aria-label="ATAG Jobs Home">
          <span className="brand-box">ATAG JOBS</span>
        </a>

        {/* Center: Desktop nav */}
        <nav className="nav-links" aria-label="Primary">
          {navItems.map((it) => {
            const active = isActiveHash(hash, it.href);
            return (
              <a
                key={it.href}
                href={it.href}
                className={active ? "is-active" : ""}
                aria-current={active ? "page" : undefined}
              >
                {it.label}
              </a>
            );
          })}
        </nav>

        {/* Right: Socials + auth + menu + notifications */}
        <div className="right-side">
          {/* Socials (desktop/tablet) */}
          <div className="socials" aria-label="Social links">
            <a
              href="https://www.facebook.com/atagteambuilding"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className="icon"
              title="Facebook"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22 12.07C22 6.49 17.52 2 12 2S2 6.49 2 12.07C2 17.11 5.66 21.2 10.44 22v-6.99H7.9v-2.94h2.54V9.41c0-2.5 1.49-3.88 3.77-3.88 1.09 0 2.23.2 2.23.2v2.45h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.94h-2.34V22C18.34 21.2 22 17.11 22 12.07z" />
              </svg>
            </a>

            <a
              href="https://www.instagram.com/atagteambuilding/"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="icon"
              title="Instagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5zm5.75-2.75a1.25 1.25 0 1 1-1.25 1.25 1.25 1.25 0 0 1 1.25-1.25z" />
              </svg>
            </a>

            <a
              href="https://www.youtube.com/channel/UCsMpfcdY-ge_F3Q-sPyqzQg"
              target="_blank"
              rel="noreferrer"
              aria-label="YouTube"
              className="icon"
              title="YouTube"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.5 12 3.5 12 3.5s-7.6 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1C4.4 20.5 12 20.5 12 20.5s7.6 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.75 15.5v-7l6 3.5z" />
              </svg>
            </a>

            <a
              href="https://www.tripadvisor.com.my/Attraction_Review-g298313-d11751408-Reviews-ATAG_Malaysia-Petaling_Jaya_Petaling_District_Selangor.html"
              target="_blank"
              rel="noreferrer"
              aria-label="Tripadvisor"
              className="icon"
              title="Tripadvisor"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 7c3.9 0 7.2 1.5 9 3.9l1-1.4h2l-2.7 3.2L24 16.9h-2l-1-1.4C19.2 18 15.9 19.5 12 19.5S4.8 18 3 15.6l-1 1.3H0l2.7-3.2L0 9.5h2l1 1.3C4.8 7.9 8.1 7 12 7zm-5 3.5A3.5 3.5 0 1 0 10.5 14 3.5 3.5 0 0 0 7 10.5zm10 0A3.5 3.5 0 1 0 20.5 14 3.5 3.5 0 0 0 17 10.5zm-10 2a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 7 12.5zm10 0a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 17 12.5z" />
              </svg>
            </a>

            <a
              href="https://www.linkedin.com/company/atagteambuilding/"
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
              className="icon"
              title="LinkedIn"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM0 8h5v15H0zM8 8h4.8v2.1h.1C13.84 8.8 15.9 8 18.3 8 23.1 8 24 11 24 15.6V23H19v-6.4c0-1.5 0-3.3-2-3.3s-2.2 1.6-2.2 3.2V23H8z" />
              </svg>
            </a>
          </div>

          {/* User */}
          <div className="auth">
            {user ? (
              <>
                <a href="#/profile" className="avatar-link" title="Profile">
                  <img src={avatarUrl} alt="Profile avatar" />
                </a>

                <span className="hi" title={user?.name || ""}>
                  Hi, {user.name} <span className="role">· {role}</span>
                </span>

                <button className="btn btn-logout" onClick={doLogout}>
                  Log out
                </button>
              </>
            ) : (
              <a className="btn" href="#/login">
                Log in
              </a>
            )}
          </div>

          {/* Mobile menu toggle (only shows on small screens via CSS) */}
          <button
            className="btn menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen ? "true" : "false"}
            onClick={() => setMenuOpen(true)}
          >
            Menu
          </button>

          {/* Notifications */}
          <NotificationsBell user={user} />
        </div>
      </div>

      {/* Mobile menu */}
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
                <div
                  className="row"
                  style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}
                >
                  {navItems.map((it) => (
                    <a
                      key={it.href}
                      className="btn"
                      href={it.href}
                      onClick={() => setMenuOpen(false)}
                    >
                      {it.label}
                    </a>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    className="btn"
                    href="https://www.facebook.com/atagteambuilding"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Facebook
                  </a>
                  <a
                    className="btn"
                    href="https://www.instagram.com/atagteambuilding/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Instagram
                  </a>
                  <a
                    className="btn"
                    href="https://www.youtube.com/channel/UCsMpfcdY-ge_F3Q-sPyqzQg"
                    target="_blank"
                    rel="noreferrer"
                  >
                    YouTube
                  </a>
                  <a
                    className="btn"
                    href="https://www.linkedin.com/company/atagteambuilding/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </a>
                </div>

                <div style={{ marginTop: 12 }}>
                  {!user ? (
                    <a
                      className="btn primary"
                      href="#/login"
                      onClick={() => setMenuOpen(false)}
                    >
                      Log in
                    </a>
                  ) : (
                    <button className="btn danger" onClick={doLogout}>
                      Log out
                    </button>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn" onClick={() => setMenuOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
