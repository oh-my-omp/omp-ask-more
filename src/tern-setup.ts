// Links the package's Tern plugin (`tern/`) into Tern, so Tern's own omp view loads the stylesheet that puts
// each line under an option's name on its own line, and the file demos of an open form play beside it.
// omp runs the extension factory while installing and rolls
// the install back when it throws, and the ask works without Tern, so nothing here throws: every outcome is a
// state the session reports.
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tr } from "../omomp-shared/i18n.ts";
import { findTern, readPluginManifest, type TernPluginCli } from "../omomp-shared/tern-plugin.ts";

const TERN_PLUGIN_DIR = resolve(import.meta.dir, "../tern");
const TERN_PLUGIN_ID = "omp-ask-more";

export type TernPluginState =
	| { readonly kind: "absent" }
	| { readonly kind: "current"; readonly version: string }
	| { readonly kind: "reloaded"; readonly from: string | null; readonly to: string }
	| { readonly kind: "failed"; readonly detail: string };

async function linkedDir(pluginsDir: string): Promise<string | null> {
	const file = Bun.file(join(pluginsDir, `${TERN_PLUGIN_ID}.path`));
	if (!(await file.exists())) return null;
	return (await file.text()).trim();
}

async function loadedVersion(cli: TernPluginCli): Promise<{ readonly version: string | null } | { readonly detail: string }> {
	const listed = await cli.list();
	if (!listed.ok) return { detail: `tern plugin list: ${listed.error.message}` };
	return { version: listed.value.find((plugin) => plugin.id === TERN_PLUGIN_ID)?.version ?? null };
}

/**
 * Links `wanted` as the plugin. `tern plugin link` refuses while Tern's plugin directory holds an installed copy of
 * the same id, the state `tern plugin install …/tern` left before the package linked itself; that copy, of whatever
 * version, is removed and the link made again. Returns why it could not link, or null once linked.
 */
async function relink(cli: TernPluginCli, wanted: string): Promise<string | null> {
	const first = await cli.link(wanted);
	if (first.ok) return null;
	const removed = await cli.remove(TERN_PLUGIN_ID);
	if (!removed.ok) return `tern plugin link: ${first.error.message}\ntern plugin remove: ${removed.error.message}`;
	const second = await cli.link(wanted);
	return second.ok ? null : `tern plugin link: ${second.error.message}`;
}

async function setup(): Promise<TernPluginState> {
	const found = findTern();
	if (found.kind === "not_installed") return { kind: "absent" };
	const cli = found.cli;
	const wanted = await realpath(TERN_PLUGIN_DIR);
	const manifest = await readPluginManifest(wanted, TERN_PLUGIN_ID);
	if (!manifest.ok) return { kind: "failed", detail: manifest.error.message };
	const version = manifest.value.version;
	if (version === undefined) return { kind: "failed", detail: `${join(wanted, "plugin.toml")} has no string version` };

	const pluginsDir = await cli.dir();
	if (!pluginsDir.ok) return { kind: "failed", detail: `tern plugin dir: ${pluginsDir.error.message}` };
	if ((await linkedDir(pluginsDir.value)) !== wanted) {
		const linked = await relink(cli, wanted);
		if (linked !== null) return { kind: "failed", detail: linked };
	}

	const before = await loadedVersion(cli);
	if ("detail" in before) return { kind: "failed", detail: before.detail };
	if (before.version === version) return { kind: "current", version };
	const reload = await cli.reload(TERN_PLUGIN_ID);
	const after = await loadedVersion(cli);
	if ("version" in after && after.version === version) return { kind: "reloaded", from: before.version, to: version };
	const detail = [
		"detail" in after ? after.detail : `Tern runs ${after.version ?? "no omp-ask-more plugin"}, the package has ${version}`,
		reload.ok ? "" : `tern plugin reload: ${reload.error.message}`,
	]
		.filter(Boolean)
		.join("\n");
	return { kind: "failed", detail };
}

let done: Promise<TernPluginState> | undefined;

/** Links and loads the Tern plugin once per process; later calls share the first outcome. */
export function ensureTernPlugin(): Promise<TernPluginState> {
	done ??= setup().catch((error: unknown) => ({
		kind: "failed" as const,
		detail: error instanceof Error ? error.message : String(error),
	}));
	return done;
}

/** What the user is told about the Tern plugin at session start; nothing when Tern is absent or already current. */
export function ternNotice(state: TernPluginState): { readonly text: string; readonly level: "info" | "warning" } | null {
	switch (state.kind) {
		case "absent":
		case "current":
			return null;
		case "reloaded":
			return {
				text: tr(
					`omp-ask-more: Tern plugin loaded ${state.to}${state.from === null ? "" : ` (was ${state.from})`}`,
					`omp-ask-more: Tern 插件已加载 ${state.to}${state.from === null ? "" : `（原为 ${state.from}）`}`,
				),
				level: "info",
			};
		case "failed":
			return {
				text: tr(
					`omp-ask-more: Tern's omp view shows an option's tradeoff lines run together, because its Tern plugin did not load:\n${state.detail}`,
					`omp-ask-more: Tern 插件没有加载，Tern 的 omp 视图会把选项的取舍各行连成一段：\n${state.detail}`,
				),
				level: "warning",
			};
		default: {
			const unreachable: never = state;
			return unreachable;
		}
	}
}
