// web/src/components/NotifyBell.jsx
import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { ensurePushEnabled } from "../push";

export default function NotifyBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((i) => !i.read).length;

  async function refresh() {
    try {
      const r = await apiGet("/me/notifications?limit=50");
      setItems(r.items || []);
    } catch {}
  }

  async function markAllRead() {
    try {
      await apiPost("/me/notifications/read-all");
      await refresh();
    } catch {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000); // simple polling
    return () => clearInterval(id);
  }, []);

  async function enablePush() {
    try {
      await ensurePushEnabled();
      alert("Push enabled on this device ✔");
    } catch (e) {
      alert(e.message || "Failed to enable push");
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        🔔 {unread ? <span className="status">{unread}</span> : null}
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 38, width: 360, maxHeight: 420, overflowY: "auto", zIndex: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Notifications</strong>
            <div>
              <button className="btn" onClick={refresh}>Refresh</button>{" "}
              <button className="btn" onClick={markAllRead}>Mark all read</button>{" "}
              <button className="btn" onClick={enablePush}>Enable push</button>
            </div>
          </div>
          {!items.length ? (
            <div style={{ color: "#666", padding: 8 }}>No notifications yet.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} style={{ borderTop: "1px solid #eee", padding: "8px 4px" }}>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 13, color: "#555" }}>{n.body}</div>
                {n.link && (
                  <a href={n.link} style={{ fontSize: 12 }}>Open</a>
                )}
                <div style={{ fontSize: 11, color: "#888" }}>{new Date(n.time).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
