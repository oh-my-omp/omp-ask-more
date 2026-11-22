// omp's parameter check words a rejection as `<path> must be <the field's description> (was …)`,
// so every description opens with the value it expects, and holds at most one " or ": with
// more, the check rewrites the text as a list of alternatives.
import { z } from "@oh-my-pi/omptype/zod";

const RESERVED_LABEL = /^\s*other\b/i;

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

export const evidenceSchema = z.union([fileEvidenceSchema, textEvidenceSchema]);

export const demoFrameSchema = z.object({
	body: z.string().min(1).describe("non-empty Markdown: text, a ```mermaid diagram, a fenced text drawing"),
	caption: z.string().min(1).describe("one line under this frame").optional(),
});

export const fileDemoSchema = z.object({
	kind: z.literal("file"),
	path: z.string().min(1).describe("a non-empty path to any file, relative to the working directory unless absolute"),
	caption: z.string().min(1).describe("one line saying what to watch").optional(),
});

export const framesDemoSchema = z.object({
	kind: z.literal("frames"),
	frames: z.array(demoFrameSchema).min(1).describe("an array of frames shown in order"),
	caption: z.string().min(1).describe("one line saying what to watch").optional(),
});

export const demoSchema = z.union([fileDemoSchema, framesDemoSchema]);

export const briefSchema = z.object({
	where: z.string().min(1).describe("non-empty text saying what exists now: paths, symbols, the observation that forces the decision"),
	what: z.string().min(1).describe("non-empty text naming the decision, and why code, docs and conventions cannot make it"),
	how: z.string().min(1).describe("non-empty text saying what happens after each answer, and which constraint decides it"),
	evidence: z
		.array(evidenceSchema)
		.describe("an array of evidence tagged by kind: file lines ask-more reads itself, or text you quote")
		.optional(),
	diagram: z.string().min(1).describe("Mermaid source of a flowchart, sequence diagram or state diagram").optional(),
	demo: demoSchema.describe("a demo of how things behave now").optional(),
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
	demo: demoSchema.describe("a demo of the result of picking this option").optional(),
});

export const questionSchema = z.object({
	id: z.string().min(1).describe("a non-empty string, unique within the call; the answer is reported under it"),
	question: z.string().min(1).describe("non-empty text of one or two sentences; the brief carries the context"),
	header: z.string().min(1).describe("a short section title").optional(),
	options: z.array(optionSchema).min(2).max(5).describe("an array of 2 to 5 options, each a choice the user can pick"),
	recommended: z.number().int().describe("an integer: the 0-based index of the option you would pick; marked as recommended").optional(),
	brief: briefSchema,
});

export const askParamsSchema = z.object({
	questions: z
		.array(questionSchema)
		.min(1)
		.describe("an array of independent decisions, one tab each; a decision that depends on another answer goes in a later call"),
});

export const evidenceFileParamSchema = z
	.object({
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
				"a 1-based line number where the window ends, inclusive; needs start, and omitted means start alone. Cite non-adjacent windows separately",
			)
			.optional(),
		note: z.string().min(1).describe("text saying why this evidence matters").optional(),
	})
	.describe("a file evidence entry read directly from disk by ask-more");

export const evidenceQuoteParamSchema = z
	.object({
		source: z
			.string()
			.min(1)
			.describe("one non-empty line naming where the text came from (command, URL, log, tool result); shown as your claim, not checked"),
		text: z.string().min(1).describe("the non-empty text quoted as it appeared there"),
		lang: z.string().min(1).describe("a highlight language for the text, such as bash, json, diff").optional(),
		note: z.string().min(1).describe("text saying why this evidence matters").optional(),
	})
	.describe("a quoted text evidence entry");

export const demoFrameParamSchema = z
	.object({
		body: z.string().min(1).describe("non-empty Markdown: text, a ```mermaid diagram, a fenced text drawing"),
		caption: z.string().min(1).describe("one line under this frame").optional(),
	})
	.describe("one frame of a frames demo");

export const demoFileParamSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.describe("a non-empty path to any file (image, video, recording), relative to the working directory unless absolute"),
		caption: z.string().min(1).describe("one line saying what to watch").optional(),
	})
	.describe("a file demo; pictures render inline and other files play via their file URL");

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
		demo_frames: z
			.array(demoFrameParamSchema)
			.min(1)
			.describe("an array of Markdown frames illustrating this option in order; omit when using demo_file")
			.optional(),
		demo_file: demoFileParamSchema.describe("a file demo illustrating this option; omit when using demo_frames").optional(),
	})
	.describe("one option: its short title and the tradeoff, condition, cost and optional demo shown beside it");

export const questionParamSchema = z
	.object({
		id: z.string().min(1).describe("a non-empty string, unique within the call; the answer is reported under it"),
		question: z.string().min(1).describe("non-empty text of one or two sentences; the brief carries the context"),
		header: z.string().min(1).describe("a short section title").optional(),
		options: z.array(optionParamSchema).min(2).max(5).describe("an array of 2 to 5 options, each a choice the user can pick"),
		recommended: z
			.number()
			.int()
			.describe("an integer: the 0-based index of the option you would pick; marked as recommended, never preselected")
			.optional(),
		brief: briefParamSchema,
		evidence_files: z.array(evidenceFileParamSchema).describe("an array of file evidence entries read directly from disk").optional(),
		evidence_quotes: z.array(evidenceQuoteParamSchema).describe("an array of quoted text evidence entries").optional(),
		demo_frames: z
			.array(demoFrameParamSchema)
			.min(1)
			.describe("an array of Markdown frames showing how things behave now; omit when using demo_file")
			.optional(),
		demo_file: demoFileParamSchema.describe("a file demo showing how things behave now; omit when using demo_frames").optional(),
	})
	.describe("one decision: its id, question, brief, optional inline evidence/demo and 2 to 5 options");

