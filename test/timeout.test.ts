import { describe, expect, it } from "bun:test";
import { answerResult, timedOutResult } from "../src/result.ts";
import { type AskQuestion, questionSchema } from "../src/schema.ts";
import { type TimeoutSettings, timeoutPolicy } from "../src/timeout.ts";

const BASE: TimeoutSettings = { timeoutSeconds: 1800, returnSeconds: 1200, onExpiry: "decide", terminal: true, command: { kind: "unset" } };

describe("timeoutPolicy", () => {
	it("notifies through the terminal, then decides after the return window, by default", () => {
		expect(timeoutPolicy(BASE)).toEqual({
			policy: { kind: "notify", idleMs: 1_800_000, channels: [{ kind: "terminal" }], then: { kind: "decide", returnMs: 1_200_000 } },
			problems: [],
		});
	});

	it("turns timing off at 0 seconds, whatever the channels", () => {
		expect(timeoutPolicy({ ...BASE, timeoutSeconds: 0, command: { kind: "set", command: "true", fromProject: false } }).policy).toEqual({ kind: "off" });
	});

	it("decides at the first deadline when no channel is on, and never times out when it would only wait", () => {
		expect(timeoutPolicy({ ...BASE, terminal: false }).policy).toEqual({ kind: "decide", idleMs: 1_800_000 });
		expect(timeoutPolicy({ ...BASE, terminal: false, onExpiry: "wait" }).policy).toEqual({ kind: "off" });
	});

	it("sends through both channels and keeps waiting after them when the expiry is wait", () => {
		expect(timeoutPolicy({ ...BASE, onExpiry: "wait", command: { kind: "set", command: "notify-me", fromProject: false } }).policy).toEqual({
			kind: "notify",
			idleMs: 1_800_000,
			channels: [{ kind: "terminal" }, { kind: "command", command: "notify-me" }],
			then: { kind: "wait" },
		});
	});

	it("does not run a command set by a project config, and says so", () => {
		const parsed = timeoutPolicy({ ...BASE, terminal: false, command: { kind: "set", command: "curl evil", fromProject: true } });
		expect(parsed.policy).toEqual({ kind: "decide", idleMs: 1_800_000 });
		expect(parsed.problems).toHaveLength(1);
		expect(parsed.problems[0]).toContain("askMore.notify.command");
	});
});

function question(id: string): AskQuestion {
	return questionSchema.parse({
		id,
		question: `Pick ${id}`,
		brief: { where: "now", what: "decide", how: "after" },
		options: [
			{ label: "x", tradeoff: "x costs" },
			{ label: "y", tradeoff: "y costs" },
		],
	});
}

describe("timed-out result", () => {
	it("keeps the answers and leaves only the unanswered questions to the model", () => {
		const questions = [question("a"), question("b"), question("c")];
		const result = timedOutResult(questions, [{ kind: "option", index: 1 }, { kind: "unanswered" }, { kind: "custom", text: "mine" }]);
		expect(result.content).toEqual([
			{ type: "text", text: 'User answers:\na: y\nb: (timed out: the user did not answer; decide it yourself with your best judgment)\nc: "mine"' },
		]);
		expect(result.details?.results?.map(entry => [entry.selectedOptions, entry.customInput])).toEqual([[["y"], undefined], [[], undefined], [[], "mine"]]);
	});

	it("leaves a submitted unanswered question as cancelled", () => {
		const result = answerResult([question("a")], []);
		expect(result.content).toEqual([{ type: "text", text: "User answers:\na: (cancelled)" }]);
	});
});
