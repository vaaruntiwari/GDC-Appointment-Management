import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Plus, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { API, connectWS, statusLabels } from "../App";

const WAITLIST_STATUS_LABELS = { waiting: "Waiting", scheduled: "Scheduled", cancelled: "Cancelled" };

export default function Waitlist({ session, chairs, doctors, onPromote }) {
  const user = session.user;
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${session.token}` } }), [session.token]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    patient_name: "",
    patient_id: "",
    treatment_details: "",
    preferred_doctor_id: "",
    preferred_chair_id: "",
    preferred_date: "",
    preferred_time_from: "",
    preferred_time_to: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/waitlist`, auth);
      setEntries(r.data || []);
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const conn = connectWS({
      onMessage: (msg) => {
        if (msg.type === "waitlist_changed") load();
      },
      onReconnect: () => load(),
    });
    return () => conn.close();
  }, [load]);

  const set = (k, v) => setForm({ ...form, [k]: v });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.patient_name.trim() || !form.patient_id.trim() || !form.treatment_details.trim()) {
      setError("Patient name, patient ID and treatment details are required");
      return;
    }
    try {
      await axios.post(`${API}/waitlist`, form, auth);
      setForm({
        patient_name: "",
        patient_id: "",
        treatment_details: "",
        preferred_doctor_id: "",
        preferred_chair_id: "",
        preferred_date: "",
        preferred_time_from: "",
        preferred_time_to: "",
      });
      setShowAdd(false);
      await load();
    } catch (x) {
      setError(x.response?.data?.detail?.toString?.() || "Unable to add to waitlist");
    }
  };

  const cancelEntry = async (id) => {
    try {
      await axios.patch(`${API}/waitlist/${id}`, { status: "cancelled" }, auth);
      await load();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to cancel");
    }
  };

  const removeEntry = async (id) => {
    try {
      await axios.delete(`${API}/waitlist/${id}`, auth);
      await load();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to delete");
    }
  };

  const doctorName = (id) => doctors.find((d) => d.id === id)?.name || "—";
  const chairLabel = (id) => chairs.find((c) => c.id === id)?.label || "—";

  return (
    <main className="workspace" data-testid="waitlist-view">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            WAITLIST <span className="live-dot" /> LIVE
          </p>
          <h1>Walk-in & waitlist queue</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" data-testid="waitlist-refresh-button" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="primary" data-testid="waitlist-add-toggle-button" onClick={() => setShowAdd((s) => !s)}>
            <Plus size={15} /> Add to waitlist
          </button>
        </div>
      </header>

      {showAdd && (
        <form className="waitlist-add" onSubmit={submit} data-testid="waitlist-add-form">
          <div className="form-row">
            <label>
              Patient name<span className="req">*</span>
              <input data-testid="waitlist-name-input" value={form.patient_name} required onChange={(e) => set("patient_name", e.target.value)} />
            </label>
            <label>
              Patient ID<span className="req">*</span>
              <input data-testid="waitlist-pid-input" value={form.patient_id} required onChange={(e) => set("patient_id", e.target.value)} />
            </label>
          </div>
          <label>
            Treatment Details<span className="req">*</span>
            <textarea data-testid="waitlist-treatment-input" rows={2} required value={form.treatment_details} onChange={(e) => set("treatment_details", e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Preferred doctor
              <select data-testid="waitlist-doctor-select" value={form.preferred_doctor_id} onChange={(e) => set("preferred_doctor_id", e.target.value)}>
                <option value="">Any</option>
                {doctors.map((d) => (
                  <option value={d.id} key={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              Preferred chair
              <select data-testid="waitlist-chair-select" value={form.preferred_chair_id} onChange={(e) => set("preferred_chair_id", e.target.value)}>
                <option value="">Any</option>
                {chairs.map((c) => (
                  <option value={c.id} key={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Preferred date
              <input data-testid="waitlist-date-input" type="date" value={form.preferred_date} onChange={(e) => set("preferred_date", e.target.value)} />
            </label>
            <label>
              From
              <input data-testid="waitlist-time-from-input" type="time" value={form.preferred_time_from} onChange={(e) => set("preferred_time_from", e.target.value)} />
            </label>
            <label>
              To
              <input data-testid="waitlist-time-to-input" type="time" value={form.preferred_time_to} onChange={(e) => set("preferred_time_to", e.target.value)} />
            </label>
          </div>
          {error && <div className="error" data-testid="waitlist-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setShowAdd(false)}>Close</button>
            <button className="primary" data-testid="waitlist-submit-button"><Plus size={15} /> Add entry</button>
          </div>
        </form>
      )}

      <section className="waitlist-body">
        {loading && <p className="loading-inline">Loading waitlist…</p>}
        {!loading && entries.length === 0 && (
          <p className="empty-state" data-testid="waitlist-empty">No walk-ins waiting.</p>
        )}
        {!loading && entries.length > 0 && (
          <table className="admin-table" data-testid="waitlist-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Treatment</th>
                <th>Preferences</th>
                <th>Status</th>
                <th>Added</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((w) => (
                <tr key={w.id} data-testid={`waitlist-row-${w.id}`} className={`activity-row ${w.status}`}>
                  <td>
                    <strong>{w.patient_name}</strong>
                    <small> · {w.patient_id}</small>
                  </td>
                  <td>{w.treatment_details}</td>
                  <td className="mono">
                    {w.preferred_doctor_id ? `Dr: ${doctorName(w.preferred_doctor_id)}` : "Any doctor"}
                    <br />
                    {w.preferred_chair_id ? chairLabel(w.preferred_chair_id) : "Any chair"}
                    <br />
                    {w.preferred_date || "Any date"} {w.preferred_time_from && `${w.preferred_time_from}–${w.preferred_time_to || ""}`}
                  </td>
                  <td>
                    <span className={`status-pill ${w.status === "waiting" ? "booked" : w.status === "scheduled" ? "completed" : "cancelled"}`}>
                      {WAITLIST_STATUS_LABELS[w.status] || w.status}
                    </span>
                  </td>
                  <td className="mono">{new Date(w.created_at).toLocaleString()}</td>
                  <td className="right">
                    {w.status === "waiting" && (
                      <>
                        <button
                          className="primary"
                          data-testid={`waitlist-promote-${w.id}`}
                          onClick={() => onPromote(w)}
                          title="Book an appointment for this entry"
                        >
                          <CheckCircle2 size={14} /> Promote
                        </button>
                        <button className="secondary" data-testid={`waitlist-cancel-${w.id}`} onClick={() => cancelEntry(w.id)}>
                          Cancel
                        </button>
                      </>
                    )}
                    <button className="secondary danger" data-testid={`waitlist-delete-${w.id}`} onClick={() => removeEntry(w.id)}>
                      <Trash2 size={13} />
                    </button>
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
