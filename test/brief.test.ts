import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEvidence } from "../src/brief.ts";
import { tr } from "../src/i18n.ts";

describe("resolveEvidence", () => {
	const dir = mkdtempSync(join(tmpdir(), "ask-more-brief-"));
	writeFileSync(join(dir, "five.ts"), ["one", "two", "three", "four", "five"].join("\n"));

	it("reads one line for a start alone, and cuts a window at the end of the file", async () => {
		const [single, cut] = await resolveEvidence(
			[
				{ path: "five.ts", start: 2, end: undefined, note: undefined },
				{ path: "five.ts", start: 4, end: 40, note: undefined },
			],
			dir,
		);
		expect(single).toEqual({ ok: true, path: "five.ts", start: 2, end: 2, lines: ["two"] });
		expect(cut).toEqual({ ok: true, path: "five.ts", start: 4, end: 5, lines: ["four", "five"] });
	});

	it("reports a window that starts past the end of the file", async () => {
		const [past] = await resolveEvidence([{ path: "five.ts", start: 9, end: undefined, note: undefined }], dir);
		expect(past).toEqual({ ok: false, path: "five.ts", error: tr("line window is outside the file", "行段超出文件范围") });
	});
});
