'use strict';
// Provides window.native in a plain browser by talking to server.js. The desktop app's preload does the same job over IPC.
(() => {
  const post = async (url, data) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) })).json();
  const get = async (url) => (await fetch(url)).json();
  const files = new Map(); let n = 0;
  const listeners = { progress: new Set(), model: new Set(), menu: new Set(), added: new Set() };
  const es = new EventSource('/api/events');
  es.addEventListener('progress', (e) => listeners.progress.forEach((f) => f(JSON.parse(e.data))));
  es.addEventListener('model', (e) => listeners.model.forEach((f) => f(JSON.parse(e.data))));
  const on = (k) => (cb) => { listeners[k].add(cb); return () => listeners[k].delete(cb); };

  async function upload(fileList) {
    const out = { added: [], problems: [] };
    for (const f of fileList) {
      try {
        const r = await (await fetch('/api/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name), 'content-type': 'application/octet-stream' }, body: f })).json();
        if (r.error) out.problems.push(`${f.name}: ${r.error}`); else { out.added.push(...r.added); out.problems.push(...r.problems); }
      } catch (e) { out.problems.push(`${f.name}: upload failed (${e.message}). Is the ImageUpscale server still running?`); }
    }
    return out;
  }
  function pick() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = 'image/*,.avif,.tif,.tiff,.bmp';
      input.addEventListener('change', () => resolve(upload([...input.files])));
      input.addEventListener('cancel', () => resolve({ added: [], problems: [] }));
      input.click();
    });
  }
  function saveBlobUrl(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }

  window.native = {
    info: () => get('/api/info'),
    pathForFile: (file) => { const t = `web:${++n}`; files.set(t, file); return t; },
    pickImages: pick,
    addPaths: (tokens) => { const fl = tokens.map((t) => files.get(t)).filter(Boolean); tokens.forEach((t) => files.delete(t)); return upload(fl); },
    remove: (id) => post('/api/remove', { id }),
    preview: (id) => post('/api/preview', { id }),
    upscale: (o) => post('/api/upscale', o),
    cancel: () => post('/api/cancel'),
    prepare: (model) => post('/api/prepare', { model }),
    modelStatus: () => get('/api/model/status'),
    downloadQuality: () => post('/api/model/download'),
    cancelDownload: () => post('/api/model/cancel'),
    save: async (id, format) => { saveBlobUrl(`/api/download/${id}?format=${format}`); return { ok: true, path: 'your Downloads folder' }; },
    saveAll: async (format) => {
      const ids = await get('/api/done');
      if (!ids.length) return { ok: false, error: 'Nothing to save yet. Upscale at least one image.' };
      ids.forEach((id, i) => setTimeout(() => saveBlobUrl(`/api/download/${id}?format=${format}`), i * 400));
      return { ok: true, saved: ids, failed: [], folder: 'your Downloads folder' };
    },
    setState: () => {},
    installUpdate: async () => ({ ok: false, error: 'Update files are installed in the desktop app.' }),
    listUpdates: async () => [],
    switchUpdate: async () => ({ ok: false, error: 'Update files are installed in the desktop app.' }),
    openHandoff: async () => {},
    onProgress: on('progress'), onDownload: on('model'), onMenu: on('menu'), onAdded: on('added'),
  };

  // No native menu in a browser: the same commands on the usual shortcuts.
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const cmd = mod && e.key.toLowerCase() === 'o' ? 'open' : mod && e.shiftKey && e.key.toLowerCase() === 's' ? 'saveAll'
      : mod && e.key.toLowerCase() === 's' ? 'save' : mod && e.key === 'Enter' ? 'upscale' : e.key === 'Escape' ? 'cancel' : null;
    if (cmd) { e.preventDefault(); listeners.menu.forEach((f) => f(cmd)); }
  });
})();
