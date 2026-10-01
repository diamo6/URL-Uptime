/**
 * Website Uptime Monitor — frontend SPA (vanilla JS, no build step).
 * Routes:  #/            dashboard
 *          #/w/:id       website detail
 */

/* ---------------- utilities ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty body */ }
  if (!res.ok) {
    const msg = data?.details?.message || data?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtResponse(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function fmtUptime(v) {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? 's' : ''} ago`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function statusPill(status) {
  return `<span class="status status-${esc(status)}">${esc(status)}</span>`;
}

function httpBadge(site) {
  if (site.http_status) {
    const code = site.http_status;
    const cls = code < 400 ? 'badge-ok' : code < 500 ? 'badge-warn' : 'badge-down';
    return `<span class="badge ${cls}">${code}</span>`;
  }
  if (site.status === 'UNKNOWN') return '<span class="badge badge-none">—</span>';
  const err = site.last_error || '';
  if (/timed out/i.test(err)) return '<span class="badge badge-down">TIMEOUT</span>';
  return '<span class="badge badge-down">ERR</span>';
}

const SEVERITY = { DOWN: 0, WARNING: 1, UNKNOWN: 2, UP: 3 };

// Sortable columns: default direction chosen for operational reading
// (status → DOWN first, response → slowest first, uptime → worst first, last → stalest first).
const DEFAULT_DIR = { status: 'asc', name: 'asc', http: 'asc', response: 'desc', uptime: 'asc', last: 'asc' };
const SORTERS = {
  status: (a, b) => (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9) || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  http: (a, b) => (a.http_status ?? -1) - (b.http_status ?? -1),
  response: (a, b) => (a.response_time_ms ?? -1) - (b.response_time_ms ?? -1),
  uptime: (a, b) => (a.uptime_24h ?? -1) - (b.uptime_24h ?? -1),
  last: (a, b) => String(a.last_checked_at ?? '').localeCompare(String(b.last_checked_at ?? '')),
};

function sortWebsites(list) {
  const { key, dir } = state.sort;
  const mul = dir === 'asc' ? 1 : -1;
  const cmp = SORTERS[key] ?? SORTERS.status;
  return [...list].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1; // disabled always last
    return cmp(a, b) * mul;
  });
}

function sortTh(key, label) {
  const active = state.sort.key === key;
  const arrow = active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
  const aria = active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th data-sort="${key}" class="sortable${active ? ' active' : ''}" aria-sort="${aria}" title="Click to sort by ${label}">${label}<span class="sort-ind">${arrow}</span></th>`;
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 3000);
}

/* ---------------- state ---------------- */

const state = {
  websites: [],
  summary: null,
  incidents: [],
  refreshTimer: null,
  window: '24h',
  currentSite: null, // website currently shown on the detail page
  sort: { key: 'status', dir: 'asc' }, // table sort (default: DOWN first)
};

