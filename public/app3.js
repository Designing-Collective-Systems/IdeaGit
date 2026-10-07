// ============================================================
//  IdeaForest — Condition 3: AI-Assisted Ideation (2 panels)
// ============================================================
S.condition = "AI-Assisted Ideation";
S.studyCondition = "AI_only"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has two panels';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid instructions-grid-2">
    <div class="instructions-col"><div class="instr-text"><strong>Panel one (left):</strong> An AI chat panel where you can brainstorm with AI</div><div class="instr-arrow instr-arrow-left">&#8592;</div></div>
    <div class="instructions-col"><div class="instr-text"><strong>Panel two (right):</strong> A current ideas panel that tracks different in-progress or finalized ideas</div><div class="instr-arrow instr-arrow-right">&#8594;</div></div>
  </div>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
// Summary opens first; the design-challenge Details open when it is closed (this one time only).
function onStudyBegin(){ startIdeation(); _detailsAfterSummary=true; openInstructions(); }
