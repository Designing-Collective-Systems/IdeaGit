// ============================================================
//  IdeaGit — Shared Utilities (included by all conditions)
// ============================================================

// ── CONFIGURABLE ─────────────────────────────────────────────
const REQUIRED_IDEAS = 3; // Change this to set the number of ideas required


const FIXED_CHALLENGE = [
  "Task: You are a designer tasked with designing a smartphone feature to reduce the duration and frequency of \u201cdoom-scrolling\u201d. Doom-scrolling refers to compulsive, endless scrolling, often on social media.",
  "Constraints: The feature should not turn off the phone, delete apps, or block the user from using an app.",
  "Scenario: Imagine you're pitching these ideas to a team that will implement your ideas. Describe each idea with enough detail that they wouldn't need to ask follow-up questions."
].join("\n\n");

const TASK_PREAMBLE_TEXT = 'For the following design challenge, please brainstorm and write down at least three ideas within 15 minutes (after you read the instructions). The goal of this task is to brainstorm ideas that meet the requirements of the design challenge. Your goal is NOT to complete the task quickly. Please let the research team member know once you are done brainstorming ideas.';
const TASK_PREAMBLE = {
  'AI-Assisted Ideation': TASK_PREAMBLE_TEXT,
  'AI-Assisted Structured Ideation': TASK_PREAMBLE_TEXT
};

const NEW_IDEA_KW = [
  'generate a new idea','create a new idea','give me a new idea','new idea please',
  'start a new idea','make a new idea','come up with a new idea','another idea',
  'generate another','create another idea','i need a new idea',
  'can you generate an idea','generate an idea','create an idea for me',
  'think of a new idea','brainstorm a new idea'
];
function isNewIdeaRequest(msg){
  const lc = msg.toLowerCase();
  return NEW_IDEA_KW.some(k => lc.includes(k));
}

function initChallengeBanner(){
  const preambleEl = document.getElementById('task-preamble');
  const textEl     = document.getElementById('challenge-text');
  if(preambleEl){
    const p = TASK_PREAMBLE[S.condition] || '';
    preambleEl.textContent = p;
    preambleEl.style.display = p ? '' : 'none';
  }
  if(textEl) textEl.textContent = FIXED_CHALLENGE;
}

// isAICondition: true for conditions 3 & 4 (string or number)
function isAICondition(){ return typeof S.condition==="string" ? S.condition.toLowerCase().includes("ai") : [3,4].includes(S.condition); }
function isCondition4(){ return typeof S.condition==="string" ? S.condition.toLowerCase().includes("structured") && S.condition.toLowerCase().includes("ai") : S.condition===4; }

const S = {
  condition: 0,
  challenge: '',
  nodes: [],
  currentNodeId: null,
  currentGroupId: null,
  activityLog: [],
  selfReportData: null, // populated when self-report is submitted (also used to prefill if reopened)
  participantId: '',    // entered on the landing page (app3/app4); identifies this participant in the database
  studyCondition: '',   // label stored in the database (set by each app); S.condition stays the internal name
};

// ── Utilities ─────────────────────────────────────────────────
function uid(){ return 'n'+Date.now()+'_'+Math.random().toString(36).slice(2,6); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg,bg=''){
  const el=document.createElement('div'); el.className='toast';
  if(bg) el.style.background=bg; el.textContent=msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),2800);
}
function csvC(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; }
function dlFile(content,filename,mime){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function dstamp(){ return new Date().toISOString().slice(0,10); }
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,180)+'px'; }

// ── Node management ───────────────────────────────────────────
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
  queueSync();
  return node;
}
function curNode(){ return S.nodes.find(n=>n.id===S.currentNodeId); }
function getPath(nodeId){
  const path=[]; let cur=S.nodes.find(n=>n.id===nodeId);
  while(cur){ path.unshift(cur); if(!cur.parentId) break; cur=S.nodes.find(n=>n.id===cur.parentId); }
  return path;
}
function buildAPIHistory(nodeId){
  const h=[]; getPath(nodeId).forEach(node=>{
    if(node.userPrompt) h.push({role:'user',content:node.userPrompt});
    if(node.aiResponse) h.push({role:'assistant',content:node.aiResponse});
    node.extras.forEach(ex=>{
      if(ex.userPrompt) h.push({role:'user',content:ex.userPrompt});
      if(ex.aiResponse) h.push({role:'assistant',content:ex.aiResponse});
    });
  });
  return h;
}
function existingSummary(){
  const roots=S.nodes.filter(n=>!n.parentId&&n.body);
  if(!roots.length) return '';
  return '\n\nExisting ideas (do NOT repeat):\n'+
    roots.map((n,i)=>`${i+1}. "${n.title}" — ${n.body.slice(0,100)}`).join('\n');
}

