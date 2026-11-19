import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { defaultFormData, fieldContexts, fieldQuestions, formAnswers } from "@oh-my-pi/pi-tui/html-form/data";
import { parseHtmlForm } from "@oh-my-pi/pi-tui/html-form/parse";
import type { ResolvedEvidence } from "../src/brief.ts";
import { compileForm } from "../src/form.ts";
import { answeredResult } from "../src/result.ts";
import type { AskQuestion } from "../src/schema.ts";

const retry: AskQuestion = {
	id: "retry",
	header: "Retry limit",
	question: "How should failed requests retry?",
	brief: {
		where: "Requests to `billing` fail once a minute.",
		what: "Which retry policy the client uses.",
		how: "Backoff needs a migration; fixed retries keep writing twice.",
		risks: ["Retries hide an outage"],
	},
	options: [
		{ label: "Exponential backoff", tradeoff: "safe, needs a migration", cost: "one table" },
		{ label: "Fixed 3 tries & give up <fast>", tradeoff: "no migration, writes twice", holds_when: "a double write is harmless" },
	],
	recommended: 1,
};

const cache: AskQuestion = {
	id: "cache",
	question: "Which cache policy should the client use?",
	brief: { where: "The cache never expires.", what: "When entries leave the cache.", how: "TTL is simple; invalidation is exact." },
	options: [
		{ label: "TTL 60s", tradeoff: "simple, can serve stale data" },
		{ label: "Invalidate on write", tradeoff: "exact, needs a hook" },
	],
};

const evidence: ResolvedEvidence[] = [
	{ kind: "file", path: "src/retry.ts", start: 41, end: 42, lines: ["for (;;) {", "  await send();"], note: "the loop" },
	{ kind: "text", source: "server log", lines: ["timeout after 30s"] },
];

// The form's own labels follow the user's language; these tests read the English ones.
const lang = process.env.OMOMP_LANG;
beforeAll(() => {
	process.env.OMOMP_LANG = "en";
});
afterAll(() => {
	if (lang === undefined) delete process.env.OMOMP_LANG;
	else process.env.OMOMP_LANG = lang;
});

function compiled() {
	return parseHtmlForm(compileForm([retry, cache], [evidence, []], "/work"));
}

describe("compileForm", () => {
	it("gives the host one field per question, read with the question text", () => {
		const form = compiled();
		expect(form.fields.map((field) => field.name)).toEqual(["retry", "cache"]);
		const questions = fieldQuestions(form);
		expect(form.fields.map((field) => questions.get(field))).toEqual([retry.question, cache.question]);
	});

	it("preselects no option, so a timeout submits nothing the user did not choose", () => {
		expect(defaultFormData(compiled())).toEqual({});
	});

	it("puts the brief, the evidence, the risks and every tradeoff in the question's context", () => {
		const form = compiled();
		const context = fieldContexts(form).get(form.fields[0]!) ?? "";
		for (const shown of [
			"Retry limit",
			"Requests to billing fail once a minute.",
			"src/retry.ts:41-42",
			"41  for (;;) {",
			"server log",
			"timeout after 30s",
			"Retries hide an outage",
			"Fixed 3 tries & give up <fast> (recommended): no migration, writes twice",
			"Holds when: a double write is harmless",
			"Cost: one table",
		]) {
			expect(context).toContain(shown);
		}
		expect(fieldContexts(form).get(form.fields[1]!) ?? "").not.toContain("Retry limit");
	});

	it("reports a chosen option by its label, markup characters included", () => {
		const form = compiled();
		expect(formAnswers(form, { retry: "Fixed 3 tries & give up <fast>", cache: "TTL 60s" }).map((answer) => answer.answer)).toEqual([
			"Fixed 3 tries & give up <fast>",
			"TTL 60s",
		]);
	});

	it("draws an image demo as a picture with an absolute path", () => {
		const html = compileForm(
			[{ ...cache, brief: { ...cache.brief, demo: { path: "docs/ttl.gif", caption: "stale reads" } } }],
			[[]],
			"/work",
		);
		const blocks = parseHtmlForm(html).sections.flatMap((section) => section.blocks);
		expect(blocks).toContainEqual({ kind: "image", src: "/work/docs/ttl.gif", alt: "Demo" });
	});
});

function hostResult(details: AskToolDetails): Parameters<typeof answeredResult>[1] {
	return {
		content: [
			{ type: "text", text: "host text" },
			{ type: "text", text: "[Image #1] notice" },
		],
		details,
	};
}

describe("answeredResult", () => {
	it("reads an option by label, an own answer as quoted text and a blank one as no answer", () => {
		const result = answeredResult(
			[retry, cache],
			hostResult({
				answers: [
					{ name: "retry", question: retry.question, answer: "Other: Retry twice, then alert" },
					{ name: "cache", question: cache.question, answer: "" },
				],
			}),
		);
		expect(result.content[0]).toEqual({ type: "text", text: 'User answers:\nretry: "Retry twice, then alert"\ncache: (no answer)' });
	});

	it("hands the questions left blank at a timeout to the model and keeps the answered ones", () => {
		const result = answeredResult(
			[retry, cache],
			hostResult({
				answers: [
					{ name: "retry", question: retry.question, answer: "Exponential backoff" },
					{ name: "cache", question: cache.question, answer: "" },
				],
				timedOut: true,
			}),
		);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text.split("\n").slice(1, 2)).toEqual(["retry: Exponential backoff"]);
		expect(text).toContain("cache: (timed out:");
		expect(result.details?.timedOut).toBe(true);
	});

	it("keeps the host's details and the note images, with the notes after the answers", () => {
		const details: AskToolDetails = {
			answers: [
				{ name: "retry", question: retry.question, answer: "Exponential backoff" },
				{ name: "cache", question: cache.question, answer: "TTL 60s" },
			],
			notes: [
				{
					name: "retry",
					question: retry.question,
					option: "Exponential backoff",
					value: "Exponential backoff",
					text: "cap it\nat 5 [Image #1]",
				},
			],
		};
		const result = answeredResult([retry, cache], hostResult(details));
		expect(result.details).toEqual(details);
		expect(result.content).toEqual([
			{
				type: "text",
				text: "User answers:\nretry: Exponential backoff\ncache: TTL 60s\nOption notes:\n- retry: Exponential backoff — cap it at 5 [Image #1]",
			},
			{ type: "text", text: "[Image #1] notice" },
		]);
	});
});
