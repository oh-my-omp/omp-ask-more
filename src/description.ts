import { readFileSync } from "node:fs";
import { registerToolTopics, type ToolTopicDoc } from "../omomp-shared/internal-url.ts";

export const DESCRIPTION =
	"Ask the user decisions as one form with brief, evidence, and per-option tradeoffs, blocking until answered. Read `tool://ask/routing` before asking, confirming, or following a skill's questions.";

export function routingTopicBody(): string {
	return readFileSync(new URL("./topics/routing.md", import.meta.url), "utf8");
}

export const ASK_TOPICS: readonly ToolTopicDoc[] = [
	{
		tool: "ask",
		topic: "routing",
		title: "When and how to route questions through ask",
		when: "before putting a question, choice or confirmation to the user, including questions required by a skill or workflow",
		body: routingTopicBody,
	},
];

export function registerAskTopics(): void {
	registerToolTopics("omp-ask-more", ASK_TOPICS);
}
