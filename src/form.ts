// No radio is preselected: the host submits the form's current values when its timeout ends, so a
// preselected recommendation would come back looking like the user's choice.
import { isAbsolute, resolve } from "node:path";
import { resolveMermaidAscii } from "@oh-my-pi/pi-tui/theme/mermaid-cache";
import { tr } from "../omomp-shared/i18n.ts";
import type { ResolvedEvidence } from "./brief.ts";
import type { AskQuestion, Demo } from "./schema.ts";

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

function demoHtml(demo: Demo, cwd: string, alt: string): string {
	const src = isAbsolute(demo.path) ? demo.path : resolve(cwd, demo.path);
	const caption = demo.caption === undefined ? "" : `<p>${inline(demo.caption)}</p>`;
	return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">${caption}`;
}

function optionLine(question: AskQuestion, index: number): string {
	const option = question.options[index];
	if (option === undefined) return "";
	const recommended = index === question.recommended ? ` (${escapeHtml(tr("recommended", "推荐"))})` : "";
	const parts = [
		`<strong>${escapeHtml(option.label)}</strong>${recommended}: ${inline(option.tradeoff)}`,
		...(option.description === undefined ? [] : [inline(option.description)]),
		...(option.holds_when === undefined ? [] : [`${escapeHtml(tr("Holds when", "成立条件"))}: ${inline(option.holds_when)}`]),
		...(option.cost === undefined ? [] : [`${escapeHtml(tr("Cost", "成本"))}: ${inline(option.cost)}`]),
	];
	return `<li>${parts.join(" · ")}</li>`;
}

function questionHtml(question: AskQuestion, evidence: readonly ResolvedEvidence[], cwd: string): string {
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
	if (brief.demo !== undefined) blocks.push(demoHtml(brief.demo, cwd, tr("Demo", "演示")));
	blocks.push(
		`<p><strong>${escapeHtml(tr("Options", "选项"))}</strong></p><ul>${question.options.map((_, index) => optionLine(question, index)).join("")}</ul>`,
	);
	for (const option of question.options) {
		if (option.demo !== undefined) blocks.push(demoHtml(option.demo, cwd, `${option.label}: ${tr("demo", "演示")}`));
	}
	blocks.push(`<p>${inline(question.question)}</p>`);
	for (const option of question.options) {
		const label = escapeHtml(option.label);
		blocks.push(`<label><input type="radio" name="${name}" value="${label}"> ${label}</label>`);
	}
	return `<fieldset>${blocks.join("\n")}</fieldset>`;
}

export function compileForm(questions: readonly AskQuestion[], evidence: readonly (readonly ResolvedEvidence[])[], cwd: string): string {
	return `<form>\n${questions.map((question, index) => questionHtml(question, evidence[index] ?? [], cwd)).join("\n")}\n</form>`;
}
