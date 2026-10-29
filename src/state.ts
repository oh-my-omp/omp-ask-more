// The state both surfaces draw. One `QuestionState` per question holds everything that must survive
// switching tabs: the cursor (where the user is looking), the answer (what the user gave — a cursor is
// never an answer), the Other field and its edit mode, evidence folding, scrolling, and demo playback.
import type { Input, ScrollView } from "@oh-my-pi/pi-tui";
import type { TspScrollBy } from "@oh-my-pi/pi-wire";
import type { ResolvedEvidence } from "./brief.ts";
import type { LoadedDemo, QuestionDemos } from "./demo.ts";
import type { Answer } from "./result.ts";
import type { AskQuestion } from "./schema.ts";

/** A question page, or the review page that a batch of two or more questions ends on. */
export type ActiveTab = { readonly kind: "question"; readonly index: number } | { readonly kind: "review" };

/** A keyboard scroll request for the terminal-side scroller, bumped per key press. */
export interface NativeScrollRequest {
	readonly by: TspScrollBy;
	readonly n: number;
}

/** Where a demo is in its loop. `owner` is the option cursor the option demo plays for. */
export interface Playback {
	frame: number;
	playing: boolean;
	/** When the next frame is due (ms on `performance.now()`); 0 until the page first plays it. */
	nextAt: number;
	owner: number;
}

/** A playback at its first frame. */
export function startPlayback(owner = 0): Playback {
	return { frame: 0, playing: true, nextAt: 0, owner };
}

export interface QuestionState {
	readonly question: AskQuestion;
	readonly evidence: readonly ResolvedEvidence[];
	readonly demos: QuestionDemos;
	readonly questionPlay: Playback;
	/** The focused option's demo; restarts when the cursor moves to another option. */
	optionPlay: Playback;
	/** Row under the cursor: an option index, or `options.length` for the Other row. */
	cursor: number;
	answer: Answer;
	/** The Other field is open and takes the keys. */
	editing: boolean;
	expanded: boolean;
	/** The Other text: the only copy of it. */
	readonly input: Input;
	/** ANSI viewport over the page body. */
	readonly view: ScrollView;
	nativeScroll: NativeScrollRequest | undefined;
}

/** Which demo of a page: the question's, or the focused option's. */
export type DemoSlot = "question" | "option";

export interface PageDemo {
	readonly slot: DemoSlot;
	readonly demo: LoadedDemo;
	readonly play: Playback;
}

/**
 * The demos a question page shows: its own, and the focused option's while the Other field is
 * closed (the option demo sits in the tradeoff card). The option playback restarts when the
 * cursor has moved to another option since it last played.
 */
export function pageDemos(state: QuestionState): PageDemo[] {
	const demos: PageDemo[] = [];
	if (state.demos.question !== undefined) demos.push({ slot: "question", demo: state.demos.question, play: state.questionPlay });
	const option = state.editing ? undefined : state.demos.options[state.cursor];
	if (option !== undefined) {
		if (state.optionPlay.owner !== state.cursor) state.optionPlay = startPlayback(state.cursor);
		demos.push({ slot: "option", demo: option, play: state.optionPlay });
	}
	return demos;
}

export interface ReviewState {
	readonly view: ScrollView;
	nativeScroll: NativeScrollRequest | undefined;
}

/** True when the cursor rests on the Other row. */
export function onOther(state: QuestionState): boolean {
	return state.cursor >= state.question.options.length;
}
