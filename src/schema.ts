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
	id: z.string().min(1),
	question: z.string().min(1).describe("one or two sentences; the brief carries the context"),
	header: z.string().optional().describe("short display chip"),
	options: z.array(optionSchema).min(2).max(5),
	multi: z.boolean().optional().describe("not supported: one answer per call"),
	recommended: z.number().optional().describe("0-based index of the option you would pick"),
	brief: briefSchema,
});

export const parametersSchema = z.object({ questions: z.array(questionSchema).min(1) });

export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type AskOption = z.infer<typeof optionSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskParams = z.infer<typeof parametersSchema>;

/** Exactly one question, validated; or every reason it cannot be asked. */
export type Validated = { readonly ok: true; readonly question: AskQuestion } | { readonly ok: false; readonly problems: readonly string[] };

const LINE_SPEC = /^\d+(?:-\d+)?$/;

/** Bounds the surface can show without folding away what the model cited. */
export const MAX_EVIDENCE_REFS = 6;
export const MAX_EVIDENCE_LINES = 80;

/**
 * Semantic checks the schema cannot state. They run before any UI opens and never degrade
 * into a thinner ask: the model gets every problem at once and calls again.
 */
export function validate(params: AskParams): Validated {
	const problems: string[] = [];
	if (params.questions.length !== 1) {
		problems.push(`questions: expected exactly one question, got ${params.questions.length}. Split the call; one decision per call.`);
	}
	const question = params.questions[0];
	if (question === undefined) return { ok: false, problems };

	if ((question.question ?? "").trim().length === 0) problems.push("questions[0].question: empty");
	if (question.multi === true) problems.push("questions[0].multi: not supported; the sheet selects one answer. Ask twice for two.");

	for (const field of ["where", "what", "how"] as const) {
		if (question.brief[field].trim().length === 0) problems.push(`questions[0].brief.${field}: empty`);
	}

	if (question.options.length < 2) {
		problems.push("questions[0].options: a decision needs at least two options; act and state the choice instead of asking for one.");
	}
	const seen = new Set<string>();
	question.options.forEach((option, index) => {
		const at = `questions[0].options[${index}]`;
		const label = option.label.trim();
		if (label.length === 0) problems.push(`${at}.label: empty`);
		else if (RESERVED_LABELS[label] === true) problems.push(`${at}.label: "${option.label}" is added by the UI; give the option its own label`);
		else if (seen.has(label)) problems.push(`${at}.label: duplicate "${option.label}"`);
		else seen.add(label);
		if (option.tradeoff.trim().length === 0) problems.push(`${at}.tradeoff: empty; say what the option buys and what it costs`);
	});

	const evidence = question.brief.evidence ?? [];
	if (evidence.length > MAX_EVIDENCE_REFS) {
		problems.push(`questions[0].brief.evidence: ${evidence.length} references; the surface shows at most ${MAX_EVIDENCE_REFS}. Cite the ones that decide it.`);
	}
	for (const [index, ref] of evidence.entries()) {
		if (ref.lines === undefined) continue;
		const [, first, last] = /^(\d+)(?:-(\d+))?$/.exec(ref.lines.trim()) ?? [];
		if (first === undefined) continue;
		const span = last === undefined ? 1 : Math.abs(Number(last) - Number(first)) + 1;
		if (span > MAX_EVIDENCE_LINES) {
			problems.push(`questions[0].brief.evidence[${index}].lines: "${ref.lines}" spans ${span} lines; narrow it to ${MAX_EVIDENCE_LINES} or fewer.`);
		}
	}

	const recommended = question.recommended;
	if (recommended !== undefined && (!Number.isInteger(recommended) || recommended < 0 || recommended >= question.options.length)) {
		problems.push(`questions[0].recommended: ${recommended} is not an index into ${question.options.length} options`);
	}

	question.brief.evidence?.forEach((ref, index) => {
		const at = `questions[0].brief.evidence[${index}]`;
		if (ref.path.trim().length === 0) problems.push(`${at}.path: empty`);
		if (ref.lines !== undefined && !LINE_SPEC.test(ref.lines.trim())) problems.push(`${at}.lines: "${ref.lines}" is not "N" or "N-M"`);
	});

	return problems.length === 0 ? { ok: true, question } : { ok: false, problems };
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
