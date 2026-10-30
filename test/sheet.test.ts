// The Tern sheet as the terminal sees it: every frame goes through pi-tui's Reconciler and the
// reference applier (a rejected op fails the test), and pointer events are routed from wire ids
// the way the native backend routes them, including ids of nodes the sheet has since redrawn.
import { describe, expect, it } from "bun:test";
import type { DescribeContext, NativeUiEvent } from "@oh-my-pi/pi-tui";
import { TspDocument } from "@oh-my-pi/pi-tui/native/apply";
import { Reconciler } from "@oh-my-pi/pi-tui/native/reconcile";
import type { TspNode, TspSpan, TspText } from "@oh-my-pi/pi-wire";
import { AskMoreComponent, type SheetHost, type Submission } from "../src/component.ts";
import type { LoadedDemo, QuestionDemos } from "../src/demo.ts";
import { tr } from "../src/i18n.ts";
import { encodeAct, parseAct, type SheetAct } from "../src/nodes.ts";
import { type AskQuestion, questionSchema } from "../src/schema.ts";
import type { TimeoutPolicy } from "../src/timeout.ts";

const CX: DescribeContext = { cols: 120, reduceMotion: false, dark: true, supports: () => true, feature: () => true };

/** A render clock that never fires: demos only move when a test presses their controls. */
const HOST: SheetHost = { scheduleAfter: () => ({ cancel() {} }), requestComponentRender() {}, terminal: { rows: 40 } };

/** A render clock the test moves: `advance` fires every live timer that comes due, in order. */
class Clock implements SheetHost {
	readonly terminal = { rows: 40 };
	#now = 0;
	readonly #timers: { due: number; callback: () => void; live: boolean }[] = [];

	scheduleAfter(delayMs: number, callback: () => void): { cancel(): void } {
		const timer = { due: this.#now + delayMs, callback, live: true };
		this.#timers.push(timer);
		return {
			cancel() {
				timer.live = false;
			},
		};
	}

	/** Draws the TUI was asked for: a change a timer makes reaches the screen only through one. */
	renders = 0;

	requestComponentRender(): void {
		this.renders++;
	}

	advance(ms: number): void {
		const until = this.#now + ms;
		for (;;) {
			const next = this.#timers.filter(timer => timer.live && timer.due <= until).sort((a, b) => a.due - b.due)[0];
			if (next === undefined) break;
			next.live = false;
			this.#now = next.due;
			next.callback();
		}
		this.#now = until;
	}
}

interface Timing {
	readonly host?: SheetHost;
	readonly timeout?: TimeoutPolicy;
	readonly notify?: (due: Date | undefined) => void;
}

const UP = "\x1b[A";
const DOWN = "\x1b[B";

function question(id: string, labels: readonly string[]): AskQuestion {
	return questionSchema.parse({
		id,
		header: id,
		question: `Pick ${id}`,
		brief: { where: "now", what: "decide", how: "after" },
		options: labels.map(label => ({ label, tradeoff: `${label} costs` })),
	});
}

function frames(...bodies: string[]): LoadedDemo {
	return { kind: "frames", frames: bodies.map(body => ({ body })), intervalMs: 1000 };
}

function findAll(root: TspNode, test: (node: TspNode) => boolean): TspNode[] {
	const found: TspNode[] = [];
	const visit = (node: TspNode): void => {
		if (test(node)) found.push(node);
		for (const child of node.c ?? []) visit(child);
	};
	visit(root);
	return found;
}

function only(root: TspNode, test: (node: TspNode) => boolean): TspNode {
	const found = findAll(root, test);
	if (found.length !== 1) throw new Error(`expected one node, found ${found.length}`);
	return found[0] as TspNode;
}

const withRole = (role: string) => (node: TspNode) => node.p?.role === role;

function plain(text: TspText | undefined): string {
	if (text === undefined) return "";
	return typeof text === "string" ? text : text.map((span: TspSpan) => span.t).join("");
}

/** The text a node shows: its own text or spans, else its children's. */
function textOf(node: TspNode): string {
	if (node.k === "text") return node.p?.text ?? plain(node.p?.spans);
	return (node.c ?? []).map(textOf).join("");
}

/** The act a button node sends on click, or undefined for any other node. */
function actOf(node: TspNode): SheetAct | undefined {
	if (node.k !== "row" || node.p?.role !== "omp.btn") return undefined;
	const click = node.p.actions?.click;
	return click === undefined ? undefined : parseAct(click);
}

class Sheet {
	readonly submissions: Submission[] = [];
	readonly component: AskMoreComponent;
	readonly #reconciler = new Reconciler("ask");
	readonly #document = new TspDocument("ask");
	#seq = 0;

