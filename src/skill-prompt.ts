import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { SKILL_PROMPT_MESSAGE_TYPE } from "@oh-my-pi/pi-tui/chat/messages";

export const SKILL_ASK_RULE =
	"[IMPORTANT: Any question, confirmation or choice the skill above puts to the user MUST go through the `ask` tool, NEVER into your reply, even where the skill says to ask in chat or shows how the questions look in your reply. Keep their content, order and recommendations.]";

type CustomMessage = Extract<AgentMessage, { role: "custom" }>;

function isUserSkillPrompt(message: AgentMessage): message is CustomMessage {
	return message.role === "custom" && message.customType === SKILL_PROMPT_MESSAGE_TYPE && message.attribution === "user";
}

function withRule(text: string): string {
	return text.endsWith(SKILL_ASK_RULE) ? text : `${text}\n\n${SKILL_ASK_RULE}`;
}

function contentWithRule(content: CustomMessage["content"]): CustomMessage["content"] {
	if (typeof content === "string") return withRule(content);
	const at = content.findIndex((block) => block.type === "text");
	const block = content[at];
	if (block?.type !== "text") return content;
	const text = withRule(block.text);
	if (text === block.text) return content;
	const next = [...content];
	next[at] = { ...block, text };
	return next;
}

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
