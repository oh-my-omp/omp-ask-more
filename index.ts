/**
 * ask-more: registers `ask` under the native name with the native parameters extended by a
 * `brief` and per-option tradeoffs. An interactive TUI session answers in this plugin's component
 * (an ANSI dialog, or a modal sheet in Tern); any other session delegates to the native built-in,
 * which renders the native fields and ignores the extension ones. The answer and the persisted call
 * keep the native contracts (`AskToolDetails`, `/tree` recovery), so nothing downstream changes.
 * While `ask` is active, every user-invoked skill reaches the model with the rule that its
 * questions go through `ask` (src/skill-prompt.ts).
 */
import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { AgentRegistry, type AskToolDetails, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext, type OverlayOptions, type ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { journalJudgmentUsage, resolveJudge, sharedJudgmentCache } from "@oh-my-pi/pi-coding-agent/judgment";
import { isNativeRendering } from "@oh-my-pi/pi-tui";
import { resolveEvidence } from "./src/brief.ts";
import { AskMoreComponent, type Submission } from "./src/component.ts";
import { loadQuestionDemos } from "./src/demo.ts";
import { DESCRIPTION, docTopics } from "./src/description.ts";
import { tr } from "./src/i18n.ts";
import { sheetTitle } from "./src/nodes.ts";
import { sendNotice } from "./src/notify.ts";
import { type Gate, gateOnce, type NoulJudge, readabilityGate, type Surface } from "./src/readability.ts";
import { answerResult, cancelledResult, rejectedResult, timedOutResult } from "./src/result.ts";
import { type AskParams, type AskQuestion, nativeQuestion, parametersSchema, validate } from "./src/schema.ts";
import { withSkillAskRule } from "./src/skill-prompt.ts";
import { readReadabilityJudge, readTimeoutSettings, SettingsError, settingsErrorText } from "./src/settings.ts";
import { type TimeoutPolicy, timeoutPolicy, policyProblemText } from "./src/timeout.ts";

/** One ask at a time: a second call would open a second sheet over the first and orphan its promise. */
let asking = false;

/** The native dialog when this session cannot host the richer surface: the whole batch at once. */
async function delegate(
	invoke: NonNullable<ExtensionContext["invokeTool"]>,
	questions: readonly AskQuestion[],
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AskToolDetails> | undefined,
): Promise<AgentToolResult<AskToolDetails>> {
	return invoke<AskToolDetails>(
		{ questions: questions.map(nativeQuestion) },
		{ ...(signal === undefined ? {} : { signal }), ...(onUpdate === undefined ? {} : { onUpdate }) },
	);
}

/**
 * The calling session's `judge` role chain, billed to it. The session model goes in as the host's
 * own fallback: the host adds it only when the chain holds no native judgment model.
 */
function sessionJudge(ctx: ExtensionContext): NoulJudge | undefined {
	const session = AgentRegistry.global()
		.list()
		.find(ref => ref.session?.sessionManager === ctx.sessionManager)?.session;
	if (session == null) return undefined;
	const chain = resolveJudge({
		settings: session.settings,
		registry: session.modelRegistry,
		sessionModel: session.model,
		sessionId: session.sessionId,
		metadataResolver: provider => session.agent.metadataForProvider(provider),
		purpose: "ask-readability",
		onUsage: journalJudgmentUsage(session.sessionManager),
		telemetry: session.agent.telemetry,
		cache: sharedJudgmentCache(),
		costGate: session.costGate,
	});
	return chain.primaryModel() === undefined ? undefined : chain;
}

/** Sessions whose last ask the readability gate rejected: their next ask is not judged. */
const rejected = new WeakSet<object>();

/** The readability gate per the `readability.judge` setting; a bad setting warns and skips it. The ask after a rejection goes through unjudged. */
function screen(ctx: ExtensionContext, questions: readonly AskQuestion[], surface: Surface, signal: AbortSignal | undefined): Promise<Gate> {
	return gateOnce(rejected, ctx.sessionManager, async () => {
		const warn = (message: string) => ctx.ui.notify?.(`ask-more: ${message}`, "warning");
		let enabled: boolean;
		try {
			enabled = await readReadabilityJudge(ctx);
		} catch (error) {
			warn(error instanceof SettingsError ? settingsErrorText(error) : error instanceof Error ? error.message : String(error));
			return { kind: "pass" };
		}
		if (!enabled) return { kind: "pass" };
		const judge = sessionJudge(ctx);
		return judge === undefined ? { kind: "pass" } : readabilityGate(judge, questions, surface, signal, warn);
	});
}

/** The result that ends the call at the gate; undefined when the ask goes on. */
function gateResult(ctx: ExtensionContext, questions: readonly AskQuestion[], gate: Gate): AgentToolResult<AskToolDetails> | undefined {
	switch (gate.kind) {
		case "pass":
			return undefined;
		case "reject":
			return rejectedResult(gate.problems);
		case "cancelled":
			ctx.abort();
			return cancelledResult(questions);
	}
}

/**
 * A fullscreen overlay: the alternate screen in an ANSI terminal; in Tern the component's
 * `nativeOverlay` turns it into a sheet over the transcript.
 */
const SHEET: OverlayOptions = { fullscreen: true, width: "100%", maxHeight: "100%", margin: 0, anchor: "top-left" };

/** Notify through the policy's channels; a failing channel is a warning and never touches the ask. */
function notifier(ctx: ExtensionContext, policy: TimeoutPolicy, questions: readonly AskQuestion[]): (due: Date | undefined) => void {
	const warn = (message: string) => ctx.ui.notify?.(`ask-more: ${message}`, "warning");
	return due => {
		if (policy.kind !== "notify") return;
		try {
			sendNotice(policy.channels, { title: sheetTitle(questions), questions: questions.length, cwd: ctx.cwd, due }, warn);
		} catch (error) {
			warn(error instanceof Error ? error.message : String(error));
		}
	};
}

async function ask(
	ctx: ExtensionContext,
	ui: ExtensionUIContext,
	params: AskParams,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AskToolDetails> | undefined,
): Promise<AgentToolResult<AskToolDetails>> {
	const checked = validate(params);
	if (!checked.ok) return rejectedResult(checked.problems);
	const questions = checked.questions;

	if (!(ctx.hasUI && ctx.mode === "tui")) {
		const invoke = ctx.invokeTool;
		if (invoke === undefined) {
			return rejectedResult(["ask needs an interactive session, and no native ask is available to delegate to here"]);
		}
		return gateResult(ctx, questions, await screen(ctx, questions, "native", signal)) ?? delegate(invoke, questions, signal, onUpdate);
	}
	if (asking) return rejectedResult(["another ask is open in this session; answer it before asking again"]);

	// Held through the readability check too, so a parallel ask cannot slip in while the judge runs.
	asking = true;
	try {
		const stopped = gateResult(ctx, questions, await screen(ctx, questions, "sheet", signal));
		if (stopped !== undefined) return stopped;
		// The settings as they are now; a config change applies from the next ask.
		const { policy, problems } = timeoutPolicy(await readTimeoutSettings(ctx));
		for (const problem of problems) ctx.ui.notify?.(`ask-more: ${policyProblemText(problem)}`, "warning");
		const [evidence, demos] = await Promise.all([
			Promise.all(questions.map(question => resolveEvidence(question.brief.evidence, ctx.cwd))),
			// Tern plays image bytes itself; the ANSI page draws decoded frames as wide as the page.
			loadQuestionDemos(questions, ctx.cwd, isNativeRendering() ? "native" : "ansi", (process.stdout.columns ?? 80) - 8, signal),
		]);
		const notify = notifier(ctx, policy, questions);
		const submission = await ui.custom<Submission | undefined>(
			(tui, _theme, _keybindings, done) => new AskMoreComponent({ tui, questions, evidence, demos, finish: done, timeout: policy, notify }),
			{ overlay: true, overlayOptions: SHEET, ...(signal === undefined ? {} : { signal }) },
		);
		if (submission === undefined) {
			ctx.abort();
			return cancelledResult(questions);
		}
		switch (submission.kind) {
			case "cancel":
				ctx.abort();
				return cancelledResult(questions);
			case "submit":
				return answerResult(questions, submission.answers);
			case "timeout":
				return timedOutResult(questions, submission.answers);
		}
	} catch (error) {
		if (signal?.aborted) {
			ctx.abort();
			return cancelledResult(questions);
		}
		// The rich surface failed before it could be answered: fall back rather than lose the ask.
		const detail = error instanceof SettingsError ? settingsErrorText(error) : error instanceof Error ? error.message : String(error);
		ctx.ui.notify?.(`ask-more: ${tr("Could not open the full-screen dialog", "无法打开全屏对话框")}: ${detail}`, "warning");
		const invoke = ctx.invokeTool;
		return invoke === undefined ? rejectedResult([`ask could not open its dialog: ${detail}`]) : delegate(invoke, questions, signal, onUpdate);
	} finally {
		asking = false;
	}
}

export default function askMore(pi: ExtensionAPI): void {
	const tool = {
		name: "ask",
		label: tr("Ask", "询问"),
		description: DESCRIPTION,
		docTopics,
		parameters: parametersSchema,
		approval: "read",
		// Strict tool calling: the provider constrains the arguments to the schema, and omp turns every
		// optional field into a nullable one whose null it drops before validation. The parameter
		// shapes are written for it (src/schema.ts); OpenAI-family backends apply strict mode anyway
		// when the flag is absent.
		strict: true,
		loadMode: "essential",
		execute: (_toolCallId, params, signal, onUpdate, ctx) => ask(ctx, ctx.ui, params, signal, onUpdate),
	} satisfies ToolDefinition<typeof parametersSchema> & { docTopics(): Readonly<Record<string, string>> };
	pi.registerTool(tool);
	// The skill message is rendered by a fixed omp template; the copy sent to the model is the one
	// place left to carry the rule. Registering costs omp a clone of the history per model call.
	pi.on("context", event => {
		if (!pi.getActiveTools().includes("ask")) return undefined;
		const messages = withSkillAskRule(event.messages);
		return messages === undefined ? undefined : { messages };
	});
}
