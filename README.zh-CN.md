# omp-ask-more

[English](README.md) | 简体中文

一个替换原生 `ask` 工具的 OMP 插件，让 `ask` 成为代理把决定交给你的唯一入口。每个问题都写明现状、要决定什么、各个答案的后果，每个选项都写明取舍；作答界面铺满屏幕——普通终端里是 alternate screen 上的整页，Tern 里是盖在对话记录上的面板。答案以原生形状交回模型，读取会话的工具不用改。

状态：**已实现，v0.1.0**，在 omp 18.14.0 与 Tern 0.9.6 上验证（[验证](docs/verification.zh-CN.md)）。实现方式见[设计](docs/design.zh-CN.md)。

## 为什么

原生 `ask` 太弱，模型也不用它把话说清楚，于是决定都在 chat 里做：“grill”一类的 skill 不能指望宿主有 ask 工具，只能在对话里问用户。原生工具其实已有承载更多内容的字段——`question` 按 Markdown 渲染，每个选项都有自由文本 `preview`——但它的 prompt 要求模型把标签写短、从不提 `preview`，对话框又挂在 composer 里，标题最多四行、整块最多占终端 70%。

本插件要求每个问题写明现状/决定/后果、每个选项写明取舍，鼓励引用真实代码行、画示意图和放演示动画，并把作答界面画成全屏。工具说明要求模型把所有需要用户决定的事都交给 `ask`，skill 要求在 chat 里问的问题也一样；模型是否照做因模型而异（见[已知限制](#已知限制)）。

## 演示视频

下面三段无声视频在无界面的 Tern 0.9.8 窗口里录制，用的是 omp 18.14.0 和真实模型 `opencode-go/deepseek-v4.1-flash`，对象是一个小型订单服务：它的付款重试会把一行写两次。人的请求按画面所示输入；画面上的每个问题、选项、引用的行号范围、图和演示都是模型自己的输出。等模型的时间被剪掉，字幕写明等了多久。每条字幕先写是谁在操作：人、模型或 ask-more。界面是英文，字幕是中文。

| 视频 | 演示内容 |
|---|---|
| [1. 前后对比：一个决定](#1-前后对比一个决定) | 同一个请求、同一个模型，先用 omp 自带的 ask，再用 ask-more；现状 / 决定 / 后果（Where / What / How）；随光标切换的取舍 / 成立条件 / 成本卡片；从磁盘读出的证据；Mermaid 图；风险；选项上的 GIF 演示；提交；原生的结果形状，以及模型接着干活 |
| [2. 一次多个决定，然后走开](#2-一次多个决定然后走开) | 一次 ask 里的三个问题；带 `✓` 的标签；通过 `Other…` 自己写答案；切换标签不丢答案；问题上的分帧演示；汇总页里有一题未答；倒计时行、终端通知和 `(timed out: …)`；模型自己决定未答的题并说明选了什么 |
| [3. 普通终端](#3-普通终端) | 同一个请求，omp 用经典渲染器（`PI_TUI_NATIVE=0`）：alternate screen 上的页面、键位提示、滚动条、带帧计数的分帧演示、`PgDn`、`ctrl+o`、用 `enter` 作答 |

没有拍到的：普通终端里 GIF 或视频的半块字符画面、APNG/WebP/视频演示文件、`esc` / `全部取消`、`onExpiry: wait`、通知命令、没有 TUI 的会话、`/tree` 重答、观察者和协作 guest。

### 1. 前后对比：一个决定

https://github.com/user-attachments/assets/e29b2bea-7166-4028-80a5-3c1e4ac38689

### 2. 一次多个决定，然后走开

https://github.com/user-attachments/assets/26b8729a-83f0-484b-ace5-03ee4f82a668

### 3. 普通终端

https://github.com/user-attachments/assets/101da4a7-ec8b-4c83-8286-2cd0d8a7d1fe

## 安装

```sh
omp plugin install https://github.com/oh-my-omp/omp-ask-more
```

本地开发用 `omp plugin link /path/to/omp-ask-more`。不需要任何配置：[超时设置](#超时与通知)都有默认值。原生 `ask` 要保持开启，没有 TUI 的会话会把提问交给它。

在 Tern 中还要安装 `tern/` 里的纯样式 Tern 插件：

```sh
tern plugin install github.com/oh-my-omp/omp-ask-more/tern
```

开发时用 `tern plugin link /path/to/omp-ask-more/tern`。两者都会让 Tern 重新加载插件，无需重启。它让 ask 面板用上 omp 其他 overlay 的无衬线字体，并在 Console 聊天风格下留出问题前 `?` 标记所在的左侧空白。不装它面板照常可用，简报以终端字体显示。

## 你会看到什么

每个问题一页：

- 问题，然后是**现状**、**决定**（要决定什么）和**后果**（各个答案之后会怎样），不折叠；
- 选项，推荐项带标记，最后是 `其他…`，可以自己写答案；
- 聚焦选项下方是它的**取舍**、**成立条件**和**成本**，有演示时还有演示；
- 问题的演示、**证据**——ask 打开时从文件里读出的真实代码行，你读到的是代码本身，不是模型抄的版本；读不到的引用写明原因，不阻塞这次 ask——Mermaid 图和风险；
- ask 会超时的话，还有一行倒计时（见[超时与通知](#超时与通知)）。

多个独立问题合成一批：一行标签（已答题带 `✓`），最后一页是**汇总**，列出每题的答案和未答题数。光标停在某个选项上不等于作答；切换标签不丢任何东西。

普通终端里页面在 alternate screen 上，标题和标签在顶部，键位提示在底部，中间的正文可以滚动。Tern 里是盖住窗格的模态面板，配色跟随 Tern 的主题和 Reader、Spine、Console 聊天风格，滚动由 Tern 自己处理。

### 演示

演示展示随时间变化的行为：放在问题上展示现在的样子，放在选项上展示选它之后的结果（光标每次移到该选项都从头播放，在选项间移动就能对比）。

| 来源 | Tern | 普通终端 |
|---|---|---|
| 模型写的分步画面 | 每帧按 Markdown 显示，带 `1/3` 计数和 `Previous` / `Pause` / `Next` | 同样的分步画面，用下表的按键换帧 |
| GIF、APNG、WebP | Tern 按文件自身的节奏播放 | 64 × 20 格的粗略彩色画面，和分步画面一样换帧 |
| mp4、mov、webm、mkv、m4v | 由 ffmpeg 转成 GIF 后播放 | 和动画一样解码 |

普通终端页面和视频需要 `PATH` 里有 `ffmpeg`/`ffprobe`；缺工具、缺文件或格式不对时显示为写明原因的错误行，ask 照常打开。

### 按键与指针

| 输入 | 问题页 | 汇总页 |
|---|---|---|
| `↑` `↓` / 单击一行 | 移动光标（光标下的行还不是答案） | 滚动 |
| `enter` / 双击 / `下一题`、`提交` | 以该行作答；单题直接提交，多题跳到下一题，最后一题之后进入汇总 | 提交整批 |
| `o` / 点击 `其他…` | 打开 Other 输入框；`enter` 把非空文字存为答案，`esc` 关闭输入框 | — |
| `tab` `→` / `shift+tab` `←` / 点击标签 | 下一题 / 上一题（仅多题） | 同左 |
| `PgUp` `PgDn` `Home` `End` `Shift+↑↓` / 滚轮 | 滚动页面 | 同左 |
| `ctrl+o` | 普通终端页面中展开证据行 | — |
| `p` / `Pause`、`Play` | 暂停或继续本页的演示 | — |
| `[` `]` / `Previous`、`Next` | 本页的演示后退或前进一帧 | — |
| `esc` / `全部取消` | 取消整次调用 | 同左 |

## 超时与通知

打开的 ask 在没人操作时倒计时。这些设置是 omp 设置，与原生设置一样从 `~/.omp/agent/config.yml`、项目的 `.omp/config.yml`、`--config` 或 `cfg://` 读取；每次 ask 打开时读取一次，改动从下一次 ask 生效。

| 设置 | 默认 | 含义 |
|---|---|---|
| `askMore.timeout` | `1800` | 无操作多少秒后进入第一步；`0` 关闭计时 |
| `askMore.notify.terminal` | `true` | 在这一步发终端通知（OSC 99、OSC 9 或 BEL，取终端支持的那种） |
| `askMore.notify.command` | 未设置 | 在这一步以 `sh -c` 运行的 shell 命令；也可用 `OMP_ASK_MORE_NOTIFY_COMMAND`。来自项目配置时忽略并给出警告 |
| `askMore.returnTimeout` | `1200` | 通知之后留给你回来的秒数 |
| `askMore.onExpiry` | `decide` | 最后一段倒计时结束时：`decide` 把未答的问题交给模型，`wait` 让 ask 一直开着 |

```mermaid
stateDiagram-v2
  Open --> Answered: 你作答
  Open --> Notified: askMore.timeout 内无操作，且有渠道开启
  Open --> Expired: askMore.timeout 内无操作，且没有渠道开启
  Notified --> Open: 任何操作
  Notified --> Expired: askMore.returnTimeout 内无操作
  Expired --> Decided: onExpiry 为 decide
  Expired --> Waiting: onExpiry 为 wait
```

- 任何按键、点击、普通终端页面里的滚轮，或在 Other 输入框里打字，都让第一段倒计时从头开始。通知之后回来操作也一样，之后再闲置会再次通知。
- 两个渠道都关闭时，第一段倒计时结束就结束 ask（`decide`），或什么都不发生（`wait`）。
- 交给模型时，你已给出的答案照旧有效，每道未答的题以 `(timed out: …)` 交给模型；模型自己决定这些题、说明选了什么，本轮继续。Other 输入框里没保存的文字不算答案。
- 倒计时那一行只在上述步骤变化：`无操作 30 分钟 后通知你，再过 20 分钟 交给模型决定`，之后是 `14:03 已通知；14:23 前无操作则交给模型决定`。
- 通知不带问题正文、证据或答案。终端通知为 `omp: <标题>：等待你的回答；14:23 交给模型决定`。
- 命令在会话工作目录运行，环境是它自己的环境加上：

  | 变量 | 值 |
  |---|---|
  | `OMP_ASK_MORE_EVENT` | `timeout` |
  | `OMP_ASK_MORE_TITLE` | 面板标题：该题的 `header`，或“N 个决定” |
  | `OMP_ASK_MORE_BODY` | 终端通知的文字 |
  | `OMP_ASK_MORE_QUESTIONS` | 题数 |
  | `OMP_ASK_MORE_CWD` | 工作目录 |
  | `OMP_ASK_MORE_DUE` | 交给模型的时间（ISO 8601），`wait` 时为空 |

  输出被忽略，30 秒后被结束。非零退出、被结束或启动失败都显示一条只写结果的警告，因为命令里可能带 token；不重试，失败也不改变 ask。
- 密钥放在命令读取的环境里，不写进命令文字。例如由启动 omp 的一方导出 `NTFY_TOPIC`：

  ```yaml
  askMore:
    notify:
      command: 'curl -fsS -d "$OMP_ASK_MORE_BODY" "https://ntfy.sh/$NTFY_TOPIC"'
  ```

- 项目配置不能设置命令：否则克隆来的仓库可以借 `.omp/config.yml` 在你的机器上运行程序，并决定你的通知发往哪里。环境变量、`--config`、运行时覆盖和全局配置可以设置。
- 这里不使用原生 `ask.timeout` 与 `ask.notify`：它们属于原生对话框，`ask.timeout` 在那里会替你选推荐项。

## 模型发出什么、收到什么

参数是原生参数加上扩展字段：

| 沿用原生 `ask` | 新增 |
|---|---|
| 工具名 `ask`；`questions[]`，每题 `id`、`question`、`header?`、`options[{label, description?, preview?}]`、`multi?`、`recommended?` | 每题 `brief {where, what, how, evidence?, diagram?, demo?, risks?}`；每选项 `tradeoff`、`holds_when?`、`cost?`、`demo?` |

工具说明要求模型：

- `ask` 是把决定交给用户的唯一途径——方案、取舍、偏好、范围、有风险或不可逆的步骤都算。在文字里以提问或列选项结束本轮是错的。
- skill、工作流或其他指令要求问用户、请用户确认或让用户挑选时，用 `ask` 来做；该指令的其余要求照旧。
- 不问工具查得到的事实，不问本该自己做的选择。
- 写给没看过会话的人：说人话、短句、写具体名字。
- 决定涉及代码时引用真实代码行；涉及流程、时序、状态、依赖或结构时画 Mermaid 图。两者在 schema 中都是可选字段。
- 决定涉及随时间变化的行为——界面交互、请求经历的状态、改动前后——时放演示。演示可以是模型自己写的分步画面，也可以是动画或视频文件，包括它为这次 ask 现录的。
- 彼此独立的决定放进同一次调用、每题一个；选项依赖另一个答案的决定放到后一次调用。
- 结果里某题为 `id: (timed out: …)` 时，表示用户在 ask 超时前没有回答：由模型按最佳判断自己决定这一题、说明选了什么，然后继续。

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
      evidence: [
        { path: "src/retry.ts", lines: "41-58", note: "现有重试只有 1 次" },
        { path: "src/order/paid.ts", lines: "88-96" }
      ],
      diagram: "flowchart LR\n  client --> retry --> write",
      demo: {
        frames: [
          { body: "`write #1` → 429", caption: "第一次写入被限流" },
          { body: "`write #1` → 200 · `write #1` → 200", caption: "重试后同一笔写了两次" }
        ],
        interval_ms: 1500
      },
      risks: ["迁移期间双写"]
    },
    options: [
      { label: "指数退避 + 幂等键",
        description: "需要 1 表 2 字段",
        tradeoff: "重试安全，代价是迁移",
        holds_when: "下游能给出稳定请求键",
        cost: "1 张表、2 个字段，可回滚",
        demo: { path: "docs/retry-idempotent.gif", caption: "第二次写入被幂等键拦下" } },
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
  }]
})
```

限制：每题 2–5 个选项，每题最多 6 条证据引用，每条引用最多 80 行，不支持 `multi`。演示：2–12 帧，每帧 300–5000 毫秒（默认 1200）；文件最大 16 MB，只播前 15 秒。违反规则的调用在任何界面打开之前就被拒绝，一次列出全部问题，由模型改好再调用。

结果是原生形状：`User answers:` 加每题一行，按提问顺序：

| 行 | 含义 |
|---|---|
| `id: 选项` | 你选了这个选项 |
| `id: "文字"` | 你自己写了答案 |
| `id: (cancelled)` | 从汇总页提交时没答的题；或 `esc` / `全部取消` 后的每一题，此时本轮也随之结束 |
| `id: (timed out: …)` | ask 超时时没答的题；由模型决定，本轮继续 |

同时只开一个 ask；第二次调用被拒绝，而不是再开一张面板。

## 没有 TUI 的会话

会话没有 UI 或不在 TUI 模式时，ask-more 把每一题的原生字段交给原生 `ask`，由它用自己的对话框显示，超时与通知也按它自己的 `ask.timeout` 和 `ask.notify`。连原生 ask 都没有时（例如 print 模式），模型收到拒绝，而不是一直挂着。全屏界面在打开时出错的话，会显示一条警告，整批交给原生对话框。

## 观察者

`ask` 里的回答是工具结果，不是用户消息，读取会话的工具要专门去找。配套的改动：

- [omp-config](https://github.com/oh-my-omp/omp-config) 的 `turn-judge` 把 `用户在ask中回答`（每个已作答的问题一行 `问题 → 答案`）放进判定时间线，其 `gpt-talk-only` 规则把这些回答当作用户亲口说的话：用户只要求作出决定时，确认决定后结束是正当的；复述已选的做法却不去做，仍会被拦下。
- omp-config 的 `user-prompt-inject` 渲染 `{{ask_answers}}`，让 `mentor:default` 和 `discuss:*` 在用户打字的请求旁边看到用户在 `ask` 中作的决定。
- [omp-todo-more](https://github.com/oh-my-omp/omp-todo-more) 把在 `ask` 里等用户作答的时间从 in_progress 用时中扣除，长时间讨论不会触发超时警告；ask 未结束时不运行任何 deadline。

它们读取的是原生结果形状，对原生 `ask` 同样有效。

## 已知限制

- **规定在 chat 里提问的 skill 仍可能占上风。** 以 `/skill:grilling` 调用 `grilling` skill 时，`opencode-go/deepseek-v4.1-flash` 3/3 次把两轮问题都放进 `ask`，`opencode-go/kimi-k2.7-code` 3/3 次两轮都在 chat 里问。不加载本插件时两者都在 chat 里问，有原生 `ask` 也一样。改写说明或把规则加进系统提示都没有改变 kimi；本轮结束时检查一次能把它的问题移进 `ask`，但那时问题已经在 chat 里显示过了。运行记录、对话记录和试过的变体见[验证](docs/verification.zh-CN.md#要求在对话中提问的-skill)。
- **`/tree` 重答**会在原生对话框里重新打开带扩展字段的 ask，只显示原生字段。
- **协作 guest** 在 ask-more 面板打开期间无法作答。
- **print 与没有原生 ask 的 RPC** 收到拒绝；原生工具会中止整个操作。
- **plan mode 下同样计时**；原生 ask 在那里会关闭自己的超时。没有 `multi`，没有 note。
- **对话记录里的卡片把超时的题显示为 `Cancelled`**：所有 `ask` 结果都由原生渲染器绘制，它没有“未作答、交给模型”这种状态。模型读到的是 `(timed out: …)`。
- **没有 TUI 的会话里**生效的是原生 `ask.timeout` 与 `ask.notify`，`askMore.*` 设置不起作用。
- **终端通知只在终端会把 OSC 99、OSC 9 或 BEL 变成通知时出现**；通知命令需要 POSIX `sh`。
- **普通终端里的演示很粗。** 文件按 64 × 20 格播放、每格两个像素：动作看得出，录屏里的小字看不清，所以 caption 要写清看什么。每帧最多重写 20 行 24 位色（画面复杂时约 16–17 KB），慢速 SSH 下会有感觉。画面宽度在 ask 打开时就定了，不随终端大小变化。
- **不装 Tern 样式插件时**，Reader 与 Spine 下简报以终端字体显示，Console 下问题前的 `?` 标记贴在面板左边缘。
- 模型读到的是本插件的工具说明，而不是原生 `ask` 的 prompt；改写 ask prompt 的扩展必须针对最终的说明。
