// ============================================================
//  IdeaGit — Multi-condition App
// ============================================================

const S = {
  condition: 4,
  challenge: '',
  nodes: [],
  currentNodeId: null,
  currentGroupId: null,
  _pendingMsg: null,
  _replyToNodeId: null,
  _editState: null,      // for C1/C2 auto-node
  _postContextSwitch: false, // after a context switch, next edit creates node immediately
  _editTimer: null,
};

// ── Keywords ─────────────────────────────────────────────────
const MOD_KW = ['modify','change','update','edit','improve','refine','revise','adjust','tweak',
  'add to','remove','replace','alter','rephrase','rewrite','fix','enhance','develop','expand',
  'simplify','make it','make this','make the','instead of','rather than','incorporate','include',
  'exclude','drop','swap','strengthen','focus on','shift','pivot','new version','can you change',
  'please change','please modify','please update','add a','remove the','replace the'];
const FEED_KW = ['feedback','what do you think','your opinion','your thoughts','evaluate',
  'critique','assess','review','rate','pros and cons','strengths','weaknesses','advantages',
  'disadvantages','analyze','how is','how does','is this good','does this work','does this address',
  'is this feasible','realistic','effective','comment on','concerns','do you like',
  'is it realistic','would this work'];

function classifyMsg(msg) {
  const lc = msg.toLowerCase();
  const m = MOD_KW.filter(k => lc.includes(k)).length;
  const f = FEED_KW.filter(k => lc.includes(k)).length;
  if (m > 0 && m >= f) return 'modification';
  if (f > 0 && f > m) return 'feedback';
  return null;
}

// ── Condition helpers ─────────────────────────────────────────
const hasTree  = () => [2,4].includes(S.condition);
const hasAI    = () => [3,4].includes(S.condition);
const isManual = () => [1,2].includes(S.condition);

function treeCanvasId() { return `c${S.condition}-tree-canvas`; }
function treeSvgId()    { return `c${S.condition}-tree-svg`; }
function treeNodesId()  { return `c${S.condition}-tree-nodes`; }
function treeEmptyId()  { return `c${S.condition}-tree-empty`; }
function treeLabelId()  { return `c${S.condition}-tree-label`; }
function ideasAreaId()  { return `c${S.condition}-ideas-area`; }
function ideasEmptyId() { return `c${S.condition}-ideas-empty`; }
function chatMsgsId()   { return `c${S.condition}-chat-messages`; }
function chatThinkId()  { return `c${S.condition}-chat-thinking`; }
function classifyId()   { return `c${S.condition}-classify-area`; }
function chatInputId()  { return `c${S.condition}-chat-input`; }
function replyIndId()   { return `c${S.condition}-reply-indicator`; }
function replyTextId()  { return `c${S.condition}-reply-text`; }
function chatInitId()   { return `c${S.condition}-chat-initial`; }
function chatActId()    { return `c${S.condition}-chat-active`; }
function curTitleId()   { return `c${S.condition}-current-title`; }
function finBtnId()     { return `c${S.condition}-btn-finalize`; }

// ── Utils ─────────────────────────────────────────────────────
function uid()  { return 'n'+Date.now()+'_'+Math.random().toString(36).slice(2,6); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg,bg=''){
  const el=document.createElement('div'); el.className='toast';
  if(bg) el.style.background=bg; el.textContent=msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),2800);
}
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,180)+'px'; }

// ── Node factory ──────────────────────────────────────────────
function mkNode({parentId=null,groupId=null,type='creation',tag='user-created',
                  title='',body='',userPrompt='',aiResponse='',isFinalized=false,meta={}}={}){
  const id=uid();
  return {id,parentId,groupId:groupId||id,type,tag,title,body,
          userPrompt,aiResponse,extras:[],isFinalized,ts:Date.now(),meta};
}
function addNode(node){
  if(node.parentId){
    const p=S.nodes.find(n=>n.id===node.parentId);
    if(p) node.groupId=p.groupId;
  }
  S.nodes.push(node);
  S.currentNodeId=node.id;
  S.currentGroupId=node.groupId;
  return node;
}
function curNode(){ return S.nodes.find(n=>n.id===S.currentNodeId); }

function getPath(nodeId){
  const path=[];
  let cur=S.nodes.find(n=>n.id===nodeId);
  while(cur){ path.unshift(cur); if(!cur.parentId) break; cur=S.nodes.find(n=>n.id===cur.parentId); }
  return path;
}
function buildAPIHistory(nodeId){
  const history=[];
  getPath(nodeId).forEach(node=>{
    if(node.userPrompt) history.push({role:'user',content:node.userPrompt});
    if(node.aiResponse) history.push({role:'assistant',content:node.aiResponse});
    node.extras.forEach(ex=>{
      if(ex.userPrompt) history.push({role:'user',content:ex.userPrompt});
      if(ex.aiResponse) history.push({role:'assistant',content:ex.aiResponse});
    });
  });
  return history;
}

// ── Finalized count ───────────────────────────────────────────
function finalizedCount(){ return S.nodes.filter(n=>n.isFinalized).length; }
function updateFinalizedCounter(){
  const c=finalizedCount();
  document.getElementById('nav-finalized-count').textContent=`${c} / 3 finalized`;
}

// ── Word change counting (for C1/C2 auto-node) ───────────────
function countWordChanges(oldText,newText){
  const ow=new Set(oldText.toLowerCase().trim().split(/\s+/));
  const nw=new Set(newText.toLowerCase().trim().split(/\s+/));
  let changed=0;
  ow.forEach(w=>{ if(!nw.has(w)) changed++; });
  return changed;
}

// ═══════════════════════════════════════════════════════════════
//  SETUP PAGE
// ═══════════════════════════════════════════════════════════════
function onChallengeInput(){
  const v=document.getElementById('challenge-input').value.trim();
  document.getElementById('start-btn').disabled=v.length===0;
}
function startIdeation(){
  const desc=document.getElementById('challenge-input').value.trim();
  const con =document.getElementById('challenge-constraint').value.trim();
  if(!desc){ toast('Please enter a design challenge.'); return; }
  S.challenge=con?`${desc} The solution must meet the following constraint: ${con}`:desc;
  S.nodes=[]; S.currentNodeId=null; S.currentGroupId=null; S._pendingMsg=null; S._replyToNodeId=null;
  document.getElementById('page-setup').style.display='none';
  document.getElementById('page-ideation').style.display='flex';
  document.getElementById('challenge-banner-text').textContent=S.challenge;
  const layoutEl=document.getElementById(`c${S.condition}-layout`);
  layoutEl.style.flex='1';
  layoutEl.style.overflow='hidden';
  layoutEl.style.display=S.condition===1?'flex':'grid';
  if(S.condition===1) layoutEl.style.flexDirection='column';

  if(isManual()) initTreePan();
  else if(hasTree()) initTreePan();

  updateFinalizedCounter();
  renderIdeas();
  if(hasTree()) renderTree();
}
function goHome(){
  if(S.nodes.length&&!confirm('Go back to home? Export first if you need to save.')) return;
  window.location.href='/';
}

