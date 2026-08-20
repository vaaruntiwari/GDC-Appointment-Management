import { useState } from "react";
import axios from "axios";
import { ChevronRight } from "lucide-react";
import { API } from "../App";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.post(`${API}/auth/login`, { username, password });
      onLogin(r.data);
    } catch (x) {
      setError(x.response?.data?.detail || "Could not sign in");
    }
  };

  return (
    <main className="login-page">
      <img src="/gdc-logo.jpg" alt="Goregaon Dental Centre" className="login-logo" />
      <p className="eyebrow">GOREGAON DENTAL CENTRE</p>
      <h1>GDC Chair Appointment Dashboard</h1>
      <p className="login-copy">The live diary for every chair, every appointment, every shift.</p>
      <form onSubmit={submit} className="login-form">
        <label>
          Username
          <input data-testid="login-username-input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input
            data-testid="login-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div className="error" data-testid="login-error">
            {error}
          </div>
        )}
        <button className="primary wide" data-testid="login-submit-button">
          Sign in <ChevronRight size={17} />
        </button>
      </form>
      <p className="demo-note">Demo access: admin / admin123 · reception / reception123 · doctor / doctor123</p>
    </main>
  );
}
