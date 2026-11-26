import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tr } from "../omomp-shared/i18n.ts";
import { resolveEvidence } from "../src/brief.ts";
import type { FileEvidence } from "../src/schema.ts";

describe("resolveEvidence", () => {
	const dir = mkdtempSync(join(tmpdir(), "ask-ng-brief-"));
	writeFileSync(join(dir, "five.ts"), ["one", "two", "three", "four", "five"].join("\n"));
	writeFileSync(join(dir, "crlf.txt"), "a\r\nb\r\nc\r\n");
	const numbered = Array.from({ length: 9000 }, (_, index) => `line ${index + 1} ${"x".repeat(60)}`);
	writeFileSync(join(dir, "large.txt"), `${numbered.join("\n")}\n`);
	const file = (fields: Omit<FileEvidence, "kind">): FileEvidence => ({ kind: "file", ...fields });
	writeFileSync(
		join(dir, "dot.gif"),
		Uint8Array.from([
			0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04,
			0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
		]),
	);
	writeFileSync(join(dir, "tool.bin"), Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));
	writeFileSync(join(dir, "wide.txt"), `${"x".repeat(4095)}中\nsecond\n`);

	it("reads one line for a start alone, and cuts a window at the end of the file", async () => {
		const [single, cut] = await resolveEvidence([file({ path: "five.ts", start: 2 }), file({ path: "five.ts", start: 4, end: 40 })], dir);
		expect(single).toEqual({ kind: "file", path: "five.ts", start: 2, end: 2, lines: ["two"] });
		expect(cut).toEqual({ kind: "file", path: "five.ts", start: 4, end: 5, lines: ["four", "five"] });
	});

	it("reports a window that starts past the end of the file, counting a final newline as no line", async () => {
		const [past, afterNewline] = await resolveEvidence([file({ path: "five.ts", start: 9 }), file({ path: "crlf.txt", start: 4 })], dir);
		expect(past).toEqual({ kind: "unreadable", path: "five.ts", error: tr("line window is outside the file", "行段超出文件范围") });
		expect(afterNewline).toEqual({
			kind: "unreadable",
			path: "crlf.txt",
			error: tr("line window is outside the file", "行段超出文件范围"),
		});
	});

	it("reads a window out of a file larger than 512 KB, and a window of thousands of lines", async () => {
		const [middle, long] = await resolveEvidence(
			[file({ path: "large.txt", start: 8000, end: 8002 }), file({ path: "large.txt", start: 1, end: 3000 })],
			dir,
		);
		expect(middle).toEqual({ kind: "file", path: "large.txt", start: 8000, end: 8002, lines: numbered.slice(7999, 8002) });
		expect(long).toEqual({ kind: "file", path: "large.txt", start: 1, end: 3000, lines: numbered.slice(0, 3000) });
	});

	it("shows the first 40 lines without a window, and drops carriage returns", async () => {
		const [head, crlf] = await resolveEvidence([file({ path: "large.txt" }), file({ path: "crlf.txt", start: 1, end: 3 })], dir);
		expect(head).toEqual({ kind: "file", path: "large.txt", start: 1, end: 40, lines: numbered.slice(0, 40) });
		expect(crlf).toEqual({ kind: "file", path: "crlf.txt", start: 1, end: 3, lines: ["a", "b", "c"] });
	});

	it("shows a picture as an image at its absolute path and any other non-text file as binary, reading no lines", async () => {
		const [picture, binary] = await resolveEvidence(
			[file({ path: "dot.gif", start: 1, end: 3, note: "the dot" }), file({ path: "tool.bin", note: "an executable" })],
			dir,
		);
		expect(picture).toEqual({ kind: "image", path: "dot.gif", src: join(dir, "dot.gif"), note: "the dot" });
		expect(binary).toEqual({ kind: "binary", path: "tool.bin", note: "an executable" });
	});

	it("reads a UTF-8 file whose first 4096 bytes end inside a character as text", async () => {
		const [wide] = await resolveEvidence([file({ path: "wide.txt", start: 2 })], dir);
		expect(wide).toEqual({ kind: "file", path: "wide.txt", start: 2, end: 2, lines: ["second"] });
	});

	it("shows quoted text as its lines under the source the model names, without reading anything", async () => {
		const [quoted] = await resolveEvidence(
			[{ kind: "text", source: "  bun test  ", text: "3 pass\n\t1 fail  \n", lang: "text", note: "after the change" }],
			join(dir, "missing"),
		);
		expect(quoted).toEqual({ kind: "text", source: "bun test", lang: "text", lines: ["3 pass", "  1 fail"], note: "after the change" });
	});
});
