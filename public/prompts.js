// IdeaGit — Prompts

const PROMPTS = {

  // `editable` is shown to the user to confirm/edit before sending.
  // `hiddenSuffix` (response-format instructions) is never shown, always appended.
  generateIdea: (challenge, existingIdeas='') => {
    const editable = `Generate a creative design idea for this challenge.

Challenge: "${challenge}"${existingIdeas}`;
    const hiddenSuffix = `

Return ONLY valid JSON, no markdown:
{"title":"concise idea title (max 8 words)","body":"clear 2–4 sentence description of what it is, how it works, and why it addresses the challenge."}`;
    return {
      system: 'You are a creative design thinking assistant. Generate original, specific, feasible design ideas. Every idea must be meaningfully different from any listed.',
      editable, hiddenSuffix, user: editable + hiddenSuffix,
    };
  },

  modifyIdeaChat: (currentTitle, currentBody, challenge, request, recentContext='') => ({
    system: 'You are a design thinking assistant. Modify the given idea based on the user request. Preserve the core concept unless the user asks for a completely different direction. Use the recent conversation, if given, to understand what the user is referring to. Return ONLY valid JSON, no markdown.',
    user: `Current idea:
Title: "${currentTitle}"
Description: "${currentBody}"

Challenge: "${challenge}"${recentContext}

Modification request: "${request}"

Return ONLY valid JSON:
{"title":"revised title (max 8 words)","body":"revised description (2–4 sentences)"}`
  }),

  feedbackChat: (title, body, challenge, question) => ({
    system: 'You are a design thinking expert. Give concise, constructive, specific feedback in 3–5 sentences. Be direct and actionable.',
    user: `Idea: "${title}" — ${body}
Challenge: "${challenge}"
User asks: "${question}"

Give direct, specific feedback in 3–5 sentences.`
  }),

  clarificationChat: (title, body, challenge) =>
    `You are a design thinking assistant helping develop the idea: "${title}". The design challenge is: "${challenge}". Be helpful, concise, and direct. Answer the user's question without modifying the idea unless explicitly asked.`,

  // Used only when keyword matching can't tell modification/feedback/clarification apart.
  classifyIntent: (title, body, challenge, msg) =>
    `Classify the user's message about a design idea into exactly one category: modification, feedback, or clarification.
Idea: "${title}" — ${body}
Challenge: "${challenge}"
User message: "${msg}"
- modification: the user wants the idea itself changed or updated.
- feedback: the user wants an evaluation or opinion, without changing the idea.
- clarification: a general question that isn't a change or evaluation request.
Reply with exactly one word: modification, feedback, or clarification.`,

};
