# Learning OS

> 把每天的学习时间，沉淀成可验证的职业证据。

一个给个人使用的职业学习看板：用“具体事件 + 自动计时”记录每日行动，沉淀工程证据、卡点和复盘；配置完成后，使用**你自己的 GitHub 账号**登录，并通过 Supabase 在两台电脑之间同步。

![Learning OS social preview](./public/og-career-path.png)

> 已配置旧版看板的用户：请在 Supabase SQL Editor 再次运行完整的 [`supabase/schema.sql`](./supabase/schema.sql)。该脚本会安全新增跨日 `work_plans` 计划表和权限策略，不会删除已有的学习日记录或事件。

## 先弄清楚：三个东西分别做什么

很多配置出错，是把下面三件事当成了一件事。

| 东西 | 作用 | 你的数据在哪里 |
| --- | --- | --- |
| GitHub 仓库 | 保存项目代码、README 和版本记录 | `MapleLea1f/learning-os` |
| GitHub 登录 | 证明「当前操作的人是你」 | GitHub 身份信息，不保存学习记录 |
| Supabase | 保存学习记录、控制读写权限、实现两台电脑同步 | 你自己创建的 Supabase 项目 |

因此，**GitHub 登录成功不等于已经能同步**。首次登录后，还要把该 GitHub 身份对应的 Supabase 用户 UUID 加入白名单；这是刻意设计的第二道保护。

## 你将完成什么

完成本指南后，你应当能够验证下面四件事：

1. 本机打开看板，能看到界面。
2. 点击“使用 GitHub 登录”后，能回到看板。
3. 保存一条学习记录，刷新页面后记录仍在。
4. 第二台电脑使用**相同的 Supabase 项目**和**同一个 GitHub 账号**登录后，能看到同一条记录。

> 已配置过旧版看板的用户：本次更新会保存每段学习事件的标题、分类与计时结果。请再次在 Supabase SQL Editor 运行完整的 [`supabase/schema.sql`](./supabase/schema.sql)，其中的安全迁移会自动添加所需字段；原有记录不会被删除。

全程不需要 ChatGPT 登录，也不需要把公司信息、密码或内部数据写进看板。

---

## 第一部分：仅在本机运行看板（无需同步）

这一步只验证项目能运行。未配置 Supabase 时，页面会显示“预览模式”，记录不会写入云端。

### 1. 打开正确的项目目录

本机请使用目前与 GitHub 仓库对应的目录：

```powershell
cd D:\code\learning-os-github
```

> 不要在 `learning-dashboard` 或 `learning-os` 目录中继续开发；它们是旧副本，不是当前版本。

### 2. 安装依赖并启动

首次运行才需要安装依赖：

```powershell
npm.cmd install
```

每次启动开发服务器使用：

```powershell
npm.cmd run dev
```

打开浏览器访问：<http://localhost:3000>

> 在这台 Windows 电脑的 PowerShell 中请使用 `npm.cmd`，而不是 `npm`。这是为了避开系统对 `npm.ps1` 的执行策略限制，并非项目故障。

要停止服务，在运行命令的终端按 `Ctrl + C`。

---

## 第二部分：启用 GitHub 登录与两台电脑同步

预计用时约 20 分钟。请按顺序完成，**不要跳过“白名单”步骤**。

### 准备清单

- 一个你自己的 GitHub 账号。
- 一个你自己可管理的 Supabase 账号和项目。
- 两台电脑都能运行本项目；第二台电脑稍后会使用同一套 Supabase 配置。
- 本地开发地址：`http://localhost:3000`。

### 步骤 1：创建 Supabase 项目

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)，用你自己的账号登录。
2. 选择自己的 Organization，点击 **New project**。
3. 填写项目名，例如 `learning-os`；数据库密码请保存到密码管理器，**不要**写进仓库或看板。
4. 选择离你较近的区域，创建项目并等待状态变为可用。

这一步创建的是你的个人云数据库。两台电脑要同步，必须连接到**同一个** Supabase 项目，而不是各建一个。

### 步骤 2：创建两张数据表并启用权限规则

1. 在 Supabase 左侧打开 **SQL Editor**。
2. 点击 **New query**。
3. 打开本项目的 [`supabase/schema.sql`](./supabase/schema.sql)，复制全部内容到查询框。
4. 点击 **Run**。
5. 打开 **Table Editor**，确认看得到 `allowed_users` 和 `learning_days` 两张表。

