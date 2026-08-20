# Chair Board — Product Requirements & Implementation Log

## Problem
Replace a shared 9-chair paper diary at an internal dental clinic with a real-time,
conflict-free digital scheduling board (no EMR, no billing, no notifications, no
patient-facing app).

## Architecture
- Frontend: React (CRA) + Axios + native WebSocket. Refactored into components:
  `Login`, `Board`, `BookingDialog`, `ActivityView`, `AdminPanel`.
- Backend: FastAPI + Motor async MongoDB + PyJWT + bcrypt.
- Realtime: FastAPI native WebSocket broadcasting booking mutations.
- Double-booking guard: unique compound index
  `{ chair_id, date, slot_start }` with `partialFilterExpression: { active_slot: true }`.
  On conflict the write fails atomically and the client receives 409.

## Users & Roles
- **admin** — full access, manages chairs/users/settings.
- **reception** — creates/edits/cancels any booking, updates status.
- **doctor** — views full schedule; edits only their own appointments.
Seed accounts: admin/admin123, reception/reception123, doctor/doctor123.

## Implemented (Feb 2026)
- 9-chair grid, 09:00–21:00, configurable slot interval (15/30/60).
- Quick-add and edit booking dialogs; multi-slot durations.
- Status flow (booked/arrived/completed/cancelled/no-show), soft cancellation.
- WebSocket live-sync across clients on any booking change.
- Cookie + Bearer session auth, 12h expiry, session-expiry redirect.
- Admin UI: Chairs CRUD (add/rename/activate/deactivate), Users CRUD
  (add/edit name/role/active/password), Clinic settings (open/close/interval).
- Read-only **Activity** view backed by `/api/bookings/history` with WS refresh.
- Backend regression tests use dynamic future dates + best-effort cleanup.

## API Surface
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/bootstrap`
- `GET /api/bookings?date=`, `GET /api/bookings/history?date=`
- `POST /api/bookings`, `PATCH /api/bookings/{id}`, `DELETE /api/bookings/{id}`
- `GET/POST /api/admin/chairs`, `PATCH /api/admin/chairs/{id}`
- `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}`
- `GET/PATCH /api/admin/settings`
- `WS /ws`

## Backlog
- P1: Weekly / doctor summary reports.
- P2: SMS/WhatsApp reminders, EMR sync, multi-clinic, patient self-booking.
