// The tool's parameters: the questions of one decision batch — id, question, header, options and a
// recommendation — plus the extension fields that carry the decision (brief, tradeoffs, evidence,
// image demos). `src/form.ts` compiles all of it into the HTML form the host's `ask` draws. See
// README.md#what-the-model-sends-and-gets.
//
// The model sees `parametersSchema`, whose shape follows the plugin rule (工具参数「形状」): one
// root object and no object union anywhere. An evidence entry is a single object whose `kind` enum
// picks the form, and the evidence and demos of a call sit beside the questions, keyed back by
// question id and option label, so an object never nests deeper than two levels. `parseParams`
// maps that into the internal shapes below — the discriminated union the form compiler and the
// readability check consume — and rejects a field that does not belong to its `kind` or names a
// question or option the call does not hold, before any UI opens.
//
// The shapes are written for strict tool calling (index.ts registers `strict: true`): omp makes
// every optional field nullable and drops null placeholders before validation, and every optional
// string rejects "" so an empty placeholder is dropped the same way.
//
// omp's parameter check words a rejection as `<path> must be <the field's description> (was …)`,
// so every description opens with the value it expects, and holds at most one " or ": with
// more, the check rewrites the text as a list of alternatives.
import { z } from "@oh-my-pi/pi-coding-agent";

/**
 * Labels the host form takes as its own free-text answer: it adds an `Other` answer to a radio
 * group unless one option's label starts with "other" (`html-form/parse.ts`), and reports a typed
 * answer as `Other: <text>`.
 */
const RESERVED_LABEL = /^\s*other\b/i;

/** File extensions a demo `path` may name: pictures and animations the host form shows. */
export const DEMO_IMAGE_EXTENSIONS = [".gif", ".png", ".apng", ".webp"] as const;

export const fileEvidenceSchema = z.object({
	kind: z.literal("file"),
	path: z.string().min(1).describe("a non-empty path to a file or directory, relative to the working directory unless absolute"),
	start: z
		.number()
		.int()
		.min(1)
		.describe("a 1-based line number where the window starts; without it the file's first lines are shown")
		.optional(),
	end: z
		.number()
		.int()
		.min(1)
		.describe(
			"a 1-based line number where the window ends, inclusive; needs start, and omitted means start alone. For lines that are not adjacent, cite each window as its own entry",
		)
		.optional(),
	note: z.string().min(1).describe("text saying why this evidence matters").optional(),
});

export const textEvidenceSchema = z.object({
	kind: z.literal("text"),
	source: z
		.string()
		.min(1)
		.describe(
			"one non-empty line naming where the text was taken from: a command, a URL, a log, a tool result; shown as your claim, not checked",
		),
	text: z.string().min(1).describe("the non-empty text quoted as it appeared there"),
	lang: z.string().min(1).describe("a highlight language for the text, such as bash, json, diff").optional(),
	note: z.string().min(1).describe("text saying why this evidence matters").optional(),
});

/** Lines ask-more reads from a file itself, or text the model quotes from elsewhere. */
export const evidenceSchema = z.union([fileEvidenceSchema, textEvidenceSchema]);

/** A picture or animation file shown in the form. */
export const demoSchema = z.object({
	path: z.string().min(1).describe("a non-empty path to an image or animation file, relative to the working directory unless absolute"),
	caption: z.string().min(1).describe("one line saying what to watch").optional(),
});

export const briefSchema = z.object({
	where: z.string().min(1).describe("non-empty text saying what exists now: paths, symbols, the observation that forces the decision"),
	what: z.string().min(1).describe("non-empty text naming the decision, and why code, docs and conventions cannot make it"),
	how: z.string().min(1).describe("non-empty text saying what happens after each answer, and which constraint decides it"),
	evidence: z
		.array(evidenceSchema)
		.describe("an array of evidence tagged by kind: file lines ask-more reads itself, or text you quote")
		.optional(),
	diagram: z.string().min(1).describe("Mermaid source of a flowchart, sequence diagram or state diagram").optional(),
	demo: demoSchema.describe("an image of how things behave now").optional(),
	risks: z.array(z.string().min(1)).describe("one risk per line: what could go wrong with the decision itself").optional(),
});

export const optionSchema = z.object({
	label: z
		.string()
		.min(1)
		.describe("the option's short title, shown on its row; one line, unique within the question, and not starting with Other"),
	description: z.string().min(1).describe("one line that disambiguates the option; never the tradeoff").optional(),
	tradeoff: z.string().min(1).describe("one non-empty line: what the option buys and what it costs"),
	holds_when: z.string().min(1).describe("text naming the condition under which this option is right").optional(),
	cost: z.string().min(1).describe("text naming what changes: files, migrations, time").optional(),
	demo: demoSchema.describe("an image of the result of picking this option").optional(),
});