这段 SQL 做了三件事：

- 创建 `learning_days`，用于保存每天的学习记录；
- 创建 `allowed_users`，作为仅允许你自己的账号写入的白名单；
- 启用 Row Level Security（RLS），使浏览器即使拿到公开客户端密钥，也无法读取或修改别人的记录。

如果这里执行报错，先不要继续后面的 OAuth 配置；请确认是在刚创建的项目中执行了完整 SQL。

### 步骤 3：取得 Supabase 项目地址和客户端密钥

在 Supabase 项目中，打开 **Connect**，或进入 **Settings → API Keys**，复制以下两项：

| Supabase 页面中的值 | 填入本项目的变量 | 说明 |
| --- | --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | 形如 `https://xxxx.supabase.co` |
| Publishable key（推荐）或 legacy anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 仅用于浏览器客户端 |

> 变量名中保留了 `ANON_KEY` 是为了兼容项目现有代码；新建 Supabase 项目优先使用 **Publishable key** 填入即可。
>
> **绝对不要复制** `sb_secret_...`、`service_role` key、数据库密码或 GitHub OAuth Client Secret 到 `.env.local`、网页表单或 GitHub 仓库。

### 步骤 4：创建 GitHub OAuth App

GitHub OAuth App 的职责只有一件事：让 Supabase 确认登录者确实是你的 GitHub 账号。

1. 登录 GitHub，依次进入 **头像 → Settings → Developer settings → OAuth Apps**。
2. 点击 **New OAuth App**（首次创建时按钮可能显示为 **Register a new application**）。
3. 填写：

   | 字段 | 本地开发时填写 |
   | --- | --- |
   | Application name | `Learning OS (personal)`，或你喜欢的公开名称 |
   | Homepage URL | `http://localhost:3000` |
   | Application description | `Personal learning dashboard`（可选） |
   | Authorization callback URL | **不要手写 localhost**；复制下一步 Supabase GitHub Provider 页面显示的 Callback URL |

4. 点击 **Register application**。
5. 在 OAuth App 页面记下 **Client ID**，然后点击 **Generate a new client secret**，立即复制生成的 Client Secret。

GitHub OAuth App 的 callback 只能填一个。这里应当填 Supabase 提供的地址，因为真实路径是：

```text
Learning OS（浏览器） → Supabase Auth → GitHub 授权 → Supabase Auth → http://localhost:3000
```

不要把 GitHub 回调地址直接填成 `http://localhost:3000`；那会造成 `redirect_uri` 或授权回跳错误。

### 步骤 5：在 Supabase 中启用 GitHub Provider

1. 回到 Supabase，进入 **Authentication → Providers → GitHub**。
2. 该页面会显示一个 **Callback URL**，通常形如：

   ```text
   https://<你的-project-ref>.supabase.co/auth/v1/callback
   ```

3. 把这个**完整地址**粘贴到刚才 GitHub OAuth App 的 **Authorization callback URL**，保存 GitHub OAuth App。
4. 回到 Supabase GitHub Provider 页面，启用 GitHub Provider。
5. 粘贴 GitHub OAuth App 的 **Client ID** 和 **Client Secret**，然后保存。

Client Secret 只应当出现在 GitHub 和 Supabase 的受保护配置页面中；它不属于前端项目文件。

### 步骤 6：允许应用回到本机地址

1. 在 Supabase 进入 **Authentication → URL Configuration**。
2. 将 **Site URL** 设置为：

   ```text
   http://localhost:3000
   ```

3. 在 **Redirect URLs**（或 Additional Redirect URLs）中加入：

   ```text
   http://localhost:3000
   ```

本项目登录后会回到当前站点根路径，代码中使用的是 `window.location.origin`，所以该地址必须被允许。以后部署到自己的域名时，再把完整的生产地址加入此列表。

### 步骤 7：把 Supabase 配置写入本机

在 `D:\code\learning-os-github` 执行：

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

