// What a closed dialog still retains (oh-my-omp/omp-ask-more#5 row 3): 30 construct → draw → answer →
// dispose → drop cycles with large evidence and raster demos, then a kept phase that disposes the same
// components but keeps them alive, to show what a retained component holds. The host
// (extension-ui-controller `showHookCustom`) calls `dispose()`, hides the overlay and keeps the
// component only in its own closures, so the dropped phase is the one the user sees.
//
//   bun test/bench/render-dispose.ts [--asks 30]
//
// Measured per cycle after a full GC: the JS heap (bun:jsc `heapSize`) and mimalloc's committed bytes.
// The metric is the growth over the cycles; the kept phase's retention per component is reported. The
// digest covers every drawn page and the first cycle's node tree, so the page must stay byte-identical.
import { join } from "node:path";
import { heapSize } from "bun:jsc";
import { initThemeSync, type DescribeContext, type NativeNode } from "@oh-my-pi/pi-tui";
import type { AskMoreComponent as AskMore } from "../../src/component.ts";
import type * as ComponentModule from "../../src/component.ts";
import type { ResolvedEvidence } from "../../src/brief.ts";
import type { LoadedDemo, QuestionDemos } from "../../src/demo.ts";
import { questionSchema } from "../../src/schema.ts";
import { compare, mallocNow, measured, parseArgs, report, sha256, VirtualClock } from "./harness.ts";

const args = parseArgs(process.argv.slice(2));
const asks = Number(args.options.get("asks") ?? 30);
/** Components the kept phase disposes and then holds, to show what each one retains. */
const KEPT = 5;
/** An 80-column terminal, tall enough to show the whole page. */
const WIDTH = 80;
const ROWS = 40;
/** Lines per evidence reference; four of them at ~60 characters make the ~10 MB page. */
const LINES = 50_000;
const CELLS_W = 53;
const CELLS_H = 20;
const RASTER_FRAMES = 30;

const CX: DescribeContext = { cols: 120, reduceMotion: false, dark: true, supports: () => true, feature: () => true };

/** A frame of varied pixels, so every cell of the encoding differs between frames. */
function rasterFrame(frame: number): Uint8Array {
	const bytes = new Uint8Array(CELLS_W * CELLS_H * 2 * 3);
	for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 7 + frame * 31) & 0xff;
	return bytes;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

