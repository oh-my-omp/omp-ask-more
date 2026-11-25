# omp-ask-ng

[English](README.md) | 简体中文

- **`ask` 工具**
  - `ask` 工具注册 — 功能：注册名为 `ask` 的工具替换宿主自带的 `ask`，它的 `execute` 解析问题、读取证据，经 `ctx.invokeTool({ html })` 把一张编译好的 HTML 表单交给宿主的 `ask`。时机：在工具启用的会话中，模型调用 `ask` 时。实例：`index.ts` 的 `pi.registerTool(tool)`，调用处是 `invoke<AskToolDetails>({ html: compileForm(questions, evidence, demos) }, …)`。
  - 工具标志 — 功能：声明 `loadMode: "essential"`、`approval: "read"`、`strict: true` 和 `concurrency: "exclusive"`：工具始终提供给模型、不需要特殊审批、provider 把参数约束在 schema 之内、同一时间只开一张表单。时机：插件加载注册工具时固定。实例：`index.ts` 的 `strict: true`、`concurrency: "exclusive"`、`loadMode: "essential"`。
  - 对话记录卡片正文 — 功能：在宿主自己的 ask 卡片标题下画出结果的 `details`：每个问题及其答案或 `(no answer)`、选项备注和超时提示；调用与结果合成一张卡片。时机：宿主渲染 `ask` 工具结果时。实例：`index.ts` 的 `renderResult: (result) => renderAskResult(result)` 与 `mergeCallAndResult: true`，`src/render.ts` 的 `renderAskResult`。
  - 工具说明 — 功能：工具说明写给模型（≤200 字符），说明用途并指向 `help://ask/routing`。时机：`ask` 提供时出现在 prompt 的 tools 段。实例：`src/description.ts` 的 `DESCRIPTION` 引导模型按需读取 `help://ask/routing`。
- **参数 schema 与调用拒绝**
  - `parametersSchema` — 功能：wire schema 是一个只包含 `questions[]` 的根对象；每个问题内联携带 `id`、`question`、`header?`、`brief {where, what, how, diagram?, risks?}`、可选 `evidence_files[]`、`evidence_quotes[]`、`demo_frames[]` / `demo_file`、`options[{label, description?, tradeoff, holds_when?, cost?, demo_frames?, demo_file?}]`（2–5 个）和 `recommended?`。时机：模型调用 `ask` 时作为工具的 `parameters` schema。实例：`src/schema.ts` 的 `parametersSchema`；一次调用形如 `ask({ questions: [{ id: "retry-strategy", …, evidence_files: [{ path: "src/retry.ts", start: 41, end: 58 }] }] })`。
  - `parseParams`/`validate` — 功能：把内联证据与演示映射为内部的判别联合，并拒绝 schema 表达不了的问题——同一问题或选项上同时传 `demo_frames` 和 `demo_file`、问题 id 重复或为空、`label` 以 "Other" 开头、`recommended` 下标越界——在任何界面打开前一次列出每个问题的全部问题。时机：每次 `ask` 调用，`execute` 的第一步。实例：`src/schema.ts` 的 `parseParams`。
  - `rejectedResult` — 功能：拒绝以 error 结果返回，正文是 `ask rejected:` 加每个问题一条 `- <problem>` 行；在不能向用户提问的会话里则直接拒绝。时机：`parseParams` 发现问题时，或 `ctx.invokeTool` 不存在时（如 print 模式）。实例：`index.ts` 的 `"ask needs an interactive session, and this session cannot prompt the user"`，以及 `src/result.ts` 的 `rejectedResult`。
- **发给模型的 topic**
  - `help://ask/routing` — 功能：同时经原生 `docTopics: toDocTopics(ASK_TOPICS)` 与 `omomp-shared/internal-url.ts` 的 `registerToolTopics("omp-ask-ng", ...)` 提供 `src/topics/routing.md`；要求模型把所有需要用户回答的问题——包括 skill 或工作流要求在对话里问的那些——都交给 `ask`，并把指令的各部分对应到 `header`、`brief`、内联证据/演示、`options`/`recommended` 和调用本身。时机：把问题、选择或确认交给用户之前读。实例：`src/topics/routing.md` 开头是 "You MUST put every question that needs the user's answer through `ask`"。
- **skill 消息规则注入**
  - Skill ask 规则（`context` 钩子）— 功能：一个 `context` 事件钩子，在 `ask` 启用时往发给模型的用户调用 skill 消息副本末尾追加一条规则，让规定在对话里提问的 skill 仍把问题交给 `ask`；持久化的消息、`/tree` 和导出的对话记录保持原文。时机：每次模型调用前，外发历史里有用户归属的 skill 提示消息（`/skill:<name>`）时。实例：`index.ts` 的 `pi.on("context", …)` 调用 `withSkillAskRule`，追加 `src/skill-prompt.ts` 的 `` `[IMPORTANT: Any question, confirmation or choice the skill above puts to the user MUST go through the `ask` tool, NEVER into your reply, even where the skill says to ask in chat or shows how the questions look in your reply. Keep their content, order and recommendations.]` ``。
