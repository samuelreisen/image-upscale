'use strict';
// UI logic. All OS access goes through window.native (preload). No innerHTML with file names.
const $ = (id) => document.getElementById(id);
const SCALES = [2, 4];
const FORMAT_LABEL = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

const state = {
  items: [], selectedId: null, scale: 4, model: 'fast', format: 'png',
  busy: false, downloading: false, qualityReady: false, provider: null,
  preview: null, zoom: 'fit', pos: 50, doneKey: new Map(), // id -> "scale:model" of the stored result
};

if (/Mac/i.test(navigator.platform)) document.body.classList.add('is-mac');

// ---------- small helpers ----------
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('prefs') || '{}');
    if (SCALES.includes(p.scale)) state.scale = p.scale;
    if (p.model === 'fast' || p.model === 'quality') state.model = p.model;
    if (FORMAT_LABEL[p.format]) state.format = p.format;
  } catch { /* storage unavailable: defaults are fine */ }
}
function savePrefs() {
  try { localStorage.setItem('prefs', JSON.stringify({ scale: state.scale, model: state.model, format: state.format })); } catch { /* ignore */ }
}
const selected = () => state.items.find((i) => i.id === state.selectedId) || null;
const keyNow = () => `${state.scale}:${state.model}`;
const isDoneNow = (it) => it.status === 'done' && state.doneKey.get(it.id) === keyNow();

let bannerTimer = null;
function banner(text, ok = false) {
  $('banner-text').textContent = text;
  $('banner').classList.toggle('ok', ok);
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  if (ok) bannerTimer = setTimeout(() => { $('banner').hidden = true; }, 5000);
}
const setStatus = (t) => { $('status').textContent = t || ''; };
const fmtSec = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
const fmtMB = (b) => `${(b / 1048576).toFixed(0)} MB`;

// ---------- queue ----------
function itemMeta(it) {
  if (it.status === 'error') return { text: it.error || 'Could not upscale this image.', err: true };
  if (it.status === 'working') return { text: it.pct != null ? `Upscaling… ${it.pct}%` : 'Upscaling…' };
  if (isDoneNow(it)) return { text: `Done · ${it.width * it.outScale} × ${it.height * it.outScale}` };
  return { text: `${it.width} × ${it.height}` };
}

function renderQueue() {
  const ul = $('queue');
  ul.replaceChildren();
  for (const it of state.items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(it.id === state.selectedId));
    li.tabIndex = 0;
    li.dataset.id = it.id;

    const img = document.createElement('img');
    img.className = 'thumb'; img.src = it.thumb; img.alt = '';

    const mid = document.createElement('div');
    mid.style.minWidth = '0';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = it.name; name.title = it.name;
    const m = itemMeta(it);
    const meta = document.createElement('div'); meta.className = 'meta' + (m.err ? ' err' : ''); meta.textContent = m.text; meta.title = m.text;
    mid.append(name, meta);

    const rm = document.createElement('button');
    rm.className = 'icon-btn rm'; rm.setAttribute('aria-label', `Remove ${it.name}`); rm.title = 'Remove';
    rm.disabled = state.busy;
    rm.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>'; // static markup only
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeItem(it.id); });

    li.append(img, mid, rm);
    li.addEventListener('click', () => select(it.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.id); }
      if (e.key === 'ArrowDown' && li.nextElementSibling) li.nextElementSibling.focus();
      if (e.key === 'ArrowUp' && li.previousElementSibling) li.previousElementSibling.focus();
    });
    ul.append(li);
  }
  $('queue-empty').hidden = state.items.length > 0;
}

async function removeItem(id) {
  if (state.busy) return;
  await native.remove(id);
  const idx = state.items.findIndex((i) => i.id === id);
  state.items.splice(idx, 1);
  state.doneKey.delete(id);
  if (state.selectedId === id) state.selectedId = (state.items[idx] || state.items[idx - 1] || {}).id ?? null;
  await refreshView();
}

async function select(id) {
  state.selectedId = id;
  await refreshView();
}

// ---------- adding images ----------
async function addResult(r) {
  for (const a of r.added) state.items.push({ ...a, outScale: null });
  if (r.added.length) state.selectedId = r.added[0].id;
  if (r.problems.length) banner(r.problems.join(' '));
  await refreshView();
}
async function openPicker() { if (!state.busy) await addResult(await native.pickImages()); }

