// The tool's parameters: the native `ask` fields this plugin supports, plus the extension fields
// that carry the decision. Native components render the native part and ignore the rest; this
// plugin's component renders both. See README.md#what-the-model-sends-and-gets.
//
// The shapes are written for strict tool calling (index.ts registers `strict: true`): omp makes
// every optional field nullable and drops null placeholders before validation, so a choice
// between shapes is a union tagged by `kind`, never two optional fields, and every optional
// string rejects "" so an empty placeholder is dropped the same way.
//
// omp's parameter check words a rejection as `<path> must be <the field's description> (was …)`,
// so every description opens with the value it expects, and holds at most one " or ": with
// more, the check rewrites the text as a list of alternatives.
import { z } from "@oh-my-pi/pi-coding-agent";

/** Labels the UI adds itself; the native tool rejects them too (`tools/ask.ts:52-58`). */
export const RESERVED_LABELS: Readonly<Record<string, true>> = {
	"Other (type your own)": true,
	"Chat about this": true,
	"Next →": true,
};

/** Demo bounds: enough frames to show a change over time, slow enough to read each one. */
export const MIN_DEMO_FRAMES = 2;
export const MAX_DEMO_FRAMES = 12;
export const MIN_FRAME_MS = 300;
export const MAX_FRAME_MS = 5000;
export const DEFAULT_FRAME_MS = 1200;
/** File extensions a demo `path` may name: animations the sheet shows as images, and videos it converts. */
export const DEMO_IMAGE_EXTENSIONS = [".gif", ".png", ".apng", ".webp"] as const;
export const DEMO_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"] as const;

export const fileEvidenceSchema = z.object({
	kind: z.literal("file"),
	path: z.string().min(1).describe("a non-empty path to a file or directory, relative to the working directory unless absolute"),
	start: z.number().int().min(1).optional().describe("a 1-based line number where the window starts; without it the file's first lines are shown"),
	end: z.number().int().min(1).optional().describe("a 1-based line number where the window ends, inclusive; needs start, and omitted means start alone. For lines that are not adjacent, cite each window as its own entry"),
	note: z.string().min(1).optional().describe("text saying why this evidence matters"),
});

export const textEvidenceSchema = z.object({
	kind: z.literal("text"),
	source: z.string().min(1).describe("one non-empty line naming where the text was taken from: a command, a URL, a log, a tool result; shown as your claim, not checked"),
	text: z.string().min(1).describe("the non-empty text quoted as it appeared there"),
	lang: z.string().min(1).optional().describe("a highlight language for the text, such as bash, json, diff"),
	note: z.string().min(1).optional().describe("text saying why this evidence matters"),
});

/** Lines ask-more reads from a file itself, or text the model quotes from elsewhere. */
export const evidenceSchema = z.union([fileEvidenceSchema, textEvidenceSchema]);

export const demoFrameSchema = z.object({
	body: z.string().min(1).describe("non-empty Markdown: text, a ```mermaid diagram, or a fenced text drawing"),
	caption: z.string().min(1).optional().describe("one line under this frame"),
});

export const framesDemoSchema = z.object({
	kind: z.literal("frames"),
	frames: z.array(demoFrameSchema).describe("an array of frames played in a loop"),
	interval_ms: z.number().int().optional().describe("an integer: milliseconds per frame"),
	caption: z.string().min(1).optional().describe("one line saying what to watch"),
});

export const fileDemoSchema = z.object({
	kind: z.literal("file"),
	path: z.string().min(1).describe("a non-empty path to an animation or video file, relative to the working directory unless absolute"),
	caption: z.string().min(1).optional().describe("one line saying what to watch"),
});

/** An animation the model writes, or a file it names. */
export const demoSchema = z.union([framesDemoSchema, fileDemoSchema]);

export const briefSchema = z.object({
	where: z.string().min(1).describe("non-empty text saying what exists now: paths, symbols, the observation that forces the decision"),
	what: z.string().min(1).describe("non-empty text naming the decision, and why code, docs and conventions cannot make it"),
	how: z.string().min(1).describe("non-empty text saying what happens after each answer, and which constraint decides it"),
	evidence: z.array(evidenceSchema).optional().describe("an array of evidence tagged by kind: file lines ask-more reads itself, or text you quote"),
	diagram: z.string().min(1).optional().describe("Mermaid source of a flowchart, sequence diagram or state diagram"),
	demo: demoSchema.optional().describe("a demo tagged by kind: an animation of how things behave now"),
	risks: z.array(z.string().min(1)).optional(),
});

