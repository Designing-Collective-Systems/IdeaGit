// ============================================================
//  IdeaForest — Condition 5: Idea Tree only (no chat / ideas panels)
//  Reuses shared.js; everything specific to this layout is overridden here.
// ============================================================
S.condition = "AI-Assisted Structured Ideation";
S.studyCondition = "IdeaForest_TreeOnly"; // value stored in the database's study_condition column

window.TREE_EMPTY_TEXT = 'Click “+ New Idea” to create your first idea. The idea tree will be populated as you work.';
window.TREE_HINT_TEXT = 'Click on any node to work on it';
window.SR_TREE_ONLY = true;
window.SHOW_IDEA_SUMMARY = true;   // creation nodes get a short summary of the idea beside them
document.body.classList.add('app5');   // self-reports show only the idea tree

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has one panel';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid" style="grid-template-columns:1fr">
    <div class="instructions-col"><div class="instr-text">The idea tree where you create ideas and see how they evolve. Click on any node to work on it.</div><div class="instr-arrow">&#8595;</div></div>
  </div>`;

document.addEventListener('DOMContentLoaded', initLanding);
function onStudyBegin(){ startIdeation(); _detailsAfterSummary=true; openInstructions(); }

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
window.startNewIdea = function(){ if(!S.nodes.length) return; closePop(); offerFinalizeThen(openNewIdea); };
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
    const json=JSON.parse(text.replace(/```json|```/g,'').trim());
    addNode(mkNode({type:'creation',tag:'ai-generated',body:await enforceWords(json.body,edited),userPrompt:edited}));
    _pendingGenerate=null; closeNewIdea(); refreshUI();
  }catch(e){ setGeneratePromptError('Could not generate an idea: '+e.message); }
  finally{ btn.disabled=false; btn.textContent=GENERATE_LABEL; }
};

// ── Node popup: click a node → five buttons beside it ───────
function closePop(){ const p=document.getElementById('node-pop'); if(p) p.style.display='none'; }
window.onTreeNodeClick = function(nodeId){
  selectIdea(nodeId);
  const el=document.querySelector(`.tree-node[data-node-id="${nodeId}"]`); if(!el) return;
  const node=S.nodes.find(n=>n.id===nodeId);
  const pop=document.getElementById('node-pop');
  pop.innerHTML='';
  const col=()=>{ const c=document.createElement('div'); c.className='node-pop-col'; pop.appendChild(c); return c; };
  const c1=col(), c2=col();
  const mk=(c,label,cls,fn)=>{ const b=document.createElement('button'); b.className='btn btn-sm node-pop-btn '+cls; b.textContent=label;
    b.onclick=()=>{ closePop(); fn(); }; c.appendChild(b); };
  mk(c1,'Edit the idea yourself','btn-outline',()=>openNodeModal('edit-self'));
  mk(c1,'Edit the idea using AI','btn-outline',()=>openNodeModal('edit-ai'));
  mk(c1,'Ask AI to clarify the idea','btn-outline',openAsk);
  mk(c2,node.isFinalized?'Unfinalize the idea':'Finalize the idea',node.isFinalized?'btn-outline':'btn-green',finalizeCurrentIdea);
  mk(c2,'Discard the current idea','btn-red',()=>discardNode(node.id));
  pop.style.display='flex';
  // place beside the node (and its notes); fall back to the left side if there is no room
  const r=el.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight;
  let x=r.right+(190+14)*_pan.k; if(x+pw>innerWidth-8) x=r.left-pw-10;
  x=Math.max(8,Math.min(x,innerWidth-pw-8));
  const y=Math.max(8,Math.min(r.top,innerHeight-ph-8));
  pop.style.left=x+'px'; pop.style.top=y+'px';
};
document.addEventListener('mousedown',e=>{
  const p=document.getElementById('node-pop');
  if(p&&p.style.display!=='none'&&!e.target.closest('#node-pop')&&!e.target.closest('.tree-node')) closePop();
});

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
  const inp=document.getElementById('ask-input'); inp.value=node.extras.some(x=>x.userPrompt)?'':'Explain the idea';
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
  const nb=document.getElementById('a5-newbtn'); if(nb) nb.style.display=S.nodes.length?'':'none';
  // a created / clicked node goes to the middle of the tree panel
  if(S.currentNodeId&&S.currentNodeId!==_lastCentered){ _lastCentered=S.currentNodeId; centerOnNode(S.currentNodeId); }
  if(!S.currentNodeId) _lastCentered=null;
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
