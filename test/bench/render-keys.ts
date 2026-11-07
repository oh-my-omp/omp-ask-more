// Key presses on the ANSI page (oh-my-omp/omp-ask-more#5 row 2): cursor moves, page jumps and the
// ctrl+o evidence toggle each rebuild the body. The brief, the diagram and the risks are long and the
// evidence is large, so a rebuild that re-renders the unchanged Markdown is visible.
//
//   bun test/bench/render-keys.ts [--presses 50]
//
// Measured over the presses: Markdown renders (every `Markdown.render` call, wrapped for the window)
// and the characters they produce, bytes requested from mimalloc per press, time per press. The
// characters are the honest measure here: a rendered line is a small string on JSC's own heap, which
// mimalloc neither allocates nor counts, and the GC log only accounts for a window that reaches a
// collection — while the character count is exact. The digest covers every drawn page line and the
// node tree at the end, so the body must stay byte-identical.
import { join } from "node:path";
import { initThemeSync, Markdown, type DescribeContext } from "@oh-my-pi/pi-tui";
import type * as ComponentModule from "../../src/component.ts";
import type { ResolvedEvidence } from "../../src/brief.ts";
import { questionSchema } from "../../src/schema.ts";
import { compare, measured, parseArgs, report, sha256, VirtualClock } from "./harness.ts";

const args = parseArgs(process.argv.slice(2));
const presses = Number(args.options.get("presses") ?? 50);
/** An 80-column terminal, tall enough to show the whole page. */
const WIDTH = 80;
const ROWS = 40;
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const CTRL_O = "\x0f";
/** One round of presses: cursor moves, both page jumps, and the evidence toggle twice. */
const KEYS = [DOWN, DOWN, UP, DOWN, PAGE_DOWN, PAGE_UP, CTRL_O, CTRL_O, UP, UP] as const;
/** Paragraphs per brief section; a long brief is what a rebuild has to re-render unchanged. */
const PARAGRAPHS = 40;

const CX: DescribeContext = { cols: 120, reduceMotion: false, dark: true, supports: () => true, feature: () => true };

/** One brief section: distinct paragraphs, each rendered as its own block. */
function section(name: string): string {
	return Array.from(
		{ length: PARAGRAPHS },
		(_, index) => `The ${name} paragraph ${index} explains what the page holds and what changes when the same text is rendered again at the same width.`,
	).join("\n\n");
}

if (args.worker) {
	// The module comes from the `--src` this worker measures (baseline or head), so the path is only known at run time.
	const { AskMoreComponent } = (await import(join(args.src, "component.ts"))) as typeof ComponentModule;
	const question = questionSchema.parse({
		id: "brief",
		header: "Brief",
		question: "Which rendering should the dialog keep playing while the cursor rests on Drop?\n\nA rebuild per key press re-renders the question, the brief, the diagram and the risks, none of which can have changed.",
		brief: {
			where: section("where"),
			what: section("what"),
			how: section("how"),
			diagram: ["flowchart LR", ...Array.from({ length: 100 }, (_, step) => `  key${step} --> key${step + 1}`)].join("\n"),
			risks: Array.from({ length: 50 }, (_, index) => `risk ${index}: the rebuilt page keeps this line alive until the next press`),
		},
		options: [
			{ label: "Keep", description: "nothing changes", tradeoff: "the dialog keeps its current cost", holds_when: "the cost is already bounded", cost: "no work" },
			{ label: "Drop", tradeoff: "the text is rendered once per page", holds_when: "the page outlives the press", cost: "one rendering per page" },
			{ label: "Shrink", tradeoff: "the evidence shows fewer rows", holds_when: "the window is short", cost: "less visible context" },
		],
	});
	const evidence: readonly ResolvedEvidence[] = [
		{ kind: "file", path: "src/component.ts", start: 1, end: 3000, lines: Array.from({ length: 3000 }, (_, line) => `const line${line} = "${"x".repeat(40)}";`) },
		{ kind: "text", source: "bun test", lines: Array.from({ length: 2000 }, (_, line) => `ok ${line} - case ${line} passes with ${"y".repeat(30)}`) },
	];

	initThemeSync();
	const clock = new VirtualClock(ROWS);
	const component = new AskMoreComponent({ tui: clock, questions: [question], evidence: [evidence], demos: [], finish: () => {}, timeout: { kind: "off" }, notify: () => {} });
	const hasher = new Bun.CryptoHasher("sha256");
	// One page before the window: neither variant is charged for the first build.
	for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);

	let markdownRenders = 0;
	let markdownChars = 0;
	const originalRender = Markdown.prototype.render;
	Markdown.prototype.render = function (this: Markdown, width: number): readonly string[] {
		markdownRenders++;
		const lines = originalRender.call(this, width);
		for (const line of lines) markdownChars += line.length;
		return lines;
	};
	const { ms, mallocMiB } = await measured(() => {
		for (let press = 0; press < presses; press++) {
			component.handleInput(KEYS[press % KEYS.length] ?? DOWN);
			for (const line of component.render(WIDTH)) hasher.update(`${line}\n`);
		}
	});
	Markdown.prototype.render = originalRender;
	hasher.update(JSON.stringify(component.describe(CX)));
	component.dispose();
	report({
		metrics: {
			markdownRenders,
			markdownChars,
			mallocKiBPerPress: (mallocMiB * 1024) / presses,
			msPerPress: ms / presses,
		},
		units: presses,
		digest: sha256(hasher.digest("hex"), String(presses)),
		notes: { keys: KEYS.length },
	});
} else {
	await compare(import.meta.path, args, `render-keys: key presses in AskMoreComponent, ${presses} presses`, [
		{ name: "markdownRenders", unit: "Markdown renders", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "markdownChars", unit: "rendered characters", expect: { kind: "lower", minDrop: 0.3 } },
		{ name: "mallocKiBPerPress", unit: "KiB malloc per press", expect: { kind: "report" } },
		{ name: "msPerPress", unit: "ms", expect: { kind: "report" } },
	]);
}
