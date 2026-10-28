// One component, two surfaces: `render()` draws the ANSI dialog for a plain terminal, `describe()`
// draws the native picker for a Tern pane. Both read the same state, so keys, folding and the
// focused option stay in sync (the pattern OMP's own ask dialog uses).
import {
	type Component,
	type DescribeContext,
	Markdown,
	type NativeNode,
	type NativeUiEvent,
	getMarkdownTheme,
	matchesKey,
	theme,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import type { ResolvedEvidence } from "./brief.ts";
import { tr } from "./i18n.ts";
import { describeFallback, describePicker, type PickerView } from "./nodes.ts";
import type { AskQuestion } from "./schema.ts";

export type Submission = { readonly kind: "answer"; readonly index: number } | { readonly kind: "other"; readonly text: string } | { readonly kind: "cancel" };

export interface AskMoreOptions {
	readonly question: AskQuestion;
	readonly evidence: readonly ResolvedEvidence[];
	readonly finish: (submission: Submission) => void;
}

const DOCUMENT_SCROLL = 10;

export class AskMoreComponent implements Component {
	debugKind = "AskMore";
	readonly #question: AskQuestion;
	readonly #evidence: readonly ResolvedEvidence[];
	readonly #finish: (submission: Submission) => void;
	readonly #view: { otherMode: boolean; cursor: number; other: string; expanded: boolean };
	#memo: { key: string; lines: readonly string[] } | undefined;
	#native: { key: string; node: NativeNode } | undefined;
	#closed = false;

	constructor(options: AskMoreOptions) {
		this.#question = options.question;
		this.#evidence = options.evidence;
		this.#finish = options.finish;
		this.#view = { otherMode: false, cursor: Math.min(options.question.recommended ?? 0, options.question.options.length - 1), other: "", expanded: false };
	}

	get view(): PickerView {
		return this.#view;
	}

	dispose(): void {
		this.#closed = true;
	}

	render(width: number): readonly string[] {
		const inner = Math.max(24, width - 4);
		const key = `${width}|${this.#view.otherMode}|${this.#view.cursor}|${this.#view.other}|${this.#view.expanded}`;
		if (this.#memo?.key === key) return this.#memo.lines;

		const rows: string[] = [];
		const paragraph = (source: string) => {
			for (const line of new Markdown(source, 0, 0, getMarkdownTheme()).render(inner)) rows.push(line);
		};
		const heading = (label: string) => rows.push(theme.fg("accent", label));

		const { brief, header } = this.#question;
		const title = header?.trim() || tr("Decision", "需要你决定");
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
				const visible = this.#view.expanded ? entry.lines : entry.lines.slice(0, DOCUMENT_SCROLL);
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
			const chosen = index === this.#view.cursor;
			const marker = chosen ? "●" : "○";
			const recommended = index === this.#question.recommended ? theme.fg("success", tr(" (recommended)", "（推荐）")) : "";
			const detail = option.description?.trim() ? theme.fg("muted", `  ${option.description.trim()}`) : "";
			rows.push(`${chosen ? theme.fg("accent", marker) : theme.fg("muted", marker)} ${chosen ? theme.fg("accent", option.label) : option.label}${recommended}${detail}`);
		});
		rows.push("");

		const option = this.#question.options[this.#view.cursor];
		if (option !== undefined) {
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

		if (this.#view.otherMode) {
			rows.push(theme.fg("accent", tr("Your answer", "你的答案")));
			rows.push(`> ${this.#view.other}${theme.fg("accent", "▌")}`);
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
		const key = `${cx.cols}|${this.#view.otherMode}|${this.#view.cursor}|${this.#view.other}|${this.#view.expanded}|${cx.supports("picker")}`;
		if (this.#native?.key === key) return this.#native.node;
		const node = cx.supports("picker")
			? describePicker(this.#question, this.#evidence, this.#view)
			: describeFallback(this.#question, this.#evidence, this.#view);
		this.#native = { key, node };
		return node;
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesKey(data, "ctrl+o")) {
			this.#view.expanded = !this.#view.expanded;
			return;
		}
		if (this.#view.otherMode) {
			if (matchesKey(data, "escape")) {
				this.#view.otherMode = false;
				return;
			}
			if (isEnter(data)) {
				const text = this.#view.other.trim();
				if (text.length > 0) this.#submit({ kind: "other", text });
				return;
			}
			if (matchesKey(data, "backspace")) {
				this.#view.other = this.#view.other.slice(0, -1);
				return;
			}
			this.#view.other += data.replace(/[\u0000-\u001f\u007f]/g, "");
			return;
		}
		if (matchesKey(data, "up")) {
			this.#view.cursor = (this.#view.cursor - 1 + this.#question.options.length) % this.#question.options.length;
			return;
		}
		if (matchesKey(data, "down")) {
			this.#view.cursor = (this.#view.cursor + 1) % this.#question.options.length;
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
		if (data === "o" || data === "O") this.#view.otherMode = true;
	}

	/** Pointer routes: the picker's rows select, `activate` and the action bar submit, `other` opens the input. */
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#closed) return;
		if (event.type === "select" || event.type === "activate") {
			const index = Number.parseInt(event.item.replace(/^o/, ""), 10);
			if (!Number.isInteger(index) || index < 0 || index >= this.#question.options.length) return;
			this.#view.cursor = index;
			if (event.type === "activate") this.#submit({ kind: "answer", index });
			return;
		}
		if (event.type !== "action") return;
		if (event.act === "cancel") {
			this.#submit({ kind: "cancel" });
			return;
		}
		if (event.act === "other") {
			this.#view.otherMode = true;
			return;
		}
		if (event.act === "submit" || event.act === "submit-other") {
			if (this.#view.otherMode) {
				const text = this.#view.other.trim();
				if (text.length > 0) this.#submit({ kind: "other", text });
				return;
			}
			this.#submit({ kind: "answer", index: this.#view.cursor });
		}
	}

	#submit(submission: Submission): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#finish(submission);
	}
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
