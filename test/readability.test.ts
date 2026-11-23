import { describe, expect, it } from "bun:test";
import { type JudgmentRequest, type JudgmentResult, type Questions, tokenUsage } from "@oh-my-pi/pi-ai";
import { type BranchEntry, candidateTerms, gateUnlessRetry, type NoulJudge, readabilityGate, sentencesOf } from "../src/readability.ts";
import { rejectedResult } from "../src/result.ts";
import { type AskParamsWire, type AskQuestion, parseParams } from "../src/schema.ts";

function parsed(params: AskParamsWire): readonly AskQuestion[] {
	const checked = parseParams(params);
	if (!checked.ok) throw new Error(checked.problems.join("\n"));
	return checked.questions;
}

const questions = parsed({
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
});

interface Verdict {
	readonly actor?: number;
	readonly unshown?: number;
	readonly jargon?: number;
	readonly known?: number;
	readonly said?: number;
}

function judged<Q extends Questions>(request: JudgmentRequest<Q>, nouls: Record<string, number>): JudgmentResult<Q> {
	const answers: Record<string, { type: "noul"; noul: number }> = {};
	for (const id of Object.keys(request.questions)) answers[id] = { type: "noul", noul: nouls[id] ?? 0 };
	return {
		api: "test",
		provider: "test",
		model: "test",
		answers: answers as JudgmentResult<Q>["answers"],
		usage: tokenUsage(0, 0),
	};
}

function scripted(verdict: (subject: string) => Verdict, seen: { state: string; asked: string[] }[] = []): NoulJudge {
	return {
		async judge<Q extends Questions>(request: JudgmentRequest<Q>): Promise<JudgmentResult<Q>> {
			const text = JSON.stringify(request.state);
			const asked = Object.keys(request.questions);
			seen.push({ state: text, asked });
			const state: unknown = JSON.parse(text);
			if (typeof state === "object" && state !== null && "sentence" in state && typeof state.sentence === "string") {
				const said = verdict(state.sentence);
				return judged(request, { actor: said.actor ?? 1, unshown: said.unshown ?? 0, jargon: said.jargon ?? 0 });
			}
			const term = /`([^`]+)`/.exec(request.questions.known?.instructions ?? "")?.[1] ?? "";
			const said = verdict(term);
			return judged(request, { known: said.known ?? 1, said: said.said ?? 1 });
		},
	};
}

const hanging: NoulJudge = {
	judge: (_request, options) => {
		const { promise, reject } = Promise.withResolvers<never>();
		options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
		return promise;
	},
};

const noWarn = (message: string) => {
	throw new Error(`unexpected warning: ${message}`);
};

describe("readability gate", () => {
	it("passes a call whose every sentence and term reads", async () => {
		expect(
			await readabilityGate(
				scripted(() => ({})),
				questions,
				undefined,
				noWarn,
			),
		).toEqual({ kind: "pass" });
	});

	it("rejects the question holding one sentence that names no actor, and quotes that sentence", async () => {
		const gate = await readabilityGate(
			scripted((subject) => (subject.includes("每次失败都立即重发") ? { actor: 0.1 } : {})),
			questions,
			undefined,
			noWarn,
		);
		expect(gate.kind).toBe("reject");
		if (gate.kind !== "reject") return;
		expect(gate.problems).toHaveLength(1);
		expect(gate.problems[0]).toStartWith('question "retry" is hard to understand');
		expect(gate.problems[0]).toContain("每次失败都立即重发");
		expect(gate.problems[0]).toContain("it does not say who or what acts");
		expect(gate.problems[0]).not.toContain("met 语义");
	});

	it("names every reason one sentence fails", async () => {
		const gate = await readabilityGate(
			scripted((subject) => (subject.includes("met 语义") ? { unshown: 0.9, jargon: 0.8 } : {})),
			questions,
			undefined,
			noWarn,
		);
		expect(gate.kind === "reject" && gate.problems[0]).toContain("mentions something the dialog never shows");
		expect(gate.kind === "reject" && gate.problems[0]).toContain("uses a word, abbreviation, name or number the dialog never explains");
	});

	it("rejects a code that is neither common knowledge nor explained, and passes one that is either", async () => {
		const coded = parsed({
			questions: [
				{
					id: "coded",
					question: "按 K6 退役还是保留 SSH 入口？",
					brief: { where: "K6 在 #592 里定义", what: "选退役或保留", how: "选一个" },
					options: [
						{ label: "退役", tradeoff: "释放资源" },
						{ label: "保留", tradeoff: "不改" },
					],
				},
			],
		});
		const gate = await readabilityGate(
			scripted((subject) => (subject === "K6" ? { known: 0.1, said: 0.2 } : subject === "#592" ? { known: 0.1, said: 0.9 } : {})),
			coded,
			undefined,
			noWarn,
		);
		expect(gate.kind).toBe("reject");
		if (gate.kind !== "reject") return;
		expect(gate.problems[0]).toContain("`K6`: neither common knowledge nor explained");
		expect(gate.problems[0]).not.toContain("`#592`");
		expect(gate.problems[0]).not.toContain("`SSH`");
	});

	it("judges each question alone, with its brief and tradeoffs", async () => {
		const calls: { state: string; asked: string[] }[] = [];
		await readabilityGate(
			scripted(() => ({}), calls),
			questions,
			undefined,
			noWarn,
		);
		expect(calls.some((call) => call.state.includes("每次失败都立即重发") && call.asked.includes("actor"))).toBe(true);
		expect(calls.some((call) => call.state.includes("met 后要电平还是边沿") && call.state.includes("每次失败都立即重发"))).toBe(false);
		expect(calls.some((call) => call.state.includes("重试应该怎么做") && call.state.includes("不迁移，但重复写继续"))).toBe(true);
	});

	it("asks without the check, with a warning, when the judge fails", async () => {
		const warnings: string[] = [];
		const failing: NoulJudge = { judge: async () => Promise.reject(new Error("every judge candidate failed")) };
		expect(await readabilityGate(failing, questions, undefined, (message) => warnings.push(message))).toEqual({ kind: "pass" });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("every judge candidate failed");
	});

	it("asks without the check when the judge misses its deadline", async () => {
		const warnings: string[] = [];
		expect(await readabilityGate(hanging, questions, new AbortController().signal, (message) => warnings.push(message), 20)).toEqual({
			kind: "pass",
		});
		expect(warnings).toHaveLength(1);
	});

	it("cancels the ask when the caller aborts while the judge runs", async () => {
		const caller = new AbortController();
		const gate = readabilityGate(hanging, questions, caller.signal, noWarn, 60_000);
		caller.abort();
		expect(await gate).toEqual({ kind: "cancelled" });
	});
});

