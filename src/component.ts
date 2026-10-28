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
	type TUI,
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
import { tr } from "./i18n.ts";
import {
	answerLabel,
	CANCEL_ACT,
	describeSheet,
	ENTER_ACT,
	OTHER_ITEM,
	optionIndex,
	questionListKey,
	REVIEW_TAB,
	SUBMIT_ACT,
	sheetTitle,
	TABS_KEY,
	tabLabel,
} from "./nodes.ts";
import { type Answer, UNANSWERED } from "./result.ts";
import type { AskQuestion } from "./schema.ts";
import { type ActiveTab, type NativeScrollRequest, onOther, type QuestionState, type ReviewState } from "./state.ts";

export type Submission = { readonly kind: "submit"; readonly answers: readonly Answer[] } | { readonly kind: "cancel" };

export interface AskMoreOptions {
	readonly tui: TUI;
	readonly questions: readonly AskQuestion[];
	/** Resolved evidence, one list per question. */
	readonly evidence: readonly (readonly ResolvedEvidence[])[];
	readonly finish: (submission: Submission) => void;
}

/** Evidence rows drawn per reference in the ANSI page before ctrl+o opens them. */
const DOCUMENT_SCROLL = 10;
/** Rows a mouse-wheel notch or Shift+↑↓ moves the ANSI body. */
const WHEEL_ROWS = 3;
const FAST_ROWS = 5;

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
	readonly #tui: TUI;
	readonly #finish: (submission: Submission) => void;
	readonly #states: readonly QuestionState[];
	readonly #review: ReviewState = { view: newView(), nativeScroll: undefined };
	readonly #title: string;
	#active: ActiveTab = { kind: "question", index: 0 };
	/** Bumped on every change a surface draws; scrolling alone does not change it. */
	#version = 0;
	#body: { key: string; lines: readonly string[]; focus: { start: number; end: number } | undefined } | undefined;
	#native: { version: number; scroll: NativeScrollRequest | undefined; node: NativeNode } | undefined;
	#closed = false;

	constructor(options: AskMoreOptions) {
		this.#tui = options.tui;
		this.#finish = options.finish;
		this.#title = sheetTitle(options.questions);
		this.nativeOverlay = { role: "omp.overlay.askMore", size: "full", anchor: "center", head: this.#title };
		this.#states = options.questions.map((question, index) => {
			const input = new Input();
			input.placeholder = tr("Type your own answer", "自己写一个答案");
			const state: QuestionState = {
				question,
				evidence: options.evidence[index] ?? [],
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
	}

	dispose(): void {
		this.#closed = true;
		for (const state of this.#states) state.view.dispose?.();
		this.#review.view.dispose?.();
	}

	// ── ANSI ──────────────────────────────────────────────────────────────

	render(width: number): readonly string[] {
		const inner = Math.max(24, width - 4);
		const bodyWidth = Math.max(1, inner - 1);
		const tabRow = this.#tabRow(inner);
		const hint = theme.fg("muted", this.#hints());
		const bodyHeight = Math.max(1, this.#tui.terminal.rows - 3 - (tabRow === undefined ? 0 : 1));

		const view = this.#activeView();
		const key = `${this.#version}|${bodyWidth}|${this.#active.kind === "review" ? "review" : this.#active.index}`;
		if (this.#body?.key !== key) {
			const built = this.#active.kind === "review" ? { lines: this.#reviewLines(bodyWidth), focus: undefined } : this.#questionLines(this.#active.index, bodyWidth);
			this.#body = { key, ...built };
			view.setLines(built.lines);
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
		return tr(
			`↑↓ choose · enter answer · o other${next} · pgup/pgdn scroll · ctrl+o code · esc cancel all`,
			`↑↓ 选择 · enter 作答 · o 其他${next} · pgup/pgdn 滚动 · ctrl+o 代码 · esc 全部取消`,
		);
	}

	#questionLines(index: number, width: number): { lines: readonly string[]; focus: { start: number; end: number } | undefined } {
		const state = this.#states[index];
		if (state === undefined) return { lines: [], focus: undefined };
		const { question } = state;
		const { brief } = question;
		const rows: string[] = [];
		const paragraph = (source: string) => {
			for (const line of new Markdown(source, 0, 0, getMarkdownTheme()).render(width)) rows.push(line);
		};
		const heading = (label: string) => rows.push(theme.bold(theme.fg("accent", label)));

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
			rows.push("");
		}

		if (state.evidence.length > 0) {
			heading(tr("Evidence", "证据"));
			for (const entry of state.evidence) {
				if (!entry.ok) {
					rows.push(theme.fg("error", `${entry.path}: ${entry.error}`));
					continue;
				}
				const location = entry.start > 0 ? `${entry.path}:${entry.start}-${entry.end}` : entry.path;
				rows.push(theme.fg("muted", location));
				if (entry.note) rows.push(theme.fg("muted", entry.note));
				if (entry.start === 0) continue;
				const visible = state.expanded ? entry.lines : entry.lines.slice(0, DOCUMENT_SCROLL);
				visible.forEach((line, offset) => rows.push(`${theme.fg("dim", String(entry.start + offset).padStart(4))}  ${line}`));
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
		return { lines: rows, focus };
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
		if (memo !== undefined && memo.version === this.#version && memo.scroll === scroll) return memo.node;
		const node = describeSheet(this.#states, this.#active, scroll);
		this.#native = { version: this.#version, scroll, node };
		return node;
	}

	/** Pointer routes: a tab switches pages, a row click moves the cursor, a double click answers, the bar presses Enter or cancels. */
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#closed) return;
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
			case "action":
				if (event.act === CANCEL_ACT) this.#submit({ kind: "cancel" });
				else if (event.act === ENTER_ACT) this.#pressEnter();
				else if (event.act === SUBMIT_ACT) this.#submitAll();
				return;
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
		this.#finish(submission);
	}

	#change(mutate: () => void): void {
		mutate();
		this.#version++;
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
