import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ListChecks,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
  WifiOff,
} from "lucide-react";
import { API, connectWS, fmtDate, statusLabels, today } from "../App";
import BookingDialog from "./BookingDialog";
import ActivityView from "./ActivityView";
import AdminPanel from "./AdminPanel";
import Waitlist from "./Waitlist";
import WeeklySummary from "./WeeklySummary";
import DaySheet from "./DaySheet";

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
  const [wsOnline, setWsOnline] = useState(true);

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

  // Persistent WS with auto-reconnect
  useEffect(() => {
    setWsOnline(false);
    const conn = connectWS({
      onMessage: (msg) => {
        if (msg.type === "booking_changed" && msg.date === date) load();
        if (msg.type === "settings_changed") load();
      },
      onReconnect: () => {
        setWsOnline(true);
        load(); // reconcile board state on (re)connect
      },
    });
    return () => conn.close();
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

  const promoteFromWaitlist = (entry) => {
    setDialog({
      chair_id: entry.preferred_chair_id || data.chairs[0]?.id || "",
      date: entry.preferred_date || date,
      time: entry.preferred_time_from || data.settings.open_time,
      existing: null,
      prefill: entry,
      waitlist_id: entry.id,
    });
    setView("schedule");
  };

  const NavButton = ({ id, icon: Icon, label, roles }) => {
    if (roles && !roles.includes(user.role)) return null;
    return (
      <button
        className={view === id ? "nav-active" : ""}
        data-testid={`${id}-nav-button`}
        onClick={() => setView(id)}
      >
        <Icon size={18} /> {label}
      </button>
    );
  };

  return (
    <div className="app-shell">
      <aside className="rail no-print">
        <div className="brand">
          <img src="/gdc-logo.jpg" alt="GDC" className="brand-mark-img" />
          <span>
            GDC Chair Board<small>APPOINTMENT DASHBOARD</small>
          </span>
        </div>
        <nav>
          <NavButton id="schedule" icon={CalendarDays} label="Schedule" />
          <NavButton id="activity" icon={RefreshCw} label="Live activity" />
          <NavButton id="waitlist" icon={ListChecks} label="Waitlist" roles={["admin", "reception"]} />
          <NavButton id="day-sheet" icon={Printer} label="Day sheet" roles={["admin", "reception"]} />
          <NavButton id="weekly" icon={BarChart3} label="Weekly summary" roles={["admin"]} />
          <NavButton id="admin" icon={Settings2} label="Admin controls" roles={["admin"]} />
        </nav>
        <div className="rail-bottom">
          {!wsOnline && (
            <div className="ws-offline" data-testid="ws-offline-indicator">
              <WifiOff size={14} /> Reconnecting…
            </div>
          )}
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
                LIVE SCHEDULE <span className={`live-dot ${wsOnline ? "" : "offline"}`} /> {wsOnline ? "SYNCED" : "OFFLINE"}
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
              <span className={`live-dot ${wsOnline ? "" : "offline"}`} /> {wsOnline ? "Live across all screens" : "Reconnecting…"}
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

      {view === "waitlist" && (user.role === "admin" || user.role === "reception") && (
        <Waitlist session={session} chairs={data.chairs} doctors={data.doctors} onPromote={promoteFromWaitlist} />
      )}

      {view === "day-sheet" && (user.role === "admin" || user.role === "reception") && (
        <DaySheet session={session} chairs={data.chairs} doctors={data.doctors} />
      )}

      {view === "weekly" && user.role === "admin" && (
        <WeeklySummary session={session} doctors={data.doctors} chairs={data.chairs} />
      )}

      {view === "admin" && user.role === "admin" && <AdminPanel session={session} onChanged={load} />}

      {dialog && (
        <BookingDialog
          slot={dialog}
          existing={dialog.existing}
          chairs={data.chairs}
          doctors={data.doctors}
          user={user}
          prefill={dialog.prefill}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await load();
            // If this booking originated from a waitlist promotion, mark that entry scheduled.
            if (dialog.waitlist_id && !dialog.existing) {
              try {
                await axios.patch(
                  `${API}/waitlist/${dialog.waitlist_id}`,
                  { status: "scheduled" },
                  auth
                );
              } catch (_err) {
                // non-blocking
              }
            }
          }}
        />
      )}
    </div>
  );
}
