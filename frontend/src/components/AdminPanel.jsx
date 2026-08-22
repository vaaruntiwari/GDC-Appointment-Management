import {useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { API } from "../App";

const ROLES = ["admin", "reception", "doctor"];

export default function AdminPanel({ session, onChanged }) {
  const [tab, setTab] = useState("chairs");
  const auth = { headers: { Authorization: `Bearer ${session.token}` } };

  return (
    <main className="workspace" data-testid="admin-view">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            ADMIN CONTROLS <span className="live-dot" /> RESTRICTED
          </p>
          <h1>Clinic configuration</h1>
        </div>
        <div className="top-actions">
          <span className="role-tag">
            <ShieldCheck size={15} /> admin
          </span>
        </div>
      </header>

      <section className="admin-tabs">
        <button
          className={tab === "chairs" ? "tab-active" : ""}
          data-testid="admin-tab-chairs"
          onClick={() => setTab("chairs")}
        >
          Chairs
        </button>
        <button
          className={tab === "users" ? "tab-active" : ""}
          data-testid="admin-tab-users"
          onClick={() => setTab("users")}
        >
          Staff accounts
        </button>
        <button
          className={tab === "settings" ? "tab-active" : ""}
          data-testid="admin-tab-settings"
          onClick={() => setTab("settings")}
        >
          Clinic settings
        </button>
      </section>

      <section className="admin-body">
        {tab === "chairs" && <ChairsAdmin auth={auth} onChanged={onChanged} />}
        {tab === "users" && <UsersAdmin auth={auth} />}
        {tab === "settings" && <SettingsAdmin auth={auth} onChanged={onChanged} />}
      </section>
    </main>
  );
}

function ChairsAdmin({ auth, onChanged }) {
  const [chairs, setChairs] = useState([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const r = await axios.get(`${API}/admin/chairs`, auth);
    setChairs(r.data || []);
  };

  useEffect(() => {
  load();
}, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await axios.post(`${API}/admin/chairs`, { label }, auth);
      setLabel("");
      await load();
      onChanged?.();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to add chair");
    }
  };

  const update = async (chair_id, patch) => {
    setError("");
    try {
      await axios.patch(`${API}/admin/chairs/${chair_id}`, patch, auth);
      await load();
      onChanged?.();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to update chair");
    }
  };

  return (
    <div className="admin-section" data-testid="admin-chairs-section">
      <form className="admin-add" onSubmit={add}>
        <label>
          New chair label
          <input
            data-testid="admin-chair-label-input"
            value={label}
            required
            placeholder="Chair 10"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button className="primary" data-testid="admin-chair-add-button">
          <Plus size={15} /> Add chair
        </button>
      </form>
      {error && (
        <div className="error" data-testid="admin-chair-error">
          {error}
        </div>
      )}
      <table className="admin-table" data-testid="admin-chairs-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Status</th>
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {chairs.map((c) => (
            <ChairRow key={c.id} chair={c} onSave={update} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChairRow({ chair, onSave }) {
  const [label, setLabel] = useState(chair.label);
  useEffect(() => setLabel(chair.label), [chair.label]);
  return (
    <tr data-testid={`admin-chair-row-${chair.id}`}>
      <td>
        <input
          data-testid={`admin-chair-label-${chair.id}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </td>
      <td>
        <span className={`status-pill ${chair.active ? "arrived" : "cancelled"}`}>
          {chair.active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="right">
        <button
          className="secondary"
          data-testid={`admin-chair-save-${chair.id}`}
          onClick={() => onSave(chair.id, { label })}
        >
          Save
        </button>
        <button
          className="secondary"
          data-testid={`admin-chair-toggle-${chair.id}`}
          onClick={() => onSave(chair.id, { active: !chair.active })}
        >
          {chair.active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}

function UsersAdmin({ auth }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: "", name: "", role: "reception", password: "" });
  const [error, setError] = useState("");

  const load = async () => {
    const r = await axios.get(`${API}/admin/users`, auth);
    setUsers(r.data || []);
  };

  useEffect(() => {
  load();
}, [load]);

  const set = (k, v) => setForm({ ...form, [k]: v });

  const add = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await axios.post(`${API}/admin/users`, form, auth);
      setForm({ username: "", name: "", role: "reception", password: "" });
      await load();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to add user");
    }
  };

  const update = async (user_id, patch) => {
    setError("");
    try {
      await axios.patch(`${API}/admin/users/${user_id}`, patch, auth);
      await load();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to update user");
    }
  };

  return (
    <div className="admin-section" data-testid="admin-users-section">
      <form className="admin-add wide-form" onSubmit={add}>
        <label>
          Username
          <input
            data-testid="admin-user-username-input"
            value={form.username}
            required
            onChange={(e) => set("username", e.target.value)}
          />
        </label>
        <label>
          Full name
          <input
            data-testid="admin-user-name-input"
            value={form.name}
            required
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label>
          Role
          <select data-testid="admin-user-role-select" value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <option value={r} key={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Password
          <input
            data-testid="admin-user-password-input"
            type="password"
            required
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </label>
        <button className="primary" data-testid="admin-user-add-button">
          <Plus size={15} /> Add user
        </button>
      </form>
      {error && (
        <div className="error" data-testid="admin-user-error">
          {error}
        </div>
      )}
      <table className="admin-table" data-testid="admin-users-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <UserRow key={u.id} user={u} onSave={update} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user, onSave }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  useEffect(() => {
    setName(user.name);
    setRole(user.role);
  }, [user.name, user.role]);
  return (
    <tr data-testid={`admin-user-row-${user.id}`}>
      <td className="mono">{user.username}</td>
      <td>
        <input
          data-testid={`admin-user-name-${user.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td>
        <select data-testid={`admin-user-role-${user.id}`} value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option value={r} key={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td>
        <span className={`status-pill ${user.active ? "arrived" : "cancelled"}`}>
          {user.active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="right">
        <button
          className="secondary"
          data-testid={`admin-user-save-${user.id}`}
          onClick={() => onSave(user.id, { name, role })}
        >
          Save
        </button>
        <button
          className="secondary"
          data-testid={`admin-user-toggle-${user.id}`}
          onClick={() => onSave(user.id, { active: !user.active })}
        >
          {user.active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}

function SettingsAdmin({ auth, onChanged }) {
  const [form, setForm] = useState({ open_time: "09:00", close_time: "21:00", slot_interval: 30 });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const r = await axios.get(`${API}/admin/settings`, auth);
    if (r.data) setForm(r.data);
  };

  useEffect(() => {
  load();
}, [load]);

  const set = (k, v) => setForm({ ...form, [k]: v });

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await axios.patch(`${API}/admin/settings`, { ...form, slot_interval: Number(form.slot_interval) }, auth);
      setSaved(true);
      onChanged?.();
    } catch (x) {
      setError(x.response?.data?.detail || "Unable to save settings");
    }
  };

  return (
    <form className="admin-section admin-settings" data-testid="admin-settings-section" onSubmit={save}>
      <div className="form-row">
        <label>
          Opening time
          <input
            data-testid="admin-open-time-input"
            type="time"
            value={form.open_time}
            onChange={(e) => set("open_time", e.target.value)}
          />
        </label>
        <label>
          Closing time
          <input
            data-testid="admin-close-time-input"
            type="time"
            value={form.close_time}
            onChange={(e) => set("close_time", e.target.value)}
          />
        </label>
      </div>
      <label>
        Slot interval (minutes)
        <select
          data-testid="admin-slot-interval-select"
          value={form.slot_interval}
          onChange={(e) => set("slot_interval", Number(e.target.value))}
        >
          <option value={15}>15</option>
          <option value={30}>30</option>
          <option value={60}>60</option>
        </select>
      </label>
      {error && (
        <div className="error" data-testid="admin-settings-error">
          {error}
        </div>
      )}
      {saved && (
        <div className="success" data-testid="admin-settings-saved">
          Settings saved.
        </div>
      )}
      <div className="modal-actions">
        <button className="primary" data-testid="admin-settings-save-button">
          <RefreshCw size={15} /> Save settings
        </button>
      </div>
    </form>
  );
}
