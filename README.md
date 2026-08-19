# Learning OS · Incident Lens

> 把学习投入沉淀为可验证的工程证据，同时探索 AI 事故响应的安全边界。

Learning OS 是一个面向个人使用的学习与工程成长仪表盘。它把每天的行动、计时、计划、证据和复盘集中管理，并支持从 GitHub 和 LeetCode.cn 读取公开数据，减少重复登记。

项目的作品集主线是 **Incident Lens**：一个面向值班工程师的 AI 事故指挥台。它关注告警、变更、日志和指标之间的证据链，在不允许 AI 擅自修改生产环境的前提下，生成可审计的根因判断和下一步检查建议。

## 当前功能

### 日报与计时

- 按日期记录当天的学习和工程投入。
- 支持开始、暂停、继续和结束计时；计时中也可以修改能力主线和关联计划。
- 支持快速登记，并可手动编辑标题、时长、能力主线和关联计划。
- 支持删除事件，时长不是只能通过计时器累加。
- 页面刷新或浏览器关闭前，会保留正在进行的计时和本地草稿。

### 计划与复盘

- 支持跨日计划、优先级、目标日期、下一步和计划详情，可以编辑，也可以删除。
- 计划可以安排到某一天，也可以关联 GitHub 仓库。
- 计划列表默认只展开今日计划；未排入当天的进行中计划和已完成计划默认收起，减少信息噪音。
- “计划复盘”只展示当天有投入或证据的计划，默认收起。
- 卡点和明日第一步与具体计划关联；保存明日第一步时，会同步更新对应计划的 `next_action`。

### 证据与提交入账

- 支持文字证据、链接证据和 GitHub commit 证据，证据可以关联到具体计划。
- 关联 GitHub 仓库的计划会自动读取当天的公开 commit，并生成计划级证据。
- 快速登记和计时都先作为草稿：只有“提交入账”后才会落入统计库，并在近 7 天统计和历史档案中体现。
- 提交入账时可以勾选内容：事件与其关联证据一起入账；只有证据、没有计时时也可以提交，系统会按默认投入生成一条“证据对应投入”事件（默认 30 分钟，可在提交弹窗中修改）。
- 提交后面板不再显示草稿，记录进入“最后记录”；已入账的事件和证据支持撤销入账。

### 工作区与待办

- 工作区把计划、待办、资源和执行记录放在一起；一个工作区可关联多个计划，创建工作区时绑定一个未关联的计划。
- 工作区支持编辑名称、本地目录和说明；本地目录按 UTF-8 处理，中文路径不会乱码。
- 待办支持高、中、低优先级，以及待处理、进行中、已完成和已阻塞状态。
- 在工作区本地目录中投入工作时，计时会自动关联到该工作区的计划，不需要每次手动关联。
- Codex 本地会话按项目目录自动归属工作区；工作区还可以保存 DeepSeek 网页会话、其他网页、本地目录和文件产出。
- 当前阶段支持手动管理；本地连接器和 Codex Skill 负责同步执行步骤、文件元数据和 Git 证据。

### 本地连接器与 Workspace Skill（Phase 2A）

- `skills/learning-os-workspace/SKILL.md` 定义了 Codex 在项目工作区内读取待办、确认计划、更新执行步骤和记录证据的工作流。
- `scripts/learning-os-workspace.mjs` 提供本地连接器命令，可按当前目录匹配工作区，并创建或更新本地待办与执行记录。
- 配对后连接器优先使用用户 JWT 写入 Supabase；网络或 Supabase 不可用时写入本机 `%LOCALAPPDATA%\LearningOS\connector-state.json`，之后用 `sync` 补传。
- 配对码 10 分钟内有效且只能使用一次；连接器只保存自己的本地配置，不把 service_role key 放入 Skill。
- 连接器提供 `/version` 端点；`npm run dev` 启动时会探测 4317 端口上仍在运行的旧版连接器，并用最新代码替换，避免旧进程一直占用端口。
- 后台目录监听和自动扫描文件元数据仍属后续阶段；当前通过命令显式同步。

示例：

