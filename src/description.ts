import { readFileSync } from "node:fs";
import { registerToolTopics, type ToolTopicDoc, toDocTopics } from "../omomp-shared/internal-url.ts";

export const DESCRIPTION =
	"Ask the user decisions in one interactive form with context, evidence, and option tradeoffs; blocks until they submit or cancel. Read `help://ask/routing` before asking.";

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

export const docTopics: () => Readonly<Record<string, string>> = toDocTopics(ASK_TOPICS);

export function registerAskTopics(): void {
	registerToolTopics("omp-ask-ng", ASK_TOPICS);
}
