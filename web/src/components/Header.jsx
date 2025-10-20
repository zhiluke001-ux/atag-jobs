import React from "react";
import { logout } from "../auth";

export default function Header({ user, setUser }) {
  function doLogout() {
    try { logout(); } catch {}
    if (setUser) setUser(null);
    window.location.hash = "#/";
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* Brand */}
        <a className="brand" href="#/">
          <span className="brand-box">AT</span>
          <span className="brand-text">ATAG Jobs</span>
        </a>

        {/* Main nav (Home now shows the full jobs list; remove separate Jobs link) */}
        <nav className="nav-links">
          <a href="#/">Home</a>

          {/* Part-timer only */}
          {user?.role === "part-timer" && <a href="#/my-jobs">My Jobs</a>}

          {/* Admin-only wages/config */}
          {user?.role === "admin" && <a href="#/wages">Wages</a>}
        </nav>

        {/* Right side: socials + auth */}
        <div className="right-side">
          <div className="socials">
            <a href="#" target="_blank" rel="noreferrer" aria-label="Facebook" className="icon">
              <svg viewBox="0 0 24 24"><path d="M22 12.07C22 6.49 17.52 2 12 2S2 6.49 2 12.07C2 17.11 5.66 21.2 10.44 22v-6.99H7.9v-2.94h2.54V9.41c0-2.5 1.49-3.88 3.77-3.88 1.09 0 2.23.2 2.23.2v2.45h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.94h-2.34V22C18.34 21.2 22 17.11 22 12.07z"/></svg>
            </a>
            <a href="#" target="_blank" rel="noreferrer" aria-label="Instagram" className="icon">
              <svg viewBox="0 0 24 24"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5zm5.75-2.75a1.25 1.25 0 1 1-1.25 1.25 1.25 1.25 0 0 1 1.25-1.25z"/></svg>
            </a>
            <a href="#" target="_blank" rel="noreferrer" aria-label="YouTube" className="icon">
              <svg viewBox="0 0 24 24"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.5 12 3.5 12 3.5s-7.6 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1C4.4 20.5 12 20.5 12 20.5s7.6 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.75 15.5v-7l6 3.5z"/></svg>
            </a>
            <a href="#" target="_blank" rel="noreferrer" aria-label="Tripadvisor" className="icon">
              <svg viewBox="0 0 24 24"><path d="M12 7c3.9 0 7.2 1.5 9 3.9l1-1.4h2l-2.7 3.2L24 16.9h-2l-1-1.4C19.2 18 15.9 19.5 12 19.5S4.8 18 3 15.6l-1 1.3H0l2.7-3.2L0 9.5h2l1 1.3C4.8 7.9 8.1 7 12 7zm-5 3.5A3.5 3.5 0 1 0 10.5 14 3.5 3.5 0 0 0 7 10.5zm10 0A3.5 3.5 0 1 0 20.5 14 3.5 3.5 0 0 0 17 10.5zm-10 2a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 7 12.5zm10 0a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 17 12.5z"/></svg>
            </a>
            <a href="#" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="icon">
              <svg viewBox="0 0 24 24"><path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM0 8h5v15H0zM8 8h4.8v2.1h.1C13.84 8.8 15.9 8 18.3 8 23.1 8 24 11 24 15.6V23H19v-6.4c0-1.5 0-3.3-2-3.3s-2.2 1.6-2.2 3.2V23H8z"/></svg>
            </a>
          </div>

          <div className="auth">
            {user ? (
              <>
                <span className="hi">
                  Hi, {user.name} <span className="role">· {user.role}</span>
                </span>
                <button className="btn" onClick={doLogout}>Log out</button>
              </>
            ) : (
              <a className="btn" href="#/login">Log in</a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
