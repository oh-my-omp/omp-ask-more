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

function sessionJudge(ctx: ExtensionContext): NoulJudge | undefined {
	const session = AgentRegistry.global()
		.list()
		.find((ref) => ref.session?.sessionManager === ctx.sessionManager)?.session;
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
		concurrency: "exclusive",
		strict: true,
		loadMode: "essential",
		execute: (_toolCallId, params, signal, onUpdate, ctx) => ask(ctx, params, signal, onUpdate),
		renderResult: (result, options, theme) => askToolRenderer.renderResult(result, options, theme),
		describeResult: (result, options) => askToolRenderer.describeResult(result, options),
	} satisfies ToolDefinition<typeof parametersSchema, AskToolDetails> & {
		docTopics(): Readonly<Record<string, string>>;
		concurrency: "exclusive";
	};
	pi.registerTool(tool);
	pi.on("context", (event) => {
		if (!pi.getActiveTools().includes("ask")) return undefined;
		const messages = withSkillAskRule(event.messages);
		return messages === undefined ? undefined : { messages };
	});
}
