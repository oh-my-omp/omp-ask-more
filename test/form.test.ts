import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { defaultFormData, fieldContexts, fieldQuestions, formAnswers } from "@oh-my-pi/pi-tui/html-form/data";
import { type ChoiceField, parseHtmlForm, spansText } from "@oh-my-pi/pi-tui/html-form/parse";
import type { ResolvedEvidence } from "../src/brief.ts";
import { resolveDemos } from "../src/demo.ts";
import { compileForm } from "../src/form.ts";
import { answeredResult, labelMap } from "../src/result.ts";
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

// A 1x1 GIF: the host's form loads it as a picture.
const GIF = Uint8Array.from([
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01,
	0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

const lang = process.env.OMOMP_LANG;
let work = "";
beforeAll(async () => {
	process.env.OMOMP_LANG = "en";
	work = await mkdtemp(join(tmpdir(), "ask-more-form-"));
	await writeFile(join(work, "ttl.gif"), GIF);
	await writeFile(join(work, "retry.mp4"), new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]));
});
afterAll(() => {
	if (lang === undefined) delete process.env.OMOMP_LANG;
	else process.env.OMOMP_LANG = lang;
});

function compiledHtml(): string {
	return compileForm([retry, cache], [evidence, []], [{ options: [] }, { options: [] }]);
}

function choice(html: string, name: string): ChoiceField {
	const field = parseHtmlForm(html).fields.find((candidate) => candidate.name === name);
	if (field?.kind !== "choice") throw new Error(`no choice field ${name}`);
	return field;
}

async function demoBlocks(question: AskQuestion) {
	const html = compileForm([question], [[]], [await resolveDemos(question, work)]);
	return parseHtmlForm(html).sections.flatMap((section) => section.blocks);
}

describe("compileForm", () => {
	it("gives the host one field per question, read with the question text", () => {
		const form = parseHtmlForm(compiledHtml());
		expect(form.fields.map((field) => field.name)).toEqual(["retry", "cache"]);
		const questions = fieldQuestions(form);
		expect(form.fields.map((field) => questions.get(field))).toEqual([retry.question, cache.question]);
	});

	it("preselects no option, so a timeout submits nothing the user did not choose", () => {
		expect(defaultFormData(parseHtmlForm(compiledHtml()))).toEqual({});
	});

	it("puts the brief, the evidence and the risks in the question's context", () => {
		const form = parseHtmlForm(compiledHtml());
		const context = fieldContexts(form).get(form.fields[0]!) ?? "";
		for (const shown of [
			"Retry limit",
			"Requests to billing fail once a minute.",
			"src/retry.ts:41-42",
			"41  for (;;) {",
			"server log",
			"timeout after 30s",
			"Retries hide an outage",
		]) {
			expect(context).toContain(shown);
		}
		expect(fieldContexts(form).get(form.fields[1]!) ?? "").not.toContain("Retry limit");
	});

	it("draws each option's tradeoff and notes on the lines under that option's row", () => {
		const field = choice(compiledHtml(), "retry");
		expect(field.options.map((option) => ({ value: option.value, label: spansText(option.label) }))).toEqual([
			{ value: "Exponential backoff", label: "Exponential backoff\nTradeoff: safe, needs a migration\nCost: one table" },
			{
				value: "Fixed 3 tries & give up <fast>",
				label: "Fixed 3 tries & give up <fast> (recommended)\nTradeoff: no migration, writes twice\nHolds when: a double write is harmless",
			},
		]);
	});

	it("draws a picture demo as an image with its absolute path", async () => {
		const blocks = await demoBlocks({
			...cache,
			brief: { ...cache.brief, demo: { kind: "file", path: "ttl.gif", caption: "stale reads" } },
		});
		expect(blocks).toContainEqual({ kind: "image", src: join(work, "ttl.gif"), alt: "Demo" });
		expect(blocks).toContainEqual({ kind: "text", spans: [{ text: "Demo", style: "strong" }, { text: " stale reads" }], heading: false });
	});

	it("shows any other file as its file URL, and a missing file with the reason, without blocking the form", async () => {
		const blocks = await demoBlocks({
			...cache,
			options: [
				{ ...cache.options[0]!, demo: { kind: "file", path: "retry.mp4" } },
				{ ...cache.options[1]!, demo: { kind: "file", path: "gone.webm" } },
			],
		});
		const texts = blocks.flatMap((block) => (block.kind === "text" ? [spansText(block.spans)] : []));
		expect(texts).toContain(pathToFileURL(join(work, "retry.mp4")).href);
		expect(texts).toContain("gone.webm · file not found");
		expect(blocks.some((block) => block.kind === "field")).toBe(true);
	});

	it("shows frames in order, each numbered, with Mermaid drawn as text art", async () => {
		const blocks = await demoBlocks({
			...cache,
			brief: {
				...cache.brief,
				demo: {
					kind: "frames",
					frames: [
						{ body: "Entry written at `t=0`.", caption: "fresh" },
						{ body: "```mermaid\nflowchart LR\n  read --> stale\n```", caption: "60s later" },
					],
				},
			},
		});
		const shown = blocks.flatMap((block) => (block.kind === "text" ? [spansText(block.spans)] : block.kind === "pre" ? [block.text] : []));
		const first = shown.indexOf("Frame 1/2 — fresh");
		const second = shown.indexOf("Frame 2/2 — 60s later");
		expect(first).toBeGreaterThan(-1);
		expect(shown[first + 1]).toBe("Entry written at t=0.");
		expect(second).toBeGreaterThan(first);
		expect(shown[second + 1]).toContain("stale");
		expect(shown[second + 1]).not.toContain("flowchart");
	});
});

