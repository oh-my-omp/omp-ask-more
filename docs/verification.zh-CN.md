# 验证

[English](verification.md) | 简体中文

对 omp-ask-more 跑过什么、每次看到了什么。下表使用 Tern 0.9.6 与 `opencode-go/deepseek-v4.1-flash`；[要求在对话中提问的 skill](#要求在对话中提问的-skill) 一节另写了自己的环境。标 *18.14.0* 的行于 2026-10-30 在 Tern 样式改动之后用 omp 18.14.0 执行；其余行于 2026-10-29 用 omp 18.13.3 执行。这里用到的说法（ANSI 页面、面板、role、动作）与[设计](design.zh-CN.md)一致。

| 检查 | 命令 | 观察结果 |
|---|---|---|
| 类型 *18.14.0* | `bun run check` | `tsc --noEmit` 无错误 |
| 单测 *18.14.0* | `bun test` | 53 通过 0 失败：每条拒绝信息、逐题下标与重复 id、证据上下界、演示来源与上下界规则、`nativeQuestion` 投影、半块颜色、画面尺寸、演示加载、超时策略（默认值、0 即关闭、没有渠道开启、两个渠道加 `wait`、拒绝项目配置里的命令）与超时结果文字，以及 Tern 面板：每一帧都被 pi-tui 的参考 applier 接受；原生 ask role，光标停在别处时已选行仍有标记；单击与双击；过期点击（再点一次 `下一题`、光标移动或 Other 打开之前画出的 `下一题`、光标已离开的选项的演示控件、离开汇总后的 `提交`、重复 `全部取消`）被丢弃；以及测试时钟上的倒计时（无人操作时交回已给出的答案；按键与终端在 Other 输入框里的编辑让倒计时重来；通知一次、请求重画、再进入回来窗口；通知后回来操作从头计时；`wait` 永不关闭；到点前作答时只有这一个结果；关闭计时时没有倒计时那一行）。去掉选项列表的 role、把面板 role 改回 `omp.overlay.*`、或去掉作答动作对页面与光标的核对，分别有 5、1、3 个测试失败 |
| ANSI 多题 | 130×40 PTY 里 `omp --no-extensions -e …/index.ts`，提示词要求一次问三个独立问题 | alternate screen 页面画出标题、标签行 `重试上限 日志级别 缓存 汇总`、滚动条与键位提示；`enter` 回答第 1 题（`✓ 重试上限`）并打开第 2 题；`o`、`warn`、`enter` 作答；第 3 题 `PgDn` 滚动；`tab` 打开汇总，列出两题答案与 `1 题未回答`；`enter` 返回 `retry-limit: 固定 3 次，指数退避`、`log-level: "warn"`、`cache: (cancelled)` |
| ANSI 单题 | 同一会话 | 无标签行；`↓`、`enter` 直接提交：`cap: 3 次` |
| Tern 多题 | 无头 `tern serve --control …`，在其窗格里带 `PI_TUI_TSP_RECORD` 运行 omp；`ctl shot`、`tree`、`click`、`dblclick`、`key`、`type` | 一张 `sf-overlay sz-full at-center modal` 面板，标题 `3 decisions`，带 `tabs` 行；单击一行发出 `select … q0/option:2` 并切换取舍卡；`Next` 作答并打开下一题；点击标签回到第 2 题，原答案保留；`Other…` 打开获得焦点的 `sf-input`，键入的文字进入其中，`Save answer` 作答并前进；`tab` 打开汇总；`enter` 返回 `retry-limit: 10 次(长退避)`、`log-level: "warn and above"`、`cache: 定时过期(TTL 固定)`，面板离开 `layer`。`OMOMP_LANG=zh` 下汇总行与取舍行为“标签 值”且不重叠，`esc` 返回三题均为 `(cancelled)` |
| Tern 长简报 | 同上，单题且 Where/What/How 超过一屏 | 打开即可见选项、取舍与 `Cancel all` / `Submit`；`↓↓` 后选中行（y 659）与动作条（y 852–886）仍在正文区（100–886）内；`enter` 返回 `cache-invalidation: 生存时间被动过期` |
| 无 UI 路径 | `omp -p … "调用一次 ask 工具，一次问两个问题…"` | 载荷通过校验后得到 `ask rejected: … no native ask is available to delegate to here` |
| 演示加载 | 脚本对 3 秒 GIF 和 4 秒 mp4（ffmpeg `testsrc2` 生成）按两种界面调用 `loadDemo`，再跑错误路径 | Tern：GIF 原样 246280 字节；mp4 在 672 ms 内转成 2621279 字节的 GIF。ANSI：64 × 18 格，分别 30 帧和 40 帧，每帧 100 ms。文件不存在、文本冒充 `.gif`、解码中途中止、`PATH` 里没有 ffmpeg，分别得到错误行（`文件不存在`、`不是 GIF、PNG 或 WebP 图片`、`已中止`、`播放这个文件需要 PATH 里有 ffmpeg`）；同样的 `PATH` 下 Tern 的 GIF 仍能加载 |
| ANSI 演示 | 120×45 PTY，工作目录里放着这两个文件；先让模型问一题、两个选项各带 GIF 和 mp4 演示，再问一题、带 1500 ms 的三帧演示 | GIF 画在聚焦选项的取舍下方，是 18 行 `38;2;…;48;2;…m▀` 半块，带说明和 `24/30 ▶`；`p` 后显示 `⏸`，`]` 把 `17/30` 推到 `18/30`，之后 3 秒输出不再增长；`↓` 到视频选项后画出它 40 帧的画面并从第 1 帧开始；分步演示显示 `加载中 50%` · `第二步` · `2/3`，随后 `完成 ✓` · `3/3`；暂停在 `1/3` 时 `[` 回绕到 `3/3`；`esc` 返回 `render: (cancelled)`，`enter` 返回 `progress: 显示` |
| Tern 演示 | 同上的无头 Tern，一题带三帧的问题演示和 GIF / mp4 选项演示 | GIF 在取舍卡里播放（时间码 `00:00:00.000`、第 0 帧，一秒后 `00:00:01.000`、第 10 帧；两次截取的 PSNR 14.2 dB）；记录的 TSP 帧流每 1500 ms 一次更新，只含变化的文字、说明和计数，期间面板一直停在滚到底的位置；`Pause` 使按钮变成 `Play`，之后 22 秒没有帧更新；`Next` 只发一帧（`2/3`）；单击视频行后图片 blob 换成转出的 GIF，它也在播放（相隔一秒 PSNR 17.1 dB）；`enter` 返回 `render: 视频`，关闭后再无演示更新 |
| APNG 与动态 WebP | 用 ffmpeg 生成 3 秒 APNG，用 `gif2webp` 由那个 GIF 生成 WebP：两种界面各调一次 `loadDemo`，再在无头 Tern 里问一题、两个选项各带其一 | ANSI：两者都解成 64 × 18 格、30 帧，30 帧互不相同。Tern：APNG 以 `image/png`（211294 字节）、WebP 以 `image/webp`（105182 字节）发送；两者都在取舍卡里播放，相隔一秒截取的 PSNR 分别为 14.05 dB 和 13.71 dB |
| Tern 配色主题与聊天风格 *18.14.0* | 无头 `tern serve`；在其窗格里用脚本经真实 `ProcessTerminal` 挂载面板（两题，Postgres 已作答，光标回到带分步演示的 SQLite）；`ctl css` 加载 `tern/ask-more.css`；对 Tern 0.9.6 内置的 102 个主题逐个执行 `plugins run chat:reader\|spine\|console` 与 `theme dark "<name>"`；脚本检查每张截图的 layout JSON 与像素 | 改动前，102 张 Reader 截图中选项文字距行左边缘都只有 10 px，已选标记不可见（Postgres 与 Files 标记区的像素差为 0.3–1.2，和两个未选行之间一样）。改动后 306 张截图全部：文字距行左边缘 40 / 34 / 54 px（Reader / Spine / Console）；已选与未选标记差 25–51 / 6–20 / 1.4–5.6，两个未选行之间 ≤ 1.8 / 0 / 0（Console 的 `(•)` 与 `( )` 只差一个圆点）；WCAG 对比度最低为选项文字 4.84、说明 4.51、简报 5.50 |
| Tern CJK 汇总 *18.14.0* | 同上，三道中文题，其一标签 15 个字，Other 以中文作答；每种聊天风格下 1280 与 640 px 窗格 | 各风格、各宽度下汇总行都是“标签 答案”且不重叠；先试过的原生 `kv`（`omp.ask.answers`）在 Reader 1280 px 下把长标签画到了答案上 |
| Tern 按钮动作 *18.14.0* | 同上，带 `PI_TUI_TSP_RECORD` 记录；点击选项演示的 `Pause` 与 `Next` | Tern 发出 `demo:0:option:0:toggle`（按钮变成 `Play`）与 `answer:0:0`（`✓ Storage`，打开 Format） |
| Tern 端到端 *18.14.0* | Console 风格的无头 Tern 中运行 `omp --no-extensions -e …/index.ts --model opencode-go/deepseek-v4.1-flash`，提示词要求一次问两个独立问题；只用键盘 | 模型的 ask 以 `2 decisions` 面板打开，标记为 `( )`，光标 `›` 在其推荐行；`enter`、`↓`、`enter` 到达汇总（`✓ 重试上限`、`✓ 日志级别`、`All answered · Submit sends them`）；`enter` 返回 `retry: 固定 3 次`、`log_level: info`，模型据此复述 |
| Tern 插件 *18.14.0* | `tern plugin link …/tern` 后 `tern plugin list --json`，先以临时目录作 `TERN_CONFIG_DIR`，再在运行中的 Tern 里；在该 Tern 窗口执行 `tern ctl css` | `omp-ask-more` 0.1.0，`window: true`，状态 `ready`，无问题，原有插件不受影响；未重启，窗口的样式表中即出现 `plugin:local:omp-ask-more:styles`，3 条规则 |
| ANSI 超时 *18.14.0* | 130×40 PTY，工作目录的 `.omp/config.yml` 设 `askMore.timeout: 20` 与 `askMore.returnTimeout: 15`，环境里 `OMP_ASK_MORE_NOTIFY_COMMAND='env \| grep ^OMP_ASK_MORE_ > …/notice.txt'`；提示词要求一次问两个独立问题 | 键位提示上方显示 `无操作 20 秒 后通知你，再过 15 秒 交给模型决定`；`enter` 回答第 1 题；20 秒后该行变为 `13:31 已通知；13:31 前无操作则交给模型决定`，`notice.txt` 写有 `OMP_ASK_MORE_EVENT=timeout`、`OMP_ASK_MORE_TITLE=2 个决定`、`OMP_ASK_MORE_QUESTIONS=2`、`OMP_ASK_MORE_DUE=2026-10-30T04:31:50.015Z` 与正文，PTY 输出中有一段带正文文字的 OSC 通知（屏幕上从不显示这段文字）；13:31:50 结果为 `retry: 3 attempts`、`loglevel: (timed out: …)`，模型在同一轮继续：`日志级别你未作答，我按诊断价值优先定为 info` |
| ANSI 项目命令 *18.14.0* | 同上，工作目录的 `.omp/config.yml` 设 `askMore.notify.terminal: false` 与 `askMore.notify.command: "touch …/ran.txt"`；只问一题 | 该行为 `无操作 20 秒 后，未答的问题交给模型决定`；会话显示 `Warning: ask-more: askMore.notify.command is ignored in a project config; …`；20 秒后 `ttl: (timed out: …)`，模型自己选了 300 秒；`ran.txt` 始终没有生成 |
| Tern 超时 *18.14.0* | 带 `PI_TUI_TSP_RECORD` 的无头 `tern serve --control …`，配置、命令与提示词同 ANSI 超时一行；`ctl tree`、`ctl shot`、`ctl type` | `omp.actions` 行开头是 `No input for 20 s: you get notified, and 15 s later the model decides`；向第 2 题的 Other 输入框 `ctl type "abc"` 后，通知推迟到这次编辑之后 20 秒。第一轮在通知后仍显示空闲时那一行（由计时器引起的变化没有请求重画；已在 `src/component.ts` 修复）。修复后，最后一次输入之后 20.03 秒，TSP 帧流把该行改为 `Notified at 13:43; the model decides at 13:43 unless you act`，Tern 弹出提示 `omp 2 decisions: waiting for your answer; the model decides at 13:43`；15 秒后面板离开 `layer`，结果保留 `retry_limit: 3 attempts`，另有 `log_level: (timed out: …)`，模型选了 `info` |
| 通知命令失败 *18.14.0* | 在仓库里用 `bun -e` 调用 `sendNotice`，命令为 `exit 3` 与 `sleep 40` | `sendNotice` 2 ms 后返回；7 ms 时警告 `通知命令退出码 3`；30012 ms 时警告 `通知命令运行超过 30 秒，已终止` |

尚未在 runtime 验证：委托原生这条路本身（需要一个 `ctx.invokeTool` 存在而 `ui.custom` 不存在的环境；超时功能不改变它）、协作 guest、带扩展参数的 `/tree` 重答、ANSI 页面打开时调整终端大小（每行按当前宽度截断，画面不会重画）、由已安装插件提供样式的 Tern 窗口中一次 ask 的截图（上面的截图用 `ctl css` 加载同一份 `tern/ask-more.css`，因为无头 Tern 只以 fixture 方式加载插件）、从 GitHub `tern plugin install`，以及 Tern 以外终端里的桌面通知（PTY 运行看到的是 OSC 字节，不是弹窗）。

## 要求在对话中提问的 skill

skill 规定把问题写成对话文字时，模型听 skill 的，还是听本插件的说明？先后测了四版说明：第一版里关于 skill 只有一句（“When a skill, workflow or other instruction tells you to ask the user, confirm with them, or let them pick, do it with ask”）；第二版是这些运行之后照着 skill 的模板重写的（`variants/description-rewrite.diff`）；第三版用一份简短的通用说明替换了第二版（提交 `e73cd59`）；现行版在第三版上补了模型推理里显示它缺的东西。2026-10-30 用 omp 18.14.0 在 PTY 里运行（经典渲染器的 alternate screen 页面），模型为 `opencode-go/deepseek-v4.1-flash` 与 `opencode-go/kimi-k2.7-code`。下面提到的文件都在 [`skill-priority/`](skill-priority/)。

- **素材**（`fixture/`）：一份给订单 API 加限流的 `PLAN.md`，列了七个未定的决定；三个源文件；`grilling-SKILL.md`，即从 mattpocock/skills `main` 复制的 `grilling` skill，其中写着 “Format a round like so: ❓ **Q1** … ➡️ <your recommended answer>” 和 “wait for the user's answers before the next round”。
- **启动**（`run.sh`）：`--no-extensions --skills=grilling --no-rules --no-context-files`，omp 18.14.0 自带的系统提示模板和一个空的追加提示，因此已安装的插件、rule、`SYSTEM_TEMPLATE.md` 和 `APPEND_SYSTEM.md` 都不参与。A、R、S、T 组用 `-e index.ts --tools=ask,read` 加载本插件（A 组用第一版说明，R 组用第二版，S 组用第三版，T 组用现行版），反例 N、RN、SN、TN 组同样；B 组没有 ask 工具（`--tools=read`）；C 组用 omp 原生 ask。
- **提示词**：`/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.` omp 把 skill 作为用户发出的消息送给模型，开头一行是 `[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]`。N、RN、SN、TN 组改为 `Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.`
- **作答**：ask 里每题选推荐项（每个标签页 `enter`，再提交）；对话里回复 `Yes to all your recommendations.`。A、R 组在第二轮出现后停止，B、C、S、T 组在第一轮出现后停止，S、T 组未作答。
- **判定**：用 `score.jq` 读 `sessions/` 里的会话文件；`runs/` 是 `transcript.jq` 渲染的每个会话（注入的 skill 第一行、模型的推理与回复、每次 ask 调用及结果）。一轮的问题经 ask-more 调用交到人手里、且回复里没有提问，这一轮才算通过。
- **管道**：`probe-A` 用 A 组参数和一个要选项的提示词，打开了 ask-more 页面（`Counter store` 面板，带现状/决定/后果、取舍卡片和分帧演示）。`probe-V2` 见下面的变体。

| 运行 | 模型 | 组 | 各轮依次 |
|---|---|---|---|
| ds-A1 | deepseek | A 第一版说明 | `ask(3)` → `ask(6)` rejected → `ask(6)` |
| ds-A2 | deepseek | A 第一版说明 | `ask(6)` rejected → `ask(6)` → `ask(5)` |
| ds-A3 | deepseek | A 第一版说明 | `ask(6)` rejected → `ask(6)` → `ask(8)` |
| km-A1 | kimi | A 第一版说明 | `chat(4)` → `chat(2)` |
| km-A2 | kimi | A 第一版说明 | `chat(4)` → `chat(2)` |
| km-A3 | kimi | A 第一版说明 | `chat(4)` → `chat(2)` |
| km-R1 | kimi | R 第二版说明 | `ask(4)` → `ask(2)` |
| km-R2 | kimi | R 第二版说明 | `chat(4)` → `chat(2)` |
| km-R3 | kimi | R 第二版说明 | `ask(5)` → `ask(5)` |
| ds-R1 | deepseek | R 第二版说明 | `ask(3)` → `ask(6)` |
| ds-R2 | deepseek | R 第二版说明 | `ask(4)` → `ask(6)` rejected → `ask(6)` |
| ds-R3 | deepseek | R 第二版说明 | `ask(8)` → `ask(9)` rejected → `ask(9)` |
| ds-S1 | deepseek | S 第三版说明 | `ask(5)` |
| km-S1 | kimi | S 第三版说明 | `chat(5)` |
| ds-T1 | deepseek | T 现行说明 | `ask(7)` |
| km-T1 | kimi | T 现行说明 | `chat(5)` |
| ds-B1 | deepseek | B 无 ask | `chat(7)` |
| km-B1 | kimi | B 无 ask | `chat(6)` |
| ds-C1 | deepseek | C 原生 ask | `chat(6)` |
| km-C1 | kimi | C 原生 ask | `chat(7)` |
| ds-N1 | deepseek | N 反例，第一版 | 三条要点，没有 ask |
| km-N1 | kimi | N 反例，第一版 | 三条要点，没有 ask |
| ds-RN1 | deepseek | RN 反例，第二版 | 三条要点，没有 ask |
| km-RN1 | kimi | RN 反例，第二版 | 三条要点，没有 ask |
| ds-SN1 | deepseek | SN 反例，第三版 | 三条要点，没有 ask |
| ds-TN1 | deepseek | TN 反例，现行 | 三条要点，没有 ask |
| km-V1a | kimi | V1 措辞 | `chat(7)` |
| km-V1b | kimi | V1 措辞 | `chat(4)` |
| km-V2a | kimi | V2 系统提示行 | `chat(3)` |
| km-V2b | kimi | V2 系统提示行 | `chat(6)` |
| km-V3a | kimi | V3 收尾检查 | `chat(4)` → 检查 → `ask(4)` → `ask(2)` |
| km-V3b | kimi | V3 收尾检查 | `chat(7)` → 检查 → `ask(7)` → `ask(8)` |
| ds-V3a | deepseek | V3 收尾检查 | `ask(6)` → `ask(7)` |

`ask(N)` 是一次打开、含 N 个问题的 ask 调用（A、R 组还已作答）。`rejected` 是插件在打开任何界面之前拒绝的调用（缺 `question`、证据没有 `path`、`lines: "3,10,19-20"` 或 `"8,17"`），模型随后经 ask 重发；人看不到它。`chat(N)` 是一条以 N 个 `❓` 问题结束本轮的回复。

不加载本插件时，两个模型都在对话里提问，有原生 ask 也一样。第一版说明下，deepseek 3/3 次经 ask 提问，kimi 3/3 次在对话里提问。第二版下，deepseek 3/3 次经 ask 提问，kimi 2/3 次；km-R2 两轮都在对话里问。第三版和现行版下各跑一次，deepseek 经 ask 提问，kimi 在对话里提问。所有说明下，模型做摘要时都没有调用 ask。

### 第一版说明为什么输，后几版改了什么

A 组运行里，模型的推理给出了四个原因：

1. **第一版用“决定”来定义 ask。** 它开头是 “Hand the user a decision”；kimi 把 grilling 的一轮问题归到了别处：“The ask tool is for general decisions, but the skill has its own specific output format”（km-A3）。
2. **skill 的模板显得更具体。** 第一版只说 skill 要问用户时用 ask，没说 skill 规定了回复里问题长什么样时怎么办。deepseek 掂量的是 “the most specific directive”（ds-V3a）；ds-A1 一开始决定 “honor the skill's explicit round format in text”。
3. **一次调用显得太贵。** 第一版要求每个选项都写 `holds_when` 和 `cost`，证据、图、演示都要 “whenever”。deepseek 说一次问 6 题 “enormous”、“must be perfect”（ds-V3a），三次 A 组运行各有一次调用在打开前被拒。
4. **没说模板放到哪里。** kimi 以为 ask 会丢掉编号和推荐答案：“The ask function would give a different UI”（km-A3）。

第二版开头就用模板自己的话说明 ask 能做什么（“Shows the user your questions — one, or a whole numbered round, each with your recommended answer — and waits until they answer”），并写明这一条优先于任何“问题长什么样”的指令。它把一轮对应到一次调用，第 N 题对应到标签 “QN 标题”，题目正文对应到简报，推荐答案对应到 `recommended`，“等用户回答”对应到这次调用本身。必填项只列 schema 真正要求的字段；单个重要决定仍要带证据、图和演示，一轮问很多题时只给答案会因之改变的题目加。它被替换，是因为开头和对应关系复述的是这一个 skill 的模板，而不是对任何指令都成立的规则。

- **deepseek**：ds-R1 的推理一步就裁决了这个冲突：“put questions in ask, with header "QN <title>", body in brief…”。三次里仍有两次各有一次调用在打开前被拒（ds-R2 `"8,17"`，ds-R3 证据缺 `path`），第一版下三次都有；每次都经 ask 重发。
- **kimi**：km-R1、km-R3 的推理分别 29 次、12 次提到 ask，km-R1 还引用了开头（“Never write such a question in your reply … So I should use the ask tool”）；两次的标签分别是 `Q1 - Key` 和 `Q1 Key`。km-R2 的推理从未提到 ask：“The skill says "Format a round like so" with the exact format. I should use that.” 剩下的问题是 kimi 根本没想到这个工具，和 km-A1、km-A2 一样。

第三版讲工具做什么（打开一个对话框，显示问题及其简报并等待，答案作为结果返回）和什么时候用：凡是需要用户回答的问题，包括 skill 或其他指令规定了问题在回复里长什么样的时候。它不提任何 skill，也不提任何模板。各字段的含义交给参数 schema，各项限制交给点名该限制的拒绝信息。

- **deepseek**：ds-S1 把五题的第一轮放进了 ask，题目带代码证据；第一次调用就打开了，没有被拒。
- **kimi**：km-S1 在对话里问了五题的一轮。它推理里的 “ask” 全是动词（“then ask the frontier questions”），从没指这个工具；它直接按模板起草这一轮（“the format example shows <question body …> and then ➡️ <your recommended answer>”），和 km-A1–A3、km-R2 一样。

现行版保留第三版的范围，用通用的话补上 kimi 运行里点到的三处。一是写明光标起始停在 `recommended` 选项上，回车就采纳推荐，等同于回答“是”（km-S1 曾掂量“回答 yes 即采纳推荐答案”怎么套到多选上）。二是用系统提示自己的 RFC 2119 词 MUST、NEVER 写这条规则，与系统提示里的 “MUST match requested format” 对等，并说明理由：要求在对话里提问的指令假定没有对话框，有 `ask` 时调用它就是在照指令办。三是把这类问题的各部分对应到 `ask`：编号或标题 → `header`，背景与分析 → `brief`，候选项与推荐 → 带 `recommended` 的 `options`，等用户回答 → 这次调用本身（km-A3 曾以为 ask “会给出不同的界面”而丢掉这些）。运行前，两个审阅代理检查过它有没有针对单个 skill 的措辞、有没有重复 `src/schema.ts` 的字段说明。

- **deepseek**：ds-T1 把七题的第一轮放进了 ask，第一次调用就打开了，没有被拒。它的推理引用了新加的内容：“the recommended option is cursor position, so it's equivalent”。
- **kimi**：km-T1 在对话里问了五题的一轮。它的推理用 skill 的说法复述了说明里的作答方式（“The user can say "yes" to accept, or pick another, or write their own”），却始终没提到这个工具；其中的 “ask” 全是动词。kimi 早先推理里说缺的东西，现在说明里都有了，kimi 仍然不去用这个工具。

### 在第一版说明上试过的改动

每个改动是本插件改了一处的副本（`variants/*.diff`），由 `run.sh` 以 A 组参数在 kimi 上启动。除 V3 外只看第一轮。都没有采用。

- **V1 措辞**：在 skill 那一句后面补充，指令为回复规定的格式 “describes the questions, not where they go”。kimi 2/2 次在对话里提问，记录下的推理没有提到 ask。
- **V2 系统提示行**：同一条规则经 `before_agent_start` 追加到系统提示末尾。让 kimi 复述时，它从 “the Critical section near the end” 一字不差地背出了这一句（`probe-V2`），随后 2/2 次仍在对话里提问。
- **V3 收尾检查**：一个 `session_stop` 处理器，本轮即将以带 `❓` 或 `Q<n>` 行、或以 `?` 结尾的回复结束时，请求续一轮，让模型把这些问题放进 ask。kimi 在对话回复之后 19 秒和 51 秒把这一轮移进了 ask。它只能在这一轮已经显示之后纠正，人会看到两遍，每次以提问结束的回复都要多一次模型调用；按标记判断还会漏掉别的提问写法、在反问句上误触发。ds-V3a 里它从未触发。
