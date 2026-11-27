// ============================================================
//  IdeaForest (variant 2) — Idea Tree only. Reuses shared.js; sign-in, saving and the end-of-task questions are added at the bottom.
//  Reuses shared.js; everything specific to this layout is overridden here.
// ============================================================
S.condition = "AI-Assisted Structured Ideation";


window.TREE_EMPTY_TEXT = 'Click “+ New Idea” to create your first idea. The idea tree will be populated as you work.';
window.TREE_HINT_TEXT = 'Click on a node to see the detail on the right panel (Current Idea panel). You can edit the idea yourself or using AI.\nWhen you are satisfied, you can finalize the idea. Click on + New Idea to create a different idea.';
window.SR_TREE_ONLY = true;
window.TREE_NO_SKELETON = true;   // no grey placeholder nodes in the idea tree
window.SHOW_IDEA_SUMMARY = true;   // creation nodes get a short summary of the idea beside them
document.body.classList.add('app5');   // self-reports show only the idea tree

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has two panels';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid instructions-grid-2">
    <div class="instructions-col"><div class="instr-text">The left panel where you can create ideas and see how they evolve</div><div class="instr-arrow instr-arrow-left">&#8592;</div></div>
    <div class="instructions-col"><div class="instr-text">The right panel that shows the selected idea and the design challenge</div><div class="instr-arrow instr-arrow-right">&#8594;</div></div>
  </div>`;


// ── No chat / ideas panels: neutralise the old chat plumbing ──
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

// ── New idea (large popup) ─────────────────────────────────
function openNewIdea(){ placeCreate('modal'); document.getElementById('newidea-modal').style.display='flex'; chooseCreate(null); }
function closeNewIdea(){ document.getElementById('newidea-modal').style.display='none'; }
window.startNewIdea = function(){ if(!S.nodes.length) return; offerFinalizeThen(openNewIdea); };
window.submitManualCreate = function(){
  const ta=document.getElementById('create-body'); const body=ta?ta.value.trim():'';
  if(!body){ toast('Please describe your idea.'); return; }
  addNode(mkNode({type:'creation',tag:'user-created',title:'',body}));
  closeNewIdea(); refreshUI();
};
window.confirmGenerateConfirm = async function(){
  const edited=document.getElementById('generate-prompt-text').value.trim();
  if(!edited){ setGeneratePromptError('Please enter a prompt.'); return; }
  const {system,hiddenSuffix}=_pendingGenerate||{};
  const custom=edited!==((_pendingGenerate||{}).editable||'');
  const btn=document.getElementById('btn-generate-confirm');
  setGeneratePromptError('');
  btn.disabled=true; btn.textContent='Checking prompt…';
  try{
    const {system:vSys,user:vUser}=PROMPTS.validateIdeaPrompt(S.challenge,edited);
    const verdict=(await callClaude([{role:'user',content:vUser}],vSys)).trim();
    if(!/^VALID/i.test(verdict)){
      const reason=verdict.replace(/^INVALID:?\s*/i,'').trim();
      setGeneratePromptError(reason?`Please enter a valid prompt: ${reason}`:'Please enter a valid prompt for this design challenge.');
      btn.disabled=false; btn.textContent=GENERATE_LABEL; return;
    }
    btn.textContent='Generating…';
    const text=await callClaude([{role:'user',content:edited+hiddenSuffix}],system);
    const json=parseAIJSON(text);
    const gen=mkNode({type:'creation',tag:'ai-generated',body:await enforceWords(json.body,edited),userPrompt:edited});
    if(custom) gen.extras.push({type:'custom_prompt',ts:Date.now()});
    addNode(gen);
    _pendingGenerate=null; closeNewIdea(); refreshUI();
  }catch(e){ setGeneratePromptError('Could not generate an idea: '+e.message); }
  finally{ btn.disabled=false; btn.textContent=GENERATE_LABEL; }
};

// ── Clicking a node selects it; the action buttons are always visible at the top right of the tree panel ──
window.WORKING_BADGE = true; window.TREE_STACK = true;   // trees stack top-to-bottom and scroll   // "Working on this idea" bubble above the selected node
window.onTreeNodeClick = function(nodeId){ selectIdea(nodeId); refocusTree(); };
function renderActions(){
  const box=document.getElementById('a5-actions'); if(!box) return;
  const node=curNode();
  if(!node||!S.nodes.length){ box.style.display='none'; return; }
  box.innerHTML='';
  const mk=(label,cls,fn)=>{ const b=document.createElement('button'); b.className='btn a5-tb-btn '+cls; b.textContent=label; b.onclick=fn; box.appendChild(b); };
  mk('Edit the idea yourself','btn-edit-self',()=>openNodeModal('edit-self'));
  mk('Edit the idea using AI','btn-edit-ai',()=>openNodeModal('edit-ai'));
  // mk('Ask AI to clarify the idea','btn-outline',openAsk);   // hidden for now; may come back later
  mk(node.isFinalized?'Unfinalize the idea':'Finalize the idea',node.isFinalized?'btn-outline':'btn-finalize',()=>finalizeCurrentIdea(node));
  mk('Discard the current idea','btn-discard',()=>discardNode(node.id));
  box.style.display='flex';
  const st=document.getElementById('a5-start'); if(st&&st.style.display!=='none') box.style.display='none';
  fitToolbar();
}
// Every button label stays on one line: the font scales down only as far as needed to fit the row.
function fitToolbar(){
  const box=document.getElementById('a5-actions'); if(!box||box.style.display==='none') return;
  const bs=[...box.querySelectorAll('.a5-tb-btn')]; let fs=15;
  bs.forEach(b=>{ b.style.fontSize=fs+'px'; });
  while(fs>7 && box.scrollWidth>box.clientWidth+1){ fs-=0.5; bs.forEach(b=>{ b.style.fontSize=fs+'px'; }); }
}
window.addEventListener('resize',fitToolbar);

// ── Edit popups (default prompt / manual text box) ──────────
function openNodeModal(mode){
  const node=curNode(); if(!node) return;
  const body=document.getElementById('node-modal-body'); body.innerHTML='';
  const comp=buildChatComposer(mode,node); body.appendChild(comp);
  comp.querySelector('.chat-composer-row .btn-outline').onclick=closeNodeModal;
  document.getElementById('node-modal').style.display='flex';
  fitPromptLabels(); const ta=document.getElementById('chat-composer-text'); if(ta) ta.focus();
}
function closeNodeModal(){ document.getElementById('node-modal').style.display='none'; }
['submitSelfEdit','submitAIEdit'].forEach(name=>{
  const orig=window[name];
  window[name]=function(){
    orig();
    const err=document.getElementById('chat-composer-error');
    if(!err||err.style.display!=='block'){ closeNodeModal(); if(name==='submitAIEdit') toast('Editing with AI…'); }
  };
});

// ── Ask AI: chat box with the earlier conversation (clarifications only, no edits) ──
function openAsk(){
  const node=curNode(); if(!node) return;
  renderAsk();
  const inp=document.getElementById('ask-input'); inp.value=node.extras.some(x=>x.userPrompt)?'':'Explain the idea'; if(inp.value) markDefault(inp);
  document.getElementById('ask-modal').style.display='flex'; inp.focus();
}
function closeAsk(){ document.getElementById('ask-modal').style.display='none'; }
function renderAsk(){
  const node=curNode(); const m=document.getElementById('ask-msgs'); m.innerHTML='';
  buildChatInto(m,node.id); m.scrollTop=m.scrollHeight;
}
async function sendAsk(){
  const parent=curNode(); const inp=document.getElementById('ask-input'); const msg=inp.value.trim();
  if(!parent||!msg) return;
  const btn=document.getElementById('ask-send'); btn.disabled=true; inp.disabled=true; inp.value='';
  const m=document.getElementById('ask-msgs'); m.appendChild(makeMsgBubble('user',msg,parent.id));
  if(classifyMsg(msg)==='modification'||isNewIdeaRequest(msg)){
    m.appendChild(makeMsgBubble('assistant','I can only answer questions about the idea here. To change the idea, please close this chat and use the “Edit the idea using AI” button (or “Edit the idea yourself”).',parent.id));
    m.scrollTop=m.scrollHeight; btn.disabled=false; inp.disabled=false; inp.focus(); return;
  }
  const wait=makeMsgBubble('system-note','Loading AI response…'); m.appendChild(wait); m.scrollTop=m.scrollHeight;
  try{
    const history=buildAPIHistory(parent.id);
    const aiText=await callClaude([...history,{role:'user',content:msg}],PROMPTS.clarificationChat(parent.body,S.challenge));
    parent.extras.push({type:'clarification',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
    summarizeQuestion(parent,parent.extras[parent.extras.length-1]); queueSync();
    renderAsk();
  }catch(e){ wait.textContent='Error: '+e.message; }
  finally{ btn.disabled=false; inp.disabled=false; inp.focus(); }
}
document.addEventListener('keydown',e=>{
  if(e.target&&e.target.id==='ask-input'&&e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendAsk(); }
});

// ── Current idea (right side): updates whenever an idea is created, edited or selected ──
const _refreshUIBase=window.refreshUI;
let _lastCentered=null;
window.refreshUI=function(){
  _refreshUIBase(); renderCurrentIdea();
  if(S.nodes.length){ hideStart(); } else showStart();
  renderActions();
  const nb=document.getElementById('a5-newbtn'); if(nb) nb.style.display=S.nodes.length?'':'none';
  // a created / clicked node goes to the middle of the tree panel
};
function centerOnNode(id){
  const area=document.getElementById('tree-area'), p=_pan.pos&&_pan.pos[id]; if(!area||!p) return;
  _pan.x=area.clientWidth/2-p.x*_pan.k;
  _pan.y=area.clientHeight/2-12-p.y*_pan.k;   // 12px = canvas top offset
  applyPan();
}
// ── Start screen: the create-idea interface lives in the tree panel until the first idea exists ──
let _createBox=null;
function placeCreate(where){
  if(!_createBox) _createBox=document.querySelector('#newidea-modal .generate-inline');
  const host=where==='start'?document.getElementById('a5-start'):document.querySelector('#newidea-modal .modal-body');
  if(host&&_createBox.parentNode!==host) host.appendChild(_createBox);
}
function showStart(){
  const st=document.getElementById('a5-start'); if(!st) return;
  const hdr=st.parentNode.querySelector('.panel-header'); st.style.top=(hdr?hdr.offsetHeight:56)+'px';
  placeCreate('start'); st.style.display='flex';
  if(!st.dataset.init){ st.dataset.init='1'; chooseCreate(null); }
}
function hideStart(){
  const st=document.getElementById('a5-start'); if(!st||st.style.display==='none') return;
  st.style.display='none'; st.dataset.init=''; placeCreate('modal');
}
function renderCurrentIdea(){
  const box=document.getElementById('a5-current'); if(!box) return;
  const n=curNode();
  if(!n){ box.innerHTML='<p class="a5-empty">No idea selected yet. Create a new idea, or click a node in the idea tree.</p>'; return; }
  box.innerHTML=`<div class="a5-cur-tag">${esc(nodeTagLabel(n))}${n.isFinalized?' · Finalized':''}</div><div class="a5-cur-body">${esc(n.body)}</div>`;
}



// ============================================================
//  Variant 2 additions: participants (anonymous, identified only by a PID the server assigns), saving, end-of-task questions
// ============================================================

// ── Instructions: "at least one idea" ──
// (the instruction texts in app.html were updated; this keeps the in-app summary consistent)

// ── Saving: participants (anonymous, identified only by a PID the server assigns) save through this tab's session token (see session.js) ──
let _expiredShown=false;
function nodeToRow(n){
  return {
    node_id:n.id, group_id:n.groupId, parent_id:n.parentId||null,
    type:n.type, tag:n.tag, title:n.title||'', body:n.body||'',
    is_finalized:!!n.isFinalized, user_prompt:n.userPrompt||'', ai_response:n.aiResponse||'',
    extras:n.extras||[], meta:n.meta||{}, created_at_ms:n.ts,
  };
}
function sessionExpired(){
  if(_expiredShown) return; _expiredShown=true;
  toast('Your session has expired. Reloading the page…','var(--amber)');
  setTimeout(()=>{ location.href='/'; },3500);
}
async function _doSync(keepalive){
  if(!S.participantId) return true;   // set once the saved work has loaded
  const changed=S.nodes.map(nodeToRow).filter(r=>_synced[r.node_id]!==JSON.stringify(r));
  if(!changed.length) return true;
  try{
    const res=await fetch('/api/save-nodes',{
      method:'POST', headers:{'Content-Type':'application/json'}, keepalive:!!keepalive,
      body:JSON.stringify({nodes:changed}),
    });
    if(res.status===401){ sessionExpired(); return false; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    changed.forEach(r=>{ _synced[r.node_id]=JSON.stringify(r); });
    return true;
  }catch(e){ console.error('Save failed:',e); return false; }
}
function syncNow(keepalive){
  clearTimeout(_syncTimer);
  _syncChain=_syncChain.then(()=>_doSync(keepalive),()=>_doSync(keepalive));
  return _syncChain;
}
function flushSave(){ if(S.participantId) syncNow(true); }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSave(); });
window.addEventListener('pagehide',flushSave);

// ── Loading saved work, so a participant can pick up where they left off ──
function rowToNode(r){
  return {
    id:r.node_id, parentId:r.parent_id||null, groupId:r.group_id, type:r.type, tag:r.tag,
    title:r.title||'', body:r.body||'', userPrompt:r.user_prompt||'', aiResponse:r.ai_response||'',
    extras:Array.isArray(r.extras)?r.extras:[], isFinalized:!!r.is_finalized,
    ts:r.created_at?new Date(r.created_at).getTime():Date.now(), meta:r.meta||{},
    updatedAtMs:r.updated_at?new Date(r.updated_at).getTime():0,
  };
}
function showLoadError(message){
  const el=document.getElementById('page-loading'); if(!el) return;
  el.innerHTML='<div class="loading-error"><p>'+esc(message)+'</p><button class="btn btn-primary" onclick="initApp()">Try again</button></div>';
}
async function initApp(){
  if(!igSession.has()){ location.href='/'; return; }   // a tab without a participant goes through the consent page first
  const loading=document.getElementById('page-loading');
  if(loading) loading.innerHTML='<span class="spinner" aria-hidden="true"></span><span>Loading your ideas…</span>';
  let me;
  try{
    const meRes=await fetch('/api/me');
    if(meRes.status===401){ location.href='/'; return; }
    if(!meRes.ok) throw new Error('HTTP '+meRes.status);
    me=await meRes.json();
    if(!me.consented){ location.href='/consent'; return; }
    const res=await fetch('/api/load-nodes');
    if(res.status===401){ location.href='/'; return; }
    if(res.status===403){ location.href='/consent'; return; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const {nodes}=await res.json();
    S.nodes=nodes.map(rowToNode);
    S.nodes.forEach(n=>{ _synced[n.id]=JSON.stringify(nodeToRow(n)); }); // already saved
    try{ const fa=await fetch('/api/final-answers'); if(fa.ok){ const j=await fa.json(); (j.answers||[]).forEach(a=>{ FQ.answers[a.node_id]={ai_use:a.ai_use||'',explored:a.explored||'',refined:a.refined||''}; }); const rf=j.reflections||{}; FQ.refl={learned:rf.learned||'',partner:rf.partner||''}; } }catch(e){}
    S.participantId='session';   // saving switches on only now, so nothing can overwrite saved work before it has loaded
  }catch(e){
    console.error('Could not load saved work:',e);
    showLoadError('We could not load your saved ideas. Please check your connection and try again.');
    return; // never start with an empty workspace when saved work may exist
  }
  document.getElementById('page-loading').style.display='none';
  document.getElementById('page-ideation').style.display='flex';
  startApp(S.nodes.length>0);
}
// Does not reset S.nodes (unlike startIdeation), so saved ideas survive
function startApp(hasSaved){
  S.challenge=FIXED_CHALLENGE;
  initChallengeBanner();
  initTreePanOn('tree-area','tree-canvas');
  showChatInitial(); updateFinalizedCounter(); refreshUI();
  if(hasSaved){
    const latest=S.nodes.slice().sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||(b.ts-a.ts))[0];
    if(latest) selectIdea(latest.id);
  } else { _instrAfterDetails=true; openDetailsModal(); }
}
document.addEventListener('DOMContentLoaded',initApp);

// ── "Done with Task": no influence step, self-reports or reflections any more ──
// Instead: three questions per finalized idea, all on one scrollable page,
// with the idea tree on the left half and the questions on the right half.
const FQ={answers:{},ideas:[],i:0,busy:false,refl:{learned:'',partner:''}};
const FQ_QS=[
  {k:'ai_use',  text:'Did you use AI to ideate? Why/why not?'},
  {k:'explored',text:'Did you explore multiple ideas? Why/why not?'},
  {k:'refined', text:'Did you refine your idea? Why/why not?'},
];
// After the per-idea questions: a "think and discuss" screen, then two reflection questions, then a copy-to-Canvas screen
const FQ_THINK='Think about: \u201cWhat did you learn from ideating with AI?\u201d Once you are done thinking, wait for the person next to you to complete the task. Discuss with them to understand what they learned from ideating with AI. Press next once you are done discussing.';
const FQ_REFL=[
  {k:'learned',text:'What did you learn from ideating with AI?'},
  {k:'partner',text:'What did the person next to you learn from ideating with AI?'},
];
window.handleDone=function(){
  offerFinalizeThen(()=>{
    if(!finalizedCount()){ toast('Please finalize at least one idea before you finish.','var(--amber)'); return; }
    document.getElementById('done-count').textContent=finalizedCount();
    document.getElementById('done-popup').style.display='flex';
  });
};
window.confirmDone=function(){ closeDonePopup(); openFinalQuestions(); };

function openFinalQuestions(){
  const ideas=S.nodes.filter(n=>n.isFinalized);
  if(!ideas.length) return;
  SR={hist:[],ideas,QS:[],round:1,phase:'fq',p:0,steps:ideas.map((n,i)=>({t:'fq',i})),a1:{},a2:{},busy:false,infl:{}};
  ideas.forEach(n=>{ SR.infl[n.id]={}; FQ.answers[n.id]=FQ.answers[n.id]||{ai_use:'',explored:'',refined:''}; });
  FQ.ideas=ideas; FQ.i=0;
  document.getElementById('sr-sub-tabs').style.display='none';
  document.getElementById('sr-left').style.display='flex';
  document.getElementById('self-report-modal').style.display='flex';
  fqRender();
}
function fqCapture(){
  const node=FQ.ideas[FQ.i]; if(!node) return;
  FQ_QS.forEach(q=>{ const t=document.getElementById('fq-'+q.k); if(t) FQ.answers[node.id][q.k]=t.value; });
}
function fqComplete(node){ const a=FQ.answers[node.id]; return FQ_QS.every(q=>(a[q.k]||'').trim()); }
function fqRender(){
  const node=FQ.ideas[FQ.i], n=FQ.ideas.length, last=FQ.i===n-1, a=FQ.answers[node.id];
  SR.p=FQ.i;
  document.getElementById('sr-idea-tabs').innerHTML=FQ.ideas.map((x,i)=>`<div class="sr-idea-tab${i===FQ.i?' sr-idea-active':' sr-tab-off'}" style="cursor:default">Idea ${i+1}</div>`).join('');
  const body=FQ_QS.map((q,x)=>`<div class="sr-q-block"><p class="sr-q-label">${x+1}. ${esc(q.text)}</p>`
    +`<textarea class="field-textarea fq-text" id="fq-${q.k}" rows="5" placeholder="Type your answer here…" oninput="fqChanged()">${esc(a[q.k]||'')}</textarea></div>`).join('');
  document.querySelector('.sr-right').innerHTML=
    `<div class="sr-right-header"><div class="sr-step-indicator">Idea ${FQ.i+1} of ${n}</div></div>`
    +`<div class="sr-page" style="display:flex"><p class="fq-lead">Please answer these questions about the idea shown on the left.</p>${body}`
    +`<p class="field-error" id="fq-error" style="display:none"></p>`
    +`<div class="sr-foot">${FQ.i>0?'<button class="btn btn-outline" onclick="fqBack()">← Back</button>':'<button class="btn btn-outline" onclick="closeFinalQuestions()">← Back to my ideas</button>'}`
    +`<button class="btn btn-primary" id="fq-go" onclick="fqNext()">${last?'Submit':'Next →'}</button></div></div>`;
  document.querySelector('.sr-right .sr-page').scrollTop=0;
  srShowLeft(node,null,null);
}
function fqChanged(){ const e=document.getElementById('fq-error'); if(e) e.style.display='none'; }
function fqAnswerRows(){ return FQ.ideas.map(n=>({node_id:n.id,...FQ.answers[n.id]})); }
async function fqSave(finish){
  const res=await fetch('/api/final-answers',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({answers:fqAnswerRows(),reflections:FQ.refl,finish:!!finish})});
  if(res.status===401){ sessionExpired(); throw new Error('session'); }
  if(!res.ok) throw new Error('HTTP '+res.status);
}
async function fqBack(){
  if(FQ.busy) return; fqCapture(); FQ.i--; fqRender();
  fqSave(false).catch(()=>{});
}
async function fqNext(){
  if(FQ.busy) return;
  fqCapture();
  const node=FQ.ideas[FQ.i], last=FQ.i===FQ.ideas.length-1;
  if(!fqComplete(node)){
    const e=document.getElementById('fq-error'); e.textContent='Please answer all three questions before continuing.'; e.style.display='block';
    FQ_QS.some(q=>{ const t=document.getElementById('fq-'+q.k); if(!t.value.trim()){ t.focus(); return true; } });
    return;
  }
  if(!last){ FQ.i++; fqRender(); fqSave(false).catch(()=>{}); return; }
  const btn=document.getElementById('fq-go'); FQ.busy=true; btn.disabled=true; btn.textContent='Saving…';
  try{ await syncNow(); await fqSave(false); fqThink(); }
  catch(e){ const er=document.getElementById('fq-error'); er.textContent='We could not save your answers. Please check your connection and press Submit again.'; er.style.display='block'; btn.disabled=false; btn.textContent='Submit'; }
  finally{ FQ.busy=false; }
}
// Screen 1 after the questions: think, then discuss with the person next to you (idea tree stays on the left)
function fqThink(){
  document.querySelector('.sr-right').innerHTML=
    `<div class="sr-intro"><div class="sr-intro-card"><h2 class="sr-intro-title" style="font-size:1.9rem;line-height:1.5">${esc(FQ_THINK)}</h2>`
    +`<div class="sr-foot"><button class="btn btn-outline" onclick="fqBackToIdeas()">← Back</button>`
    +`<button class="btn btn-primary" onclick="fqReflect()">Next →</button></div></div></div>`;
}
function fqBackToIdeas(){ FQ.i=FQ.ideas.length-1; fqRender(); }
// Screen 2: the two reflection questions
function fqReflCapture(){ FQ_REFL.forEach(q=>{ const t=document.getElementById('fr-'+q.k); if(t) FQ.refl[q.k]=t.value; }); }
function fqReflect(){
  document.querySelector('.sr-right').innerHTML=
    `<div class="sr-right-header"><div class="sr-step-indicator">Final questions</div></div>`
    +`<div class="sr-page" style="display:flex">`
    +FQ_REFL.map((q,x)=>`<div class="sr-q-block"><p class="sr-q-label">${x+1}. ${esc(q.text)}</p>`
      +`<textarea class="field-textarea fq-text" id="fr-${q.k}" rows="6" placeholder="Type your answer here…" oninput="fqChanged()">${esc(FQ.refl[q.k]||'')}</textarea></div>`).join('')
    +`<p class="field-error" id="fq-error" style="display:none"></p>`
    +`<div class="sr-foot"><button class="btn btn-outline" onclick="fqReflCapture();fqThink()">← Back</button>`
    +`<button class="btn btn-primary" id="fr-go" onclick="fqSubmitRefl()">Submit</button></div></div>`;
}
async function fqSubmitRefl(){
  if(FQ.busy) return;
  fqReflCapture();
  if(!FQ_REFL.every(q=>(FQ.refl[q.k]||'').trim())){
    const e=document.getElementById('fq-error'); e.textContent='Please answer both questions before submitting.'; e.style.display='block';
    FQ_REFL.some(q=>{ const t=document.getElementById('fr-'+q.k); if(!t.value.trim()){ t.focus(); return true; } }); return;
  }
  const btn=document.getElementById('fr-go'); FQ.busy=true; btn.disabled=true; btn.textContent='Saving…';
  try{ await syncNow(); await fqSave(true); fqFinal(); }
  catch(e){ const er=document.getElementById('fq-error'); er.textContent='We could not save your answers. Please check your connection and press Submit again.'; er.style.display='block'; btn.disabled=false; btn.textContent='Submit'; }
  finally{ FQ.busy=false; }
}
// Screen 3: their two answers + the instruction to copy them into Canvas
function fqFinal(){
  document.querySelector('.sr-right').innerHTML=
    `<div class="sr-intro"><div class="sr-intro-card"><h2 class="sr-intro-title" style="font-size:1.9rem;line-height:1.5">Please copy and paste your two answers into Canvas to receive your participation points.</h2>`
    +FQ_REFL.map((q,x)=>`<div class="sr-q-block"><p class="sr-q-label">${x+1}. ${esc(q.text)}</p><div class="fq-answer">${esc(FQ.refl[q.k]||'')}</div></div>`).join('')
    +`<div class="sr-foot"><button class="btn btn-outline" onclick="fqReflect()">← Edit my answers</button></div></div></div>`;
}
function closeFinalQuestions(){ fqCapture(); fqSave(false).catch(()=>{}); closeSelfReport(); }
