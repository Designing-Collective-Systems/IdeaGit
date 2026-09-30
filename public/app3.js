// ============================================================
//  IdeaGit — Condition 3: AI-Assisted Ideation
// ============================================================
S.condition = "AI-Assisted Ideation";
S.studyCondition = "AI_only"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS = `
  <p>IdeaGit has two components</p>
  <ol>
    <li>An AI chat panel where you can brainstorm with AI</li>
    <li>A current ideas panel that tracks different in-progress or finalized ideas</li>
  </ol>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
function onStudyBegin(){ startIdeation(); openInstructions(); }