// ── Ideas list ────────────────────────────────────────────────
function getDisplayIdeas(){
  const finalized=S.nodes.filter(n=>n.isFinalized);
  const parentIds=new Set(S.nodes.map(n=>n.parentId).filter(Boolean));
  // In-progress: leaf nodes that are not finalized
  const ongoing=S.nodes.filter(n=>!parentIds.has(n.id)&&!n.isFinalized&&n.body);
  // Unfinalized: nodes that WERE finalized (isFinalized=false) but have children,
  // so they're not leaves — they'd otherwise be invisible
  const ongoingIds=new Set(ongoing.map(n=>n.id));
  const finalizedIds=new Set(finalized.map(n=>n.id));
  const unfinalized=S.nodes.filter(n=>
    !n.isFinalized && n.body &&
    parentIds.has(n.id) &&          // has children (not a leaf)
    !finalizedIds.has(n.id) &&
    !ongoingIds.has(n.id) &&
    n.meta && n.meta._wasFinalized  // only show if explicitly unfinalized
  );
  return {finalized,ongoing,unfinalized};
}
function makeIdeaCard(node,status,onSelect){
  const card=document.createElement('div');
  card.className=`idea-card ${status}${node.id===S.currentNodeId?' selected':''}`;
  // Only the Finalized badge is shown on the card itself; "In Progress" is
  // conveyed once, by the section label above the group of cards.
  const badge=status==='finalized'?'<div class="idea-card-badge badge-finalized">Finalized</div>':'';
  card.innerHTML=`${badge}<div class="idea-card-body">${esc(node.body)}</div>`;
  if(onSelect) card.addEventListener('click',()=>onSelect(node.id));
  return card;
}
function renderIdeasList(containerId,emptyId,onSelect){
  const area=document.getElementById(containerId);
  const emptyEl=document.getElementById(emptyId);
  if(!area) return;
  const {finalized,ongoing,unfinalized}=getDisplayIdeas();
  Array.from(area.children).forEach(c=>{ if(c.id!==emptyId) c.remove(); });
  if(!finalized.length&&!ongoing.length&&!unfinalized.length){
    if(emptyEl) emptyEl.style.display='flex'; return;
  }
  if(emptyEl) emptyEl.style.display='none';
  if(finalized.length){
    const l=document.createElement('div'); l.className='ideas-section-label'; l.textContent='Finalized';
    area.appendChild(l); finalized.forEach(n=>area.appendChild(makeIdeaCard(n,'finalized',onSelect)));
  }
  if(ongoing.length){
    const l=document.createElement('div'); l.className='ideas-section-label'; l.textContent='In Progress';
    area.appendChild(l); ongoing.forEach(n=>area.appendChild(makeIdeaCard(n,'ongoing',onSelect)));
  }
  if(unfinalized.length){
    const l=document.createElement('div'); l.className='ideas-section-label'; l.textContent='Unfinalized';
    area.appendChild(l); unfinalized.forEach(n=>area.appendChild(makeIdeaCard(n,'ongoing',onSelect)));
  }
}

// ── Process tree ──────────────────────────────────────────────
const _pan={x:0,y:0,dragging:false,sx:0,sy:0,_canvasId:null};

function initTreePanOn(areaId,canvasId){
  _pan._canvasId=canvasId;
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
    if(_pan.dragging){ _pan.dragging=false; document.getElementById(areaId)?.classList.remove('dragging'); }
  });
}
function applyPan(){
  const el=document.getElementById(_pan._canvasId); if(el) el.style.transform=`translate(${_pan.x}px,${_pan.y}px)`;
}
function resetPan(){ _pan.x=0; _pan.y=0; applyPan(); }

function computeLayout(gid){
  const gNodes=S.nodes.filter(n=>n.groupId===gid&&n.type!=='feedback'&&n.type!=='clarification');
  if(!gNodes.length) return {};
  const children={};
  gNodes.forEach(n=>{children[n.id]=[];});
  gNodes.forEach(n=>{ if(n.parentId&&children[n.parentId]) children[n.parentId].push(n.id); });
  const root=gNodes.find(n=>!n.parentId||!gNodes.find(p=>p.id===n.parentId));
  if(!root) return {};
  const W=165,H=62,HG=20,VG=70; const pos={};
  function getW(id){ const k=children[id]||[]; return !k.length?W:Math.max(W,k.reduce((s,c)=>s+getW(c),0)+HG*(k.length-1)); }
  function layout(id,x,y){
    pos[id]={x,y}; const k=children[id]||[]; if(!k.length) return;
    const tw=k.reduce((s,c)=>s+getW(c),0)+HG*(k.length-1); let cx=x-tw/2;
    k.forEach(c=>{ const cw=getW(c); layout(c,cx+cw/2,y+H+VG); cx+=cw+HG; });
  }
  layout(root.id,getW(root.id)/2+24,24);
  return pos;
}

function renderTreeInto({svgId,nodesId,emptyId,labelId,canvasId,onNodeClick,hoverMode}){
  const nodesEl=document.getElementById(nodesId);
  const svg=document.getElementById(svgId);
  const emptyEl=document.getElementById(emptyId);
  if(!nodesEl||!svg) return;
  nodesEl.innerHTML=''; svg.innerHTML='';
  if(hoverMode) hideTreeTooltip();
  if(!S.currentGroupId){ if(emptyEl) emptyEl.style.display='flex'; return; }
  const gNodes=S.nodes.filter(n=>n.groupId===S.currentGroupId);
  if(!gNodes.length){ if(emptyEl) emptyEl.style.display='flex'; return; }
  if(emptyEl) emptyEl.style.display='none';
  const pos=computeLayout(S.currentGroupId);
  const vals=Object.values(pos); if(!vals.length){ if(emptyEl) emptyEl.style.display='flex'; return; }
  const maxX=Math.max(...vals.map(p=>p.x))+110, maxY=Math.max(...vals.map(p=>p.y))+80;
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
    const tc=node.isFinalized?'t-finalized':node.tag==='ai-generated'?'t-ai-create':
              node.tag==='user-created'?'t-creation':node.tag==='manual-modification'?'t-manual':'t-ai-mod';
    const typeLabel=node.isFinalized?'Finalized':node.type==='creation'?(node.tag==='ai-generated'?'AI Creation':'Creation'):
                    node.tag==='manual-modification'?'Manual Edit':'AI Modification';
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--blue)':
                    tc==='t-creation'?'var(--yellow-dk)':tc==='t-manual'?'var(--amber)':'var(--blue)';
    const el=document.createElement('div');
    el.className=`tree-node ${tc}${isCur?' current':''}`;
    el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    if(hoverMode){
      // Compact node: only the tag (plus "Finalized" on its own line above it).
      // The idea's title and description appear in a tooltip on hover.
      const tagColor=node.tag==='ai-generated'?'var(--blue)':node.tag==='user-created'?'var(--yellow-dk)':
                     node.tag==='manual-modification'?'var(--amber)':'var(--blue)';
      el.innerHTML=`<div class="tree-node-inner tree-node-compact" style="height:${H}px">`+
        (node.isFinalized?'<div class="tree-node-status">Finalized</div>':'')+
        `<div class="tree-node-type" style="color:${tagColor}">${nodeTagLabel(node)}</div></div>`;
      el.addEventListener('mouseenter',e=>showTreeTooltip(node,e));
      el.addEventListener('mousemove',moveTreeTooltip);
      el.addEventListener('mouseleave',hideTreeTooltip);
    } else {
      el.innerHTML=`<div class="tree-node-inner"><div class="tree-node-type" style="color:${typeColor}">${typeLabel}</div><div class="tree-node-title">${esc(node.title||'(untitled)')}</div></div>`;
    }
    if(onNodeClick) el.addEventListener('click',()=>onNodeClick(node.id));
    nodesEl.appendChild(el);
  });
  resetPan();
  const root=gNodes.find(n=>!n.parentId||!gNodes.find(p=>p.id===n.parentId));
  const labelEl=document.getElementById(labelId);
  if(labelEl) labelEl.textContent=root?root.title:'';
}

