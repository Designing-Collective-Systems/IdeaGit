// IdeaGit — Prompts

const PROMPTS = {

  generateIdea: (challenge, existingIdeas='') => ({
    system: 'You are a creative design thinking assistant. Generate original, specific, feasible design ideas. Every idea must be meaningfully different from any listed.',
    user: `Generate a creative design idea for this challenge.

Challenge: "${challenge}"${existingIdeas}

Return ONLY valid JSON, no markdown:
{"title":"concise idea title (max 8 words)","body":"clear 2–4 sentence description of what it is, how it works, and why it addresses the challenge."}`
  }),

  modifyIdeaChat: (currentTitle, currentBody, challenge, request) => ({
    system: 'You are a design thinking assistant. Modify the given idea based on the user request. Preserve the core concept unless the user asks for a completely different direction. Return ONLY valid JSON, no markdown.',
    user: `Current idea:
Title: "${currentTitle}"
Description: "${currentBody}"

Challenge: "${challenge}"

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

};
