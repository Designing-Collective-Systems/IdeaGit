// ============================================================
//  IdeaForest — Condition C (team ideation) backend
//  Everything for Condition C lives here and in its own tables
//  (ideagit_c_*), so the other conditions are untouched.
//
//  Real-time sync is plain HTTP polling (the page asks for changes
//  every ~1.5 s), which works on Heroku without websockets.
// ============================================================

const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;
let pool = null;
if (connectionString) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 5 });
  pool.on('error', err => console.error('Unexpected Postgres error (teams):', err.message));
}
const q = (text, params) => pool.query(text, params);

const SCHEMA = `
  -- one row per team
  CREATE TABLE IF NOT EXISTS ideagit_c_teams (
    team_code          TEXT        PRIMARY KEY,
    created_by         TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at         TIMESTAMPTZ,                       -- when the creator pressed Start
    phase              TEXT        NOT NULL DEFAULT 'lobby',   -- lobby | working | self_report | finished
    done_active        BOOLEAN     NOT NULL DEFAULT FALSE,      -- a "Done with task" request is waiting for approvals
    done_by            TEXT,
    done_round         INT         NOT NULL DEFAULT 0,
    done_requested_at  TIMESTAMPTZ,
    last_decline_by    TEXT,
    last_decline_at    TIMESTAMPTZ,
    done_confirmed_at  TIMESTAMPTZ,                       -- everyone approved
    finished_at        TIMESTAMPTZ                        -- every member finished the questions
  );
  -- one row per participant in a team (also used for presence)
  CREATE TABLE IF NOT EXISTS ideagit_c_members (
    team_code        TEXT        NOT NULL REFERENCES ideagit_c_teams(team_code) ON DELETE CASCADE,
    participant_id   TEXT        NOT NULL,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_after_start BOOLEAN   NOT NULL DEFAULT FALSE,
    last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_node_id  TEXT,                                -- node this member has selected right now
    done_ok          BOOLEAN     NOT NULL DEFAULT FALSE,  -- approved the current "Done" request
    sr_infl_done     BOOLEAN     NOT NULL DEFAULT FALSE,
    sr_own_done      BOOLEAN     NOT NULL DEFAULT FALSE,
    sr_done_at       TIMESTAMPTZ,
    PRIMARY KEY (team_code, participant_id)
  );
  -- one row per idea version (node); contributors = the PIDs chosen as contributors of that node
  CREATE TABLE IF NOT EXISTS ideagit_c_nodes (
    team_code        TEXT        NOT NULL REFERENCES ideagit_c_teams(team_code) ON DELETE CASCADE,
    node_id          TEXT        NOT NULL,
    group_id         TEXT,
    parent_id        TEXT,
    type             TEXT,
    tag              TEXT,
    title            TEXT,
    body             TEXT,
    is_finalized     BOOLEAN     NOT NULL DEFAULT FALSE,
    user_prompt      TEXT,
    ai_response      TEXT,
    extras           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_by       TEXT,                                -- PID of the member who pressed the button
    contributors     JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- PIDs shown on the node's tag
    created_at_ms    BIGINT,
    created_at       TIMESTAMPTZ,
    updated_by       TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deleted          BOOLEAN     NOT NULL DEFAULT FALSE,  -- discarded nodes are kept (and hidden)
    deleted_by       TEXT,
    deleted_at       TIMESTAMPTZ,
    PRIMARY KEY (team_code, node_id)
  );
  CREATE INDEX IF NOT EXISTS ideagit_c_nodes_updated ON ideagit_c_nodes (team_code, updated_at);
  -- every edit of a node's contributor tag
  CREATE TABLE IF NOT EXISTS ideagit_c_tag_log (
    id               BIGSERIAL   PRIMARY KEY,
    team_code        TEXT        NOT NULL,
    node_id          TEXT        NOT NULL,
    edited_by        TEXT,
    old_contributors JSONB,
    new_contributors JSONB,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- influence step: one row per member x (influenced idea, possible influencing idea)
  CREATE TABLE IF NOT EXISTS ideagit_c_influence (
    team_code        TEXT        NOT NULL,
    node_id          TEXT        NOT NULL,                -- the finalized idea that was influenced
    from_node_id     TEXT        NOT NULL,                -- the finalized idea that may have influenced it
    participant_id   TEXT        NOT NULL,                -- who answered
    checked          BOOLEAN     NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_code, node_id, from_node_id, participant_id)
  );
  -- ownership step: one row per member x finalized idea
  CREATE TABLE IF NOT EXISTS ideagit_c_ownership (
    team_code        TEXT        NOT NULL,
    node_id          TEXT        NOT NULL,
    participant_id   TEXT        NOT NULL,
    ownership        SMALLINT,                            -- 1 Not at all ... 5 Completely
    ownership_label  TEXT,
    explanation      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_code, node_id, participant_id)
  );
`;

