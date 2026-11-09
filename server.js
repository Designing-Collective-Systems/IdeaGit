// ============================================================
//  IdeaGit — Express Server
//  Serves the frontend and proxies Claude API calls.
//  The API key lives only in Heroku's environment variables.
// ============================================================

const express = require('express');
const path    = require('path');
const { initDb, saveNodes, saveSelfReports, dbConfigured, listParticipants, getParticipantNodes, getSelfReports,
        getSelection, setSelection, getNodesFor, getSelfReportsFor, listRaters, touchRater, getRatings, saveRating, getDistances, saveDistances } = require('./db');
const Measures = require('./public/measures.js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Idea snapshots include AI responses, so allow larger bodies than Express's 100kb default
app.use(express.json({ limit: '5mb' }));

// Serve static assets (CSS, JS etc) but suppress automatic index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Proxy endpoint ────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'Anthropic API error' });
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── Save ideas + self-reports to Postgres ─────────────────────
app.post('/api/save-selfreport', async (req, res) => {
  if (!dbConfigured()) return res.status(503).json({ error: 'Database is not configured.' });
  const { participant_id, condition, round, reports } = req.body || {};
  if (typeof participant_id !== 'string' || !participant_id.trim() || participant_id.length > 100)
    return res.status(400).json({ error: 'participant_id is required.' });
  if (![1, 2].includes(round) || !Array.isArray(reports) || !reports.length || reports.length > 200
      || reports.some(r => !r || typeof r.node_id !== 'string' || !r.node_id))
    return res.status(400).json({ error: 'Invalid self-report payload.' });
  try {
    await saveSelfReports(participant_id.trim(), condition, round, reports);
    res.json({ ok: true });
  } catch (err) { console.error('Database error:', err); res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/save-nodes', async (req, res) => {
  if (!dbConfigured()) {
    return res.status(503).json({ error: 'Database is not configured (DATABASE_URL is missing).' });
  }
  const { participant_id, condition, nodes } = req.body || {};
  if (typeof participant_id !== 'string' || !participant_id.trim() || participant_id.length > 100) {
    return res.status(400).json({ error: 'participant_id is required (max 100 characters).' });
  }
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 500) {
    return res.status(400).json({ error: 'nodes must be a non-empty array (max 500).' });
  }
  if (nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id)) {
    return res.status(400).json({ error: 'Every node needs a node_id.' });
  }
  try {
    await saveNodes(participant_id.trim(), condition, nodes);
    res.json({ ok: true, saved: nodes.length });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Root redirects straight to the Idea Tree version
app.get('/', (req, res) => {
  res.redirect('/idea-tree');
});

// The two study versions
app.get('/ai-only', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'ai-only.html')); });
app.get('/idea-tree', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'idea-tree.html')); });
// Legacy routes
app.get('/app', (req, res) => { res.redirect('/idea-tree'); });
app.get('/app3', (req, res) => { res.redirect('/ai-only'); });
app.get('/app5', (req, res) => { res.redirect('/idea-tree'); });

