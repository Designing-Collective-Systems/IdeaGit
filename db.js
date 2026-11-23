// ============================================================
//  IdeaForest variant 2 (Idea Tree only) - Postgres storage
//
//  ideagit2_users         : one row per participant. `username` holds the automatically assigned PID
//                           (P0001, P0002, ...); consent name/time and the finish time live on the same row.
//  ideagit2_nodes         : one row per idea version, owned by a user (their saved work)
//  ideagit2_final_answers : the three end-of-task answers for each finalized idea
//
//  The table names carry a "2" so this variant never collides with variant 1's
//  tables if both share one database. The connection comes from DATABASE_URL.
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
    password_hash  TEXT        NOT NULL DEFAULT '',   -- unused: there are no logins
    last_app       TEXT,
    consented      BOOLEAN     NOT NULL DEFAULT FALSE,
    consent_name   TEXT,
    consented_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at  TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ideagit2_users_username_lower
    ON ideagit2_users (lower(username));
  ALTER TABLE ideagit2_users ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;   -- set when the participant submits the end-of-task questions

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

  CREATE TABLE IF NOT EXISTS ideagit2_final_answers (
    user_id      INTEGER     NOT NULL REFERENCES ideagit2_users(id),
    node_id      TEXT        NOT NULL,
    ai_use       TEXT        NOT NULL DEFAULT '',   -- Did you use AI to ideate? If yes, how? If no, why not?
    explored     TEXT        NOT NULL DEFAULT '',   -- Did you explore multiple ideas? Why?
    refined      TEXT        NOT NULL DEFAULT '',   -- Did you refine your idea? Why?
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, node_id)
  );
`;

const USER_COLS =
  'id, username, last_app, consented, consent_name, consented_at, finished_at';

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
  console.log('Postgres ready (tables ideagit2_users, ideagit2_nodes, ideagit2_final_answers).');
}

// ── Users ────────────────────────────────────────────────────
// Creates a new anonymous participant and gives it the next PID (P0001, P0002, ...).
// The id comes from a Postgres sequence, so two people arriving at the same instant can never
// get the same one; the PID is built from that id inside the same statement.
async function createParticipant() {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `WITH n AS (SELECT nextval(pg_get_serial_sequence('ideagit2_users', 'id')) AS id)
         INSERT INTO ideagit2_users (id, username, password_hash)
         SELECT id, 'P' || lpad(id::text, 4, '0'), '' FROM n
         RETURNING ${USER_COLS}`
      );
      return rows[0];
    } catch (err) {
      if (err.code !== '23505' || attempt === 4) throw err; // PID text already used by an old row: take the next number
    }
  }
}
async function getUserById(id) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM ideagit2_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

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

// ── End-of-task answers ──────────────────────────────────────
async function loadFinalAnswers(userId) {
  const { rows } = await pool.query(
    'SELECT node_id, ai_use, explored, refined FROM ideagit2_final_answers WHERE user_id = $1', [userId]);
  return rows;
}
// Saves the answers for some ideas (only ideas that belong to this user); finish = also stamp finished_at
async function saveFinalAnswers(userId, answers, finish) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = new Set((await client.query('SELECT node_id FROM ideagit2_nodes WHERE user_id = $1', [userId])).rows.map(r => r.node_id));
    let saved = 0;
    for (const a of answers) {
      if (!own.has(a.node_id)) continue;
      await client.query(
        `INSERT INTO ideagit2_final_answers (user_id, node_id, ai_use, explored, refined, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (user_id, node_id) DO UPDATE SET
           ai_use = EXCLUDED.ai_use, explored = EXCLUDED.explored, refined = EXCLUDED.refined, updated_at = NOW()`,
        [userId, a.node_id, a.ai_use, a.explored, a.refined]);
      saved++;
    }
    if (finish) await client.query('UPDATE ideagit2_users SET finished_at = COALESCE(finished_at, NOW()) WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return saved;
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

// ── Researcher (admin) side ──────────────────────────────────
async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.username AS pid, u.consented, u.consent_name, u.consented_at, u.created_at, u.finished_at,
            COUNT(n.node_id)::int AS nodes,
            COUNT(n.node_id) FILTER (WHERE n.is_finalized)::int AS finalized,
            (SELECT COUNT(*)::int FROM ideagit2_final_answers f WHERE f.user_id = u.id) AS answered
       FROM ideagit2_users u LEFT JOIN ideagit2_nodes n ON n.user_id = u.id
      GROUP BY u.id ORDER BY u.id`);
  return rows;
}
async function exportNodes() {
  const { rows } = await pool.query(
    `SELECT u.username AS pid, n.node_id, n.group_id, n.parent_id, n.type, n.tag, n.title, n.body, n.is_finalized,
            n.user_prompt, n.ai_response, n.extras, n.meta, n.created_at, n.updated_at
       FROM ideagit2_nodes n JOIN ideagit2_users u ON u.id = n.user_id
      ORDER BY u.id, n.created_at NULLS LAST, n.node_id`);
  return rows;
}
async function exportAnswers() {
  const { rows } = await pool.query(
    `SELECT u.username AS pid, f.node_id, n.body AS idea, n.is_finalized, f.ai_use, f.explored, f.refined, f.updated_at, u.finished_at
       FROM ideagit2_final_answers f
       JOIN ideagit2_users u ON u.id = f.user_id
       LEFT JOIN ideagit2_nodes n ON n.user_id = f.user_id AND n.node_id = f.node_id
      ORDER BY u.id, n.created_at NULLS LAST, f.node_id`);
  return rows;
}
// Removes one account and everything stored for it
async function deleteUser(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ideagit2_final_answers WHERE user_id = $1', [userId]);
    const n = (await client.query('DELETE FROM ideagit2_nodes WHERE user_id = $1', [userId])).rowCount;
    await client.query('DELETE FROM ideagit2_users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return n;
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

module.exports = {
  initDb, dbConfigured,
  createParticipant, getUserById, recordConsent,
  saveNodes, loadNodes, loadFinalAnswers, saveFinalAnswers,
  listUsers, exportNodes, exportAnswers, deleteUser,
};
