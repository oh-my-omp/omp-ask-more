import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { clearToolTopics, listToolTopics, resolveToolTopic } from "../omomp-shared/internal-url.ts";
import { DESCRIPTION, docTopics, registerAskTopics, routingTopicBody } from "../src/description.ts";
import { readReadabilityJudge, SettingsError } from "../src/settings.ts";

let cwd: string;
const lang = process.env.OMOMP_LANG;

beforeAll(async () => {
	cwd = await mkdtemp("/tmp/omp-ask-ng-settings-");
	await mkdir(join(cwd, ".omp"));
});

afterAll(() => {
	if (lang === undefined) delete process.env.OMOMP_LANG;
	else process.env.OMOMP_LANG = lang;
});

afterEach(() => {
	clearToolTopics("omp-ask-ng");
});

async function override(settings: Record<string, unknown>): Promise<void> {
	await Bun.write(join(cwd, ".omp/plugin-overrides.json"), JSON.stringify({ settings: { "omp-ask-ng": settings } }));
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
			JSON.stringify({ settings: { "omp-ask-ng": { "readability.judge": false } } }),
		);
		await override({ "readability.judge": true });
		expect(await readReadabilityJudge({ cwd })).toBe(true);
		await Bun.write(join(cwd, ".omp/plugin-overrides.json"), "{");
		expect(await readReadabilityJudge({ cwd })).toBe(false);
	});

	it("renders the diagnostic in the current language", () => {
		process.env.OMOMP_LANG = "zh";
		expect(new SettingsError().message).toContain("必须为 true 或 false");
		process.env.OMOMP_LANG = "en";
		expect(new SettingsError().message).toContain("must be true or false");
	});
});

it("registers the routing topic the description points to under help://ask/routing and docTopics", () => {
	registerAskTopics();
	expect(DESCRIPTION).toContain("help://ask/routing");

	const topics = listToolTopics("ask");
	expect(topics.map((doc) => doc.topic)).toEqual(["routing"]);

	const resolved = resolveToolTopic("ask", "routing");
	expect(resolved).toBeDefined();
	const body = routingTopicBody();
	expect(resolved?.content).toBe(body);
	expect(docTopics()).toEqual({ routing: body });
});
