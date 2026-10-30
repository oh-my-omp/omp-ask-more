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

const OPTION_PREFIX = "option:";

/** A demo control: step back, pause or play, step forward. */
export type DemoMove = "prev" | "toggle" | "next";

/** The demo a control was drawn for: the question's, or the one of the option it was focused on. */
export type DemoTarget = { readonly slot: "question" } | { readonly slot: "option"; readonly option: number };

/**
 * What a sheet button does, and for which state it was drawn. Tern keeps routing a click on a node
 * the sheet has since redrawn, so every act that depends on the page carries that page and the
 * state it meant; the component drops the act when the state has moved on.
 */
export type SheetAct =
	| { readonly kind: "cancel" }
	| { readonly kind: "submit" }
	| { readonly kind: "answer"; readonly page: number; readonly option: number }
	| { readonly kind: "openOther"; readonly page: number }
	| { readonly kind: "saveOther"; readonly page: number }
	| { readonly kind: "demo"; readonly page: number; readonly target: DemoTarget; readonly move: DemoMove };

/** The action id a button sends for `act`. */
export function encodeAct(act: SheetAct): string {
	switch (act.kind) {
		case "cancel":
			return "cancel";
		case "submit":
			return "submit";
		case "answer":
			return `answer:${act.page}:${act.option}`;
		case "openOther":
			return `other:${act.page}`;
		case "saveOther":
			return `save:${act.page}`;
		case "demo":
			return act.target.slot === "question" ? `demo:${act.page}:question:${act.move}` : `demo:${act.page}:option:${act.target.option}:${act.move}`;
	}
}

/** A non-negative integer written in decimal digits only. */
function parseIndex(text: string | undefined): number | undefined {
	return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;
}

function parseMove(text: string | undefined): DemoMove | undefined {
	return text === "prev" || text === "toggle" || text === "next" ? text : undefined;
}

