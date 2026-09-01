// ============================================================
//  IdeaGit — Condition 3: AI-Assisted Ideation
// ============================================================
S.condition = "AI-Assisted Ideation";

window.CONDITION_INSTRUCTIONS = `
  <ol style="padding-left:20px;line-height:2">
    <li><strong>In the chat panel (right):</strong></li>
    <ul style="padding-left:20px;line-height:2">
    <li>Click "Create Idea Manually" or "Generate Idea with AI" to generate a new idea.</li>
    <li>Chat with the AI to further modify the idea, get feedback, or ask questions.</li>
    <li>Click "Finalize" when satisfied with an idea.</li>
    <li>Reply to any chat bubble (&#x21A9;) to branch from that specific version.</li>
    <li>Click "+ New Idea" to start a fresh idea.</li>
    </ul>    
    <li><strong>In the current ideas panel (left):</strong></li>
    <ul style="padding-left:20px;line-height:2">
    <li>You can find ideas that are finalized or in-progress.</li>
    <li>Click any idea to switch to it.</li>
    </ul>     
    <li><strong>In the navigation panel (top):</strong></li>
    <ul style="padding-left:20px;line-height:2">
    <li>Click on the "Done with Task" button when you are done brainstorming at least three ideas.</li>
    <li>Click on the "Export CSV" button to export your ideas. Please press this button at the end of the task (after clicking "Done with Task").</li>
    </ul> 
  </ol>`;

document.addEventListener('DOMContentLoaded', ()=>{ startIdeation(); openInstructions(); });

function startIdeation(){
  S.challenge = FIXED_CHALLENGE;
  S.nodes = []; S.currentNodeId = null; S.currentGroupId = null;
  initChallengeBanner();
  showChatInitial();
  updateFinalizedCounter(); renderIdeasPanel();
}

// ── Chat state ────────────────────────────────────────────────
let _replyToNodeId = null;

function renderIdeasPanel(){
  renderIdeasList('ideas-list','ideas-empty', selectIdea);
}

function selectIdea(nodeId){
  const node = S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId = nodeId; S.currentGroupId = node.groupId;
  showChatActive(); updateChatHeader(); rebuildChat(nodeId);
  renderIdeasPanel();
}

// ── Chat display ──────────────────────────────────────────────
function showChatInitial(){
  document.getElementById('chat-initial').style.display = 'flex';
  document.getElementById('chat-active').style.display  = 'none';
}
function showChatActive(){
  document.getElementById('chat-initial').style.display = 'none';
  document.getElementById('chat-active').style.display  = 'flex';
}
function setChatThinking(on){
  document.getElementById('chat-thinking').style.display = on?'flex':'none';
  const inp = document.getElementById('chat-input'); if(inp) inp.disabled = on;
}
function updateChatHeader(){
  const node = S.nodes.find(n=>n.id===S.currentNodeId);
  document.getElementById('current-idea-title').textContent = node?node.title:'—';
  const btn = document.getElementById('btn-finalize');
  if(btn){ btn.textContent=node&&node.isFinalized?'Unfinalize':'Finalize'; btn.disabled=false; btn.className=node&&node.isFinalized?'btn btn-outline btn-sm':'btn btn-green btn-sm'; }
}
function rebuildChat(nodeId){
  const wrap = document.getElementById('chat-messages'); if(!wrap) return;
  wrap.innerHTML = '';
  getPath(nodeId).forEach(node=>{
    if(node.type==='creation') wrap.appendChild(makeIdeaBubble(node,node.tag==='ai-generated'?'AI-Generated Idea':'Your Idea',''));
    else if(node.type==='modification'){
      if(node.userPrompt) wrap.appendChild(makeMsgBubble('user',node.userPrompt,node.id));
      wrap.appendChild(makeIdeaBubble(node,node.tag==='manual-modification'?'Manually Modified':'AI-Modified',node.tag==='manual-modification'?'manual':'modified'));
    }
    node.extras.forEach((ex,idx)=>{
      if(ex.userPrompt) wrap.appendChild(makeMsgBubble('user',ex.userPrompt,node.id,idx));
      if(ex.type==='feedback') wrap.appendChild(makeFeedbackBubble(ex.aiResponse,node.id,idx));
      else if(ex.aiResponse)  wrap.appendChild(makeMsgBubble('assistant',ex.aiResponse,node.id,idx));
    });
  });
  wrap.scrollTop = wrap.scrollHeight;
}

