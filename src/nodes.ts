// Native composition for the ask-more sheet. The component sits in the composer dock (where
// `ui.custom` mounts it) and describes an `overlay` node, which the reconciler hoists into `layer`:
// a centered modal sheet over the transcript. The sheet body scrolls as one column: question, short
// brief, the decision with its Cancel/Submit bar, then the long material.
import type { TspScrollBy } from "@oh-my-pi/pi-wire";
import { card, code, col, item, kv, md, node, span, text, type Component, type NativeChild, type NativeNode } from "@oh-my-pi/pi-tui";
import { actionBar, actionButton, NARROW_SHEET_COLS, selectList } from "@oh-my-pi/pi-tui/native/overlay";
import type { ResolvedEvidence } from "./brief.ts";
import { tr } from "./i18n.ts";
import type { AskQuestion } from "./schema.ts";

/** Keys of the nodes whose events the component routes (compared with `leafKey(event.key)`). */
export const OPTIONS_KEY = "options";
export const OTHER_ITEM = "other";
export const SUBMIT_ACT = "submit";
export const CANCEL_ACT = "cancel";

const OPTION_PREFIX = "option:";

/** The list item key of option `index`. */
export function optionItem(index: number): string {
	return `${OPTION_PREFIX}${index}`;
}

/** The option index an item key names, or undefined when it names no option of `question`. */
export function optionIndex(question: AskQuestion, item: string): number | undefined {
	for (let index = 0; index < question.options.length; index++) {
		if (optionItem(index) === item) return index;
	}
	return undefined;
}

/** Everything the sheet shows that changes while it is open. */
export interface SheetView {
	readonly cursor: number;
	readonly otherMode: boolean;
	readonly expanded: boolean;
	/** The latest keyboard scroll request for the sheet, bumped per key press. */
	readonly scroll: { readonly by: TspScrollBy; readonly n: number } | undefined;
}

/** Code rows drawn per evidence reference until the terminal's own "more lines" control (or ctrl+o) opens it. */
const EVIDENCE_ROWS = 12;

function evidenceCards(evidence: readonly ResolvedEvidence[], expanded: boolean): NativeChild[] {
	return evidence.map((entry, index) => {
		const note = entry.note ? [text([span(entry.note, "muted")], { wrap: "word" })] : [];
		if (!entry.ok) {
			return node("card", { head: [span(entry.path, "muted")], tone: "error" }, [text([span(entry.error, "error")], { wrap: "word" }), ...note], `ev${index}`);
		}
		const head = entry.start > 0 ? `${entry.path}:${entry.start}-${entry.end}` : entry.path;
		const content =
			entry.start > 0
				? code(entry.lines.join("\n"), { path: entry.path, start: entry.start, numbers: true, ...(expanded ? {} : { preview: { lines: EVIDENCE_ROWS } }) })
				: text([span(tr("directory", "目录"), "muted")]);
		return node("card", { head: [span(head, "muted")] }, [content, ...note], `ev${index}`);
	});
}

/** A titled block of the brief: plain columns, since Tern draws a `section` as a foldable `##` heading. */
function block(key: string, head: string, children: readonly NativeChild[]): NativeNode {
	return node("col", { gap: "sm" }, [text([span(head, "accent strong")]), ...children], key);
}

/** The question and the short brief the options answer to. */
function lead(question: AskQuestion): NativeNode[] {
	const { brief } = question;
	return [
		node("md", { text: question.question, role: "omp.ask.question" }, undefined, "question"),
		block("where", tr("Where", "现状"), [md(brief.where)]),
		block("what", tr("What", "决定"), [md(brief.what)]),
		block("how", tr("How", "后果"), [md(brief.how)]),
	];
}

/** The long material: real evidence lines, the diagram, the risks. */
function appendix(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: SheetView): NativeNode[] {
	const { brief } = question;
	const children: NativeNode[] = [];
	if (evidence.length > 0) children.push(block("evidence", tr("Evidence", "证据"), evidenceCards(evidence, view.expanded)));
	const diagram = brief.diagram?.trim();
	if (diagram) children.push(block("diagram", tr("Diagram", "图"), [md(`\`\`\`mermaid\n${diagram}\n\`\`\``)]));
	const risks = brief.risks?.map(risk => risk.trim()).filter(risk => risk.length > 0) ?? [];
	if (risks.length > 0) children.push(block("risks", tr("Risks", "风险"), [md(risks.map(risk => `- ${risk}`).join("\n"))]));
	return children;
}

