import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { OTHER_LABEL } from "@oh-my-pi/pi-tui/html-form/data";
import type { AskQuestion } from "./schema.ts";

const NO_ANSWER = "(no answer)";
const TIMED_OUT = "(timed out: the user did not answer; decide it yourself with your best judgment and say what you chose)";
const OTHER_PREFIX = `${OTHER_LABEL}: `;

function answerLine(id: string, answer: string | undefined, blank: string): string {
	if (answer === undefined || answer.length === 0) return `${id}: ${blank}`;
	if (answer.startsWith(OTHER_PREFIX)) return `${id}: ${JSON.stringify(answer.slice(OTHER_PREFIX.length))}`;
	return `${id}: ${answer}`;
}

export function answeredResult(
	questions: readonly AskQuestion[],
	result: AgentToolResult<AskToolDetails>,
): AgentToolResult<AskToolDetails> {
	const { details } = result;
	if (result.isError === true || details === undefined) return result;
	const byName = new Map(details.answers.map((answer) => [answer.name, answer.answer]));
	const blank = details.timedOut === true ? TIMED_OUT : NO_ANSWER;
	const lines = questions.map((question) => answerLine(question.id, byName.get(question.id), blank));
	const notes = (details.notes ?? []).map((note) => `- ${note.name}: ${note.option} — ${note.text.replace(/\s+/g, " ").trim()}`);
	const text = [`User answers:`, ...lines, ...(notes.length > 0 ? ["Option notes:", ...notes] : [])].join("\n");
	const [, ...rest] = result.content;
	return { ...result, content: [{ type: "text", text }, ...rest] };
}

export function rejectedResult(problems: readonly string[]): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map((problem) => `- ${problem}`).join("\n")}` }],
		details: { answers: [] },
		isError: true,
	};
}