// ═══════════════════════════════════════════════════════════════
//  INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
const INSTRUCTIONS = {
  1: `<p><strong>Condition 1 — Manual Ideation</strong></p>
      <p>1. Enter your design challenge and constraints, then click Start Ideation.</p>
      <p>2. Click <strong>+ New Idea</strong> to create a new idea. Enter a title and description.</p>
      <p>3. Click <strong>Edit</strong> on any idea to modify it.</p>
      <p>4. Click <strong>Finalize</strong> to mark an idea as complete. Try to finalize at least 3 ideas.</p>
      <p>5. Click <strong>Export CSV</strong> when done to save your work.</p>`,
  2: `<p><strong>Condition 2 — Structured Manual Ideation</strong></p>
      <p>1. Enter your design challenge and constraints, then click Start Ideation.</p>
      <p>2. Click <strong>+ New Idea</strong> to create a new idea.</p>
      <p>3. Edit ideas by clicking on them in the list. Edits are tracked as new versions in the process tree on the left automatically when you edit for 10+ seconds or make significant changes.</p>
      <p>4. Click any node in the process tree to view that version.</p>
      <p>5. Click <strong>Finalize</strong> to mark an idea as complete. Try to finalize at least 3 ideas.</p>
      <p>6. Click <strong>Export CSV</strong> when done to save your work.</p>`,
  3: `<p><strong>Condition 3 — AI-Assisted Ideation</strong></p>
      <p>1. Enter your design challenge and constraints, then click Start Ideation.</p>
      <p>2. In the chat panel on the right, choose to create an idea manually or generate one with AI.</p>
      <p>3. Type messages to modify the idea, ask for feedback, or ask questions. Each modification creates a tracked node in the background.</p>
      <p>4. You can reply to a specific message bubble by hovering over it and clicking the reply button (↩).</p>
      <p>5. Click <strong>Finalize</strong> when satisfied with an idea. Try to finalize at least 3 ideas.</p>
      <p>6. Click <strong>Export CSV</strong> when done to save your work.</p>`,
  4: `<p><strong>Condition 4 — AI-Assisted Structured Ideation</strong></p>
      <p>1. Enter your design challenge and constraints, then click Start Ideation.</p>
      <p>2. In the chat panel on the right, choose to create an idea manually or generate one with AI.</p>
      <p>3. Type messages to modify the idea, get feedback, or ask questions. Modifications appear as new nodes in the process tree on the left.</p>
      <p>4. Click any node in the process tree to navigate back to that version and continue from there — creating a new branch.</p>
      <p>5. You can reply to a specific message bubble by hovering and clicking ↩. This branches from the replied-to node.</p>
      <p>6. Click <strong>Finalize</strong> when satisfied with an idea. Try to finalize at least 3 ideas.</p>
      <p>7. Click <strong>Export CSV</strong> when done to save your work.</p>`,
};

function openInstructions(){
  const c=S.condition;
  document.getElementById('instructions-head').textContent=`Instructions — Condition ${c}`;
  document.getElementById('instructions-content').innerHTML=INSTRUCTIONS[c]||'';
  document.getElementById('instructions-modal').style.display='flex';
}
function closeInstructions(){ document.getElementById('instructions-modal').style.display='none'; }

// ═══════════════════════════════════════════════════════════════
//  CONDITION 1 & 2 — MANUAL EDITOR
// ═══════════════════════════════════════════════════════════════
function createNewIdea(){
  document.getElementById('create-title').value='';
  document.getElementById('create-body').value='';
  document.getElementById('modal-create').style.display='flex';
  setTimeout(()=>document.getElementById('create-title').focus(),60);
}
function closeCreateModal(){ document.getElementById('modal-create').style.display='none'; }
function submitManualCreate(){
  const title=document.getElementById('create-title').value.trim();
  const body =document.getElementById('create-body').value.trim();
  if(!title){ toast('Please enter a title.'); return; }
  if(!body) { toast('Please enter a description.'); return; }
  closeCreateModal();
  const node=mkNode({type:'creation',tag:'user-created',title,body});
  addNode(node);
  renderIdeas();
  if(hasTree()){ S.currentGroupId=node.groupId; renderTree(); }
  toast('Idea created');
}

let _rendering = false; // guard: prevent stopEditTrack cascade during DOM re-render

function renderDraftForm(area){
  if(area.querySelector('.c1-draft-form')) return; // already present
  const form=document.createElement('div');
  form.className='c1-idea-block c1-draft-form';
  // Identical look to other idea blocks — contenteditable, no button
  form.innerHTML=`
    <div class="c1-idea-num">New Idea</div>
    <div class="c1-idea-title" contenteditable="true" spellcheck="false"
      placeholder="Enter title…"
      data-draft="title"
      onblur="draftBlur()"></div>
    <div class="c1-idea-body" contenteditable="true" spellcheck="false"
      placeholder="Describe your idea…"
      data-draft="body"
      onblur="draftBlur()"></div>`;
  area.appendChild(form);
  // Focus title immediately (only on first render, i.e. no nodes yet)
  const leaves=S.nodes.filter(n=>n.title);
  if(!leaves.length) setTimeout(()=>form.querySelector('[data-draft="title"]')?.focus(),80);
}

function draftBlur(){
  // Small delay lets focus move to sibling field without prematurely saving
  setTimeout(()=>{
    const form=document.querySelector('.c1-draft-form'); if(!form) return;
    if(form.contains(document.activeElement)) return; // still inside form
    const titleEl=form.querySelector('[data-draft="title"]');
    const bodyEl =form.querySelector('[data-draft="body"]');
    if(!titleEl||!bodyEl) return;
    const title=titleEl.innerText.trim();
    const body =bodyEl.innerText.trim();
    if(!title&&!body) return; // empty, leave the form open
    if(!title||!body) return; // partial, wait for both
    // Save as creation node
    form.remove(); // remove before render to avoid duplication
    const node=mkNode({type:'creation',tag:'user-created',title,body});
    addNode(node);
    if(S.condition===2){ S.currentGroupId=node.groupId; renderTree(); }
    renderIdeas(); // re-renders cards (which appends a fresh draft form)
  },180);
}

