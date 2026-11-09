// Runs the readability gate's judge over recorded asks and reports which questions it rejects and why:
// `bun eval/readability.ts [corpus.json] [--session-model provider/id] [--out findings.json]`.
// The corpus defaults to eval/readability-labelled.json. The judge is the `judge` role chain of this
// directory's omp settings, as a session resolves it; --session-model is the session model the host
// falls back to when that chain holds no native judgment model.
import { parseArgs } from "node:util";
import { z } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveJudge, sharedJudgmentCache } from "@oh-my-pi/pi-coding-agent/judgment";
import { discoverAuthStorage, loadCliExtensionProviders } from "@oh-my-pi/pi-coding-agent/sdk";
import { type Finding, judgeReadability, unreadableQuestions } from "../src/readability.ts";
import { type AskQuestion, demoParamSchema, evidenceParamSchema, parseParams, questionParamSchema } from "../src/schema.ts";

/** A recorded ask in the parameters the model sends, so reading the corpus exercises the entry parse. */
const corpusSchema = z.object({
	calls: z.array(
		z.object({
			id: z.string().min(1),
			surface: z.enum(["sheet", "native"]),
			questions: z.array(questionParamSchema).min(1),
			evidence: z.array(evidenceParamSchema).optional(),
			demos: z.array(demoParamSchema).optional(),
			/** The human's verdict per question id; unlabelled questions are scored but not counted. */
			labels: z.record(z.string(), z.enum(["readable", "hard"])).optional(),
		}),
	),
});

type CorpusCall = z.infer<typeof corpusSchema>["calls"][number];

interface RecordedCall {
	readonly id: string;
	readonly surface: CorpusCall["surface"];
	readonly questions: readonly AskQuestion[];
	readonly labels?: CorpusCall["labels"];
}

interface Scored {
	readonly call: RecordedCall;
	readonly findings: readonly Finding[];
}

const CONCURRENCY = 4;

/** Rejected questions against the labels: the gate must miss no `hard` question; a rejected `readable` one costs a rewrite. */
function report(scored: readonly Scored[]): string {
	let flagged = 0;
	let questions = 0;
	let hard = 0;
	let hardMissed = 0;
	let readable = 0;
	let readableRejected = 0;
	for (const { call, findings } of scored) {
		const failing = new Set(unreadableQuestions(call.questions, findings).map(item => item.id));
		questions += call.questions.length;
		flagged += failing.size;
		for (const question of call.questions) {
			const label = call.labels?.[question.id];
			if (label === "hard") {
				hard++;
				if (!failing.has(question.id)) hardMissed++;
			} else if (label === "readable") {
				readable++;
				if (failing.has(question.id)) readableRejected++;
			}
		}
	}
	return `| ${flagged}/${questions} | ${hardMissed}/${hard} | ${readableRejected}/${readable} |`;
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" }, "session-model": { type: "string" } }, allowPositionals: true });
	const corpus = positionals[0] ?? new URL("./readability-labelled.json", import.meta.url).pathname;
	const { calls } = corpusSchema.parse(await Bun.file(corpus).json());
	const settings = await Settings.init({ cwd: process.cwd() });
	const auth = await discoverAuthStorage(undefined, { settings });
	const scored: Scored[] = [];
	const failed: string[] = [];
	try {
		const registry = new ModelRegistry(auth);
		await registry.refresh();
		await loadCliExtensionProviders(registry, settings, process.cwd());
		const named = values["session-model"];
		const slash = named?.indexOf("/") ?? -1;
		const sessionModel = named === undefined ? undefined : registry.find(named.slice(0, slash), named.slice(slash + 1));
		if (named !== undefined && sessionModel === undefined) throw new Error(`no model ${named}`);
		const judge = resolveJudge({ settings, registry, sessionModel, sessionId: Bun.randomUUIDv7(), purpose: "ask-readability-eval", cache: sharedJudgmentCache() });
		if (judge.primaryModel() === undefined) throw new Error("the judge role resolves no model");
		let next = 0;
		const worker = async () => {
			for (let index = next++; index < calls.length; index = next++) {
				const call = calls[index];
				if (call === undefined) break;
				const checked = parseParams({
					questions: call.questions,
					...(call.evidence === undefined ? {} : { evidence: call.evidence }),
					...(call.demos === undefined ? {} : { demos: call.demos }),
				});
				if (!checked.ok) {
					failed.push(`${call.id}: ${checked.problems.join("; ")}`);
					continue;
				}
				const recorded: RecordedCall = { id: call.id, surface: call.surface, questions: checked.questions, ...(call.labels === undefined ? {} : { labels: call.labels }) };
				try {
					scored.push({ call: recorded, findings: await judgeReadability(judge, recorded.questions, recorded.surface, AbortSignal.timeout(120_000)) });
				} catch (error) {
					failed.push(`${call.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		};
		await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	} finally {
		auth.close();
	}
	const out = values.out;
	if (out !== undefined) {
		const rows = scored.flatMap(({ call, findings }) =>
			unreadableQuestions(call.questions, findings).map(item => ({ call: call.id, label: call.labels?.[item.id] ?? null, ...item })),
		);
		await Bun.write(out, JSON.stringify(rows, null, 1));
	}
	console.log(`judged ${scored.length}/${calls.length} calls`);
	for (const failure of failed) console.log(`failed ${failure}`);
	console.log("\n| rejected questions | `hard` questions not rejected | `readable` questions rejected |");
	console.log("|---|---|---|");
	console.log(report(scored));
}

await main();