```powershell
node scripts/learning-os-workspace.mjs register --id WORKSPACE_ID --root D:\code\learning-os-github --name "Learning OS 项目"
node scripts/learning-os-workspace.mjs connect --code ABCD-EFGH-IJKL --cwd .
node scripts/learning-os-workspace.mjs serve --port 4317
node scripts/learning-os-workspace.mjs current --cwd .
node scripts/learning-os-workspace.mjs task list
node scripts/learning-os-workspace.mjs task create --title "实现工作区 Skill" --priority high --source skill
node scripts/learning-os-workspace.mjs execution start --task TASK_ID --title "实现工作区 Skill"
node scripts/learning-os-workspace.mjs evidence scan
node scripts/learning-os-workspace.mjs watch --interval 15000
node scripts/learning-os-workspace.mjs sync
```

### GitHub

- `/github` 页面读取当前 GitHub OAuth 用户拥有的公开仓库。
- 展示指定日期的 commit 次数、commit message、仓库和提交链接。
- 可以选择 commit，一键导入当天日报的证据区。
- 登录会话只用于识别 GitHub 用户名；读取公开仓库和 commit 优先使用 GitHub 公共 API，不依赖每次刷新都存在的 OAuth `provider_token`，重新登录后已导入的证据不会丢失。
- 项目只读取公开仓库，不上传或修改 GitHub 项目内容。

### LeetCode.cn

- 使用 LeetCode.cn 国内主站的公开用户名读取近期 Accepted 提交。
- 不需要 LeetCode 密码、微信登录凭证或复制 Cookie。
- 输入个人主页 slug，例如 `MapleLea1f`，读取指定日期的提交。
- 支持预览、选择题目、关联计划后导入日报。
- 导入事件默认记录 30 分钟，导入后仍可编辑。

### 历史档案

- `/history` 是独立页面，按日期查看历史记录。
- 展示当天事件、投入时长、计划、证据、卡点和明日第一步。
- 不显示没有实际使用价值的“主目标”字段。

## 路由

| 路由 | 用途 |
| --- | --- |
| `/` | 日报、计时、计划、证据和 LeetCode 同步 |
| `/github` | GitHub 公开仓库和 commit 展示、证据导入 |
| `/history` | 历史档案 |
| `/workspaces` | 工作区列表和创建 |
| `/workspace/:id` | 工作区详情、待办和资源管理 |
| `/api/incident/analyze` | Incident Lens 的事故分析 API |
| `/api/leetcode/submissions` | LeetCode.cn Accepted 提交读取 API |

## 自动保存与同步

日报记录不需要每次都点击“立即同步”：

- 普通编辑停止约 1.2 秒后，会自动保存到 Supabase。
- 计时结束、导入 GitHub 证据和导入 LeetCode 事件会立即触发保存。
- 页面顶部会显示“正在同步”“已自动保存”“离线草稿”等状态。
- 网络或 Supabase 暂时不可用时，记录会保留在浏览器本地，后续自动重试。
- “立即同步”用于需要立刻确认云端写入、切换日期或关闭页面前的手动强制保存。

第三方数据读取和日报保存是两个动作：GitHub 关联计划会在进入页面或切换日期时自动读取；GitHub 公开证据页不需要每天重新授权；LeetCode.cn 需要主动点击“读取今日提交”，确认后再导入。

## 技术栈

- Next.js、React、TypeScript
- Vinext、Vite
- Supabase Auth（GitHub OAuth）
- Supabase Postgres 和 Row Level Security（RLS）
- GitHub REST API
- LeetCode.cn 公开 GraphQL 接口

## 本地运行

### 环境要求

- Node.js `>=22.13.0`
- npm
- 一个 Supabase 项目
- 一个配置了 OAuth 的 GitHub 登录入口

### 安装依赖

```powershell
git clone https://github.com/MapleLea1f/learning-os.git
cd learning-os
npm.cmd install
```

### 配置环境变量

复制示例配置：

```powershell
Copy-Item .env.example .env.local
```

填写 `.env.local`：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

不要把 `service_role` key、GitHub OAuth client secret 或数据库密码放进前端环境变量，也不要提交 `.env.local`。

### 初始化 Supabase