- **表单编译与证据**
  - `compileForm` — 功能：把整次调用编译成一张 `<form>`，每个问题一个 `<fieldset>`——`<legend>` 标题、现状/决定/后果段落、证据、画成文字的 Mermaid 图、风险、问题演示图、各带取舍且标出 `（推荐）` 但不预选 radio 的选项、选项演示图，然后是题干和以问题 `id` 命名的 `radio` 输入。时机：每次通过校验和可读性检查的 `ask` 调用。实例：`src/form.ts` 的 `compileForm` 包裹 `questionHtml`，后者输出 `<fieldset>`…`<label><input type="radio" name="${id}" value="${label}">`。
  - `resolveEvidence` — 功能：文件证据由它自己读取——`start`-`end` 含两端、只给 `start` 是一行、都不给显示文件前 40 行、只读到 `end` 为止——tab 按两个空格显示、去掉行尾空白；引用文字显示在模型写的来源名下，并标明未读取核对；目录或读不到的文件显示原因而不阻塞这次 ask。时机：每次通过的 `ask` 调用，在表单打开前（`resolveEvidence` 按问题并行运行）。实例：`src/brief.ts`；文字证据在 `src/form.ts` 渲染为 `<source> · 直接引用，未从磁盘读取核对`。
- **可读性检查**
  - 可读性检查 — 功能：解析宿主的 `judge` 角色链（`modelRoles.judge` 及其后备，链里没有原生判定模型时才用会话模型兜底），让它对每个问题的表单一节里的每个句子和每个编号或缩写（issue 编号、`§3`、提交哈希、`VM110` 这类词）回答是非题，同时最多 8 个判定、总时限 30 秒，费用记为 `ask-readability`。时机：每次 `ask` 调用、参数校验之后、任何界面打开之前；只在 `readability.judge` 开启且会话能解析出 judge 时进行。实例：`index.ts` 的 `sessionJudge`/`resolveJudge`；`src/readability.ts` 的句子问题 `actor`/`unshown`/`jargon`，`JUDGE_DEADLINE_MS = 30_000`。
  - `readabilityProblems` 拒绝 — 功能：只要有一个句子没说明谁或什么在做、只用名称或编号提到对话框不会显示的东西、或含有解释不了的行话，或有一个编号既非常识也没在对话框里说明，就拒绝整次调用——拒绝里引用每个不合格的句子并给出原因、列出每个不合格的编号。时机：表单打开之前。实例：`src/readability.ts` 的 `readabilityProblems` 写出 `question "retry-strategy" is hard to understand for a reader who sees only this dialog …`。
  - 重试放行与判定失败 — 功能：上一次 `ask` 工具结果是这次拒绝时（按拒绝标记识别）跳过判定放行；判断模型出错、超过时限或设置值无效时显示警告并放行；只有调用方自己的中止才取消这次 ask。时机：每次 `ask` 调用。实例：`src/readability.ts` 的 `gateUnlessRetry`/`lastAskRejected`，警告 `readability check skipped: ${detail}`。
- **设置**
  - `readability.judge` 设置 — 功能：布尔型插件设置，默认 `true`，在 `package.json` 的 `omp.settings` 声明，每次 `ask` 调用经 `getPluginSettings` 读取；非布尔值警告 `readability.judge must be true or false` 并跳过检查。时机：每次 `ask` 调用可读性检查开始时读取。实例：`package.json` 的 `omp.settings`，`src/settings.ts` 的 `readReadabilityJudge`；用 `omp plugin config set omp-ask-ng readability.judge false` 或项目级 `.omp/plugin-overrides.json` 设置。
- **结果改写**
  - `answeredResult` — 功能：把宿主 `ask` 结果的正文改写成 `User answers:` 加每题一行（按提问顺序）——`id: label`、自写答案为 `id: "text"`、`id: (no answer)` 或 `id: (timed out: the user did not answer; decide it yourself with your best judgment and say what you chose)`——后面跟 `Option notes:` 行；`details`、备注图片和提示原样保留。时机：宿主的 `ask` 返回后、每次作答的调用。实例：`src/result.ts` 的 `answeredResult`。
- **语言解析**
  - `tr` 语言解析 — 功能：面向人的文字（表单标签如现状/决定/后果、证据、选项，以及警告）按 `OMOMP_LANG`、再按 `LC_ALL`/`LC_MESSAGES`/`LANG`、否则英文解析为英文或中文，每次生成时重读；发给模型的文字保持英文。时机：插件产生界面文字时——编译表单的标签、警告通知、注册的工具 label。实例：`src/form.ts` 的 `tr("Evidence", "证据")`，`tr` 来自 `omomp-shared/i18n.ts`。
- **eval 脚本**
  - `eval/readability.ts` — 功能：把记录下来的 ask 经 `parseParams` 和真实的可读性检查重放，judge 用本地 omp 设置解析出的 `judge` 角色链，按 `hard`/`readable` 标注统计被拒的问题；默认语料是 `eval/readability-labelled.json`。时机：手动运行，`bun eval/readability.ts [corpus.json] [--session-model provider/id] [--out findings.json]` 或 `bun run eval:readability`。实例：打印 `` | rejected questions | `hard` questions not rejected | `readable` questions rejected | ``。
