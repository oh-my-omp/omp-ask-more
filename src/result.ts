// Results carry the host's `AskToolDetails` shape: `details.answers` (one `{name, question,
// answer}` per question, in input order) feeds the host's `askToolRenderer`, so the transcript
// card draws each question and its answer. The content text is this plugin's own wording —
// `User answers:` then `id: …` per line — the contract `xd://ask/results` describes to the model.
// `timedOut` never appears: a resting cursor is not a preselection, so the host's "submitted
// preselected values" meaning would be a lie here; it survives only in delegated results.
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import type { FormAnswer } from "@oh-my-pi/pi-tui/html-form/data";
import type { AskQuestion } from "./schema.ts";

/** What the user gave one question. A cursor resting on an option is not an answer. */
export type Answer =
	| { readonly kind: "unanswered" }
	| { readonly kind: "option"; readonly index: number }
	| { readonly kind: "custom"; readonly text: string };

export const UNANSWERED: Answer = { kind: "unanswered" };

/** What the model reads for a question left without an answer when the whole ask was submitted or cancelled. */
const CANCELLED = "(cancelled)";
/** What the model reads for a question left without an answer when the ask timed out. */
const TIMED_OUT = "(timed out: the user did not answer; decide it yourself with your best judgment)";

function batchResult(questions: readonly AskQuestion[], answers: readonly Answer[], unanswered: string): AgentToolResult<AskToolDetails> {
	const lines: string[] = [];
	const formAnswers: FormAnswer[] = [];
	for (const [index, question] of questions.entries()) {
		const answer = answers[index] ?? UNANSWERED;
		const name = question.id;
		const stem = question.question;
		switch (answer.kind) {
			case "unanswered":
				lines.push(`${name}: ${unanswered}`);
				formAnswers.push({ name, question: stem, answer: "" });
				break;
			case "option": {
				const label = question.options[answer.index]?.label;
				lines.push(`${name}: ${label ?? unanswered}`);
				formAnswers.push({ name, question: stem, answer: label ?? "" });
				break;
			}
			case "custom":
				lines.push(`${name}: "${answer.text}"`);
				formAnswers.push({ name, question: stem, answer: answer.text });
				break;
		}
	}
	return {
		content: [{ type: "text", text: `User answers:\n${lines.join("\n")}` }],
		details: { answers: formAnswers },
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
export function rejectedResult(problems: readonly string[]): AgentToolResult<AskToolDetails> {
	return {
		content: [{ type: "text", text: `ask rejected:\n${problems.map((problem) => `- ${problem}`).join("\n")}` }],
		details: { answers: [] },
		isError: true,
	};
}
