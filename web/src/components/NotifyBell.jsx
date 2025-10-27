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
  const intervalRef = useRef(null);

  const unreadCount = useMemo(() => items.filter(i => !i.read).length, [items]);
  const shown = useMemo(() =>
    tab === "unread" ? items.filter(i => !i.read) : items
  , [tab, items]);

  // Ask for notification permission once per browser (no SW required for now)
  useEffect(() => {
    if (!user) return;
    try {
      const KEY = "atag.notif.askOnce";
      if (typeof window !== "undefined" &&
          "Notification" in window &&
          localStorage.getItem(KEY) !== "1" &&
          Notification.permission === "default") {
        Notification.requestPermission().finally(() => {
          localStorage.setItem(KEY, "1");
        });
      }
    } catch {}
  }, [user]);

  async function load(unreadOnly = false) {
    if (!user) return;
    setLoading(true);
    try {
      const list = await apiGet(`/notifications?limit=100${unreadOnly ? "&unread=1" : ""}`);
      setItems(list);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!user) return;
    load(false);
    // Light polling
    intervalRef.current = setInterval(() => load(true), 15000);
    return () => clearInterval(intervalRef.current);
  }, [user]);

  async function markRead(id) {
    try {
      await apiPost(`/notifications/${id}/read`, {});
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  }

  function go(n) {
    // mark read and navigate
    markRead(n.id);
    if (n.link) {
      if (n.link.startsWith("/#")) window.location.hash = n.link.slice(2);
      else window.location.href = n.link;
    }
  }

  if (!user) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn"
        aria-label="Notifications"
        onClick={() => setOpen(v => !v)}
        style={{ position: "relative" }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            minWidth: 18, height: 18, padding: "0 4px",
            borderRadius: 999, background: "#ef4444", color: "#fff",
            fontSize: 12, lineHeight: "18px", textAlign: "center"
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute", right: 0, marginTop: 8, width: 420, zIndex: 30,
            maxHeight: 420, overflow: "auto"
          }}
        >
          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, paddingBottom: 6, borderBottom: "1px solid #eee" }}>
            <button
              className="btn"
              onClick={() => setTab("all")}
              style={{ background: tab === "all" ? "#111" : "#f5f5f5", color: tab === "all" ? "#fff" : "#111" }}
            >All</button>
            <button
              className="btn"
              onClick={() => setTab("unread")}
              style={{ background: tab === "unread" ? "#111" : "#f5f5f5", color: tab === "unread" ? "#fff" : "#111" }}
            >Unread{unreadCount ? ` (${unreadCount})` : ""}</button>
          </div>

          {/* List */}
          <div style={{ paddingTop: 6 }}>
            {loading && <div style={{ padding: 10, color: "#666" }}>Loading…</div>}
            {!loading && shown.length === 0 && (
              <div style={{ padding: 12, color: "#666" }}>You’re all caught up.</div>
            )}
            {shown.map(n => (
              <div
                key={n.id}
                onClick={() => go(n)}
                style={{
                  padding: "10px 8px",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex", gap: 10, cursor: "pointer",
                  background: n.read ? "#fff" : "#f8fafc"
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 999,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid #eee"
                }}>
                  {iconFor(n.type)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  {n.body ? <div style={{ color: "#444", marginTop: 2 }}>{n.body}</div> : null}
                  <div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>
                    {dayjs(n.time).fromNow()}
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
    case "job_created": return "🧰";
    case "approved":    return "✅";
    case "rejected":    return "❌";
    case "account_update": return "👤";
    default: return "🔔";
  }
}
