// The readability gate: before a human sees an ask, the session's judge role answers yes/no
// questions about every sentence of each question and about every code or abbreviation in it. One
// sentence that names no actor, mentions something the dialog never shows only by a name or number,
// or uses a word the reader cannot place, and one code or abbreviation that is neither common
// knowledge nor explained, rejects the call with the offending text listed, and the model asks
// again. Nothing is tolerated: a wrongly rejected ask costs one rewrite, a missed one costs the
// reader's decision.
//
// Every judgment is one literal question about one thing, named in the state: a sentence goes in as
// `sentence` next to the `dialog` it belongs to, a term is named in the instruction. Code finds the
// sentences and the candidate terms (a model does not list reliably) and decides what the answers add up to.
import type { JsonValue, JudgmentRequest, NoulQuestion } from "@oh-my-pi/pi-ai";
import { tr } from "./i18n.ts";
import type { AskQuestion } from "./schema.ts";

/** The part of the host's judge the gate uses: yes/no questions over one state. */
export interface NoulJudge {
	judge(request: JudgmentRequest<Record<string, NoulQuestion>>, options: { signal: AbortSignal }): Promise<{ readonly answers: Readonly<Record<string, { readonly noul: number }>> }>;
}

/** Where the questions will be shown, which decides what text the reader actually gets. */
export type Surface = "sheet" | "native";

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

/** The text the reader reads as sentences, and every text the reader sees, labels and titles included. */
function shownText(question: AskQuestion, surface: Surface): { readonly prose: string[]; readonly all: string[] } {
	const defined = (...values: readonly (string | undefined)[]): string[] => values.filter((value): value is string => value !== undefined);
	switch (surface) {
		case "sheet": {
			const prose = [question.question, question.brief.where, question.brief.what, question.brief.how, ...question.options.flatMap(option => defined(option.tradeoff, option.description))];
			return { prose, all: [...defined(question.header), ...prose, ...question.options.map(option => option.label)] };
		}
		case "native": {
			const prose = [question.question, ...question.options.flatMap(option => defined(option.description, option.preview))];
			return { prose, all: [...defined(question.header), ...prose, ...question.options.map(option => option.label)] };
		}
	}
}

const URL = /https?:\/\/\S+/g;

/**
 * What a reader outside the project cannot look up and a model cannot be trusted to list: issue and
 * section numbers, codes (`F106`, `K6`, `VM110`), commit hashes, long numbers and upper-case abbreviations.
 */
