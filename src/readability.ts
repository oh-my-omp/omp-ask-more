import type { JsonValue, Judge, JudgmentRequest, NoulQuestion } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { writeDeviceDispatch } from "@oh-my-pi/pi-coding-agent/tools/resolve";
import { tr } from "../omomp-shared/i18n.ts";
import type { AskQuestion } from "./schema.ts";

export type NoulJudge = Pick<Judge, "judge">;

type JsonObject = { readonly [key: string]: JsonValue };

function field(key: string, value: string | undefined): JsonObject {
	return value === undefined ? {} : { [key]: value };
}

function dialog(question: AskQuestion): JsonObject {
	return {
		...field("title", question.header),
		question: question.question,
		situation: question.brief.where,
		decision: question.brief.what,
		consequences: question.brief.how,
		options: question.options.map(
			(option): JsonObject => ({ label: option.label, effect: option.tradeoff, ...field("note", option.description) }),
		),
	};
}

function shownText(question: AskQuestion): { readonly prose: string[]; readonly all: string[] } {
	const defined = (...values: readonly (string | undefined)[]): string[] => values.filter((value): value is string => value !== undefined);
	const prose = [
		question.question,
		question.brief.where,
		question.brief.what,
		question.brief.how,
		...question.options.flatMap((option) => defined(option.tradeoff, option.description)),
	];
	return { prose, all: [...defined(question.header), ...prose, ...question.options.map((option) => option.label)] };
}

const URL = /https?:\/\/\S+/g;

const TERM =
	/(?<![\w#])#\d+\b|§\s?\d+(?:\.\d+)*|\b[A-Z]{1,4}-?\d+[a-z]?\b|\b[A-Z]{2,}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b|\b\d{8,}\b/g;

export function candidateTerms(texts: readonly string[]): string[] {
	const found = texts.flatMap((text) => (text.replace(URL, " ").match(TERM) ?? []).map((term) => term.replace(/\s/g, "")));
	return [...new Set(found)];
}

const SENTENCE_MIN_LENGTH = 6;

export function sentencesOf(texts: readonly string[]): string[] {
	const all = texts.flatMap((text) =>
		text
			.replace(URL, "<link>")
			.split(/[。；;！？!?\n]|(?<=[.])\s/)
			.map((part) => part.replace(/^[ ，,：:]+|[ ，,：:]+$/g, ""))
			.filter((part) => part.length >= SENTENCE_MIN_LENGTH),
	);
	return [...new Set(all)];
}

const SENTENCE_QUESTIONS = {
	actor: { type: "noul", instructions: "In `sentence`, is it stated or obvious who or what performs the action?" },
	unshown: {
		type: "noul",
		instructions:
			"Does `sentence` mention a test, review round, result, set of items or earlier decision only by a name or number, without saying what it is?",
	},
	jargon: {
		type: "noul",
		instructions:
			"Does `sentence` contain a word, abbreviation, name or number that a reader who has seen only `dialog` and has never seen this project could not explain?",
	},
} satisfies Record<string, NoulQuestion>;

export function sentenceRequest(shown: JsonObject, sentence: string): JudgmentRequest<Record<string, NoulQuestion>> {
	return { state: { dialog: shown, sentence }, questions: SENTENCE_QUESTIONS };
}

export function termRequest(shown: JsonObject, term: string): JudgmentRequest<Record<string, NoulQuestion>> {
	return {
		state: { dialog: shown },
		questions: {
			known: { type: "noul", instructions: `Would a software engineer who has never worked on this project know what \`${term}\` means?` },
			said: { type: "noul", instructions: `Could a reader who has seen only \`dialog\` say what \`${term}\` is?` },
		},
	};
}

export interface SentenceFinding {
	readonly sentence: string;
	readonly actor: number;
	readonly unshown: number;
	readonly jargon: number;
}

export interface TermFinding {
	readonly term: string;
	readonly known: number;
	readonly said: number;
}

export interface Finding {
	readonly sentences: readonly SentenceFinding[];
	readonly terms: readonly TermFinding[];
}

const CONCURRENCY = 8;

function answer(answers: Readonly<Record<string, { readonly noul: number }>>, key: string): number {
	const found = answers[key];
	if (found === undefined) throw new Error(`the judge gave no answer to "${key}"`);
	return found.noul;
}

async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	const queue = items.entries();
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (const [index, item] of queue) results[index] = await work(item);
		}),
	);
	return results;
}

export async function judgeReadability(
	judge: NoulJudge,
	questions: readonly AskQuestion[],
	signal: AbortSignal,
): Promise<readonly Finding[]> {
	const stop = new AbortController();
	const options = { signal: AbortSignal.any([signal, stop.signal]) };
	const sentenceJobs: { readonly at: number; readonly sentence: string }[] = [];
	const termJobs: { readonly at: number; readonly term: string }[] = [];
	const shown = questions.map((question, at) => {
		const text = shownText(question);
		for (const sentence of sentencesOf(text.prose)) sentenceJobs.push({ at, sentence });
		for (const term of candidateTerms(text.all)) termJobs.push({ at, term });
		return dialog(question);
	});
	try {
		const [sentences, terms] = await Promise.all([
			inPool(sentenceJobs, CONCURRENCY, async ({ at, sentence }): Promise<SentenceFinding> => {
				const { answers } = await judge.judge(sentenceRequest(shown[at] ?? {}, sentence), options);
				return { sentence, actor: answer(answers, "actor"), unshown: answer(answers, "unshown"), jargon: answer(answers, "jargon") };
			}),
			inPool(termJobs, CONCURRENCY, async ({ at, term }): Promise<TermFinding> => {
				const { answers } = await judge.judge(termRequest(shown[at] ?? {}, term), options);
				return { term, known: answer(answers, "known"), said: answer(answers, "said") };
			}),
		]);
		return questions.map((_, at) => ({
			sentences: sentences.filter((_item, index) => sentenceJobs[index]?.at === at),
			terms: terms.filter((_item, index) => termJobs[index]?.at === at),
		}));
	} catch (error) {
		stop.abort();
		throw error;
	}
}