async function initTeamsDb() {
  if (!pool) { console.warn('DATABASE_URL is not set — Condition C (teams) is disabled.'); return; }
  await pool.query(SCHEMA);
}

// ── helpers ───────────────────────────────────────────────────
const OWN_LABELS = ['Not at all', 'Slightly', 'Moderately', 'Mostly', 'Completely'];
const EVENT_TYPES = new Set(['finalized', 'unfinalized', 'discarded', 'custom_prompt']);   // extras entries that are merged, never overwritten

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function mergeExtras(oldE, newE) {
  const inc = Array.isArray(newE) ? newE : [], old = Array.isArray(oldE) ? oldE : [];
  const seen = new Set(inc.filter(x => x && EVENT_TYPES.has(x.type)).map(canon));
  const keep = old.filter(x => x && EVENT_TYPES.has(x.type) && !seen.has(canon(x)));
  return inc.concat(keep).sort((a, b) => ((a && a.ts) || 0) - ((b && b.ts) || 0));
}
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const cleanPid = v => (typeof v === 'string' ? v.trim() : '');
const cleanList = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x.trim() && x.length <= 100).map(x => x.trim()))].slice(0, 30) : []);
const newCode = () => String(crypto.randomInt(100000, 1000000));

async function isMember(code, pid) {
  if (!code || !pid) return false;
  return (await q('SELECT 1 FROM ideagit_c_members WHERE team_code=$1 AND participant_id=$2', [code, pid])).rowCount > 0;
}

