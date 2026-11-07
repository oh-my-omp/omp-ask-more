// Demo loading before an ask opens (oh-my-omp/omp-ask-more#4 rows 1–2): `loadQuestionDemos`, the
// entry `index.ts` calls, over file demos made by ffmpeg.
//
//   bun test/bench/demo-load.ts [--demos 8] [--surface ansi|native]   images under and over the read
//       cap, videos, a non-image and a missing file, spread over questions as question/option demos
//   bun test/bench/demo-load.ts --video large                        Tern's path: a video converted to
//       a GIF near the 16 MiB output cap, one past it, and one ffmpeg cannot read
//
// Measured while loading, sampled every 10 ms: peak RSS above the window's start (Bun moves
// `process.memoryUsage().external` only at a collection), mimalloc's live and committed bytes; also the
// live bytes still held after a GC, bytes requested from mimalloc, the most ffmpeg/ffprobe processes
// alive at once, wall time. The output digest covers every loaded demo: kind, path, caption, mime,
// sizes, a hash of its image bytes or raster frames, and the text of each error item. A run in which
// a decode hit the 20 s timeout is run again: on a busy machine that error says nothing about the code.
import { join } from "node:path";
import type * as DemoModule from "../../src/demo.ts";
import type { LoadedDemo, Surface } from "../../src/demo.ts";
import type { DemoParams } from "../../src/schema.ts";
import { ensureFixtures } from "./demo-fixtures.ts";
import { compare, EXIT_RETRY, mallocNow, measured, parseArgs, report, sampledPeak, sha256 } from "./harness.ts";

const args = parseArgs(process.argv.slice(2));
const video = args.options.get("video") === "large";
const surface: Surface = video ? "native" : args.options.get("surface") === "native" ? "native" : "ansi";
const count = Number(args.options.get("demos") ?? (video ? 2 : 8));
/** Columns the ANSI page is drawn in: an 80-column terminal less the frame, as `index.ts` passes. */
const COLUMNS = 72;

/** File demos the loader decodes (cycled up to `--demos`), then demos that only become error items. */
const MIXED = ["noise-a.gif", "clip-a.mp4", "noise.apng", "clip-b.mp4", "noise-b.gif", "huge.gif", "clip-a.mp4", "noise-a.gif"];
const MIXED_ERRORS = ["not-image.gif", "missing.gif"];
const VIDEOS = ["clip-b.mp4", "over.mp4"];
const VIDEO_ERRORS = ["corrupt.mp4"];

/** The file demos, four to a question: the question's own, then one per option. */
function questions(): { brief: { demo?: DemoParams }; options: { demo?: DemoParams }[] }[] {
	const names = video ? VIDEOS : MIXED;
	const paths = [...Array.from({ length: count }, (_, index) => names[index % names.length] ?? ""), ...(video ? VIDEO_ERRORS : MIXED_ERRORS)];
	const demos: DemoParams[] = paths.map((path, index) => ({ kind: "file", path, caption: `demo ${index}` }));
	const grouped: { brief: { demo?: DemoParams }; options: { demo?: DemoParams }[] }[] = [];
	for (let start = 0; start < demos.length; start += 4) {
		const [own, ...options] = demos.slice(start, start + 4);
		grouped.push({ brief: own === undefined ? {} : { demo: own }, options: [...options.map(demo => ({ demo })), {}] });
	}
	return grouped;
}

function described(demo: LoadedDemo | undefined): unknown {
	if (demo === undefined) return null;
	switch (demo.kind) {
		case "frames":
			return demo;
		case "image":
			return { kind: demo.kind, path: demo.path, caption: demo.caption, mime: demo.mime, size: demo.bytes.length, bytes: sha256(demo.bytes) };
		case "raster":
			return { kind: demo.kind, path: demo.path, caption: demo.caption, width: demo.width, rows: demo.rows, intervalMs: demo.intervalMs, frames: demo.frames.length, pixels: sha256(...demo.frames) };
		case "error":
			return demo;
	}
}

