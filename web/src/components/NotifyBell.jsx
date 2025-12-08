// web/src/components/NotifyBell.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { apiGet, apiPost } from "../api";

dayjs.extend(relativeTime);

export default function NotificationsBell({ user }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("all"); // "all" | "unread"
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);
  const wrapRef = useRef(null);

  const isAdminOrPM = user && (user.role === "admin" || user.role === "pm");

  const unreadCount = useMemo(
    () => items.filter((i) => !i.read).length,
    [items]
  );
  const shown = useMemo(
    () => (tab === "unread" ? items.filter((i) => !i.read) : items),
    [tab, items]
  );

  // Ask for notification permission once per browser
  useEffect(() => {
    if (!user) return;
    try {
      const KEY = "atag.notif.askOnce";
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        localStorage.getItem(KEY) !== "1" &&
        Notification.permission === "default"
      ) {
        Notification.requestPermission().finally(() => {
          localStorage.setItem(KEY, "1");
        });
      }
    } catch {}
  }, [user]);

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    try {
      // IMPORTANT: always load the full list, not unread-only
      const list = await apiGet(`/notifications?limit=100`);
      setItems(list || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadAll();
    // Light polling; keep full list so "All" doesn't disappear
    pollRef.current = setInterval(loadAll, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user]);

  // Close when clicking outside
  useEffect(() => {
    function onDocClick(e) {
      if (!open) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  async function markRead(id) {
    try {
      await apiPost(`/notifications/${id}/read`, {});
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {}
  }

  async function markAllRead() {
    const unread = items.filter((n) => !n.read);
    try {
      await Promise.all(
        unread.map((n) => apiPost(`/notifications/${n.id}/read`, {}))
      );
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {}
  }

  function go(n) {
    markRead(n.id);
    if (n.link) {
      if (n.link.startsWith("/#")) window.location.hash = n.link.slice(2);
      else window.location.href = n.link;
    }
  }

  if (!user) return null;

  // Helper: derive "who applied for what job" for admin/pm
  function getDisplayTitle(n) {
    // Try to be robust with different payload shapes:
    const applicantName =
      n.applicantName ||
      n.actorName ||
      n.userName ||
      n.user_full_name ||
      (n.data && (n.data.applicantName || n.data.userName || n.data.actorName)) ||
      (n.meta && (n.meta.applicantName || n.meta.userName || n.meta.actorName));

    const jobTitle =
      n.jobTitle ||
      (n.data && (n.data.jobTitle || n.data.job_name || n.data.jobTitle)) ||
      (n.meta && (n.meta.jobTitle || n.meta.job_name || n.meta.jobTitle));

    // Only override for admin/pm AND when both pieces of info exist
    if (
      isAdminOrPM &&
      applicantName &&
      jobTitle &&
      (n.type === "job_applied" ||
        n.type === "job_application" ||
        n.type === "application" ||
        n.type === "job_applied_pm" ||
        n.type === "job_applied_admin" ||
        n.type === "approved" ||
        n.type === "rejected")
    ) {
      return `${applicantName} applied for ${jobTitle}`;
    }

    // fallback to backend-provided title
    return n.title || "Notification";
  }

  function getDisplayBody(n) {
    // You can still show backend body underneath (extra info)
    return n.body || "";
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="btn"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="notif-popover"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setTab("all");
        }}
        style={{ position: "relative" }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 999,
              background: "#ef4444",
              color: "#fff",
              fontSize: 12,
              lineHeight: "18px",
              textAlign: "center",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notif-popover"
          className="notif-popover no-scrollbar"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Tabs / actions */}
          <div className="notif-tabs">
            <button
              className={`btn ${tab === "all" ? "is-active" : ""}`}
              onClick={() => setTab("all")}
            >
              All ({items.length})
            </button>
            <button
              className={`btn ${tab === "unread" ? "is-active" : ""}`}
              onClick={() => setTab("unread")}
            >
              Unread{unreadCount ? ` (${unreadCount})` : ""}
            </button>
            <button
              className="btn gray"
              onClick={markAllRead}
              style={{ marginLeft: "auto" }}
              disabled={unreadCount === 0}
              title="Mark all as read"
            >
              Mark all read
            </button>
          </div>

          {/* List */}
          <div className="notif-list">
            {loading && <div className="notif-empty">Loading…</div>}
            {!loading && shown.length === 0 && (
              <div className="notif-empty">You’re all caught up.</div>
            )}

            {shown.map((n) => (
              <div
                key={n.id}
                className={`notif-item ${n.read ? "" : "unread"}`}
                onClick={() => go(n)}
              >
                <div className="ico">{iconFor(n.type)}</div>
                <div className="meta">
                  <div className="title">{getDisplayTitle(n)}</div>
                  {getDisplayBody(n) ? (
                    <div className="body">{getDisplayBody(n)}</div>
                  ) : null}
                  <div className="time">
                    {n.time ? dayjs(n.time).fromNow() : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function iconFor(type) {
  switch (type) {
    case "job_created":
      return "🧰";
    case "job_applied":
    case "job_application":
    case "application":
      return "📨";
    case "approved":
      return "✅";
    case "rejected":
      return "❌";
    case "account_update":
      return "👤";
    default:
      return "🔔";
  }
}
