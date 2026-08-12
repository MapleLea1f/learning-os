# 日报「证据 / 关联 / 可编辑时长」需求梳理与实施计划（v1.0）

> 状态：grill 完成，决策已拍板，待实施。日期：2026-08-12。

## 0. 已拍板决策

| 决策 | 结论 |
| --- | --- |
| D1 范围与顺序 | 三件事都做，按 P3 事件可编辑 → P1 证据结构化+GitHub → P2 外部同步 的顺序实施 |
| D2 GitHub 展示页 | 独立页面 + 一键拉取某天提交进当天日报证据区；`evidence` 改为结构化 `jsonb` |
| D3 仓库范围与 token | 只读公开仓库，复用登录 `provider_token`；跟踪仓库列表存个人设置；私有仓库二期 |
| D4 文档证据 | 先只做「链接」；文件上传（Supabase Storage）放 Phase 3 可选 |
| D5 外部同步 | LeetCode = leetcode.cn 半自动同步（GraphQL）；英语 = 每日英语听力，数据出口待确认，先用快速登记兜底 |
| D6 事件编辑 | 允许手动补记，`minutes` / `title` / `category` / `planId` 均可编辑 |

## 1. 背景与现状

当前日报把「证据、卡点、明日第一步」当纯文本收，把「时长」当计时器的副产品，两者都无法与外部事实（GitHub 提交、LeetCode、英语 app）和内部计划（`work_plans`）建立关联，导致填写鸡肋。

| 现状 | 位置 | 问题 |
| --- | --- | --- |
| 证据 `evidence` | `learning_days` 单文本字段 | 只能粘贴文字，不能放链接/文件/GitHub 提交 |
| 卡点 `blocker` | `learning_days` 单文本字段 | 纯文本，与具体计划/事件无关联 |
| 复盘与明日第一步 `reflection` | `learning_days` 单文本字段 | 与 `work_plans.next_action` 各写各的，不同步 |
| 时长 | 计时器生成 `events[]`（`title/category/minutes/planId`） | 只能计时叠加，不能编辑或手动补记 |
| 计划关联 | 计时事件可关联 `work_plans` | 只有计时入口，缺少手动/外部来源 |
| GitHub 登录 | 仅用于身份（Supabase OAuth） | 未保存 token，无法读仓库提交 |

## 2. 用户视角的三个痛点

### P1 证据填不动
- 场景：做完项目一定会上传 GitHub → 希望有「提交次数 + commit message」的展示页；学习一定会沉淀文档 → 希望放文档链接或直接上传文档。
- 隐含诉求：证据应是「结构化、可追溯、最好能自动生成」的条目列表，而不是一段自由文本。

### P2 时长无关联、靠手填
- 场景：今天刷了算法 → 希望时长自动从 LeetCode 同步；学了英语 → 希望时长从对应 app 同步。
- 隐含诉求：时长尽量来自「客观来源」，并能对到具体计划，而不是纯手工输入。

### P3 时长不可编辑
- 场景：忘开计时器 / 计时不准 / 想修正 → 只能删掉重来。
- 隐含诉求：个人工具要允许「手动补记 + 事后修正」，不能只有计时叠加。

## 3. 目标

把日报从「填写」变成「收拢」：
- 能自动收拢的（GitHub 提交、LeetCode 时长）尽量自动；
- 不能自动的允许快速登记，且所有时长可随时编辑；
- 证据、事件、计划三者互相可关联、可追溯。

## 4. 方案

### 4.1 P3 事件可编辑 + 快速登记（地基，先行）
- 事件支持编辑：`minutes` / `title` / `category` / `planId` 均可改。
- 新增「快速登记」入口：不经过计时器，手动补一条事件（带 `source: manual`）。
- 兼容旧数据：无 `source` 的事件按 `timer` 处理。

### 4.2 P1 证据结构化 + GitHub 展示页
- `evidence` 从 `text` 改为结构化 `jsonb` 列表，条目类型：
  - `text`：自由文本；
  - `link`：文档链接（标题 + URL）；
  - `github_commit`：来自 GitHub 展示页，含仓库名、commit message、提交链接；
  - `file`（Phase 3 可选）：上传文档到 Supabase Storage，RLS 私有。
- GitHub 展示页：展示跟踪仓库的提交次数与 commit message 列表，可按日期筛选，选中后一键附加到当天证据。
- Token：复用登录 `provider_token`，仅调用公开仓库接口，前端直连 GitHub API。

### 4.3 P2 外部时长同步（半自动连接器）
- 事件增加 `source`：`timer` / `manual` / `leetcode`（`english_app` 预留）。
- LeetCode（leetcode.cn）：日报提供「从 LeetCode 同步」按钮 → 调用网页 GraphQL 拉取当日记录 → 预览候选 → 确认后生成事件（`source: leetcode`）。
- 英语 app：每日英语听力，数据出口待确认；确认前用「快速登记 + 手动补时长」顶住，确认后再做连接器。
- 兜底原则：任何同步失败都提示，可手动补记，绝不静默失败。

### 4.4 数据模型草案
- `learning_days.evidence`：`jsonb` 数组，条目 `{ id, type, text?, title?, url?, repo?, message?, commitUrl?, createdAt }`。
- `events[]` 条目：追加 `source: "timer" | "manual" | "leetcode"`（旧数据缺省视为 `timer`）。
- 新表 `user_settings`（`user_id` 主键）：`tracked_repos jsonb`（仓库列表）、`leetcode_username text`、英语 app 配置预留字段。

## 5. 决策记录

- D1 ✅ 三件都做，按 P3 → P1 → P2。
- D2 ✅ 展示页 + 一键拉取进日报证据，证据结构化。
- D3 ✅ 只读公开仓库，复用 `provider_token`，跟踪列表存设置表。
- D4 ✅ 文档证据先做链接，文件上传 Phase 3 可选。
- D5 ✅ LeetCode 走 leetcode.cn 半自动；英语 app 待确认，快速登记兜底。
- D6 ✅ 手动补记 + 完整编辑。

## 6. 实施阶段与验收标准

- **Phase 0（地基，约 1–2 天）**：事件编辑 + 快速登记 + 手动补时长。
  - 验收：能手动补一条事件；能改时长/标题/分类/关联计划；保存后历史档案正确；旧数据不丢。
- **Phase 1（证据，约 2–3 天）**：证据结构化（text/link）+ GitHub 展示页与一键拉取。
  - 验收：`/github` 页展示跟踪仓库当日提交（次数 + commit message）；可一键把选中提交加入当天证据；证据区按结构化条目展示。
- **Phase 2（同步，待可行性验证）**：LeetCode 半自动同步连接器。
  - 验收：日报「从 LeetCode 同步」拉取当日记录，预览确认后生成事件；接口失效时明确提示并允许手动补记。
- **Phase 3（可选）**：文档文件上传（Supabase Storage）+ 英语 app 连接器（待数据出口确认）。

## 7. 风险

- LeetCode 网页 GraphQL 为非官方接口，可能失效、被限流或调整字段；已用半自动 + 快速登记兜底。
- 每日英语听力大概率无公开数据出口，同步能力待验证，不强承诺。
- GitHub `provider_token` 的 scope 与有效期需在实现时验证；只读公开仓库，影响面小。
- 文件上传涉及存储成本与隐私边界（README 已声明隐私边界，需延续）。