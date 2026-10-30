// One component, two surfaces. It is mounted as a fullscreen overlay: `render()` draws the ANSI page
// (fixed title and question tabs, a scrolling body, fixed key hints) on the alternate screen, and in
// Tern `describe()` draws the content of the native sheet the backend wraps it in (`nativeOverlay`).
// Both read the same per-question state, so keys and pointer events lead to the same answers.
// The component holds the overlay focus and hands keys to the open Other field itself.
import {
	type Component,
	type DescribeContext,
	Input,
	Markdown,
	type NativeNode,
	type NativeUiEvent,
	routeSgrMouseInput,
	ScrollView,
	type RenderTimer,
	getMarkdownTheme,
	matchesKey,
	theme,
	truncateToWidth,
	visibleWidth,
	Ellipsis,
} from "@oh-my-pi/pi-tui";
import { matchesSelectPageDown, matchesSelectPageUp } from "@oh-my-pi/pi-tui/keybinding-matchers";
import { leafKey } from "@oh-my-pi/pi-tui/native/node";
import type { TspScrollBy } from "@oh-my-pi/pi-wire";
import type { ResolvedEvidence } from "./brief.ts";
import { frameCount, frameInterval, halfBlockRows, type LoadedDemo, type QuestionDemos } from "./demo.ts";
import { tr } from "./i18n.ts";
import {
	answerLabel,
	type DemoMove,
	describeSheet,
	OTHER_ITEM,
	optionIndex,
	parseAct,
	questionListKey,
	REVIEW_TAB,
	type SheetAct,
	sheetTitle,
	TABS_KEY,
	tabLabel,
} from "./nodes.ts";
import { type Answer, UNANSWERED } from "./result.ts";
import type { AskQuestion } from "./schema.ts";
import { type ActiveTab, type DemoSlot, type NativeScrollRequest, onOther, type PageDemo, pageDemos, type QuestionState, type ReviewState, startPlayback } from "./state.ts";
import { countdownStatus, type Phase, type TimeoutPolicy } from "./timeout.ts";

/** How the sheet closed: the user's answers, a cancel, or the countdown handing the answers given so far to the model. */
export type Submission =
	| { readonly kind: "submit"; readonly answers: readonly Answer[] }
	| { readonly kind: "cancel" }
	| { readonly kind: "timeout"; readonly answers: readonly Answer[] };

/** What the component needs from the TUI: its render clock and the terminal height. */
export interface SheetHost {
	scheduleAfter(delayMs: number, callback: () => void): RenderTimer;
	requestComponentRender(component: Component): void;
	readonly terminal: { readonly rows: number };
}

export interface AskMoreOptions {
	readonly tui: SheetHost;
	readonly questions: readonly AskQuestion[];
	/** Resolved evidence, one list per question. */
	readonly evidence: readonly (readonly ResolvedEvidence[])[];
	/** Loaded demos, one entry per question. */
	readonly demos: readonly QuestionDemos[];
	readonly finish: (submission: Submission) => void;
	/** What happens while nobody answers; the clock runs from construction until the sheet closes. */
	readonly timeout: TimeoutPolicy;
	/** Called once when a notifying countdown runs out; `due` is when the model takes over, if it does. */
	readonly notify: (due: Date | undefined) => void;
}

/** The countdown of an open sheet; every timer it holds is cancelled when the phase changes or the sheet closes. */
type Countdown =
	| { readonly kind: "stopped" }
	| { readonly kind: "idle"; readonly timer: RenderTimer }
	| { readonly kind: "notified"; readonly at: Date; readonly due: Date | undefined; readonly timer: RenderTimer | undefined };

/** The Other field; in Tern the terminal edits it directly, which counts as the user being there. */
class OtherInput extends Input {
	readonly #onActivity: () => void;

	constructor(onActivity: () => void) {
		super();
		this.#onActivity = onActivity;
	}

	override handleNativeEvent(event: NativeUiEvent): void {
		this.#onActivity();
		super.handleNativeEvent(event);
	}
}

/** Evidence rows drawn per reference in the ANSI page before ctrl+o opens them. */
const DOCUMENT_SCROLL = 10;
/** Rows a mouse-wheel notch or Shift+↑↓ moves the ANSI body. */
const WHEEL_ROWS = 3;
const FAST_ROWS = 5;

/**
 * An evidence line cut to `width` columns, ending in how many characters were left out; the ScrollView
 * would otherwise cut it at the box edge without a trace.
 */
function cutLine(line: string, width: number): string {
	if (visibleWidth(line) <= width) return line;
	const marker = (left: number) => tr(` … ${left} more characters`, ` … 还有 ${left} 个字符`);
	const total = Array.from(line).length;
	const kept = truncateToWidth(line, Math.max(0, width - visibleWidth(marker(total))), Ellipsis.Omit);
	return kept + theme.fg("muted", marker(total - Array.from(kept).length));
}

