// ============================================================
//  IdeaGit v3 — Main Application
// ============================================================

// ── State ────────────────────────────────────────────────────
const S = {
  challenge:      '',
  nodes:          [],
  currentNodeId:  null,  // node currently selected / being chatted from
  currentGroupId: null,  // which group's tree is shown
  activityLog:    [],
  _pendingMsg:    null,  // message held while awaiting classification
};

// ── Classification keywords ───────────────────────────────────
// Modification: message intends to change the idea
const MOD_KW = [
  'modify', 'change', 'update', 'edit', 'improve', 'refine', 'revise',
  'adjust', 'tweak', 'add to', 'remove', 'replace', 'alter', 'rephrase',
  'rewrite', 'fix', 'enhance', 'develop', 'expand', 'simplify',
  'make it', 'make this', 'make the', 'instead of', 'rather than',
  'incorporate', 'include', 'exclude', 'drop', 'swap', 'strengthen',
  'focus on', 'shift', 'pivot', 'new version', 'different version',
  'iteration', 'can you change', 'could you change', 'please change',
  'please modify', 'please update', "let's add", "let's remove",
  'add a', 'remove the', 'replace the', 'make sure',
];

// Feedback: message asks for evaluation without changing the idea
const FEED_KW = [
  'feedback', 'what do you think', 'your opinion', 'your thoughts',
  'evaluate', 'critique', 'assess', 'review', 'rate', 'opinion',
  'pros and cons', 'strengths', 'weaknesses', 'advantages', 'disadvantages',
  'analyze', 'analysis', 'how is', 'how does', 'is this good', 'is it good',
  'does this work', 'does this address', 'is this feasible', 'is this viable',
  'realistic', 'effective', 'comment on', 'thoughts on', 'concerns',
  'do you like', 'what are the issues', 'problems with', 'tell me what',
  'is it realistic', 'would this work', 'good idea', 'bad idea',
];

function classifyMessage(msg) {
  const lc = msg.toLowerCase();
  const modScore  = MOD_KW.filter(k  => lc.includes(k)).length;
  const feedScore = FEED_KW.filter(k => lc.includes(k)).length;
  if (modScore  > 0 && modScore  >= feedScore) return 'modification';
  if (feedScore > 0 && feedScore >  modScore)  return 'feedback';
  return null; // ambiguous
}

