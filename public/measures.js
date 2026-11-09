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
      const c = T.kids[n.id]; if (c && c.length >= 2) out.branch.push({ key: k(n.id), parent: n.body, kids: c.map(x => x.body) });
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
    const bv = rv('branch_div', br.map(n => k(n.id)));
    m.bdYes = share(bv, 'yes'); m.bdMaybe = share(bv, 'maybe'); m.bdNo = share(bv, 'no'); m.bdCalc = dv('branch', br.map(n => k(n.id)));
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

  const api = { prep, items, metrics, condCat, mean, sd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Measures = api;
})(typeof window !== 'undefined' ? window : globalThis);