export const parametersSchema = z.object({
	questions: z
		.array(questionParamSchema)
		.min(1)
		.describe(
			"an array of independent decisions shown together in one form (one section each with brief, evidence, diagram, risks, demos, and options with no choice preselected; dependent questions go in a later call; a rejected call lists every problem to fix and retry)",
		),
});

export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type FileEvidence = z.infer<typeof fileEvidenceSchema>;
export type TextEvidence = z.infer<typeof textEvidenceSchema>;
export type Demo = z.infer<typeof demoSchema>;
export type DemoFrame = z.infer<typeof demoFrameSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type AskOption = z.infer<typeof optionSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskParams = z.infer<typeof askParamsSchema>;
export type AskParamsWire = z.infer<typeof parametersSchema>;
export type QuestionParam = z.infer<typeof questionParamSchema>;
export type OptionParam = z.infer<typeof optionParamSchema>;

export type Validated =
	| { readonly ok: true; readonly questions: readonly AskQuestion[] }
	| { readonly ok: false; readonly problems: readonly string[] };

function inlineDemo(
	demoFrames: readonly z.infer<typeof demoFrameParamSchema>[] | undefined,
	demoFile: z.infer<typeof demoFileParamSchema> | undefined,
	at: string,
	problems: string[],
): Demo | undefined {
	if (demoFrames !== undefined && demoFile !== undefined) {
		problems.push(`${at}.demo_file: give either demo_frames or demo_file, not both`);
		return undefined;
	}
	if (demoFrames !== undefined) {
		return {
			kind: "frames",
			frames: demoFrames.map((frame) => ({
				body: frame.body,
				...(frame.caption === undefined ? {} : { caption: frame.caption }),
			})),
		};
	}
	if (demoFile !== undefined) {
		return {
			kind: "file",
			path: demoFile.path,
			...(demoFile.caption === undefined ? {} : { caption: demoFile.caption }),
		};
	}
	return undefined;
}

function questionOf(param: QuestionParam, index: number, problems: string[]): AskQuestion {
	const at = `questions[${index}]`;
	const evidence: EvidenceRef[] = [
		...(param.evidence_files ?? []).map(
			(entry): FileEvidence => ({
				kind: "file",
				path: entry.path,
				...(entry.start === undefined ? {} : { start: entry.start }),
				...(entry.end === undefined ? {} : { end: entry.end }),
				...(entry.note === undefined ? {} : { note: entry.note }),
			}),
		),
		...(param.evidence_quotes ?? []).map(
			(entry): TextEvidence => ({
				kind: "text",
				source: entry.source,
				text: entry.text,
				...(entry.lang === undefined ? {} : { lang: entry.lang }),
				...(entry.note === undefined ? {} : { note: entry.note }),
			}),
		),
	];
	const briefDemo = inlineDemo(param.demo_frames, param.demo_file, at, problems);
	return {
		id: param.id,
		question: param.question,
		...(param.header === undefined ? {} : { header: param.header }),
		options: param.options.map((option, optionIndex): AskOption => {
			const optionDemo = inlineDemo(option.demo_frames, option.demo_file, `${at}.options[${optionIndex}]`, problems);
			return {
				label: option.label,
				...(option.description === undefined ? {} : { description: option.description }),
				tradeoff: option.tradeoff,
				...(option.holds_when === undefined ? {} : { holds_when: option.holds_when }),
				...(option.cost === undefined ? {} : { cost: option.cost }),
				...(optionDemo === undefined ? {} : { demo: optionDemo }),
			};
		}),
		...(param.recommended === undefined ? {} : { recommended: param.recommended }),
		brief: {
			where: param.brief.where,
			what: param.brief.what,
			how: param.brief.how,
			...(evidence.length === 0 ? {} : { evidence }),
			...(param.brief.diagram === undefined ? {} : { diagram: param.brief.diagram }),
			...(briefDemo === undefined ? {} : { demo: briefDemo }),
			...(param.brief.risks === undefined ? {} : { risks: param.brief.risks }),
		},
	};
}

export function parseParams(params: AskParamsWire): Validated {
	const problems: string[] = [];
	const questions = params.questions.map((question, index) => questionOf(question, index, problems));
	const checked = validate({ questions });
	if (problems.length === 0) return checked;
	return { ok: false, problems: [...problems, ...(checked.ok ? [] : checked.problems)] };
}

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

function validateDemo(demo: Demo, at: string): string[] {
	switch (demo.kind) {
		case "file":
			return demo.path.trim().length === 0 ? [`${at}.path: empty`] : [];
		case "frames":
			if (demo.frames.length === 0) return [`${at}.frames: empty; give at least one frame`];
			return demo.frames.flatMap((frame, index) => (frame.body.trim().length === 0 ? [`${at}.frames[${index}].body: empty`] : []));
	}
}
