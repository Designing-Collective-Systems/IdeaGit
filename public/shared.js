// ============================================================
//  IdeaGit — Shared Utilities (included by all conditions)
// ============================================================

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
  const roots=S.nodes.filter(n=>!n.parentId&&n.title);
  if(!roots.length) return '';
  return '\n\nExisting ideas (do NOT repeat):\n'+
    roots.map((n,i)=>`${i+1}. "${n.title}" — ${n.body.slice(0,100)}`).join('\n');
}

// ── Ideas list ────────────────────────────────────────────────
function getDisplayIdeas(){
  const finalized=S.nodes.filter(n=>n.isFinalized);
  const parentIds=new Set(S.nodes.map(n=>n.parentId).filter(Boolean));
  // In-progress: leaf nodes that are not finalized
  const ongoing=S.nodes.filter(n=>!parentIds.has(n.id)&&!n.isFinalized&&n.title);
  // Unfinalized: nodes that WERE finalized (isFinalized=false) but have children,
  // so they're not leaves — they'd otherwise be invisible
  const ongoingIds=new Set(ongoing.map(n=>n.id));
  const finalizedIds=new Set(finalized.map(n=>n.id));
  const unfinalized=S.nodes.filter(n=>
    !n.isFinalized && n.title &&
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
  card.innerHTML=`
    <div class="idea-card-badge ${status==='finalized'?'badge-finalized':'badge-ongoing'}">
      ${status==='finalized'?'Finalized':'In Progress'}
    </div>
    <div class="idea-card-title">${esc(node.title)}</div>
    <div class="idea-card-body">${esc(node.body)}</div>`;
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

function renderTreeInto({svgId,nodesId,emptyId,labelId,canvasId,onNodeClick}){
  const nodesEl=document.getElementById(nodesId);
  const svg=document.getElementById(svgId);
  const emptyEl=document.getElementById(emptyId);
  if(!nodesEl||!svg) return;
  nodesEl.innerHTML=''; svg.innerHTML='';
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
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--purple)':
                    tc==='t-creation'?'var(--blue)':tc==='t-manual'?'var(--amber)':'var(--teal)';
    const el=document.createElement('div');
    el.className=`tree-node ${tc}${isCur?' current':''}`;
    el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    el.innerHTML=`<div class="tree-node-inner"><div class="tree-node-type" style="color:${typeColor}">${typeLabel}</div><div class="tree-node-title">${esc(node.title||'(untitled)')}</div></div>`;
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
function buildNodesCSV(){
  const hdr=['node_id','group_id','parent_id','type','tag','title','body',
             'is_finalized','user_prompt','ai_response','timestamp','extras_json'];
  const rows=S.nodes.map(n=>[
    n.id,n.groupId,n.parentId||'',n.type,n.tag,
    csvC(n.title),csvC(n.body),n.isFinalized?'1':'0',
    csvC(n.userPrompt),csvC(n.aiResponse),
    new Date(n.ts).toISOString(), csvC(JSON.stringify(n.extras))
  ].join(','));
  return [hdr.join(','),...rows].join('\n');
}
function exportCSV(){
  if(!S.nodes.length){ toast('Nothing to export yet.'); return; }
  dlFile(buildNodesCSV(),`ideagit_c${S.condition}_nodes_${dstamp()}.csv`,'text/csv');
  toast('Exported','var(--green)');
}

// ── Navigation ─────────────────────────────────────────────────
function goHome(){
  if(S.nodes.length&&!confirm('Go back? Export first if you want to save.')) return;
  window.location.href='/';
}

// ── Instructions ───────────────────────────────────────────────
function openInstructions(){
  document.getElementById('instructions-head').textContent=`Instructions — Condition ${S.condition}`;
  document.getElementById('instructions-content').innerHTML=window.CONDITION_INSTRUCTIONS||'';
  document.getElementById('instructions-modal').style.display='flex';
}
function closeInstructions(){ document.getElementById('instructions-modal').style.display='none'; }

// ── Setup page ─────────────────────────────────────────────────
function onChallengeInput(){
  const v=document.getElementById('challenge-input').value.trim();
  document.getElementById('start-btn').disabled=v.length===0;
}

// ── Done / Finalize tracking ──────────────────────────────────
function finalizedCount(){ return S.nodes.filter(n=>n.isFinalized).length; }
function updateFinalizedCounter(){
  const el=document.getElementById('nav-finalized-count');
  if(el) el.textContent=`${finalizedCount()} / 3 finalized`;
}
function checkThreeDone(){
  if(finalizedCount()>=3){
    document.getElementById('done-count').textContent=finalizedCount();
    document.getElementById('done-popup').style.display='flex';
  }
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
  const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
  if(!finalized.length) return;
  _srPage=0; _srCurrentIdea=0;
  _srSubTab=isCondition4()?'tree':'chat';
  const tabs=document.getElementById('sr-idea-tabs'); if(!tabs) return;
  tabs.innerHTML='';
  finalized.forEach((n,i)=>{
    const btn=document.createElement('button'); btn.className='sr-idea-tab'+(i===0?' sr-idea-active':'');
    btn.textContent=`Idea ${i+1}`; btn.onclick=()=>srSelectIdea(i,finalized); tabs.appendChild(btn);
    const t=document.getElementById(`sr-title-${i}`); if(t) t.textContent=n.title;
    const cb=document.getElementById(`sr-contrib-${i}`); if(cb) cb.innerHTML=srContribOptions(i);
  });
  const subTabs=document.getElementById('sr-sub-tabs');
  if(subTabs) subTabs.style.display=isAICondition()?'flex':'none';
  const treeTab=document.getElementById('sr-tab-tree');
  if(treeTab) treeTab.style.display=isCondition4()?'':'none';
  const srLeft=document.getElementById('sr-left');
  if(srLeft) srLeft.style.display=isAICondition()?'flex':'none';
  srUpdateStep(); srSelectIdea(0,finalized); srShowPage(0); srSubTab(_srSubTab);
  document.getElementById('self-report-modal').style.display='flex';
}
function srContribOptions(idx){
  return [['created','Created the initial idea'],['minor-mod','Made minor modifications (do not affect overall functionality)'],
    ['major-mod','Made major modifications (affect overall functionality)'],['prompts','Provided detailed prompts to help AI'],
    ['none','Did not contribute to this idea']].map(([v,l])=>
    `<label class="sr-option"><input type="checkbox" name="contrib-${idx}" value="${v}"> ${l}</label>`).join('');
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
    const path=getPath(node.id); let html='<div class="sr-chat-history">';
    path.forEach(n=>{
      if(n.type==='creation') html+=`<div class="sr-idea-bubble"><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`;
      else if(n.type==='modification'){
        if(n.userPrompt) html+=`<div class="sr-msg-user">${esc(n.userPrompt)}</div>`;
        html+=`<div class="sr-idea-bubble"><em>${n.tag==='manual-modification'?'Manual edit':'AI modified'}</em><br><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`;
      }
      n.extras.forEach(ex=>{
        if(ex.userPrompt) html+=`<div class="sr-msg-user">${esc(ex.userPrompt)}</div>`;
        if(ex.aiResponse) html+=`<div class="sr-msg-ai">${esc(ex.aiResponse)}</div>`;
      });
    });
    disp.innerHTML=html+'</div>';
  } else {
    disp.innerHTML='<div style="width:100%;height:100%;position:relative;overflow:auto;background:var(--bg)"><div id="sr-tree-inner" style="position:relative"><svg id="sr-tree-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg><div id="sr-tree-nodes"></div></div></div>';
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
    const typeColor=node.isFinalized?'var(--green)':tc==='t-ai-create'?'var(--purple)':
                    tc==='t-creation'?'var(--blue)':tc==='t-manual'?'var(--amber)':'var(--teal)';
    const el=document.createElement('div');
    el.className=`tree-node ${tc}`; el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.width=W+'px';
    el.innerHTML=`<div class="tree-node-inner" style="padding:7px 9px"><div class="tree-node-type" style="color:${typeColor};font-size:10px">${node.isFinalized?'Finalized':node.type}</div><div class="tree-node-title" style="font-size:12px">${esc(node.title||'(untitled)')}</div></div>`;
    nodesEl.appendChild(el);
  });
}
function srSubTab(tab){
  _srSubTab=tab;
  document.getElementById('sr-tab-chat')?.classList.toggle('sr-sub-active',tab==='chat');
  document.getElementById('sr-tab-tree')?.classList.toggle('sr-sub-active',tab==='tree');
  const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
  srRenderContent(finalized[_srCurrentIdea]);
}
function srToggleB(show){ const el=document.getElementById('sr-q-b'); if(el) el.style.display=show?'block':'none'; }
function toggleOtherBox(cb){ const ta=document.getElementById('ai-for-other'); if(ta){ ta.style.display=cb.checked?'block':'none'; if(cb.checked) ta.focus(); } }
function srUpdateStep(){
  const total=isAICondition()?4:3;
  const el=document.getElementById('sr-step-indicator'); if(el) el.textContent=`Step ${_srPage+1} of ${total}`;
}
function srShowPage(n){
  _srPage=n;
  [0,1,2,3].forEach(i=>{ const el=document.getElementById(`sr-page-${i}`); if(el) el.style.display='none'; });
  const t=document.getElementById(`sr-page-${n}`); if(t) t.style.display='block';
  if(n>=1){ const f=S.nodes.filter(nd=>nd.isFinalized).slice(0,3); srSelectIdea(n-1,f); }
  srUpdateStep();
}
function srNext(){ const t=isAICondition()?4:3; if(_srPage<t-1) srShowPage(_srPage+1); }
function srPrev(){ if(_srPage>0) srShowPage(_srPage-1); }
function srSubmit(){
  const aiUsed=document.querySelector('input[name="ai-used"]:checked')?.value||'n/a';
  const aiFor=Array.from(document.querySelectorAll('input[name="ai-for"]:checked')).map(c=>c.value);
  const aiOtherTa=document.getElementById('ai-for-other');
  const aiOther=aiOtherTa&&aiOtherTa.style.display!=='none'?aiOtherTa.value.trim():'';
  if(aiOther) aiFor.push('other:'+aiOther);
  const contributions=[];
  [0,1,2].forEach(i=>{ contributions.push(Array.from(document.querySelectorAll(`input[name="contrib-${i}"]:checked`)).map(c=>c.value)); });
  document.getElementById('self-report-modal').style.display='none';
  toast('Exporting…','var(--green)');
  dlFile(buildNodesCSV(),`ideagit_c${S.condition}_nodes_${dstamp()}.csv`,'text/csv');
  setTimeout(()=>{
    const finalized=S.nodes.filter(n=>n.isFinalized).slice(0,3);
    const hdr=['condition','ai_used','ai_for','idea_1_title','idea_1_contrib','idea_2_title','idea_2_contrib','idea_3_title','idea_3_contrib'];
    const row=[S.condition,aiUsed,csvC(aiFor.join('|')),
      csvC(finalized[0]?.title||''),csvC(contributions[0].join('|')),
      csvC(finalized[1]?.title||''),csvC(contributions[1].join('|')),
      csvC(finalized[2]?.title||''),csvC(contributions[2].join('|'))];
    dlFile([hdr.join(','),row.join(',')].join('\n'),`ideagit_c${S.condition}_self_report_${dstamp()}.csv`,'text/csv');
    toast('Both files exported. You may now close the page.','var(--green)');
  },800);
}

// Called when a node is unfinalized — marks it so it stays visible in the list
function markUnfinalized(nodeId){
  const node=S.nodes.find(n=>n.id===nodeId); if(!node) return;
  node.isFinalized=false;
  node.meta=node.meta||{};
  node.meta._wasFinalized=true;
}
