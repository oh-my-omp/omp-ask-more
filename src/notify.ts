// Delivery of a timeout notification. Best effort: a channel that fails becomes a warning in the
// session and never changes the ask, which keeps waiting or hands over on its own clock.
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { ptree } from "@oh-my-pi/pi-utils";
import { tr } from "./i18n.ts";
import { type Channel, clock } from "./timeout.ts";

/** What the notification says; never the question text, evidence or answers. */
export interface NoticeEvent {
	/** The sheet title: the question's chip, or "N decisions". */
	readonly title: string;
	readonly questions: number;
	readonly cwd: string;
	/** When the model takes over; undefined when the ask keeps waiting. */
	readonly due: Date | undefined;
}

/** How long a notify command may run before it is killed. */
const COMMAND_TIMEOUT_MS = 30_000;

function noticeBody(event: NoticeEvent): string {
	return event.due === undefined
		? tr(`${event.title}: waiting for your answer`, `${event.title}：等待你的回答`)
		: tr(`${event.title}: waiting for your answer; the model decides at ${clock(event.due)}`, `${event.title}：等待你的回答；${clock(event.due)} 交给模型决定`);
}

/** The variables a notify command reads; its own environment (and secrets) come through unchanged. */
export function commandEnvironment(event: NoticeEvent): Record<string, string> {
	return {
		OMP_ASK_MORE_EVENT: "timeout",
		OMP_ASK_MORE_TITLE: event.title,
		OMP_ASK_MORE_BODY: noticeBody(event),
		OMP_ASK_MORE_QUESTIONS: String(event.questions),
		OMP_ASK_MORE_CWD: event.cwd,
		OMP_ASK_MORE_DUE: event.due === undefined ? "" : event.due.toISOString(),
	};
}

async function runCommand(command: string, event: NoticeEvent, warn: (message: string) => void): Promise<void> {
	try {
		const result = await ptree.exec(["sh", "-c", command], {
			cwd: event.cwd,
			env: { ...Bun.env, ...commandEnvironment(event) },
			timeout: COMMAND_TIMEOUT_MS,
			allowNonZero: true,
			allowAbort: true,
		});
		// The command text may carry a token, so the warning names only the outcome.
		if (result.exitError?.aborted) warn(tr(`notify command killed after ${COMMAND_TIMEOUT_MS / 1000} s`, `通知命令运行超过 ${COMMAND_TIMEOUT_MS / 1000} 秒，已终止`));
		else if (result.exitCode !== 0) warn(tr(`notify command exited with ${result.exitCode ?? "no status"}`, `通知命令退出码 ${result.exitCode ?? "未知"}`));
	} catch (error) {
		warn(tr(`notify command could not start: ${error instanceof Error ? error.message : String(error)}`, `通知命令无法启动：${error instanceof Error ? error.message : String(error)}`));
	}
}

/** Send `event` through every channel; returns at once, a command finishes in the background. */
export function sendNotice(channels: readonly Channel[], event: NoticeEvent, warn: (message: string) => void): void {
	for (const channel of channels) {
		switch (channel.kind) {
			case "terminal":
				TERMINAL.sendNotification({ title: "omp", body: noticeBody(event), type: "ask", urgency: "normal", actions: "focus" });
				break;
			case "command":
				void runCommand(channel.command, event, warn);
				break;
		}
	}
}
