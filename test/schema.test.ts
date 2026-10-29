import { describe, expect, it } from "bun:test";
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

	it("rejects a multi-select question", () => {
		const params = payload();
		params.questions[0]!.multi = true;
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("multi");
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
		params.questions[0]!.brief.evidence = Array.from({ length: 7 }, (_, index) => ({ path: `src/f${index}.ts`, lines: undefined, note: undefined }));
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("at most 6");
	});

	it("rejects an evidence window wider than the surface draws", () => {
		const params = payload();
		params.questions[0]!.brief.evidence = [{ path: "src/retry.ts", lines: "41-300", note: undefined }];
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("spans 260 lines");
	});

	it("rejects an evidence line window that is not N or N-M", () => {
		const params = payload();
		params.questions[0]!.brief.evidence = [{ path: "src/retry.ts", lines: "41..58", note: undefined }];
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.problems.join("\n")).toContain("is not \"N\" or \"N-M\"");
	});

	it("accepts a question demo of frames and an option demo of a file", () => {
		const params = payload();
		params.questions[0]!.brief.demo = demoSchema.parse({ frames: [{ body: "a" }, { body: "b" }], interval_ms: 800 });
		params.questions[0]!.options[0]!.demo = demoSchema.parse({ path: "docs/retry.gif", caption: "两次失败后退避" });
		expect(validate(params).ok).toBe(true);
	});

	it("rejects a demo with both frames and a path, or with neither", () => {
		const params = payload();
		params.questions[0]!.brief.demo = demoSchema.parse({ frames: [{ body: "a" }, { body: "b" }], path: "a.gif" });
		params.questions[0]!.options[1]!.demo = demoSchema.parse({ caption: "nothing to play" });
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"questions[0].options[1].demo: give exactly one of frames (an animation you write) or path (an animation or video file)",
				"questions[0].brief.demo: give exactly one of frames (an animation you write) or path (an animation or video file)",
			]);
		}
	});

	it("rejects a frame count, an interval or a file type the sheet cannot play", () => {
		const params = payload();
		params.questions[0]!.brief.demo = demoSchema.parse({ frames: [{ body: "only one" }], interval_ms: 100 });
		params.questions[0]!.options[0]!.demo = demoSchema.parse({ path: "notes/plan.pdf" });
		params.questions[0]!.options[1]!.demo = demoSchema.parse({ path: "clip.mp4", interval_ms: 1000 });
		const checked = validate(params);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			const problems = checked.problems.join("\n");
			expect(problems).toContain("questions[0].brief.demo.frames: 1 frames; a demo plays 2 to 12");
			expect(problems).toContain("questions[0].brief.demo.interval_ms: 100 is not a whole number of ms from 300 to 5000");
			expect(problems).toContain('questions[0].options[0].demo.path: "notes/plan.pdf" is not one of');
			expect(problems).toContain("questions[0].options[1].demo.interval_ms: only frames take an interval");
		}
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
