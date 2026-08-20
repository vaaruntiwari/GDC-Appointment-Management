# GDC Chair Appointment Dashboard — Product Requirements & Log

## Problem
Real-time, conflict-free chair-scheduling board for Goregaon Dental Centre
(9 chairs, ~30 doctors/staff, single clinic). Replaces a shared paper diary.
Explicit non-goals: EMR, billing, notifications, patient self-booking, native mobile.

## Architecture
- Frontend: React (CRA) + Axios + native WebSocket with exponential-backoff reconnect.
  Components: Login, Board, BookingDialog, ActivityView, AdminPanel, Waitlist,
  WeeklySummary, DaySheet.
- Backend: FastAPI + Motor async MongoDB + PyJWT + bcrypt.
- Real-time: `@app.websocket("/api/ws")` broadcasting booking/settings/waitlist events.
- Double-book guard: `bookings` unique compound index
  `{ chair_id, date, slot_start }` with `partialFilterExpression: { active_slot: true }`.
- Background: `auto_complete_loop` every 60s flips past `booked`/`arrived` to `completed`.

## Users & Permissions
- **admin** — full access to bookings, chairs, users, settings, waitlist, day sheet, weekly summary.
- **reception** — bookings CRUD, status, waitlist, day sheet.
- **doctor** — read schedule; edit/create/cancel own appointments only (403 on other doctors' via API and UI readonly-mode).
Seed accounts: admin/admin123, reception/reception123, doctor/doctor123.

## Feature set (Iteration 7 — Feb 2026)
- Mandatory fields: chair, date, start_time, doctor, patient_name, patient_id, treatment_details, duration (backend Pydantic validators + frontend HTML5+JS).
- Treatment Details: multiline textarea, persisted, editable, displayed in Schedule dialog, Activity view, Day Sheet.
- Auto-completion: sweep every 60s; past-date or today-with-end_time-past bookings flip to `completed` (skips `cancelled`).
- Status colours: Confirmed=blue, Patient Arrived=orange, Completed=green, Cancelled=red, No-show=gray. Applied on grid slots, status pills, KPI cards, and print sheet.
- Branding: title 'GDC Chair Appointment Dashboard', GDC circular logo on login page and sidebar.
- WS auto-reconnect: `connectWS()` helper with exponential backoff (1–30s), single socket per view, board reconciles on reconnect. Live "Reconnecting…" indicator.
- Weekly Summary (admin): ISO Monday–Sunday, KPIs (total/confirmed/arrived/completed/cancelled/no-show), daily trend, busiest doctors, chair utilisation with % bar.
- Waitlist (admin/reception): add walk-in with treatment + preferences; Promote opens the standard booking dialog pre-filled (still uses conflict guard); Cancel/Delete.
- Day Sheet (admin/reception): date-picked printable sheet with clinic branding, `@media print` hides sidebar/topbar. Includes time, chair, doctor, patient, treatment, status.

## API Surface
- Auth: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- Board: GET /api/bootstrap, GET /api/bookings?date=, GET /api/bookings/history?date=
- Bookings: POST /api/bookings, PATCH /api/bookings/{id}, DELETE /api/bookings/{id}
- Waitlist: GET/POST /api/waitlist, PATCH /api/waitlist/{id}, DELETE /api/waitlist/{id}
- Admin: GET/POST /api/admin/chairs, PATCH /api/admin/chairs/{id}
         GET/POST /api/admin/users, PATCH /api/admin/users/{id}
         GET/PATCH /api/admin/settings
         GET /api/admin/weekly-summary?date=
- Realtime: WS /api/ws (broadcasts booking_changed / settings_changed / waitlist_changed)

## Test Status (Iteration 7)
- Backend pytest: 12/12 PASS (dynamic-date fixtures + cleanup)
- Playwright E2E: 18/18 UI checks PASS
- Report: /app/test_reports/iteration_7.json

## Backlog
- P2 shared WS context provider (currently one socket per view).
- P2 CLINIC_TZ env variable so auto-complete uses local wall-clock time.
- P2 dedicated `.waiting/.scheduled` colour classes for waitlist pills.
- P3 EMR sync, SMS/WhatsApp reminders, multi-clinic, patient self-booking (explicit non-goals).
