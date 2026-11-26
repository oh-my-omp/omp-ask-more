import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseImageMetadata } from "@oh-my-pi/pi-utils";
import { fileErrorText } from "./errors.ts";
import type { AskQuestion, Demo, DemoFrame } from "./schema.ts";

const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const SNIFF_BYTES = 4096;
const RASTER_HEAD_BYTES = 64;

export type ResolvedDemo =
	| { readonly kind: "image"; readonly path: string; readonly caption?: string }
	| { readonly kind: "link"; readonly url: string; readonly caption?: string }
	| { readonly kind: "unreadable"; readonly path: string; readonly error: string; readonly caption?: string }
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[] };

export interface QuestionDemos {
	readonly brief?: ResolvedDemo;
	readonly options: readonly (ResolvedDemo | undefined)[];
}

async function isPicture(absolute: string): Promise<boolean> {
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
	switch (demo.kind) {
		case "frames":
			return { kind: "frames", frames: demo.frames };
		case "file": {
			const absolute = resolve(cwd, demo.path);
			try {
				const info = await stat(absolute);
				if (info.isFile() && info.size <= MAX_PICTURE_BYTES && (await isPicture(absolute))) {
					return { kind: "image", path: absolute, caption: demo.caption };
				}
				return { kind: "link", url: pathToFileURL(absolute).href, caption: demo.caption };
			} catch (error) {
				return { kind: "unreadable", path: demo.path, error: fileErrorText(error), caption: demo.caption };
			}
		}
	}
}

export async function resolveDemos(question: AskQuestion, cwd: string): Promise<QuestionDemos> {
	const [brief, ...options] = await Promise.all(
		[question.brief.demo, ...question.options.map((option) => option.demo)].map((demo) =>
			demo === undefined ? undefined : resolveDemo(demo, cwd),
		),
	);
	return { brief, options };
}
