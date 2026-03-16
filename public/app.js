// ============================================================
//  IdeaGit — Main Application
// ============================================================

const S = {
  challenge: '',
  nodes: [],
  groups: [],
  curId: null,
  chatHistory: [],
  nodeIsLocked: false,
  _lastChatPrompt: '',
  _lastSuggestions: [],
  activityLog: [],
};

document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-theme', 'light');
  initGraphPan();
  populateChallengeDropdown();
});

// ============================================================
//  INSTRUCTIONS SLIDESHOW
// ============================================================
const SLIDES = [
  {
    title: '1 · Select a Design Challenge',
    img: 'instructions/slide1.png',
    body: 'Use the dropdown to pick a design challenge and read it carefully. Then click <strong>Start Ideation →</strong> to begin — you will be taken to the ideation workspace.',
  },
  {
    title: '2 · Generate Your First Idea',
    img: 'instructions/slide2.png',
    body: 'Click <strong>"Generate with AI"</strong> to let AI create an idea from scratch, or use the <strong>"Create Manually"</strong> button to type your own title and description. Ideas are created <strong>one at a time</strong> — use <strong>+ New Idea</strong> in the top bar to start another.',
  },
  {
    title: '3 · Modify Your Idea',
    img: 'instructions/slide3.png',
    body: 'Once an idea is submitted, use the four action buttons to develop it:<br><br><strong>Modify Manually</strong> — edit the idea yourself<br><strong>Modify Automatically</strong> — allow AI to modify the idea by itself<br><strong>Modify by Chatting</strong> — interact with AI to modify the idea<br><strong>Finalize</strong> — mark the idea as complete<br><strong>AI Feedback</strong> — get a short critique<br><strong>+New Idea</strong> — start a new idea<br><br>The first four actions create a new node — the original is always preserved.',
  },
  {
    title: '4 · Modify by Chatting',
    img: 'instructions/slide4.png',
    body: 'Type what you want to change and press Enter — AI will reply with specific suggestions to pick from. Select the ones you want and click <strong>Apply Selected</strong>.',
  },
  {
    title: '5 · Navigation Bar',
    img: 'instructions/slide5.png',
    body: 'The top bar has everything you need:<br><br><strong>TEXT / GRAPH</strong> — switch between idea editor and visual graph<br><strong>Export CSV</strong> — save your ideas (do this before switching challenges!)<br><strong>+ New Idea</strong> — start a brand new idea branch<br><strong>Instructions</strong> — re-open this guide at any time',
  },
  {
    title: '6 · Graph View',
    img: 'instructions/slide6.png',
    body: 'Click <strong>GRAPH</strong> to see all your ideas as a branching tree. Each node is a version of an idea — modifications branch off from the original. Colours indicate how each node was created (user, AI generated, manual edit, etc.). <strong>Drag</strong> the canvas to pan. <strong>Click any node</strong> to jump back to that version in the editor.',
  },
  {
    title: '7 · Your Task',
    img: 'instructions/slide7.png',
    body: 'Select <strong>one design challenge</strong> and generate at least <strong>5 distinct ideas</strong> using any combination of tools. When done, click <strong>Export CSV</strong> to save your work — this is your submission.<br><br>You are welcome to explore the tool as much as you like. The minimum is <strong>5 ideas for 1 challenge</strong>.',
  },
];

let _curSlide = 0;

function renderSlide() {
  const s = SLIDES[_curSlide];
  document.getElementById('slide-title').textContent = s.title;
  document.getElementById('slide-body').innerHTML = s.body;
  const imgWrap = document.getElementById('slide-img-wrap');
  const img = document.getElementById('slide-img');
  imgWrap.style.display = '';
  img.src = s.img; img.alt = s.title;
  img.onerror = () => { imgWrap.style.display = 'none'; };
  document.getElementById('slide-dots').innerHTML = SLIDES.map((_, i) =>
    `<div class="slide-dot${i === _curSlide ? ' active' : ''}" onclick="goSlide(${i})"></div>`
  ).join('');
  document.getElementById('slide-prev').style.visibility = _curSlide === 0 ? 'hidden' : '';
  document.getElementById('slide-next').textContent = _curSlide === SLIDES.length - 1 ? 'Done' : 'Next →';
  document.getElementById('slide-counter').textContent = `${_curSlide + 1} / ${SLIDES.length}`;
}

