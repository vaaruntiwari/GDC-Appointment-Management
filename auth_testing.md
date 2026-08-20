# Chair Board Authentication Testing

Development accounts: admin/admin123, reception/reception123, doctor/doctor123.
Login with `POST /api/auth/login` using `{ "username": "admin", "password": "admin123" }`.
Use the returned bearer token with `GET /api/auth/me`, `GET /api/bootstrap`, and `GET /api/bookings?date=YYYY-MM-DD`.

The admin may create users, chairs, and settings. Reception may create and edit bookings. Doctors may only create or edit their own bookings.