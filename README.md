# Learning OS · Incident Lens

> 把学习投入沉淀为可验证的 AI 生产稳定性工程证据。

Learning OS 保留个人学习记录、计划与复盘能力；作品集主项目升级为 **Incident Lens**：一个面向值班工程师的 AI 事故指挥台。它不再回答泛泛的知识问题，而是处理一个真实、昂贵且可验证的工作问题：

> **当线上服务告警时，如何在不让 AI 擅自改生产的前提下，把告警、最近变更、日志/指标证据整理成可审计的根因判断和下一步处置？**

## 为什么做这个项目

- **真实痛点**：告警风暴、变更与观测数据分散、人工 RCA 慢，事故复盘经常缺少证据链。
- **市场缺口**：传统 APM 擅长展示数据，通用 Copilot 擅长生成文本；Incident Lens 聚焦两者之间的“证据化判断 + 人工审批 + 可恢复演练”。
- **工程含金量**：同时覆盖 RAG/Agent 输入治理、可观测性、SRE、评测、审计、安全边界、延迟与故障恢复，而不是只接一个聊天模型。
- **安全默认值**：第一版只生成只读检查建议；回滚、扩容、切流和改配置必须由人确认，接口明确记录 `actionTaken: none`。

## 第一版接口

```http
POST /api/incident/analyze
Content-Type: application/json
```

```json
{
  "alert": {
    "title": "checkout 5xx rate above 5%",
    "service": "checkout-api",
    "severity": "critical",
    "observedAt": "2026-08-07T09:00:00+08:00"
  },
  "changes": [
    { "id": "deploy-1842", "summary": "upgrade payment client", "deployedAt": "2026-08-07T08:42:00+08:00" }
  ],
  "evidence": [
    { "type": "metric", "source": "prometheus", "content": "5xx 0.4% -> 8.7%; p95 420ms -> 2.1s" },
    { "type": "log", "source": "loki", "content": "timeout calling payment provider" }
  ]
}
```

响应会包含：`risk`、`confidence`、带 `evidenceIds` 的根因假设、可证伪检查、`humanApprovalRequiredFor`、规范化证据和审计元数据。没有足够证据时，系统会降低置信度并要求补证，而不是编造结论。

## 作品集验收标准

1. 用脱敏公开资料或自建样例，覆盖发布回归、依赖超时、容量不足三类事故。
2. 每个评测问题保存输入、证据引用、期望结论、失败样本和人工评分。
3. 记录 p50/p95 延迟、错误率、证据引用完整率、误报/漏报和模型版本。
4. 演练一次“错误建议 → 人工拒绝 → 回滚/恢复 → 复盘入库”，README 中保留时间线。
5. 明确禁止模型直接执行生产动作，并为每个动作保留审批人、理由和结果。

## 路线图

- **MVP**：确定性基线接口、样例事故数据、结构化审计输出。
- **v0.2**：接入 OpenTelemetry/Prometheus/Loki 适配器，加入检索增强和证据引用校验。
- **v0.3**：评测集、故障注入、回放式演练、OpenTelemetry traces 与成本/延迟看板。
- **v1.0**：GitHub/Slack 事件接入、RBAC、审批流和可控的自动化 runbook。
## 鍏堝紕娓呮锛氫笁涓笢瑗垮垎鍒仛浠€涔?
寰堝閰嶇疆鍑洪敊锛屾槸鎶婁笅闈笁浠朵簨褰撴垚浜嗕竴浠朵簨銆?
| 涓滆タ | 浣滅敤 | 浣犵殑鏁版嵁鍦ㄥ摢閲?|
| --- | --- | --- |
| GitHub 浠撳簱 | 淇濆瓨椤圭洰浠ｇ爜銆丷EADME 鍜岀増鏈褰?| `MapleLea1f/learning-os` |
| GitHub 鐧诲綍 | 璇佹槑銆屽綋鍓嶆搷浣滅殑浜烘槸浣犮€?| GitHub 韬唤淇℃伅锛屼笉淇濆瓨瀛︿範璁板綍 |
| Supabase | 淇濆瓨瀛︿範璁板綍銆佹帶鍒惰鍐欐潈闄愩€佸疄鐜颁袱鍙扮數鑴戝悓姝?| 浣犺嚜宸卞垱寤虹殑 Supabase 椤圭洰 |