function csvCell(v) {
  if (v == null) return '';
  if (v instanceof Date) v = v.toISOString();
  else if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ── routes ────────────────────────────────────────────────────
function register(app, adminAuth) {
  const need = (req, res, next) => (pool ? next() : res.status(503).json({ error: 'Database is not configured.' }));
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (err) { console.error('Teams error:', err); res.status(500).json({ error: 'Database error' }); }
  };
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  // Create a team: random unique number, the creator is its first member
  app.post('/api/c/team/create', need, wrap(async (req, res) => {
    const pid = cleanPid((req.body || {}).pid);
    if (!pid || pid.length > 100) return bad(res, 'Participant ID is required.');
    for (let tries = 0; tries < 30; tries++) {
      const code = newCode();
      const ins = await q('INSERT INTO ideagit_c_teams (team_code, created_by) VALUES ($1,$2) ON CONFLICT DO NOTHING', [code, pid]);
      if (!ins.rowCount) continue;
      await q('INSERT INTO ideagit_c_members (team_code, participant_id) VALUES ($1,$2)', [code, pid]);
      return res.json({ ok: true, code });
    }
    bad(res, 'Could not create a team. Please try again.', 500);
  }));

  // Join (or re-join) a team with its number
  app.post('/api/c/team/join', need, wrap(async (req, res) => {
    const pid = cleanPid((req.body || {}).pid), code = str((req.body || {}).code, 20).trim();
    if (!pid || pid.length > 100) return bad(res, 'Participant ID is required.');
    const t = (await q('SELECT * FROM ideagit_c_teams WHERE team_code=$1', [code])).rows[0];
    if (!t) return bad(res, 'No team found with that number. Please check it and try again.', 404);
    const afterStart = t.phase !== 'lobby';
    const ins = await q(`INSERT INTO ideagit_c_members (team_code, participant_id, joined_after_start) VALUES ($1,$2,$3)
                         ON CONFLICT DO NOTHING`, [code, pid, afterStart]);
    if (ins.rowCount && t.phase === 'finished')   // someone new arrives after everybody finished: they still answer the questions
      await q(`UPDATE ideagit_c_teams SET phase='self_report', finished_at=NULL WHERE team_code=$1`, [code]);
    res.json({ ok: true, code, rejoined: !ins.rowCount });
  }));

  // Only the member who created the team can start it
  app.post('/api/c/team/start', need, wrap(async (req, res) => {
    const pid = cleanPid((req.body || {}).pid), code = str((req.body || {}).code, 20);
    const t = (await q('SELECT * FROM ideagit_c_teams WHERE team_code=$1', [code])).rows[0];
    if (!t) return bad(res, 'Unknown team.', 404);
    if (t.created_by !== pid) return bad(res, 'Only the member who created the team can start it.', 403);
    if (t.phase === 'lobby') await q(`UPDATE ideagit_c_teams SET phase='working', started_at=now() WHERE team_code=$1`, [code]);
    res.json({ ok: true });
  }));

  // The page asks for everything that changed since last time (also the heartbeat + "which node am I on")
  app.post('/api/c/team/poll', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20);
    const since = Math.max(0, Number(b.since_ms) || 0);
    const cur = typeof b.cur === 'string' && b.cur ? b.cur.slice(0, 80) : null;
    const up = await q('UPDATE ideagit_c_members SET last_seen=now(), current_node_id=$3 WHERE team_code=$1 AND participant_id=$2', [code, pid, cur]);
    if (!up.rowCount) return bad(res, 'You are not a member of this team.', 404);
    const t = (await q(`SELECT *, (extract(epoch from clock_timestamp())*1000)::bigint AS now_ms,
                               (extract(epoch from done_requested_at)*1000)::bigint AS done_requested_ms,
                               (extract(epoch from last_decline_at)*1000)::bigint AS last_decline_ms
                        FROM ideagit_c_teams WHERE team_code=$1`, [code])).rows[0];
    const members = (await q(`SELECT participant_id, current_node_id, done_ok, sr_infl_done, sr_own_done,
                                     (last_seen > now() - interval '15 seconds') AS online
                              FROM ideagit_c_members WHERE team_code=$1 ORDER BY joined_at, participant_id`, [code])).rows;
    // 5 s look-back: a write that started before the previous poll but committed after it is still picked up
    const nodes = (await q(`SELECT node_id, group_id, parent_id, type, tag, title, body, is_finalized, user_prompt, ai_response, extras,
                                   contributors, created_by, created_at_ms, deleted
                            FROM ideagit_c_nodes
                            WHERE team_code=$1 AND updated_at > to_timestamp(($2::bigint - 5000) / 1000.0)
                            ORDER BY created_at_ms`, [code, since])).rows;
    const out = {
      ok: true, now_ms: Number(t.now_ms), phase: t.phase, created_by: t.created_by,
      members: members.map(m => ({ pid: m.participant_id, cur: m.current_node_id, online: m.online, done_ok: m.done_ok, infl_done: m.sr_infl_done, own_done: m.sr_own_done })),
      done: { active: t.done_active, by: t.done_by, round: t.done_round, requested_ms: Number(t.done_requested_ms) || 0,
              decline: t.last_decline_by ? { by: t.last_decline_by, ms: Number(t.last_decline_ms) || 0 } : null },
      nodes: nodes.map(n => ({ ...n, created_at_ms: Number(n.created_at_ms) })),
    };
    if (t.phase === 'self_report' || t.phase === 'finished') {
      out.infl = (await q(`SELECT node_id, from_node_id, participant_id FROM ideagit_c_influence WHERE team_code=$1 AND checked`, [code])).rows;
    }
    res.json(out);
  }));

  // Save / update nodes. Contributors and creator are fixed at creation (edited through /tags).
  app.post('/api/c/nodes/save', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20), nodes = b.nodes;
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    if (!Array.isArray(nodes) || !nodes.length || nodes.length > 200 || nodes.some(n => !n || typeof n.node_id !== 'string' || !n.node_id))
      return bad(res, 'Invalid nodes.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const n of nodes) {
        const cur = (await client.query('SELECT * FROM ideagit_c_nodes WHERE team_code=$1 AND node_id=$2 FOR UPDATE', [code, n.node_id])).rows[0];
        const extras = Array.isArray(n.extras) ? n.extras : [];
        if (!cur) {
          await client.query(
            `INSERT INTO ideagit_c_nodes (team_code,node_id,group_id,parent_id,type,tag,title,body,is_finalized,user_prompt,ai_response,extras,
                                          created_by,contributors,created_at_ms,created_at,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,to_timestamp($15::bigint/1000.0),$16)`,
            [code, n.node_id, str(n.group_id, 80), n.parent_id ? str(n.parent_id, 80) : null, str(n.type, 40), str(n.tag, 40), str(n.title, 500), str(n.body, 20000),
             !!n.is_finalized, str(n.user_prompt, 20000), str(n.ai_response, 60000), JSON.stringify(extras),
             cleanPid(n.created_by) || pid, JSON.stringify(cleanList(n.contributors)), Number(n.created_at_ms) || Date.now(), pid]);
        } else if (!cur.deleted) {
          const merged = mergeExtras(cur.extras, extras);
          const same = cur.is_finalized === !!n.is_finalized && cur.title === str(n.title, 500) && cur.ai_response === str(n.ai_response, 60000) && canon(cur.extras) === canon(merged);
          if (!same) await client.query(
            `UPDATE ideagit_c_nodes SET title=$3, is_finalized=$4, ai_response=$5, extras=$6::jsonb, updated_by=$7, updated_at=clock_timestamp()
             WHERE team_code=$1 AND node_id=$2`,
            [code, n.node_id, str(n.title, 500), !!n.is_finalized, str(n.ai_response, 60000), JSON.stringify(merged), pid]);
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, saved: nodes.length });
  }));

  // Edit the contributor tag of a node
  app.post('/api/c/nodes/tags', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20), nodeId = str(b.node_id, 80), list = cleanList(b.contributors);
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    if (!list.length) return bad(res, 'Choose at least one contributor.');
    const cur = (await q('SELECT contributors FROM ideagit_c_nodes WHERE team_code=$1 AND node_id=$2 AND NOT deleted', [code, nodeId])).rows[0];
    if (!cur) return bad(res, 'Unknown node.', 404);
    if (canon(cur.contributors) !== canon(list)) {
      await q('UPDATE ideagit_c_nodes SET contributors=$3::jsonb, updated_by=$4, updated_at=clock_timestamp() WHERE team_code=$1 AND node_id=$2', [code, nodeId, JSON.stringify(list), pid]);
      await q('INSERT INTO ideagit_c_tag_log (team_code,node_id,edited_by,old_contributors,new_contributors) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
        [code, nodeId, pid, JSON.stringify(cur.contributors), JSON.stringify(list)]);
    }
    res.json({ ok: true, contributors: list });
  }));

  // Discard: the rows are kept (hidden from everyone) so the research data stays complete
  app.post('/api/c/nodes/discard', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20), ids = Array.isArray(b.node_ids) ? b.node_ids.filter(x => typeof x === 'string').slice(0, 200) : [];
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    if (!ids.length) return bad(res, 'node_ids is required.');
    await q(`UPDATE ideagit_c_nodes SET deleted=TRUE, deleted_by=$3, deleted_at=now(), updated_by=$3, updated_at=clock_timestamp()
             WHERE team_code=$1 AND node_id = ANY($2::text[]) AND NOT deleted`, [code, ids, pid]);
    res.json({ ok: true });
  }));

  // "Done with task": one member asks, everybody must approve
  app.post('/api/c/done/request', need, wrap(async (req, res) => {
    const pid = cleanPid((req.body || {}).pid), code = str((req.body || {}).code, 20);
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    const t = (await q('SELECT phase FROM ideagit_c_teams WHERE team_code=$1', [code])).rows[0];
    if (!t || t.phase !== 'working') return bad(res, 'The team is not working right now.');
    const fin = (await q('SELECT count(*)::int AS c FROM ideagit_c_nodes WHERE team_code=$1 AND is_finalized AND NOT deleted', [code])).rows[0].c;
    if (!fin) return bad(res, 'Please finalize at least one idea first.');
    await q(`UPDATE ideagit_c_members SET done_ok = (participant_id=$2) WHERE team_code=$1`, [code, pid]);
    await q(`UPDATE ideagit_c_teams SET done_active=TRUE, done_by=$2, done_round=done_round+1, done_requested_at=now() WHERE team_code=$1`, [code, pid]);
    await settleDone(code);
    res.json({ ok: true });
  }));
  app.post('/api/c/done/respond', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20);
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    const t = (await q('SELECT done_active FROM ideagit_c_teams WHERE team_code=$1', [code])).rows[0];
    if (!t || !t.done_active) return res.json({ ok: true, inactive: true });
    if (b.approve === true) {
      await q('UPDATE ideagit_c_members SET done_ok=TRUE WHERE team_code=$1 AND participant_id=$2', [code, pid]);
      await settleDone(code);
    } else {   // somebody wants to keep working: back to work for everyone
      await q(`UPDATE ideagit_c_teams SET done_active=FALSE, last_decline_by=$2, last_decline_at=now() WHERE team_code=$1`, [code, pid]);
    }
    res.json({ ok: true });
  }));
  app.post('/api/c/done/cancel', need, wrap(async (req, res) => {
    const pid = cleanPid((req.body || {}).pid), code = str((req.body || {}).code, 20);
    await q('UPDATE ideagit_c_teams SET done_active=FALSE WHERE team_code=$1 AND done_by=$2', [code, pid]);
    res.json({ ok: true });
  }));
  async function settleDone(code) {
    const left = (await q('SELECT count(*)::int AS c FROM ideagit_c_members WHERE team_code=$1 AND NOT done_ok', [code])).rows[0].c;
    if (!left) await q(`UPDATE ideagit_c_teams SET done_active=FALSE, phase='self_report', done_confirmed_at=now() WHERE team_code=$1 AND phase='working'`, [code]);
  }

  // Questions after the task: influence (per member), then ownership + explanation (per member)
  app.post('/api/c/sr/influence', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20), picks = Array.isArray(b.picks) ? b.picks : [];
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    if (picks.length > 400 || picks.some(p => !p || typeof p.node_id !== 'string' || typeof p.from_node_id !== 'string')) return bad(res, 'Invalid picks.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM ideagit_c_influence WHERE team_code=$1 AND participant_id=$2', [code, pid]);
      for (const p of picks) await client.query(
        `INSERT INTO ideagit_c_influence (team_code,node_id,from_node_id,participant_id,checked) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`, [code, str(p.node_id, 80), str(p.from_node_id, 80), pid, p.checked === true]);
      await client.query('UPDATE ideagit_c_members SET sr_infl_done=TRUE WHERE team_code=$1 AND participant_id=$2', [code, pid]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true });
  }));
  app.post('/api/c/sr/ownership', need, wrap(async (req, res) => {
    const b = req.body || {}, pid = cleanPid(b.pid), code = str(b.code, 20), answers = Array.isArray(b.answers) ? b.answers : [];
    if (!(await isMember(code, pid))) return bad(res, 'You are not a member of this team.', 403);
    if (!answers.length || answers.length > 200 || answers.some(a => !a || typeof a.node_id !== 'string' || !(a.own >= 1 && a.own <= 5)))
      return bad(res, 'Invalid answers.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const a of answers) {
        const own = Math.round(Number(a.own));
        await client.query(
          `INSERT INTO ideagit_c_ownership (team_code,node_id,participant_id,ownership,ownership_label,explanation) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (team_code,node_id,participant_id) DO UPDATE SET ownership=EXCLUDED.ownership, ownership_label=EXCLUDED.ownership_label,
                                                                       explanation=EXCLUDED.explanation, created_at=now()`,
          [code, str(a.node_id, 80), pid, own, OWN_LABELS[own - 1], str(a.explanation, 3000)]);
      }
      await client.query('UPDATE ideagit_c_members SET sr_own_done=TRUE, sr_done_at=now() WHERE team_code=$1 AND participant_id=$2', [code, pid]);
      const left = (await client.query('SELECT count(*)::int AS c FROM ideagit_c_members WHERE team_code=$1 AND NOT sr_own_done', [code])).rows[0].c;
      if (!left) await client.query(`UPDATE ideagit_c_teams SET phase='finished', finished_at=now() WHERE team_code=$1 AND phase='self_report'`, [code]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true });
  }));

  // CSV exports for the researchers (same password as /admin):  /admin/c/teams.csv, members, nodes, influence, ownership, tag_log
  app.get('/admin/c/:name.csv', adminAuth, need, wrap(async (req, res) => {
    const name = req.params.name;
    if (!['teams', 'members', 'nodes', 'influence', 'ownership', 'tag_log'].includes(name)) return bad(res, 'Unknown table.', 404);
    const order = { nodes: 'team_code, created_at_ms', tag_log: 'id', teams: 'created_at' }[name] || 'team_code';
    const rows = (await q(`SELECT * FROM ideagit_c_${name} ORDER BY ${order}`)).rows;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\n');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="conditionC_${name}.csv"`).send('﻿' + csv);
  }));
}

module.exports = { register, initTeamsDb };