function goSlide(i) { _curSlide = Math.max(0, Math.min(i, SLIDES.length - 1)); renderSlide(); }
function slideNav(dir) { if (dir === 1 && _curSlide === SLIDES.length - 1) { closeInstructions(); return; } goSlide(_curSlide + dir); }
function openInstructions() { _curSlide = 0; document.getElementById('instructions-modal').style.display = 'flex'; renderSlide(); }
function closeInstructions() { document.getElementById('instructions-modal').style.display = 'none'; }

// ============================================================
//  UTILS
// ============================================================
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function uid() { return 'n' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }

function toast(msg, color='') {
  const el = document.createElement('div');
  el.className = 'toast'; if (color) el.style.borderColor = color;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

function logEvent(action, detail='') {
  S.activityLog.push({
    timestamp: new Date().toISOString(),
    action,
    detail,
    node_id: S.curId || '',
  });
}

function mkNode({ title='', body='', tag='user-created', parentId=null, meta={} }={}) {
  return { id: uid(), title, body, tag, parentId, meta, ts: Date.now() };
}

function tagInfo(tag) {
  return {
    'user-created':  { label: 'User Created',    cls: 'tag-user' },
    'ai-generated':  { label: 'AI Generated',    cls: 'tag-ai-gen' },
    'user-modified': { label: 'Manual Edit',      cls: 'tag-manual' },
    'ai-auto':       { label: 'AI Auto-Improved', cls: 'tag-ai-auto' },
    'ai-chat':       { label: 'AI Chat-Modified', cls: 'tag-ai-chat' },
    'finalized':     { label: 'Finalized',        cls: 'tag-finalized' },
  }[tag] || { label: tag, cls: 'tag-user' };
}

// ============================================================
//  CLAUDE API
// ============================================================
async function callClaude(messages, system='') {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages };
  if (system) body.system = system;
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error || 'API error ' + res.status); }
  return (await res.json()).content[0].text;
}

// Summary of existing ideas for duplicate-prevention prompt injection
function existingIdeasSummary() {
  const ideas = S.nodes.filter(n => n.title && n.body);
  if (!ideas.length) return '';
  return '\n\nExisting ideas already created (do NOT repeat or closely resemble these):\n' +
    ideas.map((n, i) => `${i+1}. "${n.title}" — ${n.body.slice(0, 120)}…`).join('\n');
}

// ============================================================
//  PAGE 1 — SETUP
// ============================================================
function populateChallengeDropdown() {
  const sel = document.getElementById('challenge-select');
  if (!sel || typeof DESIGN_CHALLENGES === 'undefined') return;
  DESIGN_CHALLENGES.forEach((ch, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = ch.title; sel.appendChild(opt);
  });
}

function onChallengeSelect() {
  const sel = document.getElementById('challenge-select');
  const desc = document.getElementById('challenge-desc');
  const startBtn = document.getElementById('start-btn');
  const idx = sel.value;
  if (idx === '') { desc.style.display = 'none'; desc.textContent = ''; startBtn.disabled = true; S.challenge = ''; return; }
  const ch = DESIGN_CHALLENGES[parseInt(idx)];
  S.challenge = ch.description;
  desc.textContent = ch.description; desc.style.display = '';
  startBtn.disabled = false;
  logEvent('challenge_selected', ch.title);
}

function clearChallenge() {
  document.getElementById('challenge-select').value = '';
  document.getElementById('challenge-desc').style.display = 'none';
  document.getElementById('challenge-desc').textContent = '';
  document.getElementById('start-btn').disabled = true;
  S.challenge = '';
}

function startIdeation() {
  if (!S.challenge) { toast('Select a design challenge first.'); return; }
  document.getElementById('page-setup').style.display = 'none';
  document.getElementById('page-ideation').style.display = 'flex';
  document.getElementById('view-toggle').style.display = 'flex';
  document.getElementById('export-btn').style.display = '';
  document.getElementById('nav-new-idea-btn').style.display = '';
  document.getElementById('challenge-banner-text').textContent = S.challenge;
  S.nodes=[]; S.groups=[]; S.curId=null; S.chatHistory=[];
  const node = mkNode({ tag:'user-created' });
  S.nodes.push(node); S.groups.push([node.id]); S.curId = node.id;
  S.nodeIsLocked = false;
  loadNode(node.id); switchView('text');
  logEvent('ideation_started');
}

function goToSetup() {
  if (S.nodes.some(n=>n.body) &&
      !confirm('Go back to home? Current session will be cleared. Export first if you want to save!')) return;
  document.getElementById('page-ideation').style.display = 'none';
  document.getElementById('page-setup').style.display = 'flex';
  document.getElementById('view-toggle').style.display = 'none';
  document.getElementById('export-btn').style.display = 'none';
  document.getElementById('nav-new-idea-btn').style.display = 'none';
}

