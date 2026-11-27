// ============================================================
//  IdeaForest variant 2 (Idea Tree only) - Express server
//
//  No logins and no cookies. Every browser TAB that opens the site becomes a new anonymous
//  participant with the next PID (P0001, P0002, ...) that the user never sees; the tab keeps a
//  random secret in sessionStorage and sends it as a header.
//  Flow: consent form -> Idea Tree at /app. The PID is linked to the consent name/time,
//  the ideas and the end-of-task answers. Reloading the same tab keeps its PID; opening a new tab gives a new one.
//  The Anthropic API key stays in Heroku's environment variables.
//
//  Environment variables: DATABASE_URL, ANTHROPIC_API_KEY,
//  ADMIN_PASSWORD (for /admin), optional CLAUDE_MODEL.
// ============================================================

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./db');

const app    = express();
const PORT   = process.env.PORT || 3000;

app.set('trust proxy', 1); // Heroku's router terminates HTTPS; this makes req.secure / req.ip correct
app.use(express.json({ limit: '5mb' })); // idea snapshots include AI responses
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

// Public assets only (css, js, fonts, consent.pdf). The app pages live in
// views/ and are served solely through the gated routes below.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Participants are identified per browser TAB, without cookies ───────
// Each tab asks /api/start for a new participant and keeps the random secret it receives in its own
// sessionStorage. It sends that secret in the X-Participant-Token header on every API call.
// A new tab has an empty sessionStorage, so it gets a new participant (new PID).
app.use(asyncH(async (req, res, next) => {
  req.user = null;
  const token = req.get('X-Participant-Token');
  if (token && db.dbConfigured()) req.user = await db.getUserByToken(token);
  next();
}));

// ── Helpers ─────────────────────────────────────────────────
const CONDITION = 'IdeaForest_TreeOnly';        // value stored in ideagit2_nodes.study_condition

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Your session has ended. Please reload the page.' });
  next();
}
function requireConsented(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Your session has ended. Please reload the page.' });
  if (!req.user.consented) return res.status(403).json({ error: 'Consent is required before using the tool.' });
  next();
}

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!db.dbConfigured()) return res.status(503).json({ error: 'The service is not available right now.' });
  next();
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ consented: !!req.user.consented }); // the PID is never sent to the browser
});

// ── One-time consent ────────────────────────────────────────
app.post('/api/consent', requireUser, asyncH(async (req, res) => {
  const { full_name } = req.body || {};
  const fullName = String(full_name || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 3 || fullName.length > 200 || !fullName.includes(' ')) {
    return res.status(400).json({ error: 'Please type your full name.' });
  }
  await db.recordConsent(req.user.id, fullName);
  res.json({ ok: true, redirect: '/app' });
}));

// ── Ideas: load (to resume) and save ────────────────────────
app.get('/api/load-nodes', requireConsented, asyncH(async (req, res) => {
  res.json({ nodes: await db.loadNodes(req.user.id, CONDITION) });
}));

app.post('/api/save-nodes', requireConsented, asyncH(async (req, res) => {
  const { nodes } = req.body || {};
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 500) {
    return res.status(400).json({ error: 'nodes must be a non-empty array (max 500).' });
  }
  if (nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id)) {
    return res.status(400).json({ error: 'Every node needs a node_id.' });
  }
  // The user always comes from the session, never from the request body
  await db.saveNodes(req.user.id, CONDITION, nodes);
  res.json({ ok: true, saved: nodes.length });
}));

// ── End-of-task answers (one set of three per finalized idea) ──
app.get('/api/final-answers', requireConsented, asyncH(async (req, res) => {
  res.json({ answers: await db.loadFinalAnswers(req.user.id), reflections: await db.loadReflections(req.user.id), finished: !!req.user.finished_at });
}));

app.post('/api/final-answers', requireConsented, asyncH(async (req, res) => {
  const { answers, finish, reflections } = req.body || {};
  if (!Array.isArray(answers) || answers.length > 200) {
    return res.status(400).json({ error: 'answers must be an array.' });
  }
  const clean = [];
  for (const a of answers) {
    if (!a || typeof a.node_id !== 'string' || !a.node_id) return res.status(400).json({ error: 'Every answer needs a node_id.' });
    const f = k => String(a[k] ?? '').slice(0, 10000);
    clean.push({ node_id: a.node_id, ai_use: f('ai_use'), explored: f('explored'), refined: f('refined') });
  }
  // the two end questions (optional in a request; sent whole each time)
  const refl = reflections && typeof reflections === 'object'
    ? { learned: String(reflections.learned ?? '').slice(0, 10000), partner: String(reflections.partner ?? '').slice(0, 10000) } : null;
  const saved = await db.saveFinalAnswers(req.user.id, clean, finish === true, refl);
  res.json({ ok: true, saved });
}));

