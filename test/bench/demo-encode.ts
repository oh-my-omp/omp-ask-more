// Raster playback on the ANSI page (oh-my-omp/omp-ask-more#4 row 3): a video demo loaded by
// `loadQuestionDemos` for the ANSI surface plays in `AskMoreComponent`; each tick moves the render
// clock one frame interval, the component's own timer steps the frame, and the page is drawn, which
// encodes the frame with `halfBlockRows`.
//
//   bun test/bench/demo-encode.ts [--ticks 100]
//
// Measured over the ticks: bytes requested from mimalloc per tick (string buffers and arrays the
// encoding makes), JS heap allocated per tick and GC count from the GC log (100 ticks seldom reach a
// collection, so these move only when one falls in the window), time per tick. The output digest
// covers every drawn page, byte for byte.
import { join } from "node:path";
import { initThemeSync } from "@oh-my-pi/pi-tui";
import type * as ComponentModule from "../../src/component.ts";
import type * as DemoModule from "../../src/demo.ts";
import { questionSchema } from "../../src/schema.ts";
import { ensureFixtures } from "./demo-fixtures.ts";
import { compare, measured, parseArgs, report, sha256, VirtualClock } from "./harness.ts";

const args = parseArgs(process.argv.slice(2));
const ticks = Number(args.options.get("ticks") ?? 100);
/** An 80-column terminal, as the ANSI demo is decoded for, tall enough to show the whole page. */
const WIDTH = 80;
const ROWS = 60;

if (args.worker) {
	const fixtures = await ensureFixtures();
	// Both modules come from the `--src` this worker measures (baseline or head), so the paths are only known at run time.
	const { loadQuestionDemos } = (await import(join(args.src, "demo.ts"))) as typeof DemoModule;
	const { AskMoreComponent } = (await import(join(args.src, "component.ts"))) as typeof ComponentModule;
	const question = questionSchema.parse({
		id: "playback",
		question: "Which clip?",
		brief: { where: "a clip plays below", what: "pick one", how: "the clip shows the result", demo: { kind: "file", path: "clip-a.mp4", caption: "the clip" } },
		options: [
			{ label: "Keep", tradeoff: "nothing changes" },
			{ label: "Drop", tradeoff: "the clip goes" },
		],
	});
	const demos = await loadQuestionDemos([question], fixtures, "ansi", WIDTH - 8, undefined);
	const playing = demos[0]?.question;
	if (playing?.kind !== "raster" || playing.frames.length < 2) throw new Error(`the clip did not load as an animated raster: ${JSON.stringify(playing)}`);
	initThemeSync();
	const clock = new VirtualClock(ROWS);
	const component = new AskMoreComponent({ tui: clock, questions: [question], evidence: [[]], demos, finish: () => {}, timeout: { kind: "off" }, notify: () => {} });
	const hasher = new Bun.CryptoHasher("sha256");
	for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);

	const { ms, mallocMiB } = await measured(() => {
		for (let tick = 0; tick < ticks; tick++) {
			clock.advance(playing.intervalMs);
			for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);
		}
	});
	component.dispose();
	if (clock.renders < ticks) throw new Error(`the demo stepped ${clock.renders} times in ${ticks} ticks`);
	report({
		metrics: { msPerTick: ms / ticks, mallocKiBPerTick: (mallocMiB * 1024) / ticks },
		units: ticks,
		digest: sha256(hasher.digest("hex"), String(ticks)),
		notes: { frames: playing.frames.length, raster: `${playing.width}x${playing.rows}`, steps: clock.renders },
	});
} else {
	await ensureFixtures();
	await compare(import.meta.path, args, `demo-encode: ANSI raster playback in AskMoreComponent, ${ticks} ticks`, [
		{ name: "mallocKiBPerTick", unit: "KiB malloc per tick", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "heapAllocKiBPerUnit", unit: "KiB JS heap per tick", expect: { kind: "report" } },
		{ name: "msPerTick", unit: "ms", expect: { kind: "report" } },
	]);
}
