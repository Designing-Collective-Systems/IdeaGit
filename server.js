// ============================================================
//  IdeaForest variant 2 (Idea Tree only) - Express server
//
//  No logins. Opening the site creates a new anonymous participant with the next PID
//  (P0001, P0002, ...) that the user never sees; a signed cookie ties the browser to it.
//  Flow: consent form -> Idea Tree at /app. The PID is linked to the consent name/time,
//  the ideas and the end-of-task answers. Reloading keeps the same PID (same cookie).
//  The Anthropic API key stays in Heroku's environment variables.
//
//  Environment variables: DATABASE_URL, ANTHROPIC_API_KEY, SESSION_SECRET,
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

// ── Sessions: a signed cookie holding the user id and an expiry ─────────
const COOKIE = 'ig2_session';
const SESSION_DAYS = 7;   // how long a signed cookie is accepted
const SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('ideagit-v2|' + (process.env.DATABASE_URL || 'local-dev')).digest('hex');
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('SESSION_SECRET is not set - using a key derived from DATABASE_URL. Set SESSION_SECRET on Heroku for a dedicated key.');
}

const sign = value => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d.e > Date.now() ? d.u : null;
  } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
  });
  return out;
}
function startSession(req, res, userId) {
  res.cookie(COOKIE, makeToken(userId), {
    httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', // session cookie: lasts until the browser is closed
  });
}

// Loads the logged-in user (if any) for every request after the static files
app.use(asyncH(async (req, res, next) => {
  req.user = null;
  const userId = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  if (userId && db.dbConfigured()) req.user = await db.getUserById(userId);
  next();
}));

// ── Helpers ─────────────────────────────────────────────────
const CONDITION = 'IdeaForest_TreeOnly';        // value stored in ideagit2_nodes.study_condition

// Where a logged-in user goes next: consent first (once), then the tool
function destinationFor(user) {
  return user.consented ? '/app' : '/consent';
}
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
  res.json({ answers: await db.loadFinalAnswers(req.user.id), finished: !!req.user.finished_at });
}));

app.post('/api/final-answers', requireConsented, asyncH(async (req, res) => {
  const { answers, finish } = req.body || {};
  if (!Array.isArray(answers) || answers.length > 200) {
    return res.status(400).json({ error: 'answers must be an array.' });
  }
  const clean = [];
  for (const a of answers) {
    if (!a || typeof a.node_id !== 'string' || !a.node_id) return res.status(400).json({ error: 'Every answer needs a node_id.' });
    const f = k => String(a[k] ?? '').slice(0, 10000);
    clean.push({ node_id: a.node_id, ai_use: f('ai_use'), explored: f('explored'), refined: f('refined') });
  }
  const saved = await db.saveFinalAnswers(req.user.id, clean, finish === true);
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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

// A new participant (and PID) is created only when someone opens the site without a valid cookie.
// If concurrent visitors arrive together, each insert takes its own number from a Postgres sequence.
async function ensureParticipant(req, res) {
  if (req.user) return req.user;
  const user = await db.createParticipant();
  startSession(req, res, user.id);
  req.user = user;
  return user;
}

app.get(['/', '/login'], asyncH(async (req, res) => {
  if (!db.dbConfigured()) return res.status(503).send('The service is not available right now.');
  const user = await ensureParticipant(req, res);
  res.redirect(destinationFor(user));
}));

app.get('/consent', asyncH(async (req, res) => {
  if (!db.dbConfigured()) return res.status(503).send('The service is not available right now.');
  const user = await ensureParticipant(req, res);
  if (user.consented) return res.redirect('/app');
  sendView(res, 'consent');
}));

// The Idea Tree tool (consent required)
app.get('/app', (req, res) => {
  const u = req.user;
  if (!u) return res.redirect('/');
  if (!u.consented) return res.redirect('/consent');
  sendView(res, 'app');
});

// Old study links (/app1, /app2) now lead to the one remaining condition
app.get(['/app1', '/app2'], (req, res) => res.redirect('/app'));

app.get('*', (req, res) => res.redirect('/'));

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