// The tree page asks for researcher settings in variant 1; nothing to configure here
app.get('/api/settings', requireConsented, (req, res) => res.json({}));

// ── Claude proxy (logged-in, consented participants only) ───
// The browser cannot choose the model, and the token budget is capped.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
app.post('/api/claude', requireConsented, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  try {
    const body = { ...(req.body || {}), model: CLAUDE_MODEL };
    body.max_tokens = Math.min(Number(body.max_tokens) || 4096, 32000);
    const response = await fetch(process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
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

// ── Researcher admin (HTTP Basic auth, password = ADMIN_PASSWORD) ──
function requireAdmin(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).send('Set ADMIN_PASSWORD on the server to use the admin page.');
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  const given = m ? Buffer.from(m[1], 'base64').toString().replace(/^[^:]*:/, '') : '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    res.set('WWW-Authenticate', 'Basic realm="IdeaForest admin"');
    return res.status(401).send('Authentication required.');
  }
  next();
}
const csvCell = v => {
  if (v == null) return '';
  if (v instanceof Date) v = v.toISOString();
  else if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
function sendCsv(res, filename, rows, cols) {
  const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(',')));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send('\ufeff' + lines.join('\r\n'));
}
app.get('/admin', requireAdmin, (req, res) => sendView(res, 'admin'));
app.get('/admin/api/users', requireAdmin, asyncH(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ users: await db.listUsers() });
}));
app.get('/admin/ideas.csv', requireAdmin, asyncH(async (req, res) => {
  const rows = await db.exportNodes();
  sendCsv(res, 'ideas.csv', rows, ['pid','node_id','group_id','parent_id','type','tag','title','body','is_finalized','user_prompt','ai_response','extras','meta','created_at','updated_at']);
}));
app.get('/admin/answers.csv', requireAdmin, asyncH(async (req, res) => {
  const rows = await db.exportAnswers();
  sendCsv(res, 'final_answers.csv', rows, ['pid','node_id','idea','is_finalized','ai_use','explored','refined','updated_at','finished_at']);
}));
app.get('/admin/reflections.csv', requireAdmin, asyncH(async (req, res) => {
  sendCsv(res, 'reflections.csv', await db.exportReflections(), ['pid','learned_from_ai','partner_learned_from_ai','finished_at']);
}));
app.post('/admin/api/delete-user', requireAdmin, asyncH(async (req, res) => {
  const id = parseInt((req.body || {}).id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id required' });
  res.json({ ok: true, nodes_deleted: await db.deleteUser(id) });
}));

// ── Pages ───────────────────────────────────────────────────
const VIEWS = path.join(__dirname, 'views');
function sendView(res, name) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(VIEWS, name + '.html'));
}

// A new participant (and PID) is created each time a tab asks to start. Concurrent tabs each take
// their own number from a Postgres sequence, so PIDs never collide.
app.post('/api/start', asyncH(async (req, res) => {
  if (!db.dbConfigured()) return res.status(503).json({ error: 'The service is not available right now.' });
  const user = await db.createParticipant();
  res.json({ token: user.session_token, consented: false });   // the PID itself is never sent
}));

// The pages are static; the page's script checks the tab's token and redirects as needed
app.get(['/', '/login', '/consent'], (req, res) => sendView(res, 'consent'));
app.get('/app', (req, res) => sendView(res, 'app'));

// Old study links (/app1, /app2) now lead to the one remaining condition
app.get(['/app1', '/app2'], (req, res) => res.redirect('/app'));

app.get('*', (req, res) => (path.extname(req.path) ? res.status(404).send('Not found') : res.redirect('/')));   // a missing file (e.g. consent.pdf) must not load the consent page inside itself

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error('Server error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error' });
});

db.initDb()
  .catch(err => console.error('Could not initialise the database:', err.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`IdeaForest v2 running on port ${PORT}`));
  });
