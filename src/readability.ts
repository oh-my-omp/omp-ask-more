// The readability gate: before a human sees an ask, the session's judge role rates how much each
// question leans on knowledge the dialog does not give. A question rated too high rejects the call
// with a fixed rewrite instruction, and the model asks again.
//
// The request follows TypeSafe's guidance for System One judges (docs.typesafe.ai): the reader and
// the dialog are named fields of the state, sent once; the question is one short instruction that
// points at them by name; the levels describe situations, each judged on its own.
import type { JsonValue, JudgmentRequest, ScoreQuestion } from "@oh-my-pi/pi-ai";
import { tr } from "./i18n.ts";
import type { AskQuestion } from "./schema.ts";

/** The part of the host's judge the gate uses: one score question over one state. */
export interface ScoreJudge {
	judge(request: JudgmentRequest<{ need: ScoreQuestion }>, options: { signal: AbortSignal }): Promise<{ readonly answers: { readonly need: { readonly score: number } } }>;
}

/** Where the questions will be shown, which decides what text the reader actually gets. */
export type Surface = "sheet" | "native";

const READER = "A software engineer who sees only this dialog. They have not seen the AI agent's earlier work, its files or its notes.";

/** Lowest to highest; the answer's `score` is the probability-weighted level index. */
const LEVELS: ScoreQuestion["criteria"] = [
	"Nothing: every name and reference is common knowledge or explained in the dialog",
	"One or two minor names are unexplained, but the decision is still clear",
	"Several names, codes or references are unexplained, so parts of the decision are unclear",
	"The decision is built on codes, names or earlier decisions the dialog never explains",
];

const NEED: ScoreQuestion = {
	type: "score",
	instructions: "How much does the `reader` need to know beyond `dialog` to make the decision?",
	criteria: LEVELS,
};

/**
 * Score, as a fraction of the top level, at which a question is rejected: between the highest
 * readable (0.67) and the hard questions above it (0.70–0.78) on the labelled asks with the native
 * judge; `bun run eval:readability`, docs/verification.md#readability-check.
 */
export const NEED_THRESHOLD = 0.685;

type JsonObject = { readonly [key: string]: JsonValue };

/** `{ [key]: value }`, or nothing when the value is absent. */
function field(key: string, value: string | undefined): JsonObject {
	return value === undefined ? {} : { [key]: value };
}

/** The dialog as the reader gets it: the whole authored sheet, or the native dialog's fields. */
function dialog(question: AskQuestion, surface: Surface): JsonObject {
	switch (surface) {
		case "sheet":
			return {
				...field("title", question.header),
				question: question.question,
				situation: question.brief.where,
				decision: question.brief.what,
				consequences: question.brief.how,
				options: question.options.map((option): JsonObject => ({ label: option.label, effect: option.tradeoff, ...field("note", option.description) })),
			};
		case "native":
			return {
				...field("title", question.header),
				question: question.question,
				options: question.options.map((option): JsonObject => ({ label: option.label, ...field("note", option.description), ...field("preview", option.preview) })),
			};
	}
}

/** One judgment per question, over that question alone: the reader sees one question per page. */
export function readabilityRequest(question: AskQuestion, surface: Surface): JudgmentRequest<{ need: ScoreQuestion }> {
	return { state: { reader: READER, dialog: dialog(question, surface) }, questions: { need: NEED } };
}

/** How much each question needs beyond its dialog, as a fraction of the top level, in input order. */
export async function judgeReadability(judge: ScoreJudge, questions: readonly AskQuestion[], surface: Surface, signal: AbortSignal): Promise<readonly number[]> {
	return Promise.all(
		questions.map(async question => {
			const { answers } = await judge.judge(readabilityRequest(question, surface), { signal });
			return answers.need.score / (LEVELS.length - 1);
		}),
	);
}

/** The ids of the questions whose need reaches the threshold. */
export function unreadableQuestions(questions: readonly AskQuestion[], needs: readonly number[], threshold = NEED_THRESHOLD): string[] {
	return questions.flatMap((question, index) => ((needs[index] ?? 0) >= threshold ? [question.id] : []));
}

/** The rejection the model reads: every failing question, and what this surface shows. Fixed text, never judge output. */
export function readabilityProblems(ids: readonly string[], surface: Surface): string[] {
	const problems = ids.map(
		id => `question "${id}" is hard to understand for a reader who sees only this dialog and has not read your session: it relies on names, codes, references or earlier decisions it never explains; say in plain words what each one is, or describe it instead of naming it`,
	);
	switch (surface) {
		case "sheet":
			return problems;
		case "native":
			return [...problems, "this session shows only each question's text and header and each option's label, description and preview; the brief and tradeoffs are not shown, so put the context there"];
	}
}

/** How long the gate waits for the judge before asking without it. */
export const JUDGE_DEADLINE_MS = 30_000;

/** What the ask does after the gate. */
export type Gate = { readonly kind: "pass" } | { readonly kind: "reject"; readonly problems: readonly string[] } | { readonly kind: "cancelled" };

/**
 * Judge the call. A judge that fails or misses its deadline lets the ask through with a warning;
 * only the caller's own abort cancels it.
 */
export async function readabilityGate(
	judge: ScoreJudge,
	questions: readonly AskQuestion[],
	surface: Surface,
	signal: AbortSignal | undefined,
	warn: (message: string) => void,
	deadlineMs = JUDGE_DEADLINE_MS,
): Promise<Gate> {
	const deadline = AbortSignal.timeout(deadlineMs);
	try {
		const needs = await judgeReadability(judge, questions, surface, signal === undefined ? deadline : AbortSignal.any([signal, deadline]));
		const failing = unreadableQuestions(questions, needs);
		return failing.length === 0 ? { kind: "pass" } : { kind: "reject", problems: readabilityProblems(failing, surface) };
	} catch (error) {
		if (signal?.aborted) return { kind: "cancelled" };
		const detail = deadline.aborted ? tr(`no answer within ${deadlineMs / 1000}s`, `${deadlineMs / 1000} 秒内没有结果`) : error instanceof Error ? error.message : String(error);
		warn(tr(`readability check skipped: ${detail}`, `已跳过可读性检查：${detail}`));
		return { kind: "pass" };
	}
}
