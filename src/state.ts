// The state both surfaces draw. One `QuestionState` per question holds everything that must survive
// switching tabs: the cursor (where the user is looking), the answer (what the user gave — a cursor is
// never an answer), the Other field and its edit mode, evidence folding and scrolling.
import type { Input, ScrollView } from "@oh-my-pi/pi-tui";
import type { TspScrollBy } from "@oh-my-pi/pi-wire";
import type { ResolvedEvidence } from "./brief.ts";
import type { Answer } from "./result.ts";
import type { AskQuestion } from "./schema.ts";

/** A question page, or the review page that a batch of two or more questions ends on. */
export type ActiveTab = { readonly kind: "question"; readonly index: number } | { readonly kind: "review" };

/** A keyboard scroll request for the terminal-side scroller, bumped per key press. */
export interface NativeScrollRequest {
	readonly by: TspScrollBy;
	readonly n: number;
}

export interface QuestionState {
	readonly question: AskQuestion;
	readonly evidence: readonly ResolvedEvidence[];
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

export interface ReviewState {
	readonly view: ScrollView;
	nativeScroll: NativeScrollRequest | undefined;
}

/** True when the cursor rests on the Other row. */
export function onOther(state: QuestionState): boolean {
	return state.cursor >= state.question.options.length;
}
