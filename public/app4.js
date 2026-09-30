// ============================================================
//  IdeaGit — Condition 4: AI-Assisted Structured Ideation
// ============================================================
S.condition = "AI-Assisted Structured Ideation";
S.studyCondition = "IdeaGit"; // value stored in the database's study_condition column

window.CONDITION_INSTRUCTIONS = `
  <p>IdeaGit has three components</p>
  <ol>
    <li>An AI chat panel where you can brainstorm with AI</li>
    <li>An idea tree panel that tracks how your ideas evolve</li>
    <li>A current ideas panel that tracks different in-progress or finalized ideas</li>
  </ol>`;

// The landing page collects the participant ID first; the ideation screen starts once they begin.
document.addEventListener('DOMContentLoaded', initLanding);
function onStudyBegin(){ startIdeation(); openInstructions(); }