function newView(): ScrollView {
	return new ScrollView([], {
		height: 1,
		scrollbar: "auto",
		ellipsis: Ellipsis.Omit,
		theme: { track: text => theme.fg("dim", text), thumb: text => theme.fg("accent", text) },
	});
}

export class AskMoreComponent implements Component {
	debugKind = "AskMore";
	readonly nativeOverlay: NonNullable<Component["nativeOverlay"]>;
	readonly #tui: SheetHost;
	readonly #finish: (submission: Submission) => void;
	readonly #states: readonly QuestionState[];
	readonly #review: ReviewState = { view: newView(), nativeScroll: undefined };
	readonly #title: string;
	#active: ActiveTab = { kind: "question", index: 0 };
	/** Bumped on every change a surface draws; scrolling alone does not change it. */
	#version = 0;
	#body:
		| {
				key: string;
				lines: readonly string[];
				focus: { start: number; end: number } | undefined;
				/** Rows reserved for each demo the page plays; filled per frame. */
				slots: readonly { slot: DemoSlot; start: number; height: number }[];
		  }
		| undefined;
	/** The `#frames` value the ANSI viewport last drew. */
	#drawnFrames = -1;
	#native: { version: number; frames: number; scroll: NativeScrollRequest | undefined; node: NativeNode } | undefined;
	/** Bumped when a demo frame changes; a frame alone redraws only the demo. */
	#frames = 0;
	#timer: RenderTimer | undefined;
	/** Rendered frames of each frames demo per width, padded to its tallest frame. */
	readonly #frameLines = new WeakMap<LoadedDemo, { width: number; frames: readonly (readonly string[])[] }>();
	#closed = false;
	readonly #policy: TimeoutPolicy;
	readonly #notify: (due: Date | undefined) => void;
	#countdown: Countdown = { kind: "stopped" };

