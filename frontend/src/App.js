import { useState } from "react";
import axios from "axios";
import Board from "./components/Board";
import Login from "./components/Login";
import "@/App.css";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const WS_URL = `${process.env.REACT_APP_BACKEND_URL.replace(/^http/, "ws")}/api/ws`;

// Consistent status vocabulary across the app.
// Backend keys are unchanged ("booked" etc); only the user-visible labels change.
export const statusLabels = {
  booked: "Confirmed",
  arrived: "Patient Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
  "no-show": "No-show",
};

export const today = () => new Date().toISOString().slice(0, 10);

export const fmtDate = (d) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${d}T12:00:00`)
  );

axios.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && localStorage.getItem("chairSession")) {
      localStorage.removeItem("chairSession");
      window.location.reload();
    }
    return Promise.reject(e);
  }
);
axios.defaults.withCredentials = true;

/**
 * Robust WebSocket helper with exponential backoff reconnect.
 * Returns an object with `close()` to permanently stop.
 * `onMessage` receives parsed JSON messages. `onReconnect` fires each time a
 * new connection is (re)established so the caller can refetch state.
 */
export function connectWS({ onMessage, onReconnect } = {}) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  let timer = null;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      attempt = 0;
      if (onReconnect) onReconnect();
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (onMessage) onMessage(msg);
      } catch (_err) {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (closed) return;
      attempt += 1;
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch (_err) {
        // no-op
      }
    };
  };
  open();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ws && ws.readyState <= 1) ws.close();
    },
  };
}

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("chairSession") || "null"));

  if (!session) {
    return (
      <Login
        onLogin={(x) => {
          localStorage.setItem("chairSession", JSON.stringify(x));
          setSession(x);
        }}
      />
    );
  }

  return (
    <Board
      session={session}
      logout={() => {
        localStorage.removeItem("chairSession");
        setSession(null);
      }}
    />
  );
}

export default App;