async function loadOverview() {
  const [w, inc] = await Promise.all([
    api('/api/websites'),
    api('/api/incidents?limit=15'),
  ]);
  state.websites = w.websites;
  state.incidents = inc.incidents;
  state.summary = state.websites.reduce(
    (acc, site) => {
      acc.total += 1;
      if (site.enabled) acc.enabled += 1;
      const key = site.status.toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    { total: 0, enabled: 0, up: 0, warning: 0, down: 0, unknown: 0 }
  );
}

/* ---------------- dashboard view ---------------- */

function summaryHtml() {
  const s = state.summary;
  return `
    <section class="summary" aria-label="Summary">
      <div class="stat"><div class="stat-label">Total</div><div class="stat-value">${s.total}</div></div>
      <div class="stat is-up"><div class="stat-label">${statusPill('UP')}</div><div class="stat-value">${s.up}</div></div>
      <div class="stat is-warning"><div class="stat-label">${statusPill('WARNING')}</div><div class="stat-value">${s.warning}</div></div>
      <div class="stat is-down"><div class="stat-label">${statusPill('DOWN')}</div><div class="stat-value">${s.down}</div></div>
      <div class="stat is-unknown"><div class="stat-label">${statusPill('UNKNOWN')}</div><div class="stat-value">${s.unknown}</div></div>
    </section>`;
}

function websiteRow(site) {
  const checkLabel = site.enabled
    ? `<span class="nowrap">${timeAgo(site.last_checked_at)}</span>`
    : '<span class="muted">disabled</span>';
  return `
    <tr class="row-${esc(site.status)}" data-id="${site.id}">
      <td>
        <div class="site-cell">
          <span class="site-name">${esc(site.name)}</span>
          <a class="site-url" href="${esc(site.url)}" target="_blank" rel="noreferrer">${esc(site.url)}</a>
        </div>
      </td>
      <td>${statusPill(site.status)}</td>
      <td>${httpBadge(site)}</td>
      <td class="nowrap">${fmtResponse(site.response_time_ms)}</td>
      <td class="nowrap">${fmtUptime(site.uptime_24h)}</td>
      <td class="nowrap small muted">${checkLabel}</td>
      <td>
        <div class="actions">
          <a class="btn btn-xs" href="#/w/${site.id}">View</a>
          <button class="btn btn-xs" data-action="check" ${site.enabled ? '' : 'disabled'}>Check Now</button>
          <button class="btn btn-xs" data-action="edit">Edit</button>
          <button class="btn btn-xs" data-action="toggle">${site.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-xs btn-danger" data-action="delete">Delete</button>
        </div>
      </td>
    </tr>`;
}

function websitesPanelHtml() {
  if (state.websites.length === 0) {
    return `
      <div class="panel">
        <div class="empty">
          <p><strong>No websites yet.</strong></p>
          <p>Paste one or many URLs to start monitoring — e.g. copy 3 URLs and paste them all at once.</p>
          <button class="btn btn-primary" id="btn-add-empty">+ Add Website</button>
        </div>
      </div>`;
  }
  const rows = sortWebsites(state.websites).map(websiteRow).join('');
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>Websites (${state.websites.length})</h2>
        <span class="muted small">click a column header to sort</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${sortTh('name', 'Website')}
              ${sortTh('status', 'Status')}
              ${sortTh('http', 'HTTP')}
              ${sortTh('response', 'Response')}
              ${sortTh('uptime', 'Uptime 24h')}
              ${sortTh('last', 'Last Check')}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function incidentsPanelHtml() {
  const items = state.incidents;
  const body = items.length === 0
    ? '<div class="empty"><p><strong>No incidents.</strong> Nothing has gone wrong yet.</p></div>'
    : `<div class="table-wrap"><table>
        <thead><tr><th>Website</th><th>Status</th><th>Started</th><th>Duration</th><th>Detail</th></tr></thead>
        <tbody>${items.map((inc) => `
          <tr>
            <td><a href="#/w/${inc.website_id}">${esc(inc.website?.name ?? '#' + inc.website_id)}</a></td>
            <td>${statusPill(inc.status)}</td>
            <td class="nowrap small">${fmtDateTime(inc.started_at)}</td>
            <td class="nowrap small">${inc.resolved ? fmtDuration(inc.downtime_seconds) : '<span class="badge badge-down">ONGOING</span>'}</td>
            <td class="small muted">${esc(inc.message ?? '')}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
  return `
    <div class="panel">
      <div class="panel-head"><h2>Incident History</h2><span class="muted small">latest ${items.length}</span></div>
      ${body}
    </div>`;
}

async function renderDashboard() {
  const view = $('#view');
  state.currentSite = null;
  view.innerHTML = summaryHtml() + websitesPanelHtml() + incidentsPanelHtml();
  $('#last-refresh').textContent = `updated ${new Date().toLocaleTimeString()}`;
}

/* ---------------- detail view ---------------- */

function chartSvg(series) {
  const W = 600;
  const H = 170;
  const points = series.filter((p) => p.ms !== null && p.ms !== undefined);
  if (points.length < 2) {
    return `<div class="empty"><p>Not enough data for a chart yet — checks run every 5 minutes.</p></div>`;
  }
  const max = Math.max(...points.map((p) => p.ms), 100);
  const x = (i) => (i / (series.length - 1)) * (W - 40) + 30;
  const y = (ms) => H - 24 - (ms / max) * (H - 44);

  // Build polylines, breaking at gaps (null response / DOWN without time).
  const segments = [];
  let current = [];
  series.forEach((p, i) => {
    if (p.ms === null || p.ms === undefined) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(`${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`);
    }
  });
  if (current.length > 1) segments.push(current);

  const downMarks = series
    .map((p, i) => (p.status === 'DOWN' ? `<circle cx="${x(i).toFixed(1)}" cy="${H - 24}" r="3" fill="var(--down)"/>` : ''))
    .join('');

  const lines = segments
    .map((pts) => `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linejoin="round"/>`)
    .join('');

  const start = new Date(series[0].t);
  const end = new Date(series[series.length - 1].t);
  const label = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Response time chart">
      <line x1="30" y1="${H - 24}" x2="${W - 10}" y2="${H - 24}" stroke="var(--border)"/>
      <line x1="30" y1="12" x2="30" y2="${H - 24}" stroke="var(--border)"/>
      <text x="26" y="16" text-anchor="end" font-size="10" fill="var(--muted)">${max >= 1000 ? (max / 1000).toFixed(1) + 's' : max + 'ms'}</text>
      <text x="26" y="${H - 24}" text-anchor="end" font-size="10" fill="var(--muted)">0</text>
      ${lines}
      ${downMarks}
    </svg>
    <div class="chart-legend"><span>${label(start)}</span><span>response time · red = DOWN</span><span>${label(end)}</span></div>`;
}

async function renderDetail(id) {
  const view = $('#view');
  try {
    const data = await api(`/api/websites/${id}?window=${state.window}`);
    const site = data.website;
    state.currentSite = site;
    const r = data.response;
    const uptime = data.uptime;
    const tab = (key, label) =>
      `<button class="tab ${state.window === key ? 'active' : ''}" data-window="${key}">${label}</button>`;

    const checkRows = data.recentChecks.map((c) => `
      <tr>
        <td class="nowrap small">${fmtDateTime(c.checked_at)}</td>
        <td>${statusPill(c.status)}</td>
        <td>${c.http_status ? `<span class="badge ${c.http_status < 400 ? 'badge-ok' : c.http_status < 500 ? 'badge-warn' : 'badge-down'}">${c.http_status}</span>` : `<span class="badge badge-down">${/timed out/i.test(c.error_message || '') ? 'TIMEOUT' : 'ERR'}</span>`}</td>
        <td class="nowrap">${fmtResponse(c.response_time_ms)}</td>
        <td class="small muted">${esc(c.error_message || '—')}</td>
        <td class="small muted">${esc(c.checked_by)}</td>
      </tr>`).join('');

    const incidentRows = data.incidents.map((inc) => `
      <tr>
        <td>${statusPill(inc.status)}</td>
        <td class="nowrap small">${fmtDateTime(inc.started_at)}</td>
        <td class="nowrap small">${inc.resolved ? fmtDateTime(inc.ended_at) : '<span class="badge badge-down">ONGOING</span>'}</td>
        <td class="nowrap small">${inc.resolved ? fmtDuration(inc.downtime_seconds) : '—'}</td>
        <td class="small muted">${esc(inc.message)}</td>
      </tr>`).join('');

    view.innerHTML = `
      <div class="detail-head">
        <div>
          <a href="#/" class="small">← Back to dashboard</a>
          <h1>${esc(site.name)} ${statusPill(site.status)}</h1>
          <a class="detail-url" href="${esc(site.url)}" target="_blank" rel="noreferrer">${esc(site.url)}</a>
          ${site.enabled ? '' : '<span class="badge badge-none" style="margin-left:8px">DISABLED</span>'}
        </div>
        <div class="actions">
          <button class="btn" data-action="check">Check Now</button>
          <button class="btn" data-action="edit">Edit</button>
          <button class="btn" data-action="toggle">${site.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger" data-action="delete">Delete</button>
        </div>
      </div>

      <section class="kpis">
        <div class="stat"><div class="stat-label">Status</div><div class="stat-value">${statusPill(site.status)}</div></div>
        <div class="stat"><div class="stat-label">HTTP Status</div><div class="stat-value">${site.http_status ?? '—'}</div></div>
        <div class="stat"><div class="stat-label">Response Time</div><div class="stat-value">${fmtResponse(site.response_time_ms)}</div></div>
        <div class="stat"><div class="stat-label">Last Check</div><div class="stat-value" style="font-size:15px">${timeAgo(site.last_checked_at)}</div></div>
      </section>

      <div class="panel">
        <div class="panel-head">
          <h2>Uptime</h2>
          <div class="uptime-tabs">${tab('24h', '24H')}${tab('7d', '7D')}${tab('30d', '30D')}</div>
        </div>
        <div class="panel-body">
          <div class="kpis" style="margin-bottom:6px">
            <div class="stat is-up"><div class="stat-label">Uptime ${state.window.toUpperCase()}</div><div class="stat-value">${fmtUptime(uptime[state.window])}</div></div>
            <div class="stat"><div class="stat-label">Current</div><div class="stat-value">${fmtResponse(r.current)}</div></div>
            <div class="stat"><div class="stat-label">Average</div><div class="stat-value">${fmtResponse(r.avg)}</div></div>
            <div class="stat"><div class="stat-label">Minimum</div><div class="stat-value">${fmtResponse(r.min)}</div></div>
            <div class="stat"><div class="stat-label">Maximum</div><div class="stat-value">${fmtResponse(r.max)}</div></div>
          </div>
          <div class="panel-head" style="border:none;padding:12px 0 4px"><h2>Response Time</h2></div>
          ${chartSvg(data.series)}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Recent Checks</h2><span class="muted small">latest ${data.recentChecks.length}</span></div>
        ${checkRows ? `<div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Status</th><th>HTTP</th><th>Response</th><th>Error</th><th>Source</th></tr></thead>
          <tbody>${checkRows}</tbody></table></div>` : '<div class="empty"><p>No checks recorded yet.</p></div>'}
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Incidents</h2></div>
        ${incidentRows ? `<div class="table-wrap"><table>
          <thead><tr><th>Status</th><th>Started</th><th>Ended</th><th>Downtime</th><th>Detail</th></tr></thead>
          <tbody>${incidentRows}</tbody></table></div>` : '<div class="empty"><p>No incidents for this website.</p></div>'}
      </div>`;

    $('#last-refresh').textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    view.innerHTML = `<div class="panel"><div class="empty"><p><strong>${esc(err.message)}</strong></p><p><a href="#/">← Back to dashboard</a></p></div></div>`;
  }
}

/* ---------------- routing & refresh ---------------- */

async function refresh() {
  try {
    const hash = location.hash || '#/';
    if (hash.startsWith('#/w/')) {
      await renderDetail(hash.slice(4));
    } else {
      await loadOverview();
      await renderDashboard();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function route() {
  clearInterval(state.refreshTimer);
  refresh();
  state.refreshTimer = setInterval(refresh, 30_000);
}

window.addEventListener('hashchange', route);

/* ---------------- add / edit / delete ---------------- */

const modalAdd = $('#modal-add');
const modalEdit = $('#modal-edit');
const modalConfirm = $('#modal-confirm');

$('#btn-add').addEventListener('click', () => {
  $('#add-result').hidden = true;
  $('#form-add').reset();
  modalAdd.showModal();
});

$('#form-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const urlsText = $('#add-urls').value;
  const name = $('#add-name').value.trim();
  const enabled = $('#add-enabled').checked;
  if (!urlsText.trim()) {
    showAddResult({ error: 'URL is required.' });
    return;
  }
  try {
    const data = await api('/api/websites', {
      method: 'POST',
      body: JSON.stringify({ urlsText, name: name || undefined, enabled }),
    });
    if (data.added && data.added.length > 0 && (data.invalid.length || data.duplicates.length)) {
      showAddResult(data); // partial success — keep open, show details
      await refresh();
      return;
    }
    modalAdd.close();
    toast(`Added ${data.added.length} website${data.added.length > 1 ? 's' : ''}`);
    await refresh();
  } catch (err) {
    showAddResult(err.data ?? { error: err.message });
  }
});

function showAddResult(data) {
  const box = $('#add-result');
  box.hidden = false;
  const parts = [];
  if (data.added?.length) parts.push(`<div class="ok">✓ Added ${data.added.length}: ${data.added.map((w) => esc(w.url)).join(', ')}</div>`);
  if (data.invalid?.length) {
    parts.push(`<div class="bad">✗ Invalid URL — Please enter a valid HTTP or HTTPS URL:<ul>${data.invalid.map((i) => `<li>${esc(i.input)} — ${esc(i.error)}</li>`).join('')}</ul></div>`);
  }
  if (data.duplicates?.length) {
    parts.push(`<div class="warn">↷ Duplicates skipped:<ul>${data.duplicates.map((d) => `<li>${esc(d.input)} — ${esc(d.reason)}</li>`).join('')}</ul></div>`);
  }
  if (data.error) parts.unshift(`<div class="bad">✗ ${esc(data.error)}</div>`);
  box.innerHTML = parts.join('');
}

$('#form-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#edit-id').value;
  const errBox = $('#edit-error');
  errBox.hidden = true;
  try {
    await api(`/api/websites/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#edit-name').value,
        url: $('#edit-url').value,
        enabled: $('#edit-enabled').checked,
      }),
    });
    modalEdit.close();
    toast('Website updated');
    await refresh();
  } catch (err) {
    errBox.hidden = false;
    errBox.textContent = err.message;
  }
});

