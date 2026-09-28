// ============================================================
//  IdeaGit variant 2 - Express server
//
//  Accounts (register / login / logout), a one-time consent step, routing
//  to the participant's assigned app (/app1 or /app2), and load/save of
//  their ideas so they can pick up where they left off.
//  The Anthropic API key stays in Heroku's environment variables.
// ============================================================

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const { promisify } = require('util');
const db      = require('./db');

const scrypt = promisify(crypto.scrypt);
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
const SESSION_DAYS = 30;
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
    httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: SESSION_DAYS * 864e5,
  });
}

// Loads the logged-in user (if any) for every request after the static files
app.use(asyncH(async (req, res, next) => {
  req.user = null;
  const userId = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  if (userId && db.dbConfigured()) req.user = await db.getUserById(userId);
  next();
}));

// ── Passwords: scrypt with a random salt (built into Node, no extra package) ──
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = await scrypt(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}
let dummyHashPromise = null; // lets an unknown username cost the same time as a wrong password
const dummyHash = () => dummyHashPromise || (dummyHashPromise = hashPassword('not-a-real-password'));

// ── Brute-force protection: a few wrong passwords per IP + username, then a pause ──
const failures = new Map();
const FAIL_WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 8;
const failKey = (req, username) => req.ip + '|' + String(username || '').toLowerCase();
function tooManyFails(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILS;
}
function noteFail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
  if (failures.size > 5000) for (const [k, v] of failures) if (Date.now() - v.first > FAIL_WINDOW_MS) failures.delete(k);
}

// ── Helpers ─────────────────────────────────────────────────
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const nextToApp = next => (next === '/app1' ? 'app1' : next === '/app2' ? 'app2' : null); // allow-list: no open redirects
const CONDITION = { app1: 'AI_only', app2: 'IdeaGit' }; // stored in study_condition

// Where a logged-in user goes next: consent first (once), then their assigned app
function destinationFor(user) {
  if (!user.assigned_app) return null;
  return user.consented ? '/' + user.assigned_app : '/consent';
}
function authResponse(user) {
  const redirect = destinationFor(user);
  if (redirect) return { ok: true, redirect };
  return {
    ok: true, redirect: null,
    message: 'You are logged in, but this page does not say which version of the study to open. Please use the link your researcher gave you.',
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}
function requireConsented(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  if (!req.user.consented) return res.status(403).json({ error: 'Consent is required before using the tool.' });
  next();
}

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!db.dbConfigured()) return res.status(503).json({ error: 'The service is not available right now.' });
  next();
});

// ── Account endpoints ───────────────────────────────────────
app.post('/api/register', asyncH(async (req, res) => {
  const { username, password, next } = req.body || {};
  const name = String(username || '').trim();
  const pw = String(password || '');
  if (!USERNAME_RE.test(name)) {
    return res.status(400).json({ error: 'Choose a username of 3 to 40 characters using letters, numbers, dots, dashes or underscores.' });
  }
  if (pw.length < 8 || pw.length > 200) {
    return res.status(400).json({ error: 'Your password must be at least 8 characters.' });
  }
  let user;
  try {
    user = await db.createUser(name, await hashPassword(pw), nextToApp(next));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken. Please choose another.' });
    throw err;
  }
  startSession(req, res, user.id);
  res.status(201).json(authResponse(user));
}));

app.post('/api/login', asyncH(async (req, res) => {
  const { username, password, next } = req.body || {};
  const name = String(username || '').trim();
  const pw = String(password || '').slice(0, 200);
  const key = failKey(req, name);
  if (tooManyFails(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please wait a few minutes and try again.' });
  }
  const user = name ? await db.getUserByUsername(name) : null;
  const ok = user
    ? await verifyPassword(pw, user.password_hash)
    : (await verifyPassword(pw, await dummyHash()), false);
  if (!ok) {
    noteFail(key);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  failures.delete(key);
  let current = user;
  const app_ = nextToApp(next);
  if (!current.assigned_app && app_) current = await db.setAssignedApp(current.id, app_);
  await db.touchLogin(current.id);
  startSession(req, res, current.id);
  res.json(authResponse(current));
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const { username, consented, assigned_app } = req.user;
  res.json({ username, consented, assigned_app });
});

// ── One-time consent ────────────────────────────────────────
app.post('/api/consent', requireUser, asyncH(async (req, res) => {
  const fullName = String((req.body || {}).full_name || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 3 || fullName.length > 200 || !fullName.includes(' ')) {
    return res.status(400).json({ error: 'Please type your full name.' });
  }
  const user = await db.recordConsent(req.user.id, fullName);
  res.json({ ok: true, redirect: user.assigned_app ? '/' + user.assigned_app : null });
}));

// ── Ideas: load (to resume) and save ────────────────────────
app.get('/api/load-nodes', requireConsented, asyncH(async (req, res) => {
  res.json({ nodes: await db.loadNodes(req.user.id) });
}));

app.post('/api/save-nodes', requireConsented, asyncH(async (req, res) => {
  const { nodes } = req.body || {};
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 500) {
    return res.status(400).json({ error: 'nodes must be a non-empty array (max 500).' });
  }
  if (nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id)) {
    return res.status(400).json({ error: 'Every node needs a node_id.' });
  }
  // The user and condition come from the session, never from the request body
  await db.saveNodes(req.user.id, CONDITION[req.user.assigned_app] || null, nodes);
  res.json({ ok: true, saved: nodes.length });
}));

// ── Claude proxy (logged-in, consented participants only) ───
app.post('/api/claude', requireConsented, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
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

// ── Pages ───────────────────────────────────────────────────
const VIEWS = path.join(__dirname, 'views');
function sendView(res, name) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(VIEWS, name + '.html'));
}

// Landing page = login / registration
app.get(['/', '/login'], (req, res) => {
  const dest = req.user && destinationFor(req.user);
  if (dest) return res.redirect(dest); // already logged in: straight to consent or the app
  sendView(res, 'login');
});

app.get('/consent', (req, res) => {
  const u = req.user;
  if (!u || !u.assigned_app) return res.redirect('/login');
  if (u.consented) return res.redirect('/' + u.assigned_app);
  sendView(res, 'consent');
});

// The two versions of the tool. Participants keep the one whose link they first used.
['app1', 'app2'].forEach(name => {
  app.get('/' + name, asyncH(async (req, res) => {
    let user = req.user;
    if (!user) return res.redirect('/login?next=' + encodeURIComponent('/' + name));
    if (!user.assigned_app) user = await db.setAssignedApp(user.id, name);
    if (user.assigned_app !== name) return res.redirect('/' + user.assigned_app);
    if (!user.consented) return res.redirect('/consent');
    sendView(res, name);
  }));
});

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
    app.listen(PORT, () => console.log(`IdeaGit v2 running on port ${PORT}`));
  });
