import { tr } from "../omomp-shared/i18n.ts";

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function fileErrorText(error: unknown): string {
	const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
	return missing ? tr("file not found", "文件不存在") : errorText(error);
}
