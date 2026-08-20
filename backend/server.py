from fastapi import FastAPI, APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from typing import Optional
from pathlib import Path
import os, uuid, bcrypt, jwt

load_dotenv(Path(__file__).parent / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="Chair Board API")
api = APIRouter(prefix="/api")
JWT_SECRET = os.environ.get("JWT_SECRET", "chair-board-development-secret")
STATUS = {"booked", "arrived", "completed", "cancelled", "no-show"}
ROLES = ("admin", "reception", "doctor")
connections: set[WebSocket] = set()


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
    patient_id: Optional[str] = ""


class BookingUpdate(BaseModel):
    status: Optional[str] = None
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None


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


async def slots_for(start, duration, interval):
    h, m = map(int, start.split(":"))
    count = duration // interval
    return [f"{h + (m + i * interval) // 60:02d}:{(m + i * interval) % 60:02d}" for i in range(count)]


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
    slots = await slots_for(data.start_time, data.duration_minutes, interval)
    booking_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    docs = [
        {
            "id": str(uuid.uuid4()),
            "booking_id": booking_id,
            "chair_id": data.chair_id,
            "date": data.date,
            "slot_start": slot,
            "start_time": data.start_time,
            "duration_minutes": data.duration_minutes,
            "doctor_id": data.doctor_id,
            "patient_name": data.patient_name,
            "patient_id": data.patient_id or "",
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


@api.patch("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingUpdate, user=Depends(current_user)):
    existing = await db.bookings.find_one({"booking_id": booking_id, "status": {"$ne": "cancelled"}}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "doctor" and existing["doctor_id"] != user["id"]:
        raise HTTPException(403, "You can only edit your own appointments")
    patch = {k: v for k, v in data.model_dump().items() if v is not None}
    if patch.get("status") not in (None, *STATUS):
        raise HTTPException(400, "Invalid status")
    if patch.get("status") == "cancelled":
        patch["active_slot"] = False
    await db.bookings.update_many(
        {"booking_id": booking_id},
        {"$set": {**patch, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await broadcast({"type": "booking_changed", "date": existing["date"]})
    return {"ok": True}


@api.delete("/bookings/{booking_id}")
async def cancel_booking(booking_id: str, user=Depends(current_user)):
    existing = await db.bookings.find_one({"booking_id": booking_id, "status": {"$ne": "cancelled"}}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "doctor" and existing["doctor_id"] != user["id"]:
        raise HTTPException(403, "You can only cancel your own appointments")
    await db.bookings.update_many(
        {"booking_id": booking_id},
        {"$set": {"status": "cancelled", "active_slot": False, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await broadcast({"type": "booking_changed", "date": existing["date"]})
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
    return {"ok": True}


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
    allow_origins=[os.environ["FRONTEND_URL"]],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.on_event("shutdown")
async def shutdown():
    client.close()
