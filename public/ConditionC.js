window.EXPORT_MODE='trees';
// ============================================================
//  IdeaForest — Condition C: team ideation (several people, one idea tree)
//  A copy of Condition A that lets a team work on the same tree at the same time.
//  Loads the unmodified shared.js / prompts.js and overrides what it needs here,
//  so Conditions A and B are not touched. Data is stored in the ideagit_c_* tables
//  (see /teams.js); the page polls the server every ~1.5 s for the teammates' changes.
// ============================================================
S.condition = "AI-Assisted Structured Ideation";
S.studyCondition = "IdeaForest_Team";

window.TREE_EMPTY_TEXT = 'Click “+ New Idea” to create your first idea. The idea tree is shared with your team and fills up as you all work.';
window.TREE_HINT_TEXT = 'Click on a node to see the detail on the right panel (Current Idea panel). You can edit the idea yourself or using AI.\nWhen you are satisfied, you can finalize the idea. Everything your team does shows up on everyone’s screen.';
window.SR_TREE_ONLY = true;
window.TREE_NO_SKELETON = true;
window.SHOW_IDEA_SUMMARY = true;
window.WORKING_BADGE = true; window.TREE_STACK = true;
document.body.classList.add('app5');

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has two panels';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid instructions-grid-2">
    <div class="instructions-col"><div class="instr-text">The left panel where you and your team can create ideas and see how they evolve</div><div class="instr-arrow instr-arrow-left">&#8592;</div></div>
    <div class="instructions-col"><div class="instr-text">The right panel that shows the selected idea and the design challenge</div><div class="instr-arrow instr-arrow-right">&#8594;</div></div>
  </div>`;

const $ = id => document.getElementById(id);
const POLL_MS = 1500;
const PALETTE = ['#2563eb','#db2777','#059669','#d97706','#7c3aed','#0891b2','#dc2626','#65a30d'];

// ── Team state ────────────────────────────────────────────────
const T = { code:null, phase:'lobby', createdBy:null, members:[], done:{active:false}, infl:[], inflSig:'[]', msig:'',
            since:0, inIdeation:false, busy:false, timer:null, firstPoll:true, declineSeen:0, doneSig:'' };
const _gone = new Set();   // ids this page discarded (a late poll must not bring them back)

function canon(v){
  if(Array.isArray(v)) return '['+v.map(canon).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
  return JSON.stringify(v===undefined?null:v);
}
async function api(path,body){
  try{
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    let data=null; try{ data=await r.json(); }catch(e){}
    return {ok:r.ok,status:r.status,data:data||{}};
  }catch(e){ return {ok:false,status:0,data:{error:'Network error. Please check your connection.'}}; }
}
const bare = p => String(p).replace(/^\s*pid\s*/i,'');
const pidLabel = p => 'PID '+bare(p);
const pidsLabel = list => list.length===1 ? pidLabel(list[0]) : 'PIDs '+list.map(bare).join(', ');
const me = () => S.participantId;
function memberColor(pid){ const i=T.members.findIndex(m=>m.pid===pid); return PALETTE[(i<0?0:i)%PALETTE.length]; }

// ============================================================
//  1. Landing → team screen (create / join) → lobby
// ============================================================
document.addEventListener('DOMContentLoaded', initLanding);
window.beginStudy = function(){
  const input=$('participant-id-input'); const id=(input&&input.value||'').trim(); if(!id) return;
  S.participantId=id;
  $('page-landing').style.display='none'; $('page-team').style.display='flex';
  showTeamChoice();
};
const logoHtml='<h1 class="landing-title">IdeaForest<img class="brand-icon brand-icon-lg" src="icon.svg" alt=""></h1>';
function teamCard(html){ $('c-team-card').innerHTML=logoHtml+html; }
function savedCode(){ try{ return sessionStorage.getItem('ideaforestC_'+me())||''; }catch(e){ return ''; } }
function saveCode(c){ try{ sessionStorage.setItem('ideaforestC_'+me(),c); }catch(e){} }

function showTeamChoice(){
  const old=savedCode();
  teamCard(`<p class="landing-label">Participant ID: <strong>${esc(me())}</strong></p>
    <p class="c-lead">Do you want to create a new team or join a team?</p>
    <div class="c-choice">
      <button class="btn btn-primary" id="c-create">Create a team</button>
      <button class="btn btn-outline" id="c-join">Join a team</button>
    </div>
    ${old?`<p class="c-small">Were you disconnected? <a href="#" id="c-rejoin">Rejoin team ${esc(old)}</a></p>`:''}
    <p class="field-error" id="c-team-err" style="display:none"></p>`);
  $('c-create').onclick=createTeam; $('c-join').onclick=showJoin;
  if(old) $('c-rejoin').onclick=e=>{ e.preventDefault(); joinTeam(old); };
}
function teamErr(msg){ const e=$('c-team-err'); if(e){ e.textContent=msg; e.style.display=msg?'block':'none'; } }
async function createTeam(){
  $('c-create').disabled=true;
  const r=await api('/api/c/team/create',{pid:me()});
  if(!r.ok){ $('c-create').disabled=false; teamErr(r.data.error||'Could not create a team.'); return; }
  enterLobby(r.data.code);
}
function showJoin(){
  teamCard(`<p class="landing-label">Participant ID: <strong>${esc(me())}</strong></p>
    <label class="landing-label" for="c-code-in">Enter the team number</label>
    <input type="text" id="c-code-in" class="field-input c-code-input" maxlength="12" inputmode="numeric" autocomplete="off" spellcheck="false"/>
    <p class="field-error" id="c-team-err" style="display:none"></p>
    <div class="c-choice"><button class="btn btn-primary" id="c-join-go" disabled>Join</button><button class="btn btn-outline" id="c-back">Back</button></div>`);
  const inp=$('c-code-in'), go=$('c-join-go');
  inp.addEventListener('input',()=>{ go.disabled=!inp.value.trim(); });
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'&&inp.value.trim()) joinTeam(inp.value.trim()); });
  go.onclick=()=>joinTeam(inp.value.trim()); $('c-back').onclick=showTeamChoice; inp.focus();
}
async function joinTeam(code){
  const r=await api('/api/c/team/join',{pid:me(),code});
  if(!r.ok){ if($('c-team-err')) teamErr(r.data.error||'Could not join the team.'); else { showTeamChoice(); teamErr(r.data.error||'Could not join the team.'); } return; }
  enterLobby(r.data.code);
}
function enterLobby(code){
  T.code=code; saveCode(code); T.phase='lobby'; T.msig=''; _lobbySig='';
  teamCard('<p class="c-lead">Loading your team…</p>');
  startPolling(); pollOnce();
}
let _lobbySig='';
function renderLobby(){
  const creator=T.createdBy===me();
  const sig=canon([T.members.map(m=>[m.pid,m.online]),T.createdBy]); if(sig===_lobbySig&&$('c-code-big')) return; _lobbySig=sig;
  const list=T.members.map(m=>`<li><span class="c-dot" style="background:${memberColor(m.pid)}${m.online?'':';opacity:.35'}"></span>${esc(pidLabel(m.pid))}${m.pid===me()?' <span class="c-tagline">(you)</span>':''}${m.pid===T.createdBy?' <span class="c-tagline">· created the team</span>':''}</li>`).join('');
  teamCard(`<p class="c-lead">${creator?'Share this team number with the other participant(s):':'You are in this team:'}</p>
    <div class="c-code" id="c-code-big">${esc(T.code)}</div>
    <div class="c-members-title">Team members (${T.members.length})</div>
    <ul class="c-members">${list}</ul>
    ${creator
      ?`<p class="c-small">Wait until everyone has joined, then press Start. People can also join later with the number.</p><button class="btn btn-green c-start" id="c-start">Start</button>`
      :`<p class="c-small">Waiting for ${esc(pidLabel(T.createdBy||''))} to start the session…</p>`}`);
  const s=$('c-start'); if(s) s.onclick=async()=>{ s.disabled=true; const r=await api('/api/c/team/start',{code:T.code,pid:me()}); if(!r.ok){ s.disabled=false; toast(r.data.error||'Could not start.','var(--red)'); } else pollOnce(); };
}

// ============================================================
//  2. Polling: changes from the teammates
// ============================================================
function startPolling(){ if(!T.timer) T.timer=setInterval(pollOnce,POLL_MS); }
const myCur = () => (CSR.on?CSR.hl:S.currentNodeId)||null;
async function pollOnce(){
  if(!T.code||T.busy) return; T.busy=true;
  try{
    const r=await api('/api/c/team/poll',{code:T.code,pid:me(),since_ms:T.since,cur:T.inIdeation?myCur():null});
    if(!r.ok){ if(r.status===404) toast(r.data.error||'Team not found.','var(--red)'); return; }
    handlePoll(r.data);
  }finally{ T.busy=false; }
}
function handlePoll(d){
  T.members=d.members; T.createdBy=d.created_by; T.phase=d.phase; T.done=d.done||{active:false};
  const msig=canon(d.members.map(m=>[m.pid,m.cur,m.online,m.done_ok,m.infl_done,m.own_done]));
  const msigChanged=msig!==T.msig; T.msig=msig;
  if(!T.inIdeation){
    if(d.phase==='lobby'){ T.since=d.now_ms; renderLobby(); return; }
    enterIdeation(); setTimeout(pollOnce,0); return;   // load every node first (since = 0)
  }
  let render=ingestNodes(d.nodes); T.since=d.now_ms;
  const isig=canon(d.infl||[]); if(d.infl&&isig!==T.inflSig){ T.infl=d.infl; T.inflSig=isig; render=true; }
  if(T.firstPoll){ T.firstPoll=false; T.declineSeen=(d.done.decline&&d.done.decline.ms)||0; }
  if(render) softRefresh(); else if(msigChanged) decorateNodes();
  if(msigChanged) renderTeamBar();
  if(d.phase==='working'){
    if(CSR.on){ /* a late change of phase is not expected */ }
    renderDone(); showDeclineToast();
  }else{
    hideDone();
    if(!CSR.on) startSelfReport();
    else if(CSR.stage==='wait'&&(msigChanged||CSR.phaseSeen!==d.phase)) renderWait();
    CSR.phaseSeen=d.phase;
  }
}
function enterIdeation(){
  T.inIdeation=true; T.since=0; T.firstPoll=true;
  $('page-team').style.display='none'; $('page-ideation').style.display='flex';
  startIdeation(); S.participantId=me(); renderTeamBar();
  if(T.phase==='working'){ _instrAfterDetails=true; openDetailsModal(); }
}

// Merge the nodes the server sent into S.nodes. Returns true when something changed on screen.
function dirtyKey(r){ const c=Object.assign({},r); delete c.contributors; delete c.created_by; return canon(c); }
function nodeFromRow(r){
  const n={id:r.node_id,parentId:r.parent_id||null,groupId:r.group_id,type:r.type,tag:r.tag,title:r.title||'',body:r.body||'',
    userPrompt:r.user_prompt||'',aiResponse:r.ai_response||'',extras:r.extras||[],isFinalized:!!r.is_finalized,
    ts:Number(r.created_at_ms)||Date.now(),meta:{},createdBy:r.created_by||'',contributors:r.contributors||[]};
  const cs=(n.extras||[]).filter(x=>x&&x.type==='change_summary').pop();
  if(cs) n.meta={changeSummary:cs.summary||'',promptSummary:cs.prompt_summary||'',ideaSummary:cs.idea_summary||''};
  return n;
}
function ingestNodes(rows){
  let changed=false;
  (rows||[]).forEach(r=>{
    const idx=S.nodes.findIndex(n=>n.id===r.node_id);
    if(r.deleted){ if(idx>=0){ S.nodes.splice(idx,1); changed=true; if(S.currentNodeId===r.node_id) reselectAfterRemoval(r); } return; }
    if(_gone.has(r.node_id)) return;
    const inc=nodeFromRow(r);
    if(idx<0){ S.nodes.push(inc); _synced[inc.id]=dirtyKey(nodeToRow(inc)); changed=true; return; }
    const ex=S.nodes[idx], exRow=nodeToRow(ex);
    if(_synced[ex.id]!==dirtyKey(exRow)) return;                 // this page has changes not saved yet: they win
    if(canon(exRow)===canon(nodeToRow(inc))) return;
    Object.assign(ex,inc); _synced[ex.id]=dirtyKey(nodeToRow(ex)); changed=true;   // same object: open popups keep pointing at it
  });
  if(changed&&S.currentNodeId&&!S.nodes.find(n=>n.id===S.currentNodeId)){ S.currentNodeId=null; S.currentGroupId=null; }
  return changed;
}
function reselectAfterRemoval(row){
  const par=row.parent_id&&S.nodes.find(n=>n.id===row.parent_id);
  if(par){ S.currentNodeId=par.id; S.currentGroupId=par.groupId; } else { S.currentNodeId=null; S.currentGroupId=null; }
}
// Re-draw the tree without jumping: keep the scroll position and don't re-centre on the current idea
function softRefresh(){
  const sc=$('tree-scroll'), st=sc?sc.scrollTop:0, sl=sc?sc.scrollLeft:0;
  const gids=new Set(S.nodes.map(n=>n.groupId)), cur=curNode();
  _pan._focusKey=(cur?cur.groupId:'')+'|'+(gids.size||1);
  refreshUI();
  if(sc){ sc.scrollTop=st; sc.scrollLeft=sl; }
}

// ============================================================
//  3. Saving nodes to the team tables
// ============================================================
window.nodeToRow = function(n){
  return { node_id:n.id, group_id:n.groupId, parent_id:n.parentId||null, type:n.type, tag:n.tag, title:n.title||'', body:n.body||'',
    is_finalized:!!n.isFinalized, user_prompt:n.userPrompt||'', ai_response:n.aiResponse||'', extras:n.extras||[],
    created_by:n.createdBy||'', contributors:n.contributors||[], created_at_ms:n.ts };
};
window._doSync = async function(){
  if(!S.participantId||!T.code) return true;
  const changed=S.nodes.map(n=>nodeToRow(n)).filter(r=>_synced[r.node_id]!==dirtyKey(r));
  if(!changed.length) return true;
  const r=await api('/api/c/nodes/save',{code:T.code,pid:me(),nodes:changed});
  if(!r.ok){ console.error('Save failed:',r.data.error); return false; }
  changed.forEach(x=>{ _synced[x.node_id]=dirtyKey(x); });
  return true;
};
window.queueSync = function(){ if(!S.participantId) return; clearTimeout(_syncTimer); _syncTimer=setTimeout(retrySync,150); };

// ============================================================
//  4. Labels: who created / edited a node
// ============================================================
window.nodeTagParts = function(node){
  const t=node.tag, ai=(t==='ai-generated'||t==='ai-modification'), who=(node.contributors||[]);
  if(ai){
    const custom=isCustomPrompt(node);
    return {main:t==='ai-generated'?'Created with AI':'Edited with AI',
            note:custom?'(custom prompt'+(who.length?' · '+pidsLabel(who):'')+')':'(default prompt)',
            cls:custom?'pc-custom':'pc-default'};
  }
  const verb=t==='user-created'?'Created':'Edited';
  return {main:verb+(who.length?' by '+pidsLabel(who):' manually'),note:'',cls:''};
};

// ── "Who contributed to this idea / edit / prompt?" ───────────
const CONTRIB_TITLE={idea:'Who contributed to this idea?',edit:'Who contributed to this edit?',prompt:'Who contributed to this prompt?',tag:'Who contributed to this idea version?'};
function askContributors(kind,preselect){
  return new Promise(resolve=>{
    const list=T.members.length?T.members.map(m=>m.pid):[me()];
    const sel=new Set(preselect&&preselect.length?preselect:[me()]);
    $('c-contrib-title').textContent=CONTRIB_TITLE[kind]||CONTRIB_TITLE.idea;
    $('c-contrib-list').innerHTML=list.map((p,i)=>`<label class="c-contrib-opt"><input type="checkbox" value="${esc(p)}" ${sel.has(p)?'checked':''}><span class="c-dot" style="background:${memberColor(p)}"></span>${esc(pidLabel(p))}${p===me()?' (you)':''}</label>`).join('');
    $('c-contrib-err').style.display='none';
    const done=v=>{ $('c-contrib-modal').style.display='none'; resolve(v); };
    $('c-contrib-ok').onclick=()=>{
      const v=[...$('c-contrib-list').querySelectorAll('input:checked')].map(x=>x.value);
      if(!v.length){ $('c-contrib-err').style.display='block'; return; }
      done(v);
    };
    $('c-contrib-cancel').onclick=()=>done(null);
    $('c-contrib-modal').style.display='flex';
  });
}
function stamp(node,contributors){ node.createdBy=me(); node.contributors=contributors||[]; return node; }

// ============================================================
//  5. The single-user plumbing of Condition A (no chat panel), with team additions
// ============================================================
window.showChatInitial = function(){ _chatMode=null; showStart(); };
window.showChatActive = function(){};
window.setNewIdeaButtonsVisible = function(){};
window.updateChatHeader = function(){};
window.rebuildChat = function(){};
window.renderChatActions = function(){};
window.setChatThinking = function(){};
window.appendToChat = function(el){ const t=(el.textContent||'').trim(); if(/^Error/.test(t)) toast(t,'var(--red)'); };
window.selectIdea = function(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId=nodeId; S.currentGroupId=node.groupId; refreshUI();
};

function openNewIdea(){ placeCreate('modal'); $('newidea-modal').style.display='flex'; chooseCreate(null); }
function closeNewIdea(){ $('newidea-modal').style.display='none'; }
window.startNewIdea = function(){ if(!S.nodes.length) return; offerFinalizeThen(openNewIdea); };

window.submitManualCreate = async function(){
  const ta=$('create-body'); const body=ta?ta.value.trim():'';
  if(!body){ toast('Please describe your idea.'); return; }
  const who=await askContributors('idea'); if(!who) return;
  addNode(stamp(mkNode({type:'creation',tag:'user-created',title:'',body}),who));
  ta.value=''; chooseCreate(null); closeNewIdea(); refreshUI();
};
window.confirmGenerateConfirm = async function(){
  const edited=$('generate-prompt-text').value.trim();
  if(!edited){ setGeneratePromptError('Please enter a prompt.'); return; }
  const {system,hiddenSuffix}=_pendingGenerate||{};
  const custom=edited!==((_pendingGenerate||{}).editable||'');
  const btn=$('btn-generate-confirm');
  setGeneratePromptError('');
  btn.disabled=true; btn.textContent='Checking prompt…';
  const reset=()=>{ btn.disabled=false; btn.textContent=GENERATE_LABEL; };
  try{
    const {system:vSys,user:vUser}=PROMPTS.validateIdeaPrompt(S.challenge,edited);
    const verdict=(await callClaude([{role:'user',content:vUser}],vSys)).trim();
    if(!/^VALID/i.test(verdict)){
      const reason=verdict.replace(/^INVALID:?\s*/i,'').trim();
      setGeneratePromptError(reason?`Please enter a valid prompt: ${reason}`:'Please enter a valid prompt for this design challenge.');
      reset(); return;
    }
    let who=[];
    if(custom){ who=await askContributors('prompt'); if(!who){ reset(); return; } }   // only an edited prompt is linked to people
    btn.textContent='Generating…';
    const text=await callClaude([{role:'user',content:edited+hiddenSuffix}],system);
    const json=parseAIJSON(text);
    const gen=stamp(mkNode({type:'creation',tag:'ai-generated',body:await enforceWords(json.body,edited),userPrompt:edited}),who);
    if(custom) gen.extras.push({type:'custom_prompt',ts:Date.now()});
    addNode(gen);
    _pendingGenerate=null; $('generate-prompt-text').value=''; chooseCreate(null); closeNewIdea(); refreshUI();
  }catch(e){ setGeneratePromptError('Could not generate an idea: '+e.message); }
  finally{ reset(); }
};

// Edit yourself / edit with AI (popups with the composer)
function openNodeModal(mode){
  const node=curNode(); if(!node) return;
  const body=$('node-modal-body'); body.innerHTML='';
  const comp=buildChatComposer(mode,node); body.appendChild(comp);
  comp.querySelector('.chat-composer-row .btn-outline').onclick=closeNodeModal;
  $('node-modal').style.display='flex';
  fitPromptLabels(); const ta=$('chat-composer-text'); if(ta) ta.focus();
}
function closeNodeModal(){ $('node-modal').style.display='none'; }
window.submitSelfEdit = async function(){
  const body=$('chat-composer-text').value.trim(); const parent=curNode(); if(!parent) return;
  if(!body){ setComposerError('Please describe your idea.'); return; }
  if(body===parent.body){ setComposerError('No changes detected. Please edit the idea before saving.'); return; }
  const who=await askContributors('edit'); if(!who) return;
  closeNodeModal();
  addNode(stamp(mkNode({type:'modification',tag:'manual-modification',title:'',body,parentId:parent.id,userPrompt:'[Manual modification]'}),who));
  refreshUI(); toast('Idea updated');
};
window.submitAIEdit = async function(){
  const msg=$('chat-composer-text').value.trim(); const parent=curNode(); if(!parent) return;
  if(!msg){ setComposerError('Please enter a prompt.'); return; }
  let who=[];
  if(msg!==DEFAULT_EDIT_PROMPT){ who=await askContributors('prompt'); if(!who) return; }   // default prompt: not linked to a PID
  closeNodeModal(); toast('Editing with AI…');
  try{
    const {system,user}=PROMPTS.modifyIdeaChat(parent.body,S.challenge,msg,buildRecentContext(parent));
    const json=parseAIJSON(await callClaude([{role:'user',content:user}],system));
    json.body=await enforceWords(json.body,msg);
    addNode(stamp(mkNode({parentId:parent.id,type:'modification',tag:'ai-modification',body:json.body,userPrompt:msg,aiResponse:JSON.stringify(json)}),who));
    refreshUI();
  }catch(e){ toast('Could not edit the idea: '+e.message,'var(--red)'); }
};

// Finalize / unfinalize: shared by the team; who did it is logged on the node
(function(){
  const base=window.doFinalizeIdea;
  window.doFinalizeIdea=function(node){
    base(node);
    node.extras.push({type:node.isFinalized?'finalized':'unfinalized',by:me(),ts:Date.now()}); queueSync();
  };
})();

// Discard: removed for everybody (the database keeps the row, marked as discarded)
window.doDiscard = async function(ids){
  const set=new Set(ids), removed=S.nodes.filter(n=>set.has(n.id));
  removed.forEach(n=>n.extras.push({type:'discarded',by:me(),ts:Date.now()}));
  if(!(await syncNow())){ toast('Could not save. Check your connection and try again.','var(--red)'); return; }
  const r=await api('/api/c/nodes/discard',{code:T.code,pid:me(),node_ids:ids});
  if(!r.ok){ toast(r.data.error||'Could not discard.','var(--red)'); return; }
  ids.forEach(id=>_gone.add(id));
  S.nodes=S.nodes.filter(n=>!set.has(n.id));
  if(set.has(S.currentNodeId)){
    const first=removed[0], parent=first&&first.parentId?S.nodes.find(n=>n.id===first.parentId):null;
    if(parent){ S.currentNodeId=parent.id; S.currentGroupId=parent.groupId; } else { S.currentNodeId=null; S.currentGroupId=null; }
  }
  refreshUI(); toast('Idea discarded');
};

// Toolbar above the tree
window.onTreeNodeClick = function(nodeId){ if(CSR.on) return; selectIdea(nodeId); refocusTree(); };
function renderActions(){
  const box=$('a5-actions'); if(!box) return;
  const node=curNode();
  if(CSR.on||!node||!S.nodes.length){ box.style.display='none'; return; }
  box.innerHTML='';
  const mk=(label,cls,fn)=>{ const b=document.createElement('button'); b.className='btn a5-tb-btn '+cls; b.textContent=label; b.onclick=fn; box.appendChild(b); };
  mk('Edit the idea yourself','btn-edit-self',()=>openNodeModal('edit-self'));
  mk('Edit the idea using AI','btn-edit-ai',()=>openNodeModal('edit-ai'));
  mk(node.isFinalized?'Unfinalize the idea':'Finalize the idea',node.isFinalized?'btn-outline':'btn-finalize',()=>finalizeCurrentIdea(node));
  mk('Discard the current idea','btn-discard',()=>discardNode(node.id));
  box.style.display='flex';
  const st=$('a5-start'); if(st&&st.style.display!=='none') box.style.display='none';
  fitToolbar();
}
function fitToolbar(){
  const box=$('a5-actions'); if(!box||box.style.display==='none') return;
  const bs=[...box.querySelectorAll('.a5-tb-btn')]; let fs=15;
  bs.forEach(b=>{ b.style.fontSize=fs+'px'; });
  while(fs>7 && box.scrollWidth>box.clientWidth+1){ fs-=0.5; bs.forEach(b=>{ b.style.fontSize=fs+'px'; }); }
}
window.addEventListener('resize',fitToolbar);

const _refreshUIBase=window.refreshUI;
window.refreshUI=function(){
  _refreshUIBase(); renderCurrentIdea();
  if(!S.nodes.length){ if(!CSR.on) showStart(); }
  else if(draftOpen()){ showStartNote(true); }          // someone is typing an idea: a teammate's new node must not take it away
  else{ showStartNote(false); hideStart(); }
  renderActions();
  const nb=$('a5-newbtn'); if(nb) nb.style.display=(S.nodes.length&&!CSR.on&&!draftOpen())?'':'none';
};
// The create-an-idea box sits on the start screen until the first node exists. If a teammate's node arrives while this
// member has already chosen "by yourself" / "with AI", the box stays (with a note) until they save or press "View the idea tree".
function draftOpen(){
  const st=$('a5-start'); if(!st||st.style.display==='none') return false;
  const a=$('create-ai-box'), b=$('create-self-box');
  return !!((a&&a.style.display!=='none')||(b&&b.style.display!=='none'));
}
function showStartNote(on){
  const st=$('a5-start'); if(!st) return; let n=$('c-start-note');
  if(!on){ if(n) n.remove(); return; }
  if(n) return;
  n=document.createElement('div'); n.id='c-start-note'; n.className='c-start-note';
  n.innerHTML='Your team has added ideas to the tree. Your draft is kept. <a href="#" id="c-start-view">View the idea tree</a> (you can come back to your draft with “+ New Idea”).';
  st.insertBefore(n,st.firstChild);
  $('c-start-view').onclick=e=>{ e.preventDefault(); n.remove(); hideStart(); refreshUI(); };
}
// Choosing a creation mode again keeps what was already typed
(function(){
  const base=window.chooseCreate;
  window.chooseCreate=function(mode){
    const ta=$('create-body'), keep=ta?ta.value:'', pt=$('generate-prompt-text'), keepP=pt?pt.value:'', def=(_pendingGenerate||{}).editable;
    base(mode);
    if(mode==='self'&&ta&&keep) ta.value=keep;
    if(mode==='ai'&&pt&&keepP&&keepP!==def){ pt.value=keepP; pt.classList.remove('is-default'); }
  };
})();
let _createBox=null;
function placeCreate(where){
  if(!_createBox) _createBox=document.querySelector('#newidea-modal .generate-inline');
  const host=where==='start'?$('a5-start'):document.querySelector('#newidea-modal .modal-body');
  if(host&&_createBox.parentNode!==host) host.appendChild(_createBox);
}
function showStart(){
  const st=$('a5-start'); if(!st) return;
  const hdr=st.parentNode.querySelector('.panel-header'); st.style.top=(hdr?hdr.offsetHeight:56)+'px';
  placeCreate('start'); st.style.display='flex';
  if(!st.dataset.init){ st.dataset.init='1'; chooseCreate(null); }
}
function hideStart(){
  const st=$('a5-start'); if(!st||st.style.display==='none') return;
  st.style.display='none'; st.dataset.init=''; placeCreate('modal');
}
function renderCurrentIdea(){
  const box=$('a5-current'); if(!box) return;
  const n=curNode();
  if(!n){ box.innerHTML='<p class="a5-empty">No idea selected yet. Create a new idea, or click a node in the idea tree.</p>'; return; }
  box.innerHTML=`<div class="a5-cur-tag">${esc(nodeTagLabel(n))}${n.isFinalized?' · Finalized':''}</div><div class="a5-cur-body">${esc(n.body)}</div>`;
}

// ============================================================
//  6. Team bar, presence circles, tag editing (drawn after every tree render)
// ============================================================
function renderTeamBar(){
  const bar=$('c-team-bar'); if(!bar) return;
  bar.innerHTML=`<span class="c-team-code" title="Share this number so others can join">Team ${esc(T.code||'')}</span>`+
    T.members.map(m=>`<span class="c-chip${m.online?'':' c-off'}" title="${esc(pidLabel(m.pid))}${m.online?'':' (offline)'}"><span class="c-dot" style="background:${memberColor(m.pid)}"></span>${esc(bare(m.pid))}</span>`).join('');
}
function canEditTag(n){ return !CSR.on&&T.phase==='working'&&(n.tag==='user-created'||n.tag==='manual-modification'||isCustomPrompt(n)); }
function decorateNodes(){
  const nodesEl=$('tree-nodes'); if(!nodesEl) return;
  nodesEl.querySelectorAll('.c-pres-row,.c-tag-edit').forEach(e=>e.remove());
  nodesEl.querySelectorAll('.c-hl').forEach(e=>e.classList.remove('c-hl'));
  const where={};   // node id -> [pid]
  T.members.forEach(m=>{ const cur=m.pid===me()?myCur():m.cur; if(cur) (where[cur]=where[cur]||[]).push(m); });
  nodesEl.querySelectorAll('.tree-node[data-node-id]').forEach(el=>{
    const id=el.dataset.nodeId, node=S.nodes.find(n=>n.id===id); if(!node) return;
    const inner=el.querySelector('.tree-node-inner');
    if(CSR.on&&CSR.hl===id) el.classList.add('c-hl');
    if(inner&&canEditTag(node)){
      const b=document.createElement('button'); b.className='c-tag-edit'; b.title='Edit who contributed'; b.setAttribute('aria-label','Edit who contributed'); b.textContent='✎';
      b.addEventListener('click',e=>{ e.stopPropagation(); hideTreeTooltip(); editTag(node); });
      inner.appendChild(b);
    }
    const here=where[id];
    if(here&&here.length){
      const row=document.createElement('div'); row.className='c-pres-row';
      row.innerHTML=here.map(m=>`<span class="c-pres${m.online||m.pid===me()?'':' c-off'}" style="background:${memberColor(m.pid)}" title="${esc(pidLabel(m.pid))} is here">${esc(bare(m.pid))}</span>`).join('');
      el.appendChild(row);
    }
  });
}
async function editTag(node){
  const who=await askContributors('tag',node.contributors); if(!who) return;
  const r=await api('/api/c/nodes/tags',{code:T.code,pid:me(),node_id:node.id,contributors:who});
  if(!r.ok){ toast(r.data.error||'Could not save the tag.','var(--red)'); return; }
  node.contributors=r.data.contributors||who; refreshUI(); renderCurrentIdea();
}

// Dotted "influenced by" lines, one per link; every member who picked it is listed next to it
function drawTeamInfluence(svg){
  const nodesEl=$('tree-nodes'); if(!nodesEl||!T.infl||!T.infl.length) return;
  const by={};
  T.infl.forEach(r=>{ const k=r.node_id+'|'+r.from_node_id; (by[k]=by[k]||{to:r.node_id,from:r.from_node_id,pids:[]}).pids.push(r.participant_id); });
  const has=id=>nodesEl.querySelector(`[data-node-id="${id}"]`);
  const groups=Object.values(by).filter(g=>has(g.to)&&has(g.from));
  if(!groups.length) return;
  const before=svg.querySelectorAll('path.edge-infl').length;
  drawInfluenceLines(svg,nodesEl,groups.map(g=>({from:g.to,to:g.from,arrow:true})),_pan.k||1);   // arrow points into the influenced idea
  const paths=[...svg.querySelectorAll('path.edge-infl')].slice(before);
  groups.forEach((g,i)=>{
    const p=paths[i]; if(!p) return;
    const pt=p.getPointAtLength(p.getTotalLength()*0.5);
    const tag=document.createElement('div'); tag.className='c-infl-tag';
    tag.style.left=pt.x+'px'; tag.style.top=pt.y+'px';
    tag.textContent=g.pids.sort().map(pidLabel).join(', ');
    tag.title=g.pids.map(pidLabel).join(', ')+' selected this influence';
    nodesEl.appendChild(tag);
  });
}
window.drawExtraEdges = function(svg){
  decorateNodes();
  if(T.phase==='self_report'||T.phase==='finished') drawTeamInfluence(svg);
};
function scrollToNode(id){
  const sc=$('tree-scroll'), cv=$('tree-canvas'), p=_pan.pos&&_pan.pos[id]; if(!sc||!cv||!p) return;
  const k=_pan.k||1;
  sc.scrollTop=Math.max(0,p.y*k+cv.offsetTop-sc.clientHeight/3);
  sc.scrollLeft=Math.max(0,p.x*k-sc.clientWidth/2);
}

// ============================================================
//  7. "Done with Task": one member asks, everyone has to approve
// ============================================================
window.handleDone = function(){
  if(T.phase!=='working') return;
  offerFinalizeThen(async()=>{
    if(!finalizedCount()){ toast('Please finalize at least one idea before finishing.','var(--amber)'); return; }
    await syncNow();
    const r=await api('/api/c/done/request',{code:T.code,pid:me()});
    if(!r.ok) toast(r.data.error||'Could not send the request.','var(--red)'); else pollOnce();
  });
};
function hideDone(){ $('c-done-modal').style.display='none'; T.doneSig=''; }
function renderDone(){
  const d=T.done||{};
  if(!d.active){ hideDone(); return; }
  const mine=T.members.find(m=>m.pid===me())||{};
  const sig=canon([d.round,d.by,T.members.map(m=>[m.pid,m.done_ok]),mine.done_ok]);
  if(sig===T.doneSig) return; T.doneSig=sig;
  const waiting=T.members.filter(m=>!m.done_ok).map(m=>pidLabel(m.pid));
  const status=`<ul class="c-done-list">${T.members.map(m=>`<li>${m.done_ok?'✓':'•'} ${esc(pidLabel(m.pid))}${m.pid===me()?' (you)':''} <span class="c-tagline">${m.done_ok?'agrees':'has not answered yet'}</span></li>`).join('')}</ul>`;
  const title=$('c-done-title'), body=$('c-done-body'), foot=$('c-done-foot');
  const keep={cls:'btn-outline',label:'No, keep working',fn:async()=>{ await api('/api/c/done/respond',{code:T.code,pid:me(),approve:false}); pollOnce(); }};
  let btns=[];
  if(d.by===me()){
    title.textContent='Waiting for your team';
    body.innerHTML=`<p>You said the team is done. Everyone has to agree before the team moves on.</p>${status}`;
    btns=[{cls:'btn-outline',label:'Cancel the request',fn:async()=>{ await api('/api/c/done/cancel',{code:T.code,pid:me()}); pollOnce(); }}];
  }else if(!mine.done_ok){
    title.textContent=`${pidLabel(d.by||'')} says the team is done`;
    body.innerHTML=`<p>Is your team done with the task? Everyone has to agree before the team moves on to the questions.</p>${status}`;
    btns=[keep,{cls:'btn-green',label:'Yes, we are done',fn:async()=>{ await api('/api/c/done/respond',{code:T.code,pid:me(),approve:true}); pollOnce(); }}];
  }else{
    title.textContent='Waiting for your team';
    body.innerHTML=`<p>You agreed. Waiting for ${esc(waiting.join(', '))}.</p>${status}`;
    btns=[keep];
  }
  foot.innerHTML='';
  btns.forEach(b=>{ const e=document.createElement('button'); e.className='btn '+b.cls; e.textContent=b.label; e.onclick=b.fn; foot.appendChild(e); });
  $('c-done-modal').style.display='flex';
}
function showDeclineToast(){
  const dc=T.done&&T.done.decline; if(!dc||dc.ms<=T.declineSeen) return;
  T.declineSeen=dc.ms;
  if(dc.by!==me()) toast(`${pidLabel(dc.by)} wants to keep working. Your team is back to work.`,'var(--amber)');
}

// ============================================================
//  8. Questions after the task, each member on their own. Same screens and wording as Condition A:
//     influence (pick the finalized ideas that influenced this one), then ownership (+ a written explanation).
//     The full-screen popup is used for the questions; when a member is done, the shared tree with
//     everyone's dotted influence lines (tagged with PIDs) and the team's progress is shown.
// ============================================================
const CSR={on:false,ideas:[],cand:{},askIdx:[],infl:{},inflSubmitted:false,own:{},expl:{},stage:'intro-infl',p:0,busy:false,hl:null,phaseSeen:null};
const OWN_Q='To what extent do you feel this idea belongs to you?';
const idxOf=n=>CSR.ideas.findIndex(x=>x.id===n.id)+1;
function csrHide(){ ['newidea-modal','node-modal','modal-confirm','c-done-modal','c-contrib-modal','details-modal','instructions-modal'].forEach(id=>{ const e=$(id); if(e) e.style.display='none'; }); hideTreeTooltip(); }
function startSelfReport(){
  if(CSR.on) return; CSR.on=true;
  csrHide(); window.TREE_READONLY=true;
  document.body.classList.add('c-sr-mode');
  const side=document.querySelector('.a5-side:not(.c-sr)'); if(side) side.style.display='none';
  $('c-sr').style.display='flex'; const bd=$('btn-done'); if(bd) bd.style.display='none';
  const ideas=S.nodes.filter(n=>n.isFinalized).sort((a,b)=>srRootTs(a)-srRootTs(b)||(a.ts||0)-(b.ts||0));
  CSR.ideas=ideas; SR={ideas};   // renderSrTree (shared.js) numbers the ideas from SR.ideas
  ideas.forEach(n=>{ CSR.cand[n.id]=ideas.filter(o=>srCanInfluence(n,o)).map(o=>o.id); CSR.infl[n.id]=CSR.infl[n.id]||{}; CSR.own[n.id]=0; CSR.expl[n.id]=''; });
  CSR.askIdx=ideas.map((n,i)=>i).filter(i=>CSR.cand[ideas[i].id].length);
  const mine=T.members.find(m=>m.pid===me())||{};
  CSR.stage=mine.own_done?'wait':(mine.infl_done||!CSR.askIdx.length)?'intro-own':'intro-infl'; CSR.p=0;
  if(!CSR.askIdx.length&&!mine.infl_done) api('/api/c/sr/influence',{code:T.code,pid:me(),picks:[]});   // nothing to ask: counts as answered
  softRefresh(); renderSR();
}

// Landing pages (same layout and wording as Condition A)
const hasInfl=()=>CSR.askIdx.length>0;
const CSR_INTRO={
  'intro-infl':{lead:()=>THANKS+' We would like to understand how your team’s ideas may have influenced each other.',
    what:()=>'For each of the <strong>finalized ideas</strong>, we will ask you to select other finalized idea(s) that influenced it.',
    how:()=>'Click on the ideas that influenced the idea shown on the left. If none did, simply press Next.',
    why:()=>'While brainstorming, an idea can be inspired or influenced by another idea. For example, one idea may have shaped how you or your teammates approached another idea, without anyone ever copying the first idea’s text. These influences are not tracked by the tool since they often occur in one’s mind. We are trying to track such influences. You answer on your own; your teammates answer on their own screens.'},
  'intro-own':{lead:()=>hasInfl()?'Thank you for telling us how some of the ideas were influenced by other ideas! We would like to understand your perception of your team’s ideas.':THANKS+' We would like to understand your perception of your team’s ideas.',
    what:()=>'We will ask one question about each of the finalized ideas and ask you to briefly explain your answer: <ol class="sr-intro-ol"><li>How much do you feel <strong>the idea belongs to you</strong>?</li></ol>',
    how:()=>'Choose the option that best describes how you feel, then write a short explanation. There are no right or wrong answers!',
    why:()=>'We are trying to understand how you perceive your team’s ideation with AI. Things like ownership are difficult to understand from what you did on screen, so we ask you directly. Your answers will help us understand how people’s ideation process influences their perception. You answer on your own; your teammates answer on their own screens.'}
};
const stepNo=st=>st==='intro-infl'?1:(hasInfl()?2:1);
const srRight=()=>document.querySelector('#self-report-modal .sr-right');
function csrHideLeft(){ $('sr-left').style.display='none'; $('sr-idea-display').innerHTML=''; hideTreeTooltip(); }
const backBtn=on=>on?'<button class="btn btn-outline" id="c-sr-back">← Back</button>':'';

// everyone's influence picks: the server's rows, with this member's own picks shown at once
function allInflRows(){
  const rows=(T.infl||[]).slice();
  if(!CSR.inflSubmitted) return rows;
  const others=rows.filter(r=>r.participant_id!==me());
  CSR.ideas.forEach(n=>Object.keys(CSR.infl[n.id]||{}).forEach(oid=>others.push({node_id:n.id,from_node_id:oid,participant_id:me()})));
  return others;
}
function pidsFor(nid,oid){ return [...new Set(allInflRows().filter(r=>r.node_id===nid&&r.from_node_id===oid).map(r=>r.participant_id))].sort(); }

function renderSR(){
  const st=CSR.stage;
  if(st==='wait'){ $('self-report-modal').style.display='none'; hideTreeTooltip(); CSR.hl=null; renderWait(); return; }
  $('self-report-modal').style.display='flex';
  if(st==='intro-infl'||st==='intro-own') return renderIntro(st);
  if(st==='infl') return renderInfl();
  renderOwn();
}
function renderIntro(st){
  csrHideLeft(); CSR.hl=null;
  const I=CSR_INTRO[st], P=(l,t)=>`<div class="sr-intro-p"><strong>${l}:</strong> ${t}</div>`;
  const back=st==='intro-own'&&hasInfl();
  srRight().innerHTML=`<div class="sr-intro"><div class="sr-intro-card"><div class="sr-intro-step">Step ${stepNo(st)}</div><h2 class="sr-intro-title">${I.lead()}</h2>`
    +P('What will you do',I.what())+P('How will you do it',I.how())
    +`<details class="sr-why"><summary>How will this help our research</summary><div class="sr-intro-p">${I.why()}</div></details>`
    +`<div class="sr-foot">${backBtn(back)}<button class="btn btn-primary" id="c-sr-next">Next →</button></div></div></div>`;
  wireSR();
}
function renderInfl(){
  csrHideLeft();
  const n=CSR.ideas[CSR.askIdx[CSR.p]], N=CSR.ideas.length; CSR.hl=n.id;
  const cards=CSR.cand[n.id].map(oid=>{ const o=CSR.ideas.find(x=>x.id===oid), on=!!CSR.infl[n.id][oid];
    return `<div class="sr-infl-card sr-selectable${on?' sr-selected':''}" data-oid="${oid}"><div class="sr-infl-num">Idea ${idxOf(o)}</div><div class="sr-infl-body">${esc(o.body||'')}</div></div>`; }).join('');
  srRight().innerHTML=`<div class="sr-right-header"><div class="sr-step-indicator">Idea ${idxOf(n)} of ${N}</div></div>
    <div class="sr-page" style="display:flex;min-height:0">
      <p class="sr-q-label">Please select the ideas on the right that influenced the origin of the idea on the left. If none, press next.</p>
      <div class="sr-infl-wrap">
        <div class="sr-infl-leftcol"><div class="sr-infl-title">Idea you are considering</div>
          <div class="sr-infl-this"><div class="sr-infl-num">Idea ${idxOf(n)}</div><div class="sr-infl-body">${esc(n.body||'')}</div></div>
          <div class="sr-infl-log" id="sr-infl-log"></div></div>
        <div class="sr-infl-rightcol"><div class="sr-infl-title">Which ideas might have influenced it</div>
          <div class="sr-infl-list">${cards}</div></div>
      </div>
      <div class="sr-foot">${backBtn(true)}<button class="btn btn-primary" id="c-sr-next">Next →</button></div>
    </div>`;
  inflLog(); wireSR();
}
function inflLog(){
  const el=$('sr-infl-log'); if(!el) return; const n=CSR.ideas[CSR.askIdx[CSR.p]];
  el.innerHTML=CSR.ideas.map(o=>CSR.infl[n.id][o.id]?`<div class="sr-infl-log-line">Idea ${idxOf(o)} influenced Idea ${idxOf(n)}</div>`:'').join('');
}
function renderOwn(){
  const n=CSR.ideas[CSR.p], N=CSR.ideas.length; CSR.hl=n.id;
  const a=CSR.own[n.id];
  $('sr-idea-tabs').innerHTML=CSR.ideas.map((x,i)=>`<div class="sr-idea-tab${x.id===n.id?' sr-idea-active':' sr-tab-off'}" style="cursor:default">Idea ${i+1}</div>`).join('');
  srRight().innerHTML=`<div class="sr-right-header"><div class="sr-step-indicator">Idea ${CSR.p+1} of ${N}</div></div>
    <div class="sr-page" style="display:flex">
      <div class="sr-q-block"><p class="sr-q-label">1. ${OWN_Q}</p>
        ${SR_LVL.map((l,v)=>`<label class="sr-opt"><input type="radio" name="c-own" value="${v+1}" ${a===v+1?'checked':''}> ${l}</label>`).join('')}</div>
      <div class="sr-q-block"><p class="sr-q-label">2. Please provide a brief explanation for your answer:</p>
        <textarea id="c-sr-expl" class="field-textarea" rows="5" placeholder="Type your explanation here…">${esc(CSR.expl[n.id])}</textarea></div>
      <div class="sr-foot">${backBtn(true)}<button class="btn btn-primary" id="c-sr-next" disabled>${CSR.p===N-1?'Finish':'Next →'}</button></div>
    </div>`;
  showLeftTree(n); wireSR();
}
// left side: the idea's final text and its tree; the ideas that influenced it (anyone's pick) sit beside it with dotted lines tagged by PID
function showLeftTree(n){
  hideTreeTooltip();
  const left=$('sr-left'); left.style.display='flex'; $('sr-sub-tabs').style.display='none';
  let fb=$('sr-final-banner');
  if(!fb){ fb=document.createElement('div'); fb.id='sr-final-banner'; fb.style.cssText='flex-shrink:0;max-height:28%;overflow:auto;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);font-size:0.95rem;line-height:1.5'; const d=$('sr-idea-display'); d.parentNode.insertBefore(fb,d); }
  fb.style.display=''; fb.innerHTML=`<strong>Final idea:</strong> ${esc(n.body||'')}`;
  const rows=allInflRows().filter(r=>r.node_id===n.id);
  const insp=CSR.ideas.filter(o=>rows.some(r=>r.from_node_id===o.id)).map(o=>({gid:o.groupId,ids:new Set([o.id]),label:'Idea '+idxOf(o),o}));
  srDraw($('sr-idea-display'),n,null,null,insp);
  const svg=$('sr-tree-svg'), nodesEl=$('sr-tree-nodes'); if(!svg||!nodesEl) return;
  const paths=[...svg.querySelectorAll('path.edge-infl')];
  insp.slice().sort((a,b)=>idxOf(a.o)-idxOf(b.o)).forEach((g,i)=>{   // lines are drawn in idea-number order
    const p=paths[i]; if(!p) return; const pt=p.getPointAtLength(p.getTotalLength()*0.5);
    const tag=document.createElement('div'); tag.className='c-infl-tag'; tag.style.left=pt.x+'px'; tag.style.top=pt.y+'px';
    tag.textContent=pidsFor(n.id,g.o.id).map(pidLabel).join(', '); nodesEl.appendChild(tag);
  });
}
function wireSR(){
  const st=CSR.stage, N=CSR.ideas.length, nx=$('c-sr-next'), bk=$('c-sr-back');
  if(st==='infl'){
    document.querySelectorAll('.sr-infl-card').forEach(el=>el.onclick=()=>{
      const n=CSR.ideas[CSR.askIdx[CSR.p]], oid=el.dataset.oid;
      if(CSR.infl[n.id][oid]) delete CSR.infl[n.id][oid]; else CSR.infl[n.id][oid]=true;
      el.classList.toggle('sr-selected',!!CSR.infl[n.id][oid]); inflLog();
    });
  }
  if(st==='own'){
    const n=CSR.ideas[CSR.p], ta=$('c-sr-expl');
    const upd=()=>{ nx.disabled=!(CSR.own[n.id]&&CSR.expl[n.id].trim()); };
    document.querySelectorAll('input[name="c-own"]').forEach(r=>r.onchange=()=>{ CSR.own[n.id]=+r.value; upd(); });
    ta.oninput=()=>{ CSR.expl[n.id]=ta.value; upd(); }; upd();
  }
  if(bk) bk.onclick=()=>{
    if(st==='infl'){ if(CSR.p>0) CSR.p--; else CSR.stage='intro-infl'; }
    else if(st==='own'){ if(CSR.p>0) CSR.p--; else CSR.stage='intro-own'; }
    else if(st==='intro-own'){ CSR.stage='infl'; CSR.p=CSR.askIdx.length-1; }
    renderSR();
  };
  if(nx) nx.onclick=async()=>{
    if(CSR.busy) return;
    if(st==='intro-infl'){ CSR.stage='infl'; CSR.p=0; renderSR(); return; }
    if(st==='infl'){
      if(CSR.p<CSR.askIdx.length-1){ CSR.p++; renderSR(); return; }
      CSR.busy=true; nx.disabled=true;
      const picks=[]; CSR.ideas.forEach(n=>CSR.cand[n.id].forEach(oid=>picks.push({node_id:n.id,from_node_id:oid,checked:!!CSR.infl[n.id][oid]})));
      const r=await api('/api/c/sr/influence',{code:T.code,pid:me(),picks}); CSR.busy=false;
      if(!r.ok){ toast(r.data.error||'Could not save your answers. Please try again.','var(--red)'); nx.disabled=false; return; }
      CSR.inflSubmitted=true; CSR.stage='intro-own'; CSR.p=0; renderSR(); pollOnce(); return;
    }
    if(st==='intro-own'){ CSR.stage='own'; CSR.p=0; renderSR(); return; }
    if(st==='own'){
      if(CSR.p<N-1){ CSR.p++; renderSR(); return; }
      CSR.busy=true; nx.disabled=true;
      const answers=CSR.ideas.map(n=>({node_id:n.id,own:CSR.own[n.id],explanation:CSR.expl[n.id].trim()}));
      const r=await api('/api/c/sr/ownership',{code:T.code,pid:me(),answers}); CSR.busy=false;
      if(!r.ok){ toast(r.data.error||'Could not save your answers. Please try again.','var(--red)'); nx.disabled=false; return; }
      CSR.stage='wait'; renderSR(); pollOnce();
    }
  };
}
// After the questions: the shared tree with everyone's dotted lines, and who has finished
function renderWait(){
  const fin=T.phase==='finished';
  $('c-sr').innerHTML=`<div class="c-sr-scroll"><div class="c-sr-card"><h2>${fin?'Everyone has finished. Thank you!':'Thank you! Your answers are saved.'}</h2>
    <p>${esc(THANKS)}</p>
    ${fin?'':'<p>Waiting for the rest of your team to finish their questions:</p>'}
    <ul class="c-done-list">${T.members.map(m=>`<li>${m.own_done?'✓':'•'} ${esc(pidLabel(m.pid))}${m.pid===me()?' (you)':''} <span class="c-tagline">${m.own_done?'finished':'answering…'}</span></li>`).join('')}</ul>
    <p class="c-sr-why">The dotted lines on the tree show which ideas influenced which, tagged with the PID of everyone who selected them.</p></div></div>`;
}
