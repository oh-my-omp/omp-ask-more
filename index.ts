/**
 * ask-more: registers `ask` under the native name with the native parameters extended by a
 * `brief` and per-option tradeoffs. An interactive TUI session answers in this plugin's component
 * (an ANSI dialog, or a modal sheet in Tern); any other session delegates to the native built-in,
 * which renders the native fields and ignores the extension ones. The answer and the persisted call
 * keep the native contracts (`AskToolDetails`, `/tree` recovery), so nothing downstream changes.
 */
import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type AskToolDetails, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@oh-my-pi/pi-coding-agent";
import { resolveEvidence } from "./src/brief.ts";
import { AskMoreComponent, type Submission } from "./src/component.ts";
import { DESCRIPTION } from "./src/description.ts";
import { answerResult, cancelledResult, rejectedResult } from "./src/result.ts";
import { type AskParams, type AskQuestion, nativeQuestion, parametersSchema, validate } from "./src/schema.ts";

/** One ask at a time: a second call would replace the first component and orphan its promise. */
let asking = false;

/** The native dialog when this session cannot host the richer surface. */
async function delegate(
	ctx: ExtensionContext,
	question: AskQuestion,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AskToolDetails> | undefined,
): Promise<AgentToolResult<AskToolDetails>> {
	const invoke = ctx.invokeTool;
	if (invoke === undefined) {
		return rejectedResult(["ask needs an interactive session, and no native ask is available to delegate to here"]);
	}
	return invoke<AskToolDetails>(
		{ questions: [nativeQuestion(question)] },
		{ ...(signal === undefined ? {} : { signal }), ...(onUpdate === undefined ? {} : { onUpdate }) },
	);
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
	const question = checked.question;

	if (!(ctx.hasUI && ctx.mode === "tui")) return delegate(ctx, question, signal, onUpdate);
	if (asking) return rejectedResult(["another ask is open in this session; answer it before asking again"]);

	asking = true;
	try {
		const evidence = await resolveEvidence(question.brief.evidence, ctx.cwd);
		const submission = await ui.custom<Submission | undefined>(
			(tui, _theme, _keybindings, done) => new AskMoreComponent({ tui, question, evidence, finish: done }),
			{ ...(signal === undefined ? {} : { signal }) },
		);
		if (submission === undefined || submission.kind === "cancel") {
			ctx.abort();
			return cancelledResult(question);
		}
		return answerResult(question, submission);
	} catch (error) {
		if (signal?.aborted) {
			ctx.abort();
			return cancelledResult(question);
		}
		// The rich surface failed before it could be answered: fall back rather than lose the ask.
		ctx.ui.notify?.(`ask-more: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return delegate(ctx, question, signal, onUpdate);
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
		loadMode: "essential",
		execute: (_toolCallId, params, signal, onUpdate, ctx) => ask(ctx, ctx.ui, params, signal, onUpdate),
	});
}
