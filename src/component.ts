// One component, two surfaces: `render()` draws the ANSI dialog for a plain terminal, `describe()`
// draws the native sheet for a Tern pane. Both read the same state, so keys, folding and the focused
// option stay in sync. The Other answer is a pi-tui `Input`: its value is the only copy of the text,
// edited by raw keys (delegated while the sheet holds focus, or direct once the field is focused) and
// by the terminal's own edit/undo events, which the reconciler routes to the field component.
import type { TspScrollBy } from "@oh-my-pi/pi-wire";
import {
	type Component,
	type DescribeContext,
	Input,
	Markdown,
	type NativeNode,
	type NativeUiEvent,
	type TUI,
	getMarkdownTheme,
	matchesKey,
	theme,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { matchesSelectPageDown, matchesSelectPageUp } from "@oh-my-pi/pi-tui/keybinding-matchers";
import { leafKey } from "@oh-my-pi/pi-tui/native/node";
import type { ResolvedEvidence } from "./brief.ts";
import { tr } from "./i18n.ts";
import { CANCEL_ACT, describeSheet, OPTIONS_KEY, OTHER_ITEM, optionIndex, type SheetView, SUBMIT_ACT, sheetTitle } from "./nodes.ts";
import type { AskQuestion } from "./schema.ts";

export type Submission = { readonly kind: "answer"; readonly index: number } | { readonly kind: "other"; readonly text: string } | { readonly kind: "cancel" };

export interface AskMoreOptions {
	readonly tui: TUI;
	readonly question: AskQuestion;
	readonly evidence: readonly ResolvedEvidence[];
	readonly finish: (submission: Submission) => void;
}

const DOCUMENT_SCROLL = 10;

export class AskMoreComponent implements Component {
	debugKind = "AskMore";
	readonly #tui: TUI;
	readonly #question: AskQuestion;
	readonly #evidence: readonly ResolvedEvidence[];
	readonly #finish: (submission: Submission) => void;
	readonly #other = new Input();
	#view: SheetView;
	#memo: { key: string; lines: readonly string[] } | undefined;
	#native: { view: SheetView; overlay: boolean; cols: number; node: NativeNode } | undefined;
	#closed = false;

	constructor(options: AskMoreOptions) {
		this.#tui = options.tui;
		this.#question = options.question;
		this.#evidence = options.evidence;
		this.#finish = options.finish;
		this.#view = {
			cursor: Math.min(options.question.recommended ?? 0, options.question.options.length - 1),
			otherMode: false,
			expanded: false,
			scroll: undefined,
		};
		this.#other.placeholder = tr("Type your own answer", "自己写一个答案");
		this.#other.onSubmit = value => this.#submitOther(value);
		this.#other.onEscape = () => this.#leaveOther();
	}

	dispose(): void {
		this.#closed = true;
	}

	render(width: number): readonly string[] {
		const inner = Math.max(24, width - 4);
		const view = this.#view;
		const key = `${width}|${view.otherMode}|${view.cursor}|${view.expanded}|${this.#other.getValue()}|${this.#other.getCursor()}`;
		if (this.#memo?.key === key) return this.#memo.lines;

		const rows: string[] = [];
		const paragraph = (source: string) => {
			for (const line of new Markdown(source, 0, 0, getMarkdownTheme()).render(inner)) rows.push(line);
		};
		const heading = (label: string) => rows.push(theme.fg("accent", label));

		const { brief } = this.#question;
		const title = sheetTitle(this.#question);
		rows.push(theme.fg("accent", title));
		paragraph(this.#question.question);
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

		if (this.#evidence.length > 0) {
			heading(tr("Evidence", "证据"));
			for (const entry of this.#evidence) {
				if (!entry.ok) {
					rows.push(theme.fg("error", `${entry.path}: ${entry.error}`));
					continue;
				}
				const location = entry.start > 0 ? `${entry.path}:${entry.start}-${entry.end}` : entry.path;
				rows.push(theme.fg("muted", location));
				if (entry.start === 0) continue;
				const visible = view.expanded ? entry.lines : entry.lines.slice(0, DOCUMENT_SCROLL);
				for (const line of visible) rows.push(`  ${line}`);
				if (visible.length < entry.lines.length) {
					rows.push(theme.fg("muted", tr(`  … ${entry.lines.length - visible.length} more lines (ctrl+o)`, `  … 还有 ${entry.lines.length - visible.length} 行（ctrl+o）`)));
				}
			}
			rows.push("");
		}

		if (brief.diagram?.trim()) {
			heading(tr("Diagram", "图"));
			paragraph(`\`\`\`mermaid\n${brief.diagram.trim()}\n\`\`\``);
			rows.push("");
		}

		const risks = brief.risks?.filter(risk => risk.trim().length > 0) ?? [];
		if (risks.length > 0) {
			heading(tr("Risks", "风险"));
			for (const risk of risks) rows.push(`  ${risk.trim()}`);
			rows.push("");
		}

		this.#question.options.forEach((option, index) => {
			const chosen = !view.otherMode && index === view.cursor;
			const marker = chosen ? "●" : "○";
			const recommended = index === this.#question.recommended ? theme.fg("success", tr(" (recommended)", "（推荐）")) : "";
			const detail = option.description?.trim() ? theme.fg("muted", `  ${option.description.trim()}`) : "";
			rows.push(`${chosen ? theme.fg("accent", marker) : theme.fg("muted", marker)} ${chosen ? theme.fg("accent", option.label) : option.label}${recommended}${detail}`);
		});
		rows.push("");

		const option = this.#question.options[view.cursor];
		if (!view.otherMode && option !== undefined) {
			for (const [label, value] of [
				[tr("Tradeoff", "取舍"), option.tradeoff],
				[tr("Holds when", "成立条件"), option.holds_when],
				[tr("Cost", "成本"), option.cost],
			] as const) {
				if (value === undefined || value.trim().length === 0) continue;
				rows.push(`${theme.fg("muted", `${label}  `)}${value.trim()}`);
			}
			rows.push("");
		}

		if (view.otherMode) {
			rows.push(theme.fg("accent", tr("Your answer", "你的答案")));
			for (const line of this.#other.render(inner)) rows.push(line);
			rows.push(theme.fg("muted", tr("enter submit · esc back", "enter 提交 · esc 返回")));
		} else {
			rows.push(theme.fg("muted", tr("↑↓ select · enter submit · o other · esc cancel", "↑↓ 选择 · enter 提交 · o 其他 · esc 取消")));
		}

		const top = theme.fg("border", `╭─ ${title} ${"─".repeat(Math.max(0, inner - visibleWidth(title) - 3))}╮`);
		const bottom = theme.fg("border", `╰${"─".repeat(inner + 2)}╯`);
		const lines = [top, ...rows.map(row => `${theme.fg("border", "│")} ${fit(row, inner)} ${theme.fg("border", "│")}`), bottom];
		this.#memo = { key, lines };
		return lines;
	}

	describe(cx: DescribeContext): NativeNode {
		const overlay = cx.supports("overlay");
		const native = this.#native;
		if (native !== undefined && native.view === this.#view && native.overlay === overlay && native.cols === cx.cols) return native.node;
		const node = describeSheet(this.#question, this.#evidence, this.#view, this.#other, { overlay, cols: cx.cols });
		this.#native = { view: this.#view, overlay, cols: cx.cols, node };
		return node;
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesKey(data, "ctrl+o")) {
			this.#update({ expanded: !this.#view.expanded });
			return;
		}
		if (this.#view.otherMode) {
			// The field owns Escape (back) and Enter (submit) through its callbacks.
			this.#other.handleInput(data);
			this.#memo = undefined;
			return;
		}
		const count = this.#question.options.length;
		if (matchesKey(data, "up")) {
			this.#update({ cursor: (this.#view.cursor - 1 + count) % count });
			return;
		}
		if (matchesKey(data, "down")) {
			this.#update({ cursor: (this.#view.cursor + 1) % count });
			return;
		}
		const scroll = scrollKey(data);
		if (scroll !== undefined) {
			this.#update({ scroll: { by: scroll, n: (this.#view.scroll?.n ?? 0) + 1 } });
			return;
		}
		if (isEnter(data)) {
			this.#submit({ kind: "answer", index: this.#view.cursor });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.#submit({ kind: "cancel" });
			return;
		}
		if (data === "o" || data === "O") this.#enterOther();
	}

	/** Pointer routes: a row click selects (Other opens the field), a double click answers, the bar submits or cancels. */
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#closed) return;
		switch (event.type) {
			case "select":
			case "activate": {
				if (leafKey(event.key) !== OPTIONS_KEY) return;
				if (event.item === OTHER_ITEM) {
					this.#enterOther();
					return;
				}
				const index = optionIndex(this.#question, event.item);
				if (index === undefined) return;
				if (event.type === "activate") {
					this.#submit({ kind: "answer", index });
					return;
				}
				this.#update({ cursor: index, otherMode: false });
				return;
			}
			case "action":
				if (event.act === CANCEL_ACT) this.#submit({ kind: "cancel" });
				else if (event.act === SUBMIT_ACT) {
					if (this.#view.otherMode) this.#submitOther(this.#other.getValue());
					else this.#submit({ kind: "answer", index: this.#view.cursor });
				}
				return;
			case "toggle":
			case "change":
			case "edit":
			case "undo":
			case "send":
				return;
		}
	}

	#update(patch: Partial<SheetView>): void {
		this.#view = { ...this.#view, ...patch };
	}

	#enterOther(): void {
		this.#update({ otherMode: true });
	}

	/** Back to the options; a field focused by pointer hands the keys back to the sheet. */
	#leaveOther(): void {
		this.#update({ otherMode: false });
		this.#tui.setFocus(this);
		this.#tui.requestRender();
	}

	#submitOther(value: string): void {
		const text = value.trim();
		if (text.length > 0) this.#submit({ kind: "other", text });
	}

	#submit(submission: Submission): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#finish(submission);
	}
}

function scrollKey(data: string): TspScrollBy | undefined {
	if (matchesSelectPageUp(data)) return "page-up";
	if (matchesSelectPageDown(data)) return "page-down";
	if (matchesKey(data, "home")) return "start";
	if (matchesKey(data, "end")) return "end";
	return undefined;
}

/** Enter arrives as a named key, `\r` or `\n` depending on the terminal. */
function isEnter(data: string): boolean {
	return data === "\r" || data === "\n" || matchesKey(data, "enter") || matchesKey(data, "return");
}

/** Pad or truncate one rendered row to exactly `width` cells. */
function fit(row: string, width: number): string {
	const clipped = truncateToWidth(row, width);
	const pad = width - visibleWidth(clipped);
	return pad > 0 ? clipped + " ".repeat(pad) : clipped;
}
