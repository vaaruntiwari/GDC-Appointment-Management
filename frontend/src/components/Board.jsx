import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { API, WS_URL, statusLabels, today, fmtDate } from "../App";
import BookingDialog from "./BookingDialog";
import ActivityView from "./ActivityView";
import AdminPanel from "./AdminPanel";

export default function Board({ session, logout }) {
  const user = session.user;
  const [date, setDate] = useState(today());
  const [data, setData] = useState({
    chairs: [],
    doctors: [],
    settings: { open_time: "09:00", close_time: "21:00", slot_interval: 30 },
  });
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState("all");
  const [chairFilter, setChairFilter] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("schedule");

  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${session.token}` } }), [session.token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        axios.get(`${API}/bootstrap`, auth),
        axios.get(`${API}/bookings?date=${date}`, auth),
      ]);
      setData(a.data);
      setBookings(b.data);
    } finally {
      setLoading(false);
    }
  }, [auth, date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.date === date) load();
      } catch (err) {
        // ignore malformed messages
      }
    };
    return () => ws.close();
  }, [date, load]);

  const times = useMemo(() => {
    const out = [];
    const [h, m] = data.settings.open_time.split(":").map(Number);
    const [eh, em] = data.settings.close_time.split(":").map(Number);
    for (let cur = h * 60 + m; cur < eh * 60 + em; cur += data.settings.slot_interval) {
      out.push(`${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`);
    }
    return out;
  }, [data]);

  const chairs = data.chairs.filter((c) => chairFilter === "all" || c.id === chairFilter);
  const getBooking = (chair, time) =>
    bookings.find(
      (b) => b.chair_id === chair && b.slot_start === time && (filter === "all" || b.doctor_id === filter)
    );
  const doctorName = (id) => data.doctors.find((d) => d.id === id)?.name || "Doctor";

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark">CB</span>
          <span>
            Chair Board<small>OPERATIONS</small>
          </span>
        </div>
        <nav>
          <button
            className={view === "schedule" ? "nav-active" : ""}
            data-testid="schedule-nav-button"
            onClick={() => setView("schedule")}
          >
            <CalendarDays size={18} /> Schedule
          </button>
          <button
            className={view === "activity" ? "nav-active" : ""}
            data-testid="activity-nav-button"
            onClick={() => setView("activity")}
          >
            <RefreshCw size={18} /> Live activity
          </button>
          {user.role === "admin" && (
            <button
              className={view === "admin" ? "nav-active" : ""}
              data-testid="admin-nav-button"
              onClick={() => setView("admin")}
            >
              <Settings2 size={18} /> Admin controls
            </button>
          )}
        </nav>
        <div className="rail-bottom">
          <div className="signed-in">
            <span className="avatar">
              <UserRound size={17} />
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
          </div>
          <button className="logout" data-testid="logout-button" onClick={logout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {view === "schedule" && (
        <main className="workspace" data-testid="schedule-view">
          <header className="topbar">
            <div>
              <p className="eyebrow">
                LIVE SCHEDULE <span className="live-dot" /> SYNCED
              </p>
              <h1>Today’s chair board</h1>
            </div>
            <div className="top-actions">
              <span className="role-tag">
                <ShieldCheck size={15} /> {user.role}
              </span>
              <button className="secondary" data-testid="refresh-schedule-button" onClick={load}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
          </header>
          <section className="toolbar">
            <div className="date-control">
              <button
                className="icon-button"
                data-testid="schedule-date-prev-button"
                onClick={() =>
                  setDate((d) => {
                    const x = new Date(d);
                    x.setDate(x.getDate() - 1);
                    return x.toISOString().slice(0, 10);
                  })
                }
              >
                <ChevronLeft size={18} />
              </button>
              <label className="date-label">
                <span>{fmtDate(date)}</span>
                <input
                  data-testid="schedule-date-input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <button
                className="icon-button"
                data-testid="schedule-date-next-button"
                onClick={() =>
                  setDate((d) => {
                    const x = new Date(d);
                    x.setDate(x.getDate() + 1);
                    return x.toISOString().slice(0, 10);
                  })
                }
              >
                <ChevronRight size={18} />
              </button>
              <button className="today-button" data-testid="schedule-today-button" onClick={() => setDate(today())}>
                Today
              </button>
            </div>
            <div className="filters">
              <label>
                Doctor
                <select data-testid="doctor-filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">All doctors</option>
                  {data.doctors.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                View chair
                <select
                  data-testid="chair-filter-select"
                  value={chairFilter}
                  onChange={(e) => setChairFilter(e.target.value)}
                >
                  <option value="all">All chairs</option>
                  {data.chairs.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="legend" aria-label="Status legend">
            <span className="eyebrow">STATUS</span>
            {Object.entries(statusLabels).map(([k, v]) => (
              <span data-testid={`legend-${k}`} className={`legend-item ${k}`} key={k}>
                <i />
                {v}
              </span>
            ))}
            <span className="sync-note">
              <span className="live-dot" /> Live across all screens
            </span>
          </section>
          <section className="board-wrap">
            <div className="board" style={{ "--chair-count": chairs.length }}>
              <div className="corner">TIME / CHAIR</div>
              {chairs.map((c) => (
                <div className="chair-head" data-testid={`${c.id}-header`} key={c.id}>
                  <span>{c.label.replace("Chair ", "C")}</span>
                  <small>{c.label}</small>
                </div>
              ))}
              {times.map((time) => (
                <div className="board-row" key={time}>
                  <div className="time-label" data-testid={`time-${time}`}>
                    {time}
                  </div>
                  {chairs.map((chair) => {
                    const b = getBooking(chair.id, time);
                    return (
                      <button
                        className={`slot ${b ? `occupied ${b.status}` : "empty"}`}
                        data-testid={b ? `booking-${b.booking_id}-${time}` : `empty-slot-${chair.id}-${time}`}
                        aria-label={
                          b ? `${chair.label} ${time} ${b.patient_name}` : `Add booking ${chair.label} ${time}`
                        }
                        onClick={() => setDialog({ chair_id: chair.id, date, time, existing: b || null })}
                        key={chair.id}
                      >
                        {b ? (
                          <>
                            <strong>{b.patient_name}</strong>
                            <span>{doctorName(b.doctor_id)}</span>
                            <em>{statusLabels[b.status]}</em>
                          </>
                        ) : (
                          <Plus size={15} />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {loading && <div className="loading">Updating board…</div>}
          </section>
          <footer className="board-footer">
            <span>
              <strong>{bookings.length}</strong> occupied slots · {data.chairs.length} chairs
            </span>
            <span>
              Clinic hours {data.settings.open_time}—{data.settings.close_time} · {data.settings.slot_interval}-minute
              slots
            </span>
          </footer>
        </main>
      )}

      {view === "activity" && (
        <ActivityView user={user} session={session} chairs={data.chairs} doctors={data.doctors} initialDate={date} />
      )}

      {view === "admin" && user.role === "admin" && <AdminPanel session={session} onChanged={load} />}

      {dialog && (
        <BookingDialog
          slot={dialog}
          existing={dialog.existing}
          chairs={data.chairs}
          doctors={data.doctors}
          user={user}
          onClose={() => setDialog(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
