// Model-facing documentation: the short purpose stays in the prompt; detailed instructions
// are shipped as markdown bodies and served through the host's native topic channel.
import { readFileSync } from "node:fs";

export const DESCRIPTION = `Opens a full-screen dialog that puts your questions to the user and blocks until they answer.

Topics — read the one a call needs before making it:
- \`xd://ask/routing\` — before putting a question, choice or confirmation to the user, including questions required by a skill or workflow
- \`xd://ask/rounds\` — before composing a batch, sequencing dependent questions, or retrying a rejected call
- \`xd://ask/results\` — before interpreting answers, cancellations, custom answers or timeouts`;

export function docTopics(): Readonly<Record<string, string>> {
	return {
		routing: readFileSync(new URL("./topics/routing.md", import.meta.url), "utf8"),
		rounds: readFileSync(new URL("./topics/rounds.md", import.meta.url), "utf8"),
		results: readFileSync(new URL("./topics/results.md", import.meta.url), "utf8"),
	};
}
