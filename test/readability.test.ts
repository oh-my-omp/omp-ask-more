import { describe, expect, it } from "bun:test";
import { DEFECT_THRESHOLD, type NoulJudge, readabilityGate } from "../src/readability.ts";
import { type AskQuestion, parametersSchema } from "../src/schema.ts";

const questions: readonly AskQuestion[] = parametersSchema.parse({
	questions: [
		{
			id: "retry",
			question: "重试应该怎么做？",
			brief: { where: "src/retry.ts:41-58 每次失败都立即重发", what: "选重试策略", how: "A 要迁移，B 不动签名" },
			options: [
				{ label: "指数退避", tradeoff: "安全，但要迁移" },
				{ label: "固定 3 次", tradeoff: "不迁移，但重复写继续" },
			],
		},
		{
			id: "met",
			question: "met 后要电平还是边沿？",
			brief: { where: "monitor", what: "met 语义", how: "选一个" },
			options: [
				{ label: "边沿", tradeoff: "少唤醒" },
				{ label: "电平", tradeoff: "多唤醒" },
			],
		},
	],
}).questions;

type Seen = { state: string; keys: string[] };

/** A judge that answers each defect of the question its state shows from `score`, and records what it was shown. */
function scripted(score: (question: string, defect: string) => number, seen: Seen[] = []): NoulJudge {
	return {
		async judge(request) {
			const state = String(request.state);
			const question = questions.find(candidate => state.includes(candidate.question))?.question ?? "";
			seen.push({ state, keys: Object.keys(request.questions) });
			return { answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { noul: score(question, key) }])) };
		},
	};
}

/** A judge that never answers and gives up only when its signal aborts. */
const hanging: NoulJudge = {
	judge: (_request, { signal }) => {
		const { promise, reject } = Promise.withResolvers<never>();
		signal.addEventListener("abort", () => reject(signal.reason));
		return promise;
	},
};

const noWarn = (message: string) => {
	throw new Error(`unexpected warning: ${message}`);
};

describe("readability gate", () => {
	it("rejects only the questions whose defects reach the threshold, naming each defect", async () => {
		const gate = await readabilityGate(
			scripted((question, defect) =>
				question.startsWith("met") ? (defect === "undefined_terms" ? DEFECT_THRESHOLD : defect === "options_indistinct" ? 0.9 : 0) : defect === "missing_context" ? DEFECT_THRESHOLD - 0.01 : 0,
			),
			questions,
			"sheet",
			undefined,
			noWarn,
		);
		expect(gate.kind).toBe("reject");
		if (gate.kind !== "reject") return;
		expect(gate.problems).toHaveLength(1);
		expect(gate.problems[0]).toStartWith('question "met" is hard to understand');
		expect(gate.problems[0]).toContain("project-specific names");
		expect(gate.problems[0]).toContain("its options do not say what each one does");
		expect(gate.problems[0]).not.toContain("why it must be decided now");
	});

	it("passes a call whose every defect stays below the threshold", async () => {
		expect(await readabilityGate(scripted(() => DEFECT_THRESHOLD - 0.01), questions, "sheet", undefined, noWarn)).toEqual({ kind: "pass" });
	});

	it("judges each question alone: the full sheet, or only the native fields when the native dialog shows the ask", async () => {
		const seen: Seen[] = [];
		await readabilityGate(scripted(() => 0, seen), questions, "sheet", undefined, noWarn);
		const native = await readabilityGate(scripted(() => 1, seen), questions, "native", undefined, noWarn);
		expect(seen).toHaveLength(4);
		const [retrySheet, metSheet, retryNative] = seen;
		expect(retrySheet?.keys).toEqual(["undefined_terms", "missing_context", "options_indistinct"]);
		expect(retrySheet?.state).toContain("每次失败都立即重发");
		expect(retrySheet?.state).toContain("不迁移，但重复写继续");
		expect(retrySheet?.state).not.toContain("met 后要电平还是边沿");
		expect(metSheet?.state).not.toContain("重试应该怎么做");
		expect(retryNative?.state).not.toContain("每次失败都立即重发");
		expect(retryNative?.state).not.toContain("不迁移，但重复写继续");
		expect(retryNative?.state).not.toContain('"id"');
		expect(native.kind === "reject" && native.problems.at(-1)).toContain("the brief and tradeoffs are not shown");
	});

	it("asks without the check, with a warning, when the judge fails or answers incompletely", async () => {
		const failing: NoulJudge = { judge: async () => Promise.reject(new Error("every judge candidate failed")) };
		const incomplete: NoulJudge = { judge: async () => ({ answers: {} }) };
		for (const [judge, expected] of [[failing, "every judge candidate failed"], [incomplete, "no answer for undefined_terms"]] as const) {
			const warnings: string[] = [];
			expect(await readabilityGate(judge, questions, "sheet", undefined, message => warnings.push(message))).toEqual({ kind: "pass" });
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(expected);
		}
	});

	it("asks without the check when the judge misses its deadline", async () => {
		const warnings: string[] = [];
		expect(await readabilityGate(hanging, questions, "sheet", new AbortController().signal, message => warnings.push(message), 20)).toEqual({ kind: "pass" });
		expect(warnings).toHaveLength(1);
	});

	it("cancels the ask when the caller aborts while the judge runs", async () => {
		const caller = new AbortController();
		const gate = readabilityGate(hanging, questions, "sheet", caller.signal, noWarn, 60_000);
		caller.abort();
		expect(await gate).toEqual({ kind: "cancelled" });
	});
});
