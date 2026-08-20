import os
import uuid
from datetime import date, timedelta

import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _future_date(offset_days: int) -> str:
    """Generate a unique-ish future date per test run to avoid data collisions."""
    # Start from a base year that is safely in the future and offset by run-random days
    base = date(2099, 1, 1)
    salt = uuid.uuid4().int % 365
    return (base + timedelta(days=offset_days + salt)).isoformat()


@pytest.fixture
def client():
    session = requests.Session()
    created_booking_ids: list[str] = []
    session.created_booking_ids = created_booking_ids  # type: ignore[attr-defined]
    yield session
    # Best-effort cleanup: cancel any bookings created during the test as admin
    if created_booking_ids:
        cleanup = requests.Session()
        try:
            r = cleanup.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"})
            if r.status_code == 200:
                cleanup.headers["Authorization"] = f"Bearer {r.json()['token']}"
                for bid in created_booking_ids:
                    cleanup.delete(f"{BASE_URL}/api/bookings/{bid}")
        except Exception:
            pass


def auth(client, username, password):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()
    client.headers["Authorization"] = f"Bearer {data['token']}"
    return data


def test_all_roles_login_and_bootstrap(client):
    for username, password, role in [
        ("admin", "admin123", "admin"),
        ("reception", "reception123", "reception"),
        ("doctor", "doctor123", "doctor"),
    ]:
        data = auth(client, username, password)
        assert data["user"]["role"] == role
        assert client.get(f"{BASE_URL}/api/auth/me").json()["username"] == username
        boot = client.get(f"{BASE_URL}/api/bootstrap").json()
        assert len(boot["chairs"]) >= 9


def test_admin_endpoint_denied_to_reception(client):
    auth(client, "reception", "reception123")
    assert client.get(f"{BASE_URL}/api/admin/users").status_code == 403


def test_create_multislot_conflict_cancel_rebook(client):
    auth(client, "reception", "reception123")
    boot = client.get(f"{BASE_URL}/api/bootstrap").json()
    test_date = _future_date(1)
    payload = {
        "chair_id": boot["chairs"][0]["id"],
        "date": test_date,
        "start_time": "09:00",
        "duration_minutes": 60,
        "doctor_id": boot["doctors"][0]["id"],
        "patient_name": "TEST_" + uuid.uuid4().hex,
    }
    created = client.post(f"{BASE_URL}/api/bookings", json=payload)
    assert created.status_code == 200, created.text
    booking_id = created.json()["booking_id"]
    client.created_booking_ids.append(booking_id)

    rows = client.get(f"{BASE_URL}/api/bookings", params={"date": test_date}).json()
    assert len([x for x in rows if x["booking_id"] == booking_id]) == 2

    conflict = client.post(f"{BASE_URL}/api/bookings", json={**payload, "patient_name": "TEST_conflict"})
    assert conflict.status_code == 409 and "taken" in conflict.text

    assert client.patch(f"{BASE_URL}/api/bookings/{booking_id}", json={"status": "cancelled"}).status_code == 200

    rebooked = client.post(f"{BASE_URL}/api/bookings", json={**payload, "patient_name": "TEST_rebook"})
    assert rebooked.status_code == 200, rebooked.text
    client.created_booking_ids.append(rebooked.json()["booking_id"])


def test_doctor_cannot_book_for_other_doctor(client):
    data = auth(client, "doctor", "doctor123")
    boot = client.get(f"{BASE_URL}/api/bootstrap").json()
    other = next((d for d in boot["doctors"] if d["id"] != data["user"]["id"]), {"id": "other"})
    payload = {
        "chair_id": boot["chairs"][1]["id"],
        "date": _future_date(2),
        "start_time": "09:00",
        "duration_minutes": 30,
        "doctor_id": other["id"],
        "patient_name": "TEST_forbidden",
    }
    assert client.post(f"{BASE_URL}/api/bookings", json=payload).status_code == 403


def test_admin_can_manage_chairs_users_settings(client):
    auth(client, "admin", "admin123")

    # Chairs
    label = f"TEST_Chair_{uuid.uuid4().hex[:6]}"
    added = client.post(f"{BASE_URL}/api/admin/chairs", json={"label": label})
    assert added.status_code == 200
    chair_id = added.json()["id"]
    updated = client.patch(f"{BASE_URL}/api/admin/chairs/{chair_id}", json={"active": False})
    assert updated.status_code == 200 and updated.json()["active"] is False
    all_chairs = client.get(f"{BASE_URL}/api/admin/chairs").json()
    assert any(c["id"] == chair_id for c in all_chairs)

    # Users
    uname = f"testu_{uuid.uuid4().hex[:6]}"
    created = client.post(
        f"{BASE_URL}/api/admin/users",
        json={"username": uname, "name": "Temp User", "role": "doctor", "password": "pw123456"},
    )
    assert created.status_code == 200
    uid = created.json()["id"]
    patched = client.patch(f"{BASE_URL}/api/admin/users/{uid}", json={"role": "reception", "active": False})
    assert patched.status_code == 200 and patched.json()["role"] == "reception" and patched.json()["active"] is False

    # Settings
    s = client.get(f"{BASE_URL}/api/admin/settings").json()
    save = client.patch(
        f"{BASE_URL}/api/admin/settings",
        json={"open_time": s["open_time"], "close_time": s["close_time"], "slot_interval": s["slot_interval"]},
    )
    assert save.status_code == 200
