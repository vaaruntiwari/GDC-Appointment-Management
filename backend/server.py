from fastapi import FastAPI, APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator
from datetime import datetime, timezone, timedelta, date as ddate
from typing import Optional
from pathlib import Path
from collections import defaultdict
import os, uuid, bcrypt, jwt, asyncio

load_dotenv(Path(__file__).parent / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="GDC Chair Appointment Dashboard API")
api = APIRouter(prefix="/api")
JWT_SECRET = os.environ.get("JWT_SECRET", "gdc-chair-board-development-secret")
STATUS = {"booked", "arrived", "completed", "cancelled", "no-show"}
WAITLIST_STATUS = {"waiting", "scheduled", "cancelled"}
ROLES = ("admin", "reception", "doctor")
connections: set[WebSocket] = set()


# ---------- Models ----------
class Login(BaseModel):
    username: str
    password: str


class BookingIn(BaseModel):
    chair_id: str
    date: str
    start_time: str
    duration_minutes: int = 30
    doctor_id: str
    patient_name: str
    patient_id: str
    treatment_details: str

    @field_validator("chair_id", "date", "start_time", "doctor_id", "patient_name", "patient_id", "treatment_details")
    @classmethod
    def _not_blank(cls, v: str, info):
        if v is None or not str(v).strip():
            raise ValueError(f"{info.field_name.replace('_', ' ').title()} is required")
        return str(v).strip()


class BookingUpdate(BaseModel):
    status: Optional[str] = None
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None
    treatment_details: Optional[str] = None


class UserIn(BaseModel):
    username: str
    name: str
    role: str
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class ChairIn(BaseModel):
    label: str


class ChairUpdate(BaseModel):
    label: Optional[str] = None
    active: Optional[bool] = None


class SettingsIn(BaseModel):
    open_time: str
    close_time: str
    slot_interval: int


class WaitlistIn(BaseModel):
    patient_name: str
    patient_id: str
    treatment_details: str
    preferred_doctor_id: Optional[str] = ""
    preferred_chair_id: Optional[str] = ""
    preferred_date: Optional[str] = ""
    preferred_time_from: Optional[str] = ""
    preferred_time_to: Optional[str] = ""

    @field_validator("patient_name", "patient_id", "treatment_details")
    @classmethod
    def _not_blank(cls, v: str, info):
        if v is None or not str(v).strip():
            raise ValueError(f"{info.field_name.replace('_', ' ').title()} is required")
        return str(v).strip()


class WaitlistUpdate(BaseModel):
    status: Optional[str] = None
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None
    treatment_details: Optional[str] = None
    preferred_doctor_id: Optional[str] = None
    preferred_chair_id: Optional[str] = None
    preferred_date: Optional[str] = None
    preferred_time_from: Optional[str] = None
    preferred_time_to: Optional[str] = None


# ---------- Helpers ----------
def clean(doc):
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def token_for(user):
    return jwt.encode(
        {"sub": user["id"], "exp": datetime.now(timezone.utc) + timedelta(hours=12)},
        JWT_SECRET,
        algorithm="HS256",
    )