	constructor(options: AskMoreOptions) {
		this.#tui = options.tui;
		this.#finish = options.finish;
		this.#policy = options.timeout;
		this.#notify = options.notify;
		this.#title = sheetTitle(options.questions);
		// Outside `omp.overlay.*`: Tern's overlay list rule there outranks the ask list styling the
		// options use (`omp.ask.options`), and draws each option's mark over its label.
		this.nativeOverlay = { role: "omp.askMore", size: "full", anchor: "center", head: this.#title };
		this.#states = options.questions.map((question, index) => {
			const input = new OtherInput(() => this.#activity());
			input.placeholder = tr("Type your own answer", "自己写一个答案");
			const state: QuestionState = {
				question,
				evidence: options.evidence[index] ?? [],
				demos: options.demos[index] ?? { question: undefined, options: [] },
				questionPlay: startPlayback(),
				optionPlay: startPlayback(question.recommended ?? 0),
				cursor: Math.min(question.recommended ?? 0, question.options.length - 1),
				answer: UNANSWERED,
				editing: false,
				expanded: false,
				input,
				view: newView(),
				nativeScroll: undefined,
			};
			input.onSubmit = value => this.#saveOther(index, value);
			input.onEscape = () => this.#change(() => {
				state.editing = false;
			});
			return state;
		});
		this.#arm();
		this.#restartIdle();
	}

	dispose(): void {
		this.#closed = true;
		this.#timer?.cancel();
		this.#timer = undefined;
		this.#stopCountdown();
		for (const state of this.#states) state.view.dispose?.();
		this.#review.view.dispose?.();
	}

	// ── ANSI ──────────────────────────────────────────────────────────────

	render(width: number): readonly string[] {
		const inner = Math.max(24, width - 4);
		const bodyWidth = Math.max(1, inner - 1);
		const tabRow = this.#tabRow(inner);
		const status = this.#status();
		const statusRow = status === undefined ? undefined : theme.fg("muted", truncateToWidth(status, inner));
		const hint = theme.fg("muted", this.#hints());
		const bodyHeight = Math.max(1, this.#tui.terminal.rows - 3 - (tabRow === undefined ? 0 : 1) - (statusRow === undefined ? 0 : 1));

		const view = this.#activeView();
		const key = `${this.#version}|${bodyWidth}|${this.#active.kind === "review" ? "review" : this.#active.index}`;
		if (this.#body?.key !== key) {
			const built = this.#active.kind === "review" ? { lines: this.#reviewLines(bodyWidth), focus: undefined, slots: [] } : this.#questionLines(this.#active.index, bodyWidth);
			this.#body = { key, ...built };
			this.#drawnFrames = -1;
		}
		if (this.#drawnFrames !== this.#frames) {
			view.setLines(this.#withDemoFrames(this.#body.lines, this.#body.slots, bodyWidth));
			this.#drawnFrames = this.#frames;
		}
		view.setHeight(bodyHeight);
		const focus = this.#body.focus;
		if (focus !== undefined && this.#active.kind === "question") {
			const state = this.#states[this.#active.index];
			if (state !== undefined) view.revealRange({ id: `${this.#active.index}|${state.cursor}|${state.editing}`, start: focus.start, end: focus.end }, inner);
		}

		const title = ` ${this.#title} `;
		const top = theme.fg("border", `╭─${title}${"─".repeat(Math.max(0, inner - visibleWidth(title) - 1))}╮`);
		const side = (row: string) => `${theme.fg("border", "│")} ${fit(row, inner)} ${theme.fg("border", "│")}`;
		const lines = [top];
		if (tabRow !== undefined) lines.push(side(tabRow));
		for (const row of view.render(inner)) lines.push(side(row));
		if (statusRow !== undefined) lines.push(side(statusRow));
		lines.push(side(hint));
		lines.push(theme.fg("border", `╰${"─".repeat(inner + 2)}╯`));
		return lines;
	}

	#tabRow(width: number): string | undefined {
		if (this.#states.length < 2) return undefined;
		const chips = this.#states.map((state, index) => {
			const label = ` ${state.answer.kind === "unanswered" ? "" : "✓ "}${tabLabel(state.question)} `;
			const active = this.#active.kind === "question" && this.#active.index === index;
			return active ? theme.bold(theme.bg("selectedBg", theme.fg("text", label))) : theme.fg("muted", label);
		});
		const review = ` ${tr("Review", "汇总")} `;
		chips.push(this.#active.kind === "review" ? theme.bold(theme.bg("selectedBg", theme.fg("text", review))) : theme.fg("muted", review));
		return truncateToWidth(chips.join(" "), width);
	}

	#hints(): string {
		if (this.#active.kind === "review") {
			return tr("enter submit · tab/shift+tab questions · pgup/pgdn scroll · esc cancel all", "enter 提交 · tab/shift+tab 切题 · pgup/pgdn 滚动 · esc 全部取消");
		}
		const state = this.#states[this.#active.index];
		if (state?.editing) return tr("enter save · esc back to the options", "enter 保存 · esc 回到选项");
		const next = this.#states.length > 1 ? tr(" · tab next question", " · tab 下一题") : "";
		const demo = state !== undefined && pageDemos(state).some(page => frameCount(page.demo) > 1) ? tr(" · p/[ ] demo", " · p/[ ] 演示") : "";
		return tr(
			`↑↓ choose · enter answer · o other${next}${demo} · pgup/pgdn scroll · ctrl+o code · esc cancel all`,
			`↑↓ 选择 · enter 作答 · o 其他${next}${demo} · pgup/pgdn 滚动 · ctrl+o 代码 · esc 全部取消`,
		);
	}

	#questionLines(
		index: number,
		width: number,
	): { lines: readonly string[]; focus: { start: number; end: number } | undefined; slots: readonly { slot: DemoSlot; start: number; height: number }[] } {
		const state = this.#states[index];
		if (state === undefined) return { lines: [], focus: undefined, slots: [] };
		const { question } = state;
		const { brief } = question;
		const rows: string[] = [];
		const paragraph = (source: string) => {
			for (const line of new Markdown(source, 0, 0, getMarkdownTheme()).render(width)) rows.push(line);
		};
		const heading = (label: string) => rows.push(theme.bold(theme.fg("accent", label)));
		const demos = pageDemos(state);
		const slots: { slot: DemoSlot; start: number; height: number }[] = [];
		/** Blank rows the demo's frames are drawn into, as tall as its tallest frame. */
		const reserve = (page: PageDemo | undefined) => {
			if (page === undefined) return;
			const height = this.#demoLines(page, width).length;
			slots.push({ slot: page.slot, start: rows.length, height });
			for (let row = 0; row < height; row++) rows.push("");
		};

		paragraph(question.question);
		rows.push("");
		for (const [label, body] of [
			[tr("Where", "现状"), brief.where],
			[tr("What", "决定"), brief.what],
			[tr("How", "后果"), brief.how],
		] as const) {
			heading(label);
			paragraph(body);
			rows.push("");
		}

		let focus: { start: number; end: number } | undefined;
		question.options.forEach((option, optionIndexValue) => {
			const here = state.cursor === optionIndexValue;
			const chosen = state.answer.kind === "option" && state.answer.index === optionIndexValue;
			const pointer = here ? theme.fg("accent", "›") : " ";
			const mark = chosen ? theme.fg("accent", "●") : theme.fg("muted", "○");
			const label = here ? theme.bold(theme.fg("accent", option.label)) : option.label;
			const recommended = optionIndexValue === question.recommended ? theme.fg("success", tr(" (recommended)", "（推荐）")) : "";
			const detail = option.description?.trim() ? theme.fg("muted", `  ${option.description.trim()}`) : "";
			if (here) focus = { start: rows.length, end: rows.length + 1 };
			rows.push(`${pointer} ${mark} ${label}${recommended}${detail}`);
		});
		const otherHere = onOther(state);
		const custom = state.answer.kind === "custom" ? theme.fg("accent", `  “${state.answer.text}”`) : "";
		if (otherHere) focus = { start: rows.length, end: rows.length + 1 };
		rows.push(
			`${otherHere ? theme.fg("accent", "›") : " "} ${state.answer.kind === "custom" ? theme.fg("accent", "●") : theme.fg("muted", "○")} ${otherHere ? theme.bold(theme.fg("accent", tr("Other…", "其他…"))) : tr("Other…", "其他…")}${custom}`,
		);
		rows.push("");

		const option = question.options[state.cursor];
		if (state.editing) {
			rows.push(theme.fg("accent", tr("Your answer", "你的答案")));
			const start = rows.length;
			for (const line of state.input.render(width)) rows.push(line);
			focus = { start: focus?.start ?? start, end: rows.length };
			rows.push("");
		} else if (option !== undefined) {
			for (const [label, value] of [
				[tr("Tradeoff", "取舍"), option.tradeoff],
				[tr("Holds when", "成立条件"), option.holds_when],
				[tr("Cost", "成本"), option.cost],
			] as const) {
				if (value === undefined || value.trim().length === 0) continue;
				for (const line of wrapLabelled(theme.fg("muted", `${label}  `), value.trim(), width)) rows.push(line);
			}
			if (focus !== undefined) focus = { start: focus.start, end: rows.length };
			reserve(demos.find(page => page.slot === "option"));
			rows.push("");
		}

		const questionDemo = demos.find(page => page.slot === "question");
		if (questionDemo !== undefined) {
			heading(tr("Demo", "演示"));
			reserve(questionDemo);
			rows.push("");
		}

		if (state.evidence.length > 0) {
			heading(tr("Evidence", "证据"));
			for (const entry of state.evidence) {
				switch (entry.kind) {
					case "unreadable":
						rows.push(theme.fg("error", `${entry.path}: ${entry.error}`));
						if (entry.note) rows.push(theme.fg("muted", entry.note));
						continue;
					case "directory":
						rows.push(theme.fg("muted", `${entry.path} ${tr("(directory)", "（目录）")}`));
						if (entry.note) rows.push(theme.fg("muted", entry.note));
						continue;
					case "file":
						rows.push(theme.fg("muted", `${entry.path}:${entry.start}-${entry.end}`));
						break;
					case "text":
						rows.push(`${theme.fg("muted", entry.source)}${theme.fg("warning", tr("  · quoted by the model, not read by ask-more", "  · 模型引用，ask-more 未读取核对"))}`);
						break;
				}
				if (entry.note) rows.push(theme.fg("muted", entry.note));
				const visible = state.expanded ? entry.lines : entry.lines.slice(0, DOCUMENT_SCROLL);
				visible.forEach((line, offset) => {
					const gutter = entry.kind === "file" ? `${theme.fg("dim", String(entry.start + offset).padStart(4))}  ` : "  ";
					rows.push(gutter + cutLine(line, width - visibleWidth(gutter)));
				});
				if (visible.length < entry.lines.length) {
					rows.push(theme.fg("muted", tr(`      … ${entry.lines.length - visible.length} more lines (ctrl+o)`, `      … 还有 ${entry.lines.length - visible.length} 行（ctrl+o）`)));
				}
			}
			rows.push("");
		}

		if (brief.diagram?.trim()) {
			heading(tr("Diagram", "图"));
			paragraph(`\`\`\`mermaid\n${brief.diagram.trim()}\n\`\`\``);
			rows.push("");
		}

		const risks = brief.risks?.map(risk => risk.trim()).filter(risk => risk.length > 0) ?? [];
		if (risks.length > 0) {
			heading(tr("Risks", "风险"));
			paragraph(risks.map(risk => `- ${risk}`).join("\n"));
		}
		return { lines: rows, focus, slots };
	}

	/** `lines` with each demo slot filled by the frame its playback is on. */
	#withDemoFrames(lines: readonly string[], slots: readonly { slot: DemoSlot; start: number; height: number }[], width: number): readonly string[] {
		if (slots.length === 0 || this.#active.kind !== "question") return lines;
		const state = this.#states[this.#active.index];
		if (state === undefined) return lines;
		const pages = pageDemos(state);
		const filled = lines.slice();
		for (const { slot, start, height } of slots) {
			const page = pages.find(candidate => candidate.slot === slot);
			if (page === undefined) continue;
			this.#demoLines(page, width)
				.slice(0, height)
				.forEach((line, row) => {
					filled[start + row] = line;
				});
		}
		return filled;
	}

	/** The ANSI rows of a demo on its current frame; every frame of one demo has the same height. */
	#demoLines(page: PageDemo, width: number): string[] {
		const { demo, play } = page;
		const caption = demo.caption ? wrapLabelled("", theme.fg("muted", demo.caption), width) : [];
		const controls = (count: number) =>
			theme.fg(
				"muted",
				`${play.frame + 1}/${count} ${play.playing ? "▶" : "⏸"}  ${tr(`p ${play.playing ? "pause" : "play"} · [ ] step`, `p ${play.playing ? "暂停" : "播放"} · [ ] 逐帧`)}`,
			);
		switch (demo.kind) {
			case "frames": {
				const frames = this.#renderedFrames(demo, width);
				return [...(frames[play.frame] ?? frames[0] ?? []), ...caption, controls(demo.frames.length)];
			}
			case "raster": {
				const frame = demo.frames[play.frame] ?? demo.frames[0];
				const picture = frame === undefined ? [] : halfBlockRows(frame, demo.width, demo.rows);
				return [...picture, ...caption, ...(demo.frames.length > 1 ? [controls(demo.frames.length)] : [])];
			}
			case "image":
				// Loaded for Tern, which animates it; this page draws where it is.
				return [theme.fg("muted", tr(`${demo.path} (plays in Tern)`, `${demo.path}（在 Tern 中播放）`)), ...caption];
			case "error":
				return [theme.fg("error", `${demo.path}: ${demo.error}`), ...caption];
		}
	}

	/** Every frame of a frames demo at `width`, padded to the tallest so the page does not jump. */
	#renderedFrames(demo: Extract<LoadedDemo, { kind: "frames" }>, width: number): readonly (readonly string[])[] {
		const cached = this.#frameLines.get(demo);
		if (cached?.width === width) return cached.frames;
		const rendered = demo.frames.map(frame => [
			...new Markdown(frame.body, 0, 0, getMarkdownTheme()).render(width),
			...(frame.caption ? wrapLabelled("", frame.caption, width) : []),
		]);
		const height = Math.max(...rendered.map(lines => lines.length));
		const frames = rendered.map(lines => [...lines, ...Array.from({ length: height - lines.length }, () => "")]);
		this.#frameLines.set(demo, { width, frames });
		return frames;
	}

	#reviewLines(width: number): readonly string[] {
		const rows = [theme.bold(theme.fg("accent", tr("Review your answers", "核对你的答案"))), ""];
		const unanswered = this.#states.filter(state => state.answer.kind === "unanswered").length;
		for (const state of this.#states) {
			const answer = answerLabel(state.question, state.answer);
			rows.push(theme.bold(tabLabel(state.question)));
			for (const line of wrapLabelled("  ", answer ?? theme.fg("warning", tr("unanswered", "未回答")), width)) rows.push(line);
		}
		rows.push("");
		if (unanswered > 0) rows.push(theme.fg("warning", tr(`${unanswered} unanswered; enter still submits the rest.`, `${unanswered} 题未回答；enter 仍会提交其余答案。`)));
		return rows;
	}

	// ── Tern ──────────────────────────────────────────────────────────────

	describe(_cx: DescribeContext): NativeNode {
		const scroll = this.#activeNativeScroll();
		const memo = this.#native;
		if (memo !== undefined && memo.version === this.#version && memo.frames === this.#frames && memo.scroll === scroll) return memo.node;
		const node = describeSheet(this.#states, this.#active, scroll, this.#status());
		this.#native = { version: this.#version, frames: this.#frames, scroll, node };
		return node;
	}

	/** Pointer routes: a tab switches pages, a row click moves the cursor, a double click answers, the bar presses Enter or cancels. */
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#closed) return;
		this.#activity();
		const key = leafKey(event.key);
		switch (event.type) {
			case "select":
			case "activate": {
				if (key === TABS_KEY) {
					this.#goToTabId(event.item);
					return;
				}
				const active = this.#active;
				if (active.kind !== "question" || key !== questionListKey(active.index)) return;
				const state = this.#states[active.index];
				if (state === undefined) return;
				if (event.item === OTHER_ITEM) {
					this.#change(() => {
						state.cursor = state.question.options.length;
						state.editing = true;
					});
					return;
				}
				const index = optionIndex(state.question, event.item);
				if (index === undefined) return;
				this.#change(() => {
					state.cursor = index;
					state.editing = false;
				});
				if (event.type === "activate") this.#answerOption(active.index, index);
				return;
			}
			case "action": {
				const act = parseAct(event.act);
				if (act !== undefined) this.#act(act);
				return;
			}
			case "toggle":
			case "change":
			case "edit":
			case "undo":
			case "send":
				return;
		}
	}

	// ── Keys ──────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.#closed) return;
		this.#activity();
		if (
			routeSgrMouseInput(data, mouse => {
				if (mouse.wheel === null) return false;
				this.#activeView().scroll(mouse.wheel * WHEEL_ROWS);
				return true;
			})
		) {
			return;
		}

		const active = this.#active;
		const state = active.kind === "question" ? this.#states[active.index] : undefined;
		if (state?.editing) {
			// The field owns Enter (save) and Escape (back) through its callbacks.
			state.input.handleInput(data);
			this.#change(() => {});
			return;
		}

		if (matchesKey(data, "escape")) {
			this.#submit({ kind: "cancel" });
			return;
		}
		if (this.#states.length > 1) {
			if (matchesKey(data, "tab") || matchesKey(data, "right")) {
				this.#stepTab(1);
				return;
			}
			if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
				this.#stepTab(-1);
				return;
			}
		}
		const scroll = scrollKey(data);
		if (scroll !== undefined) {
			this.#scroll(scroll, FAST_ROWS);
			return;
		}
		if (isEnter(data)) {
			this.#pressEnter();
			return;
		}

		if (state === undefined) {
			// The review page: ↑↓ read through the answers.
			if (matchesKey(data, "up")) this.#scroll("line-up", 1);
			else if (matchesKey(data, "down")) this.#scroll("line-down", 1);
			return;
		}
		if (matchesKey(data, "ctrl+o")) {
			this.#change(() => {
				state.expanded = !state.expanded;
			});
			return;
		}
		if (data === "p" || data === "P" || data === "[" || data === "]") {
			this.#moveDemos(data === "[" ? "prev" : data === "]" ? "next" : "toggle");
			return;
		}
		const rows = state.question.options.length + 1;
		if (matchesKey(data, "up")) {
			this.#change(() => {
				state.cursor = (state.cursor - 1 + rows) % rows;
			});
			return;
		}
		if (matchesKey(data, "down")) {
			this.#change(() => {
				state.cursor = (state.cursor + 1) % rows;
			});
			return;
		}
		if (data === "o" || data === "O") {
			this.#change(() => {
				state.cursor = state.question.options.length;
				state.editing = true;
			});
		}
	}

	/**
	 * Natively the terminal scrolls the sheet (a request it applies once per bump); on the ANSI page
	 * the active viewport moves. Line moves go `rows` at a time.
	 */
	#scroll(by: TspScrollBy, rows: number): void {
		const view = this.#activeView();
		if (by === "page-up") view.page(-1);
		else if (by === "page-down") view.page(1);
		else if (by === "start") view.scrollToTop();
		else if (by === "end") view.scrollToBottom();
		else view.scroll(by === "line-up" ? -rows : rows);
		const holder = this.#active.kind === "review" ? this.#review : this.#states[this.#active.index];
		if (holder !== undefined) holder.nativeScroll = { by, n: (holder.nativeScroll?.n ?? 0) + 1 };
	}

	// ── Transitions ───────────────────────────────────────────────────────

	/** Enter on the page: answer the row under the cursor, save the Other text, or submit the review. */
	#pressEnter(): void {
		const active = this.#active;
		if (active.kind === "review") {
			this.#submitAll();
			return;
		}
		const state = this.#states[active.index];
		if (state === undefined) return;
		if (state.editing) {
			this.#saveOther(active.index, state.input.getValue());
			return;
		}
		if (onOther(state)) {
			this.#change(() => {
				state.editing = true;
			});
			return;
		}
		this.#answerOption(active.index, state.cursor);
	}

	/** The state of question `page` while it is the open page; undefined once the sheet left it. */
	#openQuestion(page: number): QuestionState | undefined {
		return this.#active.kind === "question" && this.#active.index === page ? this.#states[page] : undefined;
	}

	/** A sheet button: done only while the page and state it was drawn for are still the open ones. */
	#act(act: SheetAct): void {
		switch (act.kind) {
			case "cancel":
				this.#submit({ kind: "cancel" });
				return;
			case "submit":
				if (this.#active.kind === "review") this.#submitAll();
				return;
			case "answer": {
				const state = this.#openQuestion(act.page);
				if (state !== undefined && !state.editing && state.cursor === act.option) this.#answerOption(act.page, act.option);
				return;
			}
			case "openOther": {
				const state = this.#openQuestion(act.page);
				if (state === undefined || state.editing || !onOther(state)) return;
				this.#change(() => {
					state.editing = true;
				});
				return;
			}
			case "saveOther": {
				const state = this.#openQuestion(act.page);
				if (state?.editing) this.#saveOther(act.page, state.input.getValue());
				return;
			}
			case "demo": {
				const state = this.#openQuestion(act.page);
				if (state === undefined) return;
				if (act.target.slot === "option" && (state.editing || state.cursor !== act.target.option)) return;
				this.#moveDemos(act.move, act.target.slot);
				return;
			}
		}
	}

	#answerOption(index: number, option: number): void {
		const state = this.#states[index];
		if (state === undefined) return;
		this.#change(() => {
			state.answer = { kind: "option", index: option };
			state.cursor = option;
			state.editing = false;
		});
		this.#advance(index);
	}

	/** A non-blank Other text answers the question; a blank one keeps the field open. */
	#saveOther(index: number, value: string): void {
		const state = this.#states[index];
		const text = value.trim();
		if (state === undefined || text.length === 0) return;
		this.#change(() => {
			state.answer = { kind: "custom", text };
			state.editing = false;
		});
		this.#advance(index);
	}

	/** After an answer: one question submits; in a batch the next question opens, the last one leads to the review. */
	#advance(index: number): void {
		if (this.#states.length === 1) {
			this.#submitAll();
			return;
		}
		this.#goTo(index + 1 < this.#states.length ? { kind: "question", index: index + 1 } : { kind: "review" });
	}

	#stepTab(delta: number): void {
		const count = this.#states.length + 1;
		const current = this.#active.kind === "review" ? this.#states.length : this.#active.index;
		const next = (current + delta + count) % count;
		this.#goTo(next === this.#states.length ? { kind: "review" } : { kind: "question", index: next });
	}

	#goToTabId(id: string): void {
		if (this.#states.length < 2) return;
		if (id === REVIEW_TAB) {
			this.#goTo({ kind: "review" });
			return;
		}
		const index = Number(id);
		if (Number.isInteger(index) && index >= 0 && index < this.#states.length) this.#goTo({ kind: "question", index });
	}

	#goTo(tab: ActiveTab): void {
		this.#change(() => {
			this.#active = tab;
		});
	}

	#submitAll(): void {
		this.#submit({ kind: "submit", answers: this.#states.map(state => state.answer) });
	}

	#submit(submission: Submission): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#timer?.cancel();
		this.#timer = undefined;
		this.#stopCountdown();
		this.#finish(submission);
	}

	#change(mutate: () => void): void {
		mutate();
		this.#version++;
		this.#arm();
	}

	// ── Countdown ─────────────────────────────────────────────────────────

	#status(): string | undefined {
		const countdown = this.#countdown;
		const phase: Phase = countdown.kind === "notified" ? { kind: "notified", at: countdown.at, due: countdown.due } : { kind: "idle" };
		return countdownStatus(this.#policy, phase);
	}

	#stopCountdown(): void {
		const countdown = this.#countdown;
		switch (countdown.kind) {
			case "stopped":
				break;
			case "idle":
				countdown.timer.cancel();
				break;
			case "notified":
				countdown.timer?.cancel();
				break;
		}
		this.#countdown = { kind: "stopped" };
	}

	/** Start the first countdown over: on opening, and whenever the user does anything. */
	#restartIdle(): void {
		this.#stopCountdown();
		if (this.#closed || this.#policy.kind === "off") return;
		this.#countdown = { kind: "idle", timer: this.#tui.scheduleAfter(this.#policy.idleMs, () => this.#idleEnded()) };
	}

	/** Input of any kind: the user is here, so the countdown starts over (and a notified sheet says so). */
	#activity(): void {
		if (this.#closed || this.#policy.kind === "off") return;
		const wasNotified = this.#countdown.kind === "notified";
		this.#restartIdle();
		if (wasNotified) this.#change(() => {});
	}

	#idleEnded(): void {
		if (this.#closed) return;
		const policy = this.#policy;
		switch (policy.kind) {
			case "off":
				return;
			case "decide":
				this.#expire();
				return;
			case "notify": {
				const at = new Date();
				const then = policy.then;
				const due = then.kind === "decide" ? new Date(at.getTime() + then.returnMs) : undefined;
				const timer = then.kind === "decide" ? this.#tui.scheduleAfter(then.returnMs, () => this.#expire()) : undefined;
				this.#change(() => {
					this.#countdown = { kind: "notified", at, due, timer };
				});
				// A timer, not input, changed the sheet: nothing else asks the TUI to draw it again.
				this.#tui.requestComponentRender(this);
				this.#notify(due);
				return;
			}
		}
	}

	/** The last countdown ran out: the answers given so far go back with the rest left to the model. */
	#expire(): void {
		if (this.#closed) return;
		this.#submit({ kind: "timeout", answers: this.#states.map(state => state.answer) });
	}

	// ── Demo playback ─────────────────────────────────────────────────────

	/** The demos of the open page that the component animates (Tern plays image demos itself). */
	#animatedDemos(): PageDemo[] {
		if (this.#active.kind !== "question") return [];
		const state = this.#states[this.#active.index];
		return state === undefined ? [] : pageDemos(state).filter(page => frameCount(page.demo) > 1);
	}

	/** One timer for the open page, due at the earliest next frame of a playing demo; none otherwise. */
	#arm(): void {
		this.#timer?.cancel();
		this.#timer = undefined;
		if (this.#closed) return;
		const now = performance.now();
		let due = Number.POSITIVE_INFINITY;
		for (const { demo, play } of this.#animatedDemos()) {
			const interval = frameInterval(demo);
			if (!play.playing || interval === undefined) continue;
			if (play.nextAt === 0) play.nextAt = now + interval;
			due = Math.min(due, play.nextAt);
		}
		if (due === Number.POSITIVE_INFINITY) return;
		this.#timer = this.#tui.scheduleAfter(Math.max(0, due - now), () => this.#stepFrames());
	}

	/** Step every playing demo whose frame is due, redraw, and arm the next frame. */
	#stepFrames(): void {
		this.#timer = undefined;
		if (this.#closed) return;
		const now = performance.now();
		let stepped = false;
		for (const { demo, play } of this.#animatedDemos()) {
			const interval = frameInterval(demo);
			if (!play.playing || interval === undefined || play.nextAt > now) continue;
			play.frame = (play.frame + 1) % frameCount(demo);
			play.nextAt = now + interval;
			stepped = true;
		}
		if (stepped) {
			this.#frames++;
			this.#tui.requestComponentRender(this);
		}
		this.#arm();
	}

	/** A demo control: on one demo (a button) or on every animated demo of the page (a key). */
	#moveDemos(move: DemoMove, slot?: DemoSlot): void {
		const pages = this.#animatedDemos().filter(page => slot === undefined || page.slot === slot);
		if (pages.length === 0) return;
		for (const { demo, play } of pages) {
			const count = frameCount(demo);
			if (move === "toggle") play.playing = !play.playing;
			else play.frame = (play.frame + (move === "next" ? 1 : count - 1)) % count;
			// A step or a resume shows the frame for a whole interval.
			play.nextAt = 0;
		}
		this.#frames++;
		this.#arm();
		this.#tui.requestComponentRender(this);
	}

	#activeView(): ScrollView {
		return this.#active.kind === "review" ? this.#review.view : (this.#states[this.#active.index]?.view ?? this.#review.view);
	}

	#activeNativeScroll(): NativeScrollRequest | undefined {
		return this.#active.kind === "review" ? this.#review.nativeScroll : this.#states[this.#active.index]?.nativeScroll;
	}
}

