import os
import uuid
from datetime import date, timedelta

import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _future_date(offset_days: int) -> str:
    base = date(2099, 1, 1)
    salt = uuid.uuid4().int % 365
    return (base + timedelta(days=offset_days + salt)).isoformat()


def _valid_payload(chair_id, doctor_id, days=1, start="09:00", duration=60, tag=None):
    tag = tag or uuid.uuid4().hex[:6]
    return {
        "chair_id": chair_id,
        "date": _future_date(days),
        "start_time": start,
        "duration_minutes": duration,
        "doctor_id": doctor_id,
        "patient_name": f"TEST_{tag}",
        "patient_id": f"PID_{tag}",
        "treatment_details": f"Cleaning session {tag}",
    }


@pytest.fixture
def client():
    session = requests.Session()
    created_booking_ids: list[str] = []
    session.created_booking_ids = created_booking_ids  # type: ignore[attr-defined]
    yield session
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
    assert client.get(f"{BASE_URL}/api/admin/weekly-summary").status_code == 403


def test_create_multislot_conflict_cancel_rebook(client):
    auth(client, "reception", "reception123")
    boot = client.get(f"{BASE_URL}/api/bootstrap").json()
    payload = _valid_payload(boot["chairs"][0]["id"], boot["doctors"][0]["id"], days=1, duration=60)
    created = client.post(f"{BASE_URL}/api/bookings", json=payload)
    assert created.status_code == 200, created.text
    booking_id = created.json()["booking_id"]
    client.created_booking_ids.append(booking_id)

    rows = client.get(f"{BASE_URL}/api/bookings", params={"date": payload["date"]}).json()
    assert len([x for x in rows if x["booking_id"] == booking_id]) == 2
    # Treatment details persisted
    assert rows[0]["treatment_details"] == payload["treatment_details"]

    conflict = client.post(f"{BASE_URL}/api/bookings", json={**payload, "patient_name": "TEST_conflict"})
    assert conflict.status_code == 409

    assert client.patch(f"{BASE_URL}/api/bookings/{booking_id}", json={"status": "cancelled"}).status_code == 200

    rebook = _valid_payload(payload["chair_id"], payload["doctor_id"], days=1, duration=60)
    rebook["date"] = payload["date"]
    rebook["start_time"] = payload["start_time"]
    rebooked = client.post(f"{BASE_URL}/api/bookings", json=rebook)
    assert rebooked.status_code == 200, rebooked.text
    client.created_booking_ids.append(rebooked.json()["booking_id"])


def test_doctor_cannot_book_or_modify_other_doctor(client):
    data = auth(client, "doctor", "doctor123")
    boot = client.get(f"{BASE_URL}/api/bootstrap").json()
    other_id = next((d["id"] for d in boot["doctors"] if d["id"] != data["user"]["id"]), "other")

    # Cannot create for another doctor
    bad = _valid_payload(boot["chairs"][1]["id"], other_id, days=2)
    assert client.post(f"{BASE_URL}/api/bookings", json=bad).status_code == 403

    # Reception creates a booking assigned to "other" doctor
    admin_session = requests.Session()
    ar = admin_session.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"})
    admin_session.headers["Authorization"] = f"Bearer {ar.json()['token']}"
    good = _valid_payload(boot["chairs"][2]["id"], other_id, days=3)
    created = admin_session.post(f"{BASE_URL}/api/bookings", json=good)
    assert created.status_code == 200
    bid = created.json()["booking_id"]
    client.created_booking_ids.append(bid)

    # Doctor tries to patch it -> 403
    resp = client.patch(f"{BASE_URL}/api/bookings/{bid}", json={"status": "arrived"})
    assert resp.status_code == 403, resp.text
    # Doctor tries to DELETE -> 403
    assert client.delete(f"{BASE_URL}/api/bookings/{bid}").status_code == 403


def test_mandatory_fields_rejected(client):
    auth(client, "reception", "reception123")
    boot = client.get(f"{BASE_URL}/api/bootstrap").json()
    base = _valid_payload(boot["chairs"][3]["id"], boot["doctors"][0]["id"], days=4)
    # missing treatment_details
    bad = dict(base)
    bad["treatment_details"] = "   "
    r = client.post(f"{BASE_URL}/api/bookings", json=bad)
    assert r.status_code == 422, r.text
    # missing patient_id
    bad2 = dict(base)
    bad2["patient_id"] = ""
    assert client.post(f"{BASE_URL}/api/bookings", json=bad2).status_code == 422


def test_admin_can_manage_chairs_users_settings(client):
    auth(client, "admin", "admin123")
    label = f"TEST_Chair_{uuid.uuid4().hex[:6]}"
    added = client.post(f"{BASE_URL}/api/admin/chairs", json={"label": label})
    assert added.status_code == 200
    chair_id = added.json()["id"]
    updated = client.patch(f"{BASE_URL}/api/admin/chairs/{chair_id}", json={"active": False})
    assert updated.status_code == 200 and updated.json()["active"] is False

    uname = f"testu_{uuid.uuid4().hex[:6]}"
    created = client.post(
        f"{BASE_URL}/api/admin/users",
        json={"username": uname, "name": "Temp User", "role": "doctor", "password": "pw123456"},
    )
    assert created.status_code == 200
    uid = created.json()["id"]
    patched = client.patch(f"{BASE_URL}/api/admin/users/{uid}", json={"role": "reception", "active": False})
    assert patched.status_code == 200 and patched.json()["role"] == "reception"

    s = client.get(f"{BASE_URL}/api/admin/settings").json()
    save = client.patch(
        f"{BASE_URL}/api/admin/settings",
        json={"open_time": s["open_time"], "close_time": s["close_time"], "slot_interval": s["slot_interval"]},
    )
    assert save.status_code == 200


def test_waitlist_flow(client):
    auth(client, "reception", "reception123")
    add = client.post(
        f"{BASE_URL}/api/waitlist",
        json={
            "patient_name": f"WL_{uuid.uuid4().hex[:6]}",
            "patient_id": f"PID_{uuid.uuid4().hex[:6]}",
            "treatment_details": "Walk-in cleaning",
        },
    )
    assert add.status_code == 200, add.text
    wid = add.json()["id"]
    assert add.json()["status"] == "waiting"

    listed = client.get(f"{BASE_URL}/api/waitlist").json()
    assert any(w["id"] == wid for w in listed)

    updated = client.patch(f"{BASE_URL}/api/waitlist/{wid}", json={"status": "scheduled"})
    assert updated.status_code == 200 and updated.json()["status"] == "scheduled"

    assert client.delete(f"{BASE_URL}/api/waitlist/{wid}").status_code == 200


def test_waitlist_denied_to_doctor(client):
    auth(client, "doctor", "doctor123")
    assert client.get(f"{BASE_URL}/api/waitlist").status_code == 403


def test_weekly_summary_admin_only(client):
    # Doctor / reception denied
    auth(client, "doctor", "doctor123")
    assert client.get(f"{BASE_URL}/api/admin/weekly-summary").status_code == 403
    # Admin allowed
    auth(client, "admin", "admin123")
    r = client.get(f"{BASE_URL}/api/admin/weekly-summary")
    assert r.status_code == 200
    body = r.json()
    for k in ("week_start", "week_end", "days", "totals", "per_doctor", "per_chair", "daily"):
        assert k in body
    assert len(body["days"]) == 7
