import { describe, expect, it } from "bun:test";
import { recoverAskQuestions } from "@oh-my-pi/pi-coding-agent";
import { toolWireSchema, tryEnforceStrictSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { type AskParams, type AskParamsWire, demoSchema, evidenceSchema, nativeQuestion, parametersSchema, parseParams, validate } from "../src/schema.ts";

/** A wire call: one question, two options, nothing extended. */
function wire(overrides: Partial<AskParamsWire> = {}): AskParamsWire {
	return {
		questions: [
			{
				id: "retry",
				question: "重试应该怎么做？",
				brief: { where: "src/retry.ts:41-58", what: "选重试策略", how: "A 要迁移，B 不动签名" },
				options: [
					{ label: "指数退避", tradeoff: "安全，但要迁移", cost: "1 张表" },
					{ label: "固定 3 次", tradeoff: "不迁移，但重复写继续", holds_when: "重复写无害" },
				],
			},
		],
		...overrides,
	};
}

/** The wire call as the internal parameters; a rejection fails the test with its problems. */
function parsed(overrides: Partial<AskParamsWire> = {}): AskParams {
	const checked = parseParams(wire(overrides));
	if (!checked.ok) throw new Error(checked.problems.join("\n"));
	return { questions: [...checked.questions] };
}

describe("parseParams", () => {
	it("maps a file evidence entry onto the brief of the question it names", () => {
		const params = parsed({ evidence: [{ question: "retry", kind: "file", path: "README.md", start: 1, end: 5, note: "why" }] });
		expect(params.questions[0]!.brief.evidence).toEqual([{ kind: "file", path: "README.md", start: 1, end: 5, note: "why" }]);
	});

	it("maps a text evidence entry onto the brief of the question it names", () => {
		const params = parsed({ evidence: [{ question: "retry", kind: "text", source: "bun test", text: "3 pass", lang: "text" }] });
		expect(params.questions[0]!.brief.evidence).toEqual([{ kind: "text", source: "bun test", text: "3 pass", lang: "text" }]);
	});

	it("maps a frames demo in the brief position onto the question's brief", () => {
		const params = parsed({ demos: [{ question: "retry", kind: "frames", frames: [{ body: "a" }, { body: "b", caption: "second" }], interval_ms: 800 }] });
		expect(params.questions[0]!.brief.demo).toEqual({ kind: "frames", frames: [{ body: "a" }, { body: "b", caption: "second" }], interval_ms: 800 });
	});

	it("maps a file demo in the brief position onto the question's brief", () => {
		const params = parsed({ demos: [{ question: "retry", kind: "file", path: "docs/retry.gif", caption: "两次失败后退避" }] });
		expect(params.questions[0]!.brief.demo).toEqual({ kind: "file", path: "docs/retry.gif", caption: "两次失败后退避" });
	});

	it("maps a frames demo in the option position onto the option its label names", () => {
		const params = parsed({ demos: [{ question: "retry", option: "固定 3 次", kind: "frames", frames: [{ body: "a" }, { body: "b" }] }] });
		expect(params.questions[0]!.options[1]!.demo).toEqual({ kind: "frames", frames: [{ body: "a" }, { body: "b" }] });
	});

	it("maps a file demo in the option position onto the option its label names", () => {
		const params = parsed({ demos: [{ question: "retry", option: "指数退避", kind: "file", path: "docs/retry.gif" }] });
		expect(params.questions[0]!.options[0]!.demo).toEqual({ kind: "file", path: "docs/retry.gif" });
	});

	it("rejects evidence naming a question the call does not hold, naming the field", () => {
		const checked = parseParams(wire({ evidence: [{ question: "missing", kind: "file", path: "README.md" }] }));
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['evidence[0].question: "missing" is not the id of any question in this call']);
	});

	it("rejects a demo naming an option its question does not hold, naming the field", () => {
		const checked = parseParams(wire({ demos: [{ question: "retry", option: "加缓存", kind: "file", path: "docs/retry.gif" }] }));
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['demos[0].option: "加缓存" is not a label of an option of question "retry"']);
	});

	it("rejects a demo naming a question the call does not hold, naming the field", () => {
		const checked = parseParams(wire({ demos: [{ question: "missing", kind: "file", path: "docs/retry.gif" }] }));
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['demos[0].question: "missing" is not the id of any question in this call']);
	});

	it("rejects the fields of the other kind, naming each field", () => {
		const checked = parseParams(
			wire({
				evidence: [{ question: "retry", kind: "file", path: "README.md", source: "bun test", text: "3 pass" }],
				demos: [{ question: "retry", kind: "frames", frames: [{ body: "a" }, { body: "b" }], path: "docs/retry.gif" }],
			}),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"evidence[0].source: only with kind text; this entry has kind file",
				"evidence[0].text: only with kind text; this entry has kind file",
				"demos[0].path: only with kind file; this entry has kind frames",
			]);
		}
	});

	it("rejects a kind without its own fields, naming each one", () => {
		const checked = parseParams(
			wire({
				evidence: [
					{ question: "retry", kind: "file" },
					{ question: "retry", kind: "text", source: "bun test" },
				],
				demos: [{ question: "retry", kind: "frames" }],
			}),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"evidence[0].path: required with kind file",
				"evidence[1].text: required with kind text",
				"demos[0].frames: required with kind frames",
			]);
		}
	});

	it("rejects a second demo on the same slot", () => {
		const checked = parseParams(
			wire({
				demos: [
					{ question: "retry", option: "指数退避", kind: "file", path: "docs/a.gif" },
					{ question: "retry", option: "指数退避", kind: "file", path: "docs/b.gif" },
				],
			}),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['demos[1].option: option "指数退避" of question "retry" already has a demo; one demo per option']);
	});

	it("keeps the new shape valid for the native ask schema", () => {
		// `/tree` re-answer validates the persisted arguments with the host's native schema.
		const args = wire({
			evidence: [{ question: "retry", kind: "file", path: "README.md", start: 1, end: 5 }],
			demos: [{ question: "retry", option: "固定 3 次", kind: "file", path: "docs/retry.gif" }],
		});
		const recovered = recoverAskQuestions(args);
		expect(recovered?.map(question => question.id)).toEqual(["retry"]);
		expect(recovered?.[0]?.options.map(option => option.label)).toEqual(["指数退避", "固定 3 次"]);
	});
});

