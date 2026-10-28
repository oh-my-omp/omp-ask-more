// Evidence: the model cites `path:lines`; the tool reads the file, so the panel shows real lines
// instead of model-typed code. A reference that cannot be read is reported, never fatal.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tr } from "./i18n.ts";
// Backstops behind `validate`'s identical limits: nothing it accepts is ever clipped here.
import { MAX_EVIDENCE_LINES, MAX_EVIDENCE_REFS, type EvidenceRef } from "./schema.ts";

/** Largest file read to satisfy one reference. */
const MAX_BYTES = 512 * 1024;
/** Lines drawn when the reference names no window. */
const HEAD_LINES = 40;

export type ResolvedEvidence =
	| {
			readonly ok: true;
			readonly path: string;
			readonly start: number;
			readonly end: number;
			readonly lines: readonly string[];
			readonly note?: string;
	  }
	| { readonly ok: false; readonly path: string; readonly note?: string; readonly error: string };

function parseWindow(spec: string | undefined, total: number): { start: number; end: number } | null {
	if (spec === undefined || spec.trim() === "") return { start: 1, end: Math.min(total, HEAD_LINES) };
	const match = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
	if (!match) return null;
	const first = Number(match[1]);
	const last = match[2] === undefined ? first : Number(match[2]);
	const start = Math.max(1, Math.min(first, last));
	const end = Math.min(total, Math.max(first, last), start + MAX_EVIDENCE_LINES - 1);
	return end < start ? null : { start, end };
}

async function readRef(ref: EvidenceRef, cwd: string): Promise<ResolvedEvidence> {
	const note = ref.note?.trim() ? ref.note.trim() : undefined;
	const absolute = isAbsolute(ref.path) ? ref.path : resolve(cwd, ref.path);
	try {
		const info = await stat(absolute);
		if (info.isDirectory()) {
			return { ok: true, path: ref.path, start: 0, end: 0, lines: [], ...(note ? { note } : {}) };
		}
		if (info.size > MAX_BYTES) {
			return { ok: false, path: ref.path, ...(note ? { note } : {}), error: tr(`file is larger than ${MAX_BYTES} bytes`, `文件超过 ${MAX_BYTES} 字节`) };
		}
		const text = await readFile(absolute, "utf8");
		const all = text.split("\n");
		const window = parseWindow(ref.lines, all.length);
		if (window === null) {
			return { ok: false, path: ref.path, ...(note ? { note } : {}), error: tr("line window is outside the file", "行段超出文件范围") };
		}
		return {
			ok: true,
			path: ref.path,
			start: window.start,
			end: window.end,
			lines: all.slice(window.start - 1, window.end).map(line => line.replace(/\t/g, "  ").replace(/\s+$/u, "")),
			...(note ? { note } : {}),
		};
	} catch (error) {
		const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
		const reason = missing ? tr("file not found", "文件不存在") : error instanceof Error ? error.message : String(error);
		return { ok: false, path: ref.path, ...(note ? { note } : {}), error: reason };
	}
}

export async function resolveEvidence(refs: readonly EvidenceRef[] | undefined, cwd: string): Promise<readonly ResolvedEvidence[]> {
	if (refs === undefined) return [];
	return Promise.all(refs.slice(0, MAX_EVIDENCE_REFS).map(ref => readRef(ref, cwd)));
}
