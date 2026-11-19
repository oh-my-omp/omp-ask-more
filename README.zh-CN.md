# omp-ask-more

[English](README.md) | 简体中文

一个替换原生 `ask` 工具的 OMP 插件，让 `ask` 成为代理把决定交给你的唯一入口。每个问题都写明现状、要决定什么、各个答案的后果，每个选项都写明取舍；整批问题由 omp 自己的 `ask` 作为一张表单展示给你，外观和操作与 omp 的其他表单一致。答案的形状与宿主一致（`details.answers[]`），读取会话的工具不用改。

状态：**已实现，v0.1.15**，在 omp 19.0.0 上验证（[验证](docs/verification.md)，英文）。实现方式见[设计](docs/design.md)（英文）。

## 为什么

原生 `ask` 让模型写一张 HTML 表单，但它的 prompt 让提问保持简短：标签要短、上下文只一句。模型也不用它把话说清楚，于是决定都在 chat 里做：“grill”一类的 skill 不能指望宿主有 ask 工具，只能在对话里问用户。

本插件要求每个问题写明现状/决定/后果、每个选项写明取舍，鼓励引用真实的文件行和命令输出、画示意图和放演示图片，并把这些全部编进 omp 展示给你的表单。`xd://ask/routing` topic 要求模型把所有需要用户回答的问题都交给 `ask`，skill 要求在 chat 里问的问题也一样；用户调用的 skill 送到模型时，末尾也带着这条规则。模型是否照做因模型而异（见[已知限制](#已知限制)）。

## 安装

```sh
omp plugin install https://github.com/oh-my-omp/omp-ask-more#release
```

`#release` 是发布通道：`main` 上是开发中的改动，每天的发布运行把它们变成一个版本。每个版本的变更写在 [`CHANGELOG.md`](CHANGELOG.md) 里，升级后 omp 会把它们作为 What's New 显示出来。

本地开发用 `omp plugin link /path/to/omp-ask-more`。不需要任何配置：[可读性检查](#可读性检查)有默认值，超时与通知用的是 omp 自己的设置（见[超时与通知](#超时与通知)）。原生 `ask` 要保持开启，ask-more 通过它展示问题。

## 发布

PR 只在 [`CHANGELOG.md`](CHANGELOG.md) 的 `## [Unreleased]` 下写条目，不改版本号；提交用 [lgit](https://github.com/can1357/llm-git)，条目由它写。发布运行给这一段加上版本号和日期，同步 `package.json` 的版本，并把 `release` 分支和版本 tag 移到新提交上。它每天 GMT+9 02:00 运行一次，也可以手动触发；`## [Unreleased]` 下没有条目时不发布。

## 界面语言

Ask-more 面向 OMP，不支持 Pi。它放进表单的标签（现状、决定、后果、证据、选项等）和它的警告在生成文字时按以下顺序解析语言：

1. `OMOMP_LANG`：去掉首尾空白、忽略大小写后为 `en` 或 `zh` 时采用。
2. `LC_ALL`、`LC_MESSAGES`、`LANG` 中第一个去掉首尾空白后非空的值：以 `zh` 开头（不分大小写）为中文，其余为英文。
3. 英文。

环境变量每次解析时重新读取。发给模型的文字保持英文。

## 你会看到什么

整次调用是一张表单，每个问题一节：

- 问题的标题，然后是**现状**、**决定**（要决定什么）和**后果**（各个答案之后会怎样）；
- **证据**，有两种：文件里的行，ask 打开时由 ask-more 自己读取，你读到的是带行号的文件本身，不是模型抄的版本；以及模型从别处引用的文字（命令输出、网页、日志），标题是模型写的来源，并标明 ask-more 没有读取核对。读不到的文件写明原因，不阻塞这次 ask；
- 画成文字的 Mermaid **图**，以及**风险**；
- 问题的演示图片；
- **选项**，每个带着取舍，推荐项标为“（推荐）”，模型给了的话还有**成立条件**和**成本**，以及各选项的演示图片；
- 题干和它的选择：每个选项，加上 omp 自带的 “Other”，可以用自己的话作答。

表单不替你预选任何一项：推荐只是一个标记，每个答案都由你自己选。按键、滚动、给选项写备注和提交都与 omp 自己的表单相同。omp 没有表单对话框的地方（例如 RPC 客户端），它一次问一题，每题带着该节的文字作为上下文。

表单打开时你发一条消息，表单就关闭，这次调用以“被打断”结束并带上你已给出的答案，你的消息随后送到模型。取消表单会结束本轮。

### 演示

演示展示随时间变化的行为：放在问题上展示现在的样子，放在选项上展示选它之后的结果。演示是一张图片文件（GIF、PNG、APNG 或 WebP），表单把它作为图片显示，caption 写明该看什么。

## 超时与通知

超时与通知是 omp 自己的 `ask.timeout` 和 `ask.notify` 设置，在 `/settings` 里设置；ask-more 没有自己的超时设置。超时结束时，你已给出的答案照旧有效，每道留空的题以 `(timed out: …)` 交给模型：模型自己决定、说明选了什么，本轮继续。因为表单不预选，超时不会替你回答任何一题。`ask.timeout` 设为 `0` 关闭计时，plan mode 下 omp 也不计时。

## 模型发出什么、收到什么

参数是一个装着 `questions[]` 的对象，加上扩展字段：

| 每题 | 新增 |
|---|---|
| `id`、`question`、`header?`、`options[{label, description?}]`、`recommended?` | `brief {where, what, how, diagram?, risks?}`；每选项 `tradeoff`、`holds_when?`、`cost?`；问题旁边另有 `evidence[]` 与 `demos[]`，都用 `id` 指明属于哪个问题，选项的演示另用 `label` 指明属于哪个选项 |

工具按严格工具调用注册，provider 会把模型的参数限定在 schema 之内。schema 是单个根对象，任何层级都没有对象联合，嵌套最深到问题的 `brief` 与 `options`：证据条目由 `kind` 选形状（`file` 的行号是数字而不是文本，或 `text`），另一形状的字段留空。一次调用的证据和演示与问题并列，用 `id` 指明所属问题；选项的演示另用 `label` 指明所属选项。严格模式下，模型把没用到的可选字段都填成 `null`，omp 在检查调用之前把它们去掉。

工具说明只保留用途和指向 `docTopics()` 返回的纯正文 topic 的指针：`xd://ask/routing`（提问及 skill/工作流映射）、`xd://ask/rounds`（表单、批次与重试）、`xd://ask/results`（答案各行的含义）。它们共同说明：

- `ask` 把一次调用的所有问题放进一张表单，每题一节，不替用户预选，一直等到用户作答。答案作为工具结果返回，模型在同一轮里接着做。
- 凡是模型需要用户回答的问题都必须（MUST）交给 `ask`：决定、偏好、范围、只有用户知道的事实、有风险或不可逆的步骤前的确认。绝不（NEVER）把这类问题写在回复里，也不以它结束本轮。
- skill、工作流或其他指令要求提问、访谈、确认或让用户挑选时也一样，包括指令说在对话里问、或规定问题在回复里长什么样的时候：这类指令假定没有对话框，有 `ask` 时，调用它就是在照指令办。routing topic 用通用的话把这类问题的各部分对应到 `ask`（编号或标题 → `header`，背景与分析 → `brief`，候选项与推荐 → 带 `recommended` 的 `options`，等用户回答 → 这次调用本身）；该指令的其余要求照旧。
- 不问工具查得到的事实，不问本该自己做的选择。
- 写给没看过会话的人；一轮里彼此独立的问题放进同一次调用，指令要求一次问一题时每题一次调用，选项依赖某个答案的问题放到后一次调用；被拒的调用会列出全部问题，模型改好后重新调用。
- 怎样读结果；结果里某题为 `id: (timed out: …)` 时由模型自己决定这一题，并说明选了什么；表单打开时用户发消息，表单关闭，已给出的答案照常返回。

有 `ask` 时用户调用 skill（`/skill:<name>`），送给模型的那份 skill 消息在 skill 正文和用户的话之后，多出一段：“[IMPORTANT: Any question, confirmation or choice the skill above puts to the user MUST go through the `ask` tool, NEVER into your reply, even where the skill says to ask in chat or shows how the questions look in your reply. Keep their content, order and recommendations.]” 这条消息由 omp 用固定模板渲染，所以这段话是在 omp 的 `context` 事件里、发往模型的途中加上的：会话文件、`/tree` 和导出的对话记录里显示的 skill 消息不带它。子代理自行加载的 skill 不改动。

各字段的含义写在参数 schema 里。下面的限制不写进说明：违反限制的调用被拒绝，拒绝信息点名该限制。

`question` 只当问题用：一两句话。简报是独立字段。

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

限制：每题 2–5 个选项；不支持 `multi`。选项的 `label` 是单行、只用单个空格，并且不以 “Other” 开头，因为表单把它留给用户自己写的答案。每条证据和演示都用 `id` 指明所属问题，选项的演示另用 `label` 指明所属选项；指向调用里不存在的问题或选项、带上另一种 `kind` 的字段、或在同一简报或选项上给第二个演示，都会被拒绝并点名字段。证据不限条数和行数：文件证据只读到行段的 `end` 为止，所以大文件里的几行和小文件一样便宜；只给 `start` 就是一行，两个都不给就显示文件前 40 行，不相邻的几段各写一条。文字证据的 `source` 只能是一行。演示的 `path` 以 `.gif`、`.png`、`.apng` 或 `.webp` 结尾。违反规则的调用在任何界面打开之前就被拒绝，一次列出全部问题，由模型改好再调用。

结果文本是 `User answers:` 加每题一行，按提问顺序：

| 行 | 含义 |
|---|---|
| `id: 选项` | 你选了这个选项 |
| `id: "文字"` | 你自己写了答案 |
| `id: (no answer)` | 你提交了表单，但没答这一题 |
| `id: (timed out: …)` | 表单超时时这一题还空着；由模型决定，本轮继续 |

你给选中的选项写了备注时，后面跟着 `Option notes:` 各行，备注里贴的图片随结果一起返回。表单打开时发消息的话，这次调用改以 omp 自己的打断提示结束：`Ask interrupted by message. Answers the user gave before it:` 后面是已给出答案的 JSON。`details` 是宿主的 `AskToolDetails`：`answers[]` 里每题的 `name`、`question`、`answer`，有备注或超时时另有 `notes` 和 `timedOut`，所以对话记录里的卡片逐题画出问题和答案，没答的画成 `(no answer)`。

同一轮里的两次 ask 依次进行：第一张表单答完，第二张才打开。

## 可读性检查

ask 送到你面前之前，OMP 的 `judge` 角色会逐题检查：每题按它在表单里那一节实际显示的内容，站在一个只看得到这一节、从没见过这个项目的工单、文档和代码，也没看过 agent 之前工作的软件工程师的位置。它对每个句子回答是非题（这句是否说了谁或什么在做；是否只用名称或编号提到某个测试、审查轮次、结果、一组东西或以前的决定；是否含有这位读者解释不了的词、缩写、名称或数字），也对文字里找到的每个编号或缩写回答是非题，如 `F106`、`#243`、`§3`、提交哈希或 `VM110`（没做过这个项目的工程师是否知道它；只看这一节能否说出它是什么）。

只要有一个句子不过关，或有一个既不是常识、这一节里也没说明的编号，整次调用就在任何界面打开前被拒绝；多拦一次只多花一次改写，漏掉一次是让你在看不懂的情况下做决定。拒绝里引用每个不合格的句子并说明原因，列出每个不合格的编号，要求模型把句子写成有主语、说明谁做什么，写全缩写，并用平白的话说明每个名称、编号或以前的决定是什么。模型改写后再调用，这第二次调用不再判断、直接通过，因为会话里最近一次 `ask` 的结果就是这次拒绝，所以一次拒绝最多花一次改写，把清楚的文字也拒掉的判断模型挡不住 ask。再下一次调用重新判断。

判断用的是 OMP 的 `judge` 角色链，解析方式与 OMP 自己做判定时相同：先是 `modelRoles.judge` 及其后备模型；只有这条链里没有原生判定模型时，才由会话模型作为 OMP 的兜底。每个句子和每个编号各一次请求，同时最多十六个，费用记在会话上，用途标为 `ask-readability`。这些问题是在 `typesafe/jev-1.14.0` 上挑定的；在 44 条记录下来的 ask 上它全部拒绝，其中 PR #265 那条因 18 个句子和 5 个编号被拒，把它改写成每句都有主语后则通过（[验证记录](docs/verification.md#readability-check)）。`futureppo-jev/decision-model-preview` 对同样的问题，对照原文读是答错的。在 omp 配置里设 `retry.fallbackChains.judge: []`，判断模型出错时就直接报错，不会悄悄换成别的模型。

| 设置 | 默认值 | 含义 |
|---|---|---|
| `readability.judge` | `true` | 只要 judge 链能解析出模型就检查；`false` 时从不调用 |

它是原生**插件设置**，由 `package.json` 的 `omp.settings` 声明。全局值通过 `/settings` → Plugins → `omp-ask-more` 或 `omp plugin config set omp-ask-more readability.judge false` 设置；项目值写入 `.omp/plugin-overrides.json`，覆盖全局值。每次调用 ask 时读取。判断模型出错或 30 秒内没给结果时，放行这次 ask 并显示警告；设置值无效时也一样。检查进行中中止本轮，ask 随之取消。

## 不能向你提问的会话

print 模式（`omp -p`）里 omp 没有自己的 `ask` 来展示表单，所以模型收到一条拒绝，说明这个会话不能向用户提问，而不是一直挂着。

## 观察者

`ask` 里的回答是工具结果，不是用户消息，读取会话的工具要专门去找。配套的改动：

- [omp-config](https://github.com/oh-my-omp/omp-config) 的 `turn-judge` 把 `用户在ask中回答`（每个已作答的问题一行 `问题 → 答案`）放进判定时间线，其 `gpt-talk-only` 规则把这些回答当作用户亲口说的话：用户只要求作出决定时，确认决定后结束是正当的；复述已选的做法却不去做，仍会被拦下。
- omp-config 的 `user-prompt-inject` 渲染 `{{ask_answers}}`，让 `mentor:default` 和 `discuss:*` 在用户打字的请求旁边看到用户在 `ask` 中作的决定。
- [omp-todo-more](https://github.com/oh-my-omp/omp-todo-more) 把在 `ask` 里等用户作答的时间从 in_progress 用时中扣除，长时间讨论不会触发超时警告；ask 未结束时不运行任何 deadline。

它们读取 `details.answers[]` 这一结果形状，对原生 `ask` 同样有效。

## 已知限制

- **规定在 chat 里提问的 skill 在部分模型上仍可能占上风。** 以 `/skill:grilling` 调用 `grilling` skill 时，在所调用 skill 末尾加上规则后，`opencode-go/kimi-k2.7-code` 15 次里有 15 次把第一轮问题放进 `ask`；同一份代码不加规则时是 15 次里 11 次，各次共用了十一条不同的请求。只靠工具说明、尚未加这条规则时，`opencode-go/deepseek-v4.1-flash`（9 次里 9 次）、`qwen3.8-flash`、`glm-5.3-flash` 以及 `openai-codex` 的 `gpt-5.6-luna`、`gpt-6-luna`、`gpt-6.1-terra` 都把第一轮问题放进了 `ask`，`opencode-go/minimax-m3.1-flash` 先在回复里写了这一轮，再把同样的问题放进 `ask`。不加载本插件时 deepseek 和 kimi 都在 chat 里问，有原生 `ask` 也一样。运行记录、对话记录、早先的说明和试过的改动见[验证](docs/verification.md#a-skill-that-asks-in-chat)。
- **可读性检查没有测过精确率。** 这些问题是在 `typesafe/jev-1.14.0` 上对 44 条记录下来的 ask 挑定的，其中 16 条由 agent 自己标注、没有一条由人标注；检查把它们全部拒绝，包括标成可读的 10 条，并放过了 575 个句子里的 28 个，这 28 个只在 eval 输出里读过，有些可疑。PR #265 那条的改写版通过。没有在会话里经 `resolveJudge` 跑过，这些句子和编号的问题也没在别的判断模型上测过。
- **`/tree` 重答显示的是一张简化表单。** omp 自己重开持久化的调用，只用问题和选项标签生成表单，推荐项预先选中，没有简报、证据和取舍；答案按 omp 自己的措辞返回。
- **文字证据没有核对。** ask-more 按模型写的原样显示，标题是模型写的来源；只有文件证据由 ask-more 自己读取。
- **证据不限大小。** 引用的每一行在表单打开时都在表单里，行段越长，这一节越长。
- 没有 `multi`。
- 模型读到的是本插件的工具说明，而不是原生 `ask` 的 prompt；改写 ask prompt 的扩展必须针对最终的说明。
