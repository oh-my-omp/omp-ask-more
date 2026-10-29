// Native composition for the ask-more sheet. The component is mounted as a fullscreen overlay and
// declares `nativeOverlay`, so the backend wraps it in Tern's sheet (the frame and the title row);
// `describe()` returns only the content. The sheet body scrolls as one column: the question tabs,
// the question and its short brief, the decision with its buttons, then the long material.
import { card, code, col, item, md, nativeImageNode, node, span, text, type NativeChild, type NativeNode, type TspSpan } from "@oh-my-pi/pi-tui";
import { actionBar, actionButton, selectList } from "@oh-my-pi/pi-tui/native/overlay";
import type { ResolvedEvidence } from "./brief.ts";
import { frameCount } from "./demo.ts";
import { tr } from "./i18n.ts";
import type { Answer } from "./result.ts";
import type { AskQuestion } from "./schema.ts";
import { type ActiveTab, type DemoSlot, type NativeScrollRequest, onOther, type PageDemo, pageDemos, type QuestionState } from "./state.ts";

/** Keys and ids the component routes (keys compared with `leafKey(event.key)`). */
export const TABS_KEY = "tabs";
export const REVIEW_TAB = "review";
export const OTHER_ITEM = "other";
/** Enter on the page: answer the row under the cursor, save the Other text, or submit the review. */
export const ENTER_ACT = "enter";
export const SUBMIT_ACT = "submit";
export const CANCEL_ACT = "cancel";

const OPTION_PREFIX = "option:";
const DEMO_PREFIX = "demo:";

/** A demo control: step back, pause or play, step forward. */
export type DemoMove = "prev" | "toggle" | "next";

function demoAct(slot: DemoSlot, move: DemoMove): string {
	return `${DEMO_PREFIX}${slot}:${move}`;
}

/** The demo and control an action id names, or undefined when it is not a demo control. */
export function parseDemoAct(act: string): { readonly slot: DemoSlot; readonly move: DemoMove } | undefined {
	if (!act.startsWith(DEMO_PREFIX)) return undefined;
	const [slot, move] = act.slice(DEMO_PREFIX.length).split(":");
	if (slot !== "question" && slot !== "option") return undefined;
	if (move !== "prev" && move !== "toggle" && move !== "next") return undefined;
	return { slot, move };
}

/** Image height cap in the sheet. */
const DEMO_IMAGE_LINES = "18lines";

/** A demo as it plays in the sheet: frames the component steps, or an image Tern animates. */
function demoNode(page: PageDemo): NativeNode {
	const { demo, play, slot } = page;
	const caption = demo.caption ? [text([span(demo.caption, "muted")], { wrap: "word" })] : [];
	switch (demo.kind) {
		case "frames": {
			const frame = demo.frames[play.frame] ?? demo.frames[0];
			const count = frameCount(demo);
			const controls = node(
				"row",
				{ gap: "sm", align: "center" },
				[
					text([span(`${play.frame + 1}/${count}`, "muted")]),
					actionButton(tr("Previous", "上一帧"), demoAct(slot, "prev"), { keys: "[" }),
					actionButton(play.playing ? tr("Pause", "暂停") : tr("Play", "播放"), demoAct(slot, "toggle"), { keys: "p" }),
					actionButton(tr("Next", "下一帧"), demoAct(slot, "next"), { keys: "]" }),
				],
				"controls",
			);
			const frameCaption = frame?.caption ? [text([span(frame.caption)], { wrap: "word" })] : [];
			return node("col", { gap: "sm", role: "omp.ask.demo" }, [node("md", { text: frame?.body ?? "" }, undefined, "frame"), ...frameCaption, ...caption, controls], `demo-${slot}`);
		}
		case "image":
			return node(
				"col",
				{ gap: "sm", role: "omp.ask.demo" },
				[nativeImageNode(demo.bytes, demo.mime, { alt: demo.caption ?? demo.path, max: { h: DEMO_IMAGE_LINES } }, "image"), ...caption],
				`demo-${slot}`,
			);
		case "raster":
			// Decoded for the ANSI page; the sheet never loads this kind.
			return node("col", { gap: "sm" }, [text([span(demo.path, "muted")]), ...caption], `demo-${slot}`);
		case "error":
			return node("card", { head: [span(demo.path, "muted")], tone: "error" }, [text([span(demo.error, "error")], { wrap: "word" }), ...caption], `demo-${slot}`);
	}
}

