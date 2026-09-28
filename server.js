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
const CONDITIONS = new Map([['app1', 'AI_only'], ['app2', 'IdeaGit']]); // app -> value stored in study_condition

// Where a logged-in user goes next: consent first (once), then the app they asked
// for. Without a study link, a returning participant goes back to the app they
// used last; only someone with no app history yet (a brand-new account, or an
// existing one that has somehow never opened either app) defaults to app2.
const DEFAULT_APP = 'app2';
function destinationFor(user, nextApp) {
  const target = nextApp || user.last_app || DEFAULT_APP;
  return user.consented ? '/' + target : '/consent?next=' + encodeURIComponent('/' + target);
}
function authResponse(user, nextApp) {
  return { ok: true, redirect: destinationFor(user, nextApp) };
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
  res.status(201).json(authResponse(user, nextToApp(next)));
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
  const nextApp = nextToApp(next);
  if (nextApp && user.last_app !== nextApp) { await db.setLastApp(user.id, nextApp); user.last_app = nextApp; }
  await db.touchLogin(user.id);
  startSession(req, res, user.id);
  res.json(authResponse(user, nextApp));
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const { username, consented, last_app } = req.user;
  res.json({ username, consented, last_app });
});

// ── One-time consent ────────────────────────────────────────
app.post('/api/consent', requireUser, asyncH(async (req, res) => {
  const { full_name, next } = req.body || {};
  const fullName = String(full_name || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 3 || fullName.length > 200 || !fullName.includes(' ')) {
    return res.status(400).json({ error: 'Please type your full name.' });
  }
  const nextApp = nextToApp(next);
  const user = await db.recordConsent(req.user.id, fullName);
  if (nextApp && user.last_app !== nextApp) { await db.setLastApp(user.id, nextApp); user.last_app = nextApp; }
  const target = nextApp || user.last_app;
  res.json({ ok: true, redirect: target ? '/' + target : null });
}));

// ── Ideas: load (to resume) and save ────────────────────────
// Ideas are kept per participant AND per app, so each app resumes its own work
app.get('/api/load-nodes', requireConsented, asyncH(async (req, res) => {
  const condition = CONDITIONS.get(String(req.query.app || ''));
  if (!condition) return res.status(400).json({ error: 'Unknown app.' });
  res.json({ nodes: await db.loadNodes(req.user.id, condition) });
}));

app.post('/api/save-nodes', requireConsented, asyncH(async (req, res) => {
  const { app: appName, nodes } = req.body || {};
  const condition = CONDITIONS.get(String(appName || ''));
  if (!condition) return res.status(400).json({ error: 'Unknown app.' });
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 500) {
    return res.status(400).json({ error: 'nodes must be a non-empty array (max 500).' });
  }
  if (nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id)) {
    return res.status(400).json({ error: 'Every node needs a node_id.' });
  }
  // The user comes from the session; the condition from the allow-listed app name
  await db.saveNodes(req.user.id, condition, nodes);
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
  const dest = req.user && destinationFor(req.user, nextToApp(req.query.next));
  if (dest) return res.redirect(dest); // already logged in: straight to consent or the app
  sendView(res, 'login');
});

app.get('/consent', (req, res) => {
  const u = req.user;
  const nextApp = nextToApp(req.query.next);
  if (!u) return res.redirect('/login' + (nextApp ? '?next=' + encodeURIComponent('/' + nextApp) : ''));
  if (u.consented) {
    const target = nextApp || u.last_app;
    return res.redirect(target ? '/' + target : '/');
  }
  sendView(res, 'consent');
});

// The two versions of the tool. Any consented participant can open either one.
['app1', 'app2'].forEach(name => {
  app.get('/' + name, asyncH(async (req, res) => {
    const user = req.user;
    if (!user) return res.redirect('/login?next=' + encodeURIComponent('/' + name));
    if (!user.consented) return res.redirect('/consent?next=' + encodeURIComponent('/' + name));
    if (user.last_app !== name) await db.setLastApp(user.id, name);
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