	constructor(questions: readonly AskQuestion[], demos: readonly QuestionDemos[] = [], timing: Timing = {}) {
		this.component = new AskMoreComponent({
			tui: timing.host ?? HOST,
			questions,
			evidence: questions.map(() => []),
			demos,
			finish: submission => this.submissions.push(submission),
			timeout: timing.timeout ?? { kind: "off" },
			notify: timing.notify ?? (() => {}),
		});
	}

	/** One frame through the reconciler and the reference applier, which must accept every op. */
	frame(): TspNode {
		const ops = this.#reconciler.reconcile({ main: [], dock: [], layer: [this.component] }, CX);
		expect(this.#document.applyFrame({ sf: "ask", s: ++this.#seq, ops })).toEqual([]);
		return this.#document.snapshot();
	}

	/** The one button of the current frame whose act passes `test`. */
	button(test: (act: SheetAct) => boolean): TspNode {
		return only(this.frame(), node => {
			const act = actOf(node);
			return act !== undefined && test(act);
		});
	}

	/** The options list of the current page. */
	list(): TspNode {
		return only(this.frame(), withRole("omp.ask.options"));
	}

	/** The item key the list's selection resolves to. */
	selected(list: TspNode): string | undefined {
		const selected = list.k === "list" ? list.p?.selected : undefined;
		return typeof selected === "string" ? this.#reconciler.itemKey(selected) : undefined;
	}

	/** A click on a button node, possibly one the sheet has since redrawn. */
	click(button: TspNode): void {
		const act = button.k === "row" ? button.p?.actions?.click : undefined;
		if (act === undefined) throw new Error(`${button.id} has no click action`);
		this.#send({ type: "action", key: this.#keypath(button.id), act, mods: [] });
	}

	/** A click (`select`) or double click (`activate`) on item `itemKey` of `list`. */
	pick(type: "select" | "activate", list: TspNode, itemKey: string): void {
		const item = (list.c ?? []).find(child => this.#reconciler.itemKey(child.id) === itemKey);
		if (item === undefined) throw new Error(`no item ${itemKey}`);
		this.#send({ type, key: this.#keypath(list.id), item: this.#reconciler.itemKey(item.id) });
	}

	/** A click on a question tab. */
	tab(id: string): void {
		const tabs = only(this.frame(), withRole("omp.ask.questions"));
		this.#send({ type: "select", key: this.#keypath(tabs.id), item: id });
	}

	key(data: string): void {
		this.component.handleInput(data);
	}

	/** The terminal typing `text` into the open Other field, as Tern sends it: to the field, not the sheet. */
	typeIntoField(text: string): void {
		const row = only(this.frame(), withRole("omp.ask.otherField"));
		const field = (row.c ?? [])[0];
		if (field === undefined) throw new Error("the Other field row is empty");
		const target = this.#reconciler.target(field.id);
		if (target === null) throw new Error(`${field.id} routes nowhere`);
		target.component.handleNativeEvent?.({ type: "edit", key: target.keypath, from: 0, to: 0, text, cursor: text.length, len: 0 });
	}

	/** The countdown line: the text before the action bar's buttons, if the sheet shows one. */
	countdown(): string | undefined {
		const first = (only(this.frame(), withRole("omp.actions")).c ?? [])[0];
		return first?.k === "text" ? textOf(first) : undefined;
	}

	/** Review, then Submit: the answers the sheet hands back. */
	submitFromReview(): readonly Submission[] {
		this.tab("review");
		this.click(this.button(act => act.kind === "submit"));
		return this.submissions;
	}

	#keypath(id: string): string {
		const target = this.#reconciler.target(id);
		if (target === null || target.component !== this.component) throw new Error(`${id} is not the sheet's`);
		return target.keypath;
	}

	#send(event: NativeUiEvent): void {
		this.component.handleNativeEvent(event);
	}
}

const isAnswer = (act: SheetAct) => act.kind === "answer";

describe("sheet acts", () => {
	it("reads back every act from the id its button sends", () => {
		const acts: readonly SheetAct[] = [
			{ kind: "cancel" },
			{ kind: "submit" },
			{ kind: "answer", page: 3, option: 12 },
			{ kind: "openOther", page: 0 },
			{ kind: "saveOther", page: 7 },
			{ kind: "demo", page: 1, target: { slot: "question" }, move: "toggle" },
			{ kind: "demo", page: 2, target: { slot: "option", option: 4 }, move: "prev" },
		];
		for (const act of acts) expect(parseAct(encodeAct(act))).toEqual(act);
	});

	it("names no act for an id missing a part, carrying an extra one, or with a non-index", () => {
		for (const id of ["answer:1", "answer:1:2:3", "answer:-1:0", "answer:1:x", "submit:0", "other", "demo:0:option:next", "demo:0:question:spin", "enter"]) {
			expect(parseAct(id)).toBeUndefined();
		}
	});
});

describe("Tern sheet styling contract", () => {
	it("stays outside omp.overlay.*, whose list rule draws the option marks over their labels", () => {
		const sheet = new Sheet([question("a", ["x", "y"])]);
		expect(sheet.component.nativeOverlay.role?.startsWith("omp.overlay.")).toBe(false);
	});

	it("marks the chosen answer on the native ask list while the cursor rests on another row", () => {
		const sheet = new Sheet([question("a", ["x", "y", "z"]), question("b", ["p", "q"])]);
		sheet.pick("activate", sheet.list(), "option:1");
		sheet.tab("0");
		sheet.key(UP);
		const list = sheet.list();
		const items = list.c ?? [];
		expect(items.map(item => item.p?.role)).toEqual(["omp.ask.option", "omp.ask.option", "omp.ask.option", "omp.ask.other"]);
		expect(items.map(item => item.p?.tone)).toEqual([undefined, "accent", undefined, undefined]);
		expect(sheet.selected(list)).toBe("option:0");
	});

	it("draws the question tabs in the native ask head, with a check on answered questions", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		sheet.pick("activate", sheet.list(), "option:0");
		const head = only(sheet.frame(), withRole("omp.ask.head"));
		const tabs = only(head, withRole("omp.ask.questions"));
		const labels = tabs.k === "tabs" ? (tabs.p?.items ?? []).map(item => plain(item.label)) : [];
		expect(labels).toEqual(["✓ a", "b", tr("Review", "汇总")]);
	});

	it("opens the review with the native notice and no question heading", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		sheet.pick("activate", sheet.list(), "option:0");
		sheet.tab("review");
		const root = sheet.frame();
		expect(textOf(only(root, withRole("omp.ask.notice")))).toStartWith("1 ");
		expect(findAll(root, withRole("omp.ask.question"))).toEqual([]);
	});
});

