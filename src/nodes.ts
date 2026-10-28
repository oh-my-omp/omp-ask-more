// Native node composition for the ask-more surface: a picker sheet whose side preview holds the
// brief, the resolved evidence, the diagram and the focused option's tradeoffs. The native
// fallback (`describeFallback`) is for a Tern pane that lacks `picker`.
import { card, code, col, item, kv, md, node, span, text, type NativeChild, type NativeNode } from "@oh-my-pi/pi-tui";
import type { ResolvedEvidence } from "./brief.ts";
import { tr } from "./i18n.ts";
import type { AskQuestion } from "./schema.ts";

export interface PickerView {
	readonly cursor: number;
	readonly otherMode: boolean;
	readonly other: string;
	readonly expanded: boolean;
}

/** Code rows drawn per evidence reference before folding. */
const EVIDENCE_ROWS = 12;

function evidenceChildren(evidence: readonly ResolvedEvidence[], expanded: boolean): NativeChild[] {
	return evidence.map((entry, index) => {
		if (!entry.ok) {
			return card({ head: [span(entry.path, "muted")], tone: "error" }, [
				text([span(entry.error, "error")], { wrap: "word" }),
				...(entry.note ? [text([span(entry.note, "muted")], { wrap: "word" })] : []),
			]);
		}
		const head = entry.start > 0 ? `${entry.path}:${entry.start}-${entry.end}` : entry.path;
		return card({ head: [span(head, "muted")] }, [
			...(entry.start > 0
				? [code(entry.lines.join("\n"), { path: entry.path, start: entry.start, numbers: true, ...(expanded ? {} : { preview: { lines: EVIDENCE_ROWS } }) })]
				: [text([span(tr("directory", "目录"), "muted")])]),
			...(entry.note ? [text([span(entry.note, "muted")], { wrap: "word" })] : []),
		]);
	});
}

function briefChildren(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: PickerView): NativeChild[] {
	const { brief } = question;
	const sections: NativeChild[] = [
		node("section", { head: tr("Where", "现状"), collapsible: true, collapsed: false }, [md(brief.where)]),
		node("section", { head: tr("What", "决定"), collapsible: true, collapsed: false }, [md(brief.what)]),
		node("section", { head: tr("How", "后果"), collapsible: true, collapsed: false }, [md(brief.how)]),
	];
	const evidenceNodes = evidenceChildren(evidence, view.expanded);
	if (evidenceNodes.length > 0) {
		sections.push(node("section", { head: tr("Evidence", "证据"), collapsible: true, collapsed: false }, evidenceNodes));
	}
	if (brief.diagram?.trim()) {
		sections.push(node("section", { head: tr("Diagram", "图"), collapsible: true, collapsed: false }, [md(`\`\`\`mermaid\n${brief.diagram.trim()}\n\`\`\``)]));
	}
	const risks = brief.risks?.filter(risk => risk.trim().length > 0) ?? [];
	if (risks.length > 0) {
		sections.push(node("section", { head: tr("Risks", "风险"), collapsible: true, collapsed: false }, [md(risks.map(risk => `- ${risk.trim()}`).join("\n"))]));
	}
	return [node("col", { gap: "sm" }, sections)];
}

/** The focused option's tradeoff rows, drawn under the brief. */
function tradeoffNode(question: AskQuestion, view: PickerView): NativeNode | undefined {
	const option = question.options[view.cursor];
	if (option === undefined) return undefined;
	const rows = kv([
		[tr("Tradeoff", "取舍"), option.tradeoff],
		[tr("Holds when", "成立条件"), option.holds_when],
		[tr("Cost", "成本"), option.cost],
	]);
	return rows === undefined ? undefined : card({ head: [span(option.label)], tone: "accent" }, [rows]);
}

function otherNode(view: PickerView): NativeNode {
	return node(
		"input",
		{
			text: view.other,
			cursor: view.other.length,
			readonly: true,
			placeholder: tr("Type your own answer", "自己写一个答案"),
		},
		undefined,
		"other",
	);
}

export function previewChildren(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: PickerView): NativeChild[] {
	const tradeoff = tradeoffNode(question, view);
	return [
		...briefChildren(question, evidence, view),
		...(tradeoff === undefined ? [] : [tradeoff]),
		...(view.otherMode ? [otherNode(view)] : []),
	];
}

/**
 * The picker sheet, docked as a child named `picker` so the reconciler hoists it into `layer`
 * (see `dockedPicker` in `packages/tui/src/native/picker.ts`).
 */
export function describePicker(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: PickerView): NativeNode {
	const options = question.options;
	const items = options.map((option, index) => ({
		id: `o${index}`,
		label: option.label,
		...(option.description?.trim() ? { detail: option.description.trim() } : {}),
		...(index === question.recommended ? { badges: [{ text: tr("Recommended", "推荐"), tone: "accent" as const }] } : {}),
	}));
	const actions = [
		{ id: "submit", label: tr("Submit", "提交"), keys: ["enter"], primary: true },
		{ id: "other", label: tr("Other", "其他"), keys: ["o"] },
		...(view.otherMode ? [{ id: "submit-other", label: tr("Submit text", "提交文本"), keys: ["enter"], primary: true }] : []),
		{ id: "cancel", label: tr("Cancel", "取消"), keys: ["esc"], end: true },
	];
	return col([
		node(
			"picker",
			{
				title: question.header?.trim() || tr("Decision", "需要你决定"),
				subtitle: question.question,
				noun: tr("options", "个选项"),
				size: "screen",
				layout: "cards",
				preview: "side",
				query: null,
				items,
				selected: `o${view.cursor}`,
				actions,
				focus: "list",
			},
			previewChildren(question, evidence, view),
			"picker",
		),
	]);
}

/** A Tern pane without `picker`: the same content as a plain column. */
export function describeFallback(question: AskQuestion, evidence: readonly ResolvedEvidence[], view: PickerView): NativeNode {
	const items = question.options.map((option, index) =>
		item(`o${index}`, { label: option.label, ...(option.description?.trim() ? { detail: option.description.trim() } : {}) }),
	);
	const tradeoff = tradeoffNode(question, view);
	return col([
		md(question.question),
		...briefChildren(question, evidence, view),
		node("list", { selected: `o${view.cursor}`, actions: { click: "select" } }, items, "options"),
		...(tradeoff === undefined ? [] : [tradeoff]),
		...(view.otherMode ? [otherNode(view)] : []),
		text([span(tr("enter submit · o other · esc cancel", "enter 提交 · o 其他 · esc 取消"), "muted")]),
	]);
}
