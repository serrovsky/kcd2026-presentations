# kcd2026-presentations

Host companion for the **Cleva Auditorium** at KCD Porto 2026 (19 Nov). It's an offline-capable web app for an Android tablet.

**Live:** https://serrovsky.github.io/kcd2026-presentations/

## Editing notes

Each session has a file in `notes/`, named `HHMM-speaker.md`. Edit it on GitHub, either the web editor or the `.` key, or locally. Pushing to `main` redeploys in about 1 minute.

```markdown
---
# Title | Speaker            ← comment, for your reference only
session: 1292427             ← links the file to Sessionize, don't change it
placeholder: false           ← set to false once filled in (removes the badge)
pronunciation: na-ta-na-EL KO-pa
checklist:
  - Speaker present & ready
  - Mic / headset check
qa_questions:
  - A question if the room is quiet
---
Your intro script, in Markdown: **bold**, _italic_, ==highlight==, lists, ## headings.
```

`notes/_general.md` holds the day-wide announcements, opened from the ★ button.

> The repo is public, so everything in `notes/` is publicly readable.

## On the tablet

- Open the URL in **Chrome**, then go to ⋮ → **Add to Home screen** (Install app). Open it once while online so it caches everything for offline use.
- The app opens on the current or next session, based on Porto time.
- Swipe or use ‹ › to move. Use ☰ to jump anywhere; a ● there marks notes that are still placeholders.
- **Now** jumps back to what's live.
- ⚙ **Running late by**: shifts the schedule when the room runs behind.
- ⚙ **Text size**, **keep screen awake**, **reload latest notes**, **clear checklist ticks**.
- To pick up new notes after a push, reopen the app while online, or use ⚙ → Reload latest notes.

## Rehearsal

Add `?now=HH:MM`, e.g. `…/kcd2026-presentations/?now=12:35`, to fake the clock. It keeps ticking from that time.

## Refreshing the schedule

```sh
python3 scripts/refresh.py          # updates data/schedule.json + photos; never overwrites notes
```

Sessions that are new in Sessionize get a placeholder note. Existing notes are matched by `session:` id.

## Local preview

```sh
python3 -m http.server 8000   # then open http://localhost:8000/?now=10:20
```
