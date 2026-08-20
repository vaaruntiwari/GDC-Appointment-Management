"""Iteration-7 extra checks: PATCH-blank treatment_details, auto-complete loop, waitlist promotion conflict."""
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(session, username, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    session.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return r.json()


@pytest.fixture
def admin():
    s = requests.Session()
    _login(s, "admin", "admin123")
    created = []
    s.created = created  # type: ignore
    yield s
    for bid in created:
        try:
            s.delete(f"{BASE_URL}/api/bookings/{bid}")
        except Exception:
            pass


def _new_payload(admin, days_offset, start="09:00", duration=30, chair_index=4):
    boot = admin.get(f"{BASE_URL}/api/bootstrap").json()
    tag = uuid.uuid4().hex[:6]
    d = (date(2099, 1, 1) + timedelta(days=(uuid.uuid4().int % 365) + days_offset)).isoformat()
    return {
        "chair_id": boot["chairs"][chair_index]["id"],
        "date": d,
        "start_time": start,
        "duration_minutes": duration,
        "doctor_id": boot["doctors"][0]["id"],
        "patient_name": f"TEST_{tag}",
        "patient_id": f"PID_{tag}",
        "treatment_details": f"Details {tag}",
    }


# Feature: PATCH cannot blank out treatment_details
def test_patch_blank_treatment_details_returns_400(admin):
    payload = _new_payload(admin, days_offset=10)
    r = admin.post(f"{BASE_URL}/api/bookings", json=payload)
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    admin.created.append(bid)
    resp = admin.patch(f"{BASE_URL}/api/bookings/{bid}", json={"treatment_details": "   "})
    assert resp.status_code == 400, resp.text


# Feature: Auto-complete loop marks past-date bookings as completed within ~90s
def test_auto_complete_past_date_booking(admin):
    boot = admin.get(f"{BASE_URL}/api/bootstrap").json()
    tag = uuid.uuid4().hex[:6]
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    payload = {
        "chair_id": boot["chairs"][5]["id"],
        "date": yesterday,
        "start_time": "09:00",
        "duration_minutes": 30,
        "doctor_id": boot["doctors"][0]["id"],
        "patient_name": f"TEST_AC_{tag}",
        "patient_id": f"PID_AC_{tag}",
        "treatment_details": "AutoComplete probe",
    }
    r = admin.post(f"{BASE_URL}/api/bookings", json=payload)
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    admin.created.append(bid)

    deadline = time.time() + 90
    completed = False
    while time.time() < deadline:
        rows = admin.get(f"{BASE_URL}/api/bookings/history", params={"date": yesterday}).json()
        mine = [x for x in rows if x["booking_id"] == bid]
        if mine and mine[0]["status"] == "completed":
            completed = True
            assert mine[0].get("updated_by") == "system"
            break
        time.sleep(5)
    assert completed, "Auto-complete loop did not flip past booking to completed within 90s"


# Feature: Waitlist promotion cannot cause double-booking (409 on conflict)
def test_waitlist_promotion_conflict(admin):
    payload = _new_payload(admin, days_offset=20, chair_index=6)
    r = admin.post(f"{BASE_URL}/api/bookings", json=payload)
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    admin.created.append(bid)

    # Simulate "promote from waitlist" attempt: same chair/date/time
    conflict = admin.post(f"{BASE_URL}/api/bookings", json={**payload,
                                                              "patient_name": "TEST_promote",
                                                              "patient_id": "PID_promote"})
    assert conflict.status_code == 409