/** The options as a sheet list (Tern's `omp.ask.*` roles style the dock ask, not a sheet). */
function options(question: AskQuestion, view: SheetView): NativeNode {
	const rows = question.options.map((option, index) =>
		item(optionItem(index), {
			label: option.label,
			...(option.description?.trim() ? { detail: option.description.trim() } : {}),
			...(index === question.recommended ? { value: [span(tr("Recommended", "推荐"), "accent")] } : {}),
		}),
	);
	rows.push(item(OTHER_ITEM, { label: tr("Other…", "其他…") }));
	return selectList(OPTIONS_KEY, rows, { selected: view.otherMode ? OTHER_ITEM : optionItem(view.cursor) });
}

/** The focused option's tradeoff rows, under the options. */
function tradeoff(question: AskQuestion, view: SheetView): NativeNode | undefined {
	if (view.otherMode) return undefined;
	const option = question.options[view.cursor];
	if (option === undefined) return undefined;
	const rows = kv([
		[tr("Tradeoff", "取舍"), option.tradeoff],
		[tr("Holds when", "成立条件"), option.holds_when],
		[tr("Cost", "成本"), option.cost],
	]);
	return rows === undefined ? undefined : card({ role: "omp.ask.tradeoff", tone: "accent", head: [span(option.label)] }, [rows]);
}

function actions(): NativeNode {
	return actionBar([
		null,
		actionButton(tr("Cancel", "取消"), CANCEL_ACT, { keys: "escape" }),
		actionButton(tr("Submit", "提交"), SUBMIT_ACT, { keys: "enter", tone: "accent" }),
	]);
}

/**
 * The sheet's content. Tern scrolls a sheet's body as one column and scrolls a list's selection into
 * view whenever it is added or moves, aligned with the body's bottom edge — where a sheet's sticky
 * last `omp.actions` row would cover it. So Cancel/Submit sit inside the decision column (never that
 * sticky row), right under the options, the focused tradeoff and the Other field, and reveal
 * themselves when the sheet opens: after a long brief the whole decision is pulled into view, after a
 * short one nothing moves. The long material (evidence, diagram, risks) follows the decision.
 */
function sheet(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: SheetView, other: Component): NativeNode {
	const decision: NativeNode[] = [options(question, view)];
	const focused = tradeoff(question, view);
	if (focused !== undefined) decision.push({ ...focused, key: "tradeoff" });
	// The field is its own component, so the terminal's edits and undo reach it directly.
	if (view.otherMode) decision.push(node("row", { role: "omp.ask.otherField" }, [other], "otherField"));
	// Walked after the list, so this reveal runs after the list's own and leaves the bar in view.
	decision.push({ ...actions(), reveal: "nearest" });
	const root = col([...lead(question), node("col", { gap: "md" }, decision, "decision"), ...appendix(question, evidence, view)], { gap: "md" });
	return view.scroll === undefined ? root : { ...root, scroll: view.scroll };
}

/** The sheet title: the question's chip, else a generic one. */
export function sheetTitle(question: AskQuestion): string {
	return question.header?.trim() || tr("Decision", "需要你决定");
}

/**
 * The described root. With `overlay` the sheet floats over the transcript (filling a narrow pane);
 * a terminal without it gets the same content in the dock.
 */
export function describeSheet(
	question: AskQuestion,
	evidence: readonly ResolvedEvidence[],
	view: SheetView,
	other: Component,
	surface: { readonly overlay: boolean; readonly cols: number },
): NativeNode {
	const content = sheet(question, evidence, view, other);
	if (!surface.overlay) return col([text([span(sheetTitle(question), "accent strong")]), content], { gap: "md" });
	return col([
		node(
			"overlay",
			{
				anchor: "center",
				size: surface.cols < NARROW_SHEET_COLS ? "full" : "lg",
				modal: true,
				role: "omp.overlay.askMore",
				head: sheetTitle(question),
			},
			[content],
			"sheet",
		),
	]);
}
