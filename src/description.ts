// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name. It alone routes the user's decisions into ask.
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
- \`demo\`: an animation of how things behave now (see Demos).
- \`risks[]\`: what can go wrong whichever way it goes.

Every option carries \`tradeoff\` (one line: what it buys and what it costs), \`holds_when\` (when it is the right choice) and \`cost\` (files, migrations, time). \`description\` is a one-line disambiguator, never the tradeoff. Set \`recommended\` to the option you would pick and make its tradeoff say why. An option may carry a \`demo\` of the result of picking it; it plays while that option is focused, so the user compares options by moving between them.

Demos: show a demo whenever the decision is about behaviour over time — a UI interaction, states a request goes through, before and after a change. Give exactly one source:
- \`frames[{body, caption}]\` (2–12) with \`interval_ms\` (300–5000, default 1200): you write each frame in Markdown — text, a \`\`\`mermaid diagram, or a fenced text drawing of a screen. Keep every frame the same shape so only what changes moves.
- \`path\`: an animation (GIF, APNG, WebP) or a video (mp4, mov, webm, mkv, m4v), relative to the working directory. It can be a recording you made for this ask (for example with ffmpeg from screenshots). Up to 16 MB and the first 15 seconds play; terminals without graphics show it as a coarse color picture, so say what to watch in \`caption\`.

Several questions in one call: put decisions that do not depend on each other in the same call (each question is a tab; the user can answer them in any order and submit). A decision whose options depend on another answer goes in a later call, after you have that answer.

Rules:
- Each question has 2–5 options and a unique \`id\`; no \`multi\`.
- Reserved labels are rejected: "Other (type your own)", "Chat about this", "Next →". The user can always type their own answer.
- A call missing a brief or any option's tradeoff is rejected with every problem listed; fix them and call again. Never replace it with a thinner question or a question in text.
- Reading the result: \`id: label\` is a choice, \`id: "text"\` is the user's own answer, \`id: (cancelled)\` means that question was left unanswered.`;
