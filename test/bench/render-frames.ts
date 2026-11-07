// Frame stepping on both surfaces (oh-my-omp/omp-ask-more#5 row 1): a raster demo plays as the focused
// option's demo and a frames demo as the question's, one tick per frame interval. Each tick draws the
// ANSI page and describes the native sheet, with large evidence under both so a page rebuild is visible.
//
//   bun test/bench/render-frames.ts [--ticks 100]
//
// Measured over the ticks: bytes requested from mimalloc per tick, and the number of `Array.join` calls
// on arrays over 100 lines — the evidence `join("\n")` a full page rebuild performs — and how many ticks
// lost the identity of the static question node the page was built with. Time per tick is reported.
// The digest covers every drawn page line and every described node tree, so both outputs must stay
// byte-identical.
import { join } from "node:path";
import { initThemeSync, type DescribeContext, type NativeNode } from "@oh-my-pi/pi-tui";
import type * as ComponentModule from "../../src/component.ts";
import type { ResolvedEvidence } from "../../src/brief.ts";
import type { LoadedDemo, QuestionDemos } from "../../src/demo.ts";
import { questionSchema } from "../../src/schema.ts";
import { compare, measured, parseArgs, report, sha256, VirtualClock } from "./harness.ts";

const args = parseArgs(process.argv.slice(2));
const ticks = Number(args.options.get("ticks") ?? 100);
/** An 80-column terminal, tall enough to show the whole page. */
const WIDTH = 80;
const ROWS = 40;
/** The raster demo's cells; each cell is two pixels tall. */
const CELLS_W = 53;
const CELLS_H = 20;
const RASTER_FRAMES = 30;
const INTERVAL_MS = 100;

const CX: DescribeContext = { cols: 120, reduceMotion: false, dark: true, supports: () => true, feature: () => true };

/** A frame of varied pixels, so every cell of the encoding differs between frames. */
function rasterFrame(frame: number): Uint8Array {
	const bytes = new Uint8Array(CELLS_W * CELLS_H * 2 * 3);
	for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 7 + frame * 31) & 0xff;
	return bytes;
}

