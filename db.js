// ============================================================
//  IdeaGit — Postgres storage
//  One table, ideagit_nodes: one row per idea version (node), with
//  the participant's self-report stored on the finalized ideas.
//  Connection comes from DATABASE_URL, which the Heroku Postgres
//  add-on sets automatically.
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

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ideagit_nodes (
    participant_id      TEXT        NOT NULL,
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
    self_report_ai_use  TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (participant_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS ideagit_nodes_participant_idx ON ideagit_nodes (participant_id);
`;

const UPSERT_SQL = `
  INSERT INTO ideagit_nodes (
    participant_id, node_id, study_condition, group_id, parent_id, type, tag,
    title, body, is_finalized, user_prompt, ai_response, extras,
    self_report_ai_use, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13::jsonb,
    $14,
    CASE WHEN $15::double precision IS NULL THEN NULL
         ELSE to_timestamp($15::double precision / 1000.0) END,
    NOW()
  )
  ON CONFLICT (participant_id, node_id) DO UPDATE SET
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
    self_report_ai_use = EXCLUDED.self_report_ai_use,
    updated_at         = NOW()
`;

function dbConfigured() { return pool !== null; }

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL is not set - participant data will NOT be saved.');
    return;
  }
  await pool.query(CREATE_TABLE_SQL);
  console.log('Postgres ready (table ideagit_nodes).');
}

// Insert or update every node in one transaction (all saved, or none).
async function saveNodes(participantId, condition, nodes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const n of nodes) {
      await client.query(UPSERT_SQL, [
        participantId,
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

// Read-only helpers for the /view page: which (condition, participant) pairs exist, and one participant's nodes.
async function listParticipants() {
  const r = await pool.query(
    `SELECT study_condition AS condition, participant_id, COUNT(*)::int AS n
       FROM ideagit_nodes GROUP BY study_condition, participant_id ORDER BY study_condition, participant_id`);
  return r.rows;
}
async function getParticipantNodes(conditions, participantId) {
  // conditions: array of raw study_condition values (null / '' = no condition recorded)
  const vals = conditions.filter(c => c !== null && c !== '');
  const wantNull = conditions.some(c => c === null || c === '');
  const r = await pool.query(
    `SELECT node_id, group_id, parent_id, type, tag, title, body, is_finalized, user_prompt, ai_response,
            extras, self_report_ai_use, (EXTRACT(EPOCH FROM created_at) * 1000)::double precision AS created_ms
       FROM ideagit_nodes
      WHERE participant_id = $1 AND (study_condition = ANY($2::text[]) OR ($3::boolean AND study_condition IS NULL))
      ORDER BY created_at NULLS LAST, node_id`,
    [participantId, vals, wantNull]);
  return r.rows;
}

module.exports = { initDb, saveNodes, dbConfigured, listParticipants, getParticipantNodes };
