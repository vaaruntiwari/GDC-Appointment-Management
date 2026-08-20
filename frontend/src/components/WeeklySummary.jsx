import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { RefreshCw } from "lucide-react";
import { API } from "../App";

export default function WeeklySummary({ session, doctors, chairs }) {
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${session.token}` } }), [session.token]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/weekly-summary?date=${date}`, auth);
      setData(r.data);
    } finally {
      setLoading(false);
    }
  }, [auth, date]);

  useEffect(() => {
    load();
  }, [load]);

  const doctorName = (id) => doctors.find((d) => d.id === id)?.name || "—";
  const chairLabel = (id) => chairs.find((c) => c.id === id)?.label || "—";

  const doctorRows = useMemo(() => {
    if (!data) return [];
    return [...data.per_doctor].sort((a, b) => b.total - a.total);
  }, [data]);

  const chairRows = useMemo(() => {
    if (!data) return [];
    return [...data.per_chair].sort((a, b) => b.utilisation - a.utilisation);
  }, [data]);

  return (
    <main className="workspace" data-testid="weekly-summary-view">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            OPERATIONS <span className="live-dot" /> WEEKLY ROLLUP
          </p>
          <h1>Weekly summary</h1>
        </div>
        <div className="top-actions">
          <label className="date-label activity-date">
            <span>{data ? `${data.week_start} — ${data.week_end}` : ""}</span>
            <input
              data-testid="weekly-date-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button className="secondary" data-testid="weekly-refresh-button" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </header>

      <section className="weekly-body">
        {loading && <p className="loading-inline">Loading summary…</p>}
        {!loading && data && (
          <>
            <div className="kpi-row" data-testid="weekly-kpis">
              <div className="kpi">
                <span className="kpi-label">Total appointments</span>
                <strong>{data.totals.total}</strong>
              </div>
              <div className="kpi kpi-confirmed">
                <span className="kpi-label">Confirmed</span>
                <strong>{data.totals.booked}</strong>
              </div>
              <div className="kpi kpi-arrived">
                <span className="kpi-label">Patient Arrived</span>
                <strong>{data.totals.arrived}</strong>
              </div>
              <div className="kpi kpi-completed">
                <span className="kpi-label">Completed</span>
                <strong>{data.totals.completed}</strong>
              </div>
              <div className="kpi kpi-cancelled">
                <span className="kpi-label">Cancelled</span>
                <strong>{data.totals.cancelled}</strong>
              </div>
              <div className="kpi kpi-noshow">
                <span className="kpi-label">No-show</span>
                <strong>{data.totals.no_show}</strong>
              </div>
            </div>

            <div className="weekly-grid">
              <section className="admin-section">
                <h3>Daily trend</h3>
                <table className="admin-table" data-testid="weekly-daily-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Total</th>
                      <th>Completed</th>
                      <th>Cancelled</th>
                      <th>No-show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td className="mono">{d.date}</td>
                        <td>{d.total}</td>
                        <td>{d.completed}</td>
                        <td>{d.cancelled}</td>
                        <td>{d["no-show"]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="admin-section">
                <h3>Busiest doctors</h3>
                <table className="admin-table" data-testid="weekly-doctor-table">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Total</th>
                      <th>Completed</th>
                      <th>Cancelled</th>
                      <th>No-show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doctorRows.map((d) => (
                      <tr key={d.doctor_id}>
                        <td>{doctorName(d.doctor_id)}</td>
                        <td>{d.total}</td>
                        <td>{d.completed}</td>
                        <td>{d.cancelled}</td>
                        <td>{d["no-show"]}</td>
                      </tr>
                    ))}
                    {doctorRows.length === 0 && (
                      <tr><td colSpan={5} className="mono">No appointments this week.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              <section className="admin-section">
                <h3>Chair utilisation</h3>
                <table className="admin-table" data-testid="weekly-chair-table">
                  <thead>
                    <tr>
                      <th>Chair</th>
                      <th>Bookings</th>
                      <th>Booked minutes</th>
                      <th>Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chairRows.map((c) => (
                      <tr key={c.chair_id}>
                        <td>{chairLabel(c.chair_id)}</td>
                        <td>{c.total}</td>
                        <td>{c.used_minutes}</td>
                        <td>
                          <div className="util-bar">
                            <div className="util-fill" style={{ width: `${Math.min(100, c.utilisation)}%` }} />
                            <span>{c.utilisation}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {chairRows.length === 0 && (
                      <tr><td colSpan={4} className="mono">No chair activity this week.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
