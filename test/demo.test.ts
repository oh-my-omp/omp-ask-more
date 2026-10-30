import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { halfBlockRows, loadDemo, rasterSize } from "../src/demo.ts";
import { tr } from "../src/i18n.ts";
import { demoSchema } from "../src/schema.ts";

describe("halfBlockRows", () => {
	it("draws the upper pixel as foreground and the lower as background, and resets each row", () => {
		// 1 × 2 pixels: red over blue.
		const frame = new Uint8Array([255, 0, 0, 0, 0, 255]);
		expect(halfBlockRows(frame, 1, 1)).toEqual(["\x1b[38;2;255;0;0;48;2;0;0;255m▀\x1b[0m"]);
	});

	it("repeats no color code for a run of equal cells", () => {
		const frame = new Uint8Array(2 * 2 * 3).fill(9);
		expect(halfBlockRows(frame, 2, 1)).toEqual(["\x1b[38;2;9;9;9;48;2;9;9;9m▀▀\x1b[0m"]);
	});

	it("rewrites only the color that changed from the previous cell", () => {
		// 2 × 2 pixels: the same upper pixel over two different lower pixels.
		const frame = new Uint8Array([1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
		expect(halfBlockRows(frame, 2, 1)).toEqual(["\x1b[38;2;1;1;1;48;2;2;2;2m▀\x1b[48;2;3;3;3m▀\x1b[0m"]);
	});
});

describe("rasterSize", () => {
	it("keeps the aspect ratio with two pixels per row", () => {
		expect(rasterSize(800, 200, 64)).toEqual({ width: 64, rows: 8 });
	});

	it("narrows a picture to the row cap instead of overflowing it", () => {
		expect(rasterSize(640, 480, 64)).toEqual({ width: 53, rows: 20 });
		expect(rasterSize(100, 1000, 64)).toEqual({ width: 4, rows: 20 });
	});
});

describe("loadDemo", () => {
	const dir = mkdtempSync(join(tmpdir(), "ask-more-demo-"));

	it("reports a missing file instead of failing the ask", async () => {
		expect(await loadDemo(demoSchema.parse({ kind: "file", path: "missing.gif" }), dir, "native", 64, undefined)).toEqual({
			kind: "error",
			path: "missing.gif",
			error: tr("file not found", "文件不存在"),
		});
	});

	it("reports a file that is not an image it can play", async () => {
		writeFileSync(join(dir, "fake.gif"), "plain text");
		expect(await loadDemo(demoSchema.parse({ kind: "file", path: "fake.gif" }), dir, "native", 64, undefined)).toMatchObject({
			kind: "error",
			error: tr("not a GIF, PNG or WebP image", "不是 GIF、PNG 或 WebP 图片"),
		});
	});

	it("hands Tern the image bytes as they are", async () => {
		const gif = Buffer.from("R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=", "base64");
		writeFileSync(join(dir, "dot.gif"), gif);
		const loaded = await loadDemo(demoSchema.parse({ kind: "file", path: "dot.gif", caption: " dot " }), dir, "native", 64, undefined);
		expect(loaded).toMatchObject({ kind: "image", mime: "image/gif", caption: "dot" });
		if (loaded?.kind === "image") expect(Buffer.from(loaded.bytes).equals(gif)).toBe(true);
	});

	it("plays frames at the default interval when none is given", async () => {
		expect(await loadDemo(demoSchema.parse({ kind: "frames", frames: [{ body: "a" }, { body: "b", caption: " " }] }), dir, "ansi", 64, undefined)).toEqual({
			kind: "frames",
			frames: [{ body: "a" }, { body: "b" }],
			intervalMs: 1200,
		});
	});
});
