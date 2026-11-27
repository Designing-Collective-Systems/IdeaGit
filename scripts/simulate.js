#!/usr/bin/env node
// ============================================================
//  IdeaForest variant 2 - simulate students
//
//  Each simulated student does what a real participant does, through the same HTTP API the browser uses:
//    open the site (new participant / PID) -> sign the consent form -> write 3 ideas (some typed by
//    the student, some AI-generated), edit each of them a few times (manual or AI edits, sometimes
//    branching from an earlier version) -> finalize 2 of the 3 ideas -> "Done with Task" ->
//    answer the three questions for every finalized idea -> Submit.
//  AI is REALLY called (through the app's own /api/claude proxy, with the app's own prompts from
//  public/prompts.js): "create with AI" and "edit with AI". That uses your Anthropic key and costs
//  money - see --max-ai-calls. Use --no-ai for a free run with canned AI texts.
//
//  Usage (Node 18+, no packages needed):
//    node scripts/simulate.js --base http://localhost:3000
//    node scripts/simulate.js --base https://your-test-app.herokuapp.com --students 120 --concurrency 10
//
//  Options:
//    --base URL            where the app runs (default http://localhost:3000)
//    --students N          number of students (default 120)
//    --concurrency N       students working at the same time (default 10)
//    --seed N              random seed, for reproducible data (default 42)
//    --ideas N             ideas created per student (default 3)
//    --finalize N          how many of them each student finalizes (default 2, at most --ideas)
//    --branch P            chance that an edit branches from an earlier version, 0-1 (default 0.15)
//    --strict              AI failures are NOT hidden: a failed AI call (after its retries) makes that student fail
//    --no-ai               do not call the AI; use canned texts instead (free, instant)
//    --max-ai-calls N      safety cap on real AI calls (default 3000); after that, canned texts are used
//    --admin-password PW   (optional) the ADMIN_PASSWORD: afterwards, checks the participant list and
//                          that all PIDs are different
//
//  The app server must have ANTHROPIC_API_KEY set (it does the real calls).
//  !! Run it against a TEST app/database, not the real study: it creates 120 participants. Every
//  simulated consent name starts with "SIMULATED" so you can recognise them (and delete them on /admin).
// ============================================================
'use strict';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? a.concat([[x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']]) : a), []));
const BASE = (args.base || 'http://localhost:3000').replace(/\/$/, '');
const N = parseInt(args.students || '120', 10);
const CONC = Math.max(1, parseInt(args.concurrency || '10', 10));
const SEED = parseInt(args.seed || '42', 10);
const P_BRANCH = Math.min(1, Math.max(0, parseFloat(args.branch ?? '0.15')));
const ADMIN_PW = args['admin-password'];
const USE_AI = args['no-ai'] === undefined;
const STRICT = args.strict !== undefined;
const IDEAS = Math.max(1, parseInt(args.ideas || '3', 10));
const FINALIZE = Math.min(IDEAS, Math.max(1, parseInt(args.finalize || '2', 10)));
const MAX_AI = parseInt(args['max-ai-calls'] || '3000', 10);

// the app's own prompts and design challenge (read from public/, so they are always the same as the real app's)
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const PROMPTS = vm.runInNewContext(fs.readFileSync(path.join(PUB, 'prompts.js'), 'utf8') + '\n;PROMPTS');
const sharedSrc = fs.readFileSync(path.join(PUB, 'shared.js'), 'utf8');
const CHALLENGE = vm.runInNewContext(sharedSrc.slice(sharedSrc.indexOf('const FIXED_CHALLENGE'), sharedSrc.indexOf('.join("\\n\\n");') + '.join("\\n\\n");'.length) + '\n;FIXED_CHALLENGE');

// ── seeded random numbers (same seed = same students) ──
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const makeRng = seed => { const r = mulberry32(seed); return { f: r, int: (a, b) => a + Math.floor(r() * (b - a + 1)), pick: arr => arr[Math.floor(r() * arr.length)], chance: p => r() < p }; };

// ── canned content ──
const WHO = ['first-year students', 'commuters', 'people who live alone', 'night-shift workers', 'older adults', 'group-project teams', 'new parents', 'remote workers'];
const WHAT = ['a shared kitchen scheduling app', 'a pocket-sized air-quality sensor', 'a tool that turns lecture recordings into study cards', 'a neighbourhood tool-lending library',
  'a reusable-container return system for cafes', 'a bike-route planner that avoids steep hills', 'a habit tracker that works through text messages', 'a noise-aware study-room finder',
  'a lost-and-found board that matches photos', 'a meal planner that uses what is already in the fridge'];
const HOW = ['using a simple QR code on the item', 'with a weekly summary sent by email', 'by letting people vote on what is built next', 'through a small badge that shows progress',
  'by pairing every user with one partner', 'with an offline mode that syncs later', 'by showing one number that is easy to understand', 'using a low-cost sensor and a free app'];
const EDITS = ['Add who would pay for it.', 'Make it cheaper to build.', 'Explain how a person would start using it on day one.', 'Add a way to measure whether it works.',
  'Make it work without internet.', 'Add a safety or privacy protection.', 'Shorten it and keep the main point.', 'Say what is different from existing apps.'];
const rngText = (r, topic) => `${topic ? topic + ' ' : ''}An idea for ${r.pick(WHO)}: ${r.pick(WHAT)}, ${r.pick(HOW)}. It would be tested with a small group first and improved from their feedback.`;
const MORE = (r) => ` ${r.pick(['A pilot could run for one month.', 'The first version would be a paper prototype.', 'Costs would be kept under a hundred dollars.', 'Volunteers would run it at first.', 'It would be free for students.'])}`;
const LEARNED = ['I learned that AI is good at giving me a starting point, but I had to decide what was actually useful.', 'AI helped me see angles I had not thought of; I still had to shape the final idea myself.', 'I learned that how specifically I ask changes the quality of what AI gives me.', 'AI was fast, but I needed to check whether its ideas really fit the constraints.'];
const PARTNER = ['They said AI helped them explore more ideas quickly, but they felt less ownership of the result.', 'My partner learned that editing the AI ideas made them feel more like their own.', 'They found that AI repeated itself unless they pushed it in a new direction.', 'They said AI was most useful for refining details rather than for the first idea.'];
const AI_USE = [
  'Yes. I asked the AI for a few starting ideas and then rewrote them in my own words, because I was stuck at the beginning.',
  'Yes, mostly to get more detail on ideas I already had. I asked it to make them more concrete.',
  'No. I wanted the idea to be my own, and I had enough ideas already.',
  'A little. I used it to check my idea for problems, but I wrote the idea myself.',
  'Yes. I used the default edit button several times to see what would change, and kept the versions I liked.',
  'No, I did not think it would help with this idea; I knew what I wanted to build.'];
const EXPLORED = [
  'Yes. I tried several different directions at first so I could compare them and pick the strongest.',
  'Not much. I had one idea early that I liked, so I spent my time improving it.',
  'Yes, because the first version was too general, and a second branch let me test a different audience.',
  'No. I did not want to lose time starting over.',
  'A bit. I made one alternative version, then went back to the original because it was clearer.'];
const REFINED = [
  'Yes. I edited it several times to add who it is for and how it would work.',
  'Yes, the first draft was vague, so I added details and removed parts that did not fit.',
  'Only slightly. I fixed the wording and added one sentence about cost.',
  'Yes, because feedback from the AI showed a missing step, so I rewrote that part.',
  'No, I was happy with the first version.'];

// ── API helper (every call carries the tab's secret token, like the browser does) ──
let sent = 0, failed = 0;
// everything that goes wrong is counted by kind, so a crash is reported clearly at the end
const problems = {};
const noteProblem = (kind, detail) => { (problems[kind] = problems[kind] || { n: 0, first: detail }).n++; };
const classify = (status, err) => {
  if (err) return /abort|timeout/i.test(err.name + err.message) ? 'TIMEOUT (no answer in time - server hung or overloaded)'
    : 'CONNECTION LOST (refused / reset - the server is down or crashed)';
  if (status === 502 || status === 503 || status === 504) return `HTTP ${status} (server crashed, restarting or overloaded)`;
  if (status >= 500) return `HTTP ${status} (server error - e.g. database or code error)`;
  if (status === 429) return 'HTTP 429 (rate limited)';
  return `HTTP ${status}`;
};
async function guardedFetch(url, opts, ms) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
  catch (e) { const k = classify(0, e); noteProblem(k, `${opts.method || 'GET'} ${url.replace(BASE, '')}: ${e.cause?.code || e.message}`); throw new Error(k); }
}
async function api(token, method, path, body) {
  sent++;
  const res = await guardedFetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Participant-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined }, 60000);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  if (!res.ok) { failed++; noteProblem(classify(res.status), `${method} ${path}: ${text.slice(0, 100).replace(/\s+/g, ' ')}`); throw new Error(`${method} ${path} -> HTTP ${res.status} ${text.slice(0, 120)}`); }
  return json;
}