// ── Claude API ─────────────────────────────────────────────────
async function callClaude(messages,system=''){
  const body={model:'claude-sonnet-4-6',max_tokens:1024,messages};
  if(system) body.system=system;
  const res=await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e?.error||'API error '+res.status); }
  return (await res.json()).content[0].text;
}

// ── Classification (C3/C4) ────────────────────────────────────
const MOD_KW=['modify','change','update','edit','improve','refine','revise','adjust','tweak',
  'add to','remove','replace','alter','rephrase','rewrite','fix','enhance','develop','expand',
  'simplify','make it','make this','make the','instead of','rather than','incorporate',
  'include','exclude','drop','swap','strengthen','focus on','shift','pivot','new version',
  'can you change','please change','please modify','add a','remove the'];
const FEED_KW=['feedback','what do you think','your opinion','your thoughts','evaluate',
  'critique','assess','review','rate','pros and cons','strengths','weaknesses',
  'analyze','how is','how does','is this good','does this work','does this address',
  'is this feasible','realistic','effective','comment on','concerns','do you like'];
function classifyMsg(msg){
  const lc=msg.toLowerCase();
  const m=MOD_KW.filter(k=>lc.includes(k)).length;
  const f=FEED_KW.filter(k=>lc.includes(k)).length;
  if(m>0&&m>=f) return 'modification';
  if(f>0&&f>m) return 'feedback';
  return null;
}

// ── Export ─────────────────────────────────────────────────────
function buildCombinedCSV(){
  // Build a lookup: node_id -> self-report AI-use answer (only for finalized ideas that were self-reported)
  const srMap = new Map();
  if(S.selfReportData){
    const { finalized, aiUses } = S.selfReportData;
    finalized.forEach((n,i)=>{ srMap.set(n.id, aiUses[i] || ''); });
  }

  const hdr=['node_id','group_id','parent_id','type','tag','title','body',
             'is_finalized','user_prompt','ai_response','timestamp','extras_json',
             'self_report_ai_use'];
  const rows=S.nodes.map(n=>[
    n.id,n.groupId,n.parentId||'',n.type,n.tag,
    csvC(n.title),csvC(n.body),n.isFinalized?'1':'0',
    csvC(n.userPrompt),csvC(n.aiResponse),
    new Date(n.ts).toISOString(), csvC(JSON.stringify(n.extras)),
    csvC(srMap.get(n.id) || '')
  ].join(','));
  return [hdr.join(','),...rows].join('\n');
}
function exportCSV(){
  if(!S.nodes.length){ toast('Nothing to export yet.'); return; }
  dlFile(buildCombinedCSV(),`ideagit_c${S.condition}_${dstamp()}.csv`,'text/csv');
  toast('Exported','var(--green)');
}

// ── Navigation ─────────────────────────────────────────────────
function goHome(){
  if(S.participantId) return; // participants stay on their own condition's page
  if(S.nodes.length&&!confirm('Go back? Export first if you want to save.')) return;
  window.location.href='/';
}

// ── Instructions ───────────────────────────────────────────────
function openInstructions(){
  document.getElementById('instructions-head').textContent='Instructions for using IdeaGit';
  document.getElementById('instructions-content').innerHTML=window.CONDITION_INSTRUCTIONS||'';
  document.getElementById('instructions-modal').style.display='flex';
}
function closeInstructions(){ document.getElementById('instructions-modal').style.display='none'; }

function openDetailsModal(){ document.getElementById('details-modal').style.display='flex'; }
function closeDetailsModal(){ document.getElementById('details-modal').style.display='none'; }

// ── Setup page ─────────────────────────────────────────────────
function onChallengeInput(){
  const v=document.getElementById('challenge-input').value.trim();
  document.getElementById('start-btn').disabled=v.length===0;
}

// ── Done / Finalize tracking ──────────────────────────────────
function finalizedCount(){ return S.nodes.filter(n=>n.isFinalized).length; }
function updateFinalizedCounter(){
  // Idea counter removed — participants may finalize as many ideas as they want.
  const el=document.getElementById('nav-finalized-count');
  if(el) el.style.display='none';
}
function checkThreeDone(){
  // No-op: idea count target removed. Participants finish via the "Done with Task" button only.
}
function handleDone(){
  document.getElementById('done-count').textContent=finalizedCount();
  document.getElementById('done-popup').style.display='flex';
}
function closeDonePopup(){ document.getElementById('done-popup').style.display='none'; }
function confirmDone(){
  closeDonePopup();
  if(isAICondition()) openSelfReport();
  else{ exportCSV(); toast('Session exported. You may now close the page.','var(--green)'); }
}

