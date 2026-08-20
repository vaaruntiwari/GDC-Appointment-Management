import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Printer, RefreshCw } from "lucide-react";
import { API, fmtDate, statusLabels, today } from "../App";

export default function DaySheet({ session, chairs, doctors }) {
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${session.token}` } }), [session.token]);
  const [date, setDate] = useState(today());
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/bookings?date=${date}`, auth);
      setBookings(r.data || []);
    } finally {
      setLoading(false);
    }
  }, [auth, date]);

  useEffect(() => {
    load();
  }, [load]);

  // Show one row per booking (dedupe by booking_id).
  const rows = useMemo(() => {
    const seen = new Map();
    for (const r of bookings) {
      if (!seen.has(r.booking_id)) seen.set(r.booking_id, r);
    }
    const list = [...seen.values()];
    list.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.chair_id.localeCompare(b.chair_id));
    return list;
  }, [bookings]);

  const chairLabel = (id) => chairs.find((c) => c.id === id)?.label || "—";
  const doctorName = (id) => doctors.find((d) => d.id === id)?.name || "—";

  return (
    <main className="workspace day-sheet-page" data-testid="day-sheet-view">
      <header className="topbar no-print">
        <div>
          <p className="eyebrow">
            SHIFT HANDOFF <span className="live-dot" /> DAY SHEET
          </p>
          <h1>Print day sheet</h1>
        </div>
        <div className="top-actions">
          <label className="date-label activity-date">
            <span>{fmtDate(date)}</span>
            <input data-testid="day-sheet-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="secondary" onClick={load} data-testid="day-sheet-refresh-button">
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="primary" data-testid="day-sheet-print-button" onClick={() => window.print()}>
            <Printer size={15} /> Print Day Sheet
          </button>
        </div>
      </header>

      <section className="day-sheet-body">
        <div className="print-header">
          <img src="/gdc-logo.jpg" alt="GDC" className="print-logo" />
          <div>
            <h2>Goregaon Dental Centre — Day Sheet</h2>
            <p>{fmtDate(date)}</p>
          </div>
        </div>

        {loading && <p className="loading-inline no-print">Loading day sheet…</p>}
        {!loading && rows.length === 0 && (
          <p className="empty-state" data-testid="day-sheet-empty">No appointments scheduled for this day.</p>
        )}
        {!loading && rows.length > 0 && (
          <table className="admin-table day-sheet-table" data-testid="day-sheet-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Chair</th>
                <th>Doctor</th>
                <th>Patient</th>
                <th>Treatment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.booking_id} data-testid={`day-sheet-row-${r.booking_id}`}>
                  <td className="mono">{r.start_time}–{r.end_time || ""}</td>
                  <td>{chairLabel(r.chair_id)}</td>
                  <td>{doctorName(r.doctor_id)}</td>
                  <td>
                    <strong>{r.patient_name}</strong>
                    <small> · {r.patient_id}</small>
                  </td>
                  <td>{r.treatment_details || "—"}</td>
                  <td>
                    <span className={`status-pill ${r.status}`}>{statusLabels[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="print-footer">Printed {new Date().toLocaleString()}</p>
      </section>
    </main>
  );
}
