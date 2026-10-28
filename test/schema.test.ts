import { describe, expect, it } from "bun:test";
import { nativeQuestion, parametersSchema, validate, type AskParams } from "../src/schema.ts";

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
		expect(validate(payload())).toEqual({ ok: true, question: payload().questions[0]! });
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