/** The list key of question `index`: a late click on a page already left cannot answer the new one. */
export function questionListKey(index: number): string {
	return `q${index}`;
}

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

/** The tab label of a question: its chip, else its id. */
export function tabLabel(question: AskQuestion): string {
	return question.header?.trim() || question.id;
}

/** The sheet title: the question's chip for one question, a count for a batch. */
export function sheetTitle(questions: readonly AskQuestion[]): string {
	const [only] = questions;
	if (questions.length === 1 && only !== undefined) return only.header?.trim() || tr("Decision", "需要你决定");
	return tr(`${questions.length} decisions`, `${questions.length} 个决定`);
}

/** One answer as the user reads it back. */
export function answerLabel(question: AskQuestion, answer: Answer): string | undefined {
	switch (answer.kind) {
		case "unanswered":
			return undefined;
		case "option":
			return question.options[answer.index]?.label;
		case "custom":
			return `“${answer.text}”`;
	}
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
function appendix(state: QuestionState): NativeNode[] {
	const { brief } = state.question;
	const children: NativeNode[] = [];
	if (state.evidence.length > 0) children.push(block("evidence", tr("Evidence", "证据"), evidenceCards(state.evidence, state.expanded)));
	const diagram = brief.diagram?.trim();
	if (diagram) children.push(block("diagram", tr("Diagram", "图"), [md(`\`\`\`mermaid\n${diagram}\n\`\`\``)]));
	const risks = brief.risks?.map(risk => risk.trim()).filter(risk => risk.length > 0) ?? [];
	if (risks.length > 0) children.push(block("risks", tr("Risks", "风险"), [md(risks.map(risk => `- ${risk}`).join("\n"))]));
	return children;
}

/** The options as a sheet list; the chosen one carries the accent tone. */
function options(state: QuestionState, index: number): NativeNode {
	const { question, answer } = state;
	const rows = question.options.map((option, optionIndexValue) =>
		item(optionItem(optionIndexValue), {
			label: option.label,
			...(option.description?.trim() ? { detail: option.description.trim() } : {}),
			...(optionIndexValue === question.recommended ? { value: [span(tr("Recommended", "推荐"), "accent")] } : {}),
			...(answer.kind === "option" && answer.index === optionIndexValue ? { tone: "accent" as const } : {}),
		}),
	);
	rows.push(
		item(OTHER_ITEM, {
			label: answer.kind === "custom" ? `${tr("Other", "其他")}: “${answer.text}”` : tr("Other…", "其他…"),
			...(answer.kind === "custom" ? { tone: "accent" as const } : {}),
		}),
	);
	return selectList(questionListKey(index), rows, { selected: onOther(state) ? OTHER_ITEM : optionItem(state.cursor) });
}

/** The focused option's tradeoff rows, under the options, and the demo of picking it. */
function tradeoff(state: QuestionState, demo: PageDemo | undefined): NativeNode | undefined {
	const option = state.question.options[state.cursor];
	if (option === undefined || state.editing) return undefined;
	// Label then value per row: a `kv` grid sizes its label column too narrow for CJK labels.
	const rows: NativeNode[] = (
		[
			[tr("Tradeoff", "取舍"), option.tradeoff],
			[tr("Holds when", "成立条件"), option.holds_when],
			[tr("Cost", "成本"), option.cost],
		] as const
	)
		.filter((pair): pair is readonly [string, string] => pair[1] !== undefined && pair[1].trim().length > 0)
		.map(([label, value], index) => node("text", { spans: [span(label, "muted"), span("  "), span(value.trim())], wrap: "word" }, undefined, `t${index}`));
	if (demo !== undefined) rows.push(demoNode(demo));
	return { ...card({ role: "omp.ask.tradeoff", tone: "accent", head: [span(option.label)] }, rows), key: "tradeoff" };
}

function tabs(states: readonly QuestionState[], active: ActiveTab): NativeNode | undefined {
	if (states.length < 2) return undefined;
	const items = states.map((state, index) => {
		const label: TspSpan[] = state.answer.kind === "unanswered" ? [span(tabLabel(state.question))] : [span("✓ ", "success"), span(tabLabel(state.question))];
		return { id: String(index), label };
	});
	items.push({ id: REVIEW_TAB, label: [span(tr("Review", "汇总"))] });
	return node(
		"tabs",
		{
			items,
			active: active.kind === "review" ? REVIEW_TAB : String(active.index),
			title: tr("Next question  tab · Previous  shift+tab", "下一题 tab · 上一题 shift+tab"),
			actions: { click: "select" },
		},
		undefined,
		TABS_KEY,
	);
}

/** Cancel and the page's Enter: Submit for one question, Next in a batch, Submit on the review. */
function actions(primary: { readonly label: string; readonly act: string }): NativeNode {
	return actionBar([
		null,
		actionButton(tr("Cancel all", "全部取消"), CANCEL_ACT, { keys: "escape" }),
		actionButton(primary.label, primary.act, { keys: "enter", tone: "accent" }),
	]);
}

function questionPage(states: readonly QuestionState[], index: number): NativeChild[] {
	const state = states[index];
	if (state === undefined) return [];
	const demos = pageDemos(state);
	const decision: NativeChild[] = [options(state, index)];
	const focused = tradeoff(state, demos.find(demo => demo.slot === "option"));
	if (focused !== undefined) decision.push(focused);
	// The field is its own component, so the terminal's edits and undo reach it directly.
	if (state.editing) decision.push(node("row", { role: "omp.ask.otherField" }, [state.input], "otherField"));
	const primary = state.editing
		? { label: tr("Save answer", "保存答案"), act: ENTER_ACT }
		: { label: states.length === 1 ? tr("Submit", "提交") : tr("Next", "下一题"), act: ENTER_ACT };
	// Tern scrolls a list's selection into view against the body's bottom edge, where a sticky last
	// `omp.actions` row would cover it; so the bar sits in the decision column (not last) and reveals
	// itself when a page opens, which pulls the whole decision into view after a long brief.
	decision.push({ ...actions(primary), reveal: "nearest" });
	const questionDemo = demos.find(demo => demo.slot === "question");
	const demo = questionDemo === undefined ? [] : [block("demo", tr("Demo", "演示"), [demoNode(questionDemo)])];
	return [...lead(state.question), node("col", { gap: "md" }, decision, `decision${index}`), ...demo, ...appendix(state)];
}

function reviewPage(states: readonly QuestionState[]): NativeChild[] {
	const unanswered = states.filter(state => state.answer.kind === "unanswered").length;
	// One row per question, label then answer: a `kv` grid sizes its label column too narrow for CJK labels.
	const rows = states.map((state, index) => {
		const answer = answerLabel(state.question, state.answer);
		return node(
			"text",
			{ spans: [span(tabLabel(state.question), "strong"), span("  "), answer === undefined ? span(tr("Unanswered", "未回答"), "warning") : span(answer)], wrap: "word" },
			undefined,
			`answer${index}`,
		);
	});
	return [
		node("md", { text: tr("Review your answers", "核对你的答案"), role: "omp.ask.question" }, undefined, "reviewHead"),
		...(unanswered > 0
			? [
					node(
						"text",
						{ spans: [span(tr(`${unanswered} unanswered · Submit still sends the rest`, `${unanswered} 题未回答 · 提交仍会发送其余答案`), "warning")] },
						undefined,
						"notice",
					),
				]
			: []),
		node("col", { gap: "sm" }, rows, "answers"),
		{ ...actions({ label: tr("Submit", "提交"), act: SUBMIT_ACT }), reveal: "nearest" },
	];
}

/** The sheet content for the active page. */
export function describeSheet(states: readonly QuestionState[], active: ActiveTab, scroll: NativeScrollRequest | undefined): NativeNode {
	const head = tabs(states, active);
	const page = active.kind === "review" ? reviewPage(states) : questionPage(states, active.index);
	const root = col([...(head === undefined ? [] : [head]), ...page], { gap: "md" });
	return scroll === undefined ? root : { ...root, scroll };
}
