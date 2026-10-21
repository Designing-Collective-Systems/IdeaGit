window.EXPORT_MODE='trees';
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

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has two panels';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid" style="grid-template-columns:2fr 1fr">
    <div class="instructions-col"><div class="instr-text">The left panel where you can create and see how your ideas evolve</div><div class="instr-arrow instr-arrow-left">&#8592;</div></div>
    <div class="instructions-col"><div class="instr-text">The right panel where you can see the current/selected idea and a summary of the design challenge</div><div class="instr-arrow instr-arrow-right">&#8594;</div></div>
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
    addNode(mkNode({type:'creation',tag:'ai-generated',body:await enforceWords(json.body,edited),userPrompt:edited}));
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
  mk('Edit the idea yourself','btn-outline',()=>openNodeModal('edit-self'));
  mk('Edit the idea using AI','btn-outline',()=>openNodeModal('edit-ai'));
  mk('Ask AI to clarify the idea','btn-outline',openAsk);
  mk(node.isFinalized?'Unfinalize the idea':'Finalize the idea',node.isFinalized?'btn-outline':'btn-green',finalizeCurrentIdea);
  mk('Discard the current idea','btn-red',()=>discardNode(node.id));
  box.style.display='flex';
  const st=document.getElementById('a5-start'); if(st&&st.style.display!=='none') box.style.display='none';
}

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
  _refreshUIBase(); renderCurrentIdea(); renderActions();
  if(S.nodes.length){ hideStart(); } else showStart();
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

// The two columns are 2:1, like the real panels. The right text (the longer one) wraps onto two lines and sets the width.
window.fitInstructionText=function(){
  const grid=document.querySelector('#instructions-content .instructions-grid'); if(!grid) return;
  const ts=[...grid.querySelectorAll('.instr-text')]; if(ts.length<2) return;
  const PADX=24;
  ts.forEach(t=>{ t.style.width=''; t.style.whiteSpace='nowrap'; t.style.display='inline-block'; t.style.textAlign='center'; t.dataset.full=t.scrollWidth; });
  ts.forEach(t=>{ t.style.whiteSpace=''; t.style.display='block'; });
  const [L,R]=ts;
  const maxTotal=Math.floor(innerWidth*0.9);
  let colR=Math.ceil(R.dataset.full/2)+PADX+8;                 // two lines for the right text
  const lh=parseFloat(getComputedStyle(R).lineHeight)||24;
  R.style.width=(colR-PADX)+'px';
  while(R.offsetHeight>lh*2+2 && colR*3<maxTotal){ colR+=4; R.style.width=(colR-PADX)+'px'; }
  colR=Math.min(colR,Math.floor(maxTotal/3));
  R.style.width=(colR-PADX)+'px';
  const colL=colR*2;
  grid.style.gridTemplateColumns=colL+'px '+colR+'px'; grid.style.width=(colL+colR)+'px';
  // left text: one line if it fits in its (wider) column, otherwise two balanced lines
  L.style.width=Math.min(L.dataset.full,colL-PADX)+'px';
};
