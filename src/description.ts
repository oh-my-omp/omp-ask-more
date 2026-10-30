// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name. It says what the tool does and when to use it; each
// field's meaning is in the parameter schema, and every limit is reported by validation.
export const DESCRIPTION = `Opens a full-screen dialog that puts your questions to the user and blocks until they answer. Each question is a tab with its brief and options; the cursor starts on your \`recommended\` option, so the user accepts your recommendation with Enter (the same as answering "yes"), picks another option, or types their own answer. The answers return as this tool's result, and you continue in the same turn.

You MUST put every question that needs the user's answer through \`ask\`: a decision, a preference, the scope, a fact only they know, a confirmation before a risky or irreversible step. NEVER write such questions in your reply, and NEVER end a turn on a question or a list of options in text. This holds when a skill, workflow or other instruction tells you to ask, interview, confirm or let the user choose, including when it says to ask in chat or prescribes how the questions should look in your reply. Such instructions assume there is no dialog; with \`ask\` available, calling it is how you follow them. Keep their content, order and recommendations, and carry them over:
- a question's number or short title → \`header\`;
- its background, code context and analysis → \`brief\`;
- its choices, or your recommendation and the alternatives → \`options\`, with \`recommended\` on the one you recommend;
- "wait for the answers before the next round" → the \`ask\` call itself, which returns them.
Everything else the instruction requires still applies.

Do not ask for what your tools can find out or for choices that are yours to make: act and state what you chose.

Write for someone who has not read this session. Put the independent questions of a round in one call, or one question per call when the instruction asks one at a time; a question whose options depend on an answer goes in a later call. A rejected call lists every problem: fix them and call \`ask\` again.

Each result line is \`id: label\` (a choice), \`id: "text"\` (the user's own answer), \`id: (cancelled)\` (unanswered), or \`id: (timed out: …)\`: no answer in time, so decide it yourself, state what you chose, and continue.`;
