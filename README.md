# omp-ask-more

English | [简体中文](README.zh-CN.md)

An OMP plugin that replaces the native `ask` tool and makes it the one place where the agent puts a decision to you. Every question comes with what exists now, what is being decided and what follows; every option with its tradeoff; and the whole batch is shown to you as one form by omp's own `ask`, so it looks and behaves like any other omp form. The answer reaches the model in the native shape, so tools that read the session work unchanged.

Status: **implemented, v0.1.15**, verified on omp 19.0.0 ([verification](docs/verification.md)). How it is built: [design](docs/design.md).

## Why

The native `ask` asks the model for one HTML form, but its prompt keeps questions terse: short labels, one line of context. Models do not use it to say things plainly, so decisions get made in chat: skills that "grill" the user ask in prose because they cannot count on an ask tool.

This plugin requires every question to carry where/what/how and every option its tradeoff, invites real file lines, quoted output, diagrams and demo pictures, and compiles all of it into the form omp shows you. Its `xd://ask/routing` topic tells the model to put every question it needs the user to answer through `ask`, including the ones a skill tells it to ask in chat, and a skill the user invokes reaches the model with the same rule at its end; whether a model follows it depends on the model ([Known limitations](#known-limitations)).

## Install

```sh
omp plugin install https://github.com/oh-my-omp/omp-ask-more#release
```

`#release` is the release channel: `main` carries the work in progress, and a daily release run turns it into a version. Each version's changes are in [`CHANGELOG.md`](CHANGELOG.md), which omp shows as What's New after an update.

For local development, `omp plugin link /path/to/omp-ask-more`. Nothing needs configuring: the [readability check](#readability-check) has a default, and the timeout and notification are omp's own ([Timeout and notification](#timeout-and-notification)). Keep the native `ask` enabled; ask-more shows its questions through it.

## Releases

A pull request adds its entries under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) and leaves the version alone; commits are made with [lgit](https://github.com/can1357/llm-git), which writes them. The release run gives that section a version and a date, bumps `package.json`, and moves the `release` branch and the version tag to the new commit. It runs every day at 02:00 GMT+9 and can also be started by hand; with nothing under `## [Unreleased]` it publishes nothing.

## UI language

Ask-more runs on OMP, not Pi. The labels it puts into the form (Where, What, How, Evidence, Options and the rest) and its warnings resolve their language when the text is generated:

1. `OMOMP_LANG`, trimmed and case-insensitive, if it is `en` or `zh`.
2. The first nonempty, trimmed value of `LC_ALL`, `LC_MESSAGES`, then `LANG`: a case-insensitive `zh` prefix means Chinese; anything else means English.
3. English.

Environment variables are read on each resolution. Text sent to the model stays English.

## What you see

One form for the whole call, one section per question:

- the question's title, then **Where** (what exists now), **What** (what is being decided) and **How** (what follows from each answer);
- the **Evidence**, of two kinds: lines of a file, which ask-more reads itself when the ask opens, so what you read is the file with its line numbers, not the model's copy of it; and text the model quotes from elsewhere (a command's output, a page, a log), headed by the source the model names and marked as not read by ask-more. A file that cannot be read shows its reason and does not block the ask;
- the Mermaid **Diagram**, drawn as text, and the **Risks**;
- the question's demo picture;
- the **Options**, each with its tradeoff, the recommended one marked "(recommended)", then **Holds when** and **Cost** where the model gave them, and each option's demo picture;
- the question, and its choices: every option, plus omp's own "Other" for an answer in your words.

No choice is selected for you: the recommendation is only marked, so you pick every answer yourself. Keys, scrolling, notes on an option and submitting are those of omp's own form. Where omp has no form dialog (an RPC client, for instance), it asks one question at a time, each with its section's text as context.

If you send a message while the form is open, the form closes, the call ends as interrupted with the answers you gave so far, and your message reaches the model next. Cancelling the form stops the turn.

### Demos

A demo shows behaviour over time: on the question for how things behave now, on an option for the result of picking it. A demo is an image file (GIF, PNG, APNG or WebP) the form shows as a picture, with a caption saying what to watch.

## Timeout and notification

The timeout and the notification are omp's own `ask.timeout` and `ask.notify` settings, set in `/settings`; ask-more has none of its own. When the timeout ends, the answers you gave stand and every question you left blank reaches the model as `(timed out: …)`: the model decides it itself, says what it chose, and the turn goes on. Since nothing is preselected, a timeout never answers a question for you. `ask.timeout` of `0` turns the timer off, and omp runs no timer in plan mode.

## What the model sends and gets

The parameters are one object holding `questions[]`, plus extension fields:

| Per question | Added |
|---|---|
| `id`, `question`, `header?`, `options[{label, description?}]`, `recommended?` | `brief {where, what, how, diagram?, risks?}`; per option `tradeoff`, `holds_when?`, `cost?`; beside the questions, `evidence[]` and `demos[]`, each naming its question by `id` and, for an option's demo, its option by `label` |

The tool is registered for strict tool calling, so the provider holds the model's arguments to the schema. The schema is one root object, with no union of objects at any depth and no nesting past a question's `brief` and `options`: a `kind` field picks the form of an evidence entry (`file`, whose lines are numbers and never text, or `text`), and the fields of the other kind are left out. The evidence and demos of a call sit beside its questions and name the question `id` they belong to, an option's demo also naming the option's `label`. In strict mode the model fills every optional field it does not use with `null`, which omp removes before the call is checked.

The tool description contains the purpose and pointers to body-only topics served by `docTopics()`: `xd://ask/routing` (questions and skill/workflow mapping), `xd://ask/rounds` (the form, batching and retries), and `xd://ask/results` (answer lines). Together they explain:

- `ask` puts all questions of a call into one form, one section each, with nothing selected for the user, and blocks until they answer. The answers come back as the tool result and the model goes on in the same turn.
- The model MUST put every question whose answer it needs from the user through `ask`: a decision, a preference, the scope, a fact only the user knows, a confirmation before a risky or irreversible step. It NEVER writes such questions in its reply or ends a turn on one.
- This holds when a skill, workflow or other instruction tells it to ask, interview, confirm or let the user choose, including when the instruction says to ask in chat or prescribes how the questions look in the reply: such instructions assume there is no dialog, and with `ask` available, calling it is how the model follows them. The routing topic maps the parts of such a question onto `ask` in general terms (number or title → `header`, background and analysis → `brief`, choices and the recommendation → `options` with `recommended`, waiting for the answers → the call itself); everything else the instruction requires still applies.
- It does not ask for facts its tools can find or for choices that are its own to make.
- It writes for someone who has not read the session; the independent questions of a round go in one call, or one per call when the instruction asks one at a time, and a question whose options depend on an answer goes in a later call; a rejected call lists every problem, and the model fixes them and calls again.
- How to read the result, that a question reading `id: (timed out: …)` is the model's to decide, saying what it chose, and that a message sent while the form is open closes it with the answers given so far.

When the user invokes a skill (`/skill:<name>`) while `ask` is active, the copy of the skill message sent to the model ends, after the skill and the user's words, with one more paragraph: "[IMPORTANT: Any question, confirmation or choice the skill above puts to the user MUST go through the `ask` tool, NEVER into your reply, even where the skill says to ask in chat or shows how the questions look in your reply. Keep their content, order and recommendations.]" omp renders that message from a fixed template, so the paragraph is added in omp's `context` event, on the way to the model: the session file, `/tree` and exported transcripts show the skill message without it. Skills a subagent loads on its own are left as they are.

What each field means is in the parameter schema. The limits below are not in the description: a call that breaks one is rejected with a message naming it.

`question` stays a question: one or two sentences. The brief is its own field.

```
ask({
  questions: [{
    id: "retry-strategy",
    header: "重试策略",
    question: "重试应该怎么做？",
    recommended: 0,
    brief: {
      where: "retry() 与 3 处调用点，429 后上游出现重复写入。",
      what: "选择失败后的重试策略，决定是否引入幂等键。",
      how: "选 A 要加迁移；选 B 只改 retry() 内部，不动调用方。",
      diagram: "flowchart LR\n  client --> retry --> write",
      risks: ["迁移期间双写"]
    },
    options: [
      { label: "指数退避 + 幂等键",
        description: "需要 1 表 2 字段",
        tradeoff: "重试安全，代价是迁移",
        holds_when: "下游能给出稳定请求键",
        cost: "1 张表、2 个字段，可回滚" },
      { label: "固定 3 次重试", description: "改动最小",
        tradeoff: "不动 schema，但重复写会继续发生",
        cost: "只改 retry() 内部" }
    ]
  }, {
    id: "log-level",
    header: "日志级别",
    question: "默认日志级别用哪一档？",
    brief: { where: "…", what: "…", how: "…" },
    options: [ /* … */ ]
  }],
  evidence: [
    { question: "retry-strategy", kind: "file", path: "src/retry.ts", start: 41, end: 58, note: "现有重试只有 1 次" },
    { question: "retry-strategy", kind: "file", path: "src/order/paid.ts", start: 88, end: 96 },
    { question: "retry-strategy", kind: "text", source: "server.log, 2026-10-30 14:02", text: "POST /orders 429\nPOST /orders 200\nPOST /orders 200", note: "同一笔订单写了两次" }
  ],
  demos: [
    { question: "retry-strategy", path: "docs/retry-today.gif", caption: "重试后同一笔写了两次" },
    { question: "retry-strategy", option: "指数退避 + 幂等键", path: "docs/retry-idempotent.gif", caption: "第二次写入被幂等键拦下" }
  ]
})
```

Limits: 2–5 options per question; no `multi`. An option's label is one line with single spaces and does not start with "Other", which the form keeps for the user's own answer. Every evidence entry and demo names the question it belongs to by `id`, and an option's demo its option by `label`; one naming a question or option the call does not hold, carrying a field of the other `kind`, or a second demo on the same brief or option is rejected with that field named. Evidence has no count or length limit: a file entry's window is read up to its `end` and no further, so a few lines of a large file cost no more than a small file; `start` alone is one line, neither shows the file's first 40, and lines that are not adjacent are separate entries. A text entry's `source` is one line. A demo's `path` ends in `.gif`, `.png`, `.apng` or `.webp`. A call that breaks a rule is rejected with every problem listed before anything opens, and the model calls again.

The result text is `User answers:` and one line per question, in the order asked:

| Line | Meaning |
|---|---|
| `id: label` | you picked that option |
| `id: "text"` | you wrote your own answer |
| `id: (no answer)` | you submitted the form without answering this question |
| `id: (timed out: …)` | left blank when the form's timeout ended; the model decides it and the turn goes on |

`Option notes:` lines follow when you wrote a note on a chosen option, and images pasted into a note come with the result. A message sent while the form is open ends the call instead with omp's own interruption notice, `Ask interrupted by message. Answers the user gave before it:` followed by those answers as JSON. `details` is the host's `AskToolDetails`: `answers[]` with each question's `name`, `question` and `answer`, plus `notes` and `timedOut` when they apply, so the transcript card draws every question and its answer, `(no answer)` where nothing was given.

Two asks in one turn run one after the other: the second form opens after the first is answered.

## Readability check

Before you see an ask, OMP's `judge` role checks each question on its own, as its section of the form shows it, for a software engineer who sees only that section and has never seen the project's tracker, documents or code or the agent's work. It answers yes/no questions about every sentence (does it say who or what acts; does it mention a test, review round, result, set of items or earlier decision only by a name or number; does it hold a word, abbreviation, name or number that reader could not explain) and about every code or abbreviation found in the text, such as `F106`, `#243`, `§3`, a commit hash or `VM110` (would an engineer who never worked on the project know it; could that reader say what it is from the section alone).

One failing sentence or one code that is neither common knowledge nor explained rejects the whole call before anything opens; a wrongly rejected ask costs one rewrite, a missed one costs your decision. The rejection quotes each failing sentence with the reason and lists each failing code, and tells the model to write sentences that say who does what, spell out abbreviations and say in plain words what each name, number or earlier decision is. The model rewrites and calls again; that second call goes through without being judged, because the session's last `ask` result is this rejection, so a rejection costs one rewrite at most and a judge that rejects clear text cannot keep the ask from you. The call after that is judged again.

The judge is OMP's `judge` role chain, resolved the way OMP resolves it for its own judgments: the models of `modelRoles.judge` and its fallbacks, then, only when that chain holds no native judgment model, the session model as OMP's fallback. Every sentence and code is one request, at most sixteen at a time, billed to the session as `ask-readability`. The questions were chosen on `typesafe/jev-1.14.0`; on 44 recorded asks it rejected all of them, among them the PR #265 ask on 18 sentences and 5 codes, and passed a rewrite of that ask with a subject in every sentence ([verification](docs/verification.md#readability-check)). `futureppo-jev/decision-model-preview` answered the same questions wrongly against the text. Set `retry.fallbackChains.judge: []` in the omp config so a failing judge fails visibly instead of passing to another model.

| Setting | Default | Meaning |
|---|---|---|
| `readability.judge` | `true` | run the check whenever the judge chain resolves a model; `false` never calls one |

It is a native **plugin setting**, declared in `package.json` under `omp.settings`. Set it globally in `/settings` → Plugins → `omp-ask-more` or with `omp plugin config set omp-ask-more readability.judge false`; a project value goes in `.omp/plugin-overrides.json` and overrides the global one. It is read when each ask is called. A judge that fails or does not answer within 30 seconds lets the ask through with a warning, and so does an invalid setting; aborting the turn while the check runs cancels the ask.

## Sessions that cannot prompt you

In print mode (`omp -p`) omp has no `ask` of its own to show the form, so the model gets a rejection saying the session cannot prompt the user, instead of a hang.

## Observers

Answers in `ask` are tool results, not user messages, so tools that read the session have to look for them. The companion changes that do:

- [omp-config](https://github.com/oh-my-omp/omp-config) `turn-judge` puts `用户在ask中回答` (one `question → answer` line per answered question) into the judge's timeline, and its `gpt-talk-only` rule counts those answers as the user speaking: confirming a decision is a proper end when deciding was all the user asked for, while restating a picked approach without doing the work is still caught.
- omp-config `user-prompt-inject` renders `{{ask_answers}}`, so `mentor:default` and `discuss:*` see the decisions the user made in `ask` next to the typed requests.
- [omp-todo-more](https://github.com/oh-my-omp/omp-todo-more) leaves time spent waiting on the user in `ask` out of in-progress time, so a long discussion does not raise an overtime warning, and runs no deadline while an ask is open.

They read the `details.answers[]` result shape, so they work the same with the native `ask`.

## Known limitations

- **A skill that prescribes chat questions can still win on some models.** With the `grilling` skill invoked as `/skill:grilling`, `opencode-go/kimi-k2.7-code` put its first round into `ask` in 15 of 15 runs with the rule appended to the invoked skill, against 11 of 15 with the same code without it, eleven different requests across the runs. With the tool description alone, before the rule was added, `opencode-go/deepseek-v4.1-flash` (9 of 9 runs), `qwen3.8-flash` and `glm-5.3-flash` and the `openai-codex` models `gpt-5.6-luna`, `gpt-6-luna` and `gpt-6.1-terra` put their first round into `ask`, and `opencode-go/minimax-m3.1-flash` wrote the round in its reply and then put the same questions into `ask`. Without this plugin deepseek and kimi asked in chat, native `ask` included. Runs, transcripts, the earlier descriptions and the changes tried: [verification](docs/verification.md#a-skill-that-asks-in-chat).
- **The readability check has no measured precision.** The questions were chosen on `typesafe/jev-1.14.0` against 44 recorded asks, 16 of them labelled by the agent itself and none by a person; the check rejected every one, including the 10 labelled readable, and it passes 28 of 575 sentences that were read only in the eval output, some doubtful. A rewrite of the PR #265 ask passed. It was not run through `resolveJudge` inside a session, and the sentence and code questions have not been measured on any other judge model.
- **`/tree` re-answer shows a plain form.** omp reopens the persisted call itself, building the form from the questions and option labels alone, with the recommended option preselected and without the brief, evidence or tradeoffs; the answer comes back in omp's own wording.
- **Quoted text evidence is unchecked.** ask-more shows it as the model wrote it, under the source the model names; only file evidence is read by ask-more itself.
- **Evidence has no size bound.** Every cited line goes into the form when it opens, so a long window makes a long section.
- No `multi`.
- The model reads this plugin's tool description, not the native `ask` prompt; an extension that rewrites the ask prompt must target the final description.