export const optionSchema = z.object({
	label: z.string().min(1),
	description: z.string().min(1).optional().describe("one line that disambiguates the option; never the tradeoff"),
	preview: z.string().min(1).optional().describe("Markdown the native surface can show"),
	tradeoff: z.string().min(1).describe("one non-empty line: what the option buys and what it costs"),
	holds_when: z.string().min(1).optional().describe("text naming the condition under which this option is right"),
	cost: z.string().min(1).optional().describe("text naming what changes: files, migrations, time"),
	demo: demoSchema.optional().describe("a demo tagged by kind: an animation of the result of picking this option"),
});

export const questionSchema = z.object({
	id: z.string().min(1).describe("a non-empty string, unique within the call; the answer is reported under it"),
	question: z.string().min(1).describe("non-empty text of one or two sentences; the brief carries the context"),
	header: z.string().min(1).optional().describe("a short tab label"),
	options: z.array(optionSchema).min(2).max(5),
	recommended: z.number().int().optional().describe("an integer: the 0-based index of the option you would pick; the cursor starts there, so Enter accepts it"),
	brief: briefSchema,
});

export const parametersSchema = z.object({
	questions: z.array(questionSchema).min(1).describe("an array of independent decisions, one tab each; a decision that depends on another answer goes in a later call"),
});

export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type FileEvidence = z.infer<typeof fileEvidenceSchema>;
export type TextEvidence = z.infer<typeof textEvidenceSchema>;
export type DemoParams = z.infer<typeof demoSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type AskOption = z.infer<typeof optionSchema>;
export type AskQuestion = z.infer<typeof questionSchema>;
export type AskParams = z.infer<typeof parametersSchema>;

/** Every question validated; or every reason the call cannot be asked. */
export type Validated = { readonly ok: true; readonly questions: readonly AskQuestion[] } | { readonly ok: false; readonly problems: readonly string[] };

export type FramesDemo = z.infer<typeof framesDemoSchema>;
export type FileDemo = z.infer<typeof fileDemoSchema>;

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
		else if (RESERVED_LABELS[label] === true) problems.push(`${optionAt}.label: "${option.label}" is added by the UI; give the option its own label`);
		else if (seen.has(label)) problems.push(`${optionAt}.label: duplicate "${option.label}"`);
		else seen.add(label);
		if (option.tradeoff.trim().length === 0) problems.push(`${optionAt}.tradeoff: empty; say what the option buys and what it costs`);
		if (option.demo !== undefined) problems.push(...validateDemo(option.demo, `${optionAt}.demo`));
	});
	if (question.brief.demo !== undefined) problems.push(...validateDemo(question.brief.demo, `${at}.brief.demo`));

	(question.brief.evidence ?? []).forEach((ref, index) => problems.push(...validateEvidence(ref, `${at}.brief.evidence[${index}]`)));

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
	else if (/[\r\n]/.test(source)) problems.push(`${at}.source: more than one line; name where the text came from in one line and put the text in text`);
	if (ref.text.trim().length === 0) problems.push(`${at}.text: empty`);
	return problems;
}

/** The extension of `path`, lower-cased, with its dot; empty when it has none. */
export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function validateDemo(demo: DemoParams, at: string): string[] {
	switch (demo.kind) {
		case "frames":
			return validateFrames(demo, at);
		case "file":
			return validateFile(demo, at);
	}
}

function validateFrames(demo: FramesDemo, at: string): string[] {
	const problems: string[] = [];
	if (demo.frames.length < MIN_DEMO_FRAMES || demo.frames.length > MAX_DEMO_FRAMES) {
		problems.push(`${at}.frames: ${demo.frames.length} frames; a demo plays ${MIN_DEMO_FRAMES} to ${MAX_DEMO_FRAMES}`);
	}
	demo.frames.forEach((frame, index) => {
		if (frame.body.trim().length === 0) problems.push(`${at}.frames[${index}].body: empty`);
	});
	const interval = demo.interval_ms;
	if (interval !== undefined && (interval < MIN_FRAME_MS || interval > MAX_FRAME_MS)) {
		problems.push(`${at}.interval_ms: ${interval} is not from ${MIN_FRAME_MS} to ${MAX_FRAME_MS} ms`);
	}
	return problems;
}

function validateFile(demo: FileDemo, at: string): string[] {
	const path = demo.path.trim();
	const known = [...DEMO_IMAGE_EXTENSIONS, ...DEMO_VIDEO_EXTENSIONS] as readonly string[];
	if (path.length === 0) return [`${at}.path: empty`];
	if (!known.includes(extensionOf(path))) return [`${at}.path: "${demo.path}" is not one of ${known.join(", ")}`];
	return [];
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
