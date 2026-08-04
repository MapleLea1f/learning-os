"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase-client";

type DayForm = {
  top_goal: string;
  java_ai_minutes: number;
  platform_minutes: number;
  foundation_minutes: number;
  evidence: string;
  blocker: string;
  reflection: string;
  completed: boolean;
};

type StoredDay = DayForm & {
  id: string;
  record_date: string;
  user_id: string;
};

const defaultTasks = [
  "记录一条脱敏的工程问题或观察",
  "留下一个代码、脚本或实验提交",
  "推进本周的知识助手项目一个小步骤",
];

const selfQuestions = [
  "今天是否留下了一条别人可以验证的工程证据？",
  "我是在推进主线能力，还是只是在收藏课程？",
  "如果面试官追问今天的学习，我能讲清输入、输出和结果吗？",
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankForm(): DayForm {
  return {
    top_goal: "",
    java_ai_minutes: 0,
    platform_minutes: 0,
    foundation_minutes: 0,
    evidence: "",
    blocker: "",
    reflection: "",
    completed: false,
  };
}

function dateLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function weekStartKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - 6);
  return toDateKey(date);
}

export function LearningDashboard() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [form, setForm] = useState<DayForm>(blankForm);
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [weeklyRecords, setWeeklyRecords] = useState<StoredDay[]>([]);
  const [tasks, setTasks] = useState<boolean[]>([false, false, false]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const configured = isSupabaseConfigured;
  const totalMinutes = form.java_ai_minutes + form.platform_minutes + form.foundation_minutes;
  const weekMinutes = weeklyRecords.reduce(
    (sum, record) => sum + record.java_ai_minutes + record.platform_minutes + record.foundation_minutes,
    0,
  );
  const completedDays = weeklyRecords.filter((record) => record.completed).length;
  const goalProgress = Math.min(100, Math.round((totalMinutes / 90) * 100));
  const displayName = session?.user.user_metadata.user_name || session?.user.email?.split("@")[0] || "GitHub 用户";

  const question = useMemo(() => {
    const index = Number(selectedDate.replaceAll("-", "")) % selfQuestions.length;
    return selfQuestions[index];
  }, [selectedDate]);

  useEffect(() => {
    if (!configured) return;
    const client = getSupabase();
    if (!client) return;

    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthorized(false);
    });

    return () => listener.subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    async function load() {
      setMessage("");
      setForm(blankForm());
      setWeeklyRecords([]);
      setAuthorized(false);

      if (!configured || !session) return;
      const client = getSupabase();
      if (!client) return;

      setLoading(true);
      const { data: access, error: accessError } = await client
        .from("allowed_users")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (accessError || !access) {
        setMessage("此 GitHub 账号尚未获授权。请按 README 将你的 Supabase 用户 ID 写入允许名单。");
        setLoading(false);
        return;
      }

      setAuthorized(true);
      const startKey = weekStartKey(selectedDate);

      const [{ data: today, error: todayError }, { data: week, error: weekError }] = await Promise.all([
        client
          .from("learning_days")
          .select("*")
          .eq("record_date", selectedDate)
          .maybeSingle(),
        client
          .from("learning_days")
          .select("*")
          .gte("record_date", startKey)
          .lte("record_date", selectedDate)
          .order("record_date", { ascending: true }),
      ]);

      if (todayError || weekError) {
        setMessage("读取同步记录失败。请检查 Supabase 表结构、RLS 策略和网络连接。");
      } else {
        if (today) {
          setForm({
            top_goal: today.top_goal ?? "",
            java_ai_minutes: today.java_ai_minutes ?? 0,
            platform_minutes: today.platform_minutes ?? 0,
            foundation_minutes: today.foundation_minutes ?? 0,
            evidence: today.evidence ?? "",
            blocker: today.blocker ?? "",
            reflection: today.reflection ?? "",
            completed: today.completed ?? false,
          });
        }
        setWeeklyRecords((week as StoredDay[] | null) ?? []);
      }
      setLoading(false);
    }

    load();
  }, [configured, selectedDate, session]);

  function updateNumber(field: "java_ai_minutes" | "platform_minutes" | "foundation_minutes", value: string) {
    const parsed = Math.max(0, Number(value) || 0);
    setForm((current) => ({ ...current, [field]: parsed }));
  }

  async function signIn() {
    const client = getSupabase();
    if (!client) return;
    const { error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage(`无法跳转至 GitHub 登录：${error.message}`);
  }

  async function signOut() {
    const client = getSupabase();
    if (!client) return;
    await client.auth.signOut();
    setForm(blankForm());
    setWeeklyRecords([]);
  }

  async function saveDay() {
    setMessage("");
    const client = getSupabase();
    if (!client) {
      setMessage("尚未配置同步。请先填写 .env.local 并重启应用。");
      return;
    }
    if (!session) {
      setMessage("请先使用自己的 GitHub 账号登录。");
      return;
    }
    if (!authorized) {
      setMessage("当前账号没有数据写入权限。请先完成允许名单配置。");
      return;
    }

    setSaving(true);
    const { error } = await client.from("learning_days").upsert(
      {
        ...form,
        user_id: session.user.id,
        record_date: selectedDate,
      },
      { onConflict: "user_id,record_date" },
    );

    if (error) {
      setMessage(`保存失败：${error.message}`);
    } else {
      setMessage("已同步。现在的学习记录已经是一条可复盘的职业证据。");
      const refreshed = await client
        .from("learning_days")
        .select("*")
        .gte("record_date", weekStartKey(selectedDate))
        .lte("record_date", selectedDate)
        .order("record_date", { ascending: true });
      if (!refreshed.error) setWeeklyRecords((refreshed.data as StoredDay[] | null) ?? []);
    }
    setSaving(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LO</div>
          <div>
            <div className="brand-name">LEARNING OS</div>
            <div className="brand-subtitle">每天把时间变成证据，而不是只留下焦虑。</div>
          </div>
        </div>
        <div className="account-area">
          <div className="sync-pill">
            <span className={`sync-dot ${configured && session && authorized ? "ok" : ""}`} />
            {!configured ? "同步未配置" : !session ? "等待 GitHub 登录" : authorized ? "云端已连接" : "等待授权"}
          </div>
          {!configured ? (
            <button className="button button-secondary" type="button" onClick={() => setMessage("请先按 README 创建 Supabase 项目并填写 .env.local。")}>
              配置同步
            </button>
          ) : session ? (
            <button className="button button-secondary" type="button" onClick={signOut}>
              {displayName} · 退出
            </button>
          ) : (
            <button className="button" type="button" onClick={signIn}>使用 GitHub 登录</button>
          )}
        </div>
      </header>

      {!configured && (
        <section className="notice">
          <div><strong>预览模式：</strong>页面已经可用，但不会把记录伪装成已同步。复制 <code>.env.example</code> 为 <code>.env.local</code>，填入自己的 Supabase 项目信息后，才会启用 GitHub 登录和双设备同步。</div>
        </section>
      )}

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">今天的最小闭环</div>
          <h1>不追求完美日程，追求可证明的积累。</h1>
          <p>把 Java / AI 应用、云原生平台能力和面试基本功放在同一个节奏里。每次记录都要回答：我做了什么？留下什么证据？下一步是什么？</p>
        </div>
        <div className="date-switcher">
          <div>
            <label htmlFor="record-date">记录日期</label>
            <input id="record-date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          <div className="date-weekday">{dateLabel(selectedDate)}</div>
        </div>
      </section>

      <section className="stat-row" aria-label="本周概览">
        <article className="stat-card">
          <div className="stat-label">今日深度学习</div>
          <div className="stat-value">{totalMinutes}<small>分钟</small></div>
          <div className="stat-help">今日 90 分钟目标 · {goalProgress}%</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">近 7 天累计</div>
          <div className="stat-value">{weekMinutes}<small>分钟</small></div>
          <div className="stat-help">只统计已经同步的正式记录</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">完成日</div>
          <div className="stat-value">{completedDays}<small>/ 7 天</small></div>
          <div className="stat-help">完成不等于满分，代表留下了闭环</div>
        </article>
      </section>

      <section className="dashboard-grid">
        <div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">今日学习记录</h2>
                <p className="card-caption">以最小可行动作开始；有成果后再补充证据和复盘。</p>
              </div>
              {loading && <span className="sync-pill">正在读取…</span>}
            </div>
            <div className="field-grid">
              <label className="field field-full">
                <span>今天最重要的一件事</span>
                <input value={form.top_goal} placeholder="例如：完成 Python 巡检汇总脚本的第一个可运行版本" onChange={(event) => setForm((current) => ({ ...current, top_goal: event.target.value }))} />
              </label>
              <label className="field">
                <span>Java / AI 应用（分钟）</span>
                <input type="number" min="0" value={form.java_ai_minutes || ""} placeholder="0" onChange={(event) => updateNumber("java_ai_minutes", event.target.value)} />
              </label>
              <label className="field">
                <span>云原生 / 平台（分钟）</span>
                <input type="number" min="0" value={form.platform_minutes || ""} placeholder="0" onChange={(event) => updateNumber("platform_minutes", event.target.value)} />
              </label>
              <label className="field">
                <span>算法 / 英语（分钟）</span>
                <input type="number" min="0" value={form.foundation_minutes || ""} placeholder="0" onChange={(event) => updateNumber("foundation_minutes", event.target.value)} />
              </label>
              <label className="field field-full">
                <span>今天留下的证据</span>
                <textarea value={form.evidence} placeholder="链接、提交、脚本输出、实验结果，或一条脱敏的问题记录。" onChange={(event) => setForm((current) => ({ ...current, evidence: event.target.value }))} />
              </label>
              <label className="field">
                <span>卡点 / 待解决问题</span>
                <textarea value={form.blocker} placeholder="写下具体症状，而非“今天状态不好”。" onChange={(event) => setForm((current) => ({ ...current, blocker: event.target.value }))} />
              </label>
              <label className="field field-full">
                <span>复盘与明日第一步</span>
                <textarea value={form.reflection} placeholder="例如：脚本输入边界还没想清楚；明天先补 3 组异常样例和日志。" onChange={(event) => setForm((current) => ({ ...current, reflection: event.target.value }))} />
              </label>
            </div>
            <div className="form-footer">
              <label className="checkbox"><input type="checkbox" checked={form.completed} onChange={(event) => setForm((current) => ({ ...current, completed: event.target.checked }))} /> 今天已形成最小闭环</label>
              <div className="save-hint">{configured && session && authorized ? "保存后两台电脑会读取同一份记录。" : "完成 Supabase 配置和账号授权后才能写入云端。"}</div>
              <button className="button" type="button" disabled={saving} onClick={saveDay}>{saving ? "正在同步…" : "保存今日记录"}</button>
            </div>
            {message && <p className="feedback" role="status">{message}</p>}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">本周能力配比</h2>
                <p className="card-caption">建议的长期配比：Java / AI 应用 45%，平台能力 35%，算法与英语 20%。</p>
              </div>
            </div>
            <div className="allocation">
              <div className="allocation-item"><span>Java / AI 应用</span><div className="allocation-track"><div className="allocation-bar" style={{ width: `${Math.min(100, form.java_ai_minutes / 0.9)}%` }} /></div><span className="allocation-value">{form.java_ai_minutes}m</span></div>
              <div className="allocation-item"><span>平台 / 云原生</span><div className="allocation-track"><div className="allocation-bar platform" style={{ width: `${Math.min(100, form.platform_minutes / 0.9)}%` }} /></div><span className="allocation-value">{form.platform_minutes}m</span></div>
              <div className="allocation-item"><span>算法 / 英语</span><div className="allocation-track"><div className="allocation-bar foundation" style={{ width: `${Math.min(100, form.foundation_minutes / 0.9)}%` }} /></div><span className="allocation-value">{form.foundation_minutes}m</span></div>
            </div>
            <p className="allocation-note">今天时间不足也没关系：保住“至少一条工程记录或一次代码提交”比补齐所有类别更重要。</p>
          </section>
        </div>

        <aside>
          <section className="card">
            <div className="card-head">
              <div><h2 className="card-title">今天的三件小事</h2><p className="card-caption">完成它们，就已经避免“只学习、不沉淀”。</p></div>
            </div>
            <div className="checklist">
              {defaultTasks.map((task, index) => (
                <label className={`task ${tasks[index] ? "done" : ""}`} key={task}>
                  <input type="checkbox" checked={tasks[index]} onChange={() => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? !item : item))} />
                  {task}
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div><h2 className="card-title">职业主线</h2><p className="card-caption">主线是 Java / AI 应用，生产交付能力是护城河。</p></div></div>
            <div className="path">
              <div className="path-step active"><div className="path-stage">现在 · 0–6 个月</div><div className="path-name">把运维工作工程化</div><div className="path-detail">自动化、监控、变更、复盘，形成可写简历的真实证据。</div></div>
              <div className="path-step"><div className="path-stage">6–12 个月</div><div className="path-name">做出生产级个人项目</div><div className="path-detail">AI 知识助手 + 云原生部署 + 可观测性 + 故障演练。</div></div>
              <div className="path-step"><div className="path-stage">12–24 个月</div><div className="path-name">跳向更高职责密度</div><div className="path-detail">云原生 Java、AI 应用平台、DevOps / SRE 或中间件方向。</div></div>
            </div>
          </section>

          <section className="card grill">
            <div className="card-head"><div><div className="eyebrow">GRILL ME</div><h2 className="card-title">今晚的自我拷问</h2></div></div>
            <p className="grill-question">{question}</p>
            <p className="grill-note">推荐答案不是“我很忙”，而是一条可展示的记录、提交、实验或清晰的下一步。真正卡住时，把问题带给我，我会逐项追问到能行动为止。</p>
          </section>
        </aside>
      </section>

      <p className="footer-note">隐私边界：不要记录公司账号、密码、IP、网络拓扑、客户信息、内部日志或未脱敏配置。学习看板应该沉淀你的能力，不应该带走公司的数据。</p>
    </main>
  );
}
