// The model-facing tool description. It replaces the native `prompts/tools/ask.md` because this
// tool is registered under the native name.
export const DESCRIPTION = `Ask the user one decision, with the context needed to answer it without rereading the session.

Every question carries a \`brief\`:
- \`where\`: what exists now — paths, symbols, the observation that forces the decision.\n- \`what\`: the decision, and why code, docs and conventions cannot make it.\n- \`how\`: what happens after each answer, and which constraint decides it.\n- optional \`evidence[{path, lines, note}]\`: the tool reads the real file lines; \`lines\` is "41" or "41-58".\n- optional \`diagram\`: Mermaid source.\n- optional \`risks[]\`.

Every option carries \`tradeoff\` (one line: what it buys and what it costs), \`holds_when\` (the condition under which it is right) and \`cost\` (files, migrations, time). \`description\` is a one-line disambiguator — never put the tradeoff there.

Rules:
- One question per call, 2–5 options, no \`multi\`.
- Reserved labels are rejected: "Other (type your own)", "Chat about this", "Next →".
- A call missing the brief or any option's tradeoff is rejected with every missing field; fix them and call again. Do not replace it with a thinner question.
- Ask only when the answer is genuinely the user's to make. Otherwise act, and state the choice.`;
