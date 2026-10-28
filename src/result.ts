// Results keep the native shape: `AskToolDetails` feeds `askToolRenderer`, and the content text
// matches the native tool's wording so the model reads the same answer either way.
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails, QuestionResult } from "@oh-my-pi/pi-coding-agent";
import type { Submission } from "./component.ts";
import type { AskQuestion } from "./schema.ts";

function questionResult(question: AskQuestion, selectedOptions: readonly string[], customInput?: string): QuestionResult {
	const labels = question.options.map(option => option.label);
	return {
		id: question.id,
		question: question.question,
		options: labels,
		multi: question.multi ?? false,
		selectedOptions: [...selectedOptions],
		...(customInput === undefined ? {} : { customInput }),
	};
}

function answerText(result: QuestionResult): string {
	const custom = result.customInput === undefined ? undefined : `"${result.customInput}"`;
	if (result.selectedOptions.length === 0) {
		if (custom !== undefined) return `${result.id}: ${custom}`;
		return `${result.id}: (cancelled)`;
	}
	const picked = result.selectedOptions[0];
	return `${result.id}: ${custom === undefined ? picked : `${picked} + ${custom}`}`;
}

function resultFor(result: QuestionResult): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `User answers:\n${answerText(result)}` }],
		details: { results: [result] },
	};
}

export function answerResult(question: AskQuestion, submission: Submission): AgentToolResult<AskToolDetails> {
	if (submission.kind === "cancel") return cancelledResult(question);
	if (submission.kind === "other") return resultFor(questionResult(question, [], submission.text));
	const label = question.options[submission.index]?.label;
	return label === undefined ? cancelledResult(question) : resultFor(questionResult(question, [label]));
}

export function cancelledResult(question: AskQuestion): AgentToolResult<AskToolDetails> {
	return resultFor(questionResult(question, []));
}

/** A refused ask: the model gets every problem at once and calls again. */
export function rejectedResult(problems: readonly string[]): AgentToolResult<Record<string, never>> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map(problem => `- ${problem}`).join("\n")}` }],
		details: {},
		isError: true,
	};
}