// ── Read-only viewer (/view) ──────────────────────────────────
// Set VIEW_PASSWORD in the environment to protect it with a browser login prompt (any user name, that password).
// Without it, anyone who knows the URL can read participants' ideas.
function viewAuth(req, res, next) {
  const pw = process.env.VIEW_PASSWORD;
  if (!pw) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const dec = Buffer.from(h.slice(6), 'base64').toString();
    if (dec.slice(dec.indexOf(':') + 1) === pw) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="IdeaForest view"').status(401).send('Authentication required');
}
app.get('/view', viewAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'view.html')); });
app.get('/api/view/options', viewAuth, async (req, res) => {
  if (!dbConfigured()) return res.status(503).json({ error: 'Database is not configured (DATABASE_URL is missing).' });
  try { res.json(await listParticipants()); }
  catch (err) { console.error('View options error:', err); res.status(500).json({ error: 'Database error' }); }
});
app.get('/api/view/nodes', viewAuth, async (req, res) => {
  if (!dbConfigured()) return res.status(503).json({ error: 'Database is not configured (DATABASE_URL is missing).' });
  const { participant_id } = req.query;
  if (typeof participant_id !== 'string' || !participant_id) return res.status(400).json({ error: 'participant_id is required.' });
  // one or more raw condition values (several raw names can belong to the same category); '__null__' = none recorded
  const raw = [].concat(req.query.condition || []).map(String);
  const conds = (raw.length ? raw : ['__null__']).map(c => (c === '__null__' ? null : c));
  try { res.json(await getParticipantNodes(conds, participant_id)); }
  catch (err) { console.error('View nodes error:', err); res.status(500).json({ error: 'Database error' }); }
});
app.get('/api/view/selfreports', viewAuth, async (req, res) => {
  if (!dbConfigured()) return res.status(503).json({ error: 'Database is not configured.' });
  const { participant_id } = req.query;
  if (typeof participant_id !== 'string' || !participant_id) return res.status(400).json({ error: 'participant_id is required.' });
  try { res.json(await getSelfReports(participant_id)); }
  catch (err) { console.error('View self-reports error:', err); res.status(500).json({ error: 'Database error' }); }
});

// ── Admin (select participants, dashboard) and raters ─────────────────────────
// Admin pages are protected with ADMIN_PASSWORD (falls back to VIEW_PASSWORD). Raters need no password: they only type a name.
function adminAuth(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD || process.env.VIEW_PASSWORD;
  if (!pw) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) { const dec = Buffer.from(h.slice(6), 'base64').toString(); if (dec.slice(dec.indexOf(':') + 1) === pw) return next(); }
  res.set('WWW-Authenticate', 'Basic realm="IdeaForest admin"').status(401).send('Authentication required');
}
const needDb = (req, res, next) => dbConfigured() ? next() : res.status(503).json({ error: 'Database is not configured.' });
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (err) { console.error(err); res.status(500).json({ error: 'Database error' }); } };
const groupBy = (rows, key) => rows.reduce((o, r) => ((o[r[key]] = o[r[key]] || []).push(r), o), {});

app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/rate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rate.html')));

app.get('/api/admin/participants', adminAuth, needDb, wrap(async (req, res) => {
  res.json({ participants: await listParticipants(), selected: await getSelection() });
}));
app.post('/api/admin/selection', adminAuth, needDb, wrap(async (req, res) => {
  const p = (req.body || {}).participant_ids;
  if (!Array.isArray(p) || p.length > 1000 || p.some(x => typeof x !== 'string')) return res.status(400).json({ error: 'participant_ids must be a list of strings.' });
  await setSelection(p); res.json({ ok: true });
}));
app.get('/api/admin/data', adminAuth, needDb, wrap(async (req, res) => {
  const selected = await getSelection();
  res.json({ selected, nodes: await getNodesFor(selected), selfreports: await getSelfReportsFor(selected), ratings: await getRatings(), distances: await getDistances() });
}));

// Semantic distance = cosine distance between sentence embeddings (Sentence-BERT all-MiniLM-L6-v2, runs on the server).
let _emb = null;
async function embed(texts) {
  if (!_emb) { const { pipeline, env } = await import('@xenova/transformers'); env.cacheDir = '/tmp/hf'; _emb = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); }
  const out = [];
  for (const t of texts) out.push(Array.from((await _emb(String(t).slice(0, 4000), { pooling: 'mean', normalize: true })).data));
  return out;
}
const cosDist = (a, b) => 1 - a.reduce((s, x, i) => s + x * b[i], 0);
app.post('/api/admin/compute-distances', adminAuth, needDb, wrap(async (req, res) => {
  const selected = await getSelection(), by = groupBy(await getNodesFor(selected), 'participant_id'), jobs = [];
  for (const pid of Object.keys(by)) {
    const it = Measures.items(pid, Measures.prep(by[pid]));
    it.edit.forEach(i => jobs.push({ kind: 'edit', key: i.key, texts: [i.prev, i.cur] }));
    it.final.forEach(i => jobs.push({ kind: 'final', key: i.key, texts: [i.root, i.final] }));
    it.branch.forEach(i => jobs.push({ kind: 'branch', key: i.key, texts: i.kids }));
  }
  const uniq = [...new Set(jobs.flatMap(j => j.texts))], vec = {};
  (await embed(uniq)).forEach((v, i) => { vec[uniq[i]] = v; });
  const rows = jobs.map(j => {
    const v = j.texts.map(t => vec[t]), d = [];
    for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) d.push(cosDist(v[a], v[b]));
    return { kind: j.kind, key: j.key, distance: d.reduce((s, x) => s + x, 0) / d.length };
  });
  await saveDistances(rows); res.json({ ok: true, computed: rows.length });
}));