/** The scroll a key asks for: pages, ends, and Shift+↑↓ for a few lines. */
function scrollKey(data: string): TspScrollBy | undefined {
	if (matchesSelectPageUp(data)) return "page-up";
	if (matchesSelectPageDown(data)) return "page-down";
	if (matchesKey(data, "home")) return "start";
	if (matchesKey(data, "end")) return "end";
	if (matchesKey(data, "shift+up")) return "line-up";
	if (matchesKey(data, "shift+down")) return "line-down";
	return undefined;
}

/** Enter arrives as a named key, `\r` or `\n` depending on the terminal. */
function isEnter(data: string): boolean {
	return data === "\r" || data === "\n" || matchesKey(data, "enter") || matchesKey(data, "return");
}

/** `label` then `value`, wrapped to `width` with the continuation lines indented under the value. */
function wrapLabelled(label: string, value: string, width: number): string[] {
	const indent = visibleWidth(label);
	const lines = new Markdown(value, 0, 0, getMarkdownTheme()).render(Math.max(8, width - indent));
	return lines.map((line, index) => (index === 0 ? label : " ".repeat(indent)) + line);
}

/** Pad or truncate one rendered row to exactly `width` cells. */
function fit(row: string, width: number): string {
	const clipped = truncateToWidth(row, width);
	const pad = width - visibleWidth(clipped);
	return pad > 0 ? clipped + " ".repeat(pad) : clipped;
}