将文件填写为（把示例值替换成你自己的值）：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://你的-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_你的公开客户端密钥
```

保存后，重新启动项目：

```powershell
npm.cmd run dev
```

`.env.local` 只留在你的电脑上，已经被 Git 忽略；不要执行 `git add .env.local`。

### 步骤 8：首次登录，并把自己加入白名单

1. 打开 <http://localhost:3000>，点击 **使用 GitHub 登录**。
2. 在 GitHub 授权完成后，页面会回到看板。此时你可能看到“等待授权”或“当前 GitHub 账号尚未获授权”，这是正常的。
3. 回到 Supabase，打开 **Authentication → Users**。
4. 找到刚刚登录产生的用户，复制其 **UUID**（不是 GitHub 用户名，也不是邮箱）。
5. 打开 **SQL Editor → New query**，把下面的 `YOUR_AUTH_USER_UUID` 换成刚复制的 UUID 后运行：

   ```sql
   insert into public.allowed_users (user_id)
   values ('YOUR_AUTH_USER_UUID')
   on conflict (user_id) do nothing;
   ```

6. 回到看板并刷新页面；状态应从“等待授权”变为“云端已连接”。
7. 随便填写一条测试学习记录，点击“保存今日记录”，然后刷新页面；记录仍存在即表示同步写入成功。

只有白名单里的 UUID 有权限读写数据。即使其他人知道网站地址或使用自己的 GitHub 账号登录，也不能读取你的学习记录。

---

## 第二台电脑如何接入同一份数据

第二台电脑不要新建 Supabase 项目，也不要再执行一次 schema 的建表 SQL。只需：

```powershell
cd D:\code
git clone https://github.com/MapleLea1f/learning-os.git learning-os-github
cd learning-os-github
npm.cmd install
Copy-Item .env.example .env.local
notepad .env.local
npm.cmd run dev
```

将第一台电脑的 **Project URL** 和 **Publishable key / anon key** 填入第二台电脑的 `.env.local`，然后使用**同一个 GitHub 账号**登录。因为该账号的 UUID 已在白名单中，两台电脑会读取和写入同一份 `learning_days` 数据。

> `.env.local` 不会跟随 Git 同步，这是安全设计。你需要在每台自己的电脑上各填一次，但两台电脑填的是同一套 Supabase 项目公开配置。

---

## 常见问题与排错

### 页面显示“预览模式”或没有 GitHub 登录按钮

检查 `.env.local` 是否存在，变量名是否完全正确。修改后必须停止并重新执行 `npm.cmd run dev`。

### GitHub 页面显示 `redirect_uri_mismatch`

在 GitHub OAuth App 中确认 **Authorization callback URL** 与 Supabase GitHub Provider 页面显示的 Callback URL 完全一致，包括 `https`、项目 ref 和 `/auth/v1/callback` 路径。它不是 `localhost` 地址。

### GitHub 已经授权，但看板显示“等待授权”

这通常表示还没完成白名单步骤。去 Supabase **Authentication → Users** 复制该用户 UUID，并执行步骤 8 中的 `insert into public.allowed_users ...` SQL。

### 保存时提示表不存在、权限错误或读取失败

回到 Supabase 的 **SQL Editor**，重新运行完整的 [`supabase/schema.sql`](./supabase/schema.sql)。确认运行的是与 `.env.local` 中 Project URL 对应的同一个项目。

### 第二台电脑看不到第一台的数据

依次核对：

1. 两台电脑 `.env.local` 的 Project URL 是否完全相同；
2. 是否使用同一个 GitHub 账号登录；
3. 第二台电脑是否误建了另一个 Supabase 项目；
4. 保存后是否刷新过页面。

### PowerShell 报 `npm.ps1` 被禁止运行

使用 `npm.cmd` 替代 `npm`：

```powershell
npm.cmd install
npm.cmd run dev
```

---

## 数据与安全边界

- 不要记录公司账号、密码、IP、网络拓扑、客户信息、内部日志、未脱敏配置或内部代码。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` 使用的是浏览器客户端公开密钥；真正限制数据访问的是登录会话加 RLS 白名单规则。
- GitHub OAuth Client Secret、Supabase `service_role` / secret key、数据库密码必须只保存在对应平台的受保护配置中。
- 定期从 Supabase 导出数据，或把周复盘另存为 Markdown；免费项目在长期低活跃时可能暂停。

## 技术栈

- Next.js / React / TypeScript
- Vinext / Vite
- Supabase Auth（GitHub OAuth）和 Postgres
- Supabase Row Level Security（RLS）

## License

暂未附加开源许可证。代码仅供学习、展示与交流；如需复用，请先联系仓库所有者。