/** The act an action id names, or undefined when it names none. */
export function parseAct(id: string): SheetAct | undefined {
	const [kind, ...rest] = id.split(":");
	switch (kind) {
		case "cancel":
			return rest.length === 0 ? { kind: "cancel" } : undefined;
		case "submit":
			return rest.length === 0 ? { kind: "submit" } : undefined;
		case "answer": {
			const page = parseIndex(rest[0]);
			const option = parseIndex(rest[1]);
			return rest.length === 2 && page !== undefined && option !== undefined ? { kind: "answer", page, option } : undefined;
		}
		case "other":
		case "save": {
			const page = parseIndex(rest[0]);
			if (rest.length !== 1 || page === undefined) return undefined;
			return kind === "other" ? { kind: "openOther", page } : { kind: "saveOther", page };
		}
		case "demo": {
			const page = parseIndex(rest[0]);
			if (page === undefined) return undefined;
			if (rest[1] === "question" && rest.length === 3) {
				const move = parseMove(rest[2]);
				return move === undefined ? undefined : { kind: "demo", page, target: { slot: "question" }, move };
			}
			if (rest[1] === "option" && rest.length === 4) {
				const option = parseIndex(rest[2]);
				const move = parseMove(rest[3]);
				return option === undefined || move === undefined ? undefined : { kind: "demo", page, target: { slot: "option", option }, move };
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

/** The demo a control drives: the question's, or the focused option's, which owns its playback. */
function demoTarget(demo: PageDemo): DemoTarget {
	return demo.slot === "question" ? { slot: "question" } : { slot: "option", option: demo.play.owner };
}

/** Image height cap in the sheet. */
const DEMO_IMAGE_LINES = "18lines";

/** A demo as it plays in the sheet on question `page`: frames the component steps, or an image Tern animates. */
function demoNode(demoPage: PageDemo, page: number): NativeNode {
	const { demo, play, slot } = demoPage;
	const caption = demo.caption ? [text([span(demo.caption, "muted")], { wrap: "word" })] : [];
	switch (demo.kind) {
		case "frames": {
			const frame = demo.frames[play.frame] ?? demo.frames[0];
			const count = frameCount(demo);
			const target = demoTarget(demoPage);
			const control = (move: DemoMove) => encodeAct({ kind: "demo", page, target, move });
			const controls = node(
				"row",
				{ gap: "sm", align: "center" },
				[
					text([span(`${play.frame + 1}/${count}`, "muted")]),
					actionButton(tr("Previous", "上一帧"), control("prev"), { keys: "[" }),
					actionButton(play.playing ? tr("Pause", "暂停") : tr("Play", "播放"), control("toggle"), { keys: "p" }),
					actionButton(tr("Next", "下一帧"), control("next"), { keys: "]" }),
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

/** The options as the native ask's list (`omp.ask.options`), so Tern's ask styling marks the chosen one. */
function options(state: QuestionState, index: number): NativeNode {
	const { question, answer } = state;
	const rows = question.options.map((option, optionIndexValue) =>
		item(optionItem(optionIndexValue), {
			role: "omp.ask.option",
			label: option.label,
			...(option.description?.trim() ? { detail: option.description.trim() } : {}),
			...(optionIndexValue === question.recommended ? { value: [span(tr("Recommended", "推荐"))] } : {}),
			...(answer.kind === "option" && answer.index === optionIndexValue ? { tone: "accent" as const } : {}),
		}),
	);
	rows.push(
		item(OTHER_ITEM, {
			role: "omp.ask.other",
			label: answer.kind === "custom" ? `${tr("Other", "其他")}: “${answer.text}”` : tr("Other…", "其他…"),
			...(answer.kind === "custom" ? { tone: "accent" as const } : {}),
		}),
	);
	return selectList(questionListKey(index), rows, { role: "omp.ask.options", selected: onOther(state) ? OTHER_ITEM : optionItem(state.cursor) });
}

/** The focused option's tradeoff rows, under the options, and the demo of picking it, on question `page`. */
function tradeoff(state: QuestionState, demo: PageDemo | undefined, page: number): NativeNode | undefined {
	const option = state.question.options[state.cursor];
	if (option === undefined || state.editing) return undefined;
	// Label then value per row, the value wrapping under its own label.
	const rows: NativeNode[] = (
		[
			[tr("Tradeoff", "取舍"), option.tradeoff],
			[tr("Holds when", "成立条件"), option.holds_when],
			[tr("Cost", "成本"), option.cost],
		] as const
	)
		.filter((pair): pair is readonly [string, string] => pair[1] !== undefined && pair[1].trim().length > 0)
		.map(([label, value], index) => node("text", { spans: [span(label, "muted"), span("  "), span(value.trim())], wrap: "word" }, undefined, `t${index}`));
	if (demo !== undefined) rows.push(demoNode(demo, page));
	return { ...card({ role: "omp.ask.tradeoff", tone: "accent", head: [span(option.label)] }, rows), key: "tradeoff" };
}

/** The question tabs in the native ask's head row (`omp.ask.head` > `omp.ask.questions`). */
function tabs(states: readonly QuestionState[], active: ActiveTab): NativeNode | undefined {
	if (states.length < 2) return undefined;
	const items = states.map((state, index) => {
		const label: TspSpan[] = state.answer.kind === "unanswered" ? [span(tabLabel(state.question))] : [span("✓ ", "success"), span(tabLabel(state.question))];
		return { id: String(index), label };
	});
	items.push({ id: REVIEW_TAB, label: [span(tr("Review", "汇总"))] });
	const strip = node(
		"tabs",
		{
			role: "omp.ask.questions",
			items,
			active: active.kind === "review" ? REVIEW_TAB : String(active.index),
			title: tr("Next question  tab · Previous  shift+tab", "下一题 tab · 上一题 shift+tab"),
			actions: { click: "select" },
		},
		undefined,
		TABS_KEY,
	);
	return node("row", { role: "omp.ask.head", align: "center" }, [strip], "head");
}

/** Cancel and the page's primary act: Submit for one question, Next in a batch, Submit on the review. */
function actions(primary: { readonly label: string; readonly act: SheetAct }): NativeNode {
	return actionBar([
		null,
		actionButton(tr("Cancel all", "全部取消"), encodeAct({ kind: "cancel" }), { keys: "escape" }),
		actionButton(primary.label, encodeAct(primary.act), { keys: "enter", tone: "accent" }),
	]);
}

/** The page's primary act, as Enter would do it now: save the Other text, open the field, or answer the row. */
function primaryAct(states: readonly QuestionState[], state: QuestionState, page: number): { readonly label: string; readonly act: SheetAct } {
	if (state.editing) return { label: tr("Save answer", "保存答案"), act: { kind: "saveOther", page } };
	const label = states.length === 1 ? tr("Submit", "提交") : tr("Next", "下一题");
	return { label, act: onOther(state) ? { kind: "openOther", page } : { kind: "answer", page, option: state.cursor } };
}

function questionPage(states: readonly QuestionState[], index: number): NativeChild[] {
	const state = states[index];
	if (state === undefined) return [];
	const demos = pageDemos(state);
	const decision: NativeChild[] = [options(state, index)];
	const focused = tradeoff(state, demos.find(demo => demo.slot === "option"), index);
	if (focused !== undefined) decision.push(focused);
	// The field is its own component, so the terminal's edits and undo reach it directly.
	if (state.editing) decision.push(node("row", { role: "omp.ask.otherField" }, [state.input], "otherField"));
	// Tern scrolls a list's selection into view against the body's bottom edge, where a sticky last
	// `omp.actions` row would cover it; so the bar sits in the decision column (not last) and reveals
	// itself when a page opens, which pulls the whole decision into view after a long brief.
	decision.push({ ...actions(primaryAct(states, state, index)), reveal: "nearest" });
	const questionDemo = demos.find(demo => demo.slot === "question");
	const demo = questionDemo === undefined ? [] : [block("demo", tr("Demo", "演示"), [demoNode(questionDemo, index)])];
	return [...lead(state.question), node("col", { gap: "md" }, decision, `decision${index}`), ...demo, ...appendix(state)];
}

/** The review: the native ask's notice of unanswered questions, then each question's answer. */
function reviewPage(states: readonly QuestionState[]): NativeChild[] {
	const unanswered = states.filter(state => state.answer.kind === "unanswered").length;
	// Label then answer per row, not the native `kv` (`omp.ask.answers`): Reader gives that grid a
	// fixed key column, and a long CJK chip runs into its answer.
	const rows = states.map((state, index) => {
		const answer = answerLabel(state.question, state.answer);
		return node(
			"text",
			{ spans: [span(tabLabel(state.question), "strong"), span("  "), answer === undefined ? span(tr("Unanswered", "未回答"), "warning") : span(answer)], wrap: "word" },
			undefined,
			`answer${index}`,
		);
	});
	const notice =
		unanswered > 0
			? [span(tr(`${unanswered} unanswered`, `${unanswered} 题未回答`), "warning"), span(tr(" · Submit still sends the rest", " · 提交仍会发送其余答案"))]
			: [span(tr("All answered · Submit sends them", "全部已答 · 提交即发送"))];
	return [
		node("text", { role: "omp.ask.notice", spans: notice, wrap: "word" }, undefined, "notice"),
		node("col", { gap: "sm" }, rows, "answers"),
		{ ...actions({ label: tr("Submit", "提交"), act: { kind: "submit" } }), reveal: "nearest" },
	];
}

/** The sheet content for the active page. */
export function describeSheet(states: readonly QuestionState[], active: ActiveTab, scroll: NativeScrollRequest | undefined): NativeNode {
	const head = tabs(states, active);
	const page = active.kind === "review" ? reviewPage(states) : questionPage(states, active.index);
	const root = col([...(head === undefined ? [] : [head]), ...page], { gap: "md" });
	return scroll === undefined ? root : { ...root, scroll };
}