鍥犳锛?*GitHub 鐧诲綍鎴愬姛涓嶇瓑浜庡凡缁忚兘鍚屾**銆傞娆＄櫥褰曞悗锛岃繕瑕佹妸璇?GitHub 韬唤瀵瑰簲鐨?Supabase 鐢ㄦ埛 UUID 鍔犲叆鐧藉悕鍗曪紱杩欐槸鍒绘剰璁捐鐨勭浜岄亾淇濇姢銆?
## 浣犲皢瀹屾垚浠€涔?
瀹屾垚鏈寚鍗楀悗锛屼綘搴斿綋鑳藉楠岃瘉涓嬮潰鍥涗欢浜嬶細

1. 鏈満鎵撳紑鐪嬫澘锛岃兘鐪嬪埌鐣岄潰銆?2. 鐐瑰嚮鈥滀娇鐢?GitHub 鐧诲綍鈥濆悗锛岃兘鍥炲埌鐪嬫澘銆?3. 淇濆瓨涓€鏉″涔犺褰曪紝鍒锋柊椤甸潰鍚庤褰曚粛鍦ㄣ€?4. 绗簩鍙扮數鑴戜娇鐢?*鐩稿悓鐨?Supabase 椤圭洰**鍜?*鍚屼竴涓?GitHub 璐﹀彿**鐧诲綍鍚庯紝鑳界湅鍒板悓涓€鏉¤褰曘€?
> 宸查厤缃繃鏃х増鐪嬫澘鐨勭敤鎴凤細鏈鏇存柊浼氫繚瀛樻瘡娈靛涔犱簨浠剁殑鏍囬銆佸垎绫讳笌璁℃椂缁撴灉銆傝鍐嶆鍦?Supabase SQL Editor 杩愯瀹屾暣鐨?[`supabase/schema.sql`](./supabase/schema.sql)锛屽叾涓殑瀹夊叏杩佺Щ浼氳嚜鍔ㄦ坊鍔犳墍闇€瀛楁锛涘師鏈夎褰曚笉浼氳鍒犻櫎銆?
鍏ㄧ▼涓嶉渶瑕?ChatGPT 鐧诲綍锛屼篃涓嶉渶瑕佹妸鍏徃淇℃伅銆佸瘑鐮佹垨鍐呴儴鏁版嵁鍐欒繘鐪嬫澘銆?
---

## 绗竴閮ㄥ垎锛氫粎鍦ㄦ湰鏈鸿繍琛岀湅鏉匡紙鏃犻渶鍚屾锛?
杩欎竴姝ュ彧楠岃瘉椤圭洰鑳借繍琛屻€傛湭閰嶇疆 Supabase 鏃讹紝椤甸潰浼氭樉绀衡€滈瑙堟ā寮忊€濓紝璁板綍涓嶄細鍐欏叆浜戠銆?
### 1. 鎵撳紑姝ｇ‘鐨勯」鐩洰褰?
鏈満璇蜂娇鐢ㄧ洰鍓嶄笌 GitHub 浠撳簱瀵瑰簲鐨勭洰褰曪細

```powershell
cd D:\code\learning-os-github
```

> 涓嶈鍦?`learning-dashboard` 鎴?`learning-os` 鐩綍涓户缁紑鍙戯紱瀹冧滑鏄棫鍓湰锛屼笉鏄綋鍓嶇増鏈€?
### 2. 瀹夎渚濊禆骞跺惎鍔?
棣栨杩愯鎵嶉渶瑕佸畨瑁呬緷璧栵細

```powershell
npm.cmd install
```

姣忔鍚姩寮€鍙戞湇鍔″櫒浣跨敤锛?
```powershell
npm.cmd run dev
```