function hostResult(details: AskToolDetails): Parameters<typeof answeredResult>[2] {
	return {
		content: [
			{ type: "text", text: "host text" },
			{ type: "text", text: "[Image #1] notice" },
		],
		details,
	};
}

describe("answeredResult", () => {
	it("returns the model's label for an option the host reports by its whole shown text", () => {
		const html = compiledHtml();
		const answers = formAnswers(parseHtmlForm(html), { retry: "Fixed 3 tries & give up <fast>", cache: "TTL 60s" });
		expect(answers[0]?.answer).toContain("Tradeoff: no migration");
		const result = answeredResult([retry, cache], labelMap(html), hostResult({ answers }));
		expect(result.content[0]).toEqual({ type: "text", text: "User answers:\nretry: Fixed 3 tries & give up <fast>\ncache: TTL 60s" });
		expect(result.details?.answers.map((answer) => answer.answer)).toEqual(["Fixed 3 tries & give up <fast>", "TTL 60s"]);
	});

	it("reads an own answer as quoted text and a blank one as no answer", () => {
		const result = answeredResult(
			[retry, cache],
			labelMap(compiledHtml()),
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
		const html = compiledHtml();
		const [answered] = formAnswers(parseHtmlForm(html), { retry: "Exponential backoff" });
		const result = answeredResult(
			[retry, cache],
			labelMap(html),
			hostResult({ answers: [answered!, { name: "cache", question: cache.question, answer: "" }], timedOut: true }),
		);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text.split("\n").slice(1, 2)).toEqual(["retry: Exponential backoff"]);
		expect(text).toContain("cache: (timed out:");
		expect(result.details?.timedOut).toBe(true);
	});

	it("names a noted option by the model's label and keeps the note images after the answers", () => {
		const html = compiledHtml();
		const answers = formAnswers(parseHtmlForm(html), { retry: "Exponential backoff", cache: "TTL 60s" });
		const shown = answers[0]!.answer;
		const details: AskToolDetails = {
			answers,
			notes: [{ name: "retry", question: retry.question, option: shown, value: "Exponential backoff", text: "cap it\nat 5 [Image #1]" }],
		};
		const result = answeredResult([retry, cache], labelMap(html), hostResult(details));
		expect(result.details?.notes?.map((note) => note.option)).toEqual(["Exponential backoff"]);
		expect(result.content).toEqual([
			{
				type: "text",
				text: "User answers:\nretry: Exponential backoff\ncache: TTL 60s\nOption notes:\n- retry: Exponential backoff — cap it at 5 [Image #1]",
			},
			{ type: "text", text: "[Image #1] notice" },
		]);
	});
});
