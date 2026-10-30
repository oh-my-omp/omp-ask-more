// Evidence on the ANSI page: a line wider than the page is cut with how much was left out, so
// nothing disappears at the box edge without a trace.
import { describe, expect, it } from "bun:test";
import { initThemeSync, visibleWidth } from "@oh-my-pi/pi-tui";
import type { ResolvedEvidence } from "../src/brief.ts";
import { AskMoreComponent, type SheetHost } from "../src/component.ts";
import { questionSchema } from "../src/schema.ts";

initThemeSync();

const HOST: SheetHost = { scheduleAfter: () => ({ cancel() {} }), requestComponentRender() {}, terminal: { rows: 200 } };
const plain = (row: string) => row.replace(/\x1b\[[0-9;]*m/g, "");

function page(evidence: readonly ResolvedEvidence[], width: number): string[] {
	const question = questionSchema.parse({
		id: "q",
		question: "Pick one",
		brief: { where: "w", what: "x", how: "h" },
		options: [
			{ label: "A", tradeoff: "a" },
			{ label: "B", tradeoff: "b" },
		],
	});
	const component = new AskMoreComponent({ tui: HOST, questions: [question], evidence: [evidence], demos: [{ question: undefined, options: [] }], finish() {}, timeout: { kind: "off" }, notify() {} });
	return component.render(width).map(plain);
}

describe("ANSI evidence lines", () => {
	it("cuts a line wider than the page and counts the characters left out", () => {
		const long = `const LONG = "${"x".repeat(3000)}";`;
		const rows = page([{ kind: "text", source: "minified.js", lines: ["short", long] }], 100);
		for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(100);
		const marker = /^│\s+(const LONG = "x*) … (?:(\d+) more characters|还有 (\d+) 个字符)\s*│/u;
		const cut = rows.map(row => marker.exec(row)).find(match => match !== null);
		expect(cut).toBeDefined();
		const kept = cut![1]!;
		const left = Number(cut![2] ?? cut![3]);
		expect(long.startsWith(kept)).toBe(true);
		expect(kept.length + left).toBe(long.length);
	});
});