const TERM = /(?<![\w#])#\d+\b|§\s?\d+(?:\.\d+)*|\b[A-Z]{1,4}-?\d+[a-z]?\b|\b[A-Z]{2,}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b|\b\d{8,}\b/g;

/** The distinct candidate terms in the dialog's texts, in order of appearance. */
export function candidateTerms(texts: readonly string[]): string[] {
	const found = texts.flatMap(text => (text.replace(URL, " ").match(TERM) ?? []).map(term => term.replace(/\s/g, "")));
	return [...new Set(found)];
}

/** A fragment this short is a label, not a sentence. */
const SENTENCE_MIN_LENGTH = 6;

/** The distinct sentences of the dialog's prose, split at full stops, semicolons and line breaks, a link standing as `<link>`. */
export function sentencesOf(texts: readonly string[]): string[] {
	const all = texts.flatMap(text =>
		text
			.replace(URL, "<link>")
			.split(/[。；;！？!?\n]|(?<=[.])\s/)
			.map(part => part.replace(/^[ ，,：:]+|[ ，,：:]+$/g, ""))
			.filter(part => part.length >= SENTENCE_MIN_LENGTH),
	);
	return [...new Set(all)];
}

const SENTENCE_QUESTIONS = {
	actor: { type: "noul", instructions: "In `sentence`, is it stated or obvious who or what performs the action?" },
	unshown: {
		type: "noul",
		instructions: "Does `sentence` mention a test, review round, result, set of items or earlier decision only by a name or number, without saying what it is?",
	},
	jargon: {
		type: "noul",
		instructions: "Does `sentence` contain a word, abbreviation, name or number that a reader who has seen only `dialog` and has never seen this project could not explain?",
	},
} satisfies Record<string, NoulQuestion>;

/** The questions about one sentence of `dialog`. */
export function sentenceRequest(shown: JsonObject, sentence: string): JudgmentRequest<Record<string, NoulQuestion>> {
	return { state: { dialog: shown, sentence }, questions: SENTENCE_QUESTIONS };
}

/** The questions about one code or abbreviation of `dialog`. */
export function termRequest(shown: JsonObject, term: string): JudgmentRequest<Record<string, NoulQuestion>> {
	return {
		state: { dialog: shown },
		questions: {
			known: { type: "noul", instructions: `Would a software engineer who has never worked on this project know what \`${term}\` means?` },
			said: { type: "noul", instructions: `Could a reader who has seen only \`dialog\` say what \`${term}\` is?` },
		},
	};
}

/** What the judge said about one sentence: the probability that each yes/no condition holds. */
export interface SentenceFinding {
	readonly sentence: string;
	/** The sentence says who or what acts. */
	readonly actor: number;
	/** The sentence mentions something the dialog does not show, only by a name or number. */
	readonly unshown: number;
	/** The sentence holds a word, name or number the reader could not explain. */
	readonly jargon: number;
}

/** What the judge said about one code or abbreviation. */
export interface TermFinding {
	readonly term: string;
	/** Engineers in general know it. */
	readonly known: number;
	/** The dialog alone lets a reader say what it is. */
	readonly said: number;
}

export interface Finding {
	readonly sentences: readonly SentenceFinding[];
	readonly terms: readonly TermFinding[];
}

/** How many judgments run at once across the whole call. */
const CONCURRENCY = 8;

function answer(answers: Readonly<Record<string, { readonly noul: number }>>, key: string): number {
	const found = answers[key];
	if (found === undefined) throw new Error(`the judge gave no answer to "${key}"`);
	return found.noul;
}

/** `work` over every item, at most `limit` at a time, results in input order; the first failure rejects. */
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

/** Every question's findings, in input order; each question is judged on its own, as its surface shows it. */
export async function judgeReadability(judge: NoulJudge, questions: readonly AskQuestion[], surface: Surface, signal: AbortSignal): Promise<readonly Finding[]> {
	const stop = new AbortController();
	const options = { signal: AbortSignal.any([signal, stop.signal]) };
	const sentenceJobs: { readonly at: number; readonly sentence: string }[] = [];
	const termJobs: { readonly at: number; readonly term: string }[] = [];
	const shown = questions.map((question, at) => {
		const text = shownText(question, surface);
		for (const sentence of sentencesOf(text.prose)) sentenceJobs.push({ at, sentence });
		for (const term of candidateTerms(text.all)) termJobs.push({ at, term });
		return dialog(question, surface);
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

/** An answer at or above this reads as "yes". */
export const YES = 0.5;

/** Why a sentence is rejected. */
export type SentenceFault = "actor" | "unshown" | "jargon";

/** Every reason this sentence fails; none means it reads. */
export function sentenceFaults(finding: SentenceFinding): SentenceFault[] {
	return [...(finding.actor < YES ? (["actor"] as const) : []), ...(finding.unshown >= YES ? (["unshown"] as const) : []), ...(finding.jargon >= YES ? (["jargon"] as const) : [])];
}

/** A code or abbreviation fails when engineers in general would not know it and the dialog does not say what it is. */
export function termFails(finding: TermFinding): boolean {
	return finding.known < YES && finding.said < YES;
}

/** A question that fails, and what fails in it. */
export interface Unreadable {
	readonly id: string;
	readonly sentences: readonly { readonly sentence: string; readonly faults: readonly SentenceFault[] }[];
	readonly terms: readonly string[];
}

/** The questions with any failing sentence or term. */
export function unreadableQuestions(questions: readonly AskQuestion[], findings: readonly Finding[]): Unreadable[] {
	return questions.flatMap((question, index) => {
		const finding = findings[index];
		if (finding === undefined) return [];
		const sentences = finding.sentences.map(item => ({ sentence: item.sentence, faults: sentenceFaults(item) })).filter(item => item.faults.length > 0);
		const terms = finding.terms.filter(termFails).map(item => item.term);
		return sentences.length > 0 || terms.length > 0 ? [{ id: question.id, sentences, terms }] : [];
	});
}

const FAULT_TEXT: Record<SentenceFault, string> = {
	actor: "it does not say who or what acts",
	unshown: "it mentions something the dialog never shows, only by a name or number",
	jargon: "it uses a word, abbreviation, name or number the dialog never explains",
};

/** The longest stretch of a sentence the rejection quotes back. */
const QUOTE_LENGTH = 80;

function quote(sentence: string): string {
	return JSON.stringify(sentence.length > QUOTE_LENGTH ? `${sentence.slice(0, QUOTE_LENGTH)}…` : sentence);
}

/** The rejection the model reads: every failing question with the sentences and terms that fail, and what this surface shows. Fixed text around the model's own words, never judge output. */
export function readabilityProblems(failing: readonly Unreadable[], surface: Surface): string[] {
	const problems = failing.map(({ id, sentences, terms }) => {
		const lines = [
			...sentences.map(({ sentence, faults }) => `${quote(sentence)}: ${faults.map(fault => FAULT_TEXT[fault]).join("; ")}`),
			...terms.map(term => `\`${term}\`: neither common knowledge nor explained in the dialog`),
		];
		return `question "${id}" is hard to understand for a reader who sees only this dialog and has never seen your session or this project; rewrite every item below so each sentence says who does what, each abbreviation is spelled out, and each name, number or earlier decision is said in plain words:\n${lines.map(line => `  - ${line}`).join("\n")}`;
	});
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
		const findings = await judgeReadability(judge, questions, surface, signal === undefined ? deadline : AbortSignal.any([signal, deadline]));
		const failing = unreadableQuestions(questions, findings);
		return failing.length === 0 ? { kind: "pass" } : { kind: "reject", problems: readabilityProblems(failing, surface) };
	} catch (error) {
		if (signal?.aborted) return { kind: "cancelled" };
		const detail = deadline.aborted ? tr(`no answer within ${deadlineMs / 1000}s`, `${deadlineMs / 1000} 秒内没有结果`) : error instanceof Error ? error.message : String(error);
		warn(tr(`readability check skipped: ${detail}`, `已跳过可读性检查：${detail}`));
		return { kind: "pass" };
	}
}

/**
 * The call after a rejection goes through unjudged: the model has been told what to fix, and a
 * judge that rejects again must not keep the ask from the reader. `rejected` holds the keys (one
 * per session) whose last ask was rejected; the next call with that key clears it and passes.
 */
export async function gateOnce(rejected: WeakSet<object>, key: object, judge: () => Promise<Gate>): Promise<Gate> {
	if (rejected.delete(key)) return { kind: "pass" };
	const gate = await judge();
	if (gate.kind === "reject") rejected.add(key);
	return gate;
}
