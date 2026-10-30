// Results keep the native shape: `AskToolDetails.results` (one entry per question, in input order)
// feeds `askToolRenderer`, and the content text matches the native multi-question wording
// (`User answers:` then `id: answer` per line) so the model reads the same answer either way.
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails, QuestionResult } from "@oh-my-pi/pi-coding-agent";
import type { AskQuestion } from "./schema.ts";

/** What the user gave one question. A cursor resting on an option is not an answer. */
export type Answer = { readonly kind: "unanswered" } | { readonly kind: "option"; readonly index: number } | { readonly kind: "custom"; readonly text: string };

export const UNANSWERED: Answer = { kind: "unanswered" };

function questionResult(question: AskQuestion, answer: Answer): QuestionResult {
	const base = {
		id: question.id,
		question: question.question,
		options: question.options.map(option => option.label),
		multi: false,
	};
	switch (answer.kind) {
		case "unanswered":
			return { ...base, selectedOptions: [] };
		case "option": {
			const label = question.options[answer.index]?.label;
			return { ...base, selectedOptions: label === undefined ? [] : [label] };
		}
		case "custom":
			return { ...base, selectedOptions: [], customInput: answer.text };
	}
}

/** What the model reads for a question left without an answer when the whole ask was submitted or cancelled. */
const CANCELLED = "(cancelled)";
/** What the model reads for a question left without an answer when the ask timed out. */
const TIMED_OUT = "(timed out: the user did not answer; decide it yourself with your best judgment)";

function answerText(result: QuestionResult, unanswered: string): string {
	if (result.customInput !== undefined) return `${result.id}: "${result.customInput}"`;
	const picked = result.selectedOptions[0];
	return `${result.id}: ${picked ?? unanswered}`;
}

function batchResult(questions: readonly AskQuestion[], answers: readonly Answer[], unanswered: string): AgentToolResult<AskToolDetails> {
	const results = questions.map((question, index) => questionResult(question, answers[index] ?? UNANSWERED));
	return {
		content: [{ type: "text", text: `User answers:\n${results.map(result => answerText(result, unanswered)).join("\n")}` }],
		details: { results },
	};
}

/** The submitted batch: every question in input order, unanswered ones included. */
export function answerResult(questions: readonly AskQuestion[], answers: readonly Answer[]): AgentToolResult<AskToolDetails> {
	return batchResult(questions, answers, CANCELLED);
}

/** The ask timed out: the answers given so far stand, and the model decides the rest. */
export function timedOutResult(questions: readonly AskQuestion[], answers: readonly Answer[]): AgentToolResult<AskToolDetails> {
	return batchResult(questions, answers, TIMED_OUT);
}

/** The whole ask was cancelled: no question carries an answer. */
export function cancelledResult(questions: readonly AskQuestion[]): AgentToolResult<AskToolDetails> {
	return answerResult(questions, []);
}

/** A refused ask: the model gets every problem at once and calls again. */
export function rejectedResult(problems: readonly string[]): AgentToolResult<Record<string, never>> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map(problem => `- ${problem}`).join("\n")}` }],
		details: {},
		isError: true,
	};
}
