import { z } from "@oh-my-pi/omptype/zod";

const RESERVED_LABEL = /^\s*other\b/i;

const evidenceFileParamSchema = z
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
	.describe("a file evidence entry read directly from disk");

const evidenceQuoteParamSchema = z
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

const demoFrameParamSchema = z
	.object({
		body: z.string().min(1).describe("non-empty Markdown: text, a ```mermaid diagram, a fenced text drawing"),
		caption: z.string().min(1).describe("one line under this frame").optional(),
	})
	.describe("one frame of a frames demo");

const demoFileParamSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.describe("a non-empty path to any file (image, video, recording), relative to the working directory unless absolute"),
		caption: z.string().min(1).describe("one line saying what to watch").optional(),
	})
	.describe("a file demo; pictures render inline and other files play via their file URL");

const briefParamSchema = z
	.object({
		where: z.string().min(1).describe("non-empty text saying what exists now: paths, symbols, the observation that forces the decision"),
		what: z.string().min(1).describe("non-empty text naming the decision, and why code, docs and conventions cannot make it"),
		how: z.string().min(1).describe("non-empty text saying what happens after each answer, and which constraint decides it"),
		diagram: z.string().min(1).describe("Mermaid source of a flowchart, sequence diagram or state diagram").optional(),
		risks: z.array(z.string().min(1)).describe("one risk per line: what could go wrong with the decision itself").optional(),
	})
	.describe("the decision's background: where things stand, what is being decided and what follows each answer");

const optionParamSchema = z
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

export type AskParamsWire = z.infer<typeof parametersSchema>;
type QuestionParam = z.infer<typeof questionParamSchema>;
type OptionParam = z.infer<typeof optionParamSchema>;
type DemoParams = Pick<OptionParam, "demo_frames" | "demo_file">;

export type FileEvidence = { readonly kind: "file" } & z.infer<typeof evidenceFileParamSchema>;
export type TextEvidence = { readonly kind: "text" } & z.infer<typeof evidenceQuoteParamSchema>;
export type EvidenceRef = FileEvidence | TextEvidence;
export type DemoFrame = z.infer<typeof demoFrameParamSchema>;
export type Demo =
	| ({ readonly kind: "file" } & z.infer<typeof demoFileParamSchema>)
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[] };
export type AskOption = Omit<OptionParam, keyof DemoParams> & { readonly demo?: Demo };
export type Brief = z.infer<typeof briefParamSchema> & { readonly evidence: readonly EvidenceRef[]; readonly demo?: Demo };
export type AskQuestion = Omit<QuestionParam, "options" | "brief" | "evidence_files" | "evidence_quotes" | keyof DemoParams> & {
	readonly options: readonly AskOption[];
	readonly brief: Brief;
};

export type Validated =
	| { readonly ok: true; readonly questions: readonly AskQuestion[] }
	| { readonly ok: false; readonly problems: readonly string[] };

function demoOf({ demo_frames, demo_file }: DemoParams, at: string, problems: string[]): Demo | undefined {
	if (demo_frames !== undefined && demo_file !== undefined) {
		problems.push(`${at}.demo_file: give either demo_frames or demo_file, not both`);
		return undefined;
	}
	if (demo_frames !== undefined) return { kind: "frames", frames: demo_frames };
	if (demo_file !== undefined) return { kind: "file", ...demo_file };
	return undefined;
}

function optionOf(param: OptionParam, at: string, problems: string[]): AskOption {
	const { demo_frames, demo_file, ...option } = param;
	return { ...option, demo: demoOf({ demo_frames, demo_file }, at, problems) };
}

function questionOf(param: QuestionParam, at: string, problems: string[]): AskQuestion {
	const { evidence_files = [], evidence_quotes = [], demo_frames, demo_file, options, brief, ...question } = param;
	const demo = demoOf({ demo_frames, demo_file }, at, problems);
	return {
		...question,
		options: options.map((option, index) => optionOf(option, `${at}.options[${index}]`, problems)),
		brief: {
			...brief,
			evidence: [
				...evidence_files.map((entry): EvidenceRef => ({ kind: "file", ...entry })),
				...evidence_quotes.map((entry): EvidenceRef => ({ kind: "text", ...entry })),
			],
			demo,
		},
	};
}

export function parseParams(params: AskParamsWire): Validated {
	const problems: string[] = [];
	const ids = new Set<string>();
	const questions = params.questions.map((param, index) => {
		const at = `questions[${index}]`;
		const question = questionOf(param, at, problems);
		const id = question.id.trim();
		if (ids.has(id)) problems.push(`${at}.id: duplicate "${question.id}"; every question needs its own id`);
		else ids.add(id);
		problems.push(...questionProblems(question, at));
		return question;
	});
	return problems.length === 0 ? { ok: true, questions } : { ok: false, problems };
}

function questionProblems(question: AskQuestion, at: string): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	question.options.forEach((option, index) => {
		const optionAt = `${at}.options[${index}]`;
		const label = option.label.trim();
		if (option.label !== option.label.replace(/\s+/g, " ").trim())
			problems.push(`${optionAt}.label: one line with single spaces, so the form returns it unchanged`);
		else if (RESERVED_LABEL.test(label))
			problems.push(
				`${optionAt}.label: "${option.label}" starts with Other, which the form keeps for the user's own answer; give the option another label`,
			);
		else if (seen.has(label)) problems.push(`${optionAt}.label: duplicate "${option.label}"`);
		else seen.add(label);
	});
	question.brief.evidence.forEach((ref, index) => {
		problems.push(...evidenceProblems(ref, `${at}.brief.evidence[${index}]`));
	});
	const recommended = question.recommended;
	if (recommended !== undefined && (recommended < 0 || recommended >= question.options.length)) {
		problems.push(`${at}.recommended: ${recommended} is not an index into ${question.options.length} options`);
	}
	return problems;
}

function evidenceProblems(ref: EvidenceRef, at: string): string[] {
	switch (ref.kind) {
		case "file":
			return fileEvidenceProblems(ref, at);
		case "text":
			return textEvidenceProblems(ref, at);
	}
}

function textEvidenceProblems(ref: TextEvidence, at: string): string[] {
	const source = ref.source.trim();
	return /[\r\n]/.test(source)
		? [`${at}.source: more than one line; name where the text came from in one line and put the text in text`]
		: [];
}

function fileEvidenceProblems(ref: FileEvidence, at: string): string[] {
	if (ref.end === undefined) return [];
	if (ref.start === undefined) return [`${at}.end: ${ref.end} without start; give start too, or leave both out for the file's first lines`];
	if (ref.end < ref.start) return [`${at}.end: ${ref.end} is before start ${ref.start}`];
	return [];
}
