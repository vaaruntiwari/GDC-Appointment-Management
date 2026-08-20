import { useState } from "react";
import axios from "axios";
import { Plus, RefreshCw } from "lucide-react";
import { API, statusLabels } from "../App";

/**
 * Booking dialog: mandatory fields validated in the UI; backend also enforces.
 */
export default function BookingDialog({ slot, existing, chairs, doctors, user, onClose, onSaved, prefill }) {
  const readOnly = existing && user.role === "doctor" && existing.doctor_id !== user.id;

  const [form, setForm] = useState({
    chair_id: slot.chair_id,
    date: slot.date,
    start_time: slot.time,
    duration_minutes: existing?.duration_minutes || 30,
    doctor_id: existing?.doctor_id || prefill?.preferred_doctor_id || (user.role === "doctor" ? user.id : doctors[0]?.id || ""),
    patient_name: existing?.patient_name || prefill?.patient_name || "",
    patient_id: existing?.patient_id || prefill?.patient_id || "",
    treatment_details: existing?.treatment_details || prefill?.treatment_details || "",
    status: existing?.status || "booked",
  });
  const [error, setError] = useState("");

  const set = (k, v) => setForm({ ...form, [k]: v });
  const auth = { headers: { Authorization: `Bearer ${user.token || ""}` } };

  const missing = () => {
    const required = ["chair_id", "date", "start_time", "doctor_id", "patient_name", "patient_id", "treatment_details"];
    return required.filter((k) => !String(form[k] || "").trim());
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (!existing) {
      const gaps = missing();
      if (gaps.length) {
        setError(`Please fill: ${gaps.map((g) => g.replace(/_/g, " ")).join(", ")}`);
        return;
      }
    } else {
      // for existing: patient_name, patient_id, treatment_details must not be empty
      for (const k of ["patient_name", "patient_id", "treatment_details"]) {
        if (!String(form[k] || "").trim()) {
          setError(`${k.replace(/_/g, " ")} cannot be empty`);
          return;
        }
      }
    }
    try {
      if (existing) {
        const editable = {
          status: form.status,
          patient_name: form.patient_name,
          patient_id: form.patient_id,
          treatment_details: form.treatment_details,
        };
        await axios.patch(`${API}/bookings/${existing.booking_id}`, editable, auth);
      } else {
        await axios.post(`${API}/bookings`, form, auth);
      }
      onSaved && onSaved();
      onClose();
    } catch (x) {
      setError(x.response?.data?.detail?.toString?.() || x.response?.data?.detail || "Unable to save booking");
    }
  };

  const cancel = async () => {
    if (!existing) return;
    try {
      await axios.delete(`${API}/bookings/${existing.booking_id}`, auth);
      onSaved && onSaved();
      onClose();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to cancel booking");
    }
  };

  const chairLabel = chairs.find((c) => c.id === slot.chair_id)?.label;

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={save}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">{existing ? "APPOINTMENT DETAILS" : "NEW APPOINTMENT"}</p>
            <h2>
              {slot.time} · {chairLabel}
            </h2>
          </div>
          <button type="button" className="icon-button" data-testid="booking-close-button" onClick={onClose}>
            ×
          </button>
        </div>
        {readOnly && (
          <div className="info-note" data-testid="booking-readonly-note">
            Read-only — this appointment belongs to another doctor.
          </div>
        )}
        {error && (
          <div className="error" data-testid="booking-conflict-alert">
            {error}
          </div>
        )}
        <label>
          Chair<span className="req">*</span>
          <select
            data-testid="booking-chair-select"
            value={form.chair_id}
            disabled={!!existing}
            onChange={(e) => set("chair_id", e.target.value)}
          >
            {chairs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Doctor<span className="req">*</span>
          <select
            data-testid="booking-doctor-select"
            value={form.doctor_id}
            disabled={user.role === "doctor" || !!existing}
            onChange={(e) => set("doctor_id", e.target.value)}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Patient name<span className="req">*</span>
            <input
              data-testid="booking-patient-name-input"
              required
              disabled={readOnly}
              value={form.patient_name}
              onChange={(e) => set("patient_name", e.target.value)}
            />
          </label>
          <label>
            Patient ID<span className="req">*</span>
            <input
              data-testid="booking-patient-id-input"
              required
              disabled={readOnly}
              value={form.patient_id}
              onChange={(e) => set("patient_id", e.target.value)}
            />
          </label>
        </div>
        <label>
          Treatment Details<span className="req">*</span>
          <textarea
            data-testid="booking-treatment-details-input"
            required
            rows={3}
            disabled={readOnly}
            value={form.treatment_details}
            onChange={(e) => set("treatment_details", e.target.value)}
            placeholder="e.g. Root canal — Upper right first molar, session 2 of 3"
          />
        </label>
        {existing ? (
          <label>
            Status
            <select
              data-testid="booking-status-select"
              value={form.status}
              disabled={readOnly}
              onChange={(e) => set("status", e.target.value)}
            >
              {Object.entries(statusLabels).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Duration<span className="req">*</span>
            <select
              data-testid="booking-duration-select"
              value={form.duration_minutes}
              onChange={(e) => set("duration_minutes", Number(e.target.value))}
            >
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
              <option value="120">2 hours</option>
            </select>
          </label>
        )}
        <div className="modal-actions">
          {existing && !readOnly && (
            <button type="button" className="secondary danger" data-testid="booking-cancel-appt-button" onClick={cancel}>
              Cancel appointment
            </button>
          )}
          <button type="button" className="secondary" data-testid="booking-cancel-button" onClick={onClose}>
            Close
          </button>
          {!readOnly && (
            <button
              className="primary"
              data-testid={existing ? "booking-update-submit-button" : "booking-create-submit-button"}
            >
              {existing ? (
                <>
                  <RefreshCw size={16} /> Save changes
                </>
              ) : (
                <>
                  <Plus size={16} /> Add booking
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
