import { esc, parseNote, renderMarkdown, renderPlain } from './md.js';

const $ = s => document.querySelector(s);
const MIN = 60_000;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let data, items = [], idx = 0, notes = {}, general = null;
let delayMin = store.get('delayMin', 0);
let scale = store.get('scale', 1);
let wakeWanted = store.get('wake', true), wakeLock = null;

// ---------- Time (all comparisons in venue wall-clock, Europe/Lisbon) ----------
const loadedAt = Date.now();
let fakeStart = null; // rehearsal: ?now=2026-11-19T12:35 or ?now=12:35

function naive(s) {
  const m = String(s).match(/(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
}
function wall(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
// "Real" venue time (for the clock) and "schedule" time (shifted back by the delay).
const clockNow = () => (fakeStart != null ? fakeStart + (Date.now() - loadedAt) : wall(new Date(), data.timezone));
const schedNow = () => clockNow() - delayMin * MIN;

const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
const range = it => `${it.startsAt.slice(11, 16)}–${it.endsAt.slice(11, 16)}`;
function mmss(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
function inText(ms) {
  const m = Math.ceil(ms / MIN);
  if (ms < MIN) return `in ${mmss(ms)}`;
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function currentIndex(now = schedNow()) {
  for (let i = 0; i < items.length; i++) if (now < naive(items[i].endsAt)) return i;
  return items.length - 1;
}

function status(i, now = schedNow()) {
  const it = items[i], s = naive(it.startsAt), e = naive(it.endsAt);
  const nextStart = items[i + 1] ? naive(items[i + 1].startsAt) : Infinity;
  if (now < s) return { state: 'upcoming', text: `Starts ${inText(s - now)}`, pct: 0 };
  if (now < e) {
    const left = e - now;
    return { state: left <= 5 * MIN ? 'warn' : 'live', text: `${mmss(left)} left`, pct: (now - s) / (e - s) };
  }
  if (now < nextStart && now - e < 30 * MIN) return { state: 'over', text: `+${mmss(now - e)} over`, pct: 1 };
  return { state: 'done', text: 'Ended', pct: 1 };
}

// ---------- Rendering ----------
const KIND = { keynote: 'Keynote', talk: 'Talk', ceremony: 'Host', break: 'Break' };

function speakerCards(it) {
  if (!it.speakers.length) return '';
  return `<div class="people">${it.speakers.map(p => `
    <div class="person">
      ${p.photo ? `<img src="${esc(p.photo)}" alt="" width="96" height="96" loading="lazy">` : `<div class="noimg">${esc(p.name[0])}</div>`}
      <div><div class="name">${esc(p.name)}</div>${p.tagline ? `<div class="tagline">${esc(p.tagline)}</div>` : ''}</div>
    </div>`).join('')}</div>`;
}

function slotView(it, i) {
  const n = notes[it.notes] || { meta: {}, body: '' };
  const meta = n.meta;
  const checks = Array.isArray(meta.checklist) ? meta.checklist : [];
  const ticks = store.get('check:' + it.id, []);
  const qa = Array.isArray(meta.qa_questions) ? meta.qa_questions : [];
  return `
    ${header(it, i)}
    ${speakerCards(it)}
    ${meta.pronunciation ? `<div class="pron"><span class="label">Say it</span> ${esc(meta.pronunciation)}</div>` : ''}
    <section class="notes card">
      <div class="card-h">My notes ${meta.placeholder === true ? '<span class="badge">PLACEHOLDER</span>' : ''}</div>
      <div class="md">${n.body ? renderMarkdown(n.body) : '<p class="muted">No notes yet.</p>'}</div>
    </section>
    <div class="row2">
      ${qa.length ? `<section class="card"><div class="card-h">Backup Q&amp;A</div><ol class="qa">${qa.map(q => `<li>${esc(q)}</li>`).join('')}</ol></section>` : ''}
      ${checks.length ? `<section class="card"><div class="card-h">Checklist</div><ul class="checks">${checks.map((c, k) => `
        <li><label><input type="checkbox" data-k="${k}" ${ticks[k] ? 'checked' : ''}><span>${esc(c)}</span></label></li>`).join('')}</ul></section>` : ''}
    </div>
    ${it.description ? `<details class="card"><summary>Abstract</summary><div class="plain">${renderPlain(it.description)}</div></details>` : ''}
    ${it.speakers.filter(p => p.bio).map(p => `<details class="card"><summary>Bio · ${esc(p.name)}</summary><div class="plain">${renderPlain(p.bio)}</div></details>`).join('')}
    ${n.error ? `<p class="muted">Couldn't load ${esc(it.notes)} (${esc(n.error)}).</p>` : ''}`;
}

function breakView(it, i) {
  return `
    ${header(it, i)}
    <p class="where">${esc(it.room)}</p>`;
}

function header(it, i) {
  return `
    <div class="meta">
      <span class="time">${range(it)}</span>
      <span class="kind kind-${it.kind}">${KIND[it.kind]}</span>
      <span class="pos">${i + 1}/${items.length}</span>
      <span class="status" id="status"></span>
    </div>
    <div class="progress"><div id="bar"></div></div>
    <h1>${esc(it.title)}</h1>`;
}

function render() {
  const it = items[idx];
  const v = $('#view');
  v.innerHTML = it.kind === 'break' ? breakView(it, idx) : slotView(it, idx);
  v.querySelectorAll('.checks input').forEach(cb => cb.addEventListener('change', () => {
    const t = store.get('check:' + it.id, []);
    t[+cb.dataset.k] = cb.checked;
    store.set('check:' + it.id, t);
  }));
  const nx = items[idx + 1];
  $('#nextUp').innerHTML = nx
    ? `<span class="label">Next</span> <span class="t">${nx.startsAt.slice(11, 16)}</span> ${esc(nx.title)}${nx.speakers.length ? ` <span class="muted">· ${esc(nx.speakers.map(p => p.name).join(', '))}</span>` : ''}`
    : '<span class="muted">End of the day 🎉</span>';
  $('#prev').disabled = idx === 0;
  $('#next').disabled = idx === items.length - 1;
  history.replaceState(null, '', '#' + it.id);
  window.scrollTo(0, 0);
  tick();
}

function go(i) {
  idx = Math.max(0, Math.min(items.length - 1, i));
  render();
}

function tick() {
  const now = schedNow();
  $('#clock').textContent = hhmm(clockNow());
  $('#delay').textContent = delayMin ? `${delayMin > 0 ? '+' : ''}${delayMin} min` : '';
  $('#delay').hidden = !delayMin;
  $('#rehearsal').hidden = fakeStart == null;
  const st = status(idx, now);
  const el = $('#status');
  if (el) { el.textContent = st.text; el.className = 'status ' + st.state; }
  const bar = $('#bar');
  if (bar) { bar.style.width = (st.pct * 100).toFixed(1) + '%'; bar.className = st.state; }
  const ci = currentIndex(now);
  const banner = $('#nowBanner');
  if (ci !== idx && !(status(ci, now).state === 'done')) {
    const c = items[ci];
    const live = now >= naive(c.startsAt);
    banner.innerHTML = `<span class="dot ${live ? 'on' : ''}"></span>${live ? 'Now' : 'Up next'}: <b>${c.startsAt.slice(11, 16)}</b> ${esc(c.title)} <span class="go">Jump →</span>`;
    banner.dataset.i = ci;
    banner.hidden = false;
  } else banner.hidden = true;
}

// ---------- Dialogs ----------
function openAgenda() {
  const ci = currentIndex();
  $('#agendaList').innerHTML = items.map((it, i) => {
    const n = notes[it.notes];
    const ph = it.kind !== 'break' && (!n || n.meta.placeholder === true);
    return `<li><button data-i="${i}" class="${i === idx ? 'sel' : ''} ${i === ci ? 'cur' : ''} k-${it.kind}">
      <span class="t">${it.startsAt.slice(11, 16)}</span>
      <span class="ti">${esc(it.title)}${it.speakers.length ? `<small>${esc(it.speakers.map(p => p.name).join(', '))}</small>` : ''}</span>
      ${ph ? '<span class="ph" title="Notes still placeholder">●</span>' : ''}
    </button></li>`;
  }).join('');
  $('#agenda').showModal();
  $('#agendaList .sel')?.scrollIntoView({ block: 'center' });
}

function openGeneral() {
  $('#generalBody').innerHTML = general?.body ? renderMarkdown(general.body) : '<p class="muted">No announcements.</p>';
  $('#general').showModal();
}

function openSettings() {
  $('#delayVal').textContent = `${delayMin > 0 ? '+' : ''}${delayMin} min`;
  $('#scaleVal').textContent = Math.round(scale * 100) + '%';
  $('#wakeToggle').checked = wakeWanted;
  $('#info').innerHTML = `
    Snapshot: ${esc(data.generatedAt.replace('T', ' ').slice(0, 16))} UTC<br>
    Offline: ${navigator.serviceWorker?.controller ? 'ready ✓' : 'not yet (reload once online)'}<br>
    Screen lock: ${wakeLock ? 'kept awake ✓' : wakeWanted ? 'requested…' : 'off'}<br>
    ${fakeStart != null ? `Rehearsal clock from ?now= (<a href="./">exit</a>)` : 'Rehearse with <code>?now=12:35</code>'}`;
  $('#settings').showModal();
}

function applyScale() { document.documentElement.style.setProperty('--scale', scale); }

async function keepAwake() {
  if (!wakeWanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}

// ---------- Boot ----------
async function loadNote(path) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return parseNote(await r.text());
  } catch (e) {
    return { meta: {}, body: '', error: String(e.message || e) };
  }
}

async function boot() {
  data = await (await fetch('data/schedule.json', { cache: 'no-cache' })).json();
  items = data.items;
  document.title = `${data.room} · Host`;
  $('#room').textContent = data.room;

  const q = new URLSearchParams(location.search).get('now');
  if (q) {
    const v = /^\d\d?:\d\d/.test(q) ? naive(`${data.day}T${q.padStart(5, '0')}`) : naive(q);
    if (!isNaN(v)) fakeStart = v;
  }

  const paths = [...new Set(items.map(i => i.notes).filter(Boolean))];
  const [g, ...loaded] = await Promise.all([loadNote('notes/_general.md'), ...paths.map(loadNote)]);
  general = g;
  paths.forEach((p, k) => { notes[p] = loaded[k]; });

  const fromHash = items.findIndex(i => '#' + i.id === location.hash);
  idx = fromHash >= 0 ? fromHash : currentIndex();
  applyScale();
  render();
  setInterval(tick, 1000);

  $('#prev').onclick = () => go(idx - 1);
  $('#next').onclick = () => go(idx + 1);
  $('#nowBtn').onclick = () => go(currentIndex());
  $('#nowBanner').onclick = e => go(+e.currentTarget.dataset.i);
  $('#agendaBtn').onclick = openAgenda;
  $('#generalBtn').onclick = openGeneral;
  $('#settingsBtn').onclick = openSettings;
  $('#agendaList').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) { $('#agenda').close(); go(+b.dataset.i); } };
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  }));
  document.querySelectorAll('[data-delay]').forEach(b => b.onclick = () => {
    const v = b.dataset.delay;
    delayMin = v === '0' ? 0 : delayMin + +v;
    store.set('delayMin', delayMin);
    $('#delayVal').textContent = `${delayMin > 0 ? '+' : ''}${delayMin} min`;
    tick();
  });
  document.querySelectorAll('[data-scale]').forEach(b => b.onclick = () => {
    scale = Math.min(1.6, Math.max(0.8, +(scale + +b.dataset.scale).toFixed(2)));
    store.set('scale', scale); applyScale();
    $('#scaleVal').textContent = Math.round(scale * 100) + '%';
  });
  $('#wakeToggle').onchange = e => {
    wakeWanted = e.target.checked; store.set('wake', wakeWanted);
    if (wakeWanted) keepAwake(); else wakeLock?.release();
  };
  $('#resetTicks').onclick = () => {
    if (!confirm('Clear all checklist ticks?')) return;
    items.forEach(i => { try { localStorage.removeItem('check:' + i.id); } catch { /* ignore */ } });
    render();
  };
  $('#reloadBtn').onclick = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    location.reload();
  };

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(idx + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(idx - 1);
  });

  // Swipe left/right to move between items.
  let sx = null, sy = 0;
  const main = $('#view');
  main.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('input,label,summary,a')) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) go(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();
  // Some browsers only grant the lock after a user gesture.
  document.addEventListener('pointerdown', keepAwake, { passive: true });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

boot().catch(e => {
  $('#view').innerHTML = `<p class="muted">Couldn't start: ${esc(e.message)}</p>`;
});
