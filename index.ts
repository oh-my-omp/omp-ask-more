import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails, ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { journalJudgmentUsage, resolveJudge, sharedJudgmentCache } from "@oh-my-pi/pi-coding-agent/judgment";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { isLocalAgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session-handle";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { tr } from "./omomp-shared/i18n.ts";
import { omompTool } from "./omomp-shared/tool-entry.ts";
import { resolveEvidence } from "./src/brief.ts";
import { resolveDemos } from "./src/demo.ts";
import { DESCRIPTION, docTopics, registerAskTopics } from "./src/description.ts";
import { errorText } from "./src/errors.ts";
import { compileForm } from "./src/form.ts";
import { type Gate, gateUnlessRetry, type NoulJudge, readabilityGate } from "./src/readability.ts";
import { renderAskResult } from "./src/render.ts";
import { answeredResult, labelMap, rejectedResult } from "./src/result.ts";
import { type AskParamsWire, type AskQuestion, parametersSchema, parseParams } from "./src/schema.ts";
import { readReadabilityJudge } from "./src/settings.ts";
import { withSkillAskRule } from "./src/skill-prompt.ts";
import { ensureTernPlugin, ternNotice } from "./src/tern-setup.ts";

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
		const warn = (message: string) => ctx.ui.notify?.(`ask-ng: ${message}`, "warning");
		let enabled: boolean;
		try {
			enabled = await readReadabilityJudge(ctx);
		} catch (error) {
			warn(errorText(error));
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

	const [evidence, demos] = await Promise.all([
		Promise.all(questions.map((question) => resolveEvidence(question.brief.evidence, ctx.cwd))),
		Promise.all(questions.map((question) => resolveDemos(question, ctx.cwd))),
	]);
	const html = compileForm(questions, evidence, demos);
	const result = await invoke<AskToolDetails>({ html }, { signal, onUpdate });
	return answeredResult(questions, labelMap(html), result);
}

export default function askNg(pi: ExtensionAPI): void {
	registerAskTopics();
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
		renderResult: (result) => renderAskResult(result),
		mergeCallAndResult: true,
	} satisfies ToolDefinition<typeof parametersSchema, AskToolDetails> & {
		docTopics(): Readonly<Record<string, string>>;
		concurrency: "exclusive";
		mergeCallAndResult: true;
	};
	pi.registerTool(omompTool(tool));
	const tern = ensureTernPlugin();
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		const notice = ternNotice(await tern);
		if (notice !== null) ctx.ui.notify(notice.text, notice.level);
	});
	pi.on("context", (event) => {
		if (!pi.getActiveTools().includes("ask")) return undefined;
		const messages = withSkillAskRule(event.messages);
		return messages === undefined ? undefined : { messages };
	});
}
