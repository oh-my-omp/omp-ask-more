// UI labels only. Field names, tool descriptions and anything the model reads stay English.
export type Lang = "en" | "zh";

function fromEnvironment(): Lang {
	const explicit = (process.env.OMOMP_LANG ?? "").trim().toLowerCase();
	if (explicit === "zh" || explicit === "en") return explicit;
	for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
		const value = process.env[key];
		if (value !== undefined && value.trim() !== "") {
			return value.trim().toLowerCase().startsWith("zh") ? "zh" : "en";
		}
	}
	return "en";
}

const LANG: Lang = fromEnvironment();

export function tr(en: string, zh: string): string {
	return LANG === "zh" ? zh : en;
}