// ── Self-report (C3/C4 only) ──────────────────────────────────
let _srPage=0,_srCurrentIdea=0,_srSubTab='chat';
function openSelfReport(){
  const finalized=S.nodes.filter(n=>n.isFinalized);
  if(!finalized.length) return;
  _srPage=0; _srCurrentIdea=0;
  _srSubTab=isCondition4()?'tree':'chat';

  // ── Left panel: idea tabs ────────────────────────────────────
  const tabs=document.getElementById('sr-idea-tabs'); if(!tabs) return;
  tabs.innerHTML='';
  finalized.forEach((n,i)=>{
    const btn=document.createElement('button');
    btn.className='sr-idea-tab'+(i===0?' sr-idea-active':'');
    btn.textContent=`Idea ${i+1}`;
    btn.onclick=()=>{ srSelectIdea(i,finalized); srShowPage(i); };
    tabs.appendChild(btn);
  });
  const subTabs=document.getElementById('sr-sub-tabs');
  if(subTabs) subTabs.style.display=isAICondition()?'flex':'none';
  const treeTab=document.getElementById('sr-tab-tree');
  if(treeTab) treeTab.style.display=isCondition4()?'':'none';
  const srLeft=document.getElementById('sr-left');
  if(srLeft) srLeft.style.display=isAICondition()?'flex':'none';

  // ── Right panel: generate one page per idea ──────────────────
  const srRight=document.querySelector('.sr-right');
  if(srRight){
    srRight.innerHTML='<div class="sr-right-header"><div class="sr-step-indicator" id="sr-step-indicator"></div><button class="btn btn-outline btn-sm" onclick="closeSelfReport()">Close ✕</button></div>';
    finalized.forEach((node,i)=>{
      const isLast=i===finalized.length-1;
      const page=document.createElement('div');
      page.className='sr-page'; page.id=`sr-page-${i}`;
      page.style.display=i===0?'flex':'none';
      page.innerHTML=`
        <h2 class="sr-page-title">Idea ${i+1}: <span class="sr-idea-title-inline">${esc(node.title)}</span></h2>
        <div class="sr-question">
          <p class="sr-q-label">Please describe how you used AI to generate or improve this idea.</p>
          <textarea class="sr-ai-use-ta" id="sr-ai-use-${i}"
            placeholder="Describe how you used AI, or write 'N/A' if you did not use AI for this idea…"
            rows="6"></textarea>
        </div>
        <div class="sr-foot">
          ${i>0?'<button class="btn btn-outline" onclick="srPrev()">← Back</button>':''}
          ${isLast
            ?'<button class="btn btn-green" onclick="srSubmit()">Submit Self-Reports</button>'
            :'<button class="btn btn-primary" onclick="srNext()">Next →</button>'}
        </div>`;
      srRight.appendChild(page);
    });

    // Prefill previously saved answers (matched by node id) if reopening after a prior submit
    if(S.selfReportData){
      const savedMap = new Map();
      S.selfReportData.finalized.forEach((n,i)=>{ savedMap.set(n.id, S.selfReportData.aiUses[i]); });
      finalized.forEach((node,i)=>{
        if(savedMap.has(node.id)){
          const ta=document.getElementById(`sr-ai-use-${i}`);
          if(ta) ta.value = savedMap.get(node.id);
        }
      });
    }
  }

  srUpdateStep(); srSelectIdea(0,finalized); srShowPage(0); srSubTab(_srSubTab);
  document.getElementById('self-report-modal').style.display='flex';
}
function srSelectIdea(idx,finalizedArg){
  _srCurrentIdea=idx;
  const finalized=finalizedArg||S.nodes.filter(n=>n.isFinalized);
  document.querySelectorAll('.sr-idea-tab').forEach((t,i)=>t.classList.toggle('sr-idea-active',i===idx));
  srRenderContent(finalized[idx]);
}
function srRenderContent(node){
  if(!node) return;
  const disp=document.getElementById('sr-idea-display'); if(!disp) return;
  if(_srSubTab==='chat'){
    const path=getPath(node.id); let html='<div class="sr-chat-history">';
    path.forEach(n=>{
      if(n.type==='creation') html+=`<div class="sr-idea-bubble">${esc(n.body)}</div>`;
      else if(n.type==='modification'){
        if(n.userPrompt) html+=`<div class="sr-msg-user">${esc(n.userPrompt)}</div>`;
        html+=`<div class="sr-idea-bubble"><em>${n.tag==='manual-modification'?'Manual edit':'AI modified'}</em><br>${esc(n.body)}</div>`;
      }
      n.extras.forEach(ex=>{
        if(ex.userPrompt) html+=`<div class="sr-msg-user">${esc(ex.userPrompt)}</div>`;
        if(ex.aiResponse) html+=`<div class="sr-msg-ai">${esc(ex.aiResponse)}</div>`;
      });
    });
    disp.innerHTML=html+'</div>';
  } else {
    disp.innerHTML='<div style="width:100%;height:100%;position:relative;overflow:auto;background:var(--bg);padding-top:1.8rem;box-sizing:border-box"><div id="sr-tree-inner" style="position:relative"><svg id="sr-tree-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg><div id="sr-tree-nodes"></div></div></div>';
    renderSrTree(node.groupId, node.id);
  }
}
function renderSrTree(gid, currentNodeId){
  const nodesEl=document.getElementById('sr-tree-nodes');
  const svg=document.getElementById('sr-tree-svg');
  if(!nodesEl||!svg) return;
  nodesEl.innerHTML=''; svg.innerHTML='';
  const gNodes=S.nodes.filter(n=>n.groupId===gid&&n.type!=='feedback'&&n.type!=='clarification');
  if(!gNodes.length) return;
  const savedGid=S.currentGroupId, savedNid=S.currentNodeId;
  S.currentGroupId=gid;
  const pos=computeLayout(gid);
  S.currentGroupId=savedGid;
  const vals=Object.values(pos); if(!vals.length) return;
  const maxX=Math.max(...vals.map(p=>p.x))+100, maxY=Math.max(...vals.map(p=>p.y))+70;
  const inner=document.getElementById('sr-tree-inner');
  if(inner){ inner.style.width=maxX+'px'; inner.style.height=maxY+'px'; }
  svg.style.width=maxX+'px'; svg.style.height=maxY+'px';
  svg.innerHTML=`<defs><marker id="arr2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--border2)"/></marker></defs>`;
  const W=145,H=56;
  gNodes.forEach(node=>{
    if(!node.parentId) return;
    const fp=pos[node.parentId],tp=pos[node.id]; if(!fp||!tp) return;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',`M${fp.x},${fp.y+H} C${fp.x},${fp.y+H+24} ${tp.x},${tp.y-24} ${tp.x},${tp.y}`);
    p.setAttribute('class','edge'); p.setAttribute('marker-end','url(#arr2)'); svg.appendChild(p);
  });
  gNodes.forEach(node=>{
    const p=pos[node.id]; if(!p) return;
    const tc=node.isFinalized?'t-finalized':node.tag==='ai-generated'?'t-ai-create':
              node.tag==='user-created'?'t-creation':node.tag==='manual-modification'?'t-manual':'t-ai-mod';
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--blue)':
                    tc==='t-creation'?'var(--yellow-dk)':tc==='t-manual'?'var(--amber)':'var(--blue)';
    const el=document.createElement('div');
    const isCurrent = node.id === currentNodeId;
    el.className=`tree-node ${tc}${isCurrent?' sr-current':''}`; el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    el.innerHTML=`${isCurrent?'<div class="sr-current-badge">Reporting on this idea \u2193</div>':''}<div class="tree-node-inner" style="padding:7px 9px">${isCurrent?'<div class="sr-current-ring"></div>':''}<div class="tree-node-type" style="color:${typeColor};font-size:0.45rem">${node.isFinalized?'Finalized':node.type}</div><div class="tree-node-title" style="font-size:0.55rem">${esc(node.title||'(untitled)')}</div></div>`;
    nodesEl.appendChild(el);
  });
}
function srSubTab(tab){
  _srSubTab=tab;
  document.getElementById('sr-tab-chat')?.classList.toggle('sr-sub-active',tab==='chat');
  document.getElementById('sr-tab-tree')?.classList.toggle('sr-sub-active',tab==='tree');
  const finalized=S.nodes.filter(n=>n.isFinalized);
  srRenderContent(finalized[_srCurrentIdea]);
}
function srToggleB(show){ const el=document.getElementById('sr-q-b'); if(el) el.style.display=show?'block':'none'; }
function toggleOtherBox(cb){ const ta=document.getElementById('ai-for-other'); if(ta){ ta.style.display=cb.checked?'block':'none'; if(cb.checked) ta.focus(); } }
function srUpdateStep(){
  const tot=S.nodes.filter(n=>n.isFinalized).length;
  const el=document.getElementById('sr-step-indicator'); if(el) el.textContent=`Idea ${_srPage+1} of ${tot}`;
}
function srShowPage(n){
  _srPage=n;
  const _tot=S.nodes.filter(nd=>nd.isFinalized).length;
  for(let i=0;i<_tot;i++){ const el=document.getElementById(`sr-page-${i}`); if(el) el.style.display='none'; }
  const t=document.getElementById(`sr-page-${n}`); if(t) t.style.display='flex';
  const f=S.nodes.filter(nd=>nd.isFinalized);
  srSelectIdea(n,f);
  srUpdateStep();
}
function srNext(){ const total=S.nodes.filter(n=>n.isFinalized).length; if(_srPage<total-1) srShowPage(_srPage+1); }
function srPrev(){ if(_srPage>0) srShowPage(_srPage-1); }
async function srSubmit(){
  const finalized=S.nodes.filter(n=>n.isFinalized); // all finalized, no cap
  // Validate all fields are filled before allowing submission
  const hasEmpty=finalized.some((_,i)=>{
    const ta=document.getElementById(`sr-ai-use-${i}`);
    return !ta||!ta.value.trim();
  });
  if(hasEmpty){ toast('Please fill in all fields before submitting.'); return; }

  const aiUses=finalized.map((_,i)=>{
    const ta=document.getElementById(`sr-ai-use-${i}`);
    return ta?ta.value.trim():'';
  });

  const btn=document.querySelector('.sr-foot .btn-green');
  if(btn){ btn.disabled=true; btn.textContent='Saving…'; }

  // Attach each answer to its idea, and clear any answer left on an idea that is no longer finalized
  S.nodes.forEach(n=>{ n.selfReportAiUse=''; });
  finalized.forEach((n,i)=>{ n.selfReportAiUse=aiUses[i]; });
  S.selfReportData={ finalized, aiUses }; // kept so the form is prefilled if reopened

  const ok=await syncNow();
  if(!ok){
    if(btn){ btn.disabled=false; btn.textContent='Submit Self-Reports'; }
    toast('Could not save your responses. Check your connection and try again.','var(--red)');
    return;
  }
  document.getElementById('self-report-modal').style.display='none';
  toast('Your responses have been saved. Thank you!','var(--green)');
}
function closeSelfReport(){
  document.getElementById('self-report-modal').style.display='none';
}

