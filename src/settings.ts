// The plugin's one native setting, read when each ask is called, before the readability check.
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { tr } from "../omomp-shared/i18n.ts";
import manifest from "../package.json";

const PLUGIN = "omp-ask-more";

/** `readability.judge` holds something other than a boolean. */
export class SettingsError extends Error {
	constructor() {
		super("Invalid ask-more plugin setting");
	}
}

/** Render the diagnostic only at the human boundary, in the current language. */
export function settingsErrorText(): string {
	return tr("readability.judge must be true or false", "readability.judge 必须为 true 或 false");
}

/** Whether the readability gate asks the judge. The host merges global and project settings but applies no defaults, so the manifest's applies here. */
export async function readReadabilityJudge(ctx: Pick<ExtensionContext, "cwd">): Promise<boolean> {
	const raw: unknown = (await getPluginSettings(PLUGIN, ctx.cwd))["readability.judge"];
	const value = raw === undefined ? manifest.omp.settings["readability.judge"].default : raw;
	if (typeof value !== "boolean") throw new SettingsError();
	return value;
}
