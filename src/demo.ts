// Demos: an animation the model writes (Markdown frames) or a file it names (an animation or a
// video). The validated parameters become a `DemoSpec`, and loading turns a spec into what the
// active surface plays. Tern animates GIF/APNG/WebP images itself, so a file goes there as image
// bytes (a video converted to a GIF first); the ANSI page draws decoded RGB frames as half-block
// text rows, which scroll and clip like any other row. Files are decoded by the system ffmpeg,
// as omp's own video attachments are. A file that cannot be loaded is drawn as an error, never fatal.
import { open, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tr } from "./i18n.ts";
import { DEFAULT_FRAME_MS, DEMO_VIDEO_EXTENSIONS, type DemoParams, extensionOf } from "./schema.ts";

export interface DemoFrame {
	readonly body: string;
	readonly caption?: string;
}

/** A validated demo: exactly one source. */
export type DemoSpec =
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[]; readonly intervalMs: number; readonly caption?: string }
	| { readonly kind: "file"; readonly path: string; readonly caption?: string };

/** What a surface plays. */
export type LoadedDemo =
	| { readonly kind: "frames"; readonly frames: readonly DemoFrame[]; readonly intervalMs: number; readonly caption?: string }
	/** Tern: image bytes it animates on its own. */
	| { readonly kind: "image"; readonly path: string; readonly bytes: Uint8Array; readonly mime: string; readonly caption?: string }
	/** ANSI: RGB frames, `width` × `rows * 2` pixels each, played at `intervalMs`. */
	| {
			readonly kind: "raster";
			readonly path: string;
			readonly width: number;
			readonly rows: number;
			readonly frames: readonly Uint8Array[];
			readonly intervalMs: number;
			readonly caption?: string;
	  }
	| { readonly kind: "error"; readonly path: string; readonly error: string; readonly caption?: string };

/** The demos of one question: its own, and one slot per option. */
export interface QuestionDemos {
	readonly question: LoadedDemo | undefined;
	readonly options: readonly (LoadedDemo | undefined)[];
}

export type Surface = "native" | "ansi";

/** Largest file read, and largest GIF a video converts to. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** ANSI playback: frames per second, and the seconds of a file decoded. */
const ANSI_FPS = 10;
const MAX_SECONDS = 15;
/** ANSI raster bounds in cells; each cell is two pixels tall. */
const MAX_ANSI_WIDTH = 64;
const MIN_ANSI_WIDTH = 16;
const MAX_ANSI_ROWS = 20;
/** A video converted for Tern: width cap and frame rate. */
const NATIVE_VIDEO_WIDTH = 720;
const NATIVE_VIDEO_FPS = 12;
/** One ffmpeg or ffprobe run. */
const DECODE_TIMEOUT_MS = 20_000;

function trimmed(value: string | undefined): string | undefined {
	const text = value?.trim();
	return text ? text : undefined;
}

/** The spec of a validated demo (`validate` has checked that exactly one source is given). */
export function demoSpec(demo: DemoParams): DemoSpec {
	const caption = trimmed(demo.caption);
	if (demo.frames !== undefined) {
		return {
			kind: "frames",
			frames: demo.frames.map(frame => ({ body: frame.body, ...(trimmed(frame.caption) ? { caption: trimmed(frame.caption) } : {}) })),
			intervalMs: demo.interval_ms ?? DEFAULT_FRAME_MS,
			...(caption ? { caption } : {}),
		};
	}
	return { kind: "file", path: (demo.path ?? "").trim(), ...(caption ? { caption } : {}) };
}

class DemoError extends Error {}

/** The image type the leading bytes name, or undefined for anything Tern cannot animate. */
function imageMime(head: Uint8Array): string | undefined {
	const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
	if (ascii(0, 4) === "GIF8") return "image/gif";
	if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	return undefined;
}

async function readBounded(absolute: string): Promise<Uint8Array> {
	const info = await stat(absolute);
	if (info.isDirectory()) throw new DemoError(tr("is a directory", "是目录"));
	if (info.size > MAX_FILE_BYTES) throw new DemoError(tr(`file is larger than ${MAX_FILE_BYTES} bytes`, `文件超过 ${MAX_FILE_BYTES} 字节`));
	const handle = await open(absolute, "r");
	try {
		const bytes = new Uint8Array(info.size);
		await handle.read(bytes, 0, info.size, 0);
		return bytes;
	} finally {
		await handle.close();
	}
}

/** A PNG with an `acTL` chunk before its image data is an APNG; ffmpeg needs to be told. */
function isApng(bytes: Uint8Array): boolean {
	const text = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString("latin1");
	const actl = text.indexOf("acTL");
	const idat = text.indexOf("IDAT");
	return actl >= 0 && (idat < 0 || actl < idat);
}

function binary(name: "ffmpeg" | "ffprobe"): string {
	const found = Bun.which(name);
	if (!found) throw new DemoError(tr(`needs ${name} on PATH to play this file`, `播放这个文件需要 PATH 里有 ${name}`));
	return found;
}