function renderC1Cards(){
  if(S.condition!==1) return;
  _rendering=true; // block stopEditTrack cascade during DOM rebuild
  const area=document.getElementById('c1-cards');
  Array.from(area.children).forEach(c=>{ if(!c.classList.contains('c1-draft-form')) c.remove(); });
  const parentIds=new Set(S.nodes.map(n=>n.parentId).filter(Boolean));
  const leaves=S.nodes.filter(n=>!parentIds.has(n.id)&&n.title);
  // Render existing ideas BEFORE the draft form
  leaves.forEach((node,idx)=>{
    const block=document.createElement('div');
    block.className='c1-idea-block'+(node.isFinalized?' c1-finalized':'');
    block.innerHTML=`
      <div class="c1-idea-num">
        Idea ${idx+1}
        ${node.isFinalized?'<span class="badge-finalized" style="padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">Finalized</span>':''}
      </div>
      <div class="c1-idea-title" contenteditable="${!node.isFinalized}" spellcheck="false"
        placeholder="Enter title…"
        data-nodeid="${node.id}" data-field="title"
        onfocus="startEditTrack(this)" oninput="onEditInput(this)" onblur="stopEditTrack(this)">${esc(node.title)}</div>
      <div class="c1-idea-body" contenteditable="${!node.isFinalized}" spellcheck="false"
        placeholder="Describe your idea…"
        data-nodeid="${node.id}" data-field="body"
        onfocus="startEditTrack(this)" oninput="onEditInput(this)" onblur="stopEditTrack(this)">${esc(node.body)}</div>
      <div class="c1-idea-actions">
        ${!node.isFinalized?`<button class="btn btn-green btn-sm" onclick="finalizeNode('${node.id}')">Finalize</button>`:''}
        ${node.isFinalized?`<button class="btn btn-outline btn-sm" onclick="unfinalizeNode('${node.id}')">Unfinalize</button>`:''}
      </div>`;
    area.appendChild(block);
  });
  renderDraftForm(area);
  _rendering=false;
}

// Read current DOM content for a C1 node
function getC1NodeCurrentContent(nodeId){
  const titleEl=document.querySelector(`[data-nodeid="${nodeId}"][data-field="title"]`);
  const bodyEl =document.querySelector(`[data-nodeid="${nodeId}"][data-field="body"]`);
  return {
    title: titleEl?titleEl.innerText.trim():'',
    body:  bodyEl ?bodyEl.innerText.trim():'',
  };
}

// C1/C2 auto-node tracking
// Rule: context switch = version checkpoint. When you leave an idea and come
// back, the NEXT edit creates a new node immediately (not after 10s/5 words).
// This applies across C1, C2 and anywhere else editing occurs.
function startEditTrack(el){
  const nodeId=el.dataset.nodeid;
  const node=S.nodes.find(n=>n.id===nodeId); if(!node||node.isFinalized) return;
  // Switching away from a different idea — save it if changed
  if(S._editState && S._editState.nodeId!==nodeId){
    clearTimeout(S._editTimer);
    const prev=S.nodes.find(n=>n.id===S._editState.nodeId);
    if(prev){
      const {title:t,body:b}=getC1NodeCurrentContent(S._editState.nodeId);
      if(t!==S._editState.origTitle||b!==S._editState.origBody){
        createEditNode(prev.id,t||prev.title,b||prev.body,'context-switch');
      }
    }
    S._editState=null;
    // Mark that the idea we're switching INTO is in "post-switch" mode:
    // the first save here creates a new node for ANY change, no thresholds.
    S._postContextSwitch=true;
  }
  S._editState={ nodeId, origTitle:node.title, origBody:node.body, startTime:Date.now() };
  clearTimeout(S._editTimer);
}
function onEditInput(el){
  if(!S._editState) return;
  clearTimeout(S._editTimer);
  // After a context switch, use a short 2s debounce instead of 10s
  const delay=S._postContextSwitch?2000:10000;
  S._editTimer=setTimeout(()=>autoNodeFromEdit('time'),delay);
}
function stopEditTrack(el){
  if(_rendering) return; // ignore blur events caused by programmatic DOM re-render
  if(!S._editState) return;
  const node=S.nodes.find(n=>n.id===S._editState.nodeId); if(!node) return;
  const {title:newTitle,body:newBody}=getC1NodeCurrentContent(node.id);
  const changed=newTitle!==S._editState.origTitle||newBody!==S._editState.origBody;

  if(!changed){
    clearTimeout(S._editTimer);
    S._editState=null;
    return;
  }

  // Context switch: create node for any change
  if(S._postContextSwitch){
    S._postContextSwitch=false;
    clearTimeout(S._editTimer);
    createEditNode(node.id,newTitle,newBody,'context-switch-edit');
    return;
  }

  const wordChanges=countWordChanges(S._editState.origBody,newBody);
  const elapsed=Date.now()-S._editState.startTime;

  if(wordChanges>5||elapsed>=10000){
    clearTimeout(S._editTimer);
    createEditNode(node.id,newTitle,newBody,'manual-edit');
    return;
  }

  // Below threshold on blur: update in place but keep timer running.
  // autoNodeFromEdit will fire after 10s of inactivity regardless of blur.
  node.title=newTitle; node.body=newBody;
  // Do NOT clear _editState or timer — they stay alive after blur
}
function autoNodeFromEdit(trigger){
  if(!S._editState) return;
  const node=S.nodes.find(n=>n.id===S._editState.nodeId); if(!node) return;
  const {title:newTitle,body:newBody}=getC1NodeCurrentContent(node.id);
  if(newTitle!==S._editState.origTitle||newBody!==S._editState.origBody){
    createEditNode(node.id,newTitle||node.title,newBody||node.body,trigger);
  } else { S._editState=null; }
}
function createEditNode(parentId,title,body,trigger){
  const parent=S.nodes.find(n=>n.id===parentId); if(!parent) return;
  S._postContextSwitch=false; // clear flag — new node is the new baseline
  const child=mkNode({parentId,type:'modification',tag:'manual-modification',title,body,
    meta:{trigger}});
  addNode(child);
  S.currentGroupId=child.groupId;
  S._editState={ nodeId:child.id, origTitle:title, origBody:body, startTime:Date.now() };
  renderIdeas();
  if(hasTree()) renderTree();
}

function finalizeNode(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node||node.isFinalized) return;
  node.isFinalized=true;
  renderIdeas(); if(hasTree()) renderTree();
  updateFinalizedCounter();
  checkThreeDone();
  toast('Idea finalized','var(--green)');
}
function unfinalizeNode(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node||!node.isFinalized) return;
  node.isFinalized=false;
  renderIdeas(); if(hasTree()) renderTree();
  updateFinalizedCounter();
  toast('Idea unfinalized');
}

// ═══════════════════════════════════════════════════════════════
//  AI CHAT (C3, C4)
// ═══════════════════════════════════════════════════════════════
function showChatInitial(){
  document.getElementById(chatInitId()).style.display='flex';
  document.getElementById(chatActId()).style.display='none';
}
function showChatActive(){
  document.getElementById(chatInitId()).style.display='none';
  document.getElementById(chatActId()).style.display='flex';
}
function setChatThinking(on){
  document.getElementById(chatThinkId()).style.display=on?'flex':'none';
  const inp=document.getElementById(chatInputId());
  if(inp) inp.disabled=on;
}
function updateChatHeader(){
  const node=curNode();
  const titleEl=document.getElementById(curTitleId());
  if(titleEl) titleEl.textContent=node?node.title:'—';
  const btn=document.getElementById(finBtnId());
  if(btn){ btn.textContent=node&&node.isFinalized?'Finalized':'Finalize'; btn.disabled=!!(node&&node.isFinalized); }
}

