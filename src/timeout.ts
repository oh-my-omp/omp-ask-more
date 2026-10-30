// What an ask does when nobody answers it: the policy parsed from the settings snapshot, and the
// line the sheet shows about it. Pure; the component owns the clock, `notify.ts` the side effects.
import { tr } from "./i18n.ts";

export const EXPIRY_VALUES = ["decide", "wait"] as const;
/** When the last countdown ends: hand the unanswered questions to the model, or keep waiting. */
export type Expiry = (typeof EXPIRY_VALUES)[number];

/** `askMore.notify.command` as configured; a project config may not run commands. */
export type CommandSetting = { readonly kind: "unset" } | { readonly kind: "set"; readonly command: string; readonly fromProject: boolean };

export interface TimeoutSettings {
	/** `askMore.timeout`: idle seconds before the first step; 0 turns timing off. */
	readonly timeoutSeconds: number;
	/** `askMore.returnTimeout`: seconds after a notification for the user to come back. */
	readonly returnSeconds: number;
	readonly onExpiry: Expiry;
	readonly terminal: boolean;
	readonly command: CommandSetting;
}

/** Where a timeout notification goes. */
export type Channel = { readonly kind: "terminal" } | { readonly kind: "command"; readonly command: string };

/** What the notified ask does once the return window ends. */
export type AfterNotice = { readonly kind: "decide"; readonly returnMs: number } | { readonly kind: "wait" };

export type TimeoutPolicy =
	| { readonly kind: "off" }
	/** Idle for `idleMs`: the unanswered questions go to the model. */
	| { readonly kind: "decide"; readonly idleMs: number }
	/** Idle for `idleMs`: notify through every channel, then `then`. */
	| { readonly kind: "notify"; readonly idleMs: number; readonly channels: readonly [Channel, ...Channel[]]; readonly then: AfterNotice };

export interface ParsedPolicy {
	readonly policy: TimeoutPolicy;
	/** Settings that were set but not used, each with the reason. */
	readonly problems: readonly string[];
}

export function timeoutPolicy(settings: TimeoutSettings): ParsedPolicy {
	const problems: string[] = [];
	const channels: Channel[] = [];
	if (settings.terminal) channels.push({ kind: "terminal" });
	const command = settings.command;
	switch (command.kind) {
		case "unset":
			break;
		case "set":
			if (command.fromProject) {
				problems.push("askMore.notify.command is ignored in a project config; set it in ~/.omp/agent/config.yml or OMP_ASK_MORE_NOTIFY_COMMAND");
			} else {
				channels.push({ kind: "command", command: command.command });
			}
			break;
	}
	if (settings.timeoutSeconds === 0) return { policy: { kind: "off" }, problems };
	const idleMs = settings.timeoutSeconds * 1000;
	const [first, ...rest] = channels;
	if (first === undefined) {
		switch (settings.onExpiry) {
			case "decide":
				return { policy: { kind: "decide", idleMs }, problems };
			case "wait":
				return { policy: { kind: "off" }, problems };
		}
	}
	const then: AfterNotice = settings.onExpiry === "decide" ? { kind: "decide", returnMs: settings.returnSeconds * 1000 } : { kind: "wait" };
	return { policy: { kind: "notify", idleMs, channels: [first, ...rest], then }, problems };
}

/** Where the countdown of an open ask stands. */
export type Phase = { readonly kind: "idle" } | { readonly kind: "notified"; readonly at: Date; readonly due: Date | undefined };

/** `1 h 30 min`, `30 min`, `45 s`. */
export function duration(ms: number): string {
	const total = Math.round(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(tr(`${hours} h`, `${hours} 小时`));
	if (minutes > 0) parts.push(tr(`${minutes} min`, `${minutes} 分钟`));
	if (seconds > 0 || parts.length === 0) parts.push(tr(`${seconds} s`, `${seconds} 秒`));
	return parts.join(" ");
}

/** `14:03` in local time. */
export function clock(at: Date): string {
	return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The sheet's line about the countdown; none when nothing will happen on its own. */
export function countdownStatus(policy: TimeoutPolicy, phase: Phase): string | undefined {
	switch (policy.kind) {
		case "off":
			return undefined;
		case "decide":
			return tr(`No input for ${duration(policy.idleMs)}: the model decides the unanswered questions`, `无操作 ${duration(policy.idleMs)} 后，未答的问题交给模型决定`);
		case "notify":
			return phase.kind === "idle" ? idleNotice(policy.idleMs, policy.then) : notifiedNotice(phase.at, phase.due);
	}
}

function idleNotice(idleMs: number, then: AfterNotice): string {
	switch (then.kind) {
		case "decide":
			return tr(
				`No input for ${duration(idleMs)}: you get notified, and ${duration(then.returnMs)} later the model decides`,
				`无操作 ${duration(idleMs)} 后通知你，再过 ${duration(then.returnMs)} 交给模型决定`,
			);
		case "wait":
			return tr(`No input for ${duration(idleMs)}: you get notified`, `无操作 ${duration(idleMs)} 后通知你`);
	}
}

function notifiedNotice(at: Date, due: Date | undefined): string {
	return due === undefined
		? tr(`Notified at ${clock(at)}; waiting for you`, `${clock(at)} 已通知，等你回来`)
		: tr(`Notified at ${clock(at)}; the model decides at ${clock(due)} unless you act`, `${clock(at)} 已通知；${clock(due)} 前无操作则交给模型决定`);
}
