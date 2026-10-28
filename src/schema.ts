// The tool's parameters: every native `ask` field, plus the extension fields that carry the
// decision. Native components render the native part and ignore the rest; this plugin's
// component renders both. See README.md#the-contract.
import { z } from "@oh-my-pi/pi-coding-agent";

/** Labels the UI adds itself; the native tool rejects them too (`tools/ask.ts:52-58`). */
export const RESERVED_LABELS: Readonly<Record<string, true>> = {
	"Other (type your own)": true,
	"Chat about this": true,
	"Next →": true,
};

export const evidenceSchema = z.object({
	path: z.string().min(1).describe("file or directory path, relative to the working directory or absolute"),
	lines: z.string().optional().describe('line window: "41" or "41-58"; omitted reads the head of the file'),
	note: z.string().optional().describe("why this evidence matters"),
});

export const briefSchema = z.object({
	where: z.string().min(1).describe("what exists now: paths, symbols, the observation that forces the decision"),
	what: z.string().min(1).describe("the decision, and why code, docs and conventions cannot make it"),
	how: z.string().min(1).describe("what happens after each answer, and which constraint decides it"),
	evidence: z.array(evidenceSchema).optional(),
	diagram: z.string().optional().describe("Mermaid source (a flowchart, sequence or state diagram)"),
	risks: z.array(z.string()).optional(),
});

export const optionSchema = z.object({
	label: z.string().min(1),
	description: z.string().optional().describe("one line that disambiguates the option; never the tradeoff"),
	preview: z.string().optional().describe("extra Markdown the native surface can show"),
	tradeoff: z.string().min(1).describe("what the option buys and what it costs, in one line"),
	holds_when: z.string().optional().describe("the condition under which this option is right"),
	cost: z.string().optional().describe("what changes: files, migrations, time"),
});

export const questionSchema = z.object({
	id: z.string().min(1).describe("unique within the call; the answer is reported under it"),
	question: z.string().min(1).describe("one or two sentences; the brief carries the context"),
	header: z.string().optional().describe("short tab label"),
	options: z.array(optionSchema).min(2).max(5),
	multi: z.boolean().optional().describe("not supported: one answer per question"),
	recommended: z.number().optional().describe("0-based index of the option you would pick"),
	brief: briefSchema,
});

export const parametersSchema = z.object({
	questions: z.array(questionSchema).min(1).describe("independent decisions, one tab each; a decision that depends on another answer goes in a later call"),
});

export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type AskOption = z.infer<typeof optionSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskParams = z.infer<typeof parametersSchema>;

/** Every question validated; or every reason the call cannot be asked. */
export type Validated = { readonly ok: true; readonly questions: readonly AskQuestion[] } | { readonly ok: false; readonly problems: readonly string[] };

const LINE_SPEC = /^\d+(?:-\d+)?$/;

/** Bounds the surface can show without folding away what the model cited. */
export const MAX_EVIDENCE_REFS = 6;
export const MAX_EVIDENCE_LINES = 80;

/**
 * Semantic checks the schema cannot state. They run before any UI opens and never degrade
 * into a thinner ask: the model gets every problem of every question at once and calls again.
 */
export function validate(params: AskParams): Validated {
	const problems: string[] = [];
	if (params.questions.length === 0) problems.push("questions: empty; ask at least one question");
	const ids = new Set<string>();
	params.questions.forEach((question, index) => {
		const id = question.id.trim();
		if (id.length === 0) problems.push(`questions[${index}].id: empty`);
		else if (ids.has(id)) problems.push(`questions[${index}].id: duplicate "${question.id}"; every question needs its own id`);
		else ids.add(id);
		problems.push(...validateQuestion(question, `questions[${index}]`));
	});
	return problems.length === 0 ? { ok: true, questions: params.questions } : { ok: false, problems };
}

function validateQuestion(question: AskQuestion, at: string): string[] {
	const problems: string[] = [];
	if (question.question.trim().length === 0) problems.push(`${at}.question: empty`);
	if (question.multi === true) problems.push(`${at}.multi: not supported; each question takes one answer. Split it into separate questions.`);

	for (const field of ["where", "what", "how"] as const) {
		if (question.brief[field].trim().length === 0) problems.push(`${at}.brief.${field}: empty`);
	}

	if (question.options.length < 2) {
		problems.push(`${at}.options: a decision needs at least two options; act and state the choice instead of asking for one.`);
	}
	const seen = new Set<string>();
	question.options.forEach((option, index) => {
		const optionAt = `${at}.options[${index}]`;
		const label = option.label.trim();
		if (label.length === 0) problems.push(`${optionAt}.label: empty`);
		else if (RESERVED_LABELS[label] === true) problems.push(`${optionAt}.label: "${option.label}" is added by the UI; give the option its own label`);
		else if (seen.has(label)) problems.push(`${optionAt}.label: duplicate "${option.label}"`);
		else seen.add(label);
		if (option.tradeoff.trim().length === 0) problems.push(`${optionAt}.tradeoff: empty; say what the option buys and what it costs`);
	});

	const evidence = question.brief.evidence ?? [];
	if (evidence.length > MAX_EVIDENCE_REFS) {
		problems.push(`${at}.brief.evidence: ${evidence.length} references; the surface shows at most ${MAX_EVIDENCE_REFS}. Cite the ones that decide it.`);
	}
	evidence.forEach((ref, index) => {
		const refAt = `${at}.brief.evidence[${index}]`;
		if (ref.path.trim().length === 0) problems.push(`${refAt}.path: empty`);
		if (ref.lines === undefined) return;
		const spec = ref.lines.trim();
		if (!LINE_SPEC.test(spec)) {
			problems.push(`${refAt}.lines: "${ref.lines}" is not "N" or "N-M"`);
			return;
		}
		const [first, last] = spec.split("-").map(Number);
		const span = last === undefined ? 1 : Math.abs(last - (first ?? 0)) + 1;
		if (span > MAX_EVIDENCE_LINES) {
			problems.push(`${refAt}.lines: "${ref.lines}" spans ${span} lines; narrow it to ${MAX_EVIDENCE_LINES} or fewer.`);
		}
	});

	const recommended = question.recommended;
	if (recommended !== undefined && (!Number.isInteger(recommended) || recommended < 0 || recommended >= question.options.length)) {
		problems.push(`${at}.recommended: ${recommended} is not an index into ${question.options.length} options`);
	}
	return problems;
}

/** The native shape of one question: extension fields dropped, `preview` kept when the model wrote one. */
export function nativeQuestion(question: AskQuestion): Record<string, unknown> {
	return {
		id: question.id,
		question: question.question,
		...(question.header !== undefined ? { header: question.header } : {}),
		options: question.options.map(option => ({
			label: option.label,
			...(option.description !== undefined ? { description: option.description } : {}),
			...(option.preview !== undefined ? { preview: option.preview } : {}),
		})),
		...(question.recommended !== undefined ? { recommended: question.recommended } : {}),
	};
}