// ── real AI calls, the way the browser makes them ──
const stat = { aiCalls: 0, aiFailed: 0, aiFallback: 0, retries: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callClaude(token, messages, system = '', maxTokens = 8192) {
  const body = { model: 'claude-sonnet-5-5', max_tokens: maxTokens, messages }; if (system) body.system = system;
  for (let attempt = 0; ; attempt++) {
    stat.aiCalls++;
    const res = await guardedFetch(BASE + '/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token }, body: JSON.stringify(body) }, 180000);
    if (res.ok) {
      const data = await res.json();
      if (data.stop_reason === 'max_tokens' && maxTokens < 32000) return callClaude(token, messages, system, maxTokens * 2);   // same as the app
      return data.content.filter(b => b.type === 'text').map(b => b.text).join('') || data.content[0].text;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { stat.retries++; await sleep(Math.min(30000, 1000 * 2 ** attempt) * (0.5 + Math.random())); continue; }   // rate limit / overloaded: wait and retry
    const t = await res.text(); noteProblem(res.status === 429 ? 'HTTP 429 on an AI call (rate limited)' : `HTTP ${res.status} on an AI call (the AI or its key failed - not necessarily your server)`, `/api/claude: ${t.slice(0, 100).replace(/\s+/g, ' ')}`); throw new Error(`AI call failed: HTTP ${res.status} ${t.slice(0, 160)}`);
  }
}
function parseAIJSON(text) {                                                // same recovery rules as the app
  let t = String(text).replace(/```json|```/g, '').trim(); const a = t.indexOf('{'); if (a > 0) t = t.slice(a);
  const b = t.lastIndexOf('}'), whole = t;
  for (const c of [t, b > 0 ? t.slice(0, b + 1) : t, whole + '}', whole + '"}']) { try { return JSON.parse(c); } catch (e) {} }
  const m = whole.match(/"body"\s*:\s*"([\s\S]*?)"?\s*(?:,\s*"\w+"\s*:|\}?\s*$)/);
  if (m && m[1].trim()) return { body: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() };
  throw new Error('Could not read the AI reply: ' + String(text).slice(0, 120).replace(/\s+/g, ' '));
}
async function enforceWords(token, body, userMsg) {                         // same 70-word rule as the app (may cost a 2nd call)
  const wc = t => (t || '').trim().split(/\s+/).length;
  if (wc(body) <= 70 || /longer|lengthy|\d+\s*words|paragraph|more words|in depth|in-depth|elaborate at length/i.test(userMsg || '')) return body;
  try { const out = (await callClaude(token, [{ role: 'user', content: 'Shorten this design idea to 60 words or fewer, keeping every key feature. Return only the text, no quotes.\n\n' + body }], 'You tighten text without changing its meaning.')).trim(); return wc(out) < wc(body) ? out : body; } catch (e) { return body; }
}
// runs `real()` (a real AI call) unless AI is off / the cap is reached / it fails; then `canned()` is used instead
async function withAI(real, canned) {
  if (!USE_AI || stat.aiCalls >= MAX_AI || (!STRICT && stat.aiFailed >= 10)) { stat.aiFallback++; return canned(); }   // after 10 failed AI calls (and no --strict) the AI counts as down, so the run does not crawl
  try { return await real(); } catch (e) { if (STRICT) throw e; stat.aiFailed++; stat.aiFallback++; if (stat.aiFailed <= 3) console.log('\n  (AI call failed, using canned text: ' + e.message + ')'); if (stat.aiFailed === 10) console.log('\n  ⚠ 10 AI calls failed: the AI looks unavailable, so the rest of the run uses canned text.'); return canned(); }
}
const existingSummary = nodes => { const roots = nodes.filter(n => !n.parentId && n.body); return roots.length ? '\n\nExisting ideas (do NOT repeat):\n' + roots.map((n, i) => `${i + 1}. ${n.body.slice(0, 100)}`).join('\n') : ''; };

const rowOf = n => ({ node_id: n.id, group_id: n.groupId, parent_id: n.parentId, type: n.type, tag: n.tag, title: '', body: n.body, is_finalized: n.isFinalized,
  user_prompt: n.userPrompt, ai_response: n.aiResponse, extras: n.extras, meta: n.meta, created_at_ms: n.ts });

async function simulateStudent(i) {
  const r = makeRng(SEED * 100003 + i);
  const tag = String(i + 1).padStart(3, '0');
  const { token } = await api(null, 'POST', '/api/start');                 // opening the site: new participant
  const me = await api(token, 'GET', '/api/me'); if (me.consented) throw new Error('new participant should not have consented');
  await api(token, 'POST', '/api/consent', { full_name: `SIMULATED Student ${tag}` });

  let clock = Date.now() - r.int(40, 60) * 60000;                           // virtual time: the session "lasted" ~30-50 minutes
  const tick = () => (clock += r.int(8, 150) * 1000);
  const nodes = []; let seq = 0;
  const mk = (o) => { const n = { id: `n${clock}_${(++seq).toString(36)}${r.int(100, 999)}`, parentId: null, groupId: null, type: 'creation', tag: 'user-created', body: '', userPrompt: '', aiResponse: '', extras: [], isFinalized: false, meta: {}, ts: tick(), ...o };
    n.groupId = n.groupId || n.id; nodes.push(n); return n; };
  const save = async (changed) => { await api(token, 'POST', '/api/save-nodes', { nodes: changed.map(rowOf) }); };

  const nIdeas = IDEAS, finals = [];
  const toFinalize = new Set(Array.from({ length: nIdeas }, (_, k) => k).sort(() => r.f() - 0.5).slice(0, FINALIZE));   // which of the ideas this student finalizes
  for (let k = 0; k < nIdeas; k++) {
    // creation: typed by the student, or generated by the AI (default or custom prompt)
    let root;
    if (r.chance(0.6)) root = mk({ type: 'creation', tag: 'user-created', body: rngText(r) });
    else {
      const { system, editable, hiddenSuffix } = PROMPTS.generateIdea(CHALLENGE, existingSummary(nodes));
      const custom = r.chance(0.35), prompt = custom ? r.pick(['Generate a creative design idea for this challenge that makes people more aware of their scrolling.', 'Generate a creative design idea for this challenge that uses rewards or small goals.', 'Generate a creative design idea for this challenge that involves friends or family.']) + `\n\nChallenge: "${CHALLENGE}"` : editable;
      const body = await withAI(async () => { const json = parseAIJSON(await callClaude(token, [{ role: 'user', content: prompt + hiddenSuffix }], system)); return enforceWords(token, json.body, prompt); }, () => rngText(r, 'AI:'));
      root = mk({ type: 'creation', tag: 'ai-generated', body, userPrompt: prompt, aiResponse: '', extras: custom ? [{ type: 'custom_prompt', ts: clock }] : [] });
    }
    await save([root]);
    // a few edits (a chain; sometimes a branch from an earlier version)
    const versions = [root]; let cur = root;
    for (let e = r.int(2, 4); e > 0; e--) {
      const parent = (versions.length > 1 && r.chance(P_BRANCH)) ? r.pick(versions.slice(0, -1)) : cur;   // branch = a 2nd child of an older version
      let node;
      if (r.chance(0.5)) node = mk({ parentId: parent.id, groupId: parent.groupId, type: 'modification', tag: 'manual-modification', userPrompt: '[Manual modification]', body: parent.body + MORE(r) });
      else {
        const prompt = r.chance(0.5) ? 'Edit the current idea to provide more details' : r.pick(EDITS);
        const { system, user } = PROMPTS.modifyIdeaChat(parent.body, CHALLENGE, prompt, '');
        let reply = null;
        const body = await withAI(async () => { const json = parseAIJSON(reply = await callClaude(token, [{ role: 'user', content: user }], system)); return enforceWords(token, json.body, prompt); }, () => parent.body + MORE(r));
        node = mk({ parentId: parent.id, groupId: parent.groupId, type: 'modification', tag: 'ai-modification', userPrompt: prompt, aiResponse: reply ? JSON.stringify(parseAIJSON(reply)) : JSON.stringify({ body }), body });
      }
      if (r.chance(0.2)) parent.extras.push({ type: 'clarification', userPrompt: 'What do you mean by that?', aiResponse: 'It means the idea would be tested in a small pilot first.', ts: tick() });
      await save(parent === cur ? [node] : [node, parent]);
      versions.push(node); cur = node;
    }
    // finalize this idea (only for the chosen ones): usually the latest version, sometimes an earlier one
    if (toFinalize.has(k)) { const fin = r.chance(0.85) ? cur : r.pick(versions); fin.isFinalized = true; await save([fin]); finals.push(fin); }
  }

  // "Done with Task" -> the questions for every finalized idea (saved per page, then submitted)
  const answers = finals.map(f => ({ node_id: f.id, ai_use: r.pick(AI_USE), explored: r.pick(EXPLORED), refined: r.pick(REFINED) }));
  for (let p = 1; p < answers.length; p++) await api(token, 'POST', '/api/final-answers', { answers: answers.slice(0, p), finish: false });   // "Next →"
  await save(nodes);                                                         // the app saves ideas before submitting
  await api(token, 'POST', '/api/final-answers', { answers, finish: false }); // last idea's "Submit"
  const reflections = { learned: r.pick(LEARNED), partner: r.pick(PARTNER) };
  await api(token, 'POST', '/api/final-answers', { answers, reflections, finish: true });  // the two final questions' "Submit"

  // check what the server stored for this participant
  const back = await api(token, 'GET', '/api/load-nodes'), fa = await api(token, 'GET', '/api/final-answers');
  const ok = back.nodes.length === nodes.length && back.nodes.filter(n => n.is_finalized).length === finals.length && fa.answers.length === finals.length && fa.finished === true && !!(fa.reflections && fa.reflections.learned && fa.reflections.partner);
  if (!ok) throw new Error(`student ${tag}: stored data does not match (nodes ${back.nodes.length}/${nodes.length}, finalized ${back.nodes.filter(n => n.is_finalized).length}/${finals.length}, answers ${fa.answers.length}/${finals.length}, finished ${fa.finished})`);
  return { nodes: nodes.length, finalized: finals.length, branches: new Set(nodes.filter(n => n.parentId).map(n => n.parentId).filter(p => nodes.filter(n => n.parentId === p).length >= 2)).size };
}

(async () => {
  console.log(`Simulating ${N} students against ${BASE} (concurrency ${CONC}, seed ${SEED}, branch chance ${P_BRANCH}, AI ${USE_AI ? 'ON, cap ' + MAX_AI + ' calls' : 'off'})`);
  const t0 = Date.now(); const results = [], errors = []; let next = 0, done = 0;
  async function worker() {
    while (next < N) {
      const i = next++;
      try { results.push(await simulateStudent(i)); } catch (e) { errors.push(`#${i + 1}: ${e.message}`); }
      if (++done % 10 === 0 || done === N) process.stdout.write(`\r  ${done}/${N} finished (${errors.length} failed)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, N) }, worker));
  const secs = ((Date.now() - t0) / 1000).toFixed(1), sum = k => results.reduce((a, x) => a + x[k], 0);
  console.log(`\n\nDone in ${secs}s · ${sent} requests (${failed} failed)`);
  console.log(USE_AI ? `AI: ${stat.aiCalls} calls (${stat.retries} retried after errors/rate limits), ${stat.aiFailed} failed, ${stat.aiFallback} replaced by canned text` : 'AI: off (--no-ai), canned texts used');
  console.log(`Completed students: ${results.length}/${N} · nodes ${sum('nodes')} · finalized ideas ${sum('finalized')} · answers ${sum('finalized')} · branch points ${sum('branches')}`);
  // is the server still alive?
  let alive = true, aliveWhy = '';
  try { const h = await fetch(BASE + '/consent', { signal: AbortSignal.timeout(15000) }); if (!h.ok) { alive = false; aliveWhy = `HTTP ${h.status}`; } } catch (e) { alive = false; aliveWhy = e.cause?.code || e.message; }
  const crashKinds = Object.keys(problems).filter(k => /CONNECTION LOST|TIMEOUT|HTTP 50[234]/.test(k));
  if (!alive || crashKinds.length || errors.length) {
    console.log('\n' + '█'.repeat(70));
    console.log(!alive || crashKinds.length ? '  ❌ THE SERVER CRASHED OR COULD NOT HANDLE THE LOAD' : '  ❌ SOME STUDENTS FAILED');
    console.log('█'.repeat(70));
    if (!alive) console.log(`  After the run the server did NOT answer (${aliveWhy}). It is down.`);
    else if (crashKinds.length) console.log('  The server is answering again now, but it failed to answer during the run.');
    console.log(`  Students that failed: ${errors.length} of ${N}`);
    console.log('  What went wrong (count - kind - first example):');
    Object.entries(problems).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`    ${String(v.n).padStart(5)} × ${k}\n          e.g. ${v.first}`));
    console.log('  First failed students:'); errors.slice(0, 10).forEach(e => console.log('    ' + e));
    console.log('  Check the server logs (heroku logs --tail) for the cause.');
  } else console.log('\n✅ No crashes and no failures: the server answered every request.');
  if (stat.aiFallback && USE_AI) console.log(`\n⚠ ${stat.aiFallback} AI steps used canned text instead of the AI (${stat.aiFailed} because the AI call failed). Use --strict to count those as failures.`);
  if (ADMIN_PW) {                                                           // optional: check the researcher view
    const res = await fetch(BASE + '/admin/api/users', { headers: { Authorization: 'Basic ' + Buffer.from('admin:' + ADMIN_PW).toString('base64') } });
    if (!res.ok) console.log(`Admin check failed: HTTP ${res.status}`);
    else {
      const sim = (await res.json()).users.filter(u => /^SIMULATED/.test(u.consent_name || ''));
      const pids = new Set(sim.map(u => u.pid));
      console.log(`Admin list: ${sim.length} simulated participants, ${pids.size} different PIDs, ${sim.filter(u => u.finished_at).length} finished, ${sim.reduce((a, u) => a + u.answered, 0)} answers`);
    }
  }
  process.exit(errors.length ? 1 : 0);
})();