鎵撳紑娴忚鍣ㄨ闂細<http://localhost:3000>

> 鍦ㄨ繖鍙?Windows 鐢佃剳鐨?PowerShell 涓浣跨敤 `npm.cmd`锛岃€屼笉鏄?`npm`銆傝繖鏄负浜嗛伩寮€绯荤粺瀵?`npm.ps1` 鐨勬墽琛岀瓥鐣ラ檺鍒讹紝骞堕潪椤圭洰鏁呴殰銆?
瑕佸仠姝㈡湇鍔★紝鍦ㄨ繍琛屽懡浠ょ殑缁堢鎸?`Ctrl + C`銆?
---

## 绗簩閮ㄥ垎锛氬惎鐢?GitHub 鐧诲綍涓庝袱鍙扮數鑴戝悓姝?
棰勮鐢ㄦ椂绾?20 鍒嗛挓銆傝鎸夐『搴忓畬鎴愶紝**涓嶈璺宠繃鈥滅櫧鍚嶅崟鈥濇楠?*銆?
### 鍑嗗娓呭崟

- 涓€涓綘鑷繁鐨?GitHub 璐﹀彿銆?- 涓€涓綘鑷繁鍙鐞嗙殑 Supabase 璐﹀彿鍜岄」鐩€?- 涓ゅ彴鐢佃剳閮借兘杩愯鏈」鐩紱绗簩鍙扮數鑴戠◢鍚庝細浣跨敤鍚屼竴濂?Supabase 閰嶇疆銆?- 鏈湴寮€鍙戝湴鍧€锛歚http://localhost:3000`銆?
### 姝ラ 1锛氬垱寤?Supabase 椤圭洰

