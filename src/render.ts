import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import { type JSX, type JSXNode, jsx } from "@oh-my-pi/pi-tui";

type Answer = AskToolDetails["answers"][number];
type Note = NonNullable<AskToolDetails["notes"]>[number];

const NO_ANSWER = "(no answer)";
const TIMED_OUT = "auto-selected after timeout — not a user choice";

function node<K extends keyof JSX.IntrinsicElements>(kind: K, props: JSX.IntrinsicElements[K] & Parameters<typeof jsx>[1]): JSXNode {
	return jsx(kind, props);
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function answerSection(answer: Answer, notes: readonly Note[]): JSXNode {
	const shown = answer.answer.trim();
	return node("section", {
		children: [
			node("text", { spans: [{ t: oneLine(answer.question) }], wrap: "word" }),
			shown === ""
				? node("text", { spans: [{ t: NO_ANSWER, s: "dim" }] })
				: node("row", {
						gap: "sm",
						align: "baseline",
						children: [
							node("icon", { name: "check", tone: "success" }),
							node("text", { spans: [{ t: shown, s: "toolOutput" }], wrap: "word" }),
						],
					}),
			notes.map((note) =>
				node("text", {
					spans: [
						{ t: "✎ ", s: "dim" },
						{ t: `${oneLine(note.option)}: ${oneLine(note.text)}`, s: "em" },
					],
					wrap: "word",
				}),
			),
		],
	});
}

export function renderAskResult(result: AgentToolResult<AskToolDetails>): JSXNode {
	const details = result.details;
	if (result.isError === true || details === undefined || details.answers.length === 0) {
		const text = result.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n")
			.trim();
		return node("text", { spans: [{ t: text, s: "dim" }], wrap: "word" });
	}
	const notes = details.notes ?? [];
	return [
		details.answers.map((answer) =>
			answerSection(
				answer,
				notes.filter((note) => note.name === answer.name && note.question === answer.question),
			),
		),
		details.timedOut === true && node("text", { spans: [{ t: TIMED_OUT, s: "muted" }], wrap: "word" }),
	];
}