// ============================================================
//  PAGE 2 — NODE STATE & DISPLAY
// ============================================================
function curNode() { return S.nodes.find(n => n.id === S.curId); }

// Show the three-way choice state for a blank new node
function showCreationChoice() {
  S.nodeIsLocked = false;
  document.getElementById('creation-choice').style.display = 'flex';
  document.getElementById('idea-inputs').style.display = 'none';
  document.getElementById('idea-display').style.display = 'none';
  document.getElementById('ai-generating').style.display = 'none';
  document.getElementById('btn-submit-idea').style.display = 'none';
  setActionButtonsEnabled(false);
  setFinalizeButtons(false);
}

// Show the manual text inputs
function showManualInputs() {
  document.getElementById('creation-choice').style.display = 'none';
  document.getElementById('idea-inputs').style.display = 'flex';
  document.getElementById('idea-display').style.display = 'none';
  document.getElementById('btn-submit-idea').style.display = '';
  document.getElementById('btn-modify-manual').disabled = true;
  setActionButtonsEnabled(false);
  setFinalizeButtons(false);
}

// Show the locked read-only display
function showLockedDisplay(node) {
  S.nodeIsLocked = true;
  document.getElementById('creation-choice').style.display = 'none';
  document.getElementById('idea-inputs').style.display = 'none';
  document.getElementById('ai-generating').style.display = 'none';
  document.getElementById('idea-display').style.display = 'flex';
  document.getElementById('display-title').textContent = node.title || '(untitled)';
  document.getElementById('display-body').textContent = node.body || '';
  document.getElementById('btn-submit-idea').style.display = 'none';
  // Show Regenerate only for ai-generated nodes that have no child nodes yet
  const hasChildren = S.nodes.some(n => n.parentId === node.id);
  const showRegen = node.tag === 'ai-generated' && !hasChildren;
  document.getElementById('regenerate-row').style.display = showRegen ? 'flex' : 'none';
  setActionButtonsEnabled(true);
  setFinalizeButtons(true, node.tag === 'finalized');
}