// Rater side: items come only from the participants the admin selected, with no participant or condition shown.
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
app.get('/api/rate/raters', needDb, wrap(async (req, res) => res.json(await listRaters())));
app.post('/api/rate/login', needDb, wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  await touchRater(name); res.json({ name });
}));
const crypto = require('crypto');
const opaque = k => crypto.createHash('sha256').update((process.env.ADMIN_PASSWORD || 'ideaforest') + k).digest('hex').slice(0, 16);
async function buildAllItems() {
  const selected = await getSelection(), by = groupBy(await getNodesFor(selected), 'participant_id'), all = [];
  for (const pid of Object.keys(by)) {
    const it = Measures.items(pid, Measures.prep(by[pid]));
    it.quality.forEach(i => all.push({ measure: 'quality', ...i })); it.branch.forEach(i => all.push({ measure: 'branch_div', ...i }));
    it.edit.forEach(i => all.push({ measure: 'edit_sig', ...i })); it.final.forEach(i => all.push({ measure: 'final_sig', ...i }));
  }
  return all;
}
app.get('/api/rate/items', needDb, wrap(async (req, res) => {
  const rater = String(req.query.rater || '').trim(); if (!rater) return res.status(400).json({ error: 'rater is required.' });
  const all = await buildAllItems(), stage = ['quality', 'branch_div', 'edit_sig', 'final_sig'];
  all.sort((a, b) => stage.indexOf(a.measure) - stage.indexOf(b.measure) || hash(rater + a.key) - hash(rater + b.key));
  const mine = await getRatings(rater), ratings = {};
  const idOf = {}; all.forEach(i => { idOf[i.key] = opaque(i.key); });
  mine.forEach(r => { if (idOf[r.item_key]) ratings[r.measure + '::' + idOf[r.item_key]] = r.value; });
  // raters only get an opaque id per item: no participant id and no condition
  res.json({ items: all.map(({ key, ...rest }) => ({ ...rest, id: opaque(key) })), ratings });
}));
app.post('/api/rate/save', needDb, wrap(async (req, res) => {
  const { rater, measure, id, value } = req.body || {};
  const ok = { originality: ['1', '2', '3', '4'], effectiveness: ['1', '2', '3', '4'], branch_div: ['yes', 'maybe', 'no'], edit_sig: ['yes', 'maybe', 'no'], final_sig: ['yes', 'maybe', 'no'] };
  if (typeof rater !== 'string' || !rater.trim() || typeof id !== 'string' || !ok[measure] || !ok[measure].includes(String(value))) return res.status(400).json({ error: 'Invalid rating.' });
  const item = (await buildAllItems()).find(i => opaque(i.key) === id);
  if (!item) return res.status(404).json({ error: 'Unknown item.' });
  await saveRating(rater.trim().slice(0, 60), measure, item.key, String(value)); res.json({ ok: true });
}));

// Fallback — redirect everything else to landing
app.get('*', (req, res) => {
  res.redirect('/');
});

initDb()
  .catch(err => console.error('Could not initialise the database:', err.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`IdeaGit running on port ${PORT}`));
  });
