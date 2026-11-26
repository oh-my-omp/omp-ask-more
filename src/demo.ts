import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileErrorText } from "./errors.ts";
import { sniffFile } from "./file-content.ts";
import type { AskQuestion, Demo, DemoFrame } from "./schema.ts";

export type ResolvedDemo =
	| { readonly kind: "image"; readonly path: string; readonly caption?: string }
	| { readonly kind: "link"; readonly url: string; readonly caption?: string }
	| { readonly kind: "unreadable"; readonly path: string; readonly error: string; readonly caption?: string }
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[] };

export interface QuestionDemos {
	readonly brief?: ResolvedDemo;
	readonly options: readonly (ResolvedDemo | undefined)[];
}

async function resolveDemo(demo: Demo, cwd: string): Promise<ResolvedDemo> {
	switch (demo.kind) {
		case "frames":
			return { kind: "frames", frames: demo.frames };
		case "file": {
			const absolute = resolve(cwd, demo.path);
			try {
				const info = await stat(absolute);
				if (info.isFile() && (await sniffFile(absolute, info.size)) === "picture") {
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