// ---------- view ----------
let previewToken = 0;
async function refreshView() {
  renderQueue();
  const it = selected();
  const token = ++previewToken;
  $('empty').hidden = state.items.length > 0;
  $('view').hidden = !it;
  $('download').hidden = !(state.model === 'quality' && !state.qualityReady);
  if (it) {
    const p = await native.preview(it.id);
    if (token !== previewToken || !p) return;
    state.preview = p;
    const showAfter = !!p.after && isDoneNow(it);
    $('img-before').src = p.before;
    $('img-after').src = showAfter ? p.after : p.before;
    $('compare').classList.toggle('single', !showAfter);
    $('compare').dataset.w = String(p.outWidth || it.width);
    $('compare').dataset.h = String(p.outHeight || it.height);
    $('compare').dataset.pw = String(it.width);
    layout();
    $('zoom').hidden = false;
    $('zoom').textContent = state.zoom === 'fit' ? 'Actual Size' : 'Fit to Window';
    $('engine').title = '';
    if (showAfter) setStatus(`${it.width} × ${it.height} → ${p.outWidth} × ${p.outHeight} px${it.ms ? ` · ${fmtSec(it.ms)}` : ''}`);
    else if (it.status !== 'working') setStatus(`${it.width} × ${it.height} px`);
  } else {
    $('zoom').hidden = true;
    setStatus('');
  }
  syncControls();
}

// Fit the compare box into the stage, leaving room for the floating toolbar and status bar.
function layout() {
  const c = $('compare');
  const view = $('view');
  const pw = Number(c.dataset.w); const ph = Number(c.dataset.h);
  if (!pw || !ph) return;
  view.classList.toggle('fit', state.zoom === 'fit');
  const availW = view.clientWidth - 48;
  const availH = view.clientHeight - 80 - 68;
  view.style.paddingTop = '80px'; view.style.paddingBottom = '68px'; view.style.boxSizing = 'border-box';
  let w; let h;
  if (state.zoom === 'fit') {
    const s = Math.min(availW / pw, availH / ph);
    w = Math.max(40, Math.floor(pw * s)); h = Math.max(40, Math.floor(ph * s));
  } else {
    // true size of the preview image (previews are capped, see README), one image pixel per device pixel
    const img = $('img-after');
    const nw = img.naturalWidth || pw;
    const dpr = window.devicePixelRatio || 1;
    w = Math.round(nw / dpr); h = Math.round((nw / dpr) * (ph / pw));
  }
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  setPos(state.pos);
}

function setPos(p) {
  state.pos = Math.min(100, Math.max(0, p));
  $('compare').style.setProperty('--pos', `${state.pos}%`);
  $('handle').setAttribute('aria-valuenow', String(Math.round(state.pos)));
}

function wireCompare() {
  const c = $('compare');
  let dragging = false;
  const move = (e) => { const r = c.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
  c.addEventListener('pointerdown', (e) => { if (c.classList.contains('single')) return; dragging = true; c.setPointerCapture(e.pointerId); move(e); });
  c.addEventListener('pointermove', (e) => { if (dragging) move(e); });
  c.addEventListener('pointerup', () => { dragging = false; });
  $('handle').addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') { setPos(state.pos - step); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPos(state.pos + step); e.preventDefault(); }
    if (e.key === 'Home') { setPos(0); e.preventDefault(); }
    if (e.key === 'End') { setPos(100); e.preventDefault(); }
  });
  $('zoom').addEventListener('click', () => { state.zoom = state.zoom === 'fit' ? 'actual' : 'fit'; $('zoom').textContent = state.zoom === 'fit' ? 'Actual Size' : 'Fit to Window'; layout(); });
  new ResizeObserver(layout).observe($('view'));
}

function toggleCompare() {
  const it = selected();
  if (!it || !isDoneNow(it)) return;
  setPos(state.pos > 99 ? 50 : 100); // jump between "all after" and the middle
}

