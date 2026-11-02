// Runs the readability gate's real judge over recorded asks and reports, per threshold, how its
// verdicts compare with human labels: `bun eval/readability.ts [corpus.json] [--out scores.json]`.
// The corpus defaults to eval/readability-labelled.json. The judge is the `judge` role chain of
// this directory's omp settings, as a session would resolve it.
import { z } from "@oh-my-pi/pi-coding-agent";
import { openStandaloneJudge } from "@oh-my-pi/pi-coding-agent/judgment/standalone";
import { DEFECTS, type DefectScores, judgeReadability, readabilityVerdict } from "../src/readability.ts";
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

function parseArgs(argv: readonly string[]): { readonly corpus: string; readonly out: string | undefined } {
	const outAt = argv.indexOf("--out");
	const out = outAt === -1 ? undefined : argv[outAt + 1];
	const rest = argv.filter((_arg, index) => outAt === -1 || (index !== outAt && index !== outAt + 1));
	return { corpus: rest[0] ?? new URL("./readability-labelled.json", import.meta.url).pathname, out };
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
	const { corpus, out } = parseArgs(process.argv.slice(2));
	const { calls } = corpusSchema.parse(await Bun.file(corpus).json());
	const { judge, close } = await openStandaloneJudge(process.cwd(), "ask-readability-eval");
	const scored: Scored[] = [];
	const failed: string[] = [];
	try {
		let next = 0;
		const worker = async () => {
			for (let index = next++; index < calls.length; index = next++) {
				const call = calls[index];
				if (call === undefined) break;
				try {
					scored.push({ call, scores: await judgeReadability(judge, call.questions, call.surface, AbortSignal.timeout(60_000)) });
				} catch (error) {
					failed.push(`${call.id}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		};
		await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	} finally {
		close();
	}
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
