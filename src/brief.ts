import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { tr } from "../omomp-shared/i18n.ts";
import { fileErrorText } from "./errors.ts";
import type { EvidenceRef, FileEvidence, TextEvidence } from "./schema.ts";

const HEAD_LINES = 40;

export type ResolvedEvidence =
	| {
			readonly kind: "file";
			readonly path: string;
			readonly start: number;
			readonly end: number;
			readonly lines: readonly string[];
			readonly note?: string;
	  }
	| { readonly kind: "directory"; readonly path: string; readonly note?: string }
	| { readonly kind: "text"; readonly source: string; readonly lang?: string; readonly lines: readonly string[]; readonly note?: string }
	| { readonly kind: "unreadable"; readonly path: string; readonly error: string; readonly note?: string };

function displayLine(line: string): string {
	return line.replace(/\t/g, "  ").replace(/\s+$/u, "");
}

function fileWindow(ref: FileEvidence): { start: number; end: number } {
	if (ref.start === undefined) return { start: 1, end: HEAD_LINES };
	return { start: ref.start, end: ref.end ?? ref.start };
}

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
	const note = ref.note?.trim() || undefined;
	const absolute = resolve(cwd, ref.path);
	try {
		if ((await stat(absolute)).isDirectory()) return { kind: "directory", path: ref.path, note };
		const window = fileWindow(ref);
		const lines = await readWindow(absolute, window.start, window.end);
		if (lines.length === 0) {
			return { kind: "unreadable", path: ref.path, error: tr("line window is outside the file", "行段超出文件范围"), note };
		}
		return { kind: "file", path: ref.path, start: window.start, end: window.start + lines.length - 1, lines, note };
	} catch (error) {
		return { kind: "unreadable", path: ref.path, error: fileErrorText(error), note };
	}
}

function quotedText(ref: TextEvidence): ResolvedEvidence {
	const lines = ref.text
		.replace(/\r?\n$/, "")
		.split(/\r?\n/)
		.map(displayLine);
	return { kind: "text", source: ref.source.trim(), lang: ref.lang, lines, note: ref.note?.trim() || undefined };
}

function resolveRef(ref: EvidenceRef, cwd: string): Promise<ResolvedEvidence> {
	switch (ref.kind) {
		case "file":
			return readFileRef(ref, cwd);
		case "text":
			return Promise.resolve(quotedText(ref));
	}
}

export function resolveEvidence(refs: readonly EvidenceRef[], cwd: string): Promise<readonly ResolvedEvidence[]> {
	return Promise.all(refs.map((ref) => resolveRef(ref, cwd)));
}