// Called when a node is unfinalized — marks it so it stays visible in the list
function markUnfinalized(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  node.isFinalized=false;
  node.meta=node.meta||{};
  node.meta._wasFinalized=true;
  queueSync();
}

// ── Landing page (app3 / app4): collect the participant ID ─────
function initLanding(){
  const input=document.getElementById('participant-id-input');
  const btn=document.getElementById('btn-begin');
  if(!input||!btn) return;
  input.addEventListener('input',()=>{ btn.disabled=!input.value.trim(); });
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') beginStudy(); });
  input.focus();
}
function beginStudy(){
  const input=document.getElementById('participant-id-input');
  const id=(input&&input.value||'').trim();
  if(!id) return;
  S.participantId=id;
  document.getElementById('page-landing').style.display='none';
  document.getElementById('page-ideation').style.display='flex';
  if(typeof onStudyBegin==='function') onStudyBegin();
}

// ── Tree node labels + hover tooltip (used when hoverMode is on) ──
function nodeTagLabel(node){
  const t=node.tag;
  return t==='ai-generated'?'Created with AI':t==='user-created'?'Created Manually':
         t==='manual-modification'?'Modified Manually':'Modified with AI';
}
function _treeTooltipEl(){
  let t=document.getElementById('tree-tooltip');
  if(!t){
    t=document.createElement('div'); t.id='tree-tooltip'; t.className='tree-tooltip';
    document.body.appendChild(t);
  }
  return t;
}
function showTreeTooltip(node,e){
  const t=_treeTooltipEl();
  const parent=node.parentId?S.nodes.find(n=>n.id===node.parentId):null;
  const bodyHtml=parent?diffHighlightBody(parent.body,node.body):esc(node.body||'');
  t.innerHTML=`<div class="tree-tooltip-body">${bodyHtml}</div>`;
  t.style.display='block';
  moveTreeTooltip(e);
}
function moveTreeTooltip(e){
  const t=document.getElementById('tree-tooltip'); if(!t||t.style.display==='none') return;
  const gap=16, w=t.offsetWidth, h=t.offsetHeight;
  let x=e.clientX+gap, y=e.clientY+gap;
  if(x+w>window.innerWidth-8)  x=e.clientX-w-gap;   // flip to the left of the cursor
  if(y+h>window.innerHeight-8) y=e.clientY-h-gap;   // flip above the cursor
  t.style.left=Math.max(8,x)+'px'; t.style.top=Math.max(8,y)+'px';
}
function hideTreeTooltip(){
  const t=document.getElementById('tree-tooltip'); if(t) t.style.display='none';
}

