// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name. The rule "a decision asked in chat is wrong" is the same
// rule omp-config's turn-judge enforces; keep the two worded alike.
export const DESCRIPTION = `Hand the user a decision. ask is the only way to put a decision to the user: anything that needs the user to choose — an approach, a tradeoff, a preference, the scope, a risky or irreversible step — goes through ask, never as a question in your reply. Ending a turn on a question or a list of options in text is wrong; call ask instead.

When a skill, workflow or other instruction tells you to ask the user, confirm with them, or let them pick, do it with ask. Everything else that instruction requires (research, implementation, verification) still applies.

Do not ask for what you can find out with tools, or for choices that are yours to make: act and state the choice.

Write for someone who has not read this session. Plain words, short sentences, concrete names (files, functions, commands, what was observed). No internal jargon, no abbreviations the user has to decode.

Every question carries a \`brief\`:
- \`where\`: what exists now and what forces the decision — paths, symbols, the observation.
- \`what\`: what is being decided, and why code, docs and conventions cannot settle it.
- \`how\`: what happens after each answer, and which constraint should decide it.
- \`evidence[{path, lines, note}]\`: real code. The tool reads the lines from disk and shows them; \`lines\` is "41" or "41-58" (at most 80 lines, at most 6 references). Cite the lines the decision is about whenever there are any.
- \`diagram\`: Mermaid source. Draw one whenever the decision involves a flow, a sequence, states, dependencies or a structure.
- \`risks[]\`: what can go wrong whichever way it goes.

Every option carries \`tradeoff\` (one line: what it buys and what it costs), \`holds_when\` (when it is the right choice) and \`cost\` (files, migrations, time). \`description\` is a one-line disambiguator, never the tradeoff. Set \`recommended\` to the option you would pick and make its tradeoff say why.

Several questions in one call: put decisions that do not depend on each other in the same call (each question is a tab; the user can answer them in any order and submit). A decision whose options depend on another answer goes in a later call, after you have that answer.

Rules:
- Each question has 2–5 options and a unique \`id\`; no \`multi\`.
- Reserved labels are rejected: "Other (type your own)", "Chat about this", "Next →". The user can always type their own answer.
- A call missing a brief or any option's tradeoff is rejected with every problem listed; fix them and call again. Never replace it with a thinner question or a question in text.
- Reading the result: \`id: label\` is a choice, \`id: "text"\` is the user's own answer, \`id: (cancelled)\` means that question was left unanswered.`;
