// ============================================================
//  IdeaForest — read-only viewer: pick a condition + participant, see their idea trees,
//  click a node to see its details in a panel on the right. Nothing here can change the data.
// ============================================================
// Raw study_condition values in the database are grouped into two categories; anything else stays as it is.
const CAT_LABEL = { 'ai-only': 'AI only', 'idea-tree': 'Idea Tree' };
const CAT_OF = { 'ai_only': 'ai-only', 'ai-assisted ideation': 'ai-only',
                 'ideaforest_treeonly': 'idea-tree', 'ai-assisted structured ideation': 'idea-tree', 'ideagit': 'idea-tree' };
const catOf = raw => { const k = String(raw || '').trim().toLowerCase(); return k ? (CAT_OF[k] || 'other:' + raw) : 'none'; };
const condLabel = cat => CAT_LABEL[cat] || (cat === 'none' ? '(no condition recorded)' : cat.replace(/^other:/, ''));
let OPTS = [];            // [{condition, participant_id, n}]
let _viewReady = false;
let SRC = 'db';          // 'db' or 'csv'
let CSV_ROWS = [];       // rows read from uploaded CSV file(s), already in the same shape as the database rows
let CSV_RAW = [];        // [{file, rows:[objects]}] as uploaded
let DB_OPTS = [];

window.TREE_STACK = true;
window.TREE_READONLY = true;         // no discard (×) button on nodes
window.TREE_NO_SKELETON = true;      // no grey placeholder nodes: only what the participant actually created
window.TREE_HINT_TEXT = 'Click on any node to see its details';
window.TREE_EMPTY_TEXT = 'This participant has no ideas in this condition.';
window.onTreeNodeClick = function (id) {
  const n = S.nodes.find(x => x.id === id); if (!n) return;
  S.currentNodeId = id; S.currentGroupId = n.groupId;
  renderAllTrees(); openDetails(id); refocusTree();
};

function setSelectError(msg) { const e = document.getElementById('select-error'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }

async function loadOptions() {
  const sel = document.getElementById('sel-condition');
  try {
    const r = await fetch('/api/view/options');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('status ' + r.status));
    OPTS = await r.json(); DB_OPTS = OPTS;
  } catch (e) { sel.innerHTML = '<option value="">Could not load</option>'; setSelectError('Could not load the database: ' + e.message + '. You can still upload a CSV file.'); return; }
  fillConditions();
}
function fillConditions() {
  const sel = document.getElementById('sel-condition'); setSelectError('');
  const order = c => (c in CAT_LABEL ? Object.keys(CAT_LABEL).indexOf(c) : 99);
  const conds = [...new Set(OPTS.map(o => catOf(o.condition)))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  sel.innerHTML = '<option value="">Select a condition…</option>' + conds.map(c => `<option value="${esc(c)}">${esc(condLabel(c))}</option>`).join('');
  if (!conds.length) setSelectError('The dataset is empty.');
}
function onConditionChange() {
  const c = document.getElementById('sel-condition').value, ps = document.getElementById('sel-pid');
  const ids = [...new Set(OPTS.filter(o => catOf(o.condition) === c).map(o => o.participant_id))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  ps.innerHTML = c ? '<option value="">Select a participant…</option>' + ids.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('')
                   : '<option value="">Select a condition first</option>';
  ps.disabled = !c; onPidChange();
}
function onPidChange() {
  document.getElementById('btn-view').disabled = !(document.getElementById('sel-condition').value !== '' && document.getElementById('sel-pid').value);
}

const parseExtras = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch (e) { return []; } };
function toNode(r) {
  const extras = parseExtras(r.extras), cs = extras.find(x => x.type === 'change_summary');
  return { id: String(r.node_id), parentId: r.parent_id ? String(r.parent_id) : null, groupId: String(r.group_id || r.node_id),
    type: r.type || 'creation', tag: r.tag || 'user-created', title: r.title || '', body: r.body || '',
    userPrompt: r.user_prompt || '', aiResponse: r.ai_response || '', extras, isFinalized: r.is_finalized === true,
    ts: Number(r.created_ms) || 0, selfReport: r.self_report_ai_use || '',
    meta: cs ? { changeSummary: cs.summary || '', promptSummary: cs.prompt_summary || '', ideaSummary: cs.idea_summary || '' } : {} };
}

async function submitView() {
  const cond = document.getElementById('sel-condition').value, pid = document.getElementById('sel-pid').value;
  const btn = document.getElementById('btn-view'); btn.disabled = true; btn.textContent = 'Loading…'; setSelectError('');
  try {
    let rows;
    if (SRC === 'csv') rows = CSV_ROWS.filter(x => catOf(x.condition) === cond && x.participant_id === pid);
    else {
      const raws = [...new Set(OPTS.filter(o => catOf(o.condition) === cond && o.participant_id === pid).map(o => o.condition || '__null__'))];
      const r = await fetch('/api/view/nodes?' + raws.map(c => 'condition=' + encodeURIComponent(c)).join('&') + '&participant_id=' + encodeURIComponent(pid));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('status ' + r.status));
      rows = await r.json();
    }
    S.nodes = rows.map(toNode); S.currentNodeId = null; S.currentGroupId = null;
    document.getElementById('v-info').textContent = condLabel(cond) + ' · Participant ' + pid;
    document.getElementById('page-select').style.display = 'none';
    document.getElementById('page-view').style.display = 'block';
    document.body.classList.add('app5');
    closeDetails(false);
    if (!_viewReady) { initTreePanOn('tree-area', 'tree-canvas'); _viewReady = true; }
    renderAllTrees();
  } catch (e) { setSelectError('Could not load this participant: ' + e.message); }
  finally { btn.textContent = 'View idea trees'; onPidChange(); }
}
function backToSelect() {
  closeDetails(false); S.nodes = []; S.currentNodeId = null;
  document.getElementById('page-view').style.display = 'none';
  document.getElementById('page-select').style.display = '';
  document.body.classList.remove('app5');
}