/** ffprobe prints one `WxH` line; anything longer is not that. */
const PROBE_BYTES = 4096;

/** Bytes of stderr kept for the error message: its tail. */
const STDERR_TAIL = 4096;

/**
 * Read `stream` to the end, keeping at most `cap` bytes; `onOver` runs once when the stream
 * passes the cap, and reading stops there. `tail` keeps the last bytes instead of failing.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, mode: "fail" | "tail", onOver: () => void): Promise<{ bytes: Uint8Array; over: boolean }> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
		if (total <= cap) continue;
		if (mode === "fail") {
			onOver();
			await reader.cancel();
			return { bytes: new Uint8Array(), over: true };
		}
		while (total - (chunks[0]?.length ?? 0) >= cap && chunks.length > 1) total -= chunks.shift()?.length ?? 0;
	}
	return { bytes: Buffer.concat(chunks), over: false };
}

/**
 * Run a media tool without a shell; stdout on success, a readable error otherwise. Killed on
 * abort, on timeout, and as soon as stdout passes `maxBytes`, so no run outgrows its bounds.
 */
async function run(argv: readonly string[], maxBytes: number, signal: AbortSignal | undefined): Promise<Uint8Array> {
	if (signal?.aborted) throw new DemoError(tr("aborted", "已中止"));
	const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, DECODE_TIMEOUT_MS);
	const onAbort = () => child.kill();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const [stdout, stderr, code] = await Promise.all([
			readCapped(child.stdout, maxBytes, "fail", () => child.kill()),
			readCapped(child.stderr, STDERR_TAIL, "tail", () => {}),
			child.exited,
		]);
		if (stdout.over) throw new DemoError(tr(`the decoded output passed ${maxBytes} bytes; use a shorter or smaller file`, `解码输出超过 ${maxBytes} 字节，换更短或更小的文件`));
		if (timedOut) throw new DemoError(tr(`decoding took longer than ${DECODE_TIMEOUT_MS / 1000} s`, `解码超过 ${DECODE_TIMEOUT_MS / 1000} 秒`));
		if (signal?.aborted) throw new DemoError(tr("aborted", "已中止"));
		if (code !== 0) throw new DemoError(new TextDecoder().decode(stderr.bytes).trim().split("\n").at(-1) || `${argv[0]} exited with ${code}`);
		return stdout.bytes;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

function inputArgs(absolute: string, apng: boolean): string[] {
	return [...(apng ? ["-f", "apng"] : []), "-t", String(MAX_SECONDS), "-i", absolute];
}

/** Pixel size of the first video stream. */
async function probeSize(absolute: string, apng: boolean, signal: AbortSignal | undefined): Promise<{ width: number; height: number }> {
	const out = await run(
		[binary("ffprobe"), "-v", "error", ...(apng ? ["-f", "apng"] : []), "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", absolute],
		PROBE_BYTES,
		signal,
	);
	const match = /(\d+)x(\d+)/.exec(new TextDecoder().decode(out));
	const width = Number(match?.[1]);
	const height = Number(match?.[2]);
	if (!(width > 0 && height > 0)) throw new DemoError(tr("no picture in this file", "文件里没有画面"));
	return { width, height };
}

/** Raster size in cells for a picture: as wide as the page allows, two pixels per row. */
export function rasterSize(width: number, height: number, columns: number): { width: number; rows: number } {
	let cells = Math.max(MIN_ANSI_WIDTH, Math.min(MAX_ANSI_WIDTH, columns));
	let rows = Math.max(1, Math.round((cells * height) / width / 2));
	if (rows > MAX_ANSI_ROWS) {
		rows = MAX_ANSI_ROWS;
		cells = Math.max(1, Math.round((rows * 2 * width) / height));
	}
	return { width: cells, rows };
}

