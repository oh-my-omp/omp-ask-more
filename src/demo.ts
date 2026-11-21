// A file demo is drawn as a picture only when the host's form can load it as one: the same size cap
// and the same leading-bytes test as `loadMedia`. Every other file goes in as a file:// link the
// terminal can pick up.
import { open, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_MEDIA_BYTES } from "@oh-my-pi/pi-tui/media";
import { parseImageMetadata } from "@oh-my-pi/pi-utils";
import { tr } from "../omomp-shared/i18n.ts";
import type { AskQuestion, Demo, DemoFrame } from "./schema.ts";

const SNIFF_BYTES = 4096;
const RASTER_HEAD_BYTES = 64;

export type ResolvedDemo =
	| { readonly kind: "image"; readonly path: string; readonly caption?: string }
	| { readonly kind: "link"; readonly url: string; readonly caption?: string }
	| { readonly kind: "unreadable"; readonly path: string; readonly error: string; readonly caption?: string }
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[]; readonly caption?: string };

export interface QuestionDemos {
	readonly brief?: ResolvedDemo;
	readonly options: readonly (ResolvedDemo | undefined)[];
}

async function isPicture(absolute: string): Promise<boolean> {
	if ((await stat(absolute)).size > MAX_MEDIA_BYTES) return false;
	const handle = await open(absolute, "r");
	try {
		const head = new Uint8Array(SNIFF_BYTES);
		const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
		const bytes = head.subarray(0, bytesRead);
		if (parseImageMetadata(bytes.subarray(0, RASTER_HEAD_BYTES))) return true;
		return /<svg[\s>]/i.test(new TextDecoder().decode(bytes));
	} finally {
		await handle.close();
	}
}

async function resolveDemo(demo: Demo, cwd: string): Promise<ResolvedDemo> {
	const caption = demo.caption === undefined ? {} : { caption: demo.caption };
	switch (demo.kind) {
		case "frames":
			return { kind: "frames", frames: demo.frames, ...caption };
		case "file": {
			const absolute = isAbsolute(demo.path) ? demo.path : resolve(cwd, demo.path);
			try {
				if ((await stat(absolute)).isDirectory()) return { kind: "link", url: pathToFileURL(absolute).href, ...caption };
				if (await isPicture(absolute)) return { kind: "image", path: absolute, ...caption };
				return { kind: "link", url: pathToFileURL(absolute).href, ...caption };
			} catch (error) {
				const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
				const reason = missing ? tr("file not found", "文件不存在") : error instanceof Error ? error.message : String(error);
				return { kind: "unreadable", path: demo.path, error: reason, ...caption };
			}
		}
	}
}

export async function resolveDemos(question: AskQuestion, cwd: string): Promise<QuestionDemos> {
	const [brief, ...options] = await Promise.all([
		question.brief.demo === undefined ? undefined : resolveDemo(question.brief.demo, cwd),
		...question.options.map((option) => (option.demo === undefined ? undefined : resolveDemo(option.demo, cwd))),
	]);
	return { ...(brief === undefined ? {} : { brief }), options };
}
