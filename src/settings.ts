// Native plugin settings are read once when each ask opens, never by its timers.
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import manifest from "../package.json";
import { tr } from "./i18n.ts";
import { type CommandSetting, type TimeoutSettings } from "./timeout.ts";

const PLUGIN = "omp-ask-more";
const defaults = manifest.omp.settings;
const MAX_SECONDS = defaults.timeout.max;

type SettingProblem =
	| { readonly kind: "seconds"; readonly key: "timeout" | "returnTimeout" }
	| { readonly kind: "expiry" }
	| { readonly kind: "terminal" }
	| { readonly kind: "command" }
	| { readonly kind: "readability" };

export class SettingsError extends Error {
	constructor(readonly problem: SettingProblem) {
		super("Invalid ask-more plugin setting");
	}
}

/** Render authored diagnostics only at the human boundary, using the current language. */
export function settingsErrorText(error: SettingsError): string {
	const problem = error.problem;
	switch (problem.kind) {
		case "seconds":
			return tr(`${problem.key} must be whole seconds from 0 to ${MAX_SECONDS}`, `${problem.key} 必须是 0 到 ${MAX_SECONDS} 之间的整数秒`);
		case "expiry":
			return tr("onExpiry must be decide or wait", "onExpiry 必须为 decide 或 wait");
		case "terminal":
			return tr("notify.terminal must be true or false", "notify.terminal 必须为 true 或 false");
		case "command":
			return tr("notify.command must be a string", "notify.command 必须是字符串");
		case "readability":
			return tr("readability.judge must be true or false", "readability.judge 必须为 true 或 false");
	}
}

function wholeSeconds(key: "timeout" | "returnTimeout", raw: unknown): number {
	const value = raw === undefined ? defaults[key].default : raw;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_SECONDS) {
		throw new SettingsError({ kind: "seconds", key });
	}
	return value;
}

type CommandSource = "project" | "trusted";


function commandSetting(raw: unknown, source: CommandSource): CommandSetting {
	if (raw === undefined) return { kind: "unset" };
	if (typeof raw !== "string") throw new SettingsError({ kind: "command" });
	const text = raw.trim();
	return text.length === 0 ? { kind: "unset" } : { kind: "set", command: text, fromProject: source === "project" };
}

/** The native API merges global settings and project overrides but applies no defaults or env. */
export async function readTimeoutSettings(ctx: Pick<ExtensionContext, "cwd">): Promise<TimeoutSettings> {
	const env = process.env.OMP_ASK_MORE_NOTIFY_COMMAND;
	// The mapped host API owns all file selection/parsing. At "/" its project candidates are
	// machine-admin files (/.omp, /.claude, /.codex, /.gemini), part of the trusted baseline.
	// A project command differing from that baseline is untrusted. An identical value is the
	// user's own globally chosen command and cannot introduce a new executable command.
	const [settings, baseline] = await Promise.all([
		getPluginSettings(PLUGIN, ctx.cwd),
		env === undefined ? getPluginSettings(PLUGIN, "/") : Promise.resolve(undefined),
	]);
	const timeoutSeconds = wholeSeconds("timeout", settings.timeout);
	const returnSeconds = wholeSeconds("returnTimeout", settings.returnTimeout);
	const onExpiry: unknown = settings.onExpiry === undefined ? defaults.onExpiry.default : settings.onExpiry;
	if (onExpiry !== "decide" && onExpiry !== "wait") throw new SettingsError({ kind: "expiry" });
	const terminal: unknown = settings["notify.terminal"] === undefined ? defaults["notify.terminal"].default : settings["notify.terminal"];
	if (typeof terminal !== "boolean") throw new SettingsError({ kind: "terminal" });
	const command = env !== undefined
		? commandSetting(env, "trusted")
		: commandSetting(settings["notify.command"], settings["notify.command"] === baseline?.["notify.command"] ? "trusted" : "project");
	return { timeoutSeconds, returnSeconds, onExpiry, terminal, command };
}

/** Whether the readability gate asks the judge; read when each ask is called, before any dialog. */
export async function readReadabilityJudge(ctx: Pick<ExtensionContext, "cwd">): Promise<boolean> {
	const raw: unknown = (await getPluginSettings(PLUGIN, ctx.cwd))["readability.judge"];
	const value = raw === undefined ? defaults["readability.judge"].default : raw;
	if (typeof value !== "boolean") throw new SettingsError({ kind: "readability" });
	return value;
}
