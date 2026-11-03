import { describe, expect, it } from "bun:test";
import { NEED_THRESHOLD, readabilityGate, type ScoreJudge } from "../src/readability.ts";
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

/** The top level of the score question; a need of `n` is a score of `n * TOP`. */
const TOP = 3;

/** A judge that scores each question from `need` (a fraction of the top level) and records the states it was shown. */
function scripted(need: (question: string) => number, seen: string[] = []): ScoreJudge {
	return {
		async judge(request) {
			const state = JSON.stringify(request.state);
			seen.push(state);
			const question = questions.find(candidate => state.includes(candidate.question))?.question ?? "";
			return { answers: { need: { score: need(question) * TOP } } };
		},
	};
}

/** A judge that never answers and gives up only when its signal aborts. */
const hanging: ScoreJudge = {
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
	it("rejects only the questions whose need reaches the threshold", async () => {
		const gate = await readabilityGate(
			scripted(question => (question.startsWith("met") ? NEED_THRESHOLD + 0.01 : NEED_THRESHOLD - 0.01)),
			questions,
			"sheet",
			undefined,
			noWarn,
		);
		expect(gate.kind).toBe("reject");
		if (gate.kind !== "reject") return;
		expect(gate.problems).toHaveLength(1);
		expect(gate.problems[0]).toStartWith('question "met" is hard to understand');
		expect(gate.problems[0]).toContain("never explains");
	});

	it("passes a call whose every question stays below the threshold", async () => {
		expect(await readabilityGate(scripted(() => NEED_THRESHOLD - 0.01), questions, "sheet", undefined, noWarn)).toEqual({ kind: "pass" });
	});

	it("judges each question alone: the full sheet, or only the native fields when the native dialog shows the ask", async () => {
		const seen: string[] = [];
		await readabilityGate(scripted(() => 0, seen), questions, "sheet", undefined, noWarn);
		const native = await readabilityGate(scripted(() => 1, seen), questions, "native", undefined, noWarn);
		expect(seen).toHaveLength(4);
		const [retrySheet, metSheet, retryNative] = seen;
		expect(retrySheet).toContain("每次失败都立即重发");
		expect(retrySheet).toContain("不迁移，但重复写继续");
		expect(retrySheet).not.toContain("met 后要电平还是边沿");
		expect(metSheet).not.toContain("重试应该怎么做");
		expect(retryNative).toContain("重试应该怎么做");
		expect(retryNative).not.toContain("每次失败都立即重发");
		expect(retryNative).not.toContain("不迁移，但重复写继续");
		expect(retryNative).not.toContain('"retry"');
		expect(native.kind === "reject" && native.problems.at(-1)).toContain("the brief and tradeoffs are not shown");
	});

	it("asks without the check, with a warning, when the judge fails", async () => {
		const warnings: string[] = [];
		const failing: ScoreJudge = { judge: async () => Promise.reject(new Error("every judge candidate failed")) };
		expect(await readabilityGate(failing, questions, "sheet", undefined, message => warnings.push(message))).toEqual({ kind: "pass" });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("every judge candidate failed");
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
