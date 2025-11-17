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
  const panelRef = useRef(null);
  const pollRef = useRef(null);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);
  const shown = useMemo(
    () => (tab === "unread" ? items.filter((i) => !i.read) : items),
    [tab, items]
  );

  // Ask permission once
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

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      // Always fetch full list so the All tab stays complete.
      const list = await apiGet("/notifications?limit=100");
      setItems(Array.isArray(list) ? list : list?.items || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  // Initial + polling (full list, not unread-only)
  useEffect(() => {
    if (!user) return;
    load();
    pollRef.current = setInterval(load, 15000);
    return () => clearInterval(pollRef.current);
  }, [user]);

  // Close on outside click (desktop flow)
  useEffect(() => {
    function onDown(e) {
      if (!open) return;
      if (!panelRef.current) return;
      // On mobile we use a backdrop; keep this for desktop only
      if (window.matchMedia("(max-width: 700px)").matches) return;
      if (!panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markRead(id) {
    try {
      await apiPost(`/notifications/${id}/read`, {});
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {}
  }

  async function markAllRead() {
    try {
      await apiPost("/notifications/mark-all-read", {});
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setTab("all");
    } catch {}
  }

  function openLink(n) {
    // mark read then go
    markRead(n.id);
    if (!n.link) return;
    if (n.link.startsWith("/#")) window.location.hash = n.link.slice(2);
    else if (n.link.startsWith("#")) window.location.hash = n.link;
    else window.location.href = n.link;
  }

  if (!user) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
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
        <>
          {/* Mobile backdrop (also fine on desktop) */}
          <div className="notif-backdrop" onClick={() => setOpen(false)} />

          <div ref={panelRef} className="notif-panel" role="dialog" aria-label="Notifications">
            {/* Sticky header with tabs & action */}
            <div className="notif-header">
              <div className="notif-title">Notifications</div>
              <div className="notif-tabs">
                <button
                  className={`notif-tab ${tab === "all" ? "active" : ""}`}
                  onClick={() => setTab("all")}
                >
                  All {items.length ? `(${items.length})` : ""}
                </button>
                <button
                  className={`notif-tab ${tab === "unread" ? "active" : ""}`}
                  onClick={() => setTab("unread")}
                >
                  Unread {unreadCount ? `(${unreadCount})` : ""}
                </button>
              </div>
              <div className="notif-actions">
                <button className="btn gray" onClick={markAllRead} disabled={!unreadCount}>
                  Mark all read
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="notif-body">
              {loading ? (
                <div className="notif-empty">Loading…</div>
              ) : shown.length === 0 ? (
                <div className="notif-empty">You’re all caught up.</div>
              ) : (
                <ul className="notif-list">
                  {shown.map((n) => (
                    <li key={n.id} className={`notif-item ${n.read ? "" : "unread"}`}>
                      <button className="notif-item-btn" onClick={() => openLink(n)}>
                        <div className="notif-item-main">
                          <div className="notif-item-title">
                            {!n.read && <span className="dot" />}
                            {n.title || "Notification"}
                          </div>
                          {n.body ? <div className="notif-item-desc">{n.body}</div> : null}
                          <div className="notif-item-meta">
                            {dayjs(n.time || n.createdAt).fromNow()}
                          </div>
                        </div>
                      </button>
                      {!n.read && (
                        <button className="btn" onClick={() => markRead(n.id)}>
                          Mark read
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