async def current_user(request: Request, authorization: str = Header(default="")):
    token = request.cookies.get("access_token") or (authorization[7:] if authorization.startswith("Bearer ") else "")
    if not token:
        raise HTTPException(401, "Please sign in")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired")
    user = await db.users.find_one({"id": payload["sub"], "active": True}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require(*roles):
    async def guard(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission for this action")
        return user
    return guard


async def broadcast(message):
    dead = []
    for ws in connections:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connections.discard(ws)


def slots_for(start, duration, interval):
    h, m = map(int, start.split(":"))
    count = duration // interval
    return [f"{h + (m + i * interval) // 60:02d}:{(m + i * interval) % 60:02d}" for i in range(count)]


def end_time_of(start: str, duration: int) -> str:
    """Return HH:MM end time for a booking."""
    h, m = map(int, start.split(":"))
    total = h * 60 + m + duration
    return f"{total // 60:02d}:{total % 60:02d}"


# ---------- Auth ----------
@api.post("/auth/login")
async def login(data: Login, response: Response):
    user = await db.users.find_one({"username": data.username.lower(), "active": True})
    if not user or not bcrypt.checkpw(data.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Invalid username or password")
    safe = clean(user)
    token = token_for(safe)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    return {"token": token, "user": safe}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


# ---------- Bootstrap & Bookings ----------
@api.get("/bootstrap")
async def bootstrap(user=Depends(current_user)):
    chairs = [clean(x) for x in await db.chairs.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(50)]
    doctors = [clean(x) for x in await db.users.find({"role": "doctor", "active": True}, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(100)]
    settings = clean(await db.settings.find_one({"id": "clinic"}, {"_id": 0}))
    return {"chairs": chairs, "doctors": doctors, "settings": settings, "user": user}


@api.get("/bookings")
async def bookings(date: str, user=Depends(current_user)):
    return await db.bookings.find({"date": date, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(1000)


@api.get("/bookings/history")
async def booking_history(date: str, user=Depends(current_user)):
    return await db.bookings.find({"date": date}, {"_id": 0}).sort("updated_at", -1).to_list(2000)


@api.post("/bookings")
async def create_booking(data: BookingIn, user=Depends(current_user)):
    if user["role"] == "doctor" and data.doctor_id != user["id"]:
        raise HTTPException(403, "Doctors can only book their own appointments")
    settings = await db.settings.find_one({"id": "clinic"}, {"_id": 0})
    interval = settings["slot_interval"]
    if data.duration_minutes not in (interval, interval * 2, interval * 3, interval * 4):
        raise HTTPException(400, "Choose a valid duration")
    slots = slots_for(data.start_time, data.duration_minutes, interval)
    booking_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    end_time = end_time_of(data.start_time, data.duration_minutes)
    docs = [
        {
            "id": str(uuid.uuid4()),
            "booking_id": booking_id,
            "chair_id": data.chair_id,
            "date": data.date,
            "slot_start": slot,
            "start_time": data.start_time,
            "end_time": end_time,
            "duration_minutes": data.duration_minutes,
            "doctor_id": data.doctor_id,
            "patient_name": data.patient_name,
            "patient_id": data.patient_id,
            "treatment_details": data.treatment_details,
            "status": "booked",
            "active_slot": True,
            "created_by": user["id"],
            "created_at": now,
            "updated_at": now,
        }
        for slot in slots
    ]
    try:
        await db.bookings.insert_many(docs, ordered=True)
    except Exception:
        await db.bookings.delete_many({"booking_id": booking_id})
        raise HTTPException(409, "That chair time was just taken. Refresh and choose another slot.")
    await broadcast({"type": "booking_changed", "date": data.date})
    return {"booking_id": booking_id}


async def _check_booking_permission(booking_id: str, user: dict) -> dict:
    existing = await db.bookings.find_one({"booking_id": booking_id, "status": {"$ne": "cancelled"}}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "doctor" and existing["doctor_id"] != user["id"]:
        raise HTTPException(403, "Doctors can only modify their own appointments")
    return existing


@api.patch("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingUpdate, user=Depends(current_user)):
    existing = await _check_booking_permission(booking_id, user)
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if patch.get("status") not in (None, *STATUS):
        raise HTTPException(400, "Invalid status")
    if patch.get("status") == "cancelled":
        patch["active_slot"] = False
    # Blank treatment_details/patient_name not allowed if provided
    for field in ("patient_name", "patient_id", "treatment_details"):
        if field in patch and not str(patch[field]).strip():
            raise HTTPException(400, f"{field.replace('_', ' ').title()} cannot be empty")
    await db.bookings.update_many(
        {"booking_id": booking_id},
        {"$set": {**patch, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await broadcast({"type": "booking_changed", "date": existing["date"]})
    return {"ok": True}


@api.delete("/bookings/{booking_id}")
async def cancel_booking(booking_id: str, user=Depends(current_user)):
    existing = await _check_booking_permission(booking_id, user)
    await db.bookings.update_many(
        {"booking_id": booking_id},
        {"$set": {"status": "cancelled", "active_slot": False, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await broadcast({"type": "booking_changed", "date": existing["date"]})
    return {"ok": True}


# ---------- Waitlist ----------
@api.get("/waitlist")
async def list_waitlist(user=Depends(require("admin", "reception"))):
    return await db.waitlist.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/waitlist")
async def add_waitlist(data: WaitlistIn, user=Depends(require("admin", "reception"))):
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        **data.model_dump(),
        "status": "waiting",
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.waitlist.insert_one(doc)
    await broadcast({"type": "waitlist_changed"})
    return clean(doc)


@api.patch("/waitlist/{waitlist_id}")
async def update_waitlist(waitlist_id: str, data: WaitlistUpdate, user=Depends(require("admin", "reception"))):
    existing = await db.waitlist.find_one({"id": waitlist_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Waitlist entry not found")
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if patch.get("status") and patch["status"] not in WAITLIST_STATUS:
        raise HTTPException(400, "Invalid status")
    if patch:
        patch["updated_by"] = user["id"]
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.waitlist.update_one({"id": waitlist_id}, {"$set": patch})
    updated = await db.waitlist.find_one({"id": waitlist_id}, {"_id": 0})
    await broadcast({"type": "waitlist_changed"})
    return clean(updated)


@api.delete("/waitlist/{waitlist_id}")
async def delete_waitlist(waitlist_id: str, user=Depends(require("admin", "reception"))):
    result = await db.waitlist.delete_one({"id": waitlist_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Waitlist entry not found")
    await broadcast({"type": "waitlist_changed"})
    return {"ok": True}


# ---------- Admin: Users ----------
@api.get("/admin/users")
async def list_users(user=Depends(require("admin"))):
    return [clean(x) for x in await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(200)]


@api.post("/admin/users")
async def add_user(data: UserIn, user=Depends(require("admin"))):
    if data.role not in ROLES:
        raise HTTPException(400, "Invalid role")
    doc = {
        "id": str(uuid.uuid4()),
        "username": data.username.lower().strip(),
        "name": data.name.strip(),
        "role": data.role,
        "active": True,
        "password_hash": bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode(),
    }
    try:
        await db.users.insert_one(doc)
    except Exception:
        raise HTTPException(409, "Username already exists")
    return clean(doc)


@api.patch("/admin/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user=Depends(require("admin"))):
    existing = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "User not found")
    patch = {k: v for k, v in data.model_dump().items() if v is not None and k != "password"}
    if patch.get("role") and patch["role"] not in ROLES:
        raise HTTPException(400, "Invalid role")
    if data.password:
        patch["password_hash"] = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode()
    if patch:
        await db.users.update_one({"id": user_id}, {"$set": patch})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return clean(updated)


# ---------- Admin: Chairs ----------
@api.get("/admin/chairs")
async def list_chairs(user=Depends(require("admin"))):
    return [clean(x) for x in await db.chairs.find({}, {"_id": 0}).sort("order", 1).to_list(50)]


@api.post("/admin/chairs")
async def add_chair(data: ChairIn, user=Depends(require("admin"))):
    count = await db.chairs.count_documents({})
    doc = {"id": str(uuid.uuid4()), "label": data.label.strip(), "active": True, "order": count}
    await db.chairs.insert_one(doc)
    return clean(doc)


@api.patch("/admin/chairs/{chair_id}")
async def update_chair(chair_id: str, data: ChairUpdate, user=Depends(require("admin"))):
    existing = await db.chairs.find_one({"id": chair_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Chair not found")
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if patch:
        await db.chairs.update_one({"id": chair_id}, {"$set": patch})
    updated = await db.chairs.find_one({"id": chair_id}, {"_id": 0})
    return clean(updated)


# ---------- Admin: Settings ----------
@api.get("/admin/settings")
async def get_settings(user=Depends(require("admin"))):
    return clean(await db.settings.find_one({"id": "clinic"}, {"_id": 0}))


@api.patch("/admin/settings")
async def save_settings(data: SettingsIn, user=Depends(require("admin"))):
    if data.slot_interval not in (15, 30, 60):
        raise HTTPException(400, "Interval must be 15, 30, or 60 minutes")
    await db.settings.update_one({"id": "clinic"}, {"$set": data.model_dump()}, upsert=True)
    await broadcast({"type": "settings_changed"})
    return {"ok": True}


# ---------- Admin: Weekly Summary ----------
def _week_bounds(anchor: str) -> tuple[str, str, list[str]]:
    """Return (monday, sunday, list_of_iso_dates_mon_to_sun) for the ISO week containing anchor."""
    d = ddate.fromisoformat(anchor)
    monday = d - timedelta(days=d.weekday())
    dates = [(monday + timedelta(days=i)).isoformat() for i in range(7)]
    return dates[0], dates[-1], dates


@api.get("/admin/weekly-summary")
async def weekly_summary(date: Optional[str] = None, user=Depends(require("admin"))):
    anchor = date or ddate.today().isoformat()
    monday, sunday, days = _week_bounds(anchor)
    rows = await db.bookings.find({"date": {"$gte": monday, "$lte": sunday}}, {"_id": 0}).to_list(10000)

    # Deduplicate by booking_id: an appointment spanning multiple 30-min slots produces N rows.
    per_appt: dict[str, dict] = {}
    for r in rows:
        per_appt[r["booking_id"]] = r
    appts = list(per_appt.values())

    total = len(appts)
    counts = defaultdict(int)
    for a in appts:
        counts[a.get("status", "booked")] += 1

    per_doctor = defaultdict(lambda: {"total": 0, "completed": 0, "cancelled": 0, "no-show": 0})
    for a in appts:
        did = a.get("doctor_id", "unknown")
        per_doctor[did]["total"] += 1
        st = a.get("status", "booked")
        if st in per_doctor[did]:
            per_doctor[did][st] += 1

    # Chair utilisation = sum(duration_minutes for non-cancelled) / (open_minutes * 7)
    settings = await db.settings.find_one({"id": "clinic"}, {"_id": 0}) or {"open_time": "09:00", "close_time": "21:00"}
    oh, om = map(int, settings["open_time"].split(":"))
    ch, cm = map(int, settings["close_time"].split(":"))
    day_minutes = (ch * 60 + cm) - (oh * 60 + om)
    week_minutes_per_chair = day_minutes * 7

    per_chair: dict[str, dict] = defaultdict(lambda: {"total": 0, "used_minutes": 0, "utilisation": 0.0})
    for a in appts:
        cid = a.get("chair_id", "unknown")
        per_chair[cid]["total"] += 1
        if a.get("status") != "cancelled":
            per_chair[cid]["used_minutes"] += a.get("duration_minutes", 0)
    for cid in per_chair:
        per_chair[cid]["utilisation"] = round(
            (per_chair[cid]["used_minutes"] / week_minutes_per_chair * 100) if week_minutes_per_chair else 0, 1
        )

    # Daily trend
    daily = {d: {"total": 0, "completed": 0, "cancelled": 0, "no-show": 0} for d in days}
    for a in appts:
        d = a["date"]
        if d in daily:
            daily[d]["total"] += 1
            st = a.get("status", "booked")
            if st in daily[d]:
                daily[d][st] += 1

    return {
        "week_start": monday,
        "week_end": sunday,
        "days": days,
        "totals": {
            "total": total,
            "booked": counts["booked"],
            "arrived": counts["arrived"],
            "completed": counts["completed"],
            "cancelled": counts["cancelled"],
            "no_show": counts["no-show"],
        },
        "per_doctor": [{"doctor_id": k, **v} for k, v in per_doctor.items()],
        "per_chair": [{"chair_id": k, **v} for k, v in per_chair.items()],
        "daily": [{"date": d, **daily[d]} for d in days],
    }


# ---------- WebSocket ----------
@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connections.discard(ws)


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://gdc-appointment-management.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Background: Auto-complete past appointments ----------
async def auto_complete_loop():
    """Every ~60s, sweep bookings whose end time has passed and mark them Completed
    if they are still in 'booked' or 'arrived' state."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            # Convert to local wall-clock date/time for comparison against stored HH:MM (clinic-local).
            # We treat stored times as clinic-local; a small offset from server tz is acceptable for MVP.
            today = now.date().isoformat()
            hh_mm = now.strftime("%H:%M")

            affected_dates: set[str] = set()

            # Past days: any active booking with status booked/arrived on a date < today
            past_cursor = db.bookings.find(
                {"date": {"$lt": today}, "status": {"$in": ["booked", "arrived"]}},
                {"_id": 0, "booking_id": 1, "date": 1},
            )
            async for row in past_cursor:
                affected_dates.add(row["date"])
            past_res = await db.bookings.update_many(
                {"date": {"$lt": today}, "status": {"$in": ["booked", "arrived"]}},
                {"$set": {"status": "completed", "active_slot": False, "updated_at": now.isoformat(), "updated_by": "system"}},
            )

            # Today: end_time <= now
            today_cursor = db.bookings.find(
                {"date": today, "status": {"$in": ["booked", "arrived"]}, "end_time": {"$lte": hh_mm}},
                {"_id": 0, "date": 1},
            )
            async for row in today_cursor:
                affected_dates.add(row["date"])
            today_res = await db.bookings.update_many(
                {"date": today, "status": {"$in": ["booked", "arrived"]}, "end_time": {"$lte": hh_mm}},
                {"$set": {"status": "completed", "active_slot": False, "updated_at": now.isoformat(), "updated_by": "system"}},
            )

            if (past_res.modified_count + today_res.modified_count) > 0:
                for d in affected_dates:
                    await broadcast({"type": "booking_changed", "date": d})
        except Exception as e:
            print(f"[auto_complete_loop] error: {e}")
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    await db.users.create_index("username", unique=True)
    await db.bookings.create_index(
        [("chair_id", 1), ("date", 1), ("slot_start", 1)],
        unique=True,
        partialFilterExpression={"active_slot": True},
    )
    if not await db.settings.find_one({"id": "clinic"}):
        await db.settings.insert_one({"id": "clinic", "open_time": "09:00", "close_time": "21:00", "slot_interval": 30})
    if await db.chairs.count_documents({}) == 0:
        await db.chairs.insert_many(
            [{"id": str(uuid.uuid4()), "label": f"Chair {i}", "active": True, "order": i} for i in range(1, 10)]
        )
    for username, name, role, password in [
        ("admin", "Clinic Admin", "admin", "admin123"),
        ("reception", "Front Desk", "reception", "reception123"),
        ("doctor", "Dr. Demo", "doctor", "doctor123"),
    ]:
        if not await db.users.find_one({"username": username}):
            await db.users.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "username": username,
                    "name": name,
                    "role": role,
                    "active": True,
                    "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
                }
            )
    # Kick off auto-complete sweep
    asyncio.create_task(auto_complete_loop())


@app.on_event("shutdown")
async def shutdown():
    client.close()
