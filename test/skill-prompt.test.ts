import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { SKILL_ASK_RULE, withSkillAskRule } from "../src/skill-prompt.ts";

const skillText = '[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]\n\nAsk in chat.\n\nUser: grill me';

function skillPrompt(content: Extract<AgentMessage, { role: "custom" }>["content"], attribution: "user" | "agent" = "user"): AgentMessage {
	return { role: "custom", customType: "skill-prompt", content, display: true, attribution, timestamp: 1 };
}

describe("withSkillAskRule", () => {
	it("ends a user-invoked skill prompt with the rule and leaves the other messages as they are", () => {
		const user: AgentMessage = { role: "user", content: "hi", timestamp: 0 };
		const next = withSkillAskRule([user, skillPrompt(skillText)]);
		expect(next?.[0]).toBe(user);
		expect(next?.[1]).toMatchObject({ role: "custom", content: `${skillText}\n\n${SKILL_ASK_RULE}` });
	});

	it("extends the text block of a skill prompt with images and keeps the images after it", () => {
		const image = { type: "image" as const, data: "AA==", mimeType: "image/png" };
		const next = withSkillAskRule([skillPrompt([{ type: "text", text: skillText }, image])]);
		expect(next?.[0]).toMatchObject({ content: [{ type: "text", text: `${skillText}\n\n${SKILL_ASK_RULE}` }, image] });
	});

	it("sends the history unchanged when no user-invoked skill prompt lacks the rule", () => {
		expect(withSkillAskRule([skillPrompt(skillText, "agent")])).toBeUndefined();
		expect(withSkillAskRule([skillPrompt(`${skillText}\n\n${SKILL_ASK_RULE}`)])).toBeUndefined();
	});
});