export const questionSchema = z.object({
	id: z.string().min(1).describe("a non-empty string, unique within the call; the answer is reported under it"),
	question: z.string().min(1).describe("non-empty text of one or two sentences; the brief carries the context"),
	header: z.string().min(1).describe("a short section title").optional(),
	options: z.array(optionSchema).min(2).max(5).describe("an array of 2 to 5 options, each a choice the user can pick"),
	recommended: z.number().int().describe("an integer: the 0-based index of the option you would pick; marked as recommended").optional(),
	brief: briefSchema,
});

/** The internal parameters: what the dialog, the readability check and the form generator take. */
export const askParamsSchema = z.object({
	questions: z
		.array(questionSchema)
		.min(1)
		.describe("an array of independent decisions, one tab each; a decision that depends on another answer goes in a later call"),
});

export const briefParamSchema = z
	.object({
		where: z.string().min(1).describe("non-empty text saying what exists now: paths, symbols, the observation that forces the decision"),
		what: z.string().min(1).describe("non-empty text naming the decision, and why code, docs and conventions cannot make it"),
		how: z.string().min(1).describe("non-empty text saying what happens after each answer, and which constraint decides it"),
		diagram: z.string().min(1).describe("Mermaid source of a flowchart, sequence diagram or state diagram").optional(),
		risks: z.array(z.string().min(1)).describe("one risk per line: what could go wrong with the decision itself").optional(),
	})
	.describe("the decision's background: where things stand, what is being decided and what follows each answer");

export const optionParamSchema = z
	.object({
		label: z
			.string()
			.min(1)
			.describe("the option's short title, shown on its row; one line, unique within the question, and not starting with Other"),
		description: z.string().min(1).describe("one line that disambiguates the option; never the tradeoff").optional(),
		tradeoff: z.string().min(1).describe("one non-empty line: what the option buys and what it costs"),
		holds_when: z.string().min(1).describe("text naming the condition under which this option is right").optional(),
		cost: z.string().min(1).describe("text naming what changes: files, migrations, time").optional(),
	})
	.describe("one option: its short title and the tradeoff, condition and cost the form shows beside it");

export const questionParamSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.describe("a non-empty string, unique within the call; the answer is reported under it, and an evidence entry or demo names it"),
		question: z.string().min(1).describe("non-empty text of one or two sentences; the brief carries the context"),
		header: z.string().min(1).describe("a short section title").optional(),
		options: z.array(optionParamSchema).min(2).max(5).describe("an array of 2 to 5 options, each a choice the user can pick"),
		recommended: z
			.number()
			.int()
			.describe("an integer: the 0-based index of the option you would pick; marked as recommended, never preselected")
			.optional(),
		brief: briefParamSchema,
	})
	.describe("one decision: its id, its question, its brief and its 2 to 5 options");

export const evidenceParamSchema = z
	.object({
		question: z.string().min(1).describe("the id of the question this evidence belongs to, from the questions of the same call"),
		kind: z
			.enum(["text", "file"])
			.describe("file: lines ask-more reads from the file itself; text: text you quote from a command, a page or a log"),
		path: z
			.string()
			.min(1)
			.describe("a non-empty path to a file or directory, relative to the working directory unless absolute; only with kind file")
			.optional(),
		start: z
			.number()
			.int()
			.min(1)
			.describe("a 1-based line number where the window starts; only with kind file, and without it the file's first lines are shown")
			.optional(),
		end: z
			.number()
			.int()
			.min(1)
			.describe(
				"a 1-based line number where the window ends, inclusive; only with kind file, and it needs start. For lines that are not adjacent, cite each window as its own entry",
			)
			.optional(),
		source: z
			.string()
			.min(1)
			.describe(
				"one non-empty line naming where the text was taken from: a command, a URL, a log, a tool result; only with kind text, and shown as your claim, not checked",
			)
			.optional(),
		text: z.string().min(1).describe("the non-empty text quoted as it appeared there; only with kind text").optional(),
		lang: z.string().min(1).describe("a highlight language for the text, such as bash, json, diff; only with kind text").optional(),
		note: z.string().min(1).describe("text saying why this evidence matters").optional(),
	})
	.describe("one evidence entry, attached to a question by its id");

