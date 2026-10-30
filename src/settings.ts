// The plugin's own settings, registered in omp's settings registry so they read from the same
// layers as native ones (`~/.omp/agent/config.yml`, project `.omp/config.yml`, `--config`, `cfg://`)
// and are snapshotted from the asking session when an ask opens.
import { register, type ScopeLike } from "@oh-my-pi/pi-coding-agent/config/registry";
import type { SettingProvenance } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { type CommandSetting, type Expiry, EXPIRY_VALUES, type TimeoutSettings } from "./timeout.ts";

/** The longest countdown a timer can hold, in whole seconds. */
const MAX_SECONDS = 2_147_483;

function wholeSeconds(id: string): (raw: unknown) => void {
	return raw => {
		if (raw !== undefined && (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > MAX_SECONDS)) {
			throw new Error(`${id} must be whole seconds from 0 to ${MAX_SECONDS}`);
		}
	};
}

function registerAll() {
	return {
		timeout: register({ id: "askMore.timeout", type: "number", default: 1800, validate: wholeSeconds("askMore.timeout") }),
		returnTimeout: register({ id: "askMore.returnTimeout", type: "number", default: 1200, validate: wholeSeconds("askMore.returnTimeout") }),
		onExpiry: register({ id: "askMore.onExpiry", type: "enum", values: EXPIRY_VALUES, default: "decide" }),
		terminal: register({ id: "askMore.notify.terminal", type: "boolean", default: true }),
		command: register({ id: "askMore.notify.command", type: "string", default: undefined, env: "OMP_ASK_MORE_NOTIFY_COMMAND", credential: true }),
	};
}

type Handles = ReturnType<typeof registerAll>;

// The registry is process-wide and rejects a second registration of an id, while the plugin module
// can be evaluated more than once in a process; the handles live with the registry, once.
const SLOT = Symbol.for("omp-ask-more.settings");
const slots = globalThis as typeof globalThis & { [SLOT]?: Handles };
const handles: Handles = slots[SLOT] ?? (slots[SLOT] = registerAll());

function commandSetting(scope: ScopeLike): CommandSetting {
	const text = handles.command.get(scope)?.trim();
	if (text === undefined || text.length === 0) return { kind: "unset" };
	const source: SettingProvenance = handles.command.provenance(scope);
	return { kind: "set", command: text, fromProject: source === "project" };
}

/** The asking session's settings as they stand now; an open ask keeps this snapshot. */
export function readTimeoutSettings(ctx: ExtensionContext): TimeoutSettings {
	const session = AgentRegistry.global().get(ctx.agent.id)?.session;
	if (session === undefined || session === null) throw new Error(`no session is registered for agent ${ctx.agent.id}`);
	const scope = session.settings;
	const onExpiry: Expiry = handles.onExpiry.get(scope);
	return {
		timeoutSeconds: handles.timeout.get(scope),
		returnSeconds: handles.returnTimeout.get(scope),
		onExpiry,
		terminal: handles.terminal.get(scope),
		command: commandSetting(scope),
	};
}
