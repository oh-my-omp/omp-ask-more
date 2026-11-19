/**
 * ask-more: registers `ask` under the native name, with the questions extended by a `brief`,
 * per-option tradeoffs, evidence and image demos. A call is validated, screened for readability,
 * its file evidence read, and the whole batch compiled into one HTML form (src/form.ts) that the
 * host's own `ask` answers through `ctx.invokeTool`: the host draws it in every session with a
 * UI, runs its timeout and notification, closes it when the user sends a message instead, and
 * returns its `AskToolDetails`. This plugin rewrites only the text the model reads (src/result.ts).
 * The persisted call keeps the model's own `questions[]`; the host's `/tree` re-answer rebuilds a
 * plain form from them. While `ask` is active, every user-invoked skill reaches the model with the
 * rule that its questions go through `ask` (src/skill-prompt.ts).
 */
import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import {
	AgentRegistry,
	type AskToolDetails,
	askToolRenderer,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { journalJudgmentUsage, resolveJudge, sharedJudgmentCache } from "@oh-my-pi/pi-coding-agent/judgment";
import { isLocalAgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session-handle";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { tr } from "./omomp-shared/i18n.ts";
import { resolveEvidence } from "./src/brief.ts";
import { DESCRIPTION, docTopics } from "./src/description.ts";
import { compileForm } from "./src/form.ts";
import { type Gate, gateUnlessRetry, type NoulJudge, readabilityGate } from "./src/readability.ts";
import { answeredResult, rejectedResult } from "./src/result.ts";
import { type AskParamsWire, type AskQuestion, parametersSchema, parseParams } from "./src/schema.ts";
import { readReadabilityJudge, SettingsError, settingsErrorText } from "./src/settings.ts";
import { withSkillAskRule } from "./src/skill-prompt.ts";

/**
 * The calling session's `judge` role chain, billed to it. The session model goes in as the host's
 * own fallback: the host adds it only when the chain holds no native judgment model.
 */
function sessionJudge(ctx: ExtensionContext): NoulJudge | undefined {
	const session = AgentRegistry.global()
		.list()
		.find((ref) => ref.session?.sessionManager === ctx.sessionManager)?.session;
	// Only the session on this thread exposes the settings and registries the judge needs.
	if (session == null || !isLocalAgentSession(session)) return undefined;
	const chain = resolveJudge({
		settings: session.settings,
		registry: session.modelRegistry,
		sessionModel: session.model,
		sessionId: session.sessionId,
		metadataResolver: (provider) => session.agent.metadataForProvider(provider),
		purpose: "ask-readability",
		onUsage: journalJudgmentUsage(session.sessionManager),
		telemetry: session.agent.telemetry,
		cache: sharedJudgmentCache(),
		costGate: session.costGate,
	});
	return chain.primaryModel() === undefined ? undefined : chain;
}

/** The readability gate per the `readability.judge` setting; a bad setting warns and skips it. The ask after a rejected one goes through unjudged. */
function screen(ctx: ExtensionContext, questions: readonly AskQuestion[], signal: AbortSignal | undefined): Promise<Gate> {
	return gateUnlessRetry(ctx.sessionManager.getBranch(), async () => {
		const warn = (message: string) => ctx.ui.notify?.(`ask-more: ${message}`, "warning");
		let enabled: boolean;
		try {
			enabled = await readReadabilityJudge(ctx);
		} catch (error) {
			warn(error instanceof SettingsError ? settingsErrorText() : error instanceof Error ? error.message : String(error));
			return { kind: "pass" };
		}
		if (!enabled) return { kind: "pass" };
		const judge = sessionJudge(ctx);
		return judge === undefined ? { kind: "pass" } : readabilityGate(judge, questions, signal, warn);
	});
}

async function ask(
	ctx: ExtensionContext,
	params: AskParamsWire,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AskToolDetails> | undefined,
): Promise<AgentToolResult<AskToolDetails>> {
	const checked = parseParams(params);
	if (!checked.ok) return rejectedResult(checked.problems);
	const questions = checked.questions;
	// Present only where the host's own `ask` exists, which it builds only for sessions that can prompt the user.
	const invoke = ctx.invokeTool;
	if (invoke === undefined) return rejectedResult(["ask needs an interactive session, and this session cannot prompt the user"]);

	const gate = await screen(ctx, questions, signal);
	switch (gate.kind) {
		case "pass":
			break;
		case "reject":
			return rejectedResult(gate.problems);
		case "cancelled":
			throw new ToolAbortError("Ask input was cancelled");
	}

	const evidence = await Promise.all(questions.map((question) => resolveEvidence(question.brief.evidence, ctx.cwd)));
	const result = await invoke<AskToolDetails>(
		{ html: compileForm(questions, evidence, ctx.cwd) },
		{ ...(signal === undefined ? {} : { signal }), ...(onUpdate === undefined ? {} : { onUpdate }) },
	);
	return answeredResult(questions, result);
}

export default function askMore(pi: ExtensionAPI): void {
	const tool = {
		name: "ask",
		label: tr("Ask", "询问"),
		description: DESCRIPTION,
		docTopics,
		parameters: parametersSchema,
		approval: "read",
		// One form at a time, as the host's own `ask` declares: the host has one ask slot over the
		// composer, and a second form would take it from the first.
		concurrency: "exclusive",
		// Strict tool calling: the provider constrains the arguments to the schema, and omp turns every
		// optional field into a nullable one whose null it drops before validation. The parameter
		// shapes are written for it (src/schema.ts); OpenAI-family backends apply strict mode anyway
		// when the flag is absent.
		strict: true,
		loadMode: "essential",
		execute: (_toolCallId, params, signal, onUpdate, ctx) => ask(ctx, params, signal, onUpdate),
		// The host draws its ask card only for its built-in `ask`; this tool replaces it, so it hands
		// the host's `{ answers }` details to the same renderer. The host renderer's `args` are the HTML
		// form (it reads password fields from it); this tool's arguments are `questions[]`, so none are passed.
		renderResult: (result, options, theme) => askToolRenderer.renderResult(result, options, theme),
		describeResult: (result, options) => askToolRenderer.describeResult(result, options),
	} satisfies ToolDefinition<typeof parametersSchema, AskToolDetails> & {
		docTopics(): Readonly<Record<string, string>>;
		concurrency: "exclusive";
	};
	pi.registerTool(tool);
	// The skill message is rendered by a fixed omp template; the copy sent to the model is the one
	// place left to carry the rule. Registering costs omp a clone of the history per model call.
	pi.on("context", (event) => {
		if (!pi.getActiveTools().includes("ask")) return undefined;
		const messages = withSkillAskRule(event.messages);
		return messages === undefined ? undefined : { messages };
	});
}
