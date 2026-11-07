// Before/after measurement for the memory benches (oh-my-omp/omp-ask-more#3 §2, §4). A bench script
// runs twice over: as the orchestrator it materializes the baseline `src/` of `--base` (default the
// tree's base commit) and spawns itself as a worker once per variant and run, interleaved; as a
// worker it imports the product modules from the `--src` it is given, drives them through their
// real entry points, and prints one result line. Every worker runs under `BUN_JSC_logGC=1`; the GC
// log between the worker's two marks gives the GC count and the JS heap allocated in the measured
// window (strings and cells; ArrayBuffer contents are not on the JS heap and show in RSS instead).
import { writeSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { heapSize, heapStats } from "bun:jsc";

/** The commit the umbrella measures against: origin/main when the tree was opened. */
export const TREE_BASE = "f065a219980a8769f3ba64cfca58b6af26bddaba";

export const REPO = resolve(import.meta.dir, "../..");

const RESULT = "BENCH_RESULT ";
const MARK = "BENCH_MARK ";

export interface Args {
	readonly worker: boolean;
	/** The `src/` a worker imports from. */
	readonly src: string;
	readonly base: string;
	readonly runs: number;
	/** Every other `--name value` or `--flag` pair, as given. */
	readonly options: ReadonlyMap<string, string>;
	/** The argv a worker is spawned with, besides `--worker --src`. */
	readonly passthrough: readonly string[];
}

export function parseArgs(argv: readonly string[]): Args {
	const options = new Map<string, string>();
	const passthrough: string[] = [];
	let worker = false;
	let src = join(REPO, "src");
	let base = TREE_BASE;
	let runs = 3;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
		const name = arg.slice(2);
		if (name === "worker") {
			worker = true;
			continue;
		}
		const next = argv[index + 1];
		const hasValue = next !== undefined && !next.startsWith("--");
		const value = hasValue ? next : "true";
		if (hasValue) index++;
		if (name === "src") src = value;
		else if (name === "base") base = value;
		else if (name === "runs") runs = Number(value);
		else {
			options.set(name, value);
			passthrough.push(arg, value);
		}
	}
	if (!(Number.isInteger(runs) && runs >= 1)) throw new Error("--runs needs a positive integer");
	return { worker, src, base, runs, options, passthrough };
}