async function loadRaster(absolute: string, bytes: Uint8Array | undefined, columns: number, signal: AbortSignal | undefined): Promise<{ width: number; rows: number; frames: Uint8Array[] }> {
	const apng = bytes !== undefined && imageMime(bytes) === "image/png" && isApng(bytes);
	const source = await probeSize(absolute, apng, signal);
	const size = rasterSize(source.width, source.height, columns);
	const frameBytes = size.width * size.rows * 2 * 3;
	const out = await run(
		[
			binary("ffmpeg"),
			"-hide_banner",
			"-loglevel",
			"error",
			...inputArgs(absolute, apng),
			"-vf",
			`fps=${ANSI_FPS},scale=${size.width}:${size.rows * 2}:flags=area`,
			"-frames:v",
			String(ANSI_FPS * MAX_SECONDS),
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		frameBytes * ANSI_FPS * MAX_SECONDS,
		signal,
	);
	const frames: Uint8Array[] = [];
	for (let offset = 0; offset + frameBytes <= out.length; offset += frameBytes) frames.push(out.subarray(offset, offset + frameBytes));
	if (frames.length === 0) throw new DemoError(tr("no frames decoded", "没有解出画面"));
	return { ...size, frames };
}

/** A video as an animated GIF Tern can play inline. */
async function videoToGif(absolute: string, signal: AbortSignal | undefined): Promise<Uint8Array> {
	const out = await run(
		[
			binary("ffmpeg"),
			"-hide_banner",
			"-loglevel",
			"error",
			...inputArgs(absolute, false),
			"-vf",
			// A palette per frame streams: one palette for the whole clip would hold every frame until the input ends.
			`fps=${NATIVE_VIDEO_FPS},scale='min(${NATIVE_VIDEO_WIDTH},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1:dither=bayer`,
			"-loop",
			"0",
			"-f",
			"gif",
			"pipe:1",
		],
		MAX_FILE_BYTES,
		signal,
	);
	if (out.length === 0) throw new DemoError(tr("no frames decoded", "没有解出画面"));
	return out;
}

async function loadFile(spec: Extract<DemoSpec, { kind: "file" }>, cwd: string, surface: Surface, columns: number, signal: AbortSignal | undefined): Promise<LoadedDemo> {
	const caption = spec.caption ? { caption: spec.caption } : {};
	const absolute = isAbsolute(spec.path) ? spec.path : resolve(cwd, spec.path);
	const video = (DEMO_VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(spec.path));
	try {
		const bytes = video ? undefined : await readBounded(absolute);
		if (video) await stat(absolute);
		if (bytes !== undefined && imageMime(bytes) === undefined) throw new DemoError(tr("not a GIF, PNG or WebP image", "不是 GIF、PNG 或 WebP 图片"));
		if (surface === "native") {
			if (bytes !== undefined) return { kind: "image", path: spec.path, bytes, mime: imageMime(bytes) ?? "image/gif", ...caption };
			return { kind: "image", path: spec.path, bytes: await videoToGif(absolute, signal), mime: "image/gif", ...caption };
		}
		const raster = await loadRaster(absolute, bytes, columns, signal);
		return { kind: "raster", path: spec.path, ...raster, intervalMs: 1000 / ANSI_FPS, ...caption };
	} catch (error) {
		const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
		const reason = missing ? tr("file not found", "文件不存在") : error instanceof Error ? error.message : String(error);
		return { kind: "error", path: spec.path, error: reason, ...caption };
	}
}

export async function loadDemo(
	demo: DemoParams | undefined,
	cwd: string,
	surface: Surface,
	columns: number,
	signal: AbortSignal | undefined,
): Promise<LoadedDemo | undefined> {
	if (demo === undefined) return undefined;
	const spec = demoSpec(demo);
	switch (spec.kind) {
		case "frames":
			return spec;
		case "file":
			return loadFile(spec, cwd, surface, columns, signal);
	}
}

/** Every demo of every question, loaded in parallel for `surface`. */
export function loadQuestionDemos(
	questions: readonly { readonly brief: { readonly demo?: DemoParams }; readonly options: readonly { readonly demo?: DemoParams }[] }[],
	cwd: string,
	surface: Surface,
	columns: number,
	signal: AbortSignal | undefined,
): Promise<QuestionDemos[]> {
	return Promise.all(
		questions.map(async question => ({
			question: await loadDemo(question.brief.demo, cwd, surface, columns, signal),
			options: await Promise.all(question.options.map(option => loadDemo(option.demo, cwd, surface, columns, signal))),
		})),
	);
}

/** Frames a demo cycles through; 1 for a demo the sheet does not animate itself. */
export function frameCount(demo: LoadedDemo): number {
	switch (demo.kind) {
		case "frames":
		case "raster":
			return demo.frames.length;
		case "image":
		case "error":
			return 1;
	}
}

/** Time per frame of a demo the sheet animates. */
export function frameInterval(demo: LoadedDemo): number | undefined {
	switch (demo.kind) {
		case "frames":
		case "raster":
			return demo.intervalMs;
		case "image":
		case "error":
			return undefined;
	}
}

/**
 * One RGB frame (`width` × `rows * 2` pixels) as text rows: each cell is `▀` with the upper pixel
 * as foreground and the lower as background, every row ending in a reset so no color leaks.
 */
export function halfBlockRows(frame: Uint8Array, width: number, rows: number): string[] {
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = "";
		let lastFg = "";
		let lastBg = "";
		for (let column = 0; column < width; column++) {
			const top = (row * 2 * width + column) * 3;
			const bottom = ((row * 2 + 1) * width + column) * 3;
			const fg = `38;2;${frame[top]};${frame[top + 1]};${frame[top + 2]}`;
			const bg = `48;2;${frame[bottom]};${frame[bottom + 1]};${frame[bottom + 2]}`;
			// Each color is written only when it changes; both in one sequence when both do.
			const changed = [fg === lastFg ? "" : fg, bg === lastBg ? "" : bg].filter(part => part !== "");
			if (changed.length > 0) line += `\x1b[${changed.join(";")}m`;
			lastFg = fg;
			lastBg = bg;
			line += "▀";
		}
		lines.push(`${line}\x1b[0m`);
	}
	return lines;
}