let pendingDeleteId = null;

$('#btn-confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await api(`/api/websites/${pendingDeleteId}`, { method: 'DELETE' });
    toast('Website deleted');
    modalConfirm.close();
    pendingDeleteId = null;
    if (location.hash.startsWith('#/w/')) location.hash = '#/';
    else await refresh();
  } catch (err) {
    toast(err.message, true);
  }
});

function openEdit(site) {
  $('#edit-id').value = site.id;
  $('#edit-name').value = site.name;
  $('#edit-url').value = site.url;
  $('#edit-enabled').checked = site.enabled;
  $('#edit-error').hidden = true;
  modalEdit.showModal();
}

function openDelete(site) {
  pendingDeleteId = site.id;
  $('#confirm-text').textContent = `Delete "${site.name}" (${site.url})? Its check history and incidents will be removed.`;
  modalConfirm.showModal();
}

async function checkNow(site) {
  toast(`Checking ${site.name}…`);
  try {
    const data = await api(`/api/websites/${site.id}/check`, { method: 'POST' });
    const r = data.result;
    const t = data.transition ? ` · ${data.transition.from} → ${data.transition.to}` : '';
    toast(`${site.name}: ${r.status} · HTTP ${r.http_status ?? '—'} · ${fmtResponse(r.response_time_ms)}${t}`, r.status === 'DOWN');
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleEnabled(site) {
  try {
    await api(`/api/websites/${site.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !site.enabled }),
    });
    toast(site.enabled ? `Disabled ${site.name}` : `Enabled ${site.name}`);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- global click delegation ---------------- */

document.addEventListener('click', (e) => {
  // Close buttons
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) {
    closeBtn.closest('dialog')?.close();
    return;
  }

  if (e.target.id === 'btn-add-empty') {
    $('#form-add').reset();
    $('#add-result').hidden = true;
    modalAdd.showModal();
    return;
  }

  if (e.target.id === 'btn-refresh') {
    refresh();
    return;
  }

  // Uptime window tabs
  const tab = e.target.closest('[data-window]');
  if (tab) {
    state.window = tab.dataset.window;
    refresh();
    return;
  }

  // Sortable column headers
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const key = th.dataset.sort;
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = { key, dir: DEFAULT_DIR[key] ?? 'asc' };
    }
    renderDashboard();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  // Rows carry data-id on the dashboard; the detail page uses state.currentSite.
  const row = btn.closest('[data-id]');
  const id = row ? Number(row.dataset.id) : state.currentSite?.id;
  if (!id) return;
  const site = state.websites.find((w) => w.id === id) ?? (state.currentSite?.id === id ? state.currentSite : null);
  if (!site) return;

  switch (btn.dataset.action) {
    case 'check': checkNow(site); break;
    case 'edit': openEdit(site); break;
    case 'toggle': toggleEnabled(site); break;
    case 'delete': openDelete(site); break;
  }
});

// Close dialog when clicking backdrop
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

/* ---------------- boot ---------------- */

(async function boot() {
  try {
    const health = await api('/api/health');
    if (health.check_interval_ms) {
      $('#interval-label').textContent = `${Math.round(health.check_interval_ms / 60000)} minutes`;
    }
    if (!health.worker.active) {
      toast('Worker not running — automatic checks are paused. Start it with: npm run worker', true);
    }
  } catch { /* health is informational */ }
  route();
})();
