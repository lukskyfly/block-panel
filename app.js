// === Config ===
const LS_REPO  = 'block_panel_repo';
const LS_PAT   = 'block_panel_pat';
const LS_STEPS = 'block_panel_steps';
const STEP_KEYS = ['grid', 'gam', 'criteo', 'pubmatic', 'wpartner', 'xandr', 'newsletter'];

function getSteps() {
  const saved = localStorage.getItem(LS_STEPS);
  if (saved) return JSON.parse(saved);
  return Object.fromEntries(STEP_KEYS.map(k => [k, true]));
}

function saveSteps(steps) {
  localStorage.setItem(LS_STEPS, JSON.stringify(steps));
}

function getConfig() {
  return { repo: localStorage.getItem(LS_REPO) || '', pat: localStorage.getItem(LS_PAT) || '' };
}

function saveConfig(repo, pat) {
  localStorage.setItem(LS_REPO, repo);
  localStorage.setItem(LS_PAT, pat);
}

// === GitHub API helpers ===
async function ghGet(path) {
  const { repo, pat } = getConfig();
  const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' }
  });
  if (!resp.ok) throw new Error(`GitHub GET ${path}: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function ghPut(path, content, sha, message, rawBase64 = false) {
  const { repo, pat } = getConfig();
  const encoded = rawBase64 ? content : btoa(unescape(encodeURIComponent(content)));
  const body = { message, content: encoded };
  if (sha) body.sha = sha;
  const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`GitHub PUT ${path}: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// === pending.json helpers ===
async function loadQueue() {
  const file = await ghGet('pending.json');
  const text = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))));
  return { items: JSON.parse(text), sha: file.sha };
}

async function saveQueue(items, sha) {
  return ghPut('pending.json', JSON.stringify(items, null, 2), sha, `Update queue [${new Date().toISOString().slice(0,10)}]`);
}

// === Screenshot upload ===
async function uploadScreenshot(domain, base64Data, ext) {
  const filename = `screenshots/${domain.replace(/\./g, '_')}_${Date.now()}.${ext}`;
  const { repo } = getConfig();
  await ghPut(filename, base64Data, null, `Add screenshot for ${domain}`, true);
  // raw URL
  const [owner, repoName] = repo.split('/');
  return `https://raw.githubusercontent.com/${owner}/${repoName}/main/${filename}`;
}

// === ID generator ===
function uid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// === Toast ===
let toastTimer;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// === Lightbox ===
function showLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = '<img>';
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
}