function makeIdeaBubble(node,label,cls){
  const el=document.createElement('div'); el.className='idea-bubble'+(cls?' '+cls:''); el.dataset.nodeId=node.id;
  el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${node.id}',null,'${esc(node.title)}')">↩</div>
    <div class="idea-bubble-label">${esc(label)}</div><div class="idea-bubble-title">${esc(node.title)}</div>
    <div class="idea-bubble-body">${esc(node.body)}</div>`;
  return el;
}
function makeMsgBubble(role,content,nodeId,extraIdx=null){
  const el=document.createElement('div'); el.className='chat-msg '+role; el.dataset.nodeId=nodeId||'';
  const preview=esc(content.slice(0,40)+(content.length>40?'…':''));
  const eidx=extraIdx!==null?`,'${extraIdx}'`:'null';
  if(role==='user'||role==='assistant'){
    el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${nodeId}',${eidx},'${preview}')">↩</div><span class="bubble-content">${esc(content)}</span>`;
  } else { el.textContent=content; }
  return el;
}
function makeFeedbackBubble(content,nodeId,extraIdx){
  const el=document.createElement('div'); el.className='feedback-bubble'; el.dataset.nodeId=nodeId||'';
  const preview=esc(content.slice(0,40)+(content.length>40?'…':''));
  el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${nodeId}','${extraIdx}','${preview}')">↩</div>
    <div class="feedback-bubble-label">AI Feedback</div>${esc(content)}`;
  return el;
}
function appendToChat(el){ const w=document.getElementById('chat-messages'); if(w){ w.appendChild(el); w.scrollTop=w.scrollHeight; } }

function setReplyTo(nodeId,extraIdx,preview){
  _replyToNodeId=nodeId;
  const ind=document.getElementById('reply-indicator');
  const txt=document.getElementById('reply-text');
  if(ind&&txt){ ind.style.display='flex'; txt.textContent=preview||'message'; }
  document.getElementById('chat-input')?.focus();
}
function clearReply(){ _replyToNodeId=null; const ind=document.getElementById('reply-indicator'); if(ind) ind.style.display='none'; }

// ── Create idea ───────────────────────────────────────────────
function startManualCreate(){
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
  if(!body) { toast('Please describe your idea.'); return; }
  closeCreateModal();
  const node=mkNode({type:'creation',tag:'user-created',title,body}); addNode(node);
  showChatActive(); updateChatHeader(); rebuildChat(node.id); renderIdeasPanel();
}

async function startAICreate(){
  showChatActive();
  const wrap=document.getElementById('chat-messages'); wrap.innerHTML='';
  appendToChat(makeMsgBubble('system-note','Generating idea…'));
  setChatThinking(true);
  try{
    const {system,user}=PROMPTS.generateIdea(S.challenge,existingSummary());
    const text=await callClaude([{role:'user',content:user}],system);
    const json=JSON.parse(text.replace(/```json|```/g,'').trim());
    wrap.innerHTML='';
    const node=mkNode({type:'creation',tag:'ai-generated',title:json.title,body:json.body}); addNode(node);
    updateChatHeader(); rebuildChat(node.id); renderIdeasPanel();
  }catch(e){ wrap.innerHTML=''; appendToChat(makeMsgBubble('assistant','Error: '+e.message)); showChatInitial(); }
  finally{ setChatThinking(false); }
}

// ── Modify manually ───────────────────────────────────────────
function openManualModify(){
  const node=S.nodes.find(n=>n.id===S.currentNodeId); if(!node) return;
  document.getElementById('modify-title').value=node.title;
  document.getElementById('modify-body').value=node.body;
  document.getElementById('modal-modify').style.display='flex';
  setTimeout(()=>document.getElementById('modify-title').focus(),60);
}
function closeModifyModal(){ document.getElementById('modal-modify').style.display='none'; }
function submitManualModify(){
  const title=document.getElementById('modify-title').value.trim();
  const body =document.getElementById('modify-body').value.trim();
  if(!title||!body){ toast('Please fill in both fields.'); return; }
  const parent=S.nodes.find(n=>n.id===S.currentNodeId); if(!parent) return;
  if(title===parent.title&&body===parent.body){
    toast('No changes detected. Please modify the idea before saving.');
    return;
  }
  closeModifyModal();
  const node=mkNode({type:'modification',tag:'manual-modification',title,body,parentId:parent.id,userPrompt:'[Manual modification]'});
  addNode(node); updateChatHeader(); rebuildChat(node.id);
  if(typeof renderAll==='function') renderAll(); else renderIdeasPanel();
  toast('Idea updated');
}

// ── Finalize ──────────────────────────────────────────────────
function finalizeCurrentIdea(){
  const node=S.nodes.find(n=>n.id===S.currentNodeId); if(!node) return;
  if(node.isFinalized){ markUnfinalized(node.id); } else { node.isFinalized=true; }
  updateChatHeader(); updateFinalizedCounter(); renderIdeasPanel();
  if(node.isFinalized) checkThreeDone();
  toast(node.isFinalized?'Idea finalized':'Idea unfinalized','var(--green)');
}
function startNewIdea(){ showChatInitial(); S.currentNodeId=null; document.getElementById('chat-messages').innerHTML=''; renderIdeasPanel(); }

// ── Chat send ─────────────────────────────────────────────────
function chatKeydown(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChatMessage(); } }
function sendChatMessage(){
  const inp=document.getElementById('chat-input');
  const msg=inp.value.trim(); if(!msg) return;
  if(!S.currentNodeId){ toast('Create an idea first.'); return; }
  // Intercept requests to generate a new idea — direct to the button
  if(isNewIdeaRequest(msg)){
    inp.value=''; inp.style.height='';
    appendToChat(makeMsgBubble('user',msg,''));
    appendToChat(makeMsgBubble('assistant','To start a new idea, please use the “+ New Idea” button at the top of the chat panel. This keeps each idea tracked separately in the system.',''));
    return;
  }
  document.getElementById('classify-area').style.display='none';
  const type=classifyMsg(msg);
  if(type){ inp.value=''; inp.style.height=''; processMessage(msg,type); }
  else{ window._pendingMsg=msg; document.querySelectorAll('input[name="classify"]').forEach(r=>r.checked=false); document.getElementById('classify-area').style.display='block'; }
}
function confirmClassification(){
  const sel=document.querySelector('input[name="classify"]:checked'); if(!sel){ toast('Please select.'); return; }
  document.getElementById('classify-area').style.display='none';
  const msg=window._pendingMsg; window._pendingMsg=null;
  const inp=document.getElementById('chat-input'); inp.value=''; inp.style.height='';
  processMessage(msg,sel.value);
}
function cancelClassification(){ document.getElementById('classify-area').style.display='none'; window._pendingMsg=null; }

async function processMessage(msg,type){
  const parentId=_replyToNodeId||S.currentNodeId;
  const parent=S.nodes.find(n=>n.id===parentId)||S.nodes.find(n=>n.id===S.currentNodeId);
  clearReply();
  appendToChat(makeMsgBubble('user',msg,parentId));
  setChatThinking(true);
  try{
    if(type==='modification'){
      const {system,user}=PROMPTS.modifyIdeaChat(parent.title,parent.body,S.challenge,msg);
      const text=await callClaude([{role:'user',content:user}],system);
      const json=JSON.parse(text.replace(/```json|```/g,'').trim());
      const node=mkNode({parentId:parent.id,type:'modification',tag:'ai-modification',
        title:json.title,body:json.body,userPrompt:msg,aiResponse:JSON.stringify(json)});
      addNode(node); appendToChat(makeIdeaBubble(node,'AI-Modified Idea','modified'));
      updateChatHeader(); renderIdeasPanel();
    } else {
      const history=buildAPIHistory(parent.id);
      let aiText='';
      if(type==='feedback'){
        const {system,user}=PROMPTS.feedbackChat(parent.title,parent.body,S.challenge,msg);
        aiText=await callClaude([...history,{role:'user',content:user}],system);
        const idx=parent.extras.length;
        parent.extras.push({type:'feedback',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        appendToChat(makeFeedbackBubble(aiText,parent.id,idx));
      } else {
        const sys=PROMPTS.clarificationChat(parent.title,parent.body,S.challenge);
        aiText=await callClaude([...history,{role:'user',content:msg}],sys);
        const idx=parent.extras.length;
        parent.extras.push({type:'clarification',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        appendToChat(makeMsgBubble('assistant',aiText,parent.id,idx));
      }
    }
  }catch(e){ appendToChat(makeMsgBubble('assistant','Error: '+e.message)); }
  finally{ setChatThinking(false); }
}
