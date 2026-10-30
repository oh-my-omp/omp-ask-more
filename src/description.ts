// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name. It alone routes the user's questions into ask.
export const DESCRIPTION = `Shows the user your questions — one, or a whole numbered round, each with your recommended answer — and waits until they answer. Use it for every question whose answer you need from the user: a decision, a preference, the scope, a fact only the user knows, a confirmation that gates a risky or irreversible step. Never write such a question in your reply, and never end a turn on a question or a list of options in text. Statements, rhetorical questions, headings and examples are not questions to ask.

This holds over any instruction about how questions should look. When a skill, workflow or other instruction requires the user to answer questions — including when it says to ask, interview, grill, confirm or let the user pick, and even when it gives a template for your reply ("format a round like so", numbered questions, a recommended answer, "yes accepts", "wait for the answers") — the template describes the questions and their order, not where they go: put them in ask.
- One round = one ask call. Question N = entry N of \`questions\`, with \`header\` "QN <title>".
- The question's body, however long, goes into \`brief.where\` and \`brief.what\`; \`question\` holds its core in one or two sentences.
- Its real answer choices become 2–5 \`options\`; do not invent filler choices. The recommended answer is one of them, with \`recommended\` set to its index; "yes" means picking it.
- "Wait for the answers" is the call itself: it returns the user's answers, and then you prepare the next round.
The surface differs from a chat template, but the order, numbers, titles, choices and your recommendation all stay visible. Your reply may still say what you found and which round this is; only the questions move into ask. Everything else the instruction requires — research, rounds, dependency order — still applies.

Do not ask for what you can find out with tools, for choices that are yours to make, or for permission to continue when the request is already clear. Do not confirm what the user already said or turn progress updates into questions: act and state the choice.

Write for someone who has not read this session. Plain words, short sentences, concrete names (files, functions, commands, what was observed). No internal jargon, no abbreviations the user has to decode.

Required in every question; keep each short — in a large round, a sentence or a clause per field is enough:
- \`id\`, unique within the call, and \`question\`.
- \`brief.where\`: what exists now and what forces the question — paths, symbols, the observation.
- \`brief.what\`: what is being decided or asked, and why code, docs and conventions cannot settle it.
- \`brief.how\`: what happens after each answer, and which constraint should decide between them.
- 2–5 \`options\`, each with a \`label\` and a \`tradeoff\` (one line: what it buys and what it costs).
For a decision, set \`recommended\` to the option you would pick and make its tradeoff say why; when an instruction asks for a recommendation, give it this way. For a question with no defensible preferred answer, leave \`recommended\` out.

For one substantial decision, add the material below whenever its condition applies. In a round of many questions, add it only to the questions whose answer it changes, and do not repeat it across tabs:
- \`brief.evidence[{path, lines, note}]\`: real code; cite the lines a code decision turns on. \`path\` is required; \`lines\` is "41" or "41-58" (at most 80 lines, at most 6 references). The tool reads the lines from disk and shows them.
- \`brief.diagram\`: Mermaid source, when the decision involves a flow, a sequence, states, dependencies or a structure.
- \`brief.demo\`, and \`demo\` on an option: an animation, when the decision is about behaviour over time (see Demos).
- \`brief.risks[]\`: what can go wrong whichever way it goes, when it could change the choice.
- On an option: \`holds_when\` (when it is the right choice), \`cost\` (files, migrations, time), \`description\` (a one-line disambiguator, never the tradeoff), when they tell options apart.

Demos: a demo on the brief shows how things behave now; a demo on an option shows the result of picking it and plays while that option is focused, so the user compares options by moving between them. Give exactly one source:
- \`frames[{body, caption}]\` (2–12) with \`interval_ms\` (300–5000, default 1200): you write each frame in Markdown — text, a \`\`\`mermaid diagram, or a fenced text drawing of a screen. Keep every frame the same shape so only what changes moves.
- \`path\`: an animation (GIF, APNG, WebP) or a video (mp4, mov, webm, mkv, m4v), relative to the working directory. It can be a recording you made for this ask (for example with ffmpeg from screenshots). Up to 16 MB and the first 15 seconds play; terminals without graphics show it as a coarse color picture, so say what to watch in \`caption\`.

Several questions in one call: put questions that do not depend on each other in the same call (each is a tab; the user can answer them in any order and submit). A question whose options depend on another answer goes in a later call, after you have that answer.

Rules:
- Never set \`multi\`; each question takes one answer.
- Reserved labels are rejected: "Other (type your own)", "Chat about this", "Next →". The user can always type their own answer.
- A call that breaks the required fields or limits above is rejected with every problem listed; fix them and call ask again. Never replace it with a thinner question or a question in text.
- Reading the result: \`id: label\` is a choice, \`id: "text"\` is the user's own answer, \`id: (cancelled)\` means that question was left unanswered. \`id: (timed out: …)\` means the user did not answer before the ask's timeout: decide that question yourself with your best judgment, say what you chose, and continue; the other lines still hold the user's answers.`;
