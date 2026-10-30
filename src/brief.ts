// Evidence comes in two kinds. For a file the model names a path and an optional line window and the
// tool reads those lines itself, so the panel shows the file's real lines rather than a copy the model
// typed. Text the model quotes from elsewhere (a command's output, a page, a log) is shown as quoted,
// with the source the model names; the tool does not check it. A file that cannot be read is
// reported in its place, never fatal.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { tr } from "./i18n.ts";
import type { EvidenceRef, FileEvidence, TextEvidence } from "./schema.ts";

/** Lines drawn when a file reference names no window. */
const HEAD_LINES = 40;

export type ResolvedEvidence =
	| { readonly kind: "file"; readonly path: string; readonly start: number; readonly end: number; readonly lines: readonly string[]; readonly note?: string }
	| { readonly kind: "directory"; readonly path: string; readonly note?: string }
	| { readonly kind: "text"; readonly source: string; readonly lang?: string; readonly lines: readonly string[]; readonly note?: string }
	| { readonly kind: "unreadable"; readonly path: string; readonly error: string; readonly note?: string };

/** A line as the panels draw it: tabs as two spaces, no trailing whitespace. */
function displayLine(line: string): string {
	return line.replace(/\t/g, "  ").replace(/\s+$/u, "");
}

function noteOf(ref: EvidenceRef): { note?: string } {
	const note = ref.note?.trim();
	return note ? { note } : {};
}

/**
 * The window a file reference names: its first lines without `start`, one line with `start` alone,
 * `start`-`end` inclusive otherwise.
 */
function fileWindow(ref: FileEvidence): { start: number; end: number } {
	if (ref.start === undefined) return { start: 1, end: HEAD_LINES };
	return { start: ref.start, end: ref.end ?? ref.start };
}

/** Lines `start`-`end` of the file, read up to `end` and no further; fewer when the file ends first. */
async function readWindow(absolute: string, start: number, end: number): Promise<string[]> {
	const stream = createReadStream(absolute, { encoding: "utf8" });
	const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	const lines: string[] = [];
	let number = 0;
	try {
		for await (const line of reader) {
			number++;
			if (number < start) continue;
			lines.push(displayLine(line));
			if (number >= end) break;
		}
	} finally {
		reader.close();
		stream.destroy();
	}
	return lines;
}

async function readFileRef(ref: FileEvidence, cwd: string): Promise<ResolvedEvidence> {
	const note = noteOf(ref);
	const absolute = isAbsolute(ref.path) ? ref.path : resolve(cwd, ref.path);
	try {
		if ((await stat(absolute)).isDirectory()) return { kind: "directory", path: ref.path, ...note };
		const window = fileWindow(ref);
		const lines = await readWindow(absolute, window.start, window.end);
		if (lines.length === 0) {
			return { kind: "unreadable", path: ref.path, error: tr("line window is outside the file", "行段超出文件范围"), ...note };
		}
		return { kind: "file", path: ref.path, start: window.start, end: window.start + lines.length - 1, lines, ...note };
	} catch (error) {
		const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
		const reason = missing ? tr("file not found", "文件不存在") : error instanceof Error ? error.message : String(error);
		return { kind: "unreadable", path: ref.path, error: reason, ...note };
	}
}

function quotedText(ref: TextEvidence): ResolvedEvidence {
	const lines = ref.text.replace(/\r?\n$/, "").split(/\r?\n/).map(displayLine);
	return { kind: "text", source: ref.source.trim(), ...(ref.lang ? { lang: ref.lang } : {}), lines, ...noteOf(ref) };
}

function resolveRef(ref: EvidenceRef, cwd: string): Promise<ResolvedEvidence> {
	switch (ref.kind) {
		case "file":
			return readFileRef(ref, cwd);
		case "text":
			return Promise.resolve(quotedText(ref));
	}
}

export async function resolveEvidence(refs: readonly EvidenceRef[] | undefined, cwd: string): Promise<readonly ResolvedEvidence[]> {
	if (refs === undefined) return [];
	return Promise.all(refs.map(ref => resolveRef(ref, cwd)));
}
