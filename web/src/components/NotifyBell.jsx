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
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);
  const wrapRef = useRef(null);

  const isAdminOrPM = user && (user.role === "admin" || user.role === "pm");

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

  async function loadSummary() {
    if (!user || document.visibilityState === "hidden") return;
    try {
      const summary = await apiGet(`/notifications/summary`);
      setUnreadCount(Number(summary?.unreadCount || 0));
    } catch {
      // Keep the existing badge if the network is temporarily unavailable.
    }
  }

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    try {
      // Only download the notification list when the bell is opened.
      const list = await apiGet(`/notifications?limit=30`);
      const next = Array.isArray(list) ? list : [];
      setItems(next);
      setUnreadCount(next.filter((n) => !n.read).length);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      if (document.visibilityState !== "hidden") loadSummary();
    };

    refresh();
    // A tiny summary request every 2 minutes instead of downloading up to
    // 100 notification objects every 15 seconds.
    pollRef.current = setInterval(refresh, 120000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user?.id]);

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
    const wasUnread = items.some((n) => n.id === id && !n.read);
    try {
      await apiPost(`/notifications/${id}/read`, {});
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      if (wasUnread) setUnreadCount((n) => Math.max(0, n - 1));
    } catch {}
  }

  async function markAllRead() {
    try {
      // One request instead of one POST for every unread notification.
      await apiPost(`/me/notifications/read-all`, {});
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
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

  // robust extractor
  function pick(n, keys = []) {
    for (const k of keys) {
      if (n && n[k] != null && String(n[k]).trim() !== "") return n[k];
    }
    return null;
  }

  function getDisplayTitle(n) {
    const applicantName =
      pick(n, ["applicantName", "actorName", "userName", "user_full_name"]) ||
      pick(n?.data || {}, ["applicantName", "userName", "actorName"]) ||
      pick(n?.meta || {}, ["applicantName", "userName", "actorName"]);

    const jobTitle =
      pick(n, ["jobTitle", "job_name"]) ||
      pick(n?.data || {}, ["jobTitle", "job_name"]) ||
      pick(n?.meta || {}, ["jobTitle", "job_name"]);

    const t = String(n?.type || "");

    // Show "who applied" for admin/pm
    if (
      isAdminOrPM &&
      applicantName &&
      jobTitle &&
      [
        "job_applied",
        "job_application",
        "application",
        "job_applied_pm",
        "job_applied_admin",
        "app_new",
      ].includes(t)
    ) {
      return `${applicantName} applied for ${jobTitle}`;
    }

    // fallback to backend-provided title
    return n.title || "Notification";
  }

  function getDisplayBody(n) {
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
          const nextOpen = !open;
          setOpen(nextOpen);
          setTab("all");
          if (nextOpen) loadAll();
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
    // job created (old + new)
    case "job_created":
    case "job_new":
      return "🧰";

    // applied
    case "job_applied":
    case "job_application":
    case "application":
    case "job_applied_pm":
    case "job_applied_admin":
    case "app_new":
      return "📨";

    // approved/rejected (old + new)
    case "approved":
    case "app_approved":
      return "✅";
      
    case "rejected":
    case "app_rejected":
      return "❌";

    case "account_update":
      return "👤";

    default:
      return "🔔";
  }
}
