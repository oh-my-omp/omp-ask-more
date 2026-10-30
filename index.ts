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
import { type AskToolDetails, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext, type OverlayOptions } from "@oh-my-pi/pi-coding-agent";
import { isNativeRendering } from "@oh-my-pi/pi-tui";
import { resolveEvidence } from "./src/brief.ts";
import { AskMoreComponent, type Submission } from "./src/component.ts";
import { loadQuestionDemos } from "./src/demo.ts";
import { DESCRIPTION } from "./src/description.ts";
import { sheetTitle } from "./src/nodes.ts";
import { sendNotice } from "./src/notify.ts";
import { answerResult, cancelledResult, rejectedResult, timedOutResult } from "./src/result.ts";
import { type AskParams, type AskQuestion, nativeQuestion, parametersSchema, validate } from "./src/schema.ts";
import { withSkillAskRule } from "./src/skill-prompt.ts";
import { readTimeoutSettings } from "./src/settings.ts";
import { type TimeoutPolicy, timeoutPolicy } from "./src/timeout.ts";

/** One ask at a time: a second call would open a second sheet over the first and orphan its promise. */
let asking = false;

/** The native dialog when this session cannot host the richer surface: the whole batch at once. */
async function delegate(
	ctx: ExtensionContext,
	questions: readonly AskQuestion[],
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AskToolDetails> | undefined,
): Promise<AgentToolResult<AskToolDetails>> {
	const invoke = ctx.invokeTool;
	if (invoke === undefined) {
		return rejectedResult(["ask needs an interactive session, and no native ask is available to delegate to here"]);
	}
	return invoke<AskToolDetails>(
		{ questions: questions.map(nativeQuestion) },
		{ ...(signal === undefined ? {} : { signal }), ...(onUpdate === undefined ? {} : { onUpdate }) },
	);
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

	if (!(ctx.hasUI && ctx.mode === "tui")) return delegate(ctx, questions, signal, onUpdate);
	if (asking) return rejectedResult(["another ask is open in this session; answer it before asking again"]);

	asking = true;
	try {
		// The settings as they are now; a config change applies from the next ask.
		const { policy, problems } = timeoutPolicy(readTimeoutSettings(ctx));
		for (const problem of problems) ctx.ui.notify?.(`ask-more: ${problem}`, "warning");
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
		ctx.ui.notify?.(`ask-more: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return delegate(ctx, questions, signal, onUpdate);
	} finally {
		asking = false;
	}
}

export default function askMore(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: DESCRIPTION,
		parameters: parametersSchema,
		approval: "read",
		// Strict tool calling: the provider constrains the arguments to the schema, and omp turns every
		// optional field into a nullable one whose null it drops before validation. The parameter
		// shapes are written for it (src/schema.ts); OpenAI-family backends apply strict mode anyway
		// when the flag is absent.
		strict: true,
		loadMode: "essential",
		execute: (_toolCallId, params, signal, onUpdate, ctx) => ask(ctx, ctx.ui, params, signal, onUpdate),
	});
	// The skill message is rendered by a fixed omp template; the copy sent to the model is the one
	// place left to carry the rule. Registering costs omp a clone of the history per model call.
	pi.on("context", event => {
		if (!pi.getActiveTools().includes("ask")) return undefined;
		const messages = withSkillAskRule(event.messages);
		return messages === undefined ? undefined : { messages };
	});
}
