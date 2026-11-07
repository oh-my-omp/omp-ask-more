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

/** The spec of a validated demo. */
export function demoSpec(demo: DemoParams): DemoSpec {
	const caption = trimmed(demo.caption);
	switch (demo.kind) {
		case "frames":
			return {
				kind: "frames",
				frames: demo.frames.map(frame => ({ body: frame.body, ...(trimmed(frame.caption) ? { caption: trimmed(frame.caption) } : {}) })),
				intervalMs: demo.interval_ms ?? DEFAULT_FRAME_MS,
				...(caption ? { caption } : {}),
			};
		case "file":
			return { kind: "file", path: demo.path.trim(), ...(caption ? { caption } : {}) };
	}
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

/** Leading bytes the ANSI page reads of an image: its type (`imageMime`) and whether it is an APNG (`isApng`). */
const HEAD_BYTES = 4096;

/**
 * An image file within the read cap: all of it for Tern, which gets the bytes, and only its head for
 * the ANSI page, where ffmpeg reads the file itself.
 */
async function readImage(absolute: string, whole: boolean): Promise<Uint8Array> {
	const info = await stat(absolute);
	if (info.isDirectory()) throw new DemoError(tr("is a directory", "是目录"));
	if (info.size > MAX_FILE_BYTES) throw new DemoError(tr(`file is larger than ${MAX_FILE_BYTES} bytes`, `文件超过 ${MAX_FILE_BYTES} 字节`));
	const length = whole ? info.size : Math.min(info.size, HEAD_BYTES);
	const handle = await open(absolute, "r");
	try {
		const bytes = new Uint8Array(length);
		await handle.read(bytes, 0, length, 0);
		return bytes;
	} finally {
		await handle.close();
	}
}

/** A PNG with an `acTL` chunk before its image data is an APNG; ffmpeg needs to be told. */
function isApng(bytes: Uint8Array): boolean {
	const text = Buffer.from(bytes.subarray(0, Math.min(bytes.length, HEAD_BYTES))).toString("latin1");
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
 * Read `stream` to the end into one buffer of `cap` bytes; `onOver` runs once when the stream
 * passes the cap, and reading stops there. The buffer's pages are committed only as bytes land in
 * them, so reserving the cap costs what the stream sends, and no chunk is held beside the copy.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, onOver: () => void): Promise<{ bytes: Uint8Array; over: boolean }> {
	const buffer = new Uint8Array(cap);
	let total = 0;
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (total + value.length > cap) {
			onOver();
			await reader.cancel();
			return { bytes: new Uint8Array(), over: true };
		}
		buffer.set(value, total);
		total += value.length;
	}
	return { bytes: buffer.subarray(0, total), over: false };
}

/** The text of the last chunks of `stream` that hold at least `cap` bytes (all of it when shorter). */
async function readTail(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
	const chunks: Uint8Array[] = [];
	/** Chunks before `first` are dropped; the array is compacted once they are half of it. */
	let first = 0;
	let total = 0;
	for await (const chunk of stream) {
		chunks.push(chunk);
		total += chunk.length;
		for (let oldest = chunks[first]; oldest !== undefined && chunks.length - first > 1 && total - oldest.length >= cap; oldest = chunks[first]) {
			total -= oldest.length;
			first++;
		}
		if (first * 2 >= chunks.length) {
			chunks.splice(0, first);
			first = 0;
		}
	}
	const decoder = new TextDecoder();
	let text = "";
	for (let index = first; index < chunks.length; index++) text += decoder.decode(chunks[index], { stream: true });
	return text + decoder.decode();
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
		const [stdout, stderr, code] = await Promise.all([readCapped(child.stdout, maxBytes, () => child.kill()), readTail(child.stderr, STDERR_TAIL), child.exited]);
		if (stdout.over) throw new DemoError(tr(`the decoded output passed ${maxBytes} bytes; use a shorter or smaller file`, `解码输出超过 ${maxBytes} 字节，换更短或更小的文件`));
		if (timedOut) throw new DemoError(tr(`decoding took longer than ${DECODE_TIMEOUT_MS / 1000} s`, `解码超过 ${DECODE_TIMEOUT_MS / 1000} 秒`));
		if (signal?.aborted) throw new DemoError(tr("aborted", "已中止"));
		if (code !== 0) throw new DemoError(stderr.trim().split("\n").at(-1) || `${argv[0]} exited with ${code}`);
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
		const bytes = video ? undefined : await readImage(absolute, surface === "native");
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

/**
 * Demos loaded at once. Each may hold a decoder's output (up to 16 MiB) and runs an ffmpeg that
 * already uses every core, so more at once adds memory and risks the decode timeout, not speed.
 */
const LOAD_CONCURRENCY = 2;

/** Every demo of every question for `surface`, at most `LOAD_CONCURRENCY` loading at a time. */
export async function loadQuestionDemos(
	questions: readonly { readonly brief: { readonly demo?: DemoParams }; readonly options: readonly { readonly demo?: DemoParams }[] }[],
	cwd: string,
	surface: Surface,
	columns: number,
	signal: AbortSignal | undefined,
): Promise<QuestionDemos[]> {
	const params = questions.flatMap(question => [question.brief.demo, ...question.options.map(option => option.demo)]);
	const loaded: (LoadedDemo | undefined)[] = new Array(params.length);
	let next = 0;
	const worker = async () => {
		for (let index = next++; index < params.length; index = next++) loaded[index] = await loadDemo(params[index], cwd, surface, columns, signal);
	};
	await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, params.length) }, worker));
	let at = 0;
	return questions.map(question => ({ question: loaded[at++], options: question.options.map(() => loaded[at++]) }));
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

