// Media the demo benches load (oh-my-omp/omp-ask-more#3 §4), made by the system ffmpeg on first use
// and kept by name under node_modules/.cache. The lavfi sources and the noise filter are seeded, so
// every machine with the same ffmpeg makes the same bytes; the sizes put each file on the side of
// the 16 MiB read and output caps its case needs.
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO } from "./harness.ts";

export const FIXTURES = join(REPO, "node_modules", ".cache", "omp-ask-more-bench", "fixtures-1");

const CAP = 16 * 1024 * 1024;

/** A file made by ffmpeg from a lavfi source; an image names the side of the read cap its size is on. */
interface Made {
	readonly lavfi: string;
	readonly output: readonly string[];
	readonly size?: "under" | "over";
}

/** Bytes written as they are: files no decoder accepts. */
interface Written {
	readonly text: string;
}

const NOISE = "noise=alls=80:allf=t+u";
const VIDEO = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-f", "mp4"];

const FILES: Readonly<Record<string, Made | Written>> = {
	/** Animated images just under the read cap: the whole file is what the ANSI page used to read. */
	"noise-a.gif": { lavfi: "testsrc2=s=480x360:r=10:d=10", output: ["-vf", NOISE, "-f", "gif"], size: "under" },
	"noise-b.gif": { lavfi: "testsrc=s=480x360:r=10:d=10", output: ["-vf", NOISE, "-f", "gif"], size: "under" },
	"noise.apng": { lavfi: "testsrc2=s=320x240:r=10:d=7", output: ["-vf", NOISE, "-plays", "0", "-f", "apng"], size: "under" },
	"huge.gif": { lavfi: "testsrc2=s=480x360:r=10:d=13", output: ["-vf", NOISE, "-f", "gif"], size: "over" },
	/** Videos: the ANSI page decodes them to frames; Tern gets GIFs of ~11 and ~14 MB, and one past the output cap. */
	"clip-a.mp4": { lavfi: "testsrc2=s=320x240:r=24:d=15", output: ["-vf", "noise=alls=40:allf=t+u", ...VIDEO] },
	"clip-b.mp4": { lavfi: "testsrc2=s=352x264:r=24:d=15", output: ["-vf", "noise=alls=40:allf=t+u", ...VIDEO] },
	"over.mp4": { lavfi: "testsrc2=s=400x300:r=24:d=15", output: ["-vf", "noise=alls=40:allf=t+u", ...VIDEO] },
	"corrupt.mp4": { text: "not a video\n" },
	"not-image.gif": { text: "plain text named like a GIF\n" },
};

/** Make every fixture that is missing; returns the directory they are in. */
export async function ensureFixtures(): Promise<string> {
	await mkdir(FIXTURES, { recursive: true });
	for (const [name, file] of Object.entries(FILES)) {
		const path = join(FIXTURES, name);
		const present = await stat(path).then(
			() => true,
			() => false,
		);
		if (present) continue;
		const partial = `${path}.partial`;
		if ("text" in file) {
			await writeFile(partial, file.text);
		} else {
			const ffmpeg = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", file.lavfi, ...file.output, partial], { stderr: "inherit" });
			if ((await ffmpeg.exited) !== 0) throw new Error(`ffmpeg could not make ${name}`);
			const { size } = await stat(partial);
			if (file.size !== undefined && (file.size === "under") !== size <= CAP) throw new Error(`${name} is ${size} bytes, expected ${file.size} ${CAP}`);
		}
		await rename(partial, path);
	}
	return FIXTURES;
}