if (args.worker) {
	const fixtures = await ensureFixtures();
	// The module is imported from the `--src` this worker measures (baseline or head), so the path is only known at run time.
	const { loadQuestionDemos } = (await import(join(args.src, "demo.ts"))) as typeof DemoModule;
	const asked = questions();

	// Every media tool the loader starts goes through Bun.spawn: count the ones alive at once.
	let alive = 0;
	let mostAlive = 0;
	let started = 0;
	const spawn = Bun.spawn;
	Reflect.set(Bun, "spawn", (...spawnArgs: Parameters<typeof spawn>) => {
		const child = spawn(...spawnArgs);
		started++;
		alive++;
		mostAlive = Math.max(mostAlive, alive);
		void child.exited.finally(() => alive--);
		return child;
	});

	const { result, ms, rssBeforeMiB, liveBeforeMiB, committedBeforeMiB, mallocMiB } = await measured(() => sampledPeak(() => loadQuestionDemos(asked, fixtures, surface, COLUMNS, undefined)));
	const loaded = result.result;
	const errors = loaded.flatMap(entry => [entry.question, ...entry.options]).flatMap(demo => (demo?.kind === "error" ? [demo.error] : []));
	// The 20 s decode timeout fires on a loaded machine whatever the code under test: not a result to compare.
	const timedOut = errors.find(error => /decoding took longer than|解码超过 \d+ 秒/.test(error));
	if (timedOut !== undefined) {
		console.log(`a decode timed out (${timedOut})`);
		process.exit(EXIT_RETRY);
	}
	Bun.gc(true);
	const held = mallocNow();
	report({
		metrics: {
			peakRssAboveStartMiB: result.peakRssMiB - rssBeforeMiB,
			peakLiveMiB: result.peakLiveMiB - liveBeforeMiB,
			heldLiveMiB: held.liveMiB - liveBeforeMiB,
			peakCommittedMiB: result.peakCommittedMiB - committedBeforeMiB,
			mallocMiB,
			peakRssMiB: result.peakRssMiB,
			maxConcurrentDecoders: mostAlive,
			decoders: started,
			wallMs: ms,
		},
		units: asked.length,
		digest: sha256(JSON.stringify(loaded.map(entry => ({ question: described(entry.question), options: entry.options.map(described) })))),
		notes: {
			surface,
			kinds: loaded
				.flatMap(entry => [entry.question, ...entry.options])
				.map(demo => (demo === undefined ? "-" : demo.kind === "error" ? `error(${demo.path}: ${demo.error})` : demo.kind))
				.join(","),
		},
	});
} else {
	await ensureFixtures();
	await compare(import.meta.path, args, `demo-load: loadQuestionDemos, ${count} file demos + error cases, surface ${surface}${video ? ", videos near the GIF cap" : ""}`, [
		{ name: "peakRssAboveStartMiB", unit: "MiB", expect: { kind: "lower", minDrop: video ? 0.15 : 0.3 } },
		{ name: "peakRssMiB", unit: "MiB", expect: { kind: "report" } },
		// mimalloc counts a reserved buffer at its full size in live, committed and requested bytes,
		// though only the pages written become resident: shown, not judged.
		{ name: "peakLiveMiB", unit: "MiB above window start", expect: { kind: "report" } },
		{ name: "heldLiveMiB", unit: "MiB above window start", expect: { kind: "report" } },
		{ name: "peakCommittedMiB", unit: "MiB above window start", expect: { kind: "report" } },
		{ name: "mallocMiB", unit: "MiB requested", expect: { kind: "report" } },
		{ name: "maxConcurrentDecoders", unit: "processes", expect: { kind: "atMost", limit: 2 } },
		{ name: "decoders", unit: "processes", expect: { kind: "report" } },
		{ name: "wallMs", unit: "ms", expect: { kind: "report" } },
	]);
}