function startManualCreate(){
  document.getElementById('create-title').value='';
  document.getElementById('create-body').value='';
  document.getElementById('modal-create').style.display='flex';
  setTimeout(()=>document.getElementById('create-title').focus(),60);
}
// submitManualCreate handles both manual modes

async function startAICreate(){
  showChatActive();
  const wrap=document.getElementById(chatMsgsId());
  wrap.innerHTML='';
  addBubble('system-note','Generating idea…');
  setChatThinking(true);
  try{
    const ex=existingSummary();
    const {system,user}=PROMPTS.generateIdea(S.challenge,ex);
    const text=await callClaude([{role:'user',content:user}],system);
    const json=JSON.parse(text.replace(/```json|```/g,'').trim());
    wrap.innerHTML='';
    const node=mkNode({type:'creation',tag:'ai-generated',title:json.title,body:json.body});
    addNode(node);
    updateChatHeader(); rebuildChat(node.id);
    renderIdeas(); if(hasTree()) renderTree();
  }catch(e){
    wrap.innerHTML='';
    addBubble('assistant','Error: '+e.message);
    showChatInitial();
  }finally{ setChatThinking(false); }
}
function existingSummary(){
  const roots=S.nodes.filter(n=>!n.parentId&&n.title);
  if(!roots.length) return '';
  return '\n\nExisting ideas (do NOT repeat or closely resemble):\n'+
    roots.map((n,i)=>`${i+1}. "${n.title}" — ${n.body.slice(0,100)}`).join('\n');
}

// ── Chat display ──────────────────────────────────────────────
function rebuildChat(nodeId){
  const wrap=document.getElementById(chatMsgsId()); if(!wrap) return;
  wrap.innerHTML='';
  getPath(nodeId).forEach(node=>{
    if(node.type==='creation'){
      wrap.appendChild(makeIdeaBubble(node,node.tag==='ai-generated'?'AI-Generated Idea':'Your Idea','',node.id));
    } else if(node.type==='modification'){
      if(node.userPrompt) wrap.appendChild(makeMsgBubble('user',node.userPrompt,node.id));
      wrap.appendChild(makeIdeaBubble(node,node.tag==='manual-modification'?'Manually Modified':'AI-Modified Idea',
        node.tag==='manual-modification'?'manual':'modified',node.id));
    }
    node.extras.forEach((ex,idx)=>{
      if(ex.userPrompt) wrap.appendChild(makeMsgBubble('user',ex.userPrompt,node.id,idx));
      if(ex.type==='feedback') wrap.appendChild(makeFeedbackBubble(ex.aiResponse,node.id,idx));
      else if(ex.aiResponse) wrap.appendChild(makeMsgBubble('assistant',ex.aiResponse,node.id,idx));
    });
  });
  wrap.scrollTop=wrap.scrollHeight;
}

