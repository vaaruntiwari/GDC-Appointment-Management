import { useState } from "react";
import axios from "axios";
import Board from "./components/Board";
import Login from "./components/Login";
import "@/App.css";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const WS_URL = `${process.env.REACT_APP_BACKEND_URL.replace(/^http/, "ws")}/api/ws`;

export const statusLabels = {
  booked: "Booked",
  arrived: "Arrived",
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
