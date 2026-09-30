// ============================================================
//  IdeaGit — Condition 3: AI-Assisted Ideation
// ============================================================
S.condition = "AI-Assisted Ideation";
S.studyCondition = "AI_only"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS = `
  <p class="instructions-heading">IdeaGit has two components</p>
  <div class="instructions-grid instructions-grid-2">
    <div class="instructions-col">An AI chat panel where you can brainstorm with AI</div>
    <div class="instructions-col">A current ideas panel that tracks different in-progress or finalized ideas</div>
  </div>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
function onStudyBegin(){ startIdeation(); openInstructions(); }
