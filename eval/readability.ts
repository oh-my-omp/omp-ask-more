// Runs the readability gate over recorded asks and reports, per threshold, how its verdicts compare
// with labels: `bun eval/readability.ts [corpus.json] [--model provider/id] [--out scores.json]`.
// The corpus defaults to eval/readability-labelled.json. Without --model the judge is the one a
// session in this directory resolves (src/judge.ts): `@omp-ask-more`, else the `judge` role chain;
// --model judges with that chat model as `@omp-ask-more` would.
import { parseArgs } from "node:util";
import { z } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { type JudgeDeps, sharedJudgmentCache } from "@oh-my-pi/pi-coding-agent/judgment";
import { discoverAuthStorage, loadCliExtensionProviders } from "@oh-my-pi/pi-coding-agent/sdk";
import { chatJudge, readabilityJudge } from "../src/judge.ts";
import { DEFECTS, type DefectScores, judgeReadability, type NoulJudge, readabilityVerdict } from "../src/readability.ts";
import { questionSchema } from "../src/schema.ts";

const corpusSchema = z.object({
	calls: z.array(
		z.object({
			id: z.string().min(1),
			surface: z.enum(["sheet", "native"]),
			questions: z.array(questionSchema).min(1),
			/** The human's verdict per question id; unlabelled questions are scored but not counted. */
			labels: z.record(z.string(), z.enum(["readable", "hard"])).optional(),
		}),
	),
});

type RecordedCall = z.infer<typeof corpusSchema>["calls"][number];

interface Scored {
	readonly call: RecordedCall;
	readonly scores: DefectScores;
}

const CONCURRENCY = 8;
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

function judgeFor(deps: JudgeDeps, model: string | undefined): NoulJudge {
	if (model === undefined) {
		const judge = readabilityJudge(deps);
		if (judge === undefined) throw new Error("neither @omp-ask-more nor the judge role resolves a model");
		return judge;
	}
	const slash = model.indexOf("/");
	const found = slash === -1 ? undefined : deps.registry.find(model.slice(0, slash), model.slice(slash + 1));
	if (found === undefined) throw new Error(`no model ${model}`);
	return chatJudge([found], deps);
}

function report(scored: readonly Scored[], threshold: number): string {
	let tp = 0;
	let fp = 0;
	let fn = 0;
	let tn = 0;
	let callsLabelled = 0;
	let callsFalseRejected = 0;
	let flagged = 0;
	let questions = 0;
	for (const { call, scores } of scored) {
		const verdict = readabilityVerdict(call.questions, scores, threshold);
		const failing = new Set(verdict.kind === "unreadable" ? verdict.failures.map(failure => failure.id) : []);
		questions += call.questions.length;
		flagged += failing.size;
		const labels = call.labels;
		if (labels === undefined) continue;
		let anyLabel = false;
		let falseReject = false;
		for (const question of call.questions) {
			const label = labels[question.id];
			if (label === undefined) continue;
			anyLabel = true;
			const hit = failing.has(question.id);
			if (label === "hard" && hit) tp++;
			else if (label === "hard") fn++;
			else if (hit) {
				fp++;
				falseReject = true;
			} else tn++;
		}
		if (anyLabel) callsLabelled++;
		if (falseReject) callsFalseRejected++;
	}
	const ratio = (a: number, b: number) => (b === 0 ? "-" : (a / b).toFixed(2));
	return `| ${threshold} | ${flagged}/${questions} | ${ratio(tp, tp + fp)} | ${ratio(tp, tp + fn)} | ${ratio(fp, fp + tn)} | ${callsFalseRejected}/${callsLabelled} |`;
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" }, model: { type: "string" } }, allowPositionals: true });
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
		const judge = judgeFor({ settings, registry, sessionId: Bun.randomUUIDv7(), purpose: "ask-readability-eval", cache: sharedJudgmentCache() }, values.model);
		let next = 0;
		const worker = async () => {
			for (let index = next++; index < calls.length; index = next++) {
				const call = calls[index];
				if (call === undefined) break;
				try {
					scored.push({ call, scores: await judgeReadability(judge, call.questions, call.surface, AbortSignal.timeout(120_000)) });
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
		const rows = scored.flatMap(({ call, scores }) =>
			call.questions.map((question, index) => ({ call: call.id, question: question.id, label: call.labels?.[question.id] ?? null, ...scores[index] })),
		);
		await Bun.write(out, JSON.stringify(rows, null, 1));
	}
	console.log(`judged ${scored.length}/${calls.length} calls; defects: ${DEFECTS.join(", ")}`);
	for (const failure of failed) console.log(`failed ${failure}`);
	console.log("\n| threshold | flagged questions | precision (hard) | recall (hard) | false-reject rate | calls falsely rejected |");
	console.log("|---|---|---|---|---|---|");
	for (const threshold of THRESHOLDS) console.log(report(scored, threshold));
}

await main();
