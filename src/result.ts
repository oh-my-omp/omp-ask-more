import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { OTHER_LABEL } from "@oh-my-pi/pi-coding-agent/tools/html-form/data";
import { parseHtmlForm, spansText } from "@oh-my-pi/pi-coding-agent/tools/html-form/parse";
import type { AskQuestion } from "./schema.ts";

const NO_ANSWER = "(no answer)";
const TIMED_OUT = "(timed out: the user did not answer; decide it yourself with your best judgment and say what you chose)";
const OTHER_PREFIX = `${OTHER_LABEL}: `;

export type LabelMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

function shown(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function labelMap(html: string): LabelMap {
	const fields = new Map<string, Map<string, string>>();
	for (const field of parseHtmlForm(html).fields) {
		if (field.kind !== "choice") continue;
		fields.set(field.name, new Map(field.options.map((option) => [shown(spansText(option.label)), option.value])));
	}
	return fields;
}

function answerLine(id: string, answer: string | undefined, blank: string): string {
	if (answer === undefined || answer.length === 0) return `${id}: ${blank}`;
	if (answer.startsWith(OTHER_PREFIX)) return `${id}: ${JSON.stringify(answer.slice(OTHER_PREFIX.length))}`;
	return `${id}: ${answer}`;
}

export function answeredResult(
	questions: readonly AskQuestion[],
	labels: LabelMap,
	result: AgentToolResult<AskToolDetails>,
): AgentToolResult<AskToolDetails> {
	if (result.isError === true || result.details === undefined) return result;
	const answers = result.details.answers.map((answer) => ({
		...answer,
		answer: labels.get(answer.name)?.get(answer.answer) ?? answer.answer,
	}));
	const mappedNotes = result.details.notes?.map((note) => ({ ...note, option: note.value }));
	const details: AskToolDetails = { ...result.details, answers, ...(mappedNotes === undefined ? {} : { notes: mappedNotes }) };
	const byName = new Map(answers.map((answer) => [answer.name, answer.answer]));
	const blank = details.timedOut === true ? TIMED_OUT : NO_ANSWER;
	const lines = questions.map((question) => answerLine(question.id, byName.get(question.id), blank));
	const notes = (details.notes ?? []).map((note) => `- ${note.name}: ${note.option} — ${note.text.replace(/\s+/g, " ").trim()}`);
	const text = [`User answers:`, ...lines, ...(notes.length > 0 ? ["Option notes:", ...notes] : [])].join("\n");
	const [, ...rest] = result.content;
	return { ...result, content: [{ type: "text", text }, ...rest], details };
}

export function rejectedResult(problems: readonly string[]): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map((problem) => `- ${problem}`).join("\n")}` }],
		details: { answers: [] },
		isError: true,
	};
}