/** The node built for `key` anywhere in `root`, or undefined. Components are describe boundaries, not nodes. */
function findKeyed(root: NativeNode, key: string): NativeNode | undefined {
	if (root.key === key) return root;
	for (const child of root.c ?? []) {
		if (!("k" in child)) continue;
		const found = findKeyed(child, key);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * Hash the content of a described tree without materializing it. `JSON.stringify` of one tick's tree
 * copies the joined evidence text and allocates megabytes for it, which would drown the very
 * measurement; every key, prop and child here is hashed where it already lives, and the digest still
 * covers the whole tree. A long string is hashed the first time it is seen and referenced after that:
 * every tick describes the same evidence text, and re-hashing it would cost as much as a page rebuild
 * — which is the number this bench measures.
 */
function hashValue(hasher: Bun.CryptoHasher, seen: Map<string, number>, value: unknown): void {
	switch (typeof value) {
		case "string": {
			const known = value.length > 64 ? seen.get(value) : undefined;
			if (known !== undefined) {
				hasher.update(`S${known};`);
				return;
			}
			if (value.length > 64) seen.set(value, seen.size);
			hasher.update(`s${value.length}:${value}`);
			return;
		}
		case "number":
			hasher.update(`n${value};`);
			return;
		case "boolean":
			hasher.update(value ? "true" : "false");
			return;
		case "undefined":
			hasher.update("undefined");
			return;
		case "object": {
			if (value === null) {
				hasher.update("null");
				return;
			}
			if (Array.isArray(value)) {
				hasher.update(`a${value.length}[`);
				for (const item of value) hashValue(hasher, seen, item);
				hasher.update("]");
				return;
			}
			const record = value as Readonly<Record<string, unknown>>;
			const keys = Object.keys(record).sort();
			hasher.update(`o${keys.length}{`);
			for (const key of keys) {
				hasher.update(`${key.length}:${key}=`);
				hashValue(hasher, seen, record[key]);
			}
			hasher.update("}");
			return;
		}
		case "function":
		case "symbol":
		case "bigint":
			hasher.update(value.toString());
			return;
	}
}

function hashNode(hasher: Bun.CryptoHasher, seen: Map<string, number>, node: NativeNode): void {
	hasher.update(`k${node.k}`);
	hasher.update(`|${node.key ?? ""}|`);
	hashValue(hasher, seen, node.reveal);
	hashValue(hasher, seen, node.scroll);
	hashValue(hasher, seen, node.p);
	for (const child of node.c ?? []) {
		// A component child describes itself; these pages mount one only in the Other field, which this
		// bench never opens.
		if ("k" in child) hashNode(hasher, seen, child);
		else hasher.update("|component|");
	}
	hasher.update(";");
}

if (args.worker) {
	// The module comes from the `--src` this worker measures (baseline or head), so the path is only known at run time.
	const { AskMoreComponent } = (await import(join(args.src, "component.ts"))) as typeof ComponentModule;
	const question = questionSchema.parse({
		id: "playback",
		header: "Playback",
		question: "Which rendering should the dialog keep playing while the cursor rests on Drop?",
		brief: {
			where: "the ANSI page and the Tern sheet both draw the demo below",
			what: "decide whether a frame step may rebuild the whole page",
			how: "each frame redraws only the demo region",
			diagram: "flowchart LR\n  tick --> frame\n  frame --> page",
			risks: ["a full rebuild per frame keeps every evidence line joined at every tick", "a page-sized copy per frame keeps a second row array alive"],
		},
		options: [
			{ label: "Keep", tradeoff: "the clip keeps playing" },
			{ label: "Drop", tradeoff: "the clip stops" },
		],
	});
	const evidence: readonly ResolvedEvidence[] = [
		{ kind: "file", path: "src/component.ts", start: 1, end: 20000, lines: Array.from({ length: 20000 }, (_, line) => `const line${line} = "${"x".repeat(40)}";`) },
		{ kind: "text", source: "bun test", lines: Array.from({ length: 12000 }, (_, line) => `ok ${line} - case ${line} passes with ${"y".repeat(30)}`) },
	];
	const raster: LoadedDemo = {
		kind: "raster",
		path: "clip.gif",
		width: CELLS_W,
		rows: CELLS_H,
		frames: Array.from({ length: RASTER_FRAMES }, (_, frame) => rasterFrame(frame)),
		intervalMs: INTERVAL_MS,
		caption: "the clip",
	};
	const frames: LoadedDemo = {
		kind: "frames",
		frames: [1, 2, 3, 4].map(step => ({ body: `# frame ${step}\n\n- status ${step}` })),
		intervalMs: INTERVAL_MS,
		caption: "the question's own demo",
	};
	const demos: readonly QuestionDemos[] = [{ question: frames, options: [raster] }];

	initThemeSync();
	const clock = new VirtualClock(ROWS);
	const component = new AskMoreComponent({ tui: clock, questions: [question], evidence: [evidence], demos, finish: () => {}, timeout: { kind: "off" }, notify: () => {} });
	const hasher = new Bun.CryptoHasher("sha256");
	const seen = new Map<string, number>();
	// One page before the window: neither variant is charged for its first build.
	for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);
	const firstQuestion = findKeyed(component.describe(CX), "question");

	let bigJoins = 0;
	let staticNodeChanges = 0;
	const originalJoin = Array.prototype.join;
	const countingJoin = function (this: readonly unknown[], separator?: string): string {
		if (this.length > 100) bigJoins++;
		return originalJoin.call(this, separator);
	};
	Array.prototype.join = countingJoin;
	const { ms, mallocMiB } = await measured(() => {
		for (let tick = 0; tick < ticks; tick++) {
			clock.advance(INTERVAL_MS);
			for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);
			const tree = component.describe(CX);
			if (findKeyed(tree, "question") !== firstQuestion) staticNodeChanges++;
			hashNode(hasher, seen, tree);
		}
	});
	Array.prototype.join = originalJoin;
	component.dispose();
	if (clock.renders < ticks) throw new Error(`the demos stepped ${clock.renders} times in ${ticks} ticks`);
	report({
		metrics: {
			mallocKiBPerTick: (mallocMiB * 1024) / ticks,
			bigJoins,
			staticNodeChanges,
			msPerTick: ms / ticks,
		},
		units: ticks,
		digest: sha256(hasher.digest("hex"), String(ticks)),
		notes: { frames: RASTER_FRAMES, raster: `${CELLS_W}x${CELLS_H}`, steps: clock.renders },
	});
} else {
	await compare(import.meta.path, args, `render-frames: frame stepping in AskMoreComponent, ${ticks} ticks`, [
		{ name: "mallocKiBPerTick", unit: "KiB malloc per tick", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "bigJoins", unit: "joins over 100 lines", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "staticNodeChanges", unit: "ticks that rebuilt the static page", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "msPerTick", unit: "ms", expect: { kind: "report" } },
	]);
}
