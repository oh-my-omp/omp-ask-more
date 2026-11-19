import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { DESCRIPTION, docTopics } from "../src/description.ts";
import { readReadabilityJudge, SettingsError, settingsErrorText } from "../src/settings.ts";

let cwd: string;
const lang = process.env.OMOMP_LANG;

beforeAll(async () => {
	cwd = await mkdtemp("/tmp/omp-ask-more-settings-");
	await mkdir(join(cwd, ".omp"));
});

afterAll(() => {
	if (lang === undefined) delete process.env.OMOMP_LANG;
	else process.env.OMOMP_LANG = lang;
});

async function override(settings: Record<string, unknown>): Promise<void> {
	await Bun.write(join(cwd, ".omp/plugin-overrides.json"), JSON.stringify({ settings: { "omp-ask-more": settings } }));
}

describe("native plugin settings", () => {
	it("judges readability by default, honours false, and rejects a non-boolean", async () => {
		await override({});
		expect(await readReadabilityJudge({ cwd })).toBe(true);
		await override({ "readability.judge": false });
		expect(await readReadabilityJudge({ cwd })).toBe(false);
		await override({ "readability.judge": "false" });
		await expect(readReadabilityJudge({ cwd })).rejects.toBeInstanceOf(SettingsError);
	});

	it("preserves the host's first-readable-file precedence", async () => {
		await mkdir(join(cwd, ".claude"));
		await Bun.write(
			join(cwd, ".claude/plugin-overrides.json"),
			JSON.stringify({ settings: { "omp-ask-more": { "readability.judge": false } } }),
		);
		await override({ "readability.judge": true });
		expect(await readReadabilityJudge({ cwd })).toBe(true);
		await Bun.write(join(cwd, ".omp/plugin-overrides.json"), "{");
		expect(await readReadabilityJudge({ cwd })).toBe(false);
	});

	it("renders the diagnostic in the current language", () => {
		process.env.OMOMP_LANG = "zh";
		expect(settingsErrorText()).toContain("必须为 true 或 false");
		process.env.OMOMP_LANG = "en";
		expect(settingsErrorText()).toContain("must be true or false");
	});
});

it("ships complete body-only topic instructions behind the exact footer", () => {
	const topics = docTopics();
	expect(DESCRIPTION).toContain("Topics — read the one a call needs before making it:");
	expect(Object.keys(topics)).toEqual(["routing", "rounds", "results"]);
	for (const [name, body] of Object.entries(topics)) {
		expect(DESCRIPTION).toContain(`xd://ask/${name}`);
		expect(body).not.toContain("tool://");
		expect(body).not.toStartWith("---");
	}
	expect(topics.routing).toContain("Everything else the instruction requires still applies.");
	expect(topics.rounds).toContain("fix them and call `ask` again");
	expect(topics.results).toContain("decide it yourself");
});
