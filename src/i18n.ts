// UI labels only. Field names, tool descriptions and anything the model reads stay English.

export type Lang = "en" | "zh";

/** Environment is live per call. */
export function language(): Lang {
	const explicit = (process.env.OMOMP_LANG ?? "").trim().toLowerCase();
	if (explicit === "zh" || explicit === "en") return explicit;
	for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
		const value = process.env[key]?.trim();
		if (value) return value.toLowerCase().startsWith("zh") ? "zh" : "en";
	}
	return "en";
}

export function tr(en: string, zh: string): string {
	return language() === "zh" ? zh : en;
}