1. 鎵撳紑 [Supabase Dashboard](https://supabase.com/dashboard)锛岀敤浣犺嚜宸辩殑璐﹀彿鐧诲綍銆?2. 閫夋嫨鑷繁鐨?Organization锛岀偣鍑?**New project**銆?3. 濉啓椤圭洰鍚嶏紝渚嬪 `learning-os`锛涙暟鎹簱瀵嗙爜璇蜂繚瀛樺埌瀵嗙爜绠＄悊鍣紝**涓嶈**鍐欒繘浠撳簱鎴栫湅鏉裤€?4. 閫夋嫨绂讳綘杈冭繎鐨勫尯鍩燂紝鍒涘缓椤圭洰骞剁瓑寰呯姸鎬佸彉涓哄彲鐢ㄣ€?
杩欎竴姝ュ垱寤虹殑鏄綘鐨勪釜浜轰簯鏁版嵁搴撱€備袱鍙扮數鑴戣鍚屾锛屽繀椤昏繛鎺ュ埌**鍚屼竴涓?* Supabase 椤圭洰锛岃€屼笉鏄悇寤轰竴涓€?
### 姝ラ 2锛氬垱寤轰袱寮犳暟鎹〃骞跺惎鐢ㄦ潈闄愯鍒?
1. 鍦?Supabase 宸︿晶鎵撳紑 **SQL Editor**銆?2. 鐐瑰嚮 **New query**銆?3. 鎵撳紑鏈」鐩殑 [`supabase/schema.sql`](./supabase/schema.sql)锛屽鍒跺叏閮ㄥ唴瀹瑰埌鏌ヨ妗嗐€?4. 鐐瑰嚮 **Run**銆?5. 鎵撳紑 **Table Editor**锛岀‘璁ょ湅寰楀埌 `allowed_users` 鍜?`learning_days` 涓ゅ紶琛ㄣ€?
杩欐 SQL 鍋氫簡涓変欢浜嬶細

- 鍒涘缓 `learning_days`锛岀敤浜庝繚瀛樻瘡澶╃殑瀛︿範璁板綍锛?- 鍒涘缓 `allowed_users`锛屼綔涓轰粎鍏佽浣犺嚜宸辩殑璐﹀彿鍐欏叆鐨勭櫧鍚嶅崟锛?- 鍚敤 Row Level Security锛圧LS锛夛紝浣挎祻瑙堝櫒鍗充娇鎷垮埌鍏紑瀹㈡埛绔瘑閽ワ紝涔熸棤娉曡鍙栨垨淇敼鍒汉鐨勮褰曘€?
濡傛灉杩欓噷鎵ц鎶ラ敊锛屽厛涓嶈缁х画鍚庨潰鐨?OAuth 閰嶇疆锛涜纭鏄湪鍒氬垱寤虹殑椤圭洰涓墽琛屼簡瀹屾暣 SQL銆?
### 姝ラ 3锛氬彇寰?Supabase 椤圭洰鍦板潃鍜屽鎴风瀵嗛挜

鍦?Supabase 椤圭洰涓紝鎵撳紑 **Connect**锛屾垨杩涘叆 **Settings 鈫?API Keys**锛屽鍒朵互涓嬩袱椤癸細

| Supabase 椤甸潰涓殑鍊?| 濉叆鏈」鐩殑鍙橀噺 | 璇存槑 |
| --- | --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | 褰㈠ `https://xxxx.supabase.co` |
| Publishable key锛堟帹鑽愶級鎴?legacy anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浠呯敤浜庢祻瑙堝櫒瀹㈡埛绔?|

> 鍙橀噺鍚嶄腑淇濈暀浜?`ANON_KEY` 鏄负浜嗗吋瀹归」鐩幇鏈変唬鐮侊紱鏂板缓 Supabase 椤圭洰浼樺厛浣跨敤 **Publishable key** 濉叆鍗冲彲銆?>
> **缁濆涓嶈澶嶅埗** `sb_secret_...`銆乣service_role` key銆佹暟鎹簱瀵嗙爜鎴?GitHub OAuth Client Secret 鍒?`.env.local`銆佺綉椤佃〃鍗曟垨 GitHub 浠撳簱銆?
### 姝ラ 4锛氬垱寤?GitHub OAuth App

GitHub OAuth App 鐨勮亴璐ｅ彧鏈変竴浠朵簨锛氳 Supabase 纭鐧诲綍鑰呯‘瀹炴槸浣犵殑 GitHub 璐﹀彿銆?
1. 鐧诲綍 GitHub锛屼緷娆¤繘鍏?**澶村儚 鈫?Settings 鈫?Developer settings 鈫?OAuth Apps**銆?2. 鐐瑰嚮 **New OAuth App**锛堥娆″垱寤烘椂鎸夐挳鍙兘鏄剧ず涓?**Register a new application**锛夈€?3. 濉啓锛?
   | 瀛楁 | 鏈湴寮€鍙戞椂濉啓 |
   | --- | --- |
   | Application name | `Learning OS (personal)`锛屾垨浣犲枩娆㈢殑鍏紑鍚嶇О |
   | Homepage URL | `http://localhost:3000` |
   | Application description | `Personal learning dashboard`锛堝彲閫夛級 |
   | Authorization callback URL | **涓嶈鎵嬪啓 localhost**锛涘鍒朵笅涓€姝?Supabase GitHub Provider 椤甸潰鏄剧ず鐨?Callback URL |

4. 鐐瑰嚮 **Register application**銆?5. 鍦?OAuth App 椤甸潰璁颁笅 **Client ID**锛岀劧鍚庣偣鍑?**Generate a new client secret**锛岀珛鍗冲鍒剁敓鎴愮殑 Client Secret銆?
GitHub OAuth App 鐨?callback 鍙兘濉竴涓€傝繖閲屽簲褰撳～ Supabase 鎻愪緵鐨勫湴鍧€锛屽洜涓虹湡瀹炶矾寰勬槸锛?
```text
Learning OS锛堟祻瑙堝櫒锛?鈫?Supabase Auth 鈫?GitHub 鎺堟潈 鈫?Supabase Auth 鈫?http://localhost:3000
```

涓嶈鎶?GitHub 鍥炶皟鍦板潃鐩存帴濉垚 `http://localhost:3000`锛涢偅浼氶€犳垚 `redirect_uri` 鎴栨巿鏉冨洖璺抽敊璇€?
### 姝ラ 5锛氬湪 Supabase 涓惎鐢?GitHub Provider

1. 鍥炲埌 Supabase锛岃繘鍏?**Authentication 鈫?Providers 鈫?GitHub**銆?2. 璇ラ〉闈細鏄剧ず涓€涓?**Callback URL**锛岄€氬父褰㈠锛?
   ```text
   https://<浣犵殑-project-ref>.supabase.co/auth/v1/callback
   ```

3. 鎶婅繖涓?*瀹屾暣鍦板潃**绮樿创鍒板垰鎵?GitHub OAuth App 鐨?**Authorization callback URL**锛屼繚瀛?GitHub OAuth App銆?4. 鍥炲埌 Supabase GitHub Provider 椤甸潰锛屽惎鐢?GitHub Provider銆?5. 绮樿创 GitHub OAuth App 鐨?**Client ID** 鍜?**Client Secret**锛岀劧鍚庝繚瀛樸€?
Client Secret 鍙簲褰撳嚭鐜板湪 GitHub 鍜?Supabase 鐨勫彈淇濇姢閰嶇疆椤甸潰涓紱瀹冧笉灞炰簬鍓嶇椤圭洰鏂囦欢銆?
### 姝ラ 6锛氬厑璁稿簲鐢ㄥ洖鍒版湰鏈哄湴鍧€

1. 鍦?Supabase 杩涘叆 **Authentication 鈫?URL Configuration**銆?2. 灏?**Site URL** 璁剧疆涓猴細

   ```text
   http://localhost:3000
   ```

3. 鍦?**Redirect URLs**锛堟垨 Additional Redirect URLs锛変腑鍔犲叆锛?
   ```text
   http://localhost:3000
   ```

鏈」鐩櫥褰曞悗浼氬洖鍒板綋鍓嶇珯鐐规牴璺緞锛屼唬鐮佷腑浣跨敤鐨勬槸 `window.location.origin`锛屾墍浠ヨ鍦板潃蹇呴』琚厑璁搞€備互鍚庨儴缃插埌鑷繁鐨勫煙鍚嶆椂锛屽啀鎶婂畬鏁寸殑鐢熶骇鍦板潃鍔犲叆姝ゅ垪琛ㄣ€?
### 姝ラ 7锛氭妸 Supabase 閰嶇疆鍐欏叆鏈満

鍦?`D:\code\learning-os-github` 鎵ц锛?
```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

灏嗘枃浠跺～鍐欎负锛堟妸绀轰緥鍊兼浛鎹㈡垚浣犺嚜宸辩殑鍊硷級锛?
```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://浣犵殑-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_浣犵殑鍏紑瀹㈡埛绔瘑閽?```

淇濆瓨鍚庯紝閲嶆柊鍚姩椤圭洰锛?
```powershell
npm.cmd run dev
```

`.env.local` 鍙暀鍦ㄤ綘鐨勭數鑴戜笂锛屽凡缁忚 Git 蹇界暐锛涗笉瑕佹墽琛?`git add .env.local`銆?
### 姝ラ 8锛氶娆＄櫥褰曪紝骞舵妸鑷繁鍔犲叆鐧藉悕鍗?
1. 鎵撳紑 <http://localhost:3000>锛岀偣鍑?**浣跨敤 GitHub 鐧诲綍**銆?2. 鍦?GitHub 鎺堟潈瀹屾垚鍚庯紝椤甸潰浼氬洖鍒扮湅鏉裤€傛鏃朵綘鍙兘鐪嬪埌鈥滅瓑寰呮巿鏉冣€濇垨鈥滃綋鍓?GitHub 璐﹀彿灏氭湭鑾锋巿鏉冣€濓紝杩欐槸姝ｅ父鐨勩€?3. 鍥炲埌 Supabase锛屾墦寮€ **Authentication 鈫?Users**銆?4. 鎵惧埌鍒氬垰鐧诲綍浜х敓鐨勭敤鎴凤紝澶嶅埗鍏?**UUID**锛堜笉鏄?GitHub 鐢ㄦ埛鍚嶏紝涔熶笉鏄偖绠憋級銆?5. 鎵撳紑 **SQL Editor 鈫?New query**锛屾妸涓嬮潰鐨?`YOUR_AUTH_USER_UUID` 鎹㈡垚鍒氬鍒剁殑 UUID 鍚庤繍琛岋細

   ```sql
   insert into public.allowed_users (user_id)
   values ('YOUR_AUTH_USER_UUID')
   on conflict (user_id) do nothing;
   ```

6. 鍥炲埌鐪嬫澘骞跺埛鏂伴〉闈紱鐘舵€佸簲浠庘€滅瓑寰呮巿鏉冣€濆彉涓衡€滀簯绔凡杩炴帴鈥濄€?7. 闅忎究濉啓涓€鏉℃祴璇曞涔犺褰曪紝鐐瑰嚮鈥滀繚瀛樹粖鏃ヨ褰曗€濓紝鐒跺悗鍒锋柊椤甸潰锛涜褰曚粛瀛樺湪鍗宠〃绀哄悓姝ュ啓鍏ユ垚鍔熴€?
鍙湁鐧藉悕鍗曢噷鐨?UUID 鏈夋潈闄愯鍐欐暟鎹€傚嵆浣垮叾浠栦汉鐭ラ亾缃戠珯鍦板潃鎴栦娇鐢ㄨ嚜宸辩殑 GitHub 璐﹀彿鐧诲綍锛屼篃涓嶈兘璇诲彇浣犵殑瀛︿範璁板綍銆?
---

## 绗簩鍙扮數鑴戝浣曟帴鍏ュ悓涓€浠芥暟鎹?
绗簩鍙扮數鑴戜笉瑕佹柊寤?Supabase 椤圭洰锛屼篃涓嶈鍐嶆墽琛屼竴娆?schema 鐨勫缓琛?SQL銆傚彧闇€锛?
```powershell
cd D:\code
git clone https://github.com/MapleLea1f/learning-os.git learning-os-github
cd learning-os-github
npm.cmd install
Copy-Item .env.example .env.local
notepad .env.local
npm.cmd run dev
```

灏嗙涓€鍙扮數鑴戠殑 **Project URL** 鍜?**Publishable key / anon key** 濉叆绗簩鍙扮數鑴戠殑 `.env.local`锛岀劧鍚庝娇鐢?*鍚屼竴涓?GitHub 璐﹀彿**鐧诲綍銆傚洜涓鸿璐﹀彿鐨?UUID 宸插湪鐧藉悕鍗曚腑锛屼袱鍙扮數鑴戜細璇诲彇鍜屽啓鍏ュ悓涓€浠?`learning_days` 鏁版嵁銆?
> `.env.local` 涓嶄細璺熼殢 Git 鍚屾锛岃繖鏄畨鍏ㄨ璁°€備綘闇€瑕佸湪姣忓彴鑷繁鐨勭數鑴戜笂鍚勫～涓€娆★紝浣嗕袱鍙扮數鑴戝～鐨勬槸鍚屼竴濂?Supabase 椤圭洰鍏紑閰嶇疆銆?
---

## 甯歌闂涓庢帓閿?
### 椤甸潰鏄剧ず鈥滈瑙堟ā寮忊€濇垨娌℃湁 GitHub 鐧诲綍鎸夐挳

妫€鏌?`.env.local` 鏄惁瀛樺湪锛屽彉閲忓悕鏄惁瀹屽叏姝ｇ‘銆備慨鏀瑰悗蹇呴』鍋滄骞堕噸鏂版墽琛?`npm.cmd run dev`銆?
### GitHub 椤甸潰鏄剧ず `redirect_uri_mismatch`

鍦?GitHub OAuth App 涓‘璁?**Authorization callback URL** 涓?Supabase GitHub Provider 椤甸潰鏄剧ず鐨?Callback URL 瀹屽叏涓€鑷达紝鍖呮嫭 `https`銆侀」鐩?ref 鍜?`/auth/v1/callback` 璺緞銆傚畠涓嶆槸 `localhost` 鍦板潃銆?
### GitHub 宸茬粡鎺堟潈锛屼絾鐪嬫澘鏄剧ず鈥滅瓑寰呮巿鏉冣€?
杩欓€氬父琛ㄧず杩樻病瀹屾垚鐧藉悕鍗曟楠ゃ€傚幓 Supabase **Authentication 鈫?Users** 澶嶅埗璇ョ敤鎴?UUID锛屽苟鎵ц姝ラ 8 涓殑 `insert into public.allowed_users ...` SQL銆?
### 淇濆瓨鏃舵彁绀鸿〃涓嶅瓨鍦ㄣ€佹潈闄愰敊璇垨璇诲彇澶辫触

鍥炲埌 Supabase 鐨?**SQL Editor**锛岄噸鏂拌繍琛屽畬鏁寸殑 [`supabase/schema.sql`](./supabase/schema.sql)銆傜‘璁よ繍琛岀殑鏄笌 `.env.local` 涓?Project URL 瀵瑰簲鐨勫悓涓€涓」鐩€?
### 绗簩鍙扮數鑴戠湅涓嶅埌绗竴鍙扮殑鏁版嵁

渚濇鏍稿锛?
1. 涓ゅ彴鐢佃剳 `.env.local` 鐨?Project URL 鏄惁瀹屽叏鐩稿悓锛?2. 鏄惁浣跨敤鍚屼竴涓?GitHub 璐﹀彿鐧诲綍锛?3. 绗簩鍙扮數鑴戞槸鍚﹁寤轰簡鍙︿竴涓?Supabase 椤圭洰锛?4. 淇濆瓨鍚庢槸鍚﹀埛鏂拌繃椤甸潰銆?
### PowerShell 鎶?`npm.ps1` 琚姝㈣繍琛?
浣跨敤 `npm.cmd` 鏇夸唬 `npm`锛?
```powershell
npm.cmd install
npm.cmd run dev
```

---

## 鏁版嵁涓庡畨鍏ㄨ竟鐣?
- 涓嶈璁板綍鍏徃璐﹀彿銆佸瘑鐮併€両P銆佺綉缁滄嫇鎵戙€佸鎴蜂俊鎭€佸唴閮ㄦ棩蹇椼€佹湭鑴辨晱閰嶇疆鎴栧唴閮ㄤ唬鐮併€?- `NEXT_PUBLIC_SUPABASE_ANON_KEY` 浣跨敤鐨勬槸娴忚鍣ㄥ鎴风鍏紑瀵嗛挜锛涚湡姝ｉ檺鍒舵暟鎹闂殑鏄櫥褰曚細璇濆姞 RLS 鐧藉悕鍗曡鍒欍€?- GitHub OAuth Client Secret銆丼upabase `service_role` / secret key銆佹暟鎹簱瀵嗙爜蹇呴』鍙繚瀛樺湪瀵瑰簲骞冲彴鐨勫彈淇濇姢閰嶇疆涓€?- 瀹氭湡浠?Supabase 瀵煎嚭鏁版嵁锛屾垨鎶婂懆澶嶇洏鍙﹀瓨涓?Markdown锛涘厤璐归」鐩湪闀挎湡浣庢椿璺冩椂鍙兘鏆傚仠銆?
## 鎶€鏈爤

- Next.js / React / TypeScript
- Vinext / Vite
- Supabase Auth锛圙itHub OAuth锛夊拰 Postgres
- Supabase Row Level Security锛圧LS锛?
## License

鏆傛湭闄勫姞寮€婧愯鍙瘉銆備唬鐮佷粎渚涘涔犮€佸睍绀轰笌浜ゆ祦锛涘闇€澶嶇敤锛岃鍏堣仈绯讳粨搴撴墍鏈夎€呫€?
