// ============================================================
//  IdeaForest — Condition 3: AI-Assisted Ideation (2 panels)
// ============================================================
S.condition = "AI-Assisted Ideation";
S.studyCondition = "AI_only"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS_TITLE = 'IdeaForest has two panels';
window.CONDITION_INSTRUCTIONS = `
  <div class="instructions-grid instructions-grid-2">
    <div class="instructions-col"><div class="instr-text">The left panel that tracks<br>all ideas in-progress or finalized</div><div class="instr-arrow instr-arrow-left">&#8592;</div></div>
    <div class="instructions-col"><div class="instr-text">The right panel where<br>you can brainstorm with AI</div><div class="instr-arrow instr-arrow-right">&#8594;</div></div>
  </div>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
// Summary opens first; the design-challenge Details open when it is closed (this one time only).
function onStudyBegin(){ startIdeation(); _detailsAfterSummary=true; openInstructions(); }