// ── Utils ─────────────────────────────────────────────────────
function uid() { return 'n' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, bg='') {
  const el = document.createElement('div');
  el.className = 'toast';
  if (bg) el.style.background = bg;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
function logEvent(action, detail='') {
  S.activityLog.push({
    timestamp: new Date().toISOString(),
    action, detail,
    node_id: S.currentNodeId || '',
  });
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

// ── Node factory ──────────────────────────────────────────────
function mkNode({ parentId=null, groupId=null, type='creation',
                  tag='user-created', title='', body='',
                  userPrompt='', aiResponse='',
                  isFinalized=false, meta={} }={}) {
  const id = uid();
  // Extras: non-tree exchanges (feedback, clarification) stored on this node
  return { id, parentId, groupId: groupId||id, type, tag,
           title, body, userPrompt, aiResponse,
           extras: [], isFinalized, ts: Date.now(), meta };
}

function addNode(node) {
  if (node.parentId) {
    const parent = S.nodes.find(n => n.id === node.parentId);
    if (parent) node.groupId = parent.groupId;
  }
  S.nodes.push(node);
  S.currentNodeId  = node.id;
  S.currentGroupId = node.groupId;
  return node;
}

function curNode() { return S.nodes.find(n => n.id === S.currentNodeId); }

// Traverse from root to nodeId, returning ordered path
function getPath(nodeId) {
  const path = [];
  let cur = S.nodes.find(n => n.id === nodeId);
  while (cur) {
    path.unshift(cur);
    if (!cur.parentId) break;
    cur = S.nodes.find(n => n.id === cur.parentId);
  }
  return path;
}

// Build API history for Claude (path + extras along the way)
function buildAPIHistory(nodeId) {
  const path = getPath(nodeId);
  const history = [];
  path.forEach(node => {
    if (node.userPrompt) history.push({ role:'user',      content: node.userPrompt });
    if (node.aiResponse) history.push({ role:'assistant', content: node.aiResponse });
    // Include extras as part of the conversation
    node.extras.forEach(ex => {
      if (ex.userPrompt) history.push({ role:'user',      content: ex.userPrompt });
      if (ex.aiResponse) history.push({ role:'assistant', content: ex.aiResponse });
    });
  });
  return history;
}

// ── Setup page ────────────────────────────────────────────────
function onChallengeInput() {
  const v = document.getElementById('challenge-input').value.trim();
  document.getElementById('start-btn').disabled = v.length === 0;
}

function startIdeation() {
  const desc = document.getElementById('challenge-input').value.trim();
  const con  = document.getElementById('challenge-constraint').value.trim();
  if (!desc) { toast('Please enter a design challenge.'); return; }
  S.challenge = con
    ? `${desc} The solution must meet the following constraint: ${con}`
    : desc;
  S.nodes = []; S.currentNodeId = null; S.currentGroupId = null;
  S.activityLog = []; S._pendingMsg = null;

  document.getElementById('page-setup').style.display     = 'none';
  document.getElementById('page-ideation').style.display  = 'flex';
  document.getElementById('challenge-banner-text').textContent = S.challenge;

  showChatInitial();
  renderIdeas();
  renderTree();
  logEvent('ideation_started', desc.slice(0,80));
}

function goToSetup() {
  if (S.nodes.length && !confirm('Go back to setup? Export first if you need to save.')) return;
  document.getElementById('page-ideation').style.display = 'none';
  document.getElementById('page-setup').style.display    = 'flex';
}

function openInstructions()  { document.getElementById('instructions-modal').style.display = 'flex'; }
function closeInstructions() { document.getElementById('instructions-modal').style.display = 'none'; }

// ── Chat panel state ──────────────────────────────────────────
function showChatInitial() {
  document.getElementById('chat-initial').style.display  = 'flex';
  document.getElementById('chat-active').style.display   = 'none';
}

function showChatActive() {
  document.getElementById('chat-initial').style.display  = 'none';
  document.getElementById('chat-active').style.display   = 'flex';
}

function setChatThinking(on) {
  document.getElementById('chat-thinking').style.display = on ? 'flex' : 'none';
  const inp = document.getElementById('chat-input');
  const btn = document.querySelector('#chat-input-row .btn');
  inp.disabled = on; if (btn) btn.disabled = on;
}

function updateChatHeader() {
  const node = curNode();
  document.getElementById('current-idea-title').textContent = node ? node.title : '—';
  const btn = document.getElementById('btn-finalize');
  if (node && node.isFinalized) { btn.textContent = 'Finalized'; btn.disabled = true; }
  else { btn.textContent = 'Finalize'; btn.disabled = false; }
}

// ── Rebuild chat window from path ─────────────────────────────
function rebuildChat(nodeId) {
  const wrap = document.getElementById('chat-messages');
  wrap.innerHTML = '';
  const path = getPath(nodeId);
  path.forEach(node => {
    // Show the idea or exchange that this node represents
    if (node.type === 'creation') {
      wrap.appendChild(makeIdeaBubble(node, node.tag === 'ai-generated' ? 'AI-Generated Idea' : 'Your Idea', ''));
    } else if (node.type === 'modification') {
      if (node.userPrompt) wrap.appendChild(makeMsgBubble('user', node.userPrompt));
      const cls = node.tag === 'manual-modification' ? 'manual' : 'modified';
      const lbl = node.tag === 'manual-modification' ? 'Manually Modified' : 'AI-Modified Idea';
      wrap.appendChild(makeIdeaBubble(node, lbl, cls));
    }
    // Show extras (feedback, clarification) stored on this node
    node.extras.forEach(ex => {
      if (ex.userPrompt) wrap.appendChild(makeMsgBubble('user', ex.userPrompt));
      if (ex.type === 'feedback') {
        wrap.appendChild(makeFeedbackBubble(ex.aiResponse));
      } else {
        if (ex.aiResponse) wrap.appendChild(makeMsgBubble('assistant', ex.aiResponse));
      }
    });
  });
  wrap.scrollTop = wrap.scrollHeight;
}

function makeIdeaBubble(node, label, cls='') {
  const el = document.createElement('div');
  el.className = 'idea-bubble' + (cls ? ' '+cls : '');
  el.dataset.nodeId = node.id;
  el.innerHTML = `<div class="idea-bubble-label">${esc(label)}</div>
    <div class="idea-bubble-title">${esc(node.title)}</div>
    <div class="idea-bubble-body">${esc(node.body)}</div>`;
  return el;
}

function makeMsgBubble(role, content) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role;
  el.textContent = content;
  return el;
}

function makeFeedbackBubble(content) {
  const el = document.createElement('div');
  el.className = 'feedback-bubble';
  el.innerHTML = `<div class="feedback-bubble-label">AI Feedback</div>${esc(content)}`;
  return el;
}

function appendToChat(el) {
  const wrap = document.getElementById('chat-messages');
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
}

// ── Create idea — Manual ──────────────────────────────────────
function startManualCreate() {
  document.getElementById('create-title').value = '';
  document.getElementById('create-body').value  = '';
  document.getElementById('modal-create').style.display = 'flex';
  setTimeout(() => document.getElementById('create-title').focus(), 60);
}
function closeCreateModal() { document.getElementById('modal-create').style.display = 'none'; }

function submitManualCreate() {
  const title = document.getElementById('create-title').value.trim();
  const body  = document.getElementById('create-body').value.trim();
  if (!title) { toast('Please enter a title.'); return; }
  if (!body)  { toast('Please enter a description.'); return; }
  closeCreateModal();
  const node = mkNode({ type:'creation', tag:'user-created', title, body });
  addNode(node);
  showChatActive();
  updateChatHeader();
  rebuildChat(node.id);
  renderTree(); renderIdeas();
  logEvent('manual_idea_created', title);
  toast('Idea created');
}

// ── Create idea — AI ─────────────────────────────────────────
async function startAICreate() {
  showChatActive();
  const wrap = document.getElementById('chat-messages');
  wrap.innerHTML = '';
  appendToChat(makeMsgBubble('system-note', 'Generating idea…'));
  setChatThinking(true);
  try {
    const existing = existingSummary();
    const { system, user } = PROMPTS.generateIdea(S.challenge, existing);
    const text = await callClaude([{ role:'user', content:user }], system);
    const json = JSON.parse(text.replace(/```json|```/g,'').trim());
    wrap.innerHTML = '';
    const node = mkNode({ type:'creation', tag:'ai-generated', title:json.title, body:json.body });
    addNode(node);
    updateChatHeader(); rebuildChat(node.id);
    renderTree(); renderIdeas();
    logEvent('ai_idea_generated', json.title);
  } catch(e) {
    wrap.innerHTML = '';
    appendToChat(makeMsgBubble('assistant', 'Error: ' + e.message));
    showChatInitial();
  } finally { setChatThinking(false); }
}

function existingSummary() {
  const roots = S.nodes.filter(n => !n.parentId && n.title);
  if (!roots.length) return '';
  return '\n\nExisting ideas (do NOT repeat or closely resemble):\n' +
    roots.map((n,i) => `${i+1}. "${n.title}" — ${n.body.slice(0,100)}`).join('\n');
}

// ── Modify — Manual ───────────────────────────────────────────
function openManualModify() {
  const node = curNode(); if (!node) return;
  document.getElementById('modify-title').value = node.title;
  document.getElementById('modify-body').value  = node.body;
  document.getElementById('modal-modify').style.display = 'flex';
  setTimeout(() => document.getElementById('modify-title').focus(), 60);
}
function closeModifyModal() { document.getElementById('modal-modify').style.display = 'none'; }

function submitManualModify() {
  const title = document.getElementById('modify-title').value.trim();
  const body  = document.getElementById('modify-body').value.trim();
  if (!title) { toast('Please enter a title.'); return; }
  if (!body)  { toast('Please enter a description.'); return; }
  closeModifyModal();
  const parent = curNode();
  const node = mkNode({
    parentId: parent.id,
    type: 'modification', tag: 'manual-modification',
    title, body,
    userPrompt: '[Manual modification]',
    aiResponse: '',
  });
  addNode(node);
  updateChatHeader(); rebuildChat(node.id);
  renderTree(); renderIdeas();
  logEvent('manual_modify_saved', title);
  toast('Idea updated');
}

// ── Finalize ──────────────────────────────────────────────────
function finalizeCurrentIdea() {
  const node = curNode(); if (!node) return;
  if (node.isFinalized) { toast('Already finalized.'); return; }
  node.isFinalized = true;
  updateChatHeader(); renderIdeas(); renderTree();
  logEvent('idea_finalized', node.title);
  toast('Idea finalized', 'var(--green)');
}

// ── New idea ──────────────────────────────────────────────────
function startNewIdea() {
  S.currentNodeId = null;
  showChatInitial();
  document.getElementById('chat-messages').innerHTML = '';
}

// ── Navigate to a node (tree click or idea card click) ────────
function selectNode(nodeId) {
  const node = S.nodes.find(n => n.id === nodeId); if (!node) return;
  S.currentNodeId  = nodeId;
  S.currentGroupId = node.groupId;
  showChatActive();
  updateChatHeader();
  rebuildChat(nodeId);
  renderTree(); renderIdeas();
}

// ── Chat: send message ────────────────────────────────────────
function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
}

