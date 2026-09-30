// ============================================================
//  IdeaGit — Condition 4: AI-Assisted Structured Ideation
// ============================================================
S.condition = "AI-Assisted Structured Ideation";
S.studyCondition = "IdeaGit"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS = `
  <p class="instructions-heading">IdeaGit has three components</p>
  <div class="instructions-grid instructions-grid-3">
    <div class="instructions-col">A current ideas panel that tracks different in-progress or finalized ideas</div>
    <div class="instructions-col">An AI chat panel where you can brainstorm with AI</div>
    <div class="instructions-col">An idea tree panel that tracks how your ideas evolve</div>
  </div>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
function onStudyBegin(){ startIdeation(); openInstructions(); }