// ── Details panel ──────────────────────────────────────────────
function closeDetails(rerender = true) {
  document.getElementById('v-side').style.display = 'none';
  if (rerender && S.currentNodeId) { S.currentNodeId = null; renderAllTrees(); }
}
function ideaNumber(n) {
  const first = {}; S.nodes.forEach(x => { if (!first[x.groupId] || x.ts < first[x.groupId]) first[x.groupId] = x.ts; });
  return Object.keys(first).sort((a, b) => first[a] - first[b]).indexOf(n.groupId) + 1;
}
function openDetails(id) {
  const n = S.nodes.find(x => x.id === id); if (!n) return;
  const parent = n.parentId && S.nodes.find(x => x.id === n.parentId);
  const discarded = n.extras.some(x => x.type === 'discarded');
  const version = getPath(n.id).length;
  const isManual = n.userPrompt === '[Manual modification]';
  const qa = n.extras.filter(x => x.userPrompt && x.type !== 'change_summary' && x.type !== 'discarded');
  const row = (k, v) => `<div class="v-row"><span>${k}</span><strong>${v}</strong></div>`;
  let h = `<div class="v-badges"><span class="v-badge">${esc(nodeTagLabel(n))}</span>`
        + (n.isFinalized ? '<span class="v-badge v-badge-green">Finalized</span>' : '')
        + (discarded ? '<span class="v-badge v-badge-red">Discarded by participant</span>' : '') + '</div>';
  h += row('Idea', '#' + ideaNumber(n)) + row('Version', version) + row('Created', n.ts ? esc(new Date(n.ts).toLocaleString()) : '—');
  if (n.title) h += `<h4 class="v-h">Title</h4><div class="v-box">${esc(n.title)}</div>`;
  h += `<h4 class="v-h">Idea text${parent ? ' <small>(words changed from the previous version in bold)</small>' : ''}</h4>`
     + `<div class="v-box v-text">${parent ? diffHighlightBody(parent.body, n.body) : esc(n.body)}</div>`;
  if (n.type === 'modification') {
    h += `<h4 class="v-h">How it was edited</h4><div class="v-box">${isManual ? 'Edited by the participant without AI.' : esc(n.userPrompt || '—')}</div>`;
  } else if (n.tag === 'ai-generated' && n.userPrompt) {
    h += `<h4 class="v-h">Prompt used to generate it</h4><div class="v-box">${esc(n.userPrompt)}</div>`;
  }
  nodeNotes(n).forEach(([k, v]) => { if (k === 'Changes' || k === 'Idea') h += `<h4 class="v-h">${k === 'Idea' ? 'Summary' : 'Change summary'}</h4><div class="v-box">${esc(v)}</div>`; });
  if (qa.length) {
    h += '<h4 class="v-h">Questions and AI feedback on this version</h4>' + qa.map(x =>
      `<div class="v-box"><div class="v-q"><b>${x.type === 'feedback' ? 'Asked for feedback' : 'Asked'}:</b> ${esc(x.userPrompt)}</div><div class="v-a"><b>AI:</b> ${esc(x.aiResponse || '')}</div></div>`).join('');
  }
  if (parent) h += `<details class="v-prev"><summary>Previous version</summary><div class="v-box v-text">${esc(parent.body)}</div></details>`;
  if (n.selfReport && n.selfReport.trim()) h += `<h4 class="v-h">Self-report on AI use</h4><div class="v-box">${esc(n.selfReport)}</div>`;
  document.getElementById('v-side-body').innerHTML = h;
  document.getElementById('v-side').style.display = 'flex';
  document.getElementById('v-side-body').scrollTop = 0;
}