// === Render queue ===
function renderQueue(items) {
  const loading = document.getElementById('queue-loading');
  const empty   = document.getElementById('queue-empty');
  const table   = document.getElementById('queue-table');
  const body    = document.getElementById('queue-body');
  const stats   = document.getElementById('queue-stats');

  loading.classList.add('hidden');

  const pending = items.filter(i => i.status === 'pending').length;
  const blocked = items.filter(i => i.status === 'blocked' || i.status === 'blocked_partial').length;
  stats.textContent = `${pending} oczekuje · ${blocked} zablokowanych`;

  const btnDeleteAll = document.getElementById('btn-delete-all');
  if (btnDeleteAll) btnDeleteAll.classList.toggle('hidden', items.length === 0);

  const btnRunBlocking = document.getElementById('btn-run-blocking');
  if (btnRunBlocking) {
    const pendingCount = items.filter(i => i.status === 'pending').length;
    btnRunBlocking.classList.toggle('hidden', pendingCount === 0);
  }

  if (items.length === 0) {
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  table.classList.remove('hidden');
  body.innerHTML = '';

  // newest first
  const sorted = [...items].sort((a, b) => b.added.localeCompare(a.added));

  sorted.forEach(item => {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.dataset.domain = item.domain;
    tr.dataset.screenshotUrl = item.screenshot_url || '';

    // domain
    const tdDomain = document.createElement('td');
    tdDomain.className = 'domain-cell';
    tdDomain.textContent = item.domain;
    tr.appendChild(tdDomain);

    // screenshot
    const tdThumb = document.createElement('td');
    tdThumb.className = 'thumb-cell';
    if (item.screenshot_url) {
      const img = document.createElement('img');
      img.src = item.screenshot_url;
      img.alt = 'screenshot';
      img.title = 'Kliknij aby powiększyć';
      img.addEventListener('click', () => showLightbox(item.screenshot_url));
      tdThumb.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.className = 'no-img';
      span.textContent = '—';
      tdThumb.appendChild(span);
    }
    tr.appendChild(tdThumb);

    // date
    const tdDate = document.createElement('td');
    tdDate.className = 'date-cell';
    tdDate.textContent = item.added;
    tr.appendChild(tdDate);

    // status
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${item.status}`;
    const labels = { pending: 'oczekuje', ready: 'gotowe', blocked: 'zablokowane', blocked_partial: 'częściowo' };
    badge.textContent = labels[item.status] || item.status;
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // actions
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-danger btn-sm';
    btnDel.textContent = 'Usuń';
    btnDel.addEventListener('click', () => deleteItem(item.id));
    tdActions.appendChild(btnDel);

    tr.appendChild(tdActions);
    body.appendChild(tr);
  });
}

// === State ===
let queueItems = [];
let queueSha   = null;
let screenshotB64 = null;
let screenshotExt = null;

// === Actions ===
async function loadAndRender() {
  document.getElementById('queue-loading').classList.remove('hidden');
  document.getElementById('queue-empty').classList.add('hidden');
  document.getElementById('queue-table').classList.add('hidden');
  try {
    const { items, sha } = await loadQueue();
    queueItems = items;
    queueSha   = sha;
    renderQueue(items);
  } catch (e) {
    document.getElementById('queue-loading').textContent = 'Błąd ładowania: ' + e.message;
    showToast('Błąd: ' + e.message, 'error');
  }
}

async function addItem() {
  const domain = document.getElementById('domain-input').value.trim().toLowerCase();
  if (!domain) { showToast('Podaj domenę', 'error'); return; }

  const btn = document.getElementById('btn-add');
  btn.disabled = true;
  btn.textContent = 'Dodawanie...';

  try {
    let screenshotUrl = null;
    if (screenshotB64) {
      showToast('Uploaduję screenshot...', 'info');
      screenshotUrl = await uploadScreenshot(domain, screenshotB64, screenshotExt);
    }

    const today = new Date();
    const added = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    queueItems.push({ id: uid(), domain, screenshot_url: screenshotUrl, added, status: 'pending', blocked_at: null });

    const result = await saveQueue(queueItems, queueSha);
    queueSha = result.content.sha;

    document.getElementById('domain-input').value = '';
    clearScreenshot();
    renderQueue(queueItems);
    showToast(`${domain} dodano do kolejki`, 'success');
  } catch (e) {
    showToast('Błąd dodawania: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Dodaj do kolejki';
  }
}

async function markAllReady() {
  const pending = queueItems.filter(i => i.status === 'pending');
  if (!pending.length) { showToast('Brak oczekujących domen', 'info'); return; }
  const btn = document.getElementById('btn-run-blocking');
  btn.disabled = true;
  try {
    pending.forEach(i => { i.status = 'ready'; });
    const result = await saveQueue(queueItems, queueSha);
    queueSha = result.content.sha;
    renderQueue(queueItems);
    showToast(`${pending.length} domen oznaczono jako gotowe — uruchom /block_queue w Claude`, 'success');
  } catch (e) {
    pending.forEach(i => { i.status = 'pending'; });
    showToast('Błąd: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteAll() {
  if (!confirm(`Usunąć wszystkie ${queueItems.length} pozycji z kolejki?`)) return;
  try {
    const result = await saveQueue([], queueSha);
    queueSha = result.content.sha;
    queueItems = [];
    renderQueue([]);
    showToast('Kolejka wyczyszczona', 'info');
  } catch (e) {
    showToast('Błąd: ' + e.message, 'error');
  }
}

async function deleteItem(id) {
  const item = queueItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Usunąć ${item.domain} z kolejki?`)) return;
  try {
    queueItems = queueItems.filter(i => i.id !== id);
    const result = await saveQueue(queueItems, queueSha);
    queueSha = result.content.sha;
    renderQueue(queueItems);
    showToast(`${item.domain} usunięto`, 'info');
  } catch (e) {
    showToast('Błąd: ' + e.message, 'error');
  }
}

function clearScreenshot() {
  screenshotB64 = null;
  screenshotExt = null;
  document.getElementById('screenshot-input').value = '';
  document.getElementById('screenshot-preview').classList.add('hidden');
  document.getElementById('preview-img').src = '';
}

// === Init ===
// === Theme ===
function applyTheme(light) {
  document.body.classList.toggle('light', light);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = light ? '☀' : '☽';
}

document.addEventListener('DOMContentLoaded', () => {
  // Steps config
  const steps = getSteps();
  document.querySelectorAll('.step-cb').forEach(cb => {
    cb.checked = steps[cb.dataset.step] !== false;
    cb.addEventListener('change', () => {
      const current = getSteps();
      current[cb.dataset.step] = cb.checked;
      saveSteps(current);
    });
  });

  // Dark/light mode
  const themeSwitch = document.getElementById('theme-switch');
  const savedLight = localStorage.getItem('theme') === 'light';
  themeSwitch.checked = savedLight;
  applyTheme(savedLight);
  themeSwitch.addEventListener('change', () => {
    const isLight = themeSwitch.checked;
    applyTheme(isLight);
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });

  const { repo, pat } = getConfig();

  // Config modal
  if (!repo || !pat) {
    document.getElementById('config-modal').classList.remove('hidden');
  }

  document.getElementById('cfg-save').addEventListener('click', () => {
    const r = document.getElementById('cfg-repo').value.trim();
    const p = document.getElementById('cfg-pat').value.trim();
    if (!r || !p) { showToast('Wypełnij oba pola', 'error'); return; }
    saveConfig(r, p);
    document.getElementById('config-modal').classList.add('hidden');
    loadAndRender();
  });

  document.getElementById('btn-config').addEventListener('click', () => {
    const { repo, pat } = getConfig();
    document.getElementById('cfg-repo').value = repo;
    document.getElementById('cfg-pat').value = pat;
    document.getElementById('config-modal').classList.remove('hidden');
  });

  // Refresh — hard reload (bypass cache, jak Ctrl+Shift+R)
  document.getElementById('btn-refresh').addEventListener('click', () => location.reload(true));
  document.getElementById('btn-delete-all').addEventListener('click', deleteAll);
  const btnRunBlockingEl = document.getElementById('btn-run-blocking');
  if (btnRunBlockingEl) btnRunBlockingEl.addEventListener('click', markAllReady);

  // Add form
  document.getElementById('btn-add').addEventListener('click', addItem);
  document.getElementById('domain-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addItem();
  });

  // Screenshot upload
  document.getElementById('screenshot-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(',')[1];
      screenshotB64 = base64;
      screenshotExt = file.name.split('.').pop().toLowerCase();
      document.getElementById('preview-img').src = dataUrl;
      document.getElementById('screenshot-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('remove-screenshot').addEventListener('click', clearScreenshot);

  // Load queue if configured
  if (repo && pat) loadAndRender();

  // Auto-refresh every 60s
  setInterval(loadAndRender, 60000);
});
