// ============================================================
//  IdeaForest measures — used by the server (rating items, distances) and by the dashboard (results).
//  Works in Node (module.exports) and in the browser (window.Measures).
// ============================================================
(function (root) {
  'use strict';
  const AI = t => t === 'ai-generated' || t === 'ai-modification';
  const pe = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const CAT_OF = { 'ai_only': 'ai-only', 'ai-assisted ideation': 'ai-only',
                   'ideaforest_treeonly': 'idea-tree', 'ai-assisted structured ideation': 'idea-tree', 'ideagit': 'idea-tree' };
  const condCat = raw => { const k = String(raw || '').trim().toLowerCase(); return k ? (CAT_OF[k] || 'other') : 'other'; };
  const mean = a => { a = a.filter(x => x != null && !isNaN(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
  const sd = a => { a = a.filter(x => x != null && !isNaN(x)); if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

  // rows = database rows of ONE participant → tree structure (discarded nodes are left out)
  function prep(rows) {
    const nodes = rows.map(r => ({ id: String(r.node_id), parentId: r.parent_id ? String(r.parent_id) : null, groupId: String(r.group_id || r.node_id),
      tag: r.tag || '', type: r.type || '', body: r.body || '', fin: r.is_finalized === true, ts: Number(r.created_ms) || 0,
      dead: pe(r.extras).some(x => x.type === 'discarded') })).filter(n => !n.dead);
    const by = {}, kids = {};
    nodes.forEach(n => { by[n.id] = n; });
    nodes.forEach(n => { if (n.parentId && !by[n.parentId]) n.parentId = null; });
    nodes.forEach(n => { if (n.parentId) (kids[n.parentId] = kids[n.parentId] || []).push(n); });
    Object.values(kids).forEach(a => a.sort((x, y) => x.ts - y.ts));
    const path = n => { const p = []; for (let c = n; c; c = c.parentId ? by[c.parentId] : null) p.unshift(c); return p; };
    const finGroups = new Set(nodes.filter(n => n.fin).map(n => n.groupId));
    return { nodes, by, kids, path, finGroups };
  }

  // What raters must judge (only trees that contain a finalized idea). key = participant|node
  function items(pid, T) {
    const k = id => pid + '|' + id, out = { quality: [], branch: [], edit: [], final: [] };
    T.nodes.filter(n => n.fin).forEach(n => {
      out.quality.push({ key: k(n.id), text: n.body });
      const p = T.path(n); if (p.length > 1) out.final.push({ key: k(n.id), root: p[0].body, final: n.body });
    });
    T.nodes.forEach(n => {
      if (!T.finGroups.has(n.groupId)) return;
      if (n.parentId) out.edit.push({ key: k(n.id), prev: T.by[n.parentId].body, cur: n.body });
      const c = T.kids[n.id];   // every pair of children of the same parent is rated / measured
      if (c && c.length >= 2) for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++)
        out.branch.push({ key: pid + '|' + c[i].id + '|' + c[j].id, a: c[i].body, b: c[j].body });
    });
    return out;
  }

  const treeDist = (T, a, b) => {
    const pa = T.path(a), pb = T.path(b); let c = 0;
    while (c < pa.length && c < pb.length && pa[c] === pb[c]) c++;
    return (pa.length - c) + (pb.length - c);
  };
  const hasFin = (T, n) => n.fin || (T.kids[n.id] || []).some(c => hasFin(T, c));
  const share = (vals, v) => vals.length ? vals.filter(x => x === v).length / vals.length : null;

  // R: {measure:{key:[values from all raters]}}   D: {'edit|key': distance, ...}   sr: [{round,node_id,answers}]
  function metrics(pid, rows, sr, R, D) {
    const T = prep(rows), k = id => pid + '|' + id, m = {};
    const fin = T.nodes.filter(n => n.fin);
    const rv = (measure, keys) => keys.flatMap(x => (R[measure] && R[measure][x]) || []);
    const dv = (kind, keys) => mean(keys.map(x => D[kind + '|' + x]));
    const qual = (measure, n) => mean(((R[measure] || {})[k(n.id)] || []).map(Number));
    // quality
    m.nIdeas = new Set(T.nodes.map(n => n.groupId)).size; m.nFinal = fin.length;
    m.orig = mean(fin.map(n => qual('originality', n))); m.eff = mean(fin.map(n => qual('effectiveness', n)));
    // exploration
    const br = T.nodes.filter(n => (T.kids[n.id] || []).length >= 2);
    m.branches = br.length; m.magnitude = mean(br.map(n => T.kids[n.id].length));
    const pairKeys = br.filter(n => T.finGroups.has(n.groupId)).flatMap(n => { const c = T.kids[n.id], o = [];
      for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) o.push(pid + '|' + c[i].id + '|' + c[j].id); return o; });
    const bv = rv('branch_div', pairKeys);
    m.bdYes = share(bv, 'yes'); m.bdMaybe = share(bv, 'maybe'); m.bdNo = share(bv, 'no'); m.bdCalc = dv('branch', pairKeys);
    m.bdScore = bv.length ? mean(bv.map(x => x === 'yes' ? 1 : x === 'maybe' ? 0.5 : 0)) : null;   // yes = 1, maybe = 0.5, no = 0
    const sorted = T.nodes.slice().sort((a, b) => a.ts - b.ts), bt = [];
    for (let i = 1; i < sorted.length; i++) {
      const X = sorted[i], M = sorted[i - 1];
      if (X.parentId && X.parentId !== M.id && M.groupId === X.groupId) bt.push(treeDist(T, M, T.by[X.parentId]));
    }
    m.btN = bt.length; m.btMean = mean(bt);
    const sub = br.flatMap(n => T.kids[n.id].map(c => hasFin(T, c)));
    m.finBranch = sub.length ? sub.filter(Boolean).length / sub.length : null;
    // refinement
    m.depth = mean(fin.map(n => T.path(n).length - 1));
    const ed = T.nodes.filter(n => n.parentId && T.finGroups.has(n.groupId)).map(n => k(n.id));
    const ev = rv('edit_sig', ed); m.esYes = share(ev, 'yes'); m.esMaybe = share(ev, 'maybe'); m.esNo = share(ev, 'no'); m.esCalc = dv('edit', ed);
    const fk = fin.filter(n => T.path(n).length > 1).map(n => k(n.id));
    const fv = rv('final_sig', fk); m.fsYes = share(fv, 'yes'); m.fsMaybe = share(fv, 'maybe'); m.fsNo = share(fv, 'no'); m.fsCalc = dv('final', fk);
    m.aiProp = mean(fin.map(n => { const p = T.path(n); return p.filter(x => AI(x.tag)).length / p.length; }));
    // perception (T1 = round 1, T2 = round 2)
    const get = (nid, r) => { const x = sr.find(s => s.node_id === nid && Number(s.round) === r); return x ? x.answers : null; };
    const ideas = fin.map(n => {
      const a1 = get(n.id, 1), a2 = get(n.id, 2), p = T.path(n);
      const prop = (a, key, ai) => { if (!a) return null; const tot = ai ? (a.ai_items != null ? a.ai_items : p.filter(x => AI(x.tag)).length) : (a.total_items != null ? a.total_items : p.length);
        return tot ? (a[key] || []).length / tot : null; };
      const o = { id: n.id, text: n.body, depth: p.length - 1, orig: qual('originality', n), eff: qual('effectiveness', n),
        fsVals: ((R.final_sig || {})[k(n.id)] || []), fsCalc: D['final|' + k(n.id)] != null ? D['final|' + k(n.id)] : null,
        aiProp: p.filter(x => AI(x.tag)).length / p.length };
      [['own', 'own'], ['dep', 'dep'], ['effort', 'effort']].forEach(([key]) => { o[key + '1'] = a1 ? a1[key] : null; o[key + '2'] = a2 ? a2[key] : null; });
      o.ownP1 = prop(a1, 'ownSel', false); o.ownP2 = prop(a2, 'ownSel', false);
      o.noAIP1 = prop(a1, 'noAI', true); o.noAIP2 = prop(a2, 'noAI', true);
      o.skipP1 = prop(a1, 'skip', true); o.skipP2 = prop(a2, 'skip', true);
      return o;
    });
    ['own', 'dep', 'effort', 'ownP', 'noAIP', 'skipP'].forEach(key => {
      m[key + '1'] = mean(ideas.map(i => i[key + '1'])); m[key + '2'] = mean(ideas.map(i => i[key + '2']));
      m[key + 'Delta'] = mean(ideas.map(i => (i[key + '1'] != null && i[key + '2'] != null) ? i[key + '2'] - i[key + '1'] : null));
    });
    ['own', 'dep', 'effort'].forEach(key => {
      const d = ideas.filter(i => i[key + '1'] != null && i[key + '2'] != null).map(i => Math.sign(i[key + '2'] - i[key + '1']));
      m[key + 'Up'] = share(d, 1); m[key + 'Same'] = share(d, 0); m[key + 'Down'] = share(d, -1);
    });
    return { m, ideas };
  }

  // ── CSV export: one row per node; self-report answers sit on the finalized node's row (t1 = first self-report, t2 = repeat) ──
  const cell = v => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const ids = a => JSON.stringify((a || []).map(x => x.id));
  function dataCsv(data) {
    const byP = {}; data.nodes.forEach(r => (byP[r.participant_id] = byP[r.participant_id] || []).push(r));
    const sr = {}; data.selfreports.forEach(x => { sr[x.participant_id + '|' + x.node_id + '|' + x.round] = x.answers || {}; });
    const head = ['participant_id', 'condition', 'condition_group', 'idea_number', 'node_id', 'group_id', 'parent_id', 'depth', 'n_children', 'type', 'tag', 'is_ai_node',
      'is_finalized', 'is_discarded', 'on_finalized_path', 'created_at', 'created_ms', 'title', 'body', 'user_prompt', 'ai_response', 'influenced_by'];
    ['t1', 't2'].forEach(t => head.push(t + '_ownership', t + '_ai_reliance', t + '_effort', t + '_ownership_nodes', t + '_without_ai_nodes', t + '_skip_nodes', t + '_total_items', t + '_ai_items'));
    head.push('t2_changed_questions');
    const out = [head.join(',')];
    Object.keys(byP).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(pid => {
      const rows = byP[pid], by = {}, kids = {};
      rows.forEach(r => { by[String(r.node_id)] = r; });
      rows.forEach(r => { const p = r.parent_id && by[String(r.parent_id)] ? String(r.parent_id) : null; if (p) kids[p] = (kids[p] || 0) + 1; });
      const depth = r => { let d = 0, c = r; while (c && c.parent_id && by[String(c.parent_id)] && d < 500) { c = by[String(c.parent_id)]; d++; } return d; };
      const onFin = new Set(); rows.filter(r => r.is_finalized === true).forEach(r => { let c = r, g = 0; while (c && g++ < 500) { onFin.add(String(c.node_id)); c = c.parent_id ? by[String(c.parent_id)] : null; } });
      const groups = []; rows.forEach(r => { const g = String(r.group_id || r.node_id); if (!groups.includes(g)) groups.push(g); });
      const cat = { 'ai-only': 'AI-only', 'idea-tree': 'IdeaTree', other: 'Other' }[condCat(rows[0].study_condition)];
      rows.forEach(r => {
        const id = String(r.node_id), ex = pe(r.extras), ms = Number(r.created_ms) || 0;
        const line = [pid, r.study_condition, cat, groups.indexOf(String(r.group_id || r.node_id)) + 1, id, r.group_id, r.parent_id, depth(r), kids[id] || 0, r.type, r.tag,
          AI(r.tag) ? 1 : 0, r.is_finalized === true ? 1 : 0, ex.some(x => x.type === 'discarded') ? 1 : 0, onFin.has(id) ? 1 : 0,
          ms ? new Date(ms).toISOString() : '', ms || '', r.title, r.body, r.user_prompt, r.ai_response, r.influenced_by ? JSON.stringify(pe(r.influenced_by)) : ''];
        ['1', '2'].forEach(t => { const a = sr[pid + '|' + id + '|' + t];
          line.push(a ? a.own : '', a ? a.dep : '', a ? a.effort : '', a ? ids(a.ownSel) : '', a ? ids(a.noAI) : '', a ? ids(a.skip) : '', a ? a.total_items : '', a ? a.ai_items : ''); });
        const a2 = sr[pid + '|' + id + '|2']; line.push(a2 && a2.changed_questions ? JSON.stringify(a2.changed_questions) : '');
        out.push(line.map(cell).join(','));
      });
    });
    return out.join('\n');
  }

  // Ratings: one row per rater x item. For pairs (branch divergence) node_id / node_id_b are the two child versions.
  function ratingsCsv(data) {
    const sel = new Set(data.selected), cond = {};
    data.nodes.forEach(r => { cond[r.participant_id] = r.study_condition; });
    const D = {}; data.distances.forEach(x => { D[x.kind + '|' + x.item_key] = x.distance; });
    const kind = { edit_sig: 'edit', final_sig: 'final', branch_div: 'branch' };
    const score = (m, v) => (m === 'originality' || m === 'effectiveness') ? Number(v) : v === 'yes' ? 1 : v === 'maybe' ? 0.5 : 0;
    const out = [['rater', 'measure', 'participant_id', 'condition', 'condition_group', 'node_id', 'node_id_b', 'rating', 'score', 'calculated_cosine_distance'].join(',')];
    data.ratings.slice().sort((a, b) => a.rater.localeCompare(b.rater) || a.measure.localeCompare(b.measure) || a.item_key.localeCompare(b.item_key)).forEach(r => {
      const parts = r.item_key.split('|'), pid = parts[0]; if (!sel.has(pid)) return;
      const cat = { 'ai-only': 'AI-only', 'idea-tree': 'IdeaTree', other: 'Other' }[condCat(cond[pid])];
      const d = kind[r.measure] ? D[kind[r.measure] + '|' + r.item_key] : '';
      out.push([r.rater, r.measure, pid, cond[pid], cat, parts[1], parts[2] || '', r.value, score(r.measure, r.value), d == null ? '' : d].map(cell).join(','));
    });
    return out.join('\n');
  }

  const api = { prep, items, metrics, condCat, mean, sd, dataCsv, ratingsCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Measures = api;
})(typeof window !== 'undefined' ? window : globalThis);
