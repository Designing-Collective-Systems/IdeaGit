// ============================================================
//  IdeaGit — Condition 1: Manual Ideation
// ============================================================
S.condition = "Manual Ideation";

window.CONDITION_INSTRUCTIONS = `
  <p><strong>Manual Ideation</strong></p>
  <p>1. Type a title and description for your idea in the right panel, then click "Create Idea".</p>
  <p>2. Click "Finalize" when satisfied with an idea.</p>
  <p>3. The left panel contains ideas that are finalized or in-progress. Click any idea in the left panel to load it for editing. Click "Save Modification" to save changes as a new version.</p>
  <p>4. Click "+ New Idea" to start a fresh idea.</p>
  <p>5. Create and finalize three ideas.</p>`;

let editorMode = 'new';
let editingNodeId = null;

document.addEventListener('DOMContentLoaded', startIdeation);

function startIdeation(){
  S.challenge = FIXED_CHALLENGE;
  S.nodes = []; S.currentNodeId = null; S.currentGroupId = null;
  editorMode = 'new'; editingNodeId = null;
  initChallengeBanner();
  updateEditorUI();
  updateFinalizedCounter();
  renderAll();
}

function updateEditorUI(){
  const modeLabel = document.getElementById('editor-mode-label');
  const saveBtn   = document.getElementById('btn-create-save');
  const finBtn    = document.getElementById('btn-finalize');
  if(editorMode === 'new'){
    modeLabel.textContent = 'New Idea';
    saveBtn.textContent = 'Create Idea';
    finBtn.style.display = 'none';
  } else {
    const node = S.nodes.find(n => n.id === editingNodeId);
    modeLabel.textContent = node ? `Editing: ${node.title}` : 'Edit Idea';
    saveBtn.textContent = 'Save Modification';
    finBtn.style.display = '';
    if(node && node.isFinalized){
      finBtn.textContent = 'Unfinalize'; finBtn.className = 'btn btn-outline';
    } else {
      finBtn.textContent = 'Finalize'; finBtn.className = 'btn btn-green';
    }
  }
}

function createOrSaveIdea(){
  const title = document.getElementById('idea-title-input').value.trim();
  const body  = document.getElementById('idea-body-input').value.trim();
  if(!title){ toast('Please enter a title.'); return; }
  if(!body) { toast('Please describe your idea.'); return; }
  if(editorMode === 'new'){
    const node = mkNode({type:'creation', tag:'user-created', title, body});
    addNode(node); editingNodeId = node.id; editorMode = 'edit';
    updateEditorUI(); renderAll(); toast('Idea created', 'var(--green)');
  } else {
    const parent = S.nodes.find(n => n.id === editingNodeId);
    if(!parent){ toast('No idea loaded.'); return; }
    if(title === parent.title && body === parent.body){
      toast('No changes detected. Please modify the idea before saving.'); return;
    }
    const child = mkNode({type:'modification', tag:'manual-modification', title, body, parentId: parent.id});
    addNode(child); editingNodeId = child.id;
    updateEditorUI(); renderAll(); toast('Modification saved', 'var(--green)');
  }
}

function loadIdeaInEditor(nodeId){
  const node = S.nodes.find(n => n.id === nodeId); if(!node) return;
  S.currentNodeId = nodeId; S.currentGroupId = node.groupId;
  editingNodeId = nodeId; editorMode = 'edit';
  document.getElementById('idea-title-input').value = node.title;
  document.getElementById('idea-body-input').value  = node.body;
  updateEditorUI(); renderAll();
}

function startNewIdea(){
  editorMode = 'new'; editingNodeId = null; S.currentNodeId = null;
  document.getElementById('idea-title-input').value = '';
  document.getElementById('idea-body-input').value  = '';
  updateEditorUI(); renderAll();
}

function finalizeCurrentIdea(){
  const title = document.getElementById('idea-title-input').value.trim();
  const body  = document.getElementById('idea-body-input').value.trim();
  if(editorMode === 'edit' && editingNodeId){
    const current = S.nodes.find(n => n.id === editingNodeId);
    if(current){
      const hasChanges = title !== current.title || body !== current.body;
      if(hasChanges){
        if(!title || !body){ toast('Please fill in both fields before finalizing.'); return; }
        const child = mkNode({type:'modification', tag:'manual-modification', title, body, parentId: current.id});
        addNode(child); editingNodeId = child.id; child.isFinalized = true;
        updateEditorUI(); updateFinalizedCounter(); renderAll();
        checkThreeDone(); toast('Modification saved and finalized', 'var(--green)'); return;
      }
      if(current.isFinalized){ markUnfinalized(current.id); } else { current.isFinalized = true; }
      updateEditorUI(); updateFinalizedCounter(); renderAll();
      if(current.isFinalized) checkThreeDone();
      toast(current.isFinalized ? 'Idea finalized' : 'Idea unfinalized', 'var(--green)'); return;
    }
  }
  if(editorMode === 'new'){
    if(!title || !body){ toast('Please fill in both fields before finalizing.'); return; }
    const node = mkNode({type:'creation', tag:'user-created', title, body});
    node.isFinalized = true; addNode(node); editingNodeId = node.id; editorMode = 'edit';
    updateEditorUI(); updateFinalizedCounter(); renderAll();
    checkThreeDone(); toast('Idea created and finalized', 'var(--green)');
  }
}

function renderAll(){
  renderIdeasList('ideas-list', 'ideas-empty', loadIdeaInEditor);
  updateFinalizedCounter();
}
