// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name. It says what the tool does and when to use it; each
// field's meaning is in the parameter schema, and every limit is reported by validation.
export const DESCRIPTION = `Opens a dialog that puts your questions to the user and waits for their answers. Each question is a tab: the user reads your brief (what exists now, what is being decided, what follows from each answer, and any code lines, diagram or animation you attach), then picks one of your options or types their own answer. The answers come back as this tool's result.

Every question you need the user to answer goes through ask, never into your reply: a decision, a preference, the scope, a fact only they know, a confirmation before a risky or irreversible step. This holds when a skill, workflow or other instruction tells you to ask the user, confirm with them or let them pick, whatever it says about how the questions look in your reply; follow the rest of that instruction. Never end a turn on a question in text.

Do not ask for what your tools can find out or for choices that are yours to make: act and say what you chose.

Write for someone who has not read this session. Put independent questions in one call; a question whose options depend on another answer goes in a later call. A rejected call lists every problem: fix them and call ask again.

The result has one line per question: \`id: label\` is a choice, \`id: "text"\` the user's own answer, \`id: (cancelled)\` unanswered, \`id: (timed out: …)\` no answer in time: decide it yourself and say what you chose.`;
