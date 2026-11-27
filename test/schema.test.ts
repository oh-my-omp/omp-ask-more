import { describe, expect, it } from "bun:test";
import { toolWireSchema, tryEnforceStrictSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { omompTool } from "../omomp-shared/tool-entry.ts";
import { type AskParamsWire, type AskQuestion, parametersSchema, parseParams } from "../src/schema.ts";

type QuestionWire = AskParamsWire["questions"][number];

function question(overrides: Partial<QuestionWire> = {}): QuestionWire {
	return {
		id: "retry",
		question: "重试应该怎么做？",
		brief: { where: "src/retry.ts:41-58", what: "选重试策略", how: "A 要迁移，B 不动签名" },
		options: [
			{ label: "指数退避", tradeoff: "安全，但要迁移", cost: "1 张表" },
			{ label: "固定 3 次", tradeoff: "不迁移，但重复写继续", holds_when: "重复写无害" },
		],
		...overrides,
	};
}

function wire(overrides: Partial<QuestionWire> = {}): AskParamsWire {
	return { questions: [question(overrides)] };
}

function parsed(overrides: Partial<QuestionWire> = {}): { questions: readonly AskQuestion[] } {
	const checked = parseParams(wire(overrides));
	if (!checked.ok) throw new Error(checked.problems.join("\n"));
	return { questions: checked.questions };
}

function problems(params: AskParamsWire): readonly string[] {
	const checked = parseParams(params);
	return checked.ok ? [] : checked.problems;
}

describe("parseParams", () => {
	it("maps inline evidence_files and evidence_quotes onto brief.evidence", () => {
		const params = parsed({
			evidence_files: [{ path: "README.md", start: 1, end: 5, note: "why" }],
			evidence_quotes: [{ source: "bun test", text: "3 pass", lang: "text" }],
		});
		expect(params.questions[0]!.brief.evidence).toEqual([
			{ kind: "file", path: "README.md", start: 1, end: 5, note: "why" },
			{ kind: "text", source: "bun test", text: "3 pass", lang: "text" },
		]);
	});

	it("maps inline demo_file on a question onto brief.demo", () => {
		const params = parsed({ demo_file: { path: "docs/retry.mp4", caption: "两次失败后退避" } });
		expect(params.questions[0]!.brief.demo).toEqual({ kind: "file", path: "docs/retry.mp4", caption: "两次失败后退避" });
	});

	it("maps inline demo_file and demo_frames on options onto option.demo", () => {
		const frames = [{ body: "第一次失败", caption: "t=0" }, { body: "```mermaid\nflowchart LR\n  a --> b\n```" }];
		const params = parsed({
			options: [
				{ label: "指数退避", tradeoff: "安全，但要迁移", demo_file: { path: "docs/retry.gif" } },
				{ label: "固定 3 次", tradeoff: "不迁移，但重复写继续", demo_frames: frames },
			],
		});
		expect(params.questions[0]!.options[0]!.demo).toEqual({ kind: "file", path: "docs/retry.gif" });
		expect(params.questions[0]!.options[1]!.demo).toEqual({ kind: "frames", frames });
	});

	it("maps inline demo_frames on a question onto brief.demo", () => {
		const frames = [{ body: "step 1", caption: "t=0" }];
		const params = parsed({ demo_frames: frames });
		expect(params.questions[0]!.brief.demo).toEqual({ kind: "frames", frames });
	});

	it("rejects providing both demo_frames and demo_file on a question or option", () => {
		const checked = parseParams(
			wire({
				demo_frames: [{ body: "frame" }],
				demo_file: { path: "docs/a.mp4" },
				options: [
					{
						label: "指数退避",
						tradeoff: "t",
						demo_frames: [{ body: "opt frame" }],
						demo_file: { path: "docs/b.gif" },
					},
					{ label: "固定 3 次", tradeoff: "t" },
				],
			}),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) {
			expect(checked.problems).toEqual([
				"questions[0].demo_file: give either demo_frames or demo_file, not both",
				"questions[0].options[0].demo_file: give either demo_frames or demo_file, not both",
			]);
		}
	});

	it("rejects a label the form would not return unchanged", () => {
		expect(
			parseParams(
				wire({
					options: [
						{ label: "指数\n退避", tradeoff: "t" },
						{ label: "固定 3 次", tradeoff: "t" },
					],
				}),
			),
		).toMatchObject({ ok: false });
		expect(
			parseParams(
				wire({
					options: [
						{ label: "指数  退避", tradeoff: "t" },
						{ label: "固定 3 次", tradeoff: "t" },
					],
				}),
			),
		).toMatchObject({ ok: false });
	});
});

describe("parseParams validation", () => {
	it("accepts a complete question", () => {
		expect(problems(wire())).toEqual([]);
	});

	it("leaves blank required-field rejection to the registration boundary", () => {
		expect(problems(wire({ brief: { where: "   ", what: "选重试策略", how: "A 要迁移" } }))).toEqual([]);
		expect(problems(wire({ demo_frames: [{ body: "ok" }, { body: "  \n" }] }))).toEqual([]);
	});

	it("validates every question and names the one with an invalid label", () => {
		const second = question({
			id: "budget",
			options: [
				{ label: "指数退避", tradeoff: "安全，但要迁移" },
				{ label: "Other strategy", tradeoff: "迁移成本有限" },
			],
		});
		expect(problems({ questions: [question(), second] })).toEqual([
			'questions[1].options[1].label: "Other strategy" starts with Other, which the form keeps for the user\'s own answer; give the option another label',
		]);
	});

	it("rejects two questions with the same id", () => {
		expect(problems({ questions: [question(), question()] })).toEqual([
			'questions[1].id: duplicate "retry"; every question needs its own id',
		]);
	});

	it("rejects a label the form takes for the user's own answer", () => {
		const labelled = (label: string) =>
			wire({
				options: [
					{ label, tradeoff: "t" },
					{ label: "固定 3 次", tradeoff: "t" },
				],
			});
		for (const label of ["Other", "other approach", "Other…"]) {
			expect(problems(labelled(label)).join("\n")).toContain("starts with Other");
		}
		expect(problems(labelled("Otherwise retry"))).toEqual([]);
	});

	it("rejects a recommended index outside the options", () => {
		expect(problems(wire({ recommended: 9 }))).toEqual(["questions[0].recommended: 9 is not an index into 2 options"]);
		expect(problems(wire({ recommended: -1 }))).toEqual(["questions[0].recommended: -1 is not an index into 2 options"]);
	});

	it("accepts any number of evidence references and windows of any length", () => {
		const evidence_files = [
			...Array.from({ length: 8 }, (_, index) => ({ path: `src/f${index}.ts` })),
			{ path: "src/retry.ts", start: 1, end: 3000 },
		];
		expect(problems(wire({ evidence_files }))).toEqual([]);
	});

	it("rejects an evidence end without a start, or before it", () => {
		expect(
			problems(
				wire({
					evidence_files: [
						{ path: "src/retry.ts", end: 58 },
						{ path: "src/retry.ts", start: 58, end: 41 },
					],
				}),
			),
		).toEqual([
			"questions[0].brief.evidence[0].end: 58 without start; give start too, or leave both out for the file's first lines",
			"questions[0].brief.evidence[1].end: 41 is before start 58",
		]);
	});

	it("rejects quoted text with a multi-line source", () => {
		expect(problems(wire({ evidence_quotes: [{ source: "bun test\n(run 2)", text: "3 pass" }] }))).toEqual([
			"questions[0].brief.evidence[0].source: more than one line; name where the text came from in one line and put the text in text",
		]);
	});
});

describe("strict tool calling", () => {
	it("keeps the parameters representable in strict mode", () => {
		const wireSchema = toolWireSchema({ name: "ask", description: "", parameters: parametersSchema } as Parameters<
			typeof toolWireSchema
		>[0]);
		expect(tryEnforceStrictSchema(wireSchema as Record<string, unknown>).strict).toBe(true);
	});
});

function boundaryCaller() {
	let received: AskParamsWire | undefined;
	const wrapped = omompTool({
		name: "ask",
		parameters: parametersSchema,
		execute: (_toolCallId: string, params: AskParamsWire) => {
			received = params;
			return params;
		},
	});
	return (args: unknown): AskParamsWire => {
		received = undefined;
		wrapped.execute("call-1", args as AskParamsWire);
		if (received === undefined) throw new Error("execute did not run");
		return received;
	};
}

describe("omompTool registration boundary", () => {
	it("treats blank optional fields, empty arrays, empty objects, and null as omitted while keeping recommended: 0", () => {
		const call = boundaryCaller();
		const normalized = call({
			questions: [
				{
					id: "retry",
					question: "重试应该怎么做？",
					header: "   ",
					recommended: 0,
					brief: { where: "src/retry.ts:41-58", what: "选重试策略", how: "A 要迁移", diagram: "", risks: [] },
					evidence_files: [],
					evidence_quotes: null,
					demo_frames: [],
					demo_file: {},
					options: [
						{ label: "指数退避", tradeoff: "安全，但要迁移", description: "  ", holds_when: null, cost: "", demo_frames: [] },
						{ label: "固定 3 次", tradeoff: "不迁移", demo_file: { path: "  " } },
					],
				},
			],
		});
		expect(normalized).toEqual({
			questions: [
				{
					id: "retry",
					question: "重试应该怎么做？",
					recommended: 0,
					brief: { where: "src/retry.ts:41-58", what: "选重试策略", how: "A 要迁移" },
					options: [
						{ label: "指数退避", tradeoff: "安全，但要迁移" },
						{ label: "固定 3 次", tradeoff: "不迁移" },
					],
				},
			],
		});
		expect(parseParams(normalized).ok).toBe(true);
	});

	it("refuses blank required fields with host Validation failed for tool ask", () => {
		const call = boundaryCaller();
		expect(() => call(wire({ brief: { where: "   ", what: "选重试策略", how: "A 要迁移" } }))).toThrow(/Validation failed for tool "ask"/);
	});

	it("refuses empty array items with their field path and index", () => {
		const call = boundaryCaller();
		expect(() => call(wire({ demo_frames: [{ body: "ok" }, { body: "  \n" }] }))).toThrow(
			/questions\[0\]\.demo_frames\[1\]: array element must not be empty/,
		);
		expect(() => call(wire({ brief: { where: "src/retry.ts", what: "选重试策略", how: "A 要迁移", risks: ["   "] } }))).toThrow(
			/questions\[0\]\.brief\.risks\[0\]: array element must not be empty/,
		);
	});
});
