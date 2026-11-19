// The host's `ask` answers the compiled form; this module rewrites the text the model reads and keeps
// everything else of the host's result: `details` (`{answers, notes?, timedOut?}`, which the host's
// ask card draws), and the image blocks of pasted option notes with their source notices.
//
// The text is one line per question in input order, the contract `xd://ask/results` describes:
// `id: label` for an option, `id: "text"` for the user's own answer (the host reports it as
// `Other: text`; no option label may start with Other, `src/schema.ts`), and for a question left
// blank `id: (no answer)`, or `id: (timed out: …)` when the host's timeout closed the form. Nothing
// is preselected, so a blank answer after a timeout is a question the user never reached, and the
// model decides it. The option notes follow, as the host words them.
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { OTHER_LABEL } from "@oh-my-pi/pi-tui/html-form/data";
import type { AskQuestion } from "./schema.ts";

const NO_ANSWER = "(no answer)";
const TIMED_OUT = "(timed out: the user did not answer; decide it yourself with your best judgment and say what you chose)";
const OTHER_PREFIX = `${OTHER_LABEL}: `;

/** One host answer as the model reads it. */
function answerLine(id: string, answer: string | undefined, blank: string): string {
	if (answer === undefined || answer.length === 0) return `${id}: ${blank}`;
	if (answer.startsWith(OTHER_PREFIX)) return `${id}: ${JSON.stringify(answer.slice(OTHER_PREFIX.length))}`;
	return `${id}: ${answer}`;
}

/** The host's result with the model's text in this plugin's wording; `details` and image blocks unchanged. */
export function answeredResult(
	questions: readonly AskQuestion[],
	result: AgentToolResult<AskToolDetails>,
): AgentToolResult<AskToolDetails> {
	const { details } = result;
	// A host error (an unparsable form) carries no answers: the model reads it as the host wrote it.
	if (result.isError === true || details === undefined) return result;
	const byName = new Map(details.answers.map((answer) => [answer.name, answer.answer]));
	const blank = details.timedOut === true ? TIMED_OUT : NO_ANSWER;
	const lines = questions.map((question) => answerLine(question.id, byName.get(question.id), blank));
	const notes = (details.notes ?? []).map((note) => `- ${note.name}: ${note.option} — ${note.text.replace(/\s+/g, " ").trim()}`);
	const text = [`User answers:`, ...lines, ...(notes.length > 0 ? ["Option notes:", ...notes] : [])].join("\n");
	// The host's first block is its own answer text; the rest are the notes' images and their notices.
	const [, ...rest] = result.content;
	return { ...result, content: [{ type: "text", text }, ...rest] };
}

/** A refused ask: the model gets every problem at once and calls again. */
export function rejectedResult(problems: readonly string[]): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map((problem) => `- ${problem}`).join("\n")}` }],
		details: { answers: [] },
		isError: true,
	};
}