// ---------- controls ----------
function syncControls() {
  const it = selected();
  document.querySelectorAll('[data-scale]').forEach((b) => { b.setAttribute('aria-checked', String(Number(b.dataset.scale) === state.scale)); b.disabled = state.busy; });
  document.querySelectorAll('[data-model]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.model === state.model)); b.disabled = state.busy; });
  $('format').value = state.format; $('format').disabled = state.busy;
  const modelOk = state.model === 'fast' || state.qualityReady;
  const todo = state.items.some((i) => !isDoneNow(i));
  $('upscale').disabled = state.busy || !modelOk || !todo;
  $('upscale').textContent = state.items.filter((i) => !isDoneNow(i)).length > 1 ? 'Upscale All' : 'Upscale';
  $('upscale').title = !modelOk ? 'Download the Quality model first.' : (!state.items.length ? 'Add an image first.' : '');
  $('save').disabled = state.busy || !(it && isDoneNow(it));
  $('cancel').hidden = !(state.busy || state.downloading);
  $('add').disabled = state.busy;
  $('engine').textContent = state.provider ? `Running on ${state.provider}` : 'Starting…';
  $('dl-start').hidden = state.downloading;
  $('dl-cancel').hidden = !state.downloading;
  native.setState({
    count: state.items.length, busy: state.busy, scale: state.scale, model: state.model, format: state.format,
    qualityReady: state.qualityReady, selectedDone: !!(it && isDoneNow(it)), hasResult: state.items.some(isDoneNow),
  });
}

async function setModel(m) {
  if (state.busy) return;
  state.model = m; savePrefs();
  if (m === 'quality' && state.qualityReady) await prepare('quality');
  if (m === 'fast') await prepare('fast');
  await refreshView();
}
async function prepare(m) {
  const r = await native.prepare(m);
  if (r.ok) state.provider = r.provider; else banner(r.error);
  syncControls();
}
function setScale(s) { if (!state.busy) { state.scale = s; savePrefs(); refreshView(); } }

// ---------- upscale ----------
async function upscale() {
  if (state.busy) return;
  const ids = state.items.filter((i) => !isDoneNow(i)).map((i) => i.id);
  if (!ids.length) return;
  state.busy = true; $('banner').hidden = true;
  for (const id of ids) { const it = state.items.find((i) => i.id === id); it.status = 'ready'; it.error = null; it.pct = null; }
  syncControls(); renderQueue();
  const scale = state.scale; const model = state.model;
  const r = await native.upscale({ ids, scale, model });
  state.busy = false;
  $('progress').hidden = true; $('working').hidden = true;
  if (!r.ok) banner(r.error);
  else if (r.cancelled) setStatus('Cancelled.');
  else {
    const failed = state.items.filter((i) => i.status === 'error').length;
    if (failed) banner(`${failed} image${failed > 1 ? 's' : ''} could not be upscaled. The reason is listed under each one.`);
    const total = r.results.reduce((a, x) => a + x.ms, 0);
    if (r.results.length) setStatus(`Finished ${r.results.length} image${r.results.length > 1 ? 's' : ''} in ${fmtSec(total)} on ${r.provider}.`);
  }
  for (const x of r.results || []) {
    const it = state.items.find((i) => i.id === x.id);
    if (it) { it.ms = x.ms; it.outScale = scale; state.doneKey.set(it.id, `${scale}:${model}`); }
  }
  await refreshView();
}

function onProgress(p) {
  const it = state.items.find((i) => i.id === p.id);
  if (!it) return;
  it.status = p.status;
  if (p.status === 'error') it.error = p.error;
  if (p.status === 'working') {
    it.pct = Math.round((p.done / p.total) * 100);
    $('working').hidden = false; $('progress').hidden = false;
    const overall = ((p.index + p.done / p.total) / p.count) * 100;
    $('progress-bar').style.width = `${overall}%`;
    const where = p.count > 1 ? `Image ${p.index + 1} of ${p.count} · ` : '';
    $('working-text').textContent = `${where}Upscaling… ${it.pct}%`;
  }
  if (p.status === 'done' && p.provider) { state.provider = p.provider; }
  renderQueue();
}

// ---------- model download ----------
async function download() {
  if (state.downloading) return;
  state.downloading = true; $('dl-text').textContent = 'Starting…'; syncControls();
  const r = await native.downloadQuality();
  state.downloading = false;
  if (r.ok) {
    state.qualityReady = true; $('dl-text').textContent = '';
    await prepare('quality');
    banner('Quality model is ready.', true);
  } else { $('dl-text').textContent = r.error || ''; if (!r.cancelled && r.error) banner(r.error); }
  await refreshView();
}

// ---------- saving ----------
async function save() {
  const it = selected(); if (!it) return;
  const r = await native.save(it.id, state.format);
  if (r.cancelled) return;
  if (r.ok) banner(`Saved to ${r.path}`, true); else banner(r.error);
}
async function saveAll() {
  const r = await native.saveAll(state.format);
  if (r.cancelled) return;
  if (r.error) return banner(r.error);
  if (r.failed.length) banner(`Saved ${r.saved.length}, but ${r.failed.length} failed: ${r.failed.join(' ')}`);
  else banner(`Saved ${r.saved.length} image${r.saved.length === 1 ? '' : 's'} to ${r.folder}`, true);
}

// ---------- updates dialog ----------
async function showUpdates() {
  const info = await native.info();
  $('updates-current').textContent = info.mark ? `In use: ${info.mark.name}${info.mark.title ? ` · ${info.mark.title}` : ''}` : 'No update mark yet. The app is on its original build.';
  const list = await native.listUpdates();
  const ul = $('updates-list'); ul.replaceChildren();
  $('updates-empty').hidden = list.length > 0; ul.hidden = list.length === 0;
  for (const u of list) {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'u-name'; n.textContent = u.name;
    const t = document.createElement('span'); t.className = 'u-title'; t.textContent = u.title || '';
    li.append(n, t);
    if (u.active) { const s = document.createElement('span'); s.className = 'in-use'; s.textContent = 'In Use'; li.append(s); }
    else {
      const b = document.createElement('button'); b.className = 'btn plain'; b.textContent = 'Switch to This One';
      b.addEventListener('click', async () => { const r = await native.switchUpdate(u.mark); if (!r.ok) banner(r.error); });
      li.append(b);
    }
    ul.append(li);
  }
  if (!$('updates').open) $('updates').showModal();
}

// ---------- wiring ----------
function handleMenu(cmd) {
  if (cmd === 'open') return openPicker();
  if (cmd === 'save') return save();
  if (cmd === 'saveAll') return saveAll();
  if (cmd === 'remove') return state.selectedId != null && removeItem(state.selectedId);
  if (cmd === 'upscale') return upscale();
  if (cmd === 'cancel') return cancel();
  if (cmd === 'download') { setModel('quality'); return download(); }
  if (cmd === 'toggleCompare') return toggleCompare();
  if (cmd === 'updates') return showUpdates();
  const [k, v] = cmd.split(':');
  if (k === 'scale') return setScale(Number(v));
  if (k === 'model') return setModel(v);
  if (k === 'format') { state.format = v; savePrefs(); return syncControls(); }
}
function cancel() {
  if (state.busy) native.cancel();
  if (state.downloading) native.cancelDownload();
}

async function init() {
  loadPrefs();
  wireCompare();
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => setScale(Number(b.dataset.scale))));
  document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => setModel(b.dataset.model)));
  $('format').addEventListener('change', (e) => { state.format = e.target.value; savePrefs(); syncControls(); });
  $('add').addEventListener('click', openPicker);
  $('empty-open').addEventListener('click', openPicker);
  $('upscale').addEventListener('click', upscale);
  $('cancel').addEventListener('click', cancel);
  $('save').addEventListener('click', save);
  $('dl-start').addEventListener('click', download);
  $('dl-cancel').addEventListener('click', cancel);
  $('banner-close').addEventListener('click', () => { $('banner').hidden = true; });
  $('updates-close').addEventListener('click', () => $('updates').close());
  $('updates-install').addEventListener('click', async () => { await native.installUpdate(); });
  $('updates-handoff').addEventListener('click', () => native.openHandoff());

  // Drag and drop: the preload turns File objects into real paths.
  const stage = $('stage');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; stage.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; stage.classList.remove('dragging');
    if (state.busy) return;
    const paths = [...e.dataTransfer.files].map((f) => native.pathForFile(f)).filter(Boolean);
    if (paths.length) await addResult(await native.addPaths(paths));
  });

  native.onAdded((r) => addResult(r));
  native.onProgress(onProgress);
  native.onMenu(handleMenu);
  native.onDownload(({ got, total }) => {
    $('dl-text').textContent = `${fmtMB(got)} of ${fmtMB(total)}`;
  });

  const st = await native.modelStatus();
  state.qualityReady = st.quality.ready;
  if (state.model === 'quality' && !state.qualityReady) state.model = 'fast'; // never start on a model we cannot run
  await refreshView();
  await prepare(state.model);
  await refreshView();
}

init();