function makeIdeaBubble(node,label,cls,nodeId){
  const el=document.createElement('div');
  el.className='idea-bubble'+(cls?' '+cls:'');
  el.dataset.nodeId=nodeId;
  el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${nodeId}',null,'${esc(node.title)}')">↩</div>
    <div class="idea-bubble-label">${esc(label)}</div>
    <div class="idea-bubble-title">${esc(node.title)}</div>
    <div class="idea-bubble-body">${esc(node.body)}</div>`;
  return el;
}
function makeMsgBubble(role,content,nodeId,extraIdx=null){
  const el=document.createElement('div');
  el.className='chat-msg '+role;
  el.dataset.nodeId=nodeId||'';
  const replyTarget=esc(content.slice(0,40)+(content.length>40?'…':''));
  const eidx=extraIdx!==null?`,'${extraIdx}'`:'null';
  if(role==='user'||role==='assistant'){
    el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${nodeId}',${eidx},'${replyTarget}')">↩</div>
      <span class="bubble-content">${esc(content)}</span>`;
  } else { el.textContent=content; }
  return el;
}
function makeFeedbackBubble(content,nodeId,extraIdx){
  const el=document.createElement('div');
  el.className='feedback-bubble';
  el.dataset.nodeId=nodeId||'';
  const replyTarget=esc(content.slice(0,40)+(content.length>40?'…':''));
  el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${nodeId}','${extraIdx}','${replyTarget}')">↩</div>
    <div class="feedback-bubble-label">AI Feedback</div>${esc(content)}`;
  return el;
}
function addBubble(role,content,nodeId='',extraIdx=null){
  const wrap=document.getElementById(chatMsgsId()); if(!wrap) return;
  const el=makeMsgBubble(role,content,nodeId,extraIdx);
  wrap.appendChild(el); wrap.scrollTop=wrap.scrollHeight;
}
function appendIdeaBubble(node,label,cls){
  const wrap=document.getElementById(chatMsgsId()); if(!wrap) return;
  wrap.appendChild(makeIdeaBubble(node,label,cls,node.id));
  wrap.scrollTop=wrap.scrollHeight;
}
function appendFeedbackBubble(content,nodeId,extraIdx){
  const wrap=document.getElementById(chatMsgsId()); if(!wrap) return;
  wrap.appendChild(makeFeedbackBubble(content,nodeId,extraIdx));
  wrap.scrollTop=wrap.scrollHeight;
}

// ── Reply feature ─────────────────────────────────────────────
function setReplyTo(nodeId,extraIdx,previewText){
  S._replyToNodeId=nodeId;
  const ind=document.getElementById(replyIndId());
  const txt=document.getElementById(replyTextId());
  if(ind&&txt){ ind.style.display='flex'; txt.textContent=previewText||'message'; }
  document.getElementById(chatInputId())?.focus();
}
function clearReply(){
  S._replyToNodeId=null;
  const ind=document.getElementById(replyIndId());
  if(ind) ind.style.display='none';
}

// ── Send message ──────────────────────────────────────────────
function chatKeydown(e){
  if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChatMessage(); }
}
function sendChatMessage(){
  const inp=document.getElementById(chatInputId());
  const msg=inp.value.trim(); if(!msg) return;
  if(!curNode()){ toast('Create an idea first.'); return; }
  document.getElementById(classifyId()).style.display='none';
  const type=classifyMsg(msg);
  if(type){ inp.value=''; inp.style.height=''; processMessage(msg,type); }
  else{ S._pendingMsg=msg; document.querySelectorAll('input[name="classify"]').forEach(r=>r.checked=false); document.getElementById(classifyId()).style.display='block'; }
}
function confirmClassification(){
  const sel=document.querySelector('input[name="classify"]:checked');
  if(!sel){ toast('Please select an option.'); return; }
  document.getElementById(classifyId()).style.display='none';
  const msg=S._pendingMsg; S._pendingMsg=null;
  const inp=document.getElementById(chatInputId());
  inp.value=''; inp.style.height='';
  processMessage(msg,sel.value);
}
function cancelClassification(){
  document.getElementById(classifyId()).style.display='none';
  S._pendingMsg=null;
}

async function processMessage(msg,type){
  // Determine parent node: use reply target or current node
  const parentId=S._replyToNodeId||S.currentNodeId;
  const parent=S.nodes.find(n=>n.id===parentId)||curNode();
  clearReply();
  addBubble('user',msg,parentId);
  setChatThinking(true);

  try{
    if(type==='modification'){
      const {system,user}=PROMPTS.modifyIdeaChat(parent.title,parent.body,S.challenge,msg);
      const text=await callClaude([{role:'user',content:user}],system);
      const json=JSON.parse(text.replace(/```json|```/g,'').trim());
      const node=mkNode({parentId:parent.id,type:'modification',tag:'ai-modification',
        title:json.title,body:json.body,userPrompt:msg,aiResponse:JSON.stringify(json)});
      addNode(node);
      appendIdeaBubble(node,'AI-Modified Idea','modified');
      updateChatHeader(); renderIdeas(); if(hasTree()) renderTree();
    } else {
      const history=buildAPIHistory(parent.id);
      let aiText='';
      if(type==='feedback'){
        const {system,user}=PROMPTS.feedbackChat(parent.title,parent.body,S.challenge,msg);
        aiText=await callClaude([...history,{role:'user',content:user}],system);
        const idx=parent.extras.length;
        parent.extras.push({type:'feedback',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        appendFeedbackBubble(aiText,parent.id,idx);
      } else {
        const sys=PROMPTS.clarificationChat(parent.title,parent.body,S.challenge);
        aiText=await callClaude([...history,{role:'user',content:msg}],sys);
        const idx=parent.extras.length;
        parent.extras.push({type:'clarification',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        addBubble('assistant',aiText,parent.id,idx);
      }
    }
  }catch(e){ addBubble('assistant','Error: '+e.message); }
  finally{ setChatThinking(false); }
}

function openManualModify(){
  const node=curNode(); if(!node) return;
  document.getElementById('modify-title').value=node.title;
  document.getElementById('modify-body').value=node.body;
  document.getElementById('modal-modify').style.display='flex';
  setTimeout(()=>document.getElementById('modify-title').focus(),60);
}
function closeModifyModal(){ document.getElementById('modal-modify').style.display='none'; }
function submitManualModify(){
  const title=document.getElementById('modify-title').value.trim();
  const body =document.getElementById('modify-body').value.trim();
  if(!title){ toast('Please enter a title.'); return; }
  if(!body) { toast('Please enter a description.'); return; }
  closeModifyModal();
  const parent=curNode();
  if(hasAI()){
    const node=mkNode({parentId:parent.id,type:'modification',tag:'manual-modification',title,body,userPrompt:'[Manual modification]'});
    addNode(node);
    updateChatHeader(); rebuildChat(node.id); renderIdeas(); if(hasTree()) renderTree();
  } else {
    createEditNode(parent.id,title,body,'manual');
  }
  toast('Idea updated');
}

function finalizeCurrentIdea(){
  const node=curNode(); if(!node) return;
  if(node.isFinalized){ toast('Already finalized.'); return; }
  node.isFinalized=true;
  updateChatHeader(); renderIdeas(); if(hasTree()) renderTree();
  updateFinalizedCounter();
  checkThreeDone();
  toast('Idea finalized','var(--green)');
}
function startNewIdea(){
  S.currentNodeId=null;
  if(hasAI()){ showChatInitial(); document.getElementById(chatMsgsId()).innerHTML=''; }
}
function selectNode(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId=nodeId; S.currentGroupId=node.groupId;
  if(hasAI()){ showChatActive(); updateChatHeader(); rebuildChat(nodeId); }
  renderIdeas(); if(hasTree()) renderTree();
}

// ═══════════════════════════════════════════════════════════════
//  IDEAS LIST
// ═══════════════════════════════════════════════════════════════
function getDisplayIdeas(){
  const finalized=S.nodes.filter(n=>n.isFinalized);
  const parentIds=new Set(S.nodes.map(n=>n.parentId).filter(Boolean));
  const ongoing=S.nodes.filter(n=>!parentIds.has(n.id)&&!n.isFinalized&&n.title);
  return {finalized,ongoing};
}
function renderIdeas(){
  if(S.condition===1){ renderC1Cards(); return; }
  const areaId=ideasAreaId();
  const emptyId=ideasEmptyId();
  const area=document.getElementById(areaId); if(!area) return;
  const empty=document.getElementById(emptyId);
  const {finalized,ongoing}=getDisplayIdeas();
  Array.from(area.children).forEach(c=>{ if(c.id!==emptyId) c.remove(); });
  if(!finalized.length&&!ongoing.length){ if(empty) empty.style.display='flex'; return; }
  if(empty) empty.style.display='none';
  if(finalized.length){
    const l=document.createElement('div'); l.className='ideas-section-label'; l.textContent='Finalized';
    area.appendChild(l); finalized.forEach(n=>area.appendChild(makeIdeaCard(n,'finalized')));
  }
  if(ongoing.length){
    const l=document.createElement('div'); l.className='ideas-section-label'; l.textContent='In Progress';
    area.appendChild(l); ongoing.forEach(n=>area.appendChild(makeIdeaCard(n,'ongoing')));
  }
  // C2: always show inline draft form for adding new ideas
  if(S.condition===2) renderDraftForm(area);
}
function makeIdeaCard(node,status){
  const card=document.createElement('div');
  card.className=`idea-card ${status}${node.id===S.currentNodeId?' selected':''}`;
  // C2 ongoing cards are inline-editable like C1
  if(S.condition===2 && status==='ongoing'){
    // Full-width editable block (same style as C1)
    card.className='c1-idea-block'; // override idea-card class
    card.innerHTML=`
      <div class="c1-idea-num" style="display:flex;align-items:center;justify-content:space-between">
        <span>In Progress</span>
        <button class="btn btn-green btn-sm" onclick="finalizeNode('${node.id}');event.stopPropagation()">Finalize</button>
      </div>
      <div class="c1-idea-title" contenteditable="true" spellcheck="false"
        placeholder="Title…"
        data-nodeid="${node.id}" data-field="title"
        onfocus="startEditTrack(this)" oninput="onEditInput(this)" onblur="stopEditTrack(this)">${esc(node.title)}</div>
      <div class="c1-idea-body" contenteditable="true" spellcheck="false"
        placeholder="Description…"
        data-nodeid="${node.id}" data-field="body"
        onfocus="startEditTrack(this)" oninput="onEditInput(this)" onblur="stopEditTrack(this)">${esc(node.body)}</div>`;
    return card;
  }
  const actions=isManual()?`
    ${!node.isFinalized?`<div class="idea-card-actions"><button class="btn btn-green btn-sm" onclick="finalizeNode('${node.id}');event.stopPropagation()">Finalize</button></div>`:''}
    ${node.isFinalized?`<div class="idea-card-actions"><button class="btn btn-outline btn-sm" onclick="unfinalizeNode('${node.id}');event.stopPropagation()">Unfinalize</button></div>`:''}
  `:'';
  card.innerHTML=`
    <div class="idea-card-badge ${status==='finalized'?'badge-finalized':'badge-ongoing'}">
      ${status==='finalized'?'Finalized':'In Progress'}</div>
    <div class="idea-card-title">${esc(node.title)}</div>
    <div class="idea-card-body">${esc(node.body)}</div>
    ${actions}`;
  card.addEventListener('click',()=>selectNode(node.id));
  return card;
}
function openEditCard(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId=nodeId; S.currentGroupId=node.groupId;
  document.getElementById('modify-title').value=node.title;
  document.getElementById('modify-body').value=node.body;
  document.getElementById('modal-modify').style.display='flex';
  setTimeout(()=>document.getElementById('modify-title').focus(),60);
}

// ═══════════════════════════════════════════════════════════════
//  PROCESS TREE
// ═══════════════════════════════════════════════════════════════
const _pan={x:0,y:0,dragging:false,sx:0,sy:0};
let _activePanAreaId=null;

function initTreePan(){
  const areaId=hasTree()?`c${S.condition}-tree-area`:null;
  if(!areaId) return;
  _activePanAreaId=areaId;
  const area=document.getElementById(areaId); if(!area) return;
  area.addEventListener('mousedown',e=>{
    if(e.target.closest('.tree-node')) return;
    _pan.dragging=true; _pan.sx=e.clientX-_pan.x; _pan.sy=e.clientY-_pan.y;
    area.classList.add('dragging');
  });
  window.addEventListener('mousemove',e=>{
    if(!_pan.dragging) return;
    _pan.x=e.clientX-_pan.sx; _pan.y=e.clientY-_pan.sy; applyPan();
  });
  window.addEventListener('mouseup',()=>{
    if(_pan.dragging){ _pan.dragging=false; document.getElementById(_activePanAreaId)?.classList.remove('dragging'); }
  });
}
function applyPan(){
  const el=document.getElementById(treeCanvasId()); if(el) el.style.transform=`translate(${_pan.x}px,${_pan.y}px)`;
}
function resetPan(){ _pan.x=0;_pan.y=0;applyPan(); }

function computeLayout(gid){
  const gNodes=S.nodes.filter(n=>n.groupId===gid&&n.type!=='feedback'&&n.type!=='clarification');
  if(!gNodes.length) return {};
  const children={};
  gNodes.forEach(n=>{children[n.id]=[];});
  gNodes.forEach(n=>{ if(n.parentId&&children[n.parentId]) children[n.parentId].push(n.id); });
  const root=gNodes.find(n=>!n.parentId||!gNodes.find(p=>p.id===n.parentId));
  if(!root) return {};
  const W=165,H=62,HG=20,VG=70;
  const pos={};
  function getW(id){ const k=children[id]||[]; return !k.length?W:Math.max(W,k.reduce((s,c)=>s+getW(c),0)+HG*(k.length-1)); }
  function layout(id,x,y){
    pos[id]={x,y}; const k=children[id]||[]; if(!k.length) return;
    const tw=k.reduce((s,c)=>s+getW(c),0)+HG*(k.length-1); let cx=x-tw/2;
    k.forEach(c=>{ const cw=getW(c); layout(c,cx+cw/2,y+H+VG); cx+=cw+HG; });
  }
  layout(root.id,getW(root.id)/2+24,24);
  return pos;
}

function renderTree(customGid){
  const gid=customGid||S.currentGroupId;
  const nodesId=treeNodesId(), svgId=treeSvgId(), emptyId=treeEmptyId(), labelId=treeLabelId(), canvasId=treeCanvasId();
  const nodesEl=document.getElementById(nodesId);
  const svg=document.getElementById(svgId);
  const emptyEl=document.getElementById(emptyId);
  if(!nodesEl||!svg) return;
  nodesEl.innerHTML=''; svg.innerHTML='';
  if(!gid){ if(emptyEl) emptyEl.style.display='flex'; return; }
  const gNodes=S.nodes.filter(n=>n.groupId===gid);
  if(!gNodes.length){ if(emptyEl) emptyEl.style.display='flex'; return; }
  if(emptyEl) emptyEl.style.display='none';
  const pos=computeLayout(gid);
  const vals=Object.values(pos); if(!vals.length){ if(emptyEl) emptyEl.style.display='flex'; return; }
  const maxX=Math.max(...vals.map(p=>p.x))+108, maxY=Math.max(...vals.map(p=>p.y))+80;
  const W=165,H=62;
  const canvas=document.getElementById(canvasId);
  if(canvas){ canvas.style.width=maxX+'px'; canvas.style.height=maxY+'px'; }
  svg.style.width=maxX+'px'; svg.style.height=maxY+'px';
  svg.innerHTML=`<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--border2)"/></marker></defs>`;
  gNodes.forEach(node=>{
    if(!node.parentId) return;
    const fp=pos[node.parentId],tp=pos[node.id]; if(!fp||!tp) return;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${fp.x},${fp.y+H} C${fp.x},${fp.y+H+28} ${tp.x},${tp.y-28} ${tp.x},${tp.y}`);
    path.setAttribute('class','edge'); path.setAttribute('marker-end','url(#arr)');
    svg.appendChild(path);
  });
  gNodes.forEach(node=>{
    const p=pos[node.id]; if(!p) return;
    const isCur=node.id===S.currentNodeId;
    const tc=node.isFinalized?'t-finalized':node.tag==='ai-generated'?'t-ai-create':node.tag==='user-created'?'t-creation':node.tag==='manual-modification'?'t-manual':'t-ai-mod';
    const typeLabel=node.isFinalized?'Finalized':node.type==='creation'?(node.tag==='ai-generated'?'AI Creation':'Creation'):node.tag==='manual-modification'?'Manual Edit':'AI Modification';
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--purple)':tc==='t-creation'?'var(--blue)':tc==='t-manual'?'var(--amber)':'var(--teal)';
    const el=document.createElement('div');
    el.className=`tree-node ${tc}${isCur?' current':''}`;
    el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    el.innerHTML=`<div class="tree-node-inner"><div class="tree-node-type" style="color:${typeColor}">${typeLabel}</div><div class="tree-node-title">${esc(node.title||'(untitled)')}</div></div>`;
    el.addEventListener('click',()=>{ if(S.condition===2) openNodeVersionModal(node.id); else selectNode(node.id); });
    nodesEl.appendChild(el);
  });
  resetPan();
  const root=gNodes.find(n=>!n.parentId||!gNodes.find(p=>p.id===n.parentId));
  const labelEl=document.getElementById(labelId);
  if(labelEl) labelEl.textContent=root?root.title:'';
}

// ═══════════════════════════════════════════════════════════════
//  DONE POPUP
// ═══════════════════════════════════════════════════════════════
function checkThreeDone(){
  const c=finalizedCount();
  if(c>=3){ document.getElementById('done-count').textContent=c; document.getElementById('done-popup').style.display='flex'; }
}
function handleDone(){
  const c=finalizedCount();
  document.getElementById('done-count').textContent=c;
  document.getElementById('done-popup').style.display='flex';
}
function closeDonePopup(){ document.getElementById('done-popup').style.display='none'; }
function confirmDone(){
  closeDonePopup();
  if([3,4].includes(S.condition)){ openSelfReport(); }
  else { exportCSV(); toast('Session exported. You may now close the page.','var(--green)'); }
}

// ═══════════════════════════════════════════════════════════════
//  SELF-REPORT (C3, C4)
// ═══════════════════════════════════════════════════════════════
let _srPage=0;
let _srCurrentIdea=0;
let _srSubTab='chat';

function openSelfReport(){
  const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
  if(!finalized.length){ toast('No finalized ideas to report on.'); return; }
  _srPage=0; _srCurrentIdea=0; _srSubTab='chat';

  // Build idea tabs
  const tabs=document.getElementById('sr-idea-tabs'); tabs.innerHTML='';
  finalized.forEach((n,i)=>{
    const btn=document.createElement('button');
    btn.className='sr-idea-tab'+(i===0?' sr-idea-active':'');
    btn.textContent=`Idea ${i+1}`;
    btn.onclick=()=>srSelectIdea(i,finalized);
    tabs.appendChild(btn);
    // Set titles
    const t=document.getElementById(`sr-title-${i}`);
    if(t) t.textContent=n.title;
    // Build contribution checkboxes
    const cb=document.getElementById(`sr-contrib-${i}`);
    if(cb) cb.innerHTML=srContribOptions(i);
  });

  // Show/hide tree sub-tab for C4
  document.getElementById('sr-sub-tabs').style.display=[3,4].includes(S.condition)?'flex':'none';
  document.getElementById('sr-tab-tree').style.display=S.condition===4?'':'none';

  // Show left panel only for C3/C4
  document.getElementById('sr-left').style.display=[3,4].includes(S.condition)?'flex':'none';

  srUpdateStep();
  srSelectIdea(0,finalized);
  srShowPage(0);
  document.getElementById('self-report-modal').style.display='flex';
}

function srContribOptions(idx){
  const opts=[
    ['created','Created the initial idea'],
    ['minor-mod','Made minor modifications that do not affect overall functionality'],
    ['major-mod','Made major modifications that affect overall functionality'],
    ['prompts','Provided detailed prompts to help AI generate or modify the idea'],
    ['none','Did not contribute to this idea'],
  ];
  return opts.map(([v,l])=>`<label class="sr-option"><input type="checkbox" name="contrib-${idx}" value="${v}"> ${l}</label>`).join('');
}

function srSelectIdea(idx,finalizedArg){
  _srCurrentIdea=idx;
  const finalized=finalizedArg||S.nodes.filter(n=>n.isFinalized).slice(0,3);
  document.querySelectorAll('.sr-idea-tab').forEach((t,i)=>t.classList.toggle('sr-idea-active',i===idx));
  srRenderContent(finalized[idx]);
}
function srRenderContent(node){
  if(!node) return;
  const disp=document.getElementById('sr-idea-display'); if(!disp) return;
  if(_srSubTab==='chat'){
    const path=getPath(node.id);
    let html='<div class="sr-chat-history">';
    path.forEach(n=>{
      if(n.type==='creation'){
        html+=`<div class="sr-idea-bubble"><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`;
      } else if(n.type==='modification'){
        if(n.userPrompt) html+=`<div class="sr-msg-user">${esc(n.userPrompt)}</div>`;
        html+=`<div class="sr-idea-bubble"><em>${n.tag==='manual-modification'?'Manual edit':'AI modified'}</em><br><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`;
      }
      n.extras.forEach(ex=>{
        if(ex.userPrompt) html+=`<div class="sr-msg-user">${esc(ex.userPrompt)}</div>`;
        if(ex.aiResponse) html+=`<div class="sr-msg-ai">${esc(ex.aiResponse)}</div>`;
      });
    });
    html+='</div>';
    disp.innerHTML=html;
  } else {
    // Tree view
    disp.innerHTML='<div id="sr-tree-container" style="width:100%;height:100%;position:relative;overflow:hidden;background:var(--bg)"><div id="sr-tree-inner" style="position:relative"><svg id="sr-tree-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg><div id="sr-tree-nodes"></div></div></div>';
    renderSrTree(node.groupId);
  }
}
function renderSrTree(gid){
  const nodesEl=document.getElementById('sr-tree-nodes');
  const svg=document.getElementById('sr-tree-svg');
  if(!nodesEl||!svg) return;
  nodesEl.innerHTML=''; svg.innerHTML='';
  const gNodes=S.nodes.filter(n=>n.groupId===gid&&n.type!=='feedback'&&n.type!=='clarification');
  if(!gNodes.length) return;
  const pos=computeLayout(gid);
  const vals=Object.values(pos); if(!vals.length) return;
  const maxX=Math.max(...vals.map(p=>p.x))+100,maxY=Math.max(...vals.map(p=>p.y))+70;
  const inner=document.getElementById('sr-tree-inner');
  if(inner){ inner.style.width=maxX+'px'; inner.style.height=maxY+'px'; }
  svg.style.width=maxX+'px'; svg.style.height=maxY+'px';
  svg.innerHTML=`<defs><marker id="arr2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--border2)"/></marker></defs>`;
  const W=145,H=56;
  gNodes.forEach(node=>{
    if(!node.parentId) return;
    const fp=pos[node.parentId],tp=pos[node.id]; if(!fp||!tp) return;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${fp.x},${fp.y+H} C${fp.x},${fp.y+H+24} ${tp.x},${tp.y-24} ${tp.x},${tp.y}`);
    path.setAttribute('class','edge'); path.setAttribute('marker-end','url(#arr2)');
    svg.appendChild(path);
  });
  gNodes.forEach(node=>{
    const p=pos[node.id]; if(!p) return;
    const tc=node.isFinalized?'t-finalized':node.tag==='ai-generated'?'t-ai-create':node.tag==='user-created'?'t-creation':node.tag==='manual-modification'?'t-manual':'t-ai-mod';
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--purple)':tc==='t-creation'?'var(--blue)':tc==='t-manual'?'var(--amber)':'var(--teal)';
    const el=document.createElement('div');
    el.className=`tree-node ${tc}`; el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    el.innerHTML=`<div class="tree-node-inner" style="padding:7px 9px"><div class="tree-node-type" style="color:${typeColor};font-size:10px">${node.isFinalized?'Finalized':node.type}</div><div class="tree-node-title" style="font-size:12px">${esc(node.title||'(untitled)')}</div></div>`;
    nodesEl.appendChild(el);
  });
}
function srSubTab(tab){
  _srSubTab=tab;
  document.getElementById('sr-tab-chat').classList.toggle('sr-sub-active',tab==='chat');
  document.getElementById('sr-tab-tree').classList.toggle('sr-sub-active',tab==='tree');
  const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
  srRenderContent(finalized[_srCurrentIdea]);
}
function srToggleB(show){
  document.getElementById('sr-q-b').style.display=show?'block':'none';
}
function srUpdateStep(){
  const total=[3,4].includes(S.condition)?4:3;
  const label=document.getElementById('sr-step-indicator');
  if(label) label.textContent=`Step ${_srPage+1} of ${total}`;
}
function srShowPage(n){
  _srPage=n;
  [0,1,2,3].forEach(i=>{ const el=document.getElementById(`sr-page-${i}`); if(el) el.style.display='none'; });
  const target=document.getElementById(`sr-page-${n}`);
  if(target) target.style.display='block';

  // Sync left panel idea selection to page
  if(n>=1){ srSelectIdea(n-1,S.nodes.filter(nd=>nd.isFinalized).slice(0,3)); }
  srUpdateStep();
}
function srNext(){
  const totalPages=[3,4].includes(S.condition)?4:3;
  if(_srPage<totalPages-1) srShowPage(_srPage+1);
}
function srPrev(){ if(_srPage>0) srShowPage(_srPage-1); }

