import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEvidence } from "../src/brief.ts";
import { tr } from "../src/i18n.ts";
import { evidenceSchema } from "../src/schema.ts";

describe("resolveEvidence", () => {
	const dir = mkdtempSync(join(tmpdir(), "ask-more-brief-"));
	writeFileSync(join(dir, "five.ts"), ["one", "two", "three", "four", "five"].join("\n"));
	writeFileSync(join(dir, "crlf.txt"), "a\r\nb\r\nc\r\n");
	const numbered = Array.from({ length: 9000 }, (_, index) => `line ${index + 1} ${"x".repeat(60)}`);
	writeFileSync(join(dir, "large.txt"), `${numbered.join("\n")}\n`);
	const file = (fields: Record<string, unknown>) => evidenceSchema.parse({ kind: "file", ...fields });

	it("reads one line for a start alone, and cuts a window at the end of the file", async () => {
		const [single, cut] = await resolveEvidence([file({ path: "five.ts", start: 2 }), file({ path: "five.ts", start: 4, end: 40 })], dir);
		expect(single).toEqual({ kind: "file", path: "five.ts", start: 2, end: 2, lines: ["two"] });
		expect(cut).toEqual({ kind: "file", path: "five.ts", start: 4, end: 5, lines: ["four", "five"] });
	});

	it("reports a window that starts past the end of the file, counting a final newline as no line", async () => {
		const [past, afterNewline] = await resolveEvidence([file({ path: "five.ts", start: 9 }), file({ path: "crlf.txt", start: 4 })], dir);
		expect(past).toEqual({ kind: "unreadable", path: "five.ts", error: tr("line window is outside the file", "行段超出文件范围") });
		expect(afterNewline).toEqual({ kind: "unreadable", path: "crlf.txt", error: tr("line window is outside the file", "行段超出文件范围") });
	});

	it("reads a window out of a file larger than 512 KB, and a window of thousands of lines", async () => {
		const [middle, long] = await resolveEvidence([file({ path: "large.txt", start: 8000, end: 8002 }), file({ path: "large.txt", start: 1, end: 3000 })], dir);
		expect(middle).toEqual({ kind: "file", path: "large.txt", start: 8000, end: 8002, lines: numbered.slice(7999, 8002) });
		expect(long).toEqual({ kind: "file", path: "large.txt", start: 1, end: 3000, lines: numbered.slice(0, 3000) });
	});

	it("shows the first 40 lines without a window, and drops carriage returns", async () => {
		const [head, crlf] = await resolveEvidence([file({ path: "large.txt" }), file({ path: "crlf.txt", start: 1, end: 3 })], dir);
		expect(head).toEqual({ kind: "file", path: "large.txt", start: 1, end: 40, lines: numbered.slice(0, 40) });
		expect(crlf).toEqual({ kind: "file", path: "crlf.txt", start: 1, end: 3, lines: ["a", "b", "c"] });
	});

	it("shows quoted text as its lines under the source the model names, without reading anything", async () => {
		const [quoted] = await resolveEvidence(
			[evidenceSchema.parse({ kind: "text", source: "  bun test  ", text: "3 pass\n\t1 fail  \n", lang: "text", note: "after the change" })],
			join(dir, "missing"),
		);
		expect(quoted).toEqual({ kind: "text", source: "bun test", lang: "text", lines: ["3 pass", "  1 fail"], note: "after the change" });
	});
});
