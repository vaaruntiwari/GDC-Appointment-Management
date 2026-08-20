import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { RefreshCw } from "lucide-react";
import { API, connectWS, statusLabels, today, fmtDate } from "../App";

export default function ActivityView({ user, session, chairs, doctors, initialDate }) {
  const [date, setDate] = useState(initialDate || today());
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${session.token}` } }), [session.token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/bookings/history?date=${date}`, auth);
      setHistory(r.data || []);
    } finally {
      setLoading(false);
    }
  }, [auth, date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const conn = connectWS({
      onMessage: (msg) => {
        if (msg.type === "booking_changed" && msg.date === date) load();
      },
      onReconnect: () => load(),
    });
    return () => conn.close();
  }, [date, load]);

  const chairLabel = (id) => chairs.find((c) => c.id === id)?.label || "—";
  const doctorName = (id) => doctors.find((d) => d.id === id)?.name || "—";

  // One row per booking_id, most recently updated first.
  const grouped = Object.values(
    history.reduce((acc, row) => {
      const cur = acc[row.booking_id];
      if (!cur || (row.updated_at || row.created_at) > (cur.updated_at || cur.created_at)) {
        acc[row.booking_id] = row;
      }
      return acc;
    }, {})
  ).sort((a, b) => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || ""));

  return (
    <main className="workspace" data-testid="activity-view">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            LIVE ACTIVITY <span className="live-dot" /> AUDIT LOG
          </p>
          <h1>Activity for {fmtDate(date)}</h1>
        </div>
        <div className="top-actions">
          <label className="date-label activity-date">
            <span>{fmtDate(date)}</span>
            <input
              data-testid="activity-date-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button className="secondary" data-testid="activity-refresh-button" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </header>

      <section className="activity-body">
        {loading && <p className="loading-inline" data-testid="activity-loading">Loading activity…</p>}
        {!loading && grouped.length === 0 && (
          <p className="empty-state" data-testid="activity-empty">No bookings recorded for this date yet.</p>
        )}
        {!loading && grouped.length > 0 && (
          <table className="activity-table" data-testid="activity-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Chair</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Treatment</th>
                <th>Status</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => (
                <tr key={row.booking_id} data-testid={`activity-row-${row.booking_id}`} className={`activity-row ${row.status}`}>
                  <td>{row.start_time}</td>
                  <td>{chairLabel(row.chair_id)}</td>
                  <td>
                    <strong>{row.patient_name}</strong>
                    {row.patient_id && <small> · {row.patient_id}</small>}
                  </td>
                  <td>{doctorName(row.doctor_id)}</td>
                  <td className="clamp-cell">{row.treatment_details || "—"}</td>
                  <td>
                    <span className={`status-pill ${row.status}`}>{statusLabels[row.status]}</span>
                  </td>
                  <td className="mono">
                    {new Date(row.updated_at || row.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