describe("Tern sheet events", () => {
	it("moves the cursor on a click and answers on a double click", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		sheet.pick("select", sheet.list(), "option:1");
		const list = sheet.list();
		expect(sheet.selected(list)).toBe("option:1");
		expect((list.c ?? []).map(item => item.p?.tone)).toEqual([undefined, undefined, undefined]);
		sheet.pick("activate", list, "option:1");
		expect(sheet.submitFromReview()).toEqual([{ kind: "submit", answers: [{ kind: "option", index: 1 }, { kind: "unanswered" }] }]);
	});

	it("ignores a double click on the list of a question already left", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		const first = sheet.list();
		sheet.pick("activate", first, "option:0");
		sheet.pick("activate", first, "option:1");
		expect(sheet.submitFromReview()).toEqual([{ kind: "submit", answers: [{ kind: "option", index: 0 }, { kind: "unanswered" }] }]);
	});

	it("does not answer the next question with a second click on Next", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		const next = sheet.button(isAnswer);
		sheet.click(next);
		sheet.click(next);
		expect(sheet.submitFromReview()).toEqual([{ kind: "submit", answers: [{ kind: "option", index: 0 }, { kind: "unanswered" }] }]);
	});

	it("does not answer with a Next drawn before the cursor moved", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		const next = sheet.button(isAnswer);
		sheet.key(DOWN);
		sheet.frame();
		sheet.click(next);
		expect(sheet.submitFromReview()).toEqual([{ kind: "submit", answers: [{ kind: "unanswered" }, { kind: "unanswered" }] }]);
	});

	it("keeps the Other field open when a Next drawn before it opened arrives, and saves with its own button", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		const next = sheet.button(isAnswer);
		sheet.key("o");
		for (const char of "mine") sheet.key(char);
		sheet.click(next);
		sheet.click(sheet.button(act => act.kind === "saveOther"));
		expect(sheet.submitFromReview()).toEqual([{ kind: "submit", answers: [{ kind: "custom", text: "mine" }, { kind: "unanswered" }] }]);
	});

	it("leaves the focused option's demo alone when a control drawn for the previous option arrives", () => {
		const demos: QuestionDemos[] = [{ question: undefined, options: [frames("x1", "x2"), frames("y1", "y2")] }];
		const sheet = new Sheet([question("a", ["x", "y"])], demos);
		const counter = () => textOf(only(sheet.frame(), node => node.k === "text" && /^\d+\/2$/.test(textOf(node))));
		const isNextFrame = (act: SheetAct) => act.kind === "demo" && act.move === "next";
		const stale = sheet.button(isNextFrame);
		sheet.key(DOWN);
		sheet.click(stale);
		expect(counter()).toBe("1/2");
		sheet.click(sheet.button(isNextFrame));
		expect(counter()).toBe("2/2");
	});

	it("submits only from the review", () => {
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])]);
		sheet.tab("review");
		const submit = sheet.button(act => act.kind === "submit");
		sheet.tab("0");
		sheet.click(submit);
		expect(sheet.submissions).toEqual([]);
	});

	it("cancels once, however often Cancel all is clicked", () => {
		const sheet = new Sheet([question("a", ["x", "y"])]);
		const cancel = sheet.button(act => act.kind === "cancel");
		sheet.click(cancel);
		sheet.click(cancel);
		expect(sheet.submissions).toEqual([{ kind: "cancel" }]);
	});
});

