// UI labels only. Field names, tool descriptions and anything the model reads stay English.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";

export type Lang = "en" | "zh";

const CONFIG_FILES = ["omomp.yml", "omomp.yaml", "omomp.json", "omomp.toml"] as const;
let configRead = false;
let configLanguage: Lang | undefined;

function isMapping(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only an unambiguous agent-level file with a strict language section is accepted. */
function configuredLanguage(): Lang | undefined {
	if (configRead) return configLanguage;
	configRead = true;
	const dir = getAgentDir();
	const paths = CONFIG_FILES.map(filename => join(dir, filename)).filter(path => existsSync(path));
	if (paths.length !== 1) return undefined;
	const path = paths[0];
	if (path === undefined) return undefined;
	try {
		const text = readFileSync(path, "utf8");
		const root: unknown = path.endsWith(".json")
			? JSON.parse(text)
			: path.endsWith(".toml")
				? Bun.TOML.parse(text)
				: Bun.YAML.parse(text);
		if (!isMapping(root)) return undefined;
		const section = root["omomp-lang"];
		if (!isMapping(section) || Object.keys(section).length !== 1) return undefined;
		if (section.language === "en" || section.language === "zh") configLanguage = section.language;
	} catch {
		// Missing, unreadable and malformed configuration leaves the locale in charge.
	}
	return configLanguage;
}

/** Environment is live per call; the agent configuration is read once per process. */
export function language(): Lang {
	const explicit = (process.env.OMOMP_LANG ?? "").trim().toLowerCase();
	if (explicit === "zh" || explicit === "en") return explicit;
	const configured = configuredLanguage();
	if (configured !== undefined) return configured;
	for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
		const value = process.env[key]?.trim();
		if (value) return value.toLowerCase().startsWith("zh") ? "zh" : "en";
	}
	return "en";
}

export function tr(en: string, zh: string): string {
	return language() === "zh" ? zh : en;
}