// ── C2: Modify from tree node ─────────────────────────────────────
function openNodeVersionModal(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId=nodeId; S.currentGroupId=node.groupId;
  // Navigating via tree is a context switch — next edit on this node creates new node immediately
  S._postContextSwitch=true;
  if(S._editState){ clearTimeout(S._editTimer); S._editState=null; }
  document.getElementById('node-version-title').value=node.title;
  document.getElementById('node-version-body').value=node.body;
  document.getElementById('modal-node-version').style.display='flex';
  setTimeout(()=>document.getElementById('node-version-title').focus(),60);
}
function closeNodeVersionModal(){ document.getElementById('modal-node-version').style.display='none'; }
function submitNodeVersionModify(){
  const title=document.getElementById('node-version-title').value.trim();
  const body =document.getElementById('node-version-body').value.trim();
  if(!title){ toast('Please enter a title.'); return; }
  if(!body) { toast('Please enter a description.'); return; }
  closeNodeVersionModal();
  createEditNode(S.currentNodeId,title,body,'tree-branch');
}

// ── Self-report: toggle "other" textarea ──────────────────────────
function toggleOtherBox(cb){
  const ta=document.getElementById('ai-for-other');
  if(ta){ ta.style.display=cb.checked?'block':'none'; if(cb.checked) ta.focus(); }
}