describe("what the gate hands the judge", () => {
	it("finds codes, hashes and abbreviations but not links or plain words", () => {
		expect(candidateTerms(["按 #243 和 §3 做，见 https://example.com/pull/265，提交 d685d0d，F106 另开，SSH 入口，VM110 上跑"])).toEqual([
			"#243",
			"§3",
			"d685d0d",
			"F106",
			"SSH",
			"VM110",
		]);
	});

	it("splits prose at sentence ends and drops fragments too short to be one", () => {
		expect(sentencesOf(["选 B: 删掉序列化器。然后再复审一遍；合并", "好", "见 https://example.com/x 里的说明"])).toEqual([
			"选 B: 删掉序列化器",
			"然后再复审一遍",
			"见 <link> 里的说明",
		]);
	});
});

describe("the ask after a rejection", () => {
	const unreadable = scripted(() => ({ actor: 0 }));

	function askResult(content: string, isError: boolean): BranchEntry {
		return {
			type: "message",
			id: "r",
			parentId: null,
			timestamp: "2026-11-08T00:00:00Z",
			message: { role: "toolResult", toolCallId: "c", toolName: "ask", content: [{ type: "text", text: content }], isError, timestamp: 0 },
		};
	}

	async function rejection(): Promise<BranchEntry> {
		const gate = await readabilityGate(unreadable, questions, undefined, noWarn);
		if (gate.kind !== "reject") throw new Error("expected a rejection");
		const result = rejectedResult(gate.problems);
		return askResult(result.content.map((part) => (part.type === "text" ? part.text : "")).join(""), true);
	}

	const failing: NoulJudge = { judge: async () => Promise.reject(new Error("must not be asked")) };
	const run = (branch: readonly BranchEntry[], judge: NoulJudge) =>
		gateUnlessRetry(branch, () => readabilityGate(judge, questions, undefined, noWarn));

	it("goes through without asking the judge when the last ask in the session was rejected by the gate", async () => {
		expect(await run([await rejection()], failing)).toEqual({ kind: "pass" });
	});

	it("is judged when the session has no ask yet, or the last one was answered or rejected for another reason", async () => {
		expect((await run([], unreadable)).kind).toBe("reject");
		expect((await run([await rejection(), askResult("User answers:\nretry: 指数退避", false)], unreadable)).kind).toBe("reject");
		expect((await run([await rejection(), askResult("ask rejected:\n- another ask is open in this session", true)], unreadable)).kind).toBe(
			"reject",
		);
	});
});