function setActionButtonsEnabled(on) {
  ['btn-modify-manual','btn-modify-auto','btn-modify-chat','btn-feedback'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
}

function setFinalizeButtons(show, isFinalized=false) {
  const fin = document.getElementById('btn-finalize');
  const unfin = document.getElementById('btn-unfinalize');
  if (!show) { fin.disabled = true; unfin.style.display = 'none'; return; }
  fin.disabled = isFinalized;
  unfin.style.display = isFinalized ? '' : 'none';
}

function loadNode(id) {
  const node = S.nodes.find(n => n.id === id); if (!node) return;
  S.curId = id;
  const { label, cls } = tagInfo(node.tag);
  const gIdx = S.groups.findIndex(g => g.includes(id));
  const pos   = gIdx >= 0 ? S.groups[gIdx].indexOf(id) + 1 : '?';
  const num   = S.nodes.indexOf(node) + 1;
  document.getElementById('node-badge').textContent = `Node #${num} · ${label}`;
  document.getElementById('node-badge').className   = 'badge ' + cls;
  document.getElementById('node-pos').textContent   = `Idea ${gIdx+1}  ·  Version ${pos}`;

  if (node.title || node.body) {
    showLockedDisplay(node);
  } else {
    showCreationChoice();
  }
}

function addNodeToGroup(node) {
  S.nodes.push(node);
  const gIdx = S.groups.findIndex(g => g.includes(S.curId));
  if (gIdx >= 0) S.groups[gIdx].push(node.id);
  S.curId = node.id;
}

// ============================================================
//  CREATION — MANUAL
// ============================================================
function chooseManualCreate() {
  logEvent('manual_create_chosen');
  showManualInputs();
  document.getElementById('idea-title').value = '';
  document.getElementById('idea-body').value = '';
  setTimeout(() => document.getElementById('idea-title').focus(), 50);
}

function cancelManualCreate() {
  showCreationChoice();
}

function submitManualIdea() {
  const title = document.getElementById('idea-title').value.trim();
  const body  = document.getElementById('idea-body').value.trim();
  if (!title) { toast('Please enter a title.', 'var(--amber)'); document.getElementById('idea-title').focus(); return; }
  if (!body)  { toast('Please describe your idea.', 'var(--amber)'); document.getElementById('idea-body').focus(); return; }
  const cur = curNode();
  cur.title = title; cur.body = body; cur.tag = 'user-created';
  loadNode(cur.id);
  logEvent('manual_idea_submitted', title);
  toast('Idea submitted', 'var(--cyan)');
}

// ============================================================
//  CREATION — AI GENERATE
// ============================================================
function chooseAICreate() {
  logEvent('ai_generate_chosen');
  document.getElementById('creation-choice').style.display = 'none';
  document.getElementById('ai-generating').style.display = 'flex';
  generateIdea();
}

async function generateIdea() {
  try {
    const existing = existingIdeasSummary();
    const { system, user } = PROMPTS.generateIdea(S.challenge, existing);
    const text = await callClaude([{ role:'user', content:user }], system);
    const json = JSON.parse(text.replace(/```json|```/g,'').trim());
    const cur = curNode();
    cur.title = json.title; cur.body = json.body; cur.tag = 'ai-generated';
    loadNode(cur.id);
    logEvent('ai_idea_generated', json.title);
    toast('Idea generated', 'var(--accent)');
  } catch(e) {
    document.getElementById('ai-generating').style.display = 'none';
    document.getElementById('creation-choice').style.display = 'flex';
    toast('Error: ' + e.message, 'var(--red)');
  }
}

async function regenerateIdea() {
  // Replace current ai-generated node content in-place (same node, no new branch)
  const cur = curNode();
  logEvent('ai_regenerate_requested', cur?.title || '');
  document.getElementById('regenerate-row').style.display = 'none';
  document.getElementById('ai-generating').style.display = 'flex';
  document.getElementById('idea-display').style.display = 'none';
  setActionButtonsEnabled(false);
  try {
    const existing = existingIdeasSummary();
    const { system, user } = PROMPTS.generateIdea(S.challenge, existing);
    const text = await callClaude([{ role:'user', content:user }], system);
    const json = JSON.parse(text.replace(/```json|```/g,'').trim());
    cur.title = json.title; cur.body = json.body;
    loadNode(cur.id);
    toast('New idea generated', 'var(--accent)');
  } catch(e) {
    loadNode(cur.id); // restore display
    toast('Error: ' + e.message, 'var(--red)');
  }
}

// ============================================================
//  MODIFY — MANUAL POPUP
// ============================================================
function openManualPopup() {
  const cur = curNode();
  if (!cur || !cur.body) { toast('No idea to modify.', 'var(--amber)'); return; }
  logEvent('modify_manually_opened', cur.title);
  document.getElementById('manual-title').value = cur.title || '';
  document.getElementById('manual-ta').value    = cur.body  || '';
  document.getElementById('manual-popup').style.display = 'flex';
  setTimeout(() => document.getElementById('manual-title').focus(), 50);
}

function closeManualPopup() {
  document.getElementById('manual-popup').style.display = 'none';
}

function saveManual() {
  const title = document.getElementById('manual-title').value.trim();
  const body  = document.getElementById('manual-ta').value.trim();
  if (!title) { toast('Please enter a title.', 'var(--amber)'); document.getElementById('manual-title').focus(); return; }
  if (!body)  { toast('Please enter a description.', 'var(--amber)'); return; }
  const cur = curNode();
  const nn = mkNode({ title, body, tag:'user-modified', parentId:cur.id });
  addNodeToGroup(nn); loadNode(nn.id); closeManualPopup();
  logEvent('manual_modify_saved', title);
  toast('Idea updated', 'var(--amber)');
}

// ============================================================
//  MODIFY — AUTO AI
// ============================================================
async function autoModify() {
  const cur = curNode();
  if (!cur || !cur.body) { toast('No idea to modify.', 'var(--amber)'); return; }
  logEvent('ai_auto_modify_started', cur.title);
  setActionButtonsEnabled(false);
  toast('Auto-improving…', 'var(--accent)');
  try {
    const { system, user } = PROMPTS.autoModify(cur.title, cur.body, S.challenge);
    const text = await callClaude([{ role:'user', content:user }], system);
    const m = text.match(/NEW_IDEA:\s*(\{[\s\S]*?\})/);
    if (m) {
      const json = JSON.parse(m[1]);
      const nn = mkNode({ title:json.title, body:json.body, tag:'ai-auto', parentId:cur.id, meta:{ method:'auto-improve' } });
      addNodeToGroup(nn); loadNode(nn.id);
      logEvent('ai_auto_modify_completed', json.title);
      toast('Idea improved', 'var(--accent)');
    } else { toast('AI did not return a valid idea. Try again.', 'var(--red)'); setActionButtonsEnabled(true); }
  } catch(e) { toast('Error: ' + e.message, 'var(--red)'); setActionButtonsEnabled(true); }
}

// ============================================================
//  MODIFY — CHAT POPUP
// ============================================================
function openChatPopup() {
  const cur = curNode();
  if (!cur || !cur.body) { toast('No idea to modify.', 'var(--amber)'); return; }
  logEvent('ai_chat_modify_opened', cur.title);
  S.chatHistory = [];
  S._lastChatPrompt = '';
  S._lastSuggestions = [];
  document.getElementById('chat-msgs').innerHTML = '';
  document.getElementById('chat-in').value = '';
  document.getElementById('chat-popup').style.display = 'flex';
  addBubble('assistant', 'Describe what you would like to change. AI will reply with specific suggestions you can select and apply.');
  setTimeout(() => document.getElementById('chat-in').focus(), 50);
}

function closeChatPopup() {
  document.getElementById('chat-popup').style.display = 'none';
}

function addBubble(role, html) {
  const wrap = document.getElementById('chat-msgs');
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role + ' fadein';
  if (role === 'assistant') el.innerHTML = html; else el.textContent = html;
  wrap.appendChild(el); wrap.scrollTop = wrap.scrollHeight;
}

function setChatThinking(on) {
  document.getElementById('chat-thinking').style.display = on ? 'block' : 'none';
  document.getElementById('chat-in').disabled = on;
  document.querySelector('#chat-popup .edit-popup-foot .btn-primary').disabled = on;
}

async function sendChat() {
  const inp = document.getElementById('chat-in');
  const msg = inp.value.trim(); if (!msg) return;
  inp.value = '';
  addBubble('user', msg);
  const cur = curNode();
  S.chatHistory.push({ role:'user', content:msg });
  S._lastChatPrompt = msg;
  logEvent('ai_chat_message_sent', msg);
  setChatThinking(true);
  try {
    const { system, user } = PROMPTS.getSuggestions(cur.title, cur.body, S.challenge, msg);
    const text = await callClaude([{ role:'user', content:user }], system);
    const json = JSON.parse(text.replace(/```json|```/g,'').trim());
    const suggestions = json.suggestions || [];
    S._lastSuggestions = suggestions;
    S.chatHistory.push({ role:'assistant', content: 'Suggested: ' + suggestions.join('; ') });
    if (suggestions.length) {
      logEvent('ai_suggestions_shown', suggestions.length + ' suggestions');
      addBubble('assistant', 'Here are specific changes based on your input:');
      renderSuggestionsPopup(suggestions);
    } else {
      addBubble('assistant', 'No suggestions generated — try rephrasing.');
    }
  } catch(e) { addBubble('assistant', 'Error: ' + e.message); }
  finally { setChatThinking(false); }
}

function renderSuggestionsPopup(suggestions) {
  const existing = document.getElementById('suggestions-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'suggestions-popup-overlay';
  overlay.id = 'suggestions-popup';
  overlay.innerHTML = `
    <div class="suggestions-popup">
      <div class="suggestions-popup-head">
        <h3>Select improvements to apply</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('suggestions-popup').remove()">Dismiss</button>
      </div>
      <div class="suggestions-popup-body" id="suggestions-list">
        ${suggestions.map((s, i) => `
          <label class="suggestion-item">
            <input type="checkbox" id="sug_${i}" value="${esc(s)}"/>
            <span>${esc(s)}</span>
          </label>`).join('')}
      </div>
      <div class="suggestions-popup-foot">
        <button class="btn btn-green" onclick="applySelectedSuggestions()">Apply Selected</button>
        <button class="btn btn-secondary" onclick="document.getElementById('suggestions-popup').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function applySelectedSuggestions() {
  const checks = document.querySelectorAll('#suggestions-list input[type=checkbox]:checked');
  const selected = Array.from(checks).map(c => c.value);
  if (!selected.length) { toast('Select at least one suggestion.'); return; }

  const allSuggestions = S._lastSuggestions || [];
  const rejected = allSuggestions.filter(s => !selected.includes(s));

  logEvent('ai_suggestions_selected', `selected: ${selected.length}, rejected: ${rejected.length}`);
  document.getElementById('suggestions-popup')?.remove();

  const cur = curNode();
  const instructions = 'Apply these improvements: ' + selected.join('; ');
  addBubble('user', instructions);
  S.chatHistory.push({ role:'user', content:instructions });

  setChatThinking(true);
  try {
    const { system, user } = PROMPTS.applyConversation(cur.title, cur.body, S.challenge, S.chatHistory);
    const text = await callClaude([{ role:'user', content:user }], system);
    const m = text.match(/NEW_IDEA:\s*(\{[\s\S]*?\})/);
    if (m) {
      const json = JSON.parse(m[1]);
      const exp = text.replace(/NEW_IDEA:[\s\S]*/,'').trim();
      addBubble('assistant', (exp || 'Updated based on selected changes.') + '\n\nNew node created.');
      const nn = mkNode({
        title: json.title, body: json.body, tag: 'ai-chat', parentId: cur.id,
        meta: {
          user_prompt: S._lastChatPrompt,
          suggestions_shown: allSuggestions,
          suggestions_selected: selected,
          suggestions_rejected: rejected,
        }
      });
      addNodeToGroup(nn); loadNode(nn.id);
      logEvent('ai_chat_modify_completed', json.title);
      S.chatHistory = []; S._lastChatPrompt = ''; S._lastSuggestions = [];
      // Close chat popup after a beat so user sees the confirmation
      setTimeout(closeChatPopup, 900);
    } else { addBubble('assistant', text); }
  } catch(e) { addBubble('assistant', 'Error: ' + e.message); }
  finally { setChatThinking(false); }
}

// ============================================================
//  FINALIZE / UNFINALIZE
// ============================================================
function finalizeIdea() {
  const cur = curNode();
  if (!cur || (!cur.title && !cur.body)) { toast('No idea to finalize.'); return; }
  if (cur.tag === 'finalized') { toast('Already finalized.', 'var(--green)'); return; }
  const nn = mkNode({ title:cur.title, body:cur.body, tag:'finalized', parentId:cur.id });
  addNodeToGroup(nn); S.curId = nn.id; loadNode(nn.id);
  logEvent('idea_finalized', cur.title);
  toast('Idea finalized', 'var(--green)');
  setTimeout(() => switchView('graph'), 350);
}

function unfinalizeIdea() {
  const cur = curNode();
  if (!cur || cur.tag !== 'finalized') return;
  const parent = S.nodes.find(n => n.id === cur.parentId);
  const revertTag = parent?.tag || 'user-created';
  cur.tag = revertTag;
  loadNode(cur.id);
  logEvent('idea_unfinalized', cur.title);
  toast('Idea unfinalized', 'var(--amber)');
}

// ============================================================
//  AI FEEDBACK
// ============================================================
async function openFeedback() {
  const cur = curNode();
  if (!cur || (!cur.title && !cur.body)) { toast('No idea to evaluate.'); return; }
  logEvent('ai_feedback_requested', cur.title);
  showFeedbackModal('Loading…', true);
  try {
    const { system, user } = PROMPTS.aiFeedback(cur.title, cur.body, S.challenge);
    const text = await callClaude([{ role:'user', content:user }], system);
    cur.meta = cur.meta || {};
    cur.meta.ai_feedback = text;
    logEvent('ai_feedback_received', cur.title);
    showFeedbackModal(text, false);
  } catch(e) { closeFeedbackModal(); toast('Error: ' + e.message, 'var(--red)'); }
}

function showFeedbackModal(text, loading) {
  const existing = document.getElementById('feedback-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'feedback-modal';
  overlay.onclick = (e) => { if (e.target===overlay) closeFeedbackModal(); };
  function parseMarkdown(raw) {
    return esc(raw).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/^- /gm,'• ').replace(/\n/g,'<br>');
  }
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h2>AI Feedback — ${esc(curNode()?.title||'Idea')}</h2>
        <button class="btn btn-ghost btn-sm" onclick="closeFeedbackModal()">Close</button>
      </div>
      <div class="modal-body" id="feedback-modal-body">
        ${loading
          ? '<div style="display:flex;align-items:center;gap:10px;color:var(--text3)"><span class="spinner"></span> Analysing…</div>'
          : '<div style="line-height:1.8">' + parseMarkdown(text) + '</div>'}
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" onclick="closeFeedbackModal()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function closeFeedbackModal() { document.getElementById('feedback-modal')?.remove(); }

// ============================================================
//  VIEW SWITCHING & NEW IDEA
// ============================================================
function switchView(v) {
  document.getElementById('text-view').style.display  = v==='text'  ? 'flex' : 'none';
  document.getElementById('graph-view').style.display = v==='graph' ? 'flex' : 'none';
  document.getElementById('btn-tv').classList.toggle('active', v==='text');
  document.getElementById('btn-gv').classList.toggle('active', v==='graph');
  logEvent('view_switched', v);
  if (v==='graph') renderGraph();
}

function startNewIdea() {
  const node = mkNode({ tag:'user-created' });
  S.nodes.push(node); S.groups.push([node.id]); S.curId = node.id;
  loadNode(node.id); switchView('text');
  logEvent('new_idea_started');
  toast('New idea started', 'var(--cyan)');
}

// ============================================================
//  CSV EXPORT
// ============================================================
function exportCSV() {
  if (!S.nodes.length) { toast('Nothing to export yet.'); return; }

  logEvent('export_csv');

  // Nodes CSV
  const nodeHeaders = [
    'node_id','group','step','tag','title','body','parent_id','timestamp',
    'user_prompt','suggestions_shown','suggestions_selected','suggestions_rejected',
    'chat_turns','ai_feedback'
  ];
  const nodeRows = S.nodes.map(node => {
    const gIdx = S.groups.findIndex(g => g.includes(node.id));
    const step = gIdx >= 0 ? S.groups[gIdx].indexOf(node.id) + 1 : '';
    const m = node.meta || {};
    return [
      node.id, gIdx+1, step, node.tag,
      csvCell(node.title), csvCell(node.body),
      node.parentId||'', new Date(node.ts).toISOString(),
      csvCell(m.user_prompt||''),
      csvCell((m.suggestions_shown||[]).join(' | ')),
      csvCell((m.suggestions_selected||[]).join(' | ')),
      csvCell((m.suggestions_rejected||[]).join(' | ')),
      csvCell(m.chat_turns||''),
      csvCell(m.ai_feedback||''),
    ].join(',');
  });
  downloadFile([nodeHeaders.join(','), ...nodeRows].join('\n'), `ideagit_nodes_${datestamp()}.csv`, 'text/csv');

  // Links CSV
  const linkHeaders = ['source_id','target_id','source_tag','target_tag','group'];
  const linkRows = S.nodes.filter(n=>n.parentId).map(n => {
    const parent = S.nodes.find(p=>p.id===n.parentId);
    const gIdx = S.groups.findIndex(g=>g.includes(n.id));
    return [n.parentId, n.id, parent?.tag||'', n.tag, gIdx+1].join(',');
  });
  setTimeout(() => downloadFile([linkHeaders.join(','), ...linkRows].join('\n'), `ideagit_links_${datestamp()}.csv`, 'text/csv'), 300);

  // Activity log CSV
  const logHeaders = ['timestamp','action','detail','node_id'];
  const logRows = S.activityLog.map(e =>
    [e.timestamp, csvCell(e.action), csvCell(e.detail), e.node_id].join(',')
  );
  setTimeout(() => downloadFile([logHeaders.join(','), ...logRows].join('\n'), `ideagit_log_${datestamp()}.csv`, 'text/csv'), 600);

  toast('Exported CSVs', 'var(--green)');
}

function csvCell(val) { return '"' + String(val||'').replace(/"/g,'""') + '"'; }
function downloadFile(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content],{type:mime}));
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function datestamp() { return new Date().toISOString().slice(0,10); }

// ============================================================
//  GRAPH
// ============================================================
let _pan = { dragging:false, startX:0, startY:0, tx:0, ty:0 };

function initGraphPan() {
  const outer = document.getElementById('graph-outer'); if (!outer) return;
  outer.addEventListener('mousedown', (e) => {
    if (e.button!==0 || e.target.closest('.gnode')) return;
    _pan.dragging=true; _pan.startX=e.clientX-_pan.tx; _pan.startY=e.clientY-_pan.ty;
    outer.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!_pan.dragging) return;
    _pan.tx=e.clientX-_pan.startX; _pan.ty=e.clientY-_pan.startY; applyPan();
  });
  window.addEventListener('mouseup', () => {
    if (_pan.dragging) { _pan.dragging=false; document.getElementById('graph-outer')?.classList.remove('dragging'); }
  });
  outer.addEventListener('touchstart', (e) => {
    if (e.touches.length!==1 || e.target.closest('.gnode')) return;
    _pan.dragging=true; _pan.startX=e.touches[0].clientX-_pan.tx; _pan.startY=e.touches[0].clientY-_pan.ty;
  }, {passive:true});
  window.addEventListener('touchmove', (e) => {
    if (!_pan.dragging||e.touches.length!==1) return;
    _pan.tx=e.touches[0].clientX-_pan.startX; _pan.ty=e.touches[0].clientY-_pan.startY; applyPan();
  }, {passive:true});
  window.addEventListener('touchend', () => { _pan.dragging=false; });
}

function applyPan() { document.getElementById('graph-wrap').style.transform=`translate(${_pan.tx}px,${_pan.ty}px)`; }
function resetPan()  { _pan.tx=0; _pan.ty=0; applyPan(); }

function computeLayout() {
  const pos={}; const H=260,V=190; let groupX=100;
  S.groups.forEach(group => {
    if (!group.length) return;
    const children={}, roots=[];
    group.forEach(id => {
      const node=S.nodes.find(n=>n.id===id); if (!node) return;
      if (!node.parentId||!group.includes(node.parentId)) roots.push(id);
      else { if (!children[node.parentId]) children[node.parentId]=[]; children[node.parentId].push(id); }
    });
    let colIdx=0;
    function layout(id,depth,col) {
      const kids=children[id]||[];
      if (!kids.length) { pos[id]={x:groupX+col*H,y:80+depth*V}; colIdx=Math.max(colIdx,col); return col+1; }
      let nextCol=col; const kidCols=[];
      kids.forEach(k=>{kidCols.push(nextCol);nextCol=layout(k,depth+1,nextCol);});
      const fx=groupX+kidCols[0]*H, lx=groupX+kidCols[kidCols.length-1]*H;
      pos[id]={x:(fx+lx)/2,y:80+depth*V}; return nextCol;
    }
    let startCol=0; roots.forEach(r=>{startCol=layout(r,0,startCol);});
    groupX+=startCol*H+H*0.7;
  });
  return pos;
}

function renderGraph() {
  const nodeWrap=document.getElementById('graph-nodes'), svg=document.getElementById('graph-svg');
  nodeWrap.innerHTML=''; svg.innerHTML='';
  if (!S.nodes.length) {
    nodeWrap.innerHTML='<div class="empty-state" style="position:absolute;inset:0"><h3>No nodes yet</h3><p>Create or generate an idea to see it here.</p></div>';
    return;
  }
  const pos=computeLayout();
  const xs=Object.values(pos).map(p=>p.x), ys=Object.values(pos).map(p=>p.y);
  const cw=Math.max(...xs)+240, ch=Math.max(...ys)+220;
  const wrap=document.getElementById('graph-wrap');
  wrap.style.width=cw+'px'; wrap.style.height=ch+'px';
  svg.style.width=cw+'px'; svg.style.height=ch+'px';
  svg.innerHTML=`<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--border2)"/></marker></defs>`;
  S.nodes.forEach(node=>{
    if (!node.parentId) return;
    const fp=pos[node.parentId],tp=pos[node.id]; if (!fp||!tp) return;
    const dx=tp.x-fp.x, dy=tp.y-fp.y;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${fp.x},${fp.y} C${fp.x+dx*.1},${fp.y+dy*.5} ${tp.x-dx*.1},${tp.y-dy*.5} ${tp.x},${tp.y}`);
    path.setAttribute('class','edge'); path.setAttribute('marker-end','url(#arr)'); svg.appendChild(path);
  });
  S.nodes.forEach(node=>{
    const p=pos[node.id]; if (!p) return;
    const {label,cls}=tagInfo(node.tag); const isCur=node.id===S.curId;
    const el=document.createElement('div');
    el.className=`gnode${node.tag==='finalized'?' final':''}${isCur?' current':''}`;
    el.style.left=p.x+'px'; el.style.top=p.y+'px';
    el.innerHTML=`<div class="gnode-inner"><span class="badge ${cls}">${esc(label)}</span><div class="gnode-title">${esc(node.title||'(untitled)')}</div><div class="gnode-preview">${esc(node.body||'(no content yet)')}</div></div>`;
    el.addEventListener('click',()=>{
      logEvent('graph_node_clicked', node.title || node.id);
      S.curId=node.id; loadNode(node.id); switchView('text');
    });
    nodeWrap.appendChild(el);
  });
  S.groups.forEach((group,gi)=>{
    if (!group.length) return; const fp=pos[group[0]]; if (!fp) return;
    const lbl=document.createElement('div');
    lbl.className='group-label'; lbl.style.left=(fp.x-90)+'px'; lbl.style.top=(fp.y-52)+'px';
    lbl.textContent=`Idea #${gi+1}`; nodeWrap.appendChild(lbl);
  });
  resetPan();
}