/** Bytes one cell can take: `ESC[38;2;255;255;255;48;2;255;255;255m` and the three of `▀`. */
const CELL_BYTES = 39;
/** `ESC[0m`, closing every row. */
const RESET = [0x1b, 0x5b, 0x30, 0x6d] as const;

/** The row being encoded, reused for every row of every frame; grown when a wider raster comes. */
let rowBytes = new Uint8Array(MAX_ANSI_WIDTH * CELL_BYTES + RESET.length);
const rowDecoder = new TextDecoder();

/** Write `n` (0–255) in decimal at `at`; returns the index after it. */
function writeDecimal(out: Uint8Array, at: number, n: number): number {
	if (n >= 100) out[at++] = 0x30 + Math.floor(n / 100);
	if (n >= 10) out[at++] = 0x30 + (Math.floor(n / 10) % 10);
	out[at++] = 0x30 + (n % 10);
	return at;
}

/** Write `<layer>8;2;r;g;b` for the pixel at `pixel` (`layer` is `3` foreground, `4` background). */
function writeColor(out: Uint8Array, at: number, layer: 0x33 | 0x34, frame: Uint8Array, pixel: number): number {
	out[at++] = layer;
	out[at++] = 0x38;
	out[at++] = 0x3b;
	out[at++] = 0x32;
	for (let channel = 0; channel < 3; channel++) {
		out[at++] = 0x3b;
		at = writeDecimal(out, at, frame[pixel + channel] ?? 0);
	}
	return at;
}

/**
 * One RGB frame (`width` × `rows * 2` pixels) as text rows: each cell is `▀` with the upper pixel
 * as foreground and the lower as background, every row ending in a reset so no color leaks. Each
 * row is written as bytes into one reused buffer and decoded once: a string per row, nothing per cell.
 */
export function halfBlockRows(frame: Uint8Array, width: number, rows: number): string[] {
	if (rowBytes.length < width * CELL_BYTES + RESET.length) rowBytes = new Uint8Array(width * CELL_BYTES + RESET.length);
	const out = rowBytes;
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let at = 0;
		let lastFg = -1;
		let lastBg = -1;
		for (let column = 0; column < width; column++) {
			const top = (row * 2 * width + column) * 3;
			const bottom = ((row * 2 + 1) * width + column) * 3;
			const fg = ((frame[top] ?? 0) << 16) | ((frame[top + 1] ?? 0) << 8) | (frame[top + 2] ?? 0);
			const bg = ((frame[bottom] ?? 0) << 16) | ((frame[bottom + 1] ?? 0) << 8) | (frame[bottom + 2] ?? 0);
			// Each color is written only when it changes; both in one sequence when both do.
			if (fg !== lastFg || bg !== lastBg) {
				out[at++] = 0x1b;
				out[at++] = 0x5b;
				if (fg !== lastFg) at = writeColor(out, at, 0x33, frame, top);
				if (fg !== lastFg && bg !== lastBg) out[at++] = 0x3b;
				if (bg !== lastBg) at = writeColor(out, at, 0x34, frame, bottom);
				out[at++] = 0x6d;
			}
			lastFg = fg;
			lastBg = bg;
			out[at++] = 0xe2;
			out[at++] = 0x96;
			out[at++] = 0x80;
		}
		out.set(RESET, at);
		lines.push(rowDecoder.decode(out.subarray(0, at + RESET.length)));
	}
	return lines;
}