export const YES = 0.5;

export type SentenceFault = "actor" | "unshown" | "jargon";

export function sentenceFaults(finding: SentenceFinding): SentenceFault[] {
	return [
		...(finding.actor < YES ? (["actor"] as const) : []),
		...(finding.unshown >= YES ? (["unshown"] as const) : []),
		...(finding.jargon >= YES ? (["jargon"] as const) : []),
	];
}

export function termFails(finding: TermFinding): boolean {
	return finding.known < YES && finding.said < YES;
}

export interface Unreadable {
	readonly id: string;
	readonly sentences: readonly { readonly sentence: string; readonly faults: readonly SentenceFault[] }[];
	readonly terms: readonly string[];
}

export function unreadableQuestions(questions: readonly AskQuestion[], findings: readonly Finding[]): Unreadable[] {
	return questions.flatMap((question, index) => {
		const finding = findings[index];
		if (finding === undefined) return [];
		const sentences = finding.sentences
			.map((item) => ({ sentence: item.sentence, faults: sentenceFaults(item) }))
			.filter((item) => item.faults.length > 0);
		const terms = finding.terms.filter(termFails).map((item) => item.term);
		return sentences.length > 0 || terms.length > 0 ? [{ id: question.id, sentences, terms }] : [];
	});
}

const FAULT_TEXT: Record<SentenceFault, string> = {
	actor: "it does not say who or what acts",
	unshown: "it mentions something the dialog never shows, only by a name or number",
	jargon: "it uses a word, abbreviation, name or number the dialog never explains",
};

const QUOTE_LENGTH = 80;

function quote(sentence: string): string {
	return JSON.stringify(sentence.length > QUOTE_LENGTH ? `${sentence.slice(0, QUOTE_LENGTH)}…` : sentence);
}

const REJECTION_MARK = "is hard to understand for a reader who sees only this dialog";

export function readabilityProblems(failing: readonly Unreadable[]): string[] {
	return failing.map(({ id, sentences, terms }) => {
		const lines = [
			...sentences.map(({ sentence, faults }) => `${quote(sentence)}: ${faults.map((fault) => FAULT_TEXT[fault]).join("; ")}`),
			...terms.map((term) => `\`${term}\`: neither common knowledge nor explained in the dialog`),
		];
		return `question "${id}" ${REJECTION_MARK} and has never seen your session or this project; rewrite every item below so each sentence says who does what, each abbreviation is spelled out, and each name, number or earlier decision is said in plain words:\n${lines.map((line) => `  - ${line}`).join("\n")}`;
	});
}

export const JUDGE_DEADLINE_MS = 30_000;

export type Gate =
	| { readonly kind: "pass" }
	| { readonly kind: "reject"; readonly problems: readonly string[] }
	| { readonly kind: "cancelled" };

export async function readabilityGate(
	judge: NoulJudge,
	questions: readonly AskQuestion[],
	signal: AbortSignal | undefined,
	warn: (message: string) => void,
	deadlineMs = JUDGE_DEADLINE_MS,
): Promise<Gate> {
	const deadline = AbortSignal.timeout(deadlineMs);
	try {
		const findings = await judgeReadability(judge, questions, signal === undefined ? deadline : AbortSignal.any([signal, deadline]));
		const failing = unreadableQuestions(questions, findings);
		return failing.length === 0 ? { kind: "pass" } : { kind: "reject", problems: readabilityProblems(failing) };
	} catch (error) {
		if (signal?.aborted) return { kind: "cancelled" };
		const detail = deadline.aborted
			? tr(`no answer within ${deadlineMs / 1000}s`, `${deadlineMs / 1000} 秒内没有结果`)
			: error instanceof Error
				? error.message
				: String(error);
		warn(tr(`readability check skipped: ${detail}`, `已跳过可读性检查：${detail}`));
		return { kind: "pass" };
	}
}

export async function gateUnlessRetry(branch: readonly BranchEntry[], judge: () => Promise<Gate>): Promise<Gate> {
	return lastAskRejected(branch) ? { kind: "pass" } : judge();
}

export type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];

function isAskResult(toolName: string, result: unknown): boolean {
	if (toolName === "ask") return true;
	const dispatch = writeDeviceDispatch(toolName, result);
	return dispatch?.tool === "ask" && dispatch.mode === "execute";
}

export function lastAskRejected(branch: readonly BranchEntry[]): boolean {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "toolResult" || !isAskResult(entry.message.toolName, entry.message)) continue;
		return entry.message.isError && entry.message.content.some((part) => part.type === "text" && part.text.includes(REJECTION_MARK));
	}
	return false;
}