describe("validate", () => {
	it("accepts a complete question", () => {
		expect(validate(parsed())).toEqual({ ok: true, questions: parsed().questions });
	});

	it("validates every question and names the one that is wrong", () => {
		const params = parsed();
		const second = structuredClone(params.questions[0]!);
		second.id = "budget";
		second.options[1]!.tradeoff = "";
		params.questions.push(second);
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(["questions[1].options[1].tradeoff: empty; say what the option buys and what it costs"]);
	});

	it("rejects two questions with the same id", () => {
		const params = parsed();
		params.questions.push(structuredClone(params.questions[0]!));
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['questions[1].id: duplicate "retry"; every question needs its own id']);
	});

	it("rejects an empty brief section", () => {
		const params = parsed();
		params.questions[0]!.brief.where = "   ";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(["questions[0].brief.where: empty"]);
	});

	it("rejects an option without a tradeoff and names it", () => {
		const params = parsed();
		params.questions[0]!.options[1]!.tradeoff = "";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("questions[0].options[1].tradeoff");
	});

	it("rejects a reserved label", () => {
		const params = parsed();
		params.questions[0]!.options[0]!.label = "Other (type your own)";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("added by the UI");
	});

	it("rejects a recommended index outside the options", () => {
		const params = parsed();
		params.questions[0]!.recommended = 9;
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("recommended");
	});

	it("accepts any number of evidence references and windows of any length", () => {
		const params = parsed();
		params.questions[0]!.brief.evidence = [
			...Array.from({ length: 8 }, (_, index) => evidenceSchema.parse({ kind: "file", path: `src/f${index}.ts` })),
			evidenceSchema.parse({ kind: "file", path: "src/retry.ts", start: 1, end: 3000 }),
		];
		expect(validate(params).ok).toBe(true);
	});

	it("rejects an evidence end without a start, or before it", () => {
		const params = parsed();
		params.questions[0]!.brief.evidence = [
			evidenceSchema.parse({ kind: "file", path: "src/retry.ts", end: 58 }),
			evidenceSchema.parse({ kind: "file", path: "src/retry.ts", start: 58, end: 41 }),
		];
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"questions[0].brief.evidence[0].end: 58 without start; give start too, or leave both out for the file's first lines",
				"questions[0].brief.evidence[1].end: 41 is before start 58",
			]);
		}
	});

	it("rejects quoted text without a one-line source, or without text", () => {
		const params = parsed();
		params.questions[0]!.brief.evidence = [
			evidenceSchema.parse({ kind: "text", source: "bun test\n(run 2)", text: "3 pass" }),
			evidenceSchema.parse({ kind: "text", source: "  ", text: "  " }),
		];
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"questions[0].brief.evidence[0].source: more than one line; name where the text came from in one line and put the text in text",
				"questions[0].brief.evidence[1].source: empty",
				"questions[0].brief.evidence[1].text: empty",
			]);
		}
	});

	it("does not parse evidence without its kind, or carrying the other kind's fields", () => {
		expect(evidenceSchema.safeParse({ path: "src/retry.ts", start: 1 }).success).toBe(false);
		expect(evidenceSchema.safeParse({ kind: "text", path: "src/retry.ts" }).success).toBe(false);
		expect(evidenceSchema.safeParse({ kind: "file", source: "bun test", text: "ok" }).success).toBe(false);
	});

	it("does not parse a demo without its kind, or one carrying the other kind's source", () => {
		expect(demoSchema.safeParse({ frames: [{ body: "a" }, { body: "b" }] }).success).toBe(false);
		expect(demoSchema.safeParse({ kind: "file", frames: [{ body: "a" }, { body: "b" }] }).success).toBe(false);
		expect(demoSchema.safeParse({ kind: "frames", path: "a.gif" }).success).toBe(false);
	});

	it("rejects a frame count, an interval or a file type the sheet cannot play", () => {
		const params = parsed();
		params.questions[0]!.brief.demo = demoSchema.parse({ kind: "frames", frames: [{ body: "only one" }], interval_ms: 100 });
		params.questions[0]!.options[0]!.demo = demoSchema.parse({ kind: "file", path: "notes/plan.pdf" });
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				'questions[0].options[0].demo.path: "notes/plan.pdf" is not one of .gif, .png, .apng, .webp, .mp4, .mov, .webm, .mkv, .m4v',
				"questions[0].brief.demo.frames: 1 frames; a demo plays 2 to 12",
				"questions[0].brief.demo.interval_ms: 100 is not from 300 to 5000 ms",
			]);
		}
	});
});

describe("strict tool calling", () => {
	it("keeps the parameters representable in strict mode", () => {
		// A shape omp cannot express in strict mode silently falls back to non-strict, and the
		// provider then makes the model fill every optional field (the openai-codex failure).
		const wireSchema = toolWireSchema({ name: "ask", description: "", parameters: parametersSchema } as Parameters<typeof toolWireSchema>[0]);
		expect(tryEnforceStrictSchema(wireSchema as Record<string, unknown>).strict).toBe(true);
	});
});

describe("nativeQuestion", () => {
	it("drops the extension fields and keeps the native ones", () => {
		const question = parsed({ demos: [{ question: "retry", kind: "file", path: "docs/retry.gif" }] }).questions[0]!;
		question.recommended = 1;
		question.options[0]!.preview = "preview text";
		expect(nativeQuestion(question)).toEqual({
			id: "retry",
			question: "重试应该怎么做？",
			options: [
				{ label: "指数退避", preview: "preview text" },
				{ label: "固定 3 次" },
			],
			recommended: 1,
		});
	});
});