async function exec(argv: readonly string[], cwd: string): Promise<string> {
	const child = Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}: ${err.trim()}`);
	return out.trim();
}

/**
 * `src/` of `ref`, extracted under node_modules so that its bare imports resolve to this checkout's
 * dependencies. An extraction is named by its commit, so it is reused as is.
 */
export async function baselineSrc(ref: string): Promise<{ sha: string; src: string }> {
	const sha = await exec(["git", "rev-parse", `${ref}^{commit}`], REPO);
	const root = join(REPO, "node_modules", ".cache", "omp-ask-more-bench", sha);
	const src = join(root, "src");
	const extracted = await stat(src).then(
		() => true,
		() => false,
	);
	if (extracted) return { sha, src };
	const staging = `${root}.partial-${process.pid}`;
	await mkdir(staging, { recursive: true });
	const archive = Bun.spawn(["git", "archive", "--format=tar", sha, "src"], { cwd: REPO, stdout: "pipe", stderr: "inherit" });
	const untar = Bun.spawn(["tar", "-x", "-C", staging], { stdin: archive.stdout, stderr: "inherit" });
	if ((await archive.exited) !== 0 || (await untar.exited) !== 0) throw new Error(`could not extract src/ of ${sha}`);
	await mkdir(dirname(root), { recursive: true });
	await rename(staging, root);
	return { sha, src };
}

// ── Worker side ─────────────────────────────────────────────────────────────

/** What a worker reports: its own metrics, and a digest of the output that must not change. */
export interface WorkerReport {
	readonly metrics: Readonly<Record<string, number>>;
	/** Units of work in the window (ticks, presses); GC numbers are also reported per unit. */
	readonly units: number;
	readonly digest: string;
	readonly notes?: Readonly<Record<string, string | number>>;
}

function member(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
}

/**
 * mimalloc's own counters (MiB): bytes in live allocations now (`malloc_normal` + `malloc_huge`, at
 * their requested size), bytes committed now, and bytes requested since the process began. Bun
 * allocates ArrayBuffer contents, stream chunks and string buffers there; `process.memoryUsage()`
 * keeps `arrayBuffers` at 0 and moves `external` only at a collection, and RSS hides a fresh buffer
 * behind pages freed earlier.
 */
export function mallocNow(): { liveMiB: number; committedMiB: number; requestedMiB: number } {
	const stats = member(heapStats(), "mimalloc");
	const normal = member(member(stats, "malloc_normal"), "current");
	const huge = member(member(stats, "malloc_huge"), "current");
	const committed = member(member(stats, "committed"), "current");
	const requested = member(stats, "malloc_requested");
	if (typeof normal !== "number" || typeof huge !== "number" || typeof committed !== "number" || typeof requested !== "number") {
		throw new Error("bun:jsc heapStats().mimalloc lacks malloc_normal/malloc_huge/committed/malloc_requested");
	}
	return { liveMiB: (normal + huge) / 2 ** 20, committedMiB: committed / 2 ** 20, requestedMiB: requested / 2 ** 20 };
}

/** Peaks while `run` is pending, sampled every 10 ms and at each end (MiB): RSS, live malloc bytes, mimalloc commit. */
export async function sampledPeak<T>(run: () => Promise<T>): Promise<{ result: T; peakRssMiB: number; peakLiveMiB: number; peakCommittedMiB: number }> {
	let rss = 0;
	let live = 0;
	let committed = 0;
	const sample = () => {
		const now = mallocNow();
		rss = Math.max(rss, process.memoryUsage().rss / 2 ** 20);
		live = Math.max(live, now.liveMiB);
		committed = Math.max(committed, now.committedMiB);
	};
	sample();
	const timer = setInterval(sample, 10);
	try {
		const result = await run();
		sample();
		return { result, peakRssMiB: rss, peakLiveMiB: live, peakCommittedMiB: committed };
	} finally {
		clearInterval(timer);
	}
}

/** Time the allocator gets after start-up's garbage is collected, before a window opens. */
const SETTLE_MS = 1000;

/**
 * The measured window: a full GC and a settle first, then the marks the orchestrator reads the GC log between.
 * A full GC closes the window too, so its log line counts what the window allocated since the last
 * collection (`heapSize()` only moves at collections). The marks are written synchronously to fd 2,
 * where JSC writes its GC log, so they stay in order. Wall time comes from `Bun.nanoseconds()`, which
 * a `VirtualClock` leaves alone. `mallocMiB` is what the window requested from mimalloc, freed or not.
 */
export async function measured<T>(
	run: () => Promise<T> | T,
): Promise<{ result: T; ms: number; rssBeforeMiB: number; liveBeforeMiB: number; committedBeforeMiB: number; mallocMiB: number }> {
	// Let the allocator hand back what start-up freed, so RSS starts from what is live.
	Bun.gc(true);
	await Bun.sleep(SETTLE_MS);
	Bun.gc(true);
	const rssBeforeMiB = process.memoryUsage().rss / 2 ** 20;
	const before = mallocNow();
	writeSync(2, `\n${MARK}start ${heapSize()}\n`);
	const started = Bun.nanoseconds();
	const result = await run();
	const ms = (Bun.nanoseconds() - started) / 1e6;
	const mallocMiB = mallocNow().requestedMiB - before.requestedMiB;
	Bun.gc(true);
	writeSync(2, `\n${MARK}end ${heapSize()}\n`);
	return { result, ms, rssBeforeMiB, liveBeforeMiB: before.liveMiB, committedBeforeMiB: before.committedMiB, mallocMiB };
}

/**
 * The component's render clock in virtual time: `performance.now()` follows it, so the frame timers
 * the component arms fire when `advance` passes them, as the TUI's would.
 */
export class VirtualClock {
	readonly terminal: { readonly rows: number };
	/** Draws the component asked the TUI for. */
	renders = 0;
	#now = 0;
	readonly #timers = new Set<{ due: number; callback: () => void }>();

	constructor(rows: number) {
		this.terminal = { rows };
		Object.defineProperty(performance, "now", { value: () => this.#now, configurable: true, writable: true });
	}

	scheduleAfter(delayMs: number, callback: () => void): { cancel(): void } {
		const timer = { due: this.#now + delayMs, callback };
		this.#timers.add(timer);
		return { cancel: () => this.#timers.delete(timer) };
	}

	requestComponentRender(): void {
		this.renders++;
	}

	/** Move time on by `ms`, firing every timer that comes due, earliest first. */
	advance(ms: number): void {
		const until = this.#now + ms;
		for (;;) {
			let next: { due: number; callback: () => void } | undefined;
			for (const timer of this.#timers) if (timer.due <= until && (next === undefined || timer.due < next.due)) next = timer;
			if (next === undefined) break;
			this.#timers.delete(next);
			this.#now = next.due;
			next.callback();
		}
		this.#now = until;
	}
}

export function report(value: WorkerReport): void {
	writeSync(1, `${RESULT}${JSON.stringify(value)}\n`);
}

export function sha256(...parts: readonly (string | Uint8Array)[]): string {
	const hasher = new Bun.CryptoHasher("sha256");
	for (const part of parts) hasher.update(part);
	return hasher.digest("hex");
}

// ── Orchestrator side ───────────────────────────────────────────────────────

/** GC events and JS heap allocated between the worker's marks. */
export function gcWindow(log: string): { gcs: number; allocMiB: number } {
	let inside = false;
	let previous = 0;
	let allocated = 0;
	let gcs = 0;
	for (const line of log.split("\n")) {
		if (line.startsWith(`${MARK}start `)) {
			inside = true;
			previous = Number(line.slice(MARK.length + 6));
			continue;
		}
		if (line.startsWith(`${MARK}end `)) {
			allocated += Math.max(0, Number(line.slice(MARK.length + 4)) - previous);
			return { gcs, allocMiB: allocated / 2 ** 20 };
		}
		if (!inside) continue;
		const start = /START [A-Z]+ (\d+)kb/.exec(line);
		const end = /=> (\d+)kb, p=/.exec(line);
		if (start === null || end === null) continue;
		gcs++;
		allocated += Math.max(0, Number(start[1]) * 1024 - previous);
		previous = Number(end[1]) * 1024;
	}
	throw new Error("the worker's GC log has no complete measured window");
}

/**
 * How a metric is judged: `lower` — head's median at least `minDrop` (a fraction) below base's;
 * `atMost` — every head run at most `limit`; `report` — shown only.
 */
export type Expectation = { readonly kind: "lower"; readonly minDrop: number } | { readonly kind: "atMost"; readonly limit: number } | { readonly kind: "report" };

export interface MetricSpec {
	readonly name: string;
	readonly unit: string;
	readonly expect: Expectation;
}

interface Run {
	readonly metrics: Record<string, number>;
	readonly digest: string;
	readonly notes: Readonly<Record<string, string | number>>;
}

/** Exit code of a worker whose run the environment spoiled (e.g. a decode timeout on a loaded machine): run it again. */
export const EXIT_RETRY = 75;
const ATTEMPTS = 5;

async function runWorker(script: string, src: string, passthrough: readonly string[]): Promise<Run> {
	for (let attempt = 1; ; attempt++) {
		const run = await runWorkerOnce(script, src, passthrough);
		if (run.kind === "done") return run.run;
		if (attempt === ATTEMPTS) throw new Error(`worker for ${src} asked for a rerun ${ATTEMPTS} times: ${run.reason}`);
		console.log(`  (rerun: ${run.reason})`);
	}
}

async function runWorkerOnce(script: string, src: string, passthrough: readonly string[]): Promise<{ kind: "done"; run: Run } | { kind: "retry"; reason: string }> {
	const child = Bun.spawn(["bun", script, "--worker", "--src", src, ...passthrough], {
		cwd: REPO,
		env: { ...process.env, BUN_JSC_logGC: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code === EXIT_RETRY) return { kind: "retry", reason: out.trim().split("\n").at(-1) ?? "" };
	const line = out.split("\n").find(candidate => candidate.startsWith(RESULT));
	if (code !== 0 || line === undefined) {
		const tail = err
			.split("\n")
			.filter(entry => !entry.startsWith("[GC<") && !entry.startsWith("GC END"))
			.slice(-20)
			.join("\n");
		throw new Error(`worker for ${src} exited ${code}:\n${tail}`);
	}
	const parsed = JSON.parse(line.slice(RESULT.length)) as WorkerReport;
	const gc = gcWindow(err);
	const units = Math.max(1, parsed.units);
	return {
		kind: "done",
		run: {
			metrics: { ...parsed.metrics, gcs: gc.gcs, heapAllocMiB: gc.allocMiB, heapAllocKiBPerUnit: (gc.allocMiB * 1024) / units },
			digest: parsed.digest,
			notes: parsed.notes ?? {},
		},
	};
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function format(value: number): string {
	return Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(4);
}

/** The GC metrics every worker gets; a bench may list one of them itself to judge it. */
const GC_METRICS: readonly MetricSpec[] = [
	{ name: "gcs", unit: "count", expect: { kind: "report" } },
	{ name: "heapAllocMiB", unit: "MiB", expect: { kind: "report" } },
	{ name: "heapAllocKiBPerUnit", unit: "KiB/unit", expect: { kind: "report" } },
];

/**
 * Run base and head `runs` times each, interleaved; print every run and the distribution; exit 1
 * when the output digests differ or a judged metric misses its expectation.
 */
export async function compare(script: string, args: Args, title: string, metrics: readonly MetricSpec[]): Promise<void> {
	const base = await baselineSrc(args.base);
	const head = { sha: await exec(["git", "rev-parse", "HEAD"], REPO), src: resolve(REPO, args.src) };
	const dirty = (await exec(["git", "status", "--porcelain", "--untracked-files=no"], REPO)).length > 0;
	const bunVersion = await exec(["bun", "--version"], REPO);
	console.log(`# ${title}`);
	console.log(`base ${base.sha} (${args.base})  head ${head.sha}${dirty ? " +uncommitted" : ""}  runs ${args.runs}  bun ${bunVersion}  args ${args.passthrough.join(" ") || "-"}`);
	const runs: { base: Run[]; head: Run[] } = { base: [], head: [] };
	for (let index = 0; index < args.runs; index++) {
		for (const variant of ["base", "head"] as const) {
			const run = await runWorker(script, variant === "base" ? base.src : head.src, args.passthrough);
			runs[variant].push(run);
			const shown = Object.entries(run.metrics)
				.map(([name, value]) => `${name}=${format(value)}`)
				.join(" ");
			const notes = Object.entries(run.notes)
				.map(([name, value]) => `${name}=${value}`)
				.join(" ");
			console.log(`run ${index + 1} ${variant}: ${shown}${notes ? `  | ${notes}` : ""}  digest=${run.digest.slice(0, 16)}`);
		}
	}

	const failures: string[] = [];
	console.log("");
	console.log("| metric | unit | base median [min–max] | head median [min–max] | change | expectation |");
	console.log("|---|---|---|---|---|---|");
	for (const spec of [...metrics, ...GC_METRICS.filter(gc => !metrics.some(own => own.name === gc.name))]) {
		const of = (list: readonly Run[]) => list.map(run => run.metrics[spec.name] ?? Number.NaN);
		const [b, h] = [of(runs.base), of(runs.head)];
		const [bm, hm] = [median(b), median(h)];
		const change = bm === 0 ? 0 : (hm - bm) / bm;
		const range = (values: readonly number[]) => `${format(median(values))} [${format(Math.min(...values))}–${format(Math.max(...values))}]`;
		let verdict = "report";
		switch (spec.expect.kind) {
			case "lower": {
				const ok = hm <= bm * (1 - spec.expect.minDrop);
				verdict = `${ok ? "PASS" : "FAIL"}: drop ≥ ${(spec.expect.minDrop * 100).toFixed(0)}%`;
				if (!ok) failures.push(`${spec.name}: head median ${format(hm)} vs base ${format(bm)} (needs a drop of ${(spec.expect.minDrop * 100).toFixed(0)}%)`);
				break;
			}
			case "atMost": {
				const ok = Math.max(...h) <= spec.expect.limit;
				verdict = `${ok ? "PASS" : "FAIL"}: head ≤ ${spec.expect.limit} in every run`;
				if (!ok) failures.push(`${spec.name}: a head run reached ${format(Math.max(...h))} (limit ${spec.expect.limit})`);
				break;
			}
			case "report":
				break;
		}
		console.log(`| ${spec.name} | ${spec.unit} | ${range(b)} | ${range(h)} | ${(change * 100).toFixed(1)}% | ${verdict} |`);
	}

	const digests = new Set([...runs.base, ...runs.head].map(run => run.digest));
	console.log("");
	if (digests.size === 1) {
		console.log(`output digest: identical across every base and head run (${[...digests][0]})`);
	} else {
		const listed = (list: readonly Run[]) => list.map(run => run.digest.slice(0, 16)).join(",");
		failures.push(`output digests differ: base ${listed(runs.base)} head ${listed(runs.head)}`);
	}
	if (failures.length > 0) {
		console.log(`RESULT: FAIL\n${failures.map(failure => `- ${failure}`).join("\n")}`);
		process.exit(1);
	}
	console.log("RESULT: PASS");
}
