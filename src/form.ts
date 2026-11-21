// No radio is preselected: the host submits the form's current values when its timeout ends, so a
// preselected recommendation would come back looking like the user's choice.
// An option's tradeoff and notes sit inside its radio's <label>, so they draw under that option's
// row. A <label> keeps only an image's alt text, so option demos go above the radio group instead.
import { resolveMermaidAscii } from "@oh-my-pi/pi-tui/theme/mermaid-cache";
import { tr } from "../omomp-shared/i18n.ts";
import type { ResolvedEvidence } from "./brief.ts";
import type { QuestionDemos, ResolvedDemo } from "./demo.ts";
import type { AskQuestion, DemoFrame } from "./schema.ts";

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(text: string): string {
	return text
		.split(/(`[^`\n]+`)/)
		.map((part) =>
			part.length > 2 && part.startsWith("`") && part.endsWith("`") ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : escapeHtml(part),
		)
		.join("");
}

function labelled(label: string, text: string): string {
	const paragraphs = text
		.trim()
		.split(/\n\s*\n/)
		.map((paragraph) => inline(paragraph.trim()).replace(/\n/g, "<br>"));
	const [first = "", ...rest] = paragraphs;
	return [`<p><strong>${escapeHtml(label)}</strong> ${first}</p>`, ...rest.map((paragraph) => `<p>${paragraph}</p>`)].join("");
}

function numbered(lines: readonly string[], start: number): string {
	const width = String(start + lines.length - 1).length;
	return lines.map((line, index) => `${String(start + index).padStart(width)}  ${line}`).join("\n");
}

function evidenceHtml(entry: ResolvedEvidence): string {
	const note = entry.note === undefined ? "" : ` — ${inline(entry.note)}`;
	const head = (what: string) => `<p><strong>${escapeHtml(tr("Evidence", "证据"))}</strong> ${what}${note}</p>`;
	switch (entry.kind) {
		case "file":
			return `${head(`<code>${escapeHtml(`${entry.path}:${entry.start}-${entry.end}`)}</code>`)}<pre>${escapeHtml(numbered(entry.lines, entry.start))}</pre>`;
		case "text":
			return `${head(`${escapeHtml(entry.source)} · ${escapeHtml(tr("quoted by the model, not read by ask-more", "模型引用，ask-more 未读取核对"))}`)}<pre>${escapeHtml(entry.lines.join("\n"))}</pre>`;
		case "directory":
			return head(`<code>${escapeHtml(entry.path)}</code> · ${escapeHtml(tr("a directory", "这是目录"))}`);
		case "unreadable":
			return head(`<code>${escapeHtml(entry.path)}</code> · ${escapeHtml(entry.error)}`);
	}
}

function diagramHtml(source: string): string {
	const art = resolveMermaidAscii(source) ?? source.trim();
	return `<p><strong>${escapeHtml(tr("Diagram", "图"))}</strong></p><pre>${escapeHtml(art)}</pre>`;
}

const FENCE = /^```([^\n`]*)\n([\s\S]*?)\n```[ \t]*$/gm;

function markdownHtml(markdown: string): string {
	const prose = (text: string) =>
		text
			.split(/\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph.length > 0)
			.map((paragraph) => `<p>${inline(paragraph).replace(/\n/g, "<br>")}</p>`);
	const blocks: string[] = [];
	let at = 0;
	for (const match of markdown.matchAll(FENCE)) {
		blocks.push(...prose(markdown.slice(at, match.index)));
		const [, info = "", body = ""] = match;
		const art = info.trim().toLowerCase() === "mermaid" ? (resolveMermaidAscii(body) ?? body) : body;
		blocks.push(`<pre>${escapeHtml(art)}</pre>`);
		at = match.index + match[0].length;
	}
	blocks.push(...prose(markdown.slice(at)));
	return blocks.join("");
}

function framesHtml(frames: readonly DemoFrame[]): string {
	return frames
		.map((frame, index) => {
			const position = tr(`Frame ${index + 1}/${frames.length}`, `第 ${index + 1}/${frames.length} 帧`);
			const caption = frame.caption === undefined ? "" : ` — ${inline(frame.caption)}`;
			return `<p><em>${escapeHtml(position)}</em>${caption}</p>${markdownHtml(frame.body)}`;
		})
		.join("");
}

function demoHtml(demo: ResolvedDemo, title: string): string {
	const head = `<p><strong>${escapeHtml(title)}</strong>${demo.caption === undefined ? "" : ` ${inline(demo.caption)}`}</p>`;
	switch (demo.kind) {
		case "image":
			return `${head}<img src="${escapeHtml(demo.path)}" alt="${escapeHtml(title)}">`;
		case "link":
			return `${head}<p>${escapeHtml(demo.url)}</p>`;
		case "unreadable":
			return `${head}<p><code>${escapeHtml(demo.path)}</code> · ${escapeHtml(demo.error)}</p>`;
		case "frames":
			return `${head}${framesHtml(demo.frames)}`;
	}
}

function optionLabel(question: AskQuestion, index: number): string {
	const option = question.options[index];
	if (option === undefined) return "";
	const recommended = index === question.recommended ? ` (${escapeHtml(tr("recommended", "推荐"))})` : "";
	return [
		`<strong>${escapeHtml(option.label)}</strong>${recommended}`,
		`${escapeHtml(tr("Tradeoff", "取舍"))}: ${inline(option.tradeoff)}`,
		...(option.description === undefined ? [] : [inline(option.description)]),
		...(option.holds_when === undefined ? [] : [`${escapeHtml(tr("Holds when", "成立条件"))}: ${inline(option.holds_when)}`]),
		...(option.cost === undefined ? [] : [`${escapeHtml(tr("Cost", "成本"))}: ${inline(option.cost)}`]),
	].join("<br>");
}

function questionHtml(question: AskQuestion, evidence: readonly ResolvedEvidence[], demos: QuestionDemos): string {
	const { brief } = question;
	const name = escapeHtml(question.id);
	const blocks: string[] = [];
	if (question.header !== undefined) blocks.push(`<legend>${escapeHtml(question.header)}</legend>`);
	blocks.push(labelled(tr("Where", "现状"), brief.where), labelled(tr("What", "决定"), brief.what), labelled(tr("How", "后果"), brief.how));
	for (const entry of evidence) blocks.push(evidenceHtml(entry));
	if (brief.diagram !== undefined) blocks.push(diagramHtml(brief.diagram));
	if (brief.risks !== undefined && brief.risks.length > 0) {
		blocks.push(
			`<p><strong>${escapeHtml(tr("Risks", "风险"))}</strong></p><ul>${brief.risks.map((risk) => `<li>${inline(risk)}</li>`).join("")}</ul>`,
		);
	}
	if (demos.brief !== undefined) blocks.push(demoHtml(demos.brief, tr("Demo", "演示")));
	for (const [index, option] of question.options.entries()) {
		const demo = demos.options[index];
		if (demo !== undefined) blocks.push(demoHtml(demo, `${option.label}: ${tr("demo", "演示")}`));
	}
	blocks.push(`<p>${inline(question.question)}</p>`);
	for (const [index, option] of question.options.entries()) {
		blocks.push(`<label><input type="radio" name="${name}" value="${escapeHtml(option.label)}">${optionLabel(question, index)}</label>`);
	}
	return `<fieldset>${blocks.join("\n")}</fieldset>`;
}

export function compileForm(
	questions: readonly AskQuestion[],
	evidence: readonly (readonly ResolvedEvidence[])[],
	demos: readonly QuestionDemos[],
): string {
	const sections = questions.map((question, index) => questionHtml(question, evidence[index] ?? [], demos[index] ?? { options: [] }));
	return `<form>\n${sections.join("\n")}\n</form>`;
}