export const demoParamSchema = z
	.object({
		question: z.string().min(1).describe("the id of the question this demo belongs to, from the questions of the same call"),
		option: z
			.string()
			.min(1)
			.describe("the label of the option this demo illustrates; omit it for the question's own demo, and give at most one demo per option")
			.optional(),
		path: z
			.string()
			.min(1)
			.describe("a non-empty path to a .gif, .png, .apng or .webp file, relative to the working directory unless absolute"),
		caption: z.string().min(1).describe("one line saying what to watch").optional(),
	})
	.describe("one image demo, attached to a question by its id and, for an option's demo, to the option's label");

export const parametersSchema = z.object({
	questions: z
		.array(questionParamSchema)
		.min(1)
		.describe("an array of independent decisions, one section each; a decision that depends on another answer goes in a later call"),
	evidence: z
		.array(evidenceParamSchema)
		.describe("an array of evidence entries, each naming the question it belongs to with question")
		.optional(),
	demos: z
		.array(demoParamSchema)
		.describe("an array of demos, each naming the question it belongs to with question and an option with its label")
		.optional(),
});

export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type FileEvidence = z.infer<typeof fileEvidenceSchema>;
export type TextEvidence = z.infer<typeof textEvidenceSchema>;
export type Demo = z.infer<typeof demoSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type AskOption = z.infer<typeof optionSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskParams = z.infer<typeof askParamsSchema>;
export type AskParamsWire = z.infer<typeof parametersSchema>;
export type EvidenceParam = z.infer<typeof evidenceParamSchema>;
export type DemoParam = z.infer<typeof demoParamSchema>;

/** Every question validated; or every reason the call cannot be asked. */
export type Validated =
	| { readonly ok: true; readonly questions: readonly AskQuestion[] }
	| { readonly ok: false; readonly problems: readonly string[] };

/** One evidence entry of the wire shape as an internal one; the fields of the other `kind` are problems. */
function parseEvidenceParam(entry: EvidenceParam, at: string): { value?: EvidenceRef; problems: string[] } {
	const problems: string[] = [];
	const note = entry.note === undefined ? {} : { note: entry.note };
	if (entry.kind === "file") {
		for (const field of ["source", "text", "lang"] as const) {
			if (entry[field] !== undefined) problems.push(`${at}.${field}: only with kind text; this entry has kind file`);
		}
		if (entry.path === undefined) {
			problems.push(`${at}.path: required with kind file`);
			return { problems };
		}
		return {
			value: {
				kind: "file",
				path: entry.path,
				...(entry.start === undefined ? {} : { start: entry.start }),
				...(entry.end === undefined ? {} : { end: entry.end }),
				...note,
			},
			problems,
		};
	}
	for (const field of ["path", "start", "end"] as const) {
		if (entry[field] !== undefined) problems.push(`${at}.${field}: only with kind file; this entry has kind text`);
	}
	if (entry.source === undefined) problems.push(`${at}.source: required with kind text`);
	if (entry.text === undefined) problems.push(`${at}.text: required with kind text`);
	if (entry.source === undefined || entry.text === undefined) return { problems };
	return {
		value: { kind: "text", source: entry.source, text: entry.text, ...(entry.lang === undefined ? {} : { lang: entry.lang }), ...note },
		problems,
	};
}

function questionOf(param: z.infer<typeof questionParamSchema>): AskQuestion {
	return {
		id: param.id,
		question: param.question,
		...(param.header === undefined ? {} : { header: param.header }),
		options: param.options.map((option) => ({
			label: option.label,
			...(option.description === undefined ? {} : { description: option.description }),
			tradeoff: option.tradeoff,
			...(option.holds_when === undefined ? {} : { holds_when: option.holds_when }),
			...(option.cost === undefined ? {} : { cost: option.cost }),
		})),
		...(param.recommended === undefined ? {} : { recommended: param.recommended }),
		brief: {
			where: param.brief.where,
			what: param.brief.what,
			how: param.brief.how,
			...(param.brief.diagram === undefined ? {} : { diagram: param.brief.diagram }),
			...(param.brief.risks === undefined ? {} : { risks: param.brief.risks }),
		},
	};
}

/**
 * The wire parameters as the internal ones, with every problem found on the way: an evidence
 * entry or demo that names a question or option the call does not hold, carries a field of the
 * other `kind`, or is the second demo of its slot. Runs before any UI opens, and lists every
 * problem of every question at once like `validate`.
 */