// ── Database sync (saved through the server into Postgres) ─────
// Only runs once a participant ID has been entered, so app1/app2 are unaffected.
let _syncTimer=null, _retryTimer=null, _saveWarned=false, _syncChain=Promise.resolve(true);
const _synced={}; // node_id -> JSON of the last version the server confirmed

function nodeToRow(n){
  return {
    node_id:n.id, group_id:n.groupId, parent_id:n.parentId||null,
    type:n.type, tag:n.tag, title:n.title||'', body:n.body||'',
    is_finalized:!!n.isFinalized, user_prompt:n.userPrompt||'', ai_response:n.aiResponse||'',
    extras:n.extras||[], self_report_ai_use:n.selfReportAiUse||'', created_at_ms:n.ts,
  };
}
async function _doSync(){
  if(!S.participantId) return true;
  const changed=S.nodes.map(nodeToRow).filter(r=>_synced[r.node_id]!==JSON.stringify(r));
  if(!changed.length) return true;
  try{
    const res=await fetch('/api/save-nodes',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({participant_id:S.participantId, condition:S.studyCondition||S.condition, nodes:changed}),
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    changed.forEach(r=>{ _synced[r.node_id]=JSON.stringify(r); });
    return true;
  }catch(e){ console.error('Save failed:',e); return false; }
}
// Saves are chained so an older snapshot can never overwrite a newer one.
function syncNow(){
  clearTimeout(_syncTimer);
  _syncChain=_syncChain.then(_doSync,_doSync);
  return _syncChain;
}
function queueSync(){
  if(!S.participantId) return;
  clearTimeout(_syncTimer);
  _syncTimer=setTimeout(retrySync,500);
}
function retrySync(){
  clearTimeout(_retryTimer);
  syncNow().then(ok=>{
    if(ok){ _saveWarned=false; return; }
    if(!_saveWarned){ _saveWarned=true; toast('Having trouble saving. Your work stays on screen and saving will keep retrying.','var(--amber)'); }
    _retryTimer=setTimeout(retrySync,5000);
  });
}

// ============================================================
//  Shared AI-chat / idea logic (conditions 3 & 4 — app3.js/app4.js
//  only set S.condition, instructions text, and the startup hook).
//  app4 has a tree panel and app3 doesn't; hasTree() detects which.
// ============================================================
function hasTree(){ return !!document.getElementById('tree-nodes'); }
function nodeLabel(node){
  if(node.title) return node.title;
  const b=node.body||''; return b.length>48 ? b.slice(0,48)+'…' : b;
}

// Word-level diff: renders newBody as-is, wrapping words that are new
// (not present in the same relative position in oldBody) in <strong>.
// Removed words are simply not shown — newBody is what's displayed either way.
function diffHighlightBody(oldBody,newBody){
  const oldT=(oldBody||'').split(/(\s+)/), newT=(newBody||'').split(/(\s+)/);
  const n=oldT.length, m=newT.length;
  const dp=Array.from({length:n+1},()=>new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--)
    dp[i][j]=oldT[i]===newT[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0,out='';
  while(j<m){
    if(i<n && oldT[i]===newT[j] && dp[i][j]===dp[i+1][j+1]+1){ out+=esc(newT[j]); i++; j++; }
    else if(i<n && dp[i+1][j]>=dp[i][j+1]){ i++; }
    else { out+=(/^\s+$/.test(newT[j])?newT[j]:'<strong>'+esc(newT[j])+'</strong>'); j++; }
  }
  return out;
}

function refreshUI(){
  renderIdeasList('ideas-list','ideas-empty',selectIdea);
  if(hasTree()) renderTreeInto({svgId:'tree-svg',nodesId:'tree-nodes',emptyId:'tree-empty',canvasId:'tree-canvas',onNodeClick:selectIdea,hoverMode:true});
  updateFinalizedCounter();
}

function startIdeation(){
  S.challenge=FIXED_CHALLENGE;
  S.nodes=[]; S.currentNodeId=null; S.currentGroupId=null;
  initChallengeBanner();
  if(hasTree()) initTreePanOn('tree-area','tree-canvas');
  showChatInitial(); updateFinalizedCounter(); refreshUI();
}

let _replyToNodeId=null;

function selectIdea(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  S.currentNodeId=nodeId; S.currentGroupId=node.groupId;
  showChatActive(); updateChatHeader(); rebuildChat(nodeId); refreshUI();
}

// ── Chat display ──────────────────────────────────────────────
function showChatInitial(){ document.getElementById('chat-initial').style.display='flex'; document.getElementById('chat-active').style.display='none'; }
function showChatActive(){ document.getElementById('chat-initial').style.display='none'; document.getElementById('chat-active').style.display='flex'; }
function setChatThinking(on){ document.getElementById('chat-thinking').style.display=on?'flex':'none'; const inp=document.getElementById('chat-input'); if(inp) inp.disabled=on; }
function updateChatHeader(){
  const node=S.nodes.find(n=>n.id===S.currentNodeId);
  document.getElementById('current-idea-title').textContent=node?nodeLabel(node):'—';
  const btn=document.getElementById('btn-finalize');
  if(btn){ btn.textContent=node&&node.isFinalized?'Unfinalize':'Finalize'; btn.disabled=false; btn.className=node&&node.isFinalized?'btn btn-outline btn-sm':'btn btn-green btn-sm'; }
}
// Rebuilds the full chat for nodeId, then scrolls to where that idea's own
// body appears (its creation/modification point) rather than the bottom of
// any trailing feedback/clarification messages.
function rebuildChat(nodeId){
  const wrap=document.getElementById('chat-messages'); if(!wrap) return; wrap.innerHTML='';
  getPath(nodeId).forEach(node=>{
    if(node.type==='creation') wrap.appendChild(makeIdeaBubble(node,node.tag==='ai-generated'?'AI-Generated Idea':'Your Idea',node.tag==='ai-generated'?'ai-created':'manual-created'));
    else if(node.type==='modification'){
      if(node.userPrompt) wrap.appendChild(makeMsgBubble('user',node.userPrompt,node.id));
      wrap.appendChild(makeIdeaBubble(node,node.tag==='manual-modification'?'Manually Modified':'AI-Modified',node.tag==='manual-modification'?'manual':'modified'));
    }
    node.extras.forEach((ex,idx)=>{
      if(ex.userPrompt) wrap.appendChild(makeMsgBubble('user',ex.userPrompt,node.id,idx));
      if(ex.type==='feedback') wrap.appendChild(makeFeedbackBubble(ex.aiResponse,node.id,idx));
      else if(ex.aiResponse) wrap.appendChild(makeMsgBubble('assistant',ex.aiResponse,node.id,idx));
    });
  });
  const target=wrap.querySelector(`.idea-bubble[data-node-id="${nodeId}"]`);
  if(target) target.scrollIntoView({block:'start'}); else wrap.scrollTop=wrap.scrollHeight;
}

function makeIdeaBubble(node,label,cls){
  const el=document.createElement('div'); el.className='idea-bubble'+(cls?' '+cls:''); el.dataset.nodeId=node.id;
  const parent=node.parentId?S.nodes.find(n=>n.id===node.parentId):null;
  const bodyHtml=(node.type==='modification'&&parent)?diffHighlightBody(parent.body,node.body):esc(node.body);
  el.innerHTML=`<div class="bubble-reply-btn" onclick="setReplyTo('${node.id}',null,'${esc(nodeLabel(node))}')">↩</div>
    <div class="idea-bubble-label">${esc(label)}</div>
    <div class="idea-bubble-body">${bodyHtml}</div>`;
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
  const ind=document.getElementById('reply-indicator'), txt=document.getElementById('reply-text');
  if(ind&&txt){ ind.style.display='flex'; txt.textContent=preview||'message'; }
  document.getElementById('chat-input')?.focus();
}
function clearReply(){ _replyToNodeId=null; const ind=document.getElementById('reply-indicator'); if(ind) ind.style.display='none'; }

// ── Create idea manually (description only — no title) ─────────
function startManualCreate(){
  document.getElementById('create-body').value='';
  document.getElementById('modal-create').style.display='flex';
  setTimeout(()=>document.getElementById('create-body').focus(),60);
}
function closeCreateModal(){ document.getElementById('modal-create').style.display='none'; }
function submitManualCreate(){
  const body=document.getElementById('create-body').value.trim();
  if(!body){ toast('Please describe your idea.'); return; }
  closeCreateModal();
  const node=mkNode({type:'creation',tag:'user-created',title:'',body}); addNode(node);
  showChatActive(); updateChatHeader(); rebuildChat(node.id); refreshUI();
}

// ── Generate with AI: confirm/edit the prompt before sending ───
let _pendingGenerate=null;
function startAICreate(){
  const {system,editable,hiddenSuffix}=PROMPTS.generateIdea(S.challenge,existingSummary());
  _pendingGenerate={system,hiddenSuffix};
  document.getElementById('generate-prompt-text').value=editable;
  document.getElementById('modal-generate-confirm').style.display='flex';
}
function cancelGenerateConfirm(){ document.getElementById('modal-generate-confirm').style.display='none'; _pendingGenerate=null; }
async function confirmGenerateConfirm(){
  const edited=document.getElementById('generate-prompt-text').value.trim();
  if(!edited){ toast('Please enter a prompt.'); return; }
  const {system,hiddenSuffix}=_pendingGenerate||{}; _pendingGenerate=null;
  document.getElementById('modal-generate-confirm').style.display='none';
  showChatActive();
  const wrap=document.getElementById('chat-messages'); wrap.innerHTML='';
  appendToChat(makeMsgBubble('system-note','Generating idea…'));
  setChatThinking(true);
  try{
    const text=await callClaude([{role:'user',content:edited+hiddenSuffix}],system);
    const json=JSON.parse(text.replace(/```json|```/g,'').trim());
    wrap.innerHTML='';
    const node=mkNode({type:'creation',tag:'ai-generated',title:json.title,body:json.body}); addNode(node);
    updateChatHeader(); rebuildChat(node.id); refreshUI();
  }catch(e){ wrap.innerHTML=''; appendToChat(makeMsgBubble('assistant','Error: '+e.message)); showChatInitial(); }
  finally{ setChatThinking(false); }
}

// ── Modify manually (description only — no title) ───────────────
function openManualModify(){
  const node=S.nodes.find(n=>n.id===S.currentNodeId); if(!node) return;
  document.getElementById('modify-body').value=node.body;
  document.getElementById('modal-modify').style.display='flex';
  setTimeout(()=>document.getElementById('modify-body').focus(),60);
}
function closeModifyModal(){ document.getElementById('modal-modify').style.display='none'; }
function submitManualModify(){
  const body=document.getElementById('modify-body').value.trim();
  if(!body){ toast('Please describe your idea.'); return; }
  const parent=S.nodes.find(n=>n.id===S.currentNodeId); if(!parent) return;
  if(body===parent.body){ toast('No changes detected. Please modify the idea before saving.'); return; }
  closeModifyModal();
  const node=mkNode({type:'modification',tag:'manual-modification',title:'',body,parentId:parent.id,userPrompt:'[Manual modification]'});
  addNode(node); updateChatHeader(); rebuildChat(node.id); refreshUI();
  toast('Idea updated');
}

// ── Finalize ──────────────────────────────────────────────────
function finalizeCurrentIdea(){
  const node=S.nodes.find(n=>n.id===S.currentNodeId); if(!node) return;
  if(node.isFinalized){ markUnfinalized(node.id); } else { node.isFinalized=true; }
  updateChatHeader(); updateFinalizedCounter(); refreshUI();
  if(node.isFinalized) checkThreeDone();
  queueSync();
  toast(node.isFinalized?'Idea finalized':'Idea unfinalized','var(--green)');
}
function startNewIdea(){ showChatInitial(); S.currentNodeId=null; document.getElementById('chat-messages').innerHTML=''; refreshUI(); }

// ── Chat send ─────────────────────────────────────────────────
function chatKeydown(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChatMessage(); } }
function sendChatMessage(){
  const inp=document.getElementById('chat-input');
  const msg=inp.value.trim(); if(!msg) return;
  if(!S.currentNodeId){ toast('Create an idea first.'); return; }
  if(msg.toLowerCase()==='finalize'){ inp.value=''; inp.style.height=''; finalizeCurrentIdea(); return; }
  // Intercept requests to generate a new idea — direct to the button
  if(isNewIdeaRequest(msg)){
    inp.value=''; inp.style.height='';
    appendToChat(makeMsgBubble('user',msg,''));
    appendToChat(makeMsgBubble('assistant','To start a new idea, please use the “+ New Idea” button at the top of the chat panel. This keeps each idea tracked separately in the system.',''));
    return;
  }
  inp.value=''; inp.style.height='';
  const type=classifyMsg(msg);
  if(type) processMessage(msg,type);
  else processMessageAIClassify(msg); // keyword match was ambiguous — ask the AI to decide
}

// ── AI-decided classification (used only when keywords can't tell) ──
async function processMessageAIClassify(msg){
  const parentId=_replyToNodeId||S.currentNodeId;
  const parent=S.nodes.find(n=>n.id===parentId)||S.nodes.find(n=>n.id===S.currentNodeId);
  setChatThinking(true);
  let type='clarification';
  try{
    const sys=PROMPTS.classifyIntent(parent.title,parent.body,S.challenge,msg);
    const text=await callClaude([{role:'user',content:msg}],sys);
    const t=text.trim().toLowerCase();
    type = t.includes('modification')?'modification' : t.includes('feedback')?'feedback' : 'clarification';
  }catch(e){ /* default to clarification on error */ }
  processMessage(msg,type);
}

// Everything exchanged about the current node since it was created (feedback +
// clarification answers), so a later "do this for me" reply has the context.
function buildRecentContext(parent){
  if(!parent||!parent.extras.length) return '';
  const lines=parent.extras.map(ex=>{
    const label=ex.type==='feedback'?'Feedback given':'Answered';
    return (ex.userPrompt?`User asked: "${ex.userPrompt}"\n`:'')+`${label}: "${ex.aiResponse}"`;
  });
  return '\n\nRecent conversation about this idea (for context):\n'+lines.join('\n\n');
}

async function processMessage(msg,type){
  const parentId=_replyToNodeId||S.currentNodeId;
  const parent=S.nodes.find(n=>n.id===parentId)||S.nodes.find(n=>n.id===S.currentNodeId);
  clearReply();
  appendToChat(makeMsgBubble('user',msg,parentId));
  setChatThinking(true);
  try{
    if(type==='modification'){
      const recentContext=buildRecentContext(parent);
      const {system,user}=PROMPTS.modifyIdeaChat(parent.title,parent.body,S.challenge,msg,recentContext);
      const text=await callClaude([{role:'user',content:user}],system);
      const json=JSON.parse(text.replace(/```json|```/g,'').trim());
      const node=mkNode({parentId:parent.id,type:'modification',tag:'ai-modification',
        title:json.title,body:json.body,userPrompt:msg,aiResponse:JSON.stringify(json)});
      addNode(node); appendToChat(makeIdeaBubble(node,'AI-Modified Idea','modified'));
      updateChatHeader(); refreshUI();
    } else {
      const history=buildAPIHistory(parent.id);
      let aiText='';
      if(type==='feedback'){
        const {system,user}=PROMPTS.feedbackChat(parent.title,parent.body,S.challenge,msg);
        aiText=await callClaude([...history,{role:'user',content:user}],system);
        const idx=parent.extras.length;
        parent.extras.push({type:'feedback',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        appendToChat(makeFeedbackBubble(aiText,parent.id,idx));
        queueSync();
      } else {
        const sys=PROMPTS.clarificationChat(parent.title,parent.body,S.challenge);
        aiText=await callClaude([...history,{role:'user',content:msg}],sys);
        const idx=parent.extras.length;
        parent.extras.push({type:'clarification',userPrompt:msg,aiResponse:aiText,ts:Date.now()});
        appendToChat(makeMsgBubble('assistant',aiText,parent.id,idx));
        queueSync();
      }
    }
  }catch(e){ appendToChat(makeMsgBubble('assistant','Error: '+e.message)); }
  finally{ setChatThinking(false); }
}
