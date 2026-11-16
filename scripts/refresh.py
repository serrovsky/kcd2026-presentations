#!/usr/bin/env python3
"""Refresh the schedule snapshot from Sessionize.

Usage: python3 scripts/refresh.py [--day 2026-11-19] [--room "Cleva Auditorium"]

- Writes data/schedule.json (only the chosen room + day-wide breaks).
- Downloads speaker photos into data/photos/.
- Creates a placeholder note in notes/ for any session that has none.
  Existing notes are NEVER overwritten; they are matched by `session:` id.
"""
import argparse, json, os, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

API = "https://kcd-porto-2026.sessionize.com/api/schedule"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "kcd-host-companion/1.0"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40].strip("-")


def existing_notes():
    found = {}
    ndir = os.path.join(ROOT, "notes")
    for fn in os.listdir(ndir):
        if not fn.endswith(".md") or fn.startswith("_"):
            continue
        with open(os.path.join(ndir, fn), encoding="utf-8") as f:
            m = re.search(r"^session:\s*(\S+)", f.read(), re.M)
        if m:
            found[m.group(1)] = fn
    return found


PLACEHOLDER = """---
# {comment}
session: {id}
placeholder: true
pronunciation:
checklist:
  - Speaker present & ready
  - Mic / headset check
  - Slides on screen
  - Clicker works
qa_questions:
  -
---
> PLACEHOLDER: paste your notes for this session from the Google Doc here,
> then set `placeholder: false` above.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", default="2026-11-19")
    ap.add_argument("--room", default="Cleva Auditorium")
    a = ap.parse_args()

    d = json.loads(get(API))
    rooms = {r["id"]: r["name"] for r in d["rooms"]}
    speakers = {s["id"]: s for s in d["speakers"]}
    notes = existing_notes()
    items = []

    for s in sorted(d["sessions"], key=lambda x: x["startsAt"]):
        if not s["startsAt"].startswith(a.day):
            continue
        room = rooms.get(s.get("roomId"), "")
        in_room = room == a.room
        if not in_room and not (s.get("isServiceSession") and s.get("isPlenumSession")):
            continue
        if s.get("isServiceSession"):
            kind = "ceremony" if in_room else "break"
        else:
            kind = "keynote" if s["title"].lower().startswith("keynote") else "talk"

        spk = []
        for sid in s.get("speakers") or []:
            p = speakers.get(sid)
            if not p:
                continue
            photo = next((f"data/photos/{fn}" for fn in os.listdir(os.path.join(ROOT, "data", "photos"))
                          if fn.startswith(sid + ".")), None)
            if not photo and p.get("profilePicture"):
                try:
                    blob = get(p["profilePicture"])
                    ext = "png" if blob[:4] == b"\x89PNG" else "webp" if blob[8:12] == b"WEBP" else "jpg"
                    photo = f"data/photos/{sid}.{ext}"
                    with open(os.path.join(ROOT, photo), "wb") as f:
                        f.write(blob)
                except Exception as e:  # photo is optional
                    print(f"  ! photo for {p['fullName']}: {e}", file=sys.stderr)
                    photo = None
            spk.append({
                "id": sid,
                "name": p["fullName"],
                "tagline": (p.get("tagLine") or "").strip(),
                "bio": (p.get("bio") or "").strip(),
                "photo": photo,
            })

        note = None
        if kind != "break":
            note = notes.get(s["id"])
            if not note:
                who = spk[0]["name"] if spk else s["title"]
                note = f"{s['startsAt'][11:13]}{s['startsAt'][14:16]}-{slug(who)}.md"
                comment = s["title"] + (" | " + ", ".join(x["name"] for x in spk) if spk else "")
                with open(os.path.join(ROOT, "notes", note), "w", encoding="utf-8") as f:
                    f.write(PLACEHOLDER.format(id=s["id"], comment=comment.replace("\n", " ")))
                print(f"  + created notes/{note}")
            note = "notes/" + note

        items.append({
            "id": s["id"],
            "title": s["title"].strip(),
            "startsAt": s["startsAt"],
            "endsAt": s["endsAt"],
            "kind": kind,
            "room": room,
            "description": (s.get("description") or "").strip(),
            "speakers": spk,
            "notes": note,
        })

    out = {
        "event": "KCD Porto 2026",
        "day": a.day,
        "room": a.room,
        "timezone": "Europe/Lisbon",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items": items,
    }
    with open(os.path.join(ROOT, "data", "schedule.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"wrote data/schedule.json with {len(items)} items")


if __name__ == "__main__":
    main()