export function parseParams(params: AskParamsWire): Validated {
	const problems: string[] = [];
	const questions = params.questions.map(questionOf);
	const byId = new Map<string, AskQuestion>();
	for (const question of questions) {
		const id = question.id.trim();
		if (id.length > 0 && !byId.has(id)) byId.set(id, question);
	}

	for (const [index, entry] of (params.evidence ?? []).entries()) {
		const at = `evidence[${index}]`;
		const parsed = parseEvidenceParam(entry, at);
		problems.push(...parsed.problems);
		if (parsed.value === undefined) continue;
		const question = byId.get(entry.question.trim());
		if (question === undefined) {
			problems.push(`${at}.question: "${entry.question}" is not the id of any question in this call`);
			continue;
		}
		question.brief.evidence = [...(question.brief.evidence ?? []), parsed.value];
	}

	for (const [index, entry] of (params.demos ?? []).entries()) {
		const at = `demos[${index}]`;
		const demo: Demo = { path: entry.path, ...(entry.caption === undefined ? {} : { caption: entry.caption }) };
		const question = byId.get(entry.question.trim());
		if (question === undefined) {
			problems.push(`${at}.question: "${entry.question}" is not the id of any question in this call`);
			continue;
		}
		if (entry.option === undefined) {
			if (question.brief.demo !== undefined) {
				problems.push(`${at}.option: the brief of question "${entry.question}" already has a demo; one demo per brief`);
				continue;
			}
			question.brief.demo = demo;
			continue;
		}
		const option = question.options.find((candidate) => candidate.label === entry.option);
		if (option === undefined) {
			problems.push(`${at}.option: "${entry.option}" is not a label of an option of question "${entry.question}"`);
			continue;
		}
		if (option.demo !== undefined) {
			problems.push(`${at}.option: option "${entry.option}" of question "${entry.question}" already has a demo; one demo per option`);
			continue;
		}
		option.demo = demo;
	}

	const checked = validate({ questions });
	if (problems.length === 0) return checked;
	return { ok: false, problems: [...problems, ...(checked.ok ? [] : checked.problems)] };
}

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
		else if (option.label !== option.label.replace(/\s+/g, " ").trim())
			problems.push(`${optionAt}.label: one line with single spaces, so the form returns it unchanged`);
		else if (RESERVED_LABEL.test(label))
			problems.push(
				`${optionAt}.label: "${option.label}" starts with Other, which the form keeps for the user's own answer; give the option another label`,
			);
		else if (seen.has(label)) problems.push(`${optionAt}.label: duplicate "${option.label}"`);
		else seen.add(label);
		if (option.tradeoff.trim().length === 0) problems.push(`${optionAt}.tradeoff: empty; say what the option buys and what it costs`);
		if (option.demo !== undefined) problems.push(...validateDemo(option.demo, `${optionAt}.demo`));
	});
	if (question.brief.demo !== undefined) problems.push(...validateDemo(question.brief.demo, `${at}.brief.demo`));

	(question.brief.evidence ?? []).forEach((ref, index) => {
		problems.push(...validateEvidence(ref, `${at}.brief.evidence[${index}]`));
	});

	const recommended = question.recommended;
	if (recommended !== undefined && (!Number.isInteger(recommended) || recommended < 0 || recommended >= question.options.length)) {
		problems.push(`${at}.recommended: ${recommended} is not an index into ${question.options.length} options`);
	}
	return problems;
}

function validateEvidence(ref: EvidenceRef, at: string): string[] {
	switch (ref.kind) {
		case "file":
			return validateFileEvidence(ref, at);
		case "text":
			return validateTextEvidence(ref, at);
	}
}

function validateFileEvidence(ref: FileEvidence, at: string): string[] {
	if (ref.path.trim().length === 0) return [`${at}.path: empty`];
	if (ref.end === undefined) return [];
	if (ref.start === undefined) return [`${at}.end: ${ref.end} without start; give start too, or leave both out for the file's first lines`];
	if (ref.end < ref.start) return [`${at}.end: ${ref.end} is before start ${ref.start}`];
	return [];
}

function validateTextEvidence(ref: TextEvidence, at: string): string[] {
	const problems: string[] = [];
	const source = ref.source.trim();
	if (source.length === 0) problems.push(`${at}.source: empty`);
	else if (/[\r\n]/.test(source))
		problems.push(`${at}.source: more than one line; name where the text came from in one line and put the text in text`);
	if (ref.text.trim().length === 0) problems.push(`${at}.text: empty`);
	return problems;
}

/** The extension of `path`, lower-cased, with its dot; empty when it has none. */
export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function validateDemo(demo: Demo, at: string): string[] {
	const path = demo.path.trim();
	const known: readonly string[] = DEMO_IMAGE_EXTENSIONS;
	if (path.length === 0) return [`${at}.path: empty`];
	if (!known.includes(extensionOf(path))) return [`${at}.path: "${demo.path}" is not one of ${known.join(", ")}`];
	return [];
}
