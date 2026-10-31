import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { readTimeoutSettings, SettingsError, settingsErrorText } from "../src/settings.ts";
import { DESCRIPTION, docTopics } from "../src/description.ts";

let cwd: string;
const env = process.env.OMP_ASK_MORE_NOTIFY_COMMAND;
const lang = process.env.OMOMP_LANG;

beforeAll(async () => {
	cwd = await mkdtemp("/tmp/omp-ask-more-settings-");
	await mkdir(join(cwd, ".omp"));
	delete process.env.OMP_ASK_MORE_NOTIFY_COMMAND;
});

afterAll(() => {
	if (env === undefined) delete process.env.OMP_ASK_MORE_NOTIFY_COMMAND;
	else process.env.OMP_ASK_MORE_NOTIFY_COMMAND = env;
	if (lang === undefined) delete process.env.OMOMP_LANG;
	else process.env.OMOMP_LANG = lang;
});

async function override(settings: Record<string, unknown>): Promise<void> {
	await Bun.write(join(cwd, ".omp/plugin-overrides.json"), JSON.stringify({ settings: { "omp-ask-more": settings } }));
}

describe("native plugin settings", () => {
	it("uses a project timeout without trusting its command; the next ask gets a new snapshot", async () => {
		await override({ timeout: 1, returnTimeout: 2, onExpiry: "decide", "notify.terminal": false, "notify.command": "project-command" });
		const first = await readTimeoutSettings({ cwd });
		expect(first).toEqual({ timeoutSeconds: 1, returnSeconds: 2, onExpiry: "decide", terminal: false, command: { kind: "set", command: "project-command", fromProject: true } });
		await override({ timeout: 0, returnTimeout: 3, onExpiry: "wait", "notify.terminal": true });
		expect((await readTimeoutSettings({ cwd })).timeoutSeconds).toBe(0);
		expect(first.timeoutSeconds).toBe(1);
	});

	it("trusts an environment command over the project, including an explicitly empty value", async () => {
		await override({ "notify.command": "project-command" });
		process.env.OMP_ASK_MORE_NOTIFY_COMMAND = "  trusted-command  ";
		expect((await readTimeoutSettings({ cwd })).command).toEqual({ kind: "set", command: "trusted-command", fromProject: false });
		process.env.OMP_ASK_MORE_NOTIFY_COMMAND = "";
		expect((await readTimeoutSettings({ cwd })).command).toEqual({ kind: "unset" });
		delete process.env.OMP_ASK_MORE_NOTIFY_COMMAND;
	});

	it("preserves the host's first-readable-file precedence", async () => {
		await mkdir(join(cwd, ".claude"));
		await Bun.write(join(cwd, ".claude/plugin-overrides.json"), JSON.stringify({ settings: { "omp-ask-more": { timeout: 4, "notify.command": "lower-priority" } } }));
		await override({ timeout: 2, "notify.command": "" });
		expect((await readTimeoutSettings({ cwd })).command).toEqual({ kind: "unset" });
		await Bun.write(join(cwd, ".omp/plugin-overrides.json"), "{");
		const fallback = await readTimeoutSettings({ cwd });
		expect(fallback.timeoutSeconds).toBe(4);
		expect(fallback.command).toEqual({ kind: "set", command: "lower-priority", fromProject: true });
	});

	it("rejects invalid seconds and typed values with structured localized diagnostics", async () => {
		for (const value of [-1, 0.5, 2147484, "1", null]) {
			await override({ timeout: value });
			await expect(readTimeoutSettings({ cwd })).rejects.toBeInstanceOf(SettingsError);
		}
		for (const [key, value] of [["returnTimeout", 0.5], ["onExpiry", "other"], ["notify.terminal", "false"], ["notify.command", 42]] as const) {
			await override({ [key]: value });
			await expect(readTimeoutSettings({ cwd })).rejects.toBeInstanceOf(SettingsError);
		}
		const error = new SettingsError({ kind: "seconds", key: "timeout" });
		process.env.OMOMP_LANG = "zh";
		expect(settingsErrorText(error)).toContain("整数秒");
		process.env.OMOMP_LANG = "en";
		expect(settingsErrorText(error)).toContain("whole seconds");
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