function sendChatMessage() {
  const inp = document.getElementById('chat-input');
  const msg = inp.value.trim();
  if (!msg) return;
  if (!curNode()) { toast('Create an idea first.'); return; }
  document.getElementById('classify-area').style.display = 'none';
  const type = classifyMessage(msg);
  if (type) {
    inp.value = ''; inp.style.height = '';
    processMessage(msg, type);
  } else {
    // Ambiguous — show classification UI, keep the message in the box
    S._pendingMsg = msg;
    document.querySelectorAll('input[name="classify"]').forEach(r => r.checked = false);
    document.getElementById('classify-area').style.display = 'block';
  }
}

function confirmClassification() {
  const sel = document.querySelector('input[name="classify"]:checked');
  if (!sel) { toast('Please select an option.'); return; }
  document.getElementById('classify-area').style.display = 'none';
  const msg = S._pendingMsg; S._pendingMsg = null;
  document.getElementById('chat-input').value = '';
  document.getElementById('chat-input').style.height = '';
  processMessage(msg, sel.value);
}

function cancelClassification() {
  document.getElementById('classify-area').style.display = 'none';
  S._pendingMsg = null;
}

// ── Core message processing ───────────────────────────────────
async function processMessage(msg, type) {
  appendToChat(makeMsgBubble('user', msg));
  setChatThinking(true);
  logEvent('chat_message_sent', `[${type}] ${msg.slice(0,80)}`);
  const parent = curNode();

  try {
    if (type === 'modification') {
      const { system, user } = PROMPTS.modifyIdeaChat(parent.title, parent.body, S.challenge, msg);
      const text = await callClaude([{ role:'user', content:user }], system);
      const json = JSON.parse(text.replace(/```json|```/g,'').trim());

      const node = mkNode({
        parentId:  parent.id,
        type:      'modification',
        tag:       'ai-modification',
        title:     json.title,
        body:      json.body,
        userPrompt: msg,
        aiResponse: JSON.stringify(json),
      });
      addNode(node);
      appendToChat(makeIdeaBubble(node, 'AI-Modified Idea', 'modified'));
      updateChatHeader(); renderTree(); renderIdeas();
      logEvent('ai_modification_completed', json.title);

    } else {
      // feedback or clarification — stored as extra on current node, no new tree node
      const history = buildAPIHistory(parent.id);
      let aiText = '';
      if (type === 'feedback') {
        const { system, user } = PROMPTS.feedbackChat(parent.title, parent.body, S.challenge, msg);
        aiText = await callClaude([...history, { role:'user', content:user }], system);
        appendToChat(makeFeedbackBubble(aiText));
        logEvent('ai_feedback_received', parent.title);
      } else {
        const sysPrompt = PROMPTS.clarificationChat(parent.title, parent.body, S.challenge);
        aiText = await callClaude([...history, { role:'user', content:msg }], sysPrompt);
        appendToChat(makeMsgBubble('assistant', aiText));
        logEvent('ai_clarification', msg.slice(0,80));
      }
      // Store on current node's extras (doesn't create tree node)
      parent.extras.push({ type, userPrompt: msg, aiResponse: aiText, ts: Date.now() });
    }
  } catch(e) {
    appendToChat(makeMsgBubble('assistant', 'Error: ' + e.message));
  } finally {
    setChatThinking(false);
  }
}