1. 在 Supabase 创建项目。
2. 打开 SQL Editor，执行完整的 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Authentication 中启用 GitHub 登录，并按 Supabase 页面提供的 Callback URL 配置 GitHub OAuth App。
4. 使用 GitHub 登录一次后，在 Supabase 的 Authentication → Users 中复制当前用户 UUID。
5. 将 UUID 加入允许名单：

   ```sql
   insert into public.allowed_users (user_id)
   values ('YOUR_AUTH_USER_UUID')
   on conflict (user_id) do nothing;
   ```

> 如果工作区页面提示 `Could not find the table public.connector_pairings in the schema cache`，说明线上 Supabase 还没有执行最新数据库脚本。请在 SQL Editor 重新执行 `supabase/schema.sql`，等待 schema cache 刷新后再生成配对码。不要尝试在前端直接执行 SQL。

`allowed_users` 是第二层保护。只有登录用户同时出现在允许名单中，才能读写自己的学习记录和计划。

### 启动开发服务

```powershell
npm.cmd run dev
```

打开 `http://localhost:3000`。

Windows PowerShell 如果禁止运行 `npm.ps1`，请使用 `npm.cmd`。

## 常用命令

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

`npm.cmd test` 会先构建项目，再运行渲染测试。测试夹具如果与当前路由结构不一致，需要单独更新测试，不应通过修改业务代码绕过测试。

## 数据库变更

当项目新增字段或首次安装时，需要在 Supabase SQL Editor 执行最新版本的 [`supabase/schema.sql`](./supabase/schema.sql)。脚本包含现有安装的增量字段迁移，例如：

- `learning_days.events`
- `learning_days.evidence_json`
- `learning_days.plan_notes`
- `work_plans.github_repo`
- `work_plans.workspace_id`
- `workspaces`
- `workspace_tasks`
- `workspace_resources`
- `workspace_executions` 与 `workspace_execution_steps`
- `workspace_evidence`：Git 提交、文件路径和命令/测试元数据，不保存文件内容
- `connector_pairings`：配对码与 `refresh_token`，用于连接器自动续期

如果页面提示缺少字段、RLS 拒绝或同步失败，优先确认 SQL 是否已经在与 `.env.local` 对应的 Supabase 项目中执行。

## 安全与隐私边界

- 只使用 GitHub 公开仓库和公开 commit 作为自动证据来源。
- LeetCode 同步不要求密码、微信登录信息或 Cookie。
- 不要记录公司账号、密码、手机号、内部 IP、网络拓扑、客户信息、未脱敏日志或内部代码。
- Supabase 的浏览器端 key 是公开客户端 key，真正的访问控制由登录会话、`allowed_users` 和 RLS 共同完成。
- AI 事故分析只生成建议和证据化判断，不直接执行回滚、扩容、切流或配置修改。

## Incident Lens API

当前 API 接收告警、变更和结构化证据：

```http
POST /api/incident/analyze
Content-Type: application/json
```

示例请求：

```json
{
  "alert": {
    "title": "checkout 5xx rate above 5%",
    "service": "checkout-api",
    "severity": "critical",
    "observedAt": "2026-08-07T09:00:00+08:00"
  },
  "changes": [
    {
      "id": "deploy-1842",
      "summary": "upgrade payment client",
      "deployedAt": "2026-08-07T08:42:00+08:00"
    }
  ],
  "evidence": [
    {
      "type": "metric",
      "source": "prometheus",
      "content": "5xx 0.4% -> 8.7%; p95 420ms -> 2.1s"
    }
  ]
}
```

响应包含风险、置信度、带证据引用的根因假设、可证伪检查、人工审批要求和审计元数据。证据不足时应降低置信度并要求补充证据，而不是编造结论。

## 后续路线

- 接入 OpenTelemetry、Prometheus 和 Loki 适配器。
- 增加事故评测集、证据引用完整率和延迟指标。
- 增加故障注入、回放式演练和审计时间线。
- 在明确人工审批边界的前提下，接入可控的自动化 runbook。

## License

当前未附加开源许可证。代码主要用于个人学习、验证和作品集展示；如需复用，请先联系仓库所有者。