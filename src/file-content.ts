import { open } from "node:fs/promises";
import { parseImageMetadata } from "@oh-my-pi/pi-utils";

const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const SNIFF_BYTES = 4096;
const RASTER_HEAD_BYTES = 64;

export type FileContent = "picture" | "text" | "binary";

function isText(head: Uint8Array): boolean {
	if (head.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
		return true;
	} catch {
		return false;
	}
}

function isPicture(head: Uint8Array, text: boolean): boolean {
	if (parseImageMetadata(head.subarray(0, RASTER_HEAD_BYTES))) return true;
	return text && /<svg[\s>]/i.test(new TextDecoder().decode(head));
}

export async function sniffFile(absolute: string, size: number): Promise<FileContent> {
	const handle = await open(absolute, "r");
	try {
		const buffer = new Uint8Array(SNIFF_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
		const head = buffer.subarray(0, bytesRead);
		const text = isText(head);
		if (size <= MAX_PICTURE_BYTES && isPicture(head, text)) return "picture";
		return text ? "text" : "binary";
	} finally {
		await handle.close();
	}
}
