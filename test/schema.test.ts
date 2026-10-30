import { describe, expect, it } from "bun:test";
import { toolWireSchema, tryEnforceStrictSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { demoSchema, nativeQuestion, parametersSchema, validate, type AskParams } from "../src/schema.ts";

function payload(overrides: (params: AskParams) => void = () => {}): AskParams {
	const params = parametersSchema.parse({
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
	});
	overrides(params);
	return params;
}

describe("validate", () => {
	it("accepts a complete question", () => {
		expect(validate(payload())).toEqual({ ok: true, questions: payload().questions });
	});

	it("validates every question and names the one that is wrong", () => {
		const params = payload();
		const second = structuredClone(params.questions[0]!);
		second.id = "budget";
		second.options[1]!.tradeoff = "";
		params.questions.push(second);
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(["questions[1].options[1].tradeoff: empty; say what the option buys and what it costs"]);
	});

	it("rejects two questions with the same id", () => {
		const params = payload();
		params.questions.push(structuredClone(params.questions[0]!));
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(['questions[1].id: duplicate "retry"; every question needs its own id']);
	});

	it("rejects an empty brief section", () => {
		const params = payload();
		params.questions[0]!.brief.where = "   ";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(["questions[0].brief.where: empty"]);
	});

	it("rejects an option without a tradeoff and names it", () => {
		const params = payload();
		params.questions[0]!.options[1]!.tradeoff = "";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("questions[0].options[1].tradeoff");
	});

	it("rejects a reserved label", () => {
		const params = payload();
		params.questions[0]!.options[0]!.label = "Other (type your own)";
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("added by the UI");
	});

	it("rejects a recommended index outside the options", () => {
		const params = payload();
		params.questions[0]!.recommended = 9;
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("recommended");
	});

	it("rejects more evidence references than the surface can show", () => {
		const params = payload();
		params.questions[0]!.brief.evidence = Array.from({ length: 7 }, (_, index) => ({ path: `src/f${index}.ts`, start: undefined, end: undefined, note: undefined }));
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("at most 6");
	});

	it("accepts an evidence window of 80 lines and rejects one of 81", () => {
		const params = payload();
		params.questions[0]!.brief.evidence = [
			{ path: "src/retry.ts", start: 1, end: 80, note: undefined },
			{ path: "src/retry.ts", start: 1, end: 81, note: undefined },
		];
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems).toEqual(["questions[0].brief.evidence[1]: lines 1-81 span 81 lines; narrow it to 80 or fewer."]);
	});

	it("rejects an evidence end without a start, or before it", () => {
		const params = payload();
		params.questions[0]!.brief.evidence = [
			{ path: "src/retry.ts", start: undefined, end: 58, note: undefined },
			{ path: "src/retry.ts", start: 58, end: 41, note: undefined },
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

	it("accepts a question demo of frames and an option demo of a file", () => {
		const params = payload();
		params.questions[0]!.brief.demo = demoSchema.parse({ kind: "frames", frames: [{ body: "a" }, { body: "b" }], interval_ms: 800 });
		params.questions[0]!.options[0]!.demo = demoSchema.parse({ kind: "file", path: "docs/retry.gif", caption: "两次失败后退避" });
		expect(validate(params).ok).toBe(true);
	});

	it("does not parse a demo without its kind, or one carrying the other kind's source", () => {
		expect(demoSchema.safeParse({ frames: [{ body: "a" }, { body: "b" }] }).success).toBe(false);
		expect(demoSchema.safeParse({ kind: "file", frames: [{ body: "a" }, { body: "b" }] }).success).toBe(false);
		expect(demoSchema.safeParse({ kind: "frames", path: "a.gif" }).success).toBe(false);
	});

	it("rejects a frame count, an interval or a file type the sheet cannot play", () => {
		const params = payload();
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
		const wire = toolWireSchema({ name: "ask", description: "", parameters: parametersSchema } as Parameters<typeof toolWireSchema>[0]);
		expect(tryEnforceStrictSchema(wire as Record<string, unknown>).strict).toBe(true);
	});
});

describe("nativeQuestion", () => {
	it("drops the extension fields and keeps the native ones", () => {
		const question = payload().questions[0]!;
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
