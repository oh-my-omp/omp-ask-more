// The routing rule inside a user-invoked skill. omp renders `/skill:<name>` through a fixed template
// (`prompts/skills/user-invocation.md`) into a user-attributed custom message, and a skill that shows
// how its questions look in the reply outweighs the tool description on some models. The `context`
// event is the one place a plugin can reach that message: this module appends the rule to the copy
// sent to the model, after the skill body and the user's arguments, so it is the message's last word.
// The persisted message, `/tree` and the transcript keep the original text.
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { SKILL_PROMPT_MESSAGE_TYPE } from "@oh-my-pi/pi-tui/chat/messages";

export const SKILL_ASK_RULE =
	"[IMPORTANT: Any question, confirmation or choice the skill above puts to the user MUST go through the `ask` tool, NEVER into your reply, even where the skill says to ask in chat or shows how the questions look in your reply. Keep their content, order and recommendations.]";

type CustomMessage = Extract<AgentMessage, { role: "custom" }>;

/** A skill the user invoked; autoloaded skills are not user-attributed and carry no questions for them. */
function isUserSkillPrompt(message: AgentMessage): message is CustomMessage {
	return message.role === "custom" && message.customType === SKILL_PROMPT_MESSAGE_TYPE && message.attribution === "user";
}

function withRule(text: string): string {
	return text.endsWith(SKILL_ASK_RULE) ? text : `${text}\n\n${SKILL_ASK_RULE}`;
}

/** The content with the rule appended to its text: a string, or the first text block before the attached images. */
function contentWithRule(content: CustomMessage["content"]): CustomMessage["content"] {
	if (typeof content === "string") return withRule(content);
	const at = content.findIndex(block => block.type === "text");
	const block = content[at];
	if (block?.type !== "text") return content;
	const text = withRule(block.text);
	if (text === block.text) return content;
	const next = [...content];
	next[at] = { ...block, text };
	return next;
}

/**
 * The messages with every user-invoked skill prompt carrying the rule, or undefined when none does
 * so the caller sends the history as it is. Copies keep every other field, including the symbol-keyed
 * history index omp uses to match a copy to its persisted message.
 */
export function withSkillAskRule(messages: readonly AgentMessage[]): AgentMessage[] | undefined {
	let next: AgentMessage[] | undefined;
	messages.forEach((message, index) => {
		if (!isUserSkillPrompt(message)) return;
		const content = contentWithRule(message.content);
		if (content === message.content) return;
		next ??= [...messages];
		next[index] = { ...message, content };
	});
	return next;
}
