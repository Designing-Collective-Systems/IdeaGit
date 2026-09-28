// ============================================================
//  IdeaGit variant 2 - Postgres storage
//
//  ideagit2_users : one row per account (login details, the app they used
//                   last, and their one-time consent)
//  ideagit2_nodes : one row per idea version, owned by a user and tagged with
//                   the app it was made in (study_condition: AI_only = app1,
//                   IdeaGit = app2); self-reports are stored on finalized ideas.
//                   Participants can use both apps; work is kept per app.
//
//  The table names carry a "2" so variant 2 can never collide with
//  variant 1's ideagit_nodes table, even if both share one database.
//  The connection comes from DATABASE_URL (set by the Heroku add-on).
// ============================================================

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
let pool = null;

if (connectionString) {
  // Heroku Postgres requires SSL; skip it only for a local database.
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  pool.on('error', err => console.error('Unexpected Postgres error:', err.message));
}

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS ideagit2_users (
    id             SERIAL      PRIMARY KEY,
    username       TEXT        NOT NULL,
    password_hash  TEXT        NOT NULL,
    last_app       TEXT        CHECK (last_app IN ('app1', 'app2')),
    consented      BOOLEAN     NOT NULL DEFAULT FALSE,
    consent_name   TEXT,
    consented_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at  TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ideagit2_users_username_lower
    ON ideagit2_users (lower(username));
  -- for databases created before last_app existed
  ALTER TABLE ideagit2_users ADD COLUMN IF NOT EXISTS last_app TEXT CHECK (last_app IN ('app1', 'app2'));

  CREATE TABLE IF NOT EXISTS ideagit2_nodes (
    user_id             INTEGER     NOT NULL REFERENCES ideagit2_users(id),
    node_id             TEXT        NOT NULL,
    study_condition     TEXT,
    group_id            TEXT,
    parent_id           TEXT,
    type                TEXT,
    tag                 TEXT,
    title               TEXT,
    body                TEXT,
    is_finalized        BOOLEAN     NOT NULL DEFAULT FALSE,
    user_prompt         TEXT,
    ai_response         TEXT,
    extras              JSONB       NOT NULL DEFAULT '[]'::jsonb,
    meta                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    self_report_ai_use  TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, node_id)
  );
`;

const USER_COLS =
  'id, username, password_hash, last_app, consented, consent_name, consented_at';

const UPSERT_NODE_SQL = `
  INSERT INTO ideagit2_nodes (
    user_id, node_id, study_condition, group_id, parent_id, type, tag,
    title, body, is_finalized, user_prompt, ai_response, extras, meta,
    self_report_ai_use, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb,
    $15,
    CASE WHEN $16::double precision IS NULL THEN NULL
         ELSE to_timestamp($16::double precision / 1000.0) END,
    NOW()
  )
  ON CONFLICT (user_id, node_id) DO UPDATE SET
    study_condition    = EXCLUDED.study_condition,
    group_id           = EXCLUDED.group_id,
    parent_id          = EXCLUDED.parent_id,
    type               = EXCLUDED.type,
    tag                = EXCLUDED.tag,
    title              = EXCLUDED.title,
    body               = EXCLUDED.body,
    is_finalized       = EXCLUDED.is_finalized,
    user_prompt        = EXCLUDED.user_prompt,
    ai_response        = EXCLUDED.ai_response,
    extras             = EXCLUDED.extras,
    meta               = EXCLUDED.meta,
    self_report_ai_use = EXCLUDED.self_report_ai_use,
    updated_at         = NOW()
`;

function dbConfigured() { return pool !== null; }

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL is not set - accounts and saving are unavailable.');
    return;
  }
  await pool.query(CREATE_TABLES_SQL);
  console.log('Postgres ready (tables ideagit2_users, ideagit2_nodes).');
}

// ── Users ────────────────────────────────────────────────────
async function createUser(username, passwordHash, lastApp) {
  const { rows } = await pool.query(
    `INSERT INTO ideagit2_users (username, password_hash, last_app)
     VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
    [username, passwordHash, lastApp]
  );
  return rows[0];
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM ideagit2_users WHERE lower(username) = lower($1)`,
    [username]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM ideagit2_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Remembers the app a participant used last. It is only the default destination when
// they log in without a study link; it never restricts which app they can open.
async function setLastApp(id, app) {
  await pool.query('UPDATE ideagit2_users SET last_app = $2 WHERE id = $1', [id, app]);
}

async function touchLogin(id) {
  await pool.query('UPDATE ideagit2_users SET last_login_at = NOW() WHERE id = $1', [id]);
}

// Consent is one-time: the first signature and its timestamp are kept.
async function recordConsent(id, fullName) {
  const { rows } = await pool.query(
    `UPDATE ideagit2_users
     SET consented = TRUE,
         consent_name = COALESCE(consent_name, $2),
         consented_at = COALESCE(consented_at, NOW())
     WHERE id = $1 RETURNING ${USER_COLS}`,
    [id, fullName]
  );
  return rows[0];
}

// ── Ideas ────────────────────────────────────────────────────
// Insert or update every node in one transaction (all saved, or none).
async function saveNodes(userId, condition, nodes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const n of nodes) {
      await client.query(UPSERT_NODE_SQL, [
        userId,
        String(n.node_id),
        condition == null ? null : String(condition),
        n.group_id == null ? null : String(n.group_id),
        n.parent_id == null ? null : String(n.parent_id),
        n.type == null ? null : String(n.type),
        n.tag == null ? null : String(n.tag),
        String(n.title ?? ''),
        String(n.body ?? ''),
        n.is_finalized === true,
        String(n.user_prompt ?? ''),
        String(n.ai_response ?? ''),
        JSON.stringify(Array.isArray(n.extras) ? n.extras : []),
        JSON.stringify(n.meta && typeof n.meta === 'object' && !Array.isArray(n.meta) ? n.meta : {}),
        String(n.self_report_ai_use ?? ''),
        Number.isFinite(n.created_at_ms) ? n.created_at_ms : null,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Only this participant's ideas for this app: what they resume from
async function loadNodes(userId, condition) {
  const { rows } = await pool.query(
    `SELECT node_id, group_id, parent_id, type, tag, title, body, is_finalized,
            user_prompt, ai_response, extras, meta, self_report_ai_use,
            created_at, updated_at
     FROM ideagit2_nodes WHERE user_id = $1 AND study_condition = $2
     ORDER BY created_at, node_id`,
    [userId, condition]
  );
  return rows;
}

module.exports = {
  initDb, dbConfigured,
  createUser, getUserByUsername, getUserById, setLastApp, touchLogin, recordConsent,
  saveNodes, loadNodes,
};
