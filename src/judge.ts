// The model behind the readability gate: the chat models the user bound to the plugin's own
// `@omp-ask-more` role, or, while that role is unbound, the host's `judge` role chain. The native
// judge answers the rubric with low probabilities on asks people cannot read (eval/readability.ts),
// so the gate fires through it rarely; a bound chat model is the configuration that rejects.
import { chatTextBackend, type Model, TextJudge } from "@oh-my-pi/pi-ai";
import { resolveRoleChain } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { roleCandidatePool } from "@oh-my-pi/pi-coding-agent/config/model-roles";
import { type JudgeDeps, kindOf, resolveJudge } from "@oh-my-pi/pi-coding-agent/judgment";
import type { NoulJudge } from "./readability.ts";

/** The plugin's model role, bound by the user in `/model`. */
export const ROLE = "omp-ask-more";

/** Chat models explicitly bound to `@omp-ask-more`, in chain order. */
export function roleModels(deps: Pick<JudgeDeps, "settings" | "registry">): Model[] {
	return resolveRoleChain(ROLE, deps.settings, roleCandidatePool(ROLE, deps.settings, deps.registry))
		.filter(candidate => candidate.explicit && kindOf(candidate) === "online")
		.map(candidate => candidate.model);
}

/** The chat models as prompted judges, tried in order on missing credentials or failures. */
export function chatJudge(models: readonly Model[], deps: JudgeDeps): NoulJudge {
	return {
		async judge(request, options) {
			const { signal } = options;
			let lastFailure = "no model";
			for (const model of models) {
				signal.throwIfAborted();
				deps.costGate?.admit();
				if (!(await deps.registry.getApiKey(model, deps.sessionId, { signal }))) {
					lastFailure = `no API key for ${model.provider}/${model.id}`;
					continue;
				}
				const backend = chatTextBackend(model, {
					apiKey: deps.registry.resolver(model, deps.sessionId),
					...(deps.sessionId === undefined ? {} : { sessionId: deps.sessionId }),
					metadata: deps.metadataResolver?.(model.provider),
					onAttempt: attempt => {
						deps.costGate?.record(attempt.usage.cost.total);
						deps.onUsage?.({
							purpose: deps.purpose,
							role: ROLE,
							api: attempt.api,
							provider: attempt.provider,
							model: attempt.model,
							usage: attempt.usage,
							stopReason: attempt.stopReason,
							...(attempt.errorMessage === undefined ? {} : { errorMessage: attempt.errorMessage }),
						});
					},
				});
				try {
					return await new TextJudge(backend).judge(request, options);
				} catch (error) {
					signal.throwIfAborted();
					lastFailure = error instanceof Error ? error.message : String(error);
				}
			}
			throw new Error(`every @${ROLE} model failed: ${lastFailure}`);
		},
	};
}

/** The gate's judge; undefined when neither the role nor the `judge` chain resolves a model. */
export function readabilityJudge(deps: JudgeDeps): NoulJudge | undefined {
	const models = roleModels(deps);
	if (models.length > 0) return chatJudge(models, deps);
	const chain = resolveJudge(deps);
	return chain.primaryModel() === undefined ? undefined : chain;
}
