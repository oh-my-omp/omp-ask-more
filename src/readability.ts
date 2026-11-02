// The readability gate: before a human sees an ask, the session's judge role decides whether each
// question can be understood by someone who sees only the dialog. A question the judge finds hard
// to read rejects the call with a fixed rewrite instruction per defect, and the model asks again.
import type { JudgmentRequest, NoulQuestion } from "@oh-my-pi/pi-ai";
import { tr } from "./i18n.ts";
import { type AskQuestion, nativeQuestion } from "./schema.ts";

/** The part of the host's judge the gate uses: yes/no questions over one state. */
export interface NoulJudge {
	judge(request: JudgmentRequest<Record<string, NoulQuestion>>, options: { signal: AbortSignal }): Promise<{ readonly answers: Readonly<Record<string, { readonly noul: number }>> }>;
}

/** Where the questions will be shown, which decides what text the reader actually gets. */
export type Surface = "sheet" | "native";

export const DEFECTS = ["undefined_terms", "missing_context", "options_indistinct"] as const;
export type Defect = (typeof DEFECTS)[number];

/** Probability of a defect at which a question is rejected; chosen with `bun eval/readability.ts`. */
export const DEFECT_THRESHOLD = 0.6;

export type QuestionFailure = { readonly id: string; readonly defects: readonly Defect[] };

export type ReadabilityVerdict =
	| { readonly kind: "readable" }
	| { readonly kind: "unreadable"; readonly failures: readonly QuestionFailure[] };

const AUDIENCE =
	"The state lists the questions of one dialog, exactly as the reader sees them. The reader is technically competent but sees only this dialog: they have not read the agent's session and do not know its project-specific names, identifiers, internal states, abbreviations or earlier decisions. Common engineering vocabulary (HTTP, Git, cache, API, regex, database) needs no explanation. Length, complexity, writing style, language and spelling are not defects, and whether the decision is right or the question needed is not judged.";

const RUBRICS: Readonly<Record<Defect, (at: string) => NoulQuestion>> = {
	undefined_terms: at => ({
		type: "noul",
		instructions: `${AUDIENCE} Consider ${at} with everything shown with it. Does understanding the decision require a project-specific name, identifier, internal state, abbreviation or coined term that the shown text never explains?`,
		criteria: {
			true: "At least one such term is needed to understand the decision and is not explained anywhere in the shown text.",
			false: "Every term needed to understand the decision is common engineering vocabulary or is explained in the shown text.",
		},
	}),
	missing_context: at => ({
		type: "noul",
		instructions: `${AUDIENCE} Consider ${at} with everything shown with it. Taking every term as understood, does the shown text leave the reader unable to tell what is being decided, what situation forces the decision now, or what the decision affects?`,
		criteria: {
			true: "The shown text leaves unclear what is decided, why it must be decided now, or what it affects.",
			false: "The shown text states what is decided, why now, and what it affects.",
		},
	}),
	options_indistinct: at => ({
		type: "noul",
		instructions: `${AUDIENCE} Consider ${at} with everything shown with it. Is the reader unable to tell from the shown text what each option would do and how the options differ?`,
		criteria: {
			true: "At least one option's effect is not stated, or two options cannot be told apart.",
			false: "Each option's effect, and how it differs from the others, is stated.",
		},
	}),
};

/** What the model is told to fix; fixed text, never judge output. */
const REWRITES: Readonly<Record<Defect, string>> = {
	undefined_terms: "it relies on project-specific names, identifiers or states it never explains; explain each in plain words or replace it with a plain description",
	missing_context: "it does not say what is being decided, why it must be decided now, or what it affects",
	options_indistinct: "its options do not say what each one does or how they differ",
};

/** The text the reader gets for one question: the whole authored sheet, or the native dialog's subset. */
function shown(question: AskQuestion, surface: Surface): Record<string, unknown> {
	switch (surface) {
		case "sheet": {
			const { id: _id, ...visible } = question;
			return visible;
		}
		case "native": {
			const { id: _id, ...visible } = nativeQuestion(question);
			return visible;
		}
	}
}

function key(index: number, defect: Defect): string {
	return `q${index}_${defect}`;
}

/** One judgment over the whole call: a yes/no question per defect per ask question. */
export function readabilityRequest(questions: readonly AskQuestion[], surface: Surface): JudgmentRequest<Record<string, NoulQuestion>> {
	const judged: Record<string, NoulQuestion> = {};
	questions.forEach((_question, index) => {
		for (const defect of DEFECTS) judged[key(index, defect)] = RUBRICS[defect](`questions[${index}]`);
	});
	return { state: JSON.stringify({ questions: questions.map(question => shown(question, surface)) }, null, 1), questions: judged };
}

/** Probability of every defect of every question, in input order. */
export type DefectScores = readonly Readonly<Record<Defect, number>>[];

export function defectScores(questions: readonly AskQuestion[], answers: Readonly<Record<string, { readonly noul: number }>>): DefectScores {
	return questions.map((_question, index) => {
		const score = (defect: Defect): number => {
			const answer = answers[key(index, defect)];
			if (answer === undefined) throw new Error(`judgment returned no answer for ${key(index, defect)}`);
			return answer.noul;
		};
		return { undefined_terms: score("undefined_terms"), missing_context: score("missing_context"), options_indistinct: score("options_indistinct") };
	});
}

export function readabilityVerdict(questions: readonly AskQuestion[], scores: DefectScores, threshold = DEFECT_THRESHOLD): ReadabilityVerdict {
	const failures = questions.flatMap((question, index): QuestionFailure[] => {
		const found = DEFECTS.filter(defect => (scores[index]?.[defect] ?? 0) >= threshold);
		return found.length === 0 ? [] : [{ id: question.id, defects: found }];
	});
	return failures.length === 0 ? { kind: "readable" } : { kind: "unreadable", failures };
}

/** Ask the judge about every question of the call at once. */
export async function judgeReadability(judge: NoulJudge, questions: readonly AskQuestion[], surface: Surface, signal: AbortSignal): Promise<DefectScores> {
	const result = await judge.judge(readabilityRequest(questions, surface), { signal });
	return defectScores(questions, result.answers);
}

/** The rejection the model reads: every failing question, every defect, and what this surface shows. */
export function readabilityProblems(failures: readonly QuestionFailure[], surface: Surface): string[] {
	const problems = failures.map(
		failure => `question "${failure.id}" is hard to understand for a reader who sees only this dialog and has not read your session: ${failure.defects.map(defect => REWRITES[defect]).join("; ")}`,
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
	judge: NoulJudge,
	questions: readonly AskQuestion[],
	surface: Surface,
	signal: AbortSignal | undefined,
	warn: (message: string) => void,
	deadlineMs = JUDGE_DEADLINE_MS,
): Promise<Gate> {
	const deadline = AbortSignal.timeout(deadlineMs);
	try {
		const scores = await judgeReadability(judge, questions, surface, signal === undefined ? deadline : AbortSignal.any([signal, deadline]));
		const verdict = readabilityVerdict(questions, scores);
		switch (verdict.kind) {
			case "readable":
				return { kind: "pass" };
			case "unreadable":
				return { kind: "reject", problems: readabilityProblems(verdict.failures, surface) };
		}
	} catch (error) {
		if (signal?.aborted) return { kind: "cancelled" };
		const detail = deadline.aborted ? tr(`no answer within ${deadlineMs / 1000}s`, `${deadlineMs / 1000} 秒内没有结果`) : error instanceof Error ? error.message : String(error);
		warn(tr(`readability check skipped: ${detail}`, `已跳过可读性检查：${detail}`));
		return { kind: "pass" };
	}
}