// ── Ideas list (middle panel) ─────────────────────────────────
function getDisplayIdeas() {
  const finalized = S.nodes.filter(n => n.isFinalized);
  const parentIds = new Set(S.nodes.map(n => n.parentId).filter(Boolean));
  const ongoing   = S.nodes.filter(n => !parentIds.has(n.id) && !n.isFinalized && n.title);
  return { finalized, ongoing };
}

function renderIdeas() {
  const area  = document.getElementById('ideas-area');
  const empty = document.getElementById('ideas-empty');
  const { finalized, ongoing } = getDisplayIdeas();
  if (!finalized.length && !ongoing.length) {
    area.innerHTML = ''; area.appendChild(empty); empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';
  area.innerHTML = '';

  if (finalized.length) {
    const lbl = document.createElement('div');
    lbl.className = 'ideas-section-label'; lbl.textContent = 'Finalized';
    area.appendChild(lbl);
    finalized.forEach(n => area.appendChild(makeIdeaCard(n, 'finalized')));
  }
  if (ongoing.length) {
    const lbl = document.createElement('div');
    lbl.className = 'ideas-section-label'; lbl.textContent = 'In Progress';
    area.appendChild(lbl);
    ongoing.forEach(n => area.appendChild(makeIdeaCard(n, 'ongoing')));
  }
}

function makeIdeaCard(node, status) {
  const card = document.createElement('div');
  card.className = `idea-card ${status}${node.id === S.currentNodeId ? ' selected' : ''}`;
  card.innerHTML = `
    <div class="idea-card-badge ${status === 'finalized' ? 'badge-finalized' : 'badge-ongoing'}">
      ${status === 'finalized' ? 'Finalized' : 'In Progress'}
    </div>
    <div class="idea-card-title">${esc(node.title)}</div>
    <div class="idea-card-body">${esc(node.body)}</div>`;
  card.addEventListener('click', () => selectNode(node.id));
  return card;
}

// ── Process tree ──────────────────────────────────────────────
const _pan = { x:0, y:0, dragging:false, sx:0, sy:0 };

function initTreePan() {
  const area = document.getElementById('tree-area');
  area.addEventListener('mousedown', e => {
    if (e.target.closest('.tree-node')) return;
    _pan.dragging = true; _pan.sx = e.clientX - _pan.x; _pan.sy = e.clientY - _pan.y;
    area.classList.add('dragging');
  });
  window.addEventListener('mousemove', e => {
    if (!_pan.dragging) return;
    _pan.x = e.clientX - _pan.sx; _pan.y = e.clientY - _pan.sy;
    applyPan();
  });
  window.addEventListener('mouseup', () => {
    if (_pan.dragging) { _pan.dragging = false; document.getElementById('tree-area').classList.remove('dragging'); }
  });
}

function applyPan() {
  document.getElementById('tree-canvas').style.transform = `translate(${_pan.x}px,${_pan.y}px)`;
}
function resetPan() { _pan.x = 0; _pan.y = 0; applyPan(); }

function computeLayout(gid) {
  const gNodes = S.nodes.filter(n => n.groupId === gid && n.type !== 'feedback' && n.type !== 'clarification');
  if (!gNodes.length) return {};
  const children = {};
  gNodes.forEach(n => { children[n.id] = []; });
  gNodes.forEach(n => { if (n.parentId && children[n.parentId]) children[n.parentId].push(n.id); });
  const root = gNodes.find(n => !n.parentId || !gNodes.find(p => p.id === n.parentId));
  if (!root) return {};
  const W = 168, H = 62, HG = 22, VG = 72;
  const pos = {};

  function getW(id) {
    const kids = children[id] || [];
    if (!kids.length) return W;
    return Math.max(W, kids.reduce((s,k) => s + getW(k), 0) + HG * (kids.length - 1));
  }
  function layout(id, x, y) {
    pos[id] = { x, y };
    const kids = children[id] || [];
    if (!kids.length) return;
    const tw = kids.reduce((s,k) => s + getW(k), 0) + HG * (kids.length - 1);
    let cx = x - tw / 2;
    kids.forEach(k => { const kw = getW(k); layout(k, cx + kw/2, y + H + VG); cx += kw + HG; });
  }
  layout(root.id, getW(root.id) / 2 + 24, 24);
  return pos;
}

function renderTree() {
  const nodesEl = document.getElementById('tree-nodes');
  const svg     = document.getElementById('tree-svg');
  const emptyEl = document.getElementById('tree-empty');

  nodesEl.innerHTML = ''; svg.innerHTML = '';

  if (!S.currentGroupId) { emptyEl.style.display = 'flex'; return; }
  const gNodes = S.nodes.filter(n => n.groupId === S.currentGroupId);
  if (!gNodes.length) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  const pos  = computeLayout(S.currentGroupId);
  const vals = Object.values(pos);
  if (!vals.length) { emptyEl.style.display = 'flex'; return; }

  const maxX = Math.max(...vals.map(p => p.x)) + 108;
  const maxY = Math.max(...vals.map(p => p.y)) + 80;
  const W = 168, H = 62;

  document.getElementById('tree-canvas').style.width  = maxX + 'px';
  document.getElementById('tree-canvas').style.height = maxY + 'px';
  svg.style.width  = maxX + 'px';
  svg.style.height = maxY + 'px';

  svg.innerHTML = `<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
    <path d="M0,0 L0,6 L6,3 z" fill="var(--border2)"/></marker></defs>`;

  // Edges
  gNodes.forEach(node => {
    if (!node.parentId) return;
    const fp = pos[node.parentId], tp = pos[node.id];
    if (!fp || !tp) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const mx = fp.x, my = fp.y + H;
    path.setAttribute('d', `M${mx},${my} C${mx},${my+28} ${tp.x},${tp.y-28} ${tp.x},${tp.y}`);
    path.setAttribute('class', 'edge');
    path.setAttribute('marker-end', 'url(#arr)');
    svg.appendChild(path);
  });

  // Node elements
  gNodes.forEach(node => {
    const p = pos[node.id]; if (!p) return;
    const isCur = node.id === S.currentNodeId;
    const tc = node.isFinalized ? 't-finalized'
             : node.tag === 'ai-generated'        ? 't-ai-create'
             : node.tag === 'user-created'         ? 't-creation'
             : node.tag === 'manual-modification'  ? 't-manual'
             : 't-ai-mod';
    const typeLabel = node.isFinalized ? 'Finalized'
                    : node.type === 'creation'     ? (node.tag === 'ai-generated' ? 'AI Creation' : 'Creation')
                    : node.tag === 'manual-modification' ? 'Manual Edit'
                    : 'AI Modification';
    const typeColor = node.isFinalized ? 'var(--green)'
                    : tc === 't-ai-create' ? 'var(--purple)'
                    : tc === 't-creation'  ? 'var(--blue)'
                    : tc === 't-manual'    ? 'var(--amber)'
                    : 'var(--teal)';

    const el = document.createElement('div');
    el.className = `tree-node ${tc}${isCur ? ' current' : ''}`;
    el.style.left  = p.x + 'px';
    el.style.top   = p.y + 'px';
    el.style.width = W + 'px';
    el.innerHTML = `<div class="tree-node-inner">
      <div class="tree-node-type" style="color:${typeColor}">${typeLabel}</div>
      <div class="tree-node-title">${esc(node.title || '(untitled)')}</div>
    </div>`;
    el.addEventListener('click', () => selectNode(node.id));
    nodesEl.appendChild(el);
  });

  resetPan();
  const root = gNodes.find(n => !n.parentId || !gNodes.find(p => p.id === n.parentId));
  document.getElementById('tree-label').textContent = root ? root.title : '';
}

// ── Claude API ─────────────────────────────────────────────────
async function callClaude(messages, system='') {
  const body = { model: 'claude-sonnet-4-6', max_tokens: 1024, messages };
  if (system) body.system = system;
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error || 'API error '+res.status); }
  return (await res.json()).content[0].text;
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if (!S.nodes.length) { toast('Nothing to export yet.'); return; }
  logEvent('export_csv');

  const nHdr = ['node_id','group_id','parent_id','type','tag','title','body',
                 'is_finalized','user_prompt','ai_response','timestamp',
                 'extras_count','extras_json'];
  const nRows = S.nodes.map(n => [
    n.id, n.groupId, n.parentId||'', n.type, n.tag,
    csvC(n.title), csvC(n.body),
    n.isFinalized?'1':'0',
    csvC(n.userPrompt), csvC(n.aiResponse),
    new Date(n.ts).toISOString(),
    n.extras.length,
    csvC(JSON.stringify(n.extras)),
  ].join(','));
  dlFile([nHdr.join(','),...nRows].join('\n'), `ideagit_nodes_${dstamp()}.csv`, 'text/csv');

  const lHdr = ['timestamp','action','detail','node_id'];
  const lRows = S.activityLog.map(e =>
    [e.timestamp, csvC(e.action), csvC(e.detail), e.node_id].join(','));
  setTimeout(() => dlFile([lHdr.join(','),...lRows].join('\n'), `ideagit_log_${dstamp()}.csv`, 'text/csv'), 300);
  toast('Exported', 'var(--green)');
}

function csvC(v) { return '"' + String(v||'').replace(/"/g,'""') + '"'; }
function dlFile(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content],{type:mime}));
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function dstamp() { return new Date().toISOString().slice(0,10); }

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initTreePan);