function srSubmit(){
  const aiUsed=document.querySelector('input[name="ai-used"]:checked')?.value||'n/a';
  const aiFor=Array.from(document.querySelectorAll('input[name="ai-for"]:checked')).map(c=>c.value);
  const aiOtherTa=document.getElementById('ai-for-other');
  const aiOther=aiOtherTa&&aiOtherTa.style.display!=='none'?aiOtherTa.value.trim():'';
  if(aiOther) aiFor.push('other:'+aiOther);
  const contributions=[];
  [0,1,2].forEach(i=>{
    const vals=Array.from(document.querySelectorAll(`input[name="contrib-${i}"]:checked`)).map(c=>c.value);
    contributions.push(vals);
  });
  document.getElementById('self-report-modal').style.display='none';
  toast('Submitting and exporting…','var(--green)');

  // Download nodes CSV first
  const nodesContent=buildNodesCSV();
  dlFile(nodesContent,`ideagit_nodes_c${S.condition}_${dstamp()}.csv`,'text/csv');

  // Download self-report CSV 800ms later (ensures both files are triggered)
  setTimeout(()=>{
    const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
    const hdr=['condition','ai_used','ai_for','idea_1_title','idea_1_contrib','idea_2_title','idea_2_contrib','idea_3_title','idea_3_contrib'];
    const row=[
      S.condition, aiUsed, csvC(aiFor.join('|')),
      csvC(finalized[0]?.title||''), csvC(contributions[0].join('|')),
      csvC(finalized[1]?.title||''), csvC(contributions[1].join('|')),
      csvC(finalized[2]?.title||''), csvC(contributions[2].join('|')),
    ];
    dlFile([hdr.join(','),row.join(',')].join('\n'),`ideagit_self_report_c${S.condition}_${dstamp()}.csv`,'text/csv');
    // No redirect — stay on the page
  },800);
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════
function buildNodesCSV(){
  const hdr=['node_id','group_id','parent_id','type','tag','title','body',
             'is_finalized','user_prompt','ai_response','timestamp','extras_count','extras_json'];
  const rows=S.nodes.map(n=>[
    n.id,n.groupId,n.parentId||'',n.type,n.tag,
    csvC(n.title),csvC(n.body),n.isFinalized?'1':'0',
    csvC(n.userPrompt),csvC(n.aiResponse),
    new Date(n.ts).toISOString(),
    n.extras.length, csvC(JSON.stringify(n.extras))
  ].join(','));
  return [hdr.join(','),...rows].join('\n');
}
function exportCSV(){
  if(!S.nodes.length){ toast('Nothing to export yet.'); return; }
  dlFile(buildNodesCSV(),`ideagit_nodes_c${S.condition}_${dstamp()}.csv`,'text/csv');
  toast('Exported','var(--green)');
}
function csvC(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; }
function dlFile(content,filename,mime){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function dstamp(){ return new Date().toISOString().slice(0,10); }

// ═══════════════════════════════════════════════════════════════
//  CLAUDE API
// ═══════════════════════════════════════════════════════════════
async function callClaude(messages,system=''){
  const body={model:'claude-sonnet-4-6',max_tokens:1024,messages};
  if(system) body.system=system;
  const res=await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e?.error||'API error '+res.status); }
  return (await res.json()).content[0].text;
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',()=>{
  S.condition=parseInt(sessionStorage.getItem('ideagit-condition')||'4');
  // Show condition badge on setup page
  const subtitle=document.getElementById('setup-subtitle');
  const names={1:'Manual Ideation',2:'Structured Manual Ideation',3:'AI-Assisted Ideation',4:'AI-Assisted Structured Ideation'};
  if(subtitle) subtitle.textContent=`Condition ${S.condition}: ${names[S.condition]}. Enter your design challenge to begin.`;
});