if (args.worker) {
	// The module comes from the `--src` this worker measures (baseline or head), so the path is only known at run time.
	const { AskMoreComponent } = (await import(join(args.src, "component.ts"))) as typeof ComponentModule;
	const question = questionSchema.parse({
		id: "retention",
		header: "Retention",
		question: "Which rendering should the dialog keep playing while the cursor rests on Drop?",
		brief: {
			where: "a closed dialog is disposed and dropped by the host",
			what: "decide whether dispose must drop the page's large objects itself",
			how: "each construction is answered, disposed and dropped",
			risks: ["a retained component keeps every evidence line alive"],
		},
		options: [
			{ label: "Keep", tradeoff: "the dialog keeps its current cost" },
			{ label: "Drop", tradeoff: "the page releases its references on dispose" },
		],
	});
	const raster: LoadedDemo = {
		kind: "raster",
		path: "clip.gif",
		width: CELLS_W,
		rows: CELLS_H,
		frames: Array.from({ length: RASTER_FRAMES }, (_, frame) => rasterFrame(frame)),
		intervalMs: 100,
		caption: "the clip",
	};
	const demos: readonly QuestionDemos[] = [{ question: undefined, options: [raster] }];
	/** The page's evidence, its own arrays per construction so a dropped page can be collected. */
	const evidenceFor = (cycle: number): readonly ResolvedEvidence[] => {
		const lines = (tag: string) => Array.from({ length: LINES }, (_, index) => `${tag} ${index} of cycle ${cycle} ${"z".repeat(40)}`);
		return [
			{ kind: "file", path: "src/component.ts", start: 1, end: LINES, lines: lines("const line =") },
			{ kind: "text", source: "bun test", lines: lines("ok") },
			{ kind: "file", path: "src/nodes.ts", start: 1, end: LINES, lines: lines("export const") },
			{ kind: "text", source: "git log", lines: lines("commit") },
		];
	};

	initThemeSync();
	const clock = new VirtualClock(ROWS);
	const hasher = new Bun.CryptoHasher("sha256");
	const heapMiB = () => heapSize() / 2 ** 20;
	let described: NativeNode | undefined;

	/**
	 * One dialog: drawn, described on the first cycle only (the tree carries the whole evidence text),
	 * answered with Enter, disposed, and either dropped with this frame or kept by `keep`.
	 */
	const runCycle = (cycle: number, keep: AskMore[] | undefined): void => {
		const component = new AskMoreComponent({ tui: clock, questions: [question], evidence: [evidenceFor(cycle)], demos, finish: () => {}, timeout: { kind: "off" }, notify: () => {} });
		for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);
		const tree = component.describe(CX);
		if (described === undefined) described = tree;
		component.handleInput("\r");
		component.dispose();
		if (keep !== undefined) keep.push(component);
	};
	const checkClosed = (): void => {
		if (described === undefined) throw new Error("no page was described");
		hasher.update(JSON.stringify(described));
	};

	const heapPoints: number[] = [];
	const livePoints: number[] = [];
	const committedPoints: number[] = [];
	const { ms, mallocMiB } = await measured(() => {
		for (let cycle = 0; cycle < asks; cycle++) {
			runCycle(cycle, undefined);
			Bun.gc(true);
			heapPoints.push(heapMiB());
			const malloc = mallocNow();
			livePoints.push(malloc.liveMiB);
			committedPoints.push(malloc.committedMiB);
		}
		checkClosed();
	});
	const droppedHeapMiB = heapPoints.at(-1) ?? Number.NaN;
	const retainedGrowthMiB = Math.max(0, median(heapPoints.slice(-5)) - median(heapPoints.slice(0, 5)));
	const liveDriftMiB = (livePoints.at(-1) ?? Number.NaN) - (livePoints[0] ?? Number.NaN);
	const committedDriftMiB = (committedPoints.at(-1) ?? Number.NaN) - (committedPoints[0] ?? Number.NaN);

	// The same dialogs disposed but held: what a component the host kept would retain.
	const kept: AskMore[] = [];
	for (let cycle = 0; cycle < KEPT; cycle++) runCycle(asks + cycle, kept);
	Bun.gc(true);
	const keptHeapMiB = heapMiB();
	const keptRetainedMiB = Math.max(0, keptHeapMiB - droppedHeapMiB);

	report({
		metrics: {
			retainedGrowthMiB,
			droppedHeapMiB,
			liveDriftMiB,
			committedDriftMiB,
			keptPerComponentMiB: keptRetainedMiB / KEPT,
			msPerAsk: ms / asks,
			mallocKiBPerAsk: (mallocMiB * 1024) / asks,
		},
		units: asks,
		digest: sha256(hasher.digest("hex"), String(asks)),
		notes: { asks, kept: KEPT, lines: LINES },
	});
} else {
	await compare(import.meta.path, args, `render-dispose: construct-answer-dispose in AskMoreComponent, ${asks} cycles`, [
		{ name: "retainedGrowthMiB", unit: "MiB JS heap growth", expect: { kind: "atMost", limit: 8 } },
		{ name: "droppedHeapMiB", unit: "MiB JS heap after the last cycle", expect: { kind: "report" } },
		{ name: "liveDriftMiB", unit: "MiB mimalloc live drift", expect: { kind: "report" } },
		{ name: "committedDriftMiB", unit: "MiB mimalloc commit drift", expect: { kind: "report" } },
		{ name: "keptPerComponentMiB", unit: "MiB retained per kept component", expect: { kind: "report" } },
		{ name: "msPerAsk", unit: "ms", expect: { kind: "report" } },
		{ name: "mallocKiBPerAsk", unit: "KiB malloc per ask", expect: { kind: "report" } },
	]);
}