// ── Upload a CSV instead of using the database ────────────────
// Same columns as the node exports: participant_id, node_id, group_id, parent_id, type, tag, title, body, is_finalized,
// user_prompt, ai_response, extras (or extras_json), self_report_ai_use, timestamp (or created_at), and optionally
// study_condition (or condition). Without participant_id the file name is used as the participant ID.
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim().replace(/^\uFEFF/, ''));
  return rows.filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}
async function onCsvFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  CSV_RAW = [];
  for (const f of files) CSV_RAW.push({ file: f.name.replace(/\.csv$/i, ''), rows: parseCSV(await f.text()) });
  document.getElementById('csv-input').value = '';
  applyCsv();
}
function applyCsv() {
  const dflt = document.getElementById('sel-csv-cond').value;
  let missing = false; CSV_ROWS = [];
  CSV_RAW.forEach(({ file, rows }) => rows.forEach(o => {
    const cond = (o.study_condition ?? o.condition ?? '').trim(); if (!cond) missing = true;
    const tsv = o.timestamp || o.created_at || '', ms = Date.parse(tsv);
    if (!o.node_id) return;
    CSV_ROWS.push({ participant_id: String(o.participant_id || '').trim() || file, condition: cond || dflt || '',
      node_id: o.node_id, group_id: o.group_id || o.node_id, parent_id: o.parent_id || null, type: o.type, tag: o.tag,
      title: o.title, body: o.body, is_finalized: ['1', 'true', 't', 'yes'].includes(String(o.is_finalized).trim().toLowerCase()),
      user_prompt: o.user_prompt, ai_response: o.ai_response, extras: o.extras_json || o.extras || '[]',
      self_report_ai_use: o.self_report_ai_use, created_ms: Number.isFinite(ms) ? ms : (Number(tsv) || 0) });
  }));
  document.getElementById('csv-cond-row').style.display = missing ? '' : 'none';
  const g = {}; CSV_ROWS.forEach(x => { const k = x.condition + '\u0000' + x.participant_id; g[k] = (g[k] || 0) + 1; });
  OPTS = Object.keys(g).map(k => { const [condition, participant_id] = k.split('\u0000'); return { condition, participant_id, n: g[k] }; });
  SRC = 'csv';
  document.getElementById('src-label').textContent = 'CSV file' + (CSV_RAW.length > 1 ? 's' : '') + ' (' + CSV_ROWS.length + ' nodes)';
  document.getElementById('btn-use-db').style.display = '';
  fillConditions(); onConditionChange();
  if (!CSV_ROWS.length) setSelectError('No usable rows found. The file needs at least a node_id column.');
}
function useDatabase() {
  SRC = 'db'; OPTS = DB_OPTS; CSV_RAW = []; CSV_ROWS = [];
  document.getElementById('src-label').textContent = 'Database'; document.getElementById('btn-use-db').style.display = 'none';
  document.getElementById('csv-cond-row').style.display = 'none';
  fillConditions(); onConditionChange();
}

document.addEventListener('DOMContentLoaded', loadOptions);