const MIN = 60_000;
const DECIDE: TimeoutPolicy = { kind: "decide", idleMs: 30 * MIN };
const NOTIFY_THEN_DECIDE: TimeoutPolicy = { kind: "notify", idleMs: 30 * MIN, channels: [{ kind: "terminal" }], then: { kind: "decide", returnMs: 20 * MIN } };
const NOTIFY_THEN_WAIT: TimeoutPolicy = { kind: "notify", idleMs: 30 * MIN, channels: [{ kind: "terminal" }], then: { kind: "wait" } };
const ENTER = "\r";

describe("countdown", () => {
	it("hands the answers given so far back, the rest unanswered, when nobody acts", () => {
		const clock = new Clock();
		const sheet = new Sheet([question("a", ["x", "y"]), question("b", ["p", "q"])], [], { host: clock, timeout: DECIDE });
		sheet.key(ENTER);
		clock.advance(30 * MIN - 1);
		expect(sheet.submissions).toEqual([]);
		clock.advance(1);
		expect(sheet.submissions).toEqual([{ kind: "timeout", answers: [{ kind: "option", index: 0 }, { kind: "unanswered" }] }]);
	});

	it("starts over on any key", () => {
		const clock = new Clock();
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: DECIDE });
		clock.advance(29 * MIN);
		sheet.key(DOWN);
		clock.advance(29 * MIN);
		expect(sheet.submissions).toEqual([]);
		clock.advance(MIN);
		expect(sheet.submissions.map(submission => submission.kind)).toEqual(["timeout"]);
	});

	it("starts over when the terminal edits the Other field", () => {
		const clock = new Clock();
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: DECIDE });
		sheet.key("o");
		clock.advance(29 * MIN);
		sheet.typeIntoField("draft");
		clock.advance(29 * MIN);
		expect(sheet.submissions).toEqual([]);
	});

	it("notifies once, says so on the sheet, and hands over when the return window ends", () => {
		const clock = new Clock();
		const dues: (Date | undefined)[] = [];
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: NOTIFY_THEN_DECIDE, notify: due => dues.push(due) });
		const idle = sheet.countdown();
		expect(idle).toBeDefined();
		const rendersBefore = clock.renders;
		clock.advance(30 * MIN);
		expect(dues).toHaveLength(1);
		expect(clock.renders).toBeGreaterThan(rendersBefore);
		expect(Math.abs((dues[0]?.getTime() ?? 0) - Date.now() - 20 * MIN)).toBeLessThan(5000);
		expect(sheet.countdown()).not.toBe(idle);
		expect(sheet.submissions).toEqual([]);
		clock.advance(20 * MIN);
		expect(sheet.submissions).toEqual([{ kind: "timeout", answers: [{ kind: "unanswered" }] }]);
		expect(dues).toHaveLength(1);
	});

	it("goes back to the first countdown when the user returns after the notification", () => {
		const clock = new Clock();
		let notified = 0;
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: NOTIFY_THEN_DECIDE, notify: () => notified++ });
		const idle = sheet.countdown();
		clock.advance(30 * MIN);
		sheet.key(DOWN);
		expect(sheet.countdown()).toBe(idle);
		clock.advance(20 * MIN);
		expect(sheet.submissions).toEqual([]);
		clock.advance(10 * MIN);
		expect(notified).toBe(2);
	});

	it("keeps waiting after the notification when the expiry is wait", () => {
		const clock = new Clock();
		let notified = 0;
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: NOTIFY_THEN_WAIT, notify: () => notified++ });
		clock.advance(30 * MIN);
		clock.advance(24 * 60 * MIN);
		expect(notified).toBe(1);
		expect(sheet.submissions).toEqual([]);
	});

	it("returns only the answer when the user answers before the deadline", () => {
		const clock = new Clock();
		let notified = 0;
		const sheet = new Sheet([question("a", ["x", "y"])], [], { host: clock, timeout: NOTIFY_THEN_DECIDE, notify: () => notified++ });
		sheet.key(ENTER);
		clock.advance(60 * MIN);
		expect(sheet.submissions).toEqual([{ kind: "submit", answers: [{ kind: "option", index: 0 }] }]);
		expect(notified).toBe(0);
	});

	it("shows no countdown line when timing is off", () => {
		expect(new Sheet([question("a", ["x", "y"])]).countdown()).toBeUndefined();
	});
});
