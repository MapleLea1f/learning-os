"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase-client";

type LearningCategory = "java_ai" | "platform" | "foundation";

type LearningEvent = {
  id: string;
  title: string;
  category: LearningCategory;
  minutes: number;
};

type DayForm = {
  top_goal: string;
  events: LearningEvent[];
  evidence: string;
  blocker: string;
  reflection: string;
  completed: boolean;
};

type StoredDay = DayForm & {
  id: string;
  record_date: string;
  user_id: string;
  java_ai_minutes?: number;
  platform_minutes?: number;
  foundation_minutes?: number;
  events?: unknown;
};

const historyPageSize = 8;

const categoryMeta: Record<LearningCategory, { label: string; target: number; description: string }> = {
  java_ai: { label: "Java / AI 应用", target: 45, description: "服务设计、检索评测、Java 工程" },
  platform: { label: "云原生 / 平台", target: 35, description: "部署、监控、CI/CD、可靠性" },
  foundation: { label: "算法 / 英语", target: 20, description: "高频题、英文文档、职业表达" },
};

const careerStages = [
  {
    range: "现在 · 0–6 个月",
    title: "把运维经历变成工程证据",
    outcome: "至少留下自动化、监控或变更复盘等可验证成果。",
  },
  {
    range: "6–12 个月",
    title: "交付一个能解释清楚的作品集",
    outcome: "开发、部署、观测和一次失败恢复都能完整演示。",
  },
  {
    range: "12–24 个月",
    title: "进入更高职责密度的工程岗位",
    outcome: "面向云原生 Java、AI 应用平台、SRE 或中间件方向投递。",
  },
  {
    range: "3–5 年",
    title: "负责一项服务或平台能力的结果",
    outcome: "对稳定性、交付效率、成本或系统设计形成责任边界。",
  },
];

const assistantProjectSteps = [
  "用公开资料或自建样例，回答一类明确的问题。",
  "给每个答案保留来源、评测问题和失败样本。",
  "把服务部署起来，观察健康状态、延迟和错误。",
  "演练一次失败恢复，并把过程写进 README。",
];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function blankForm(): DayForm {
  return {
    top_goal: "",
    events: [],
    evidence: "",
    blocker: "",
    reflection: "",
    completed: false,
  };
}

function isLearningCategory(value: unknown): value is LearningCategory {
  return value === "java_ai" || value === "platform" || value === "foundation";
}

function normalizeEvents(value: unknown): LearningEvent[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const event = item as Record<string, unknown>;
    const title = typeof event.title === "string" ? event.title.trim() : "";
    const minutes = typeof event.minutes === "number" ? Math.round(event.minutes) : 0;
    if (!title || !isLearningCategory(event.category) || minutes < 1) return [];

    return [{
      id: typeof event.id === "string" && event.id ? event.id : `restored-${index}`,
      title,
      category: event.category,
      minutes,
    }];
  });
}

function legacyEventsFromMinutes(minutes: Record<LearningCategory, number>): LearningEvent[] {
  return (Object.keys(categoryMeta) as LearningCategory[]).flatMap((category) => {
    if (minutes[category] < 1) return [];
    return [{
      id: `legacy-${category}`,
      title: `${categoryMeta[category].label}（旧版累计）`,
      category,
      minutes: minutes[category],
    }];
  });
}

function legacyEvents(record: Pick<StoredDay, "java_ai_minutes" | "platform_minutes" | "foundation_minutes">): LearningEvent[] {
  return legacyEventsFromMinutes({
    java_ai: record.java_ai_minutes ?? 0,
    platform: record.platform_minutes ?? 0,
    foundation: record.foundation_minutes ?? 0,
  });
}

function eventsForRecord(record: StoredDay): LearningEvent[] {
  const events = normalizeEvents(record.events);
  return events.length ? events : legacyEvents(record);
}

function eventMinutes(events: LearningEvent[]) {
  return events.reduce<Record<LearningCategory, number>>(
    (total, event) => ({ ...total, [event.category]: total[event.category] + event.minutes }),
    { java_ai: 0, platform: 0, foundation: 0 },
  );
}

function totalMinutes(events: LearningEvent[]) {
  return events.reduce((total, event) => total + event.minutes, 0);
}

function formFromRecord(record: StoredDay): DayForm {
  return {
    top_goal: record.top_goal ?? "",
    events: eventsForRecord(record),
    evidence: record.evidence ?? "",
    blocker: record.blocker ?? "",
    reflection: record.reflection ?? "",
    completed: record.completed ?? false,
  };
}

function draftKey(userId: string | undefined, dateKey: string) {
  return `learning-os:day-draft:${userId ?? "anonymous"}:${dateKey}`;
}

function isDayForm(value: unknown): value is DayForm {
  if (!value || typeof value !== "object") return false;

  const form = value as Record<string, unknown>;
  return (
    typeof form.top_goal === "string" &&
    Array.isArray(form.events) && form.events.length === normalizeEvents(form.events).length &&
    typeof form.evidence === "string" &&
    typeof form.blocker === "string" &&
    typeof form.reflection === "string" &&
    typeof form.completed === "boolean"
  );
}

function isLegacyDayForm(value: unknown): value is Omit<DayForm, "events"> & Record<"java_ai_minutes" | "platform_minutes" | "foundation_minutes", number> {
  if (!value || typeof value !== "object") return false;

  const form = value as Record<string, unknown>;
  return (
    typeof form.top_goal === "string" &&
    typeof form.java_ai_minutes === "number" && Number.isFinite(form.java_ai_minutes) &&
    typeof form.platform_minutes === "number" && Number.isFinite(form.platform_minutes) &&
    typeof form.foundation_minutes === "number" && Number.isFinite(form.foundation_minutes) &&
    typeof form.evidence === "string" &&
    typeof form.blocker === "string" &&
    typeof form.reflection === "string" &&
    typeof form.completed === "boolean"
  );
}

function readDraft(key: string): DayForm | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (!value) return null;

    const draft: unknown = JSON.parse(value);
    if (isDayForm(draft)) return { ...draft, events: normalizeEvents(draft.events) };
    if (isLegacyDayForm(draft)) {
      return {
        top_goal: draft.top_goal,
        events: legacyEventsFromMinutes({
          java_ai: draft.java_ai_minutes,
          platform: draft.platform_minutes,
          foundation: draft.foundation_minutes,
        }),
        evidence: draft.evidence,
        blocker: draft.blocker,
        reflection: draft.reflection,
        completed: draft.completed,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, form: DayForm) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(form));
  } catch {
    // The dashboard remains usable when browser storage is unavailable.
  }
}

function clearDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The dashboard remains usable when browser storage is unavailable.
  }
}

function sameForm(left: DayForm, right: DayForm) {
  return (
    left.top_goal === right.top_goal &&
    JSON.stringify(left.events) === JSON.stringify(right.events) &&
    left.evidence === right.evidence &&
    left.blocker === right.blocker &&
    left.reflection === right.reflection &&
    left.completed === right.completed
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

function formatTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function createEventId() {
  return globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function LearningDashboard() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [form, setForm] = useState<DayForm>(blankForm);
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [weeklyRecords, setWeeklyRecords] = useState<StoredDay[]>([]);
  const [historyRecords, setHistoryRecords] = useState<StoredDay[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventCategory, setEventCategory] = useState<LearningCategory>("java_ai");
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerElapsedBeforePause, setTimerElapsedBeforePause] = useState(0);
  const [timerNow, setTimerNow] = useState(0);

  const configured = isSupabaseConfigured;
  const currentDraftKey = useMemo(
    () => draftKey(session?.user.id, selectedDate),
    [selectedDate, session?.user.id],
  );
  const todayMinutes = useMemo(() => eventMinutes(form.events), [form.events]);
  const todayTotal = totalMinutes(form.events);
  const weekMinutes = weeklyRecords.reduce((sum, record) => sum + totalMinutes(eventsForRecord(record)), 0);
  const completedDays = weeklyRecords.filter((record) => record.completed).length;
  const timerInProgress = timerStartedAt !== null || timerElapsedBeforePause > 0;
  const timerElapsed = timerElapsedBeforePause + (timerStartedAt ? timerNow - timerStartedAt : 0);
  const displayName = session?.user.user_metadata.user_name || session?.user.email?.split("@")[0] || "GitHub 用户";

  useEffect(() => {
    if (!timerStartedAt) return;
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timerStartedAt]);

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
    let cancelled = false;

    async function load() {
      setMessage("");
      const initialDraft = readDraft(currentDraftKey);
      setForm(initialDraft ?? blankForm());
      setWeeklyRecords([]);
      setHistoryRecords([]);
      setHistoryHasMore(false);
      setAuthorized(false);

      if (!configured || !session) return;
      const client = getSupabase();
      if (!client) return;

      setLoading(true);
      setHistoryLoading(true);
      const { data: access, error: accessError } = await client
        .from("allowed_users")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (accessError || !access) {
        setMessage("此 GitHub 账号尚未获授权。请按 README 将你的 Supabase 用户 ID 写入允许名单。");
        setLoading(false);
        setHistoryLoading(false);
        return;
      }

      setAuthorized(true);
      const startKey = weekStartKey(selectedDate);
      const [{ data: today, error: todayError }, { data: week, error: weekError }, { data: history, error: historyError }] = await Promise.all([
        client.from("learning_days").select("*").eq("record_date", selectedDate).maybeSingle(),
        client.from("learning_days").select("*").gte("record_date", startKey).lte("record_date", selectedDate).order("record_date", { ascending: true }),
        client.from("learning_days").select("*").order("record_date", { ascending: false }).range(0, historyPageSize - 1),
      ]);

      if (cancelled) return;

      if (todayError || weekError || historyError) {
        setMessage("读取同步记录失败。请检查 Supabase 表结构、RLS 策略和网络连接。");
      } else {
        const latestDraft = readDraft(currentDraftKey);
        if (latestDraft) setForm(latestDraft);
        else if (today) setForm(formFromRecord(today as StoredDay));
        setWeeklyRecords((week as StoredDay[] | null) ?? []);
        const records = (history as StoredDay[] | null) ?? [];
        setHistoryRecords(records);
        setHistoryHasMore(records.length === historyPageSize);
      }
      setLoading(false);
      setHistoryLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [configured, currentDraftKey, selectedDate, session]);

  function updateForm(update: (current: DayForm) => DayForm) {
    setForm((current) => {
      const next = update(current);
      writeDraft(currentDraftKey, next);
      return next;
    });
  }

  function startTimer() {
    if (!eventTitle.trim()) {
      setMessage("先写下这段时间要完成的具体事件，再开始计时。");
      return;
    }
    const startedAt = Date.now();
    setMessage("");
    setTimerElapsedBeforePause(0);
    setTimerNow(startedAt);
    setTimerStartedAt(startedAt);
  }

  function pauseTimer() {
    if (!timerStartedAt) return;
    const pausedAt = Date.now();
    setTimerElapsedBeforePause((elapsed) => elapsed + pausedAt - timerStartedAt);
    setTimerNow(pausedAt);
    setTimerStartedAt(null);
    setMessage("计时已暂停，点击“继续计时”后会从当前累计时长继续。");
  }

  function resumeTimer() {
    if (!timerInProgress || timerStartedAt) return;
    const resumedAt = Date.now();
    setMessage("");
    setTimerNow(resumedAt);
    setTimerStartedAt(resumedAt);
  }

  function finishTimer() {
    if (!timerInProgress) return;
    const elapsed = timerElapsedBeforePause + (timerStartedAt ? Date.now() - timerStartedAt : 0);
    const minutes = Math.max(1, Math.round(elapsed / 60000));
    const title = eventTitle.trim();
    updateForm((current) => ({
      ...current,
      events: [...current.events, { id: createEventId(), title, category: eventCategory, minutes }],
    }));
    setTimerStartedAt(null);
    setTimerElapsedBeforePause(0);
    setEventTitle("");
    setMessage(`已记录「${title}」：${formatMinutes(minutes)}。`);
  }

  function removeEvent(id: string) {
    updateForm((current) => ({ ...current, events: current.events.filter((event) => event.id !== id) }));
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
    clearDraft(currentDraftKey);
    setForm(blankForm());
    setWeeklyRecords([]);
    setHistoryRecords([]);
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
    const savedForm = form;
    const savedDraftKey = currentDraftKey;
    const minutes = eventMinutes(savedForm.events);
    const { error } = await client.from("learning_days").upsert(
      {
        ...savedForm,
        events: savedForm.events,
        java_ai_minutes: minutes.java_ai,
        platform_minutes: minutes.platform,
        foundation_minutes: minutes.foundation,
        user_id: session.user.id,
        record_date: selectedDate,
      },
      { onConflict: "user_id,record_date" },
    );

    if (error) {
      setMessage(`保存失败：${error.message}`);
    } else {
      const latestDraft = readDraft(savedDraftKey);
      if (latestDraft && sameForm(latestDraft, savedForm)) clearDraft(savedDraftKey);
      setMessage("已同步：今天的事件、证据和复盘都会进入历史档案。");
      const [{ data: week }, { data: history }] = await Promise.all([
        client.from("learning_days").select("*").gte("record_date", weekStartKey(selectedDate)).lte("record_date", selectedDate).order("record_date", { ascending: true }),
        client.from("learning_days").select("*").order("record_date", { ascending: false }).range(0, historyPageSize - 1),
      ]);
      setWeeklyRecords((week as StoredDay[] | null) ?? []);
      const records = (history as StoredDay[] | null) ?? [];
      setHistoryRecords(records);
      setHistoryHasMore(records.length === historyPageSize);
    }
    setSaving(false);
  }

  async function loadMoreHistory() {
    const client = getSupabase();
    if (!client || !session || !authorized || historyLoading || !historyHasMore) return;

    setHistoryLoading(true);
    const start = historyRecords.length;
    const { data, error } = await client
      .from("learning_days")
      .select("*")
      .order("record_date", { ascending: false })
      .range(start, start + historyPageSize - 1);

    if (error) {
      setMessage("加载更早的历史记录失败，请稍后重试。");
    } else {
      const records = (data as StoredDay[] | null) ?? [];
      setHistoryRecords((current) => [...current, ...records.filter((record) => !current.some((item) => item.id === record.id))]);
      setHistoryHasMore(records.length === historyPageSize);
    }
    setHistoryLoading(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LO</div>
          <div>
            <div className="brand-name">LEARNING OS</div>
            <div className="brand-subtitle">职业主线 · 事件记录 · 长期证据</div>
          </div>
        </div>
        <div className="account-area">
          <div className="sync-pill">
            <span className={`sync-dot ${configured && session && authorized ? "ok" : ""}`} />
            {!configured ? "本地预览" : !session ? "等待登录" : authorized ? "已连接云端" : "等待授权"}
          </div>
          {!configured ? (
            <button className="button button-secondary" type="button" onClick={() => setMessage("请先按 README 创建 Supabase 项目并填写 .env.local。")}>
              配置同步
            </button>
          ) : session ? (
            <button className="button button-secondary" type="button" onClick={signOut}>{displayName} · 退出</button>
          ) : (
            <button className="button" type="button" onClick={signIn}>使用 GitHub 登录</button>
          )}
        </div>
      </header>

      {!configured && (
        <section className="notice">
          <strong>预览模式：</strong>可以体验记录流程；配置 Supabase 后，事件和历史档案会在你的设备之间同步。
        </section>
      )}

      <section className="north-star">
        <div className="north-star-copy">
          <div className="eyebrow">职业主线</div>
          <h1>成为能交付生产级 AI 应用与云原生平台的工程师。</h1>
          <p>不是在“运维或开发”之间二选一，而是把 Java / AI 应用、生产交付和可靠性沉淀成下一跳能识别的工程能力。</p>
          <div className="goal-tags">
            <span>Java / AI 应用</span><span>云原生交付</span><span>可观测性与可靠性</span>
          </div>
        </div>
        <div className="current-focus">
          <span className="focus-label">当前阶段</span>
          <strong>0–6 个月：让工作产生工程信号</strong>
          <p>优先把自动化、监控、变更和复盘做成可展示成果，而不是只记录花了多少时间。</p>
          <div className="date-picker">
            <label htmlFor="record-date">正在记录</label>
            <input id="record-date" type="date" value={selectedDate} disabled={timerInProgress} onChange={(event) => setSelectedDate(event.target.value)} />
            <span>{dateLabel(selectedDate)}</span>
          </div>
        </div>
      </section>

      <section className="stage-grid" aria-label="职业阶段路线图">
        {careerStages.map((stage, index) => (
          <article className={`stage-card ${index === 0 ? "active" : ""}`} key={stage.range}>
            <span>{stage.range}</span>
            <h2>{stage.title}</h2>
            <p>{stage.outcome}</p>
          </article>
        ))}
      </section>

      <section className="main-grid">
        <section className="card focus-card">
          <div className="card-head">
            <div>
              <div className="eyebrow">今日行动</div>
              <h2 className="card-title">先记录事件，时间由计时器生成。</h2>
              <p className="card-caption">每条记录都要能回答：我做了什么、属于哪条能力主线、花了多久。</p>
            </div>
            {loading && <span className="sync-pill">正在读取…</span>}
          </div>

          <div className="timer-builder">
            <label>
              <span>我要做什么？</span>
              <input value={eventTitle} disabled={timerInProgress} placeholder="例如：为巡检脚本补一组异常样例" onChange={(event) => setEventTitle(event.target.value)} />
            </label>
            <label>
              <span>能力主线</span>
              <select value={eventCategory} disabled={timerInProgress} onChange={(event) => setEventCategory(event.target.value as LearningCategory)}>
                {(Object.keys(categoryMeta) as LearningCategory[]).map((category) => <option value={category} key={category}>{categoryMeta[category].label}</option>)}
              </select>
            </label>
            {timerInProgress ? (
              <div className="timer-running" data-paused={timerStartedAt ? undefined : true}>
                <div className="timer-readout" aria-live="polite">
                  <span>{formatTimer(timerElapsed)}</span>
                  <small>{timerStartedAt ? "计时中" : "已暂停"}</small>
                </div>
                <div className="timer-actions">
                  {timerStartedAt ? (
                    <button className="button button-secondary" type="button" onClick={pauseTimer}>暂停</button>
                  ) : (
                    <button className="button button-secondary" type="button" onClick={resumeTimer}>继续计时</button>
                  )}
                  <button className="button" type="button" onClick={finishTimer}>结束并写入</button>
                </div>
              </div>
            ) : (
              <button className="button timer-start" type="button" onClick={startTimer}>开始计时</button>
            )}
          </div>

          <div className="today-summary">
            <div><span>今日已沉淀</span><strong>{formatMinutes(todayTotal)}</strong></div>
            <p>{form.events.length ? `共 ${form.events.length} 条可复盘事件` : "完成一次具体行动后，记录会出现在这里。"}</p>
          </div>

          <div className="event-list" aria-live="polite">
            {form.events.length ? form.events.map((event) => (
              <article className="event-row" key={event.id}>
                <span className={`event-dot ${event.category}`} />
                <div><strong>{event.title}</strong><span>{categoryMeta[event.category].label}</span></div>
                <time>{formatMinutes(event.minutes)}</time>
                <button className="button-quiet" type="button" onClick={() => removeEvent(event.id)} aria-label={`删除事件：${event.title}`}>删除</button>
              </article>
            )) : <p className="empty-state">还没有事件。选择一件 20 分钟内可完成的小事，点击“开始计时”。</p>}
          </div>

          <label className="goal-field">
            <span>今天最重要的一件事</span>
            <input value={form.top_goal} placeholder="例如：完成巡检汇总脚本的第一个可运行版本" onChange={(event) => updateForm((current) => ({ ...current, top_goal: event.target.value }))} />
          </label>

          <details className="notes-panel">
            <summary>补充证据、卡点与明日第一步（可选）</summary>
            <div className="notes-grid">
              <label><span>留下的证据</span><textarea value={form.evidence} placeholder="提交、脚本输出、实验结果或脱敏的问题记录。" onChange={(event) => updateForm((current) => ({ ...current, evidence: event.target.value }))} /></label>
              <label><span>卡点 / 待解决问题</span><textarea value={form.blocker} placeholder="写具体症状，例如：异常输入没有被正确记录。" onChange={(event) => updateForm((current) => ({ ...current, blocker: event.target.value }))} /></label>
              <label><span>复盘与明日第一步</span><textarea value={form.reflection} placeholder="例如：明天先补 3 组异常样例，再检查日志。" onChange={(event) => updateForm((current) => ({ ...current, reflection: event.target.value }))} /></label>
            </div>
          </details>

          <div className="save-bar">
            <label className="checkbox"><input type="checkbox" checked={form.completed} onChange={(event) => updateForm((current) => ({ ...current, completed: event.target.checked }))} /> 今天形成了最小闭环</label>
            <button className="button" type="button" disabled={saving} onClick={saveDay}>{saving ? "正在同步…" : "保存今日记录"}</button>
          </div>
          {message && <p className="feedback" role="status">{message}</p>}
        </section>

        <aside className="side-stack">
          <section className="card project-card">
            <div className="eyebrow">作品集主项目 · 讲人话版</div>
            <h2 className="card-title">“AI 知识助手”到底是什么？</h2>
            <p>它不是泛泛的聊天机器人。它是一个用公开资料或自建样例回答具体问题的服务，并且你能证明它<strong>答得如何、运行是否健康、出错后怎样恢复</strong>。</p>
            <ol>
              {assistantProjectSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <div className="project-first-step"><strong>你现在只需要做第一步：</strong>创建仓库，写清它要回答的一个问题，再做出第一个可运行接口。</div>
          </section>

          <section className="card allocation-card">
            <div className="card-head"><div><div className="eyebrow">本周投入</div><h2 className="card-title">能力配比不是三张填空题。</h2></div></div>
            <div className="allocation">
              {(Object.keys(categoryMeta) as LearningCategory[]).map((category) => {
                const minutes = todayMinutes[category];
                return <div className="allocation-item" key={category}>
                  <div><strong>{categoryMeta[category].label}</strong><span>建议 {categoryMeta[category].target}% · {categoryMeta[category].description}</span></div>
                  <div className="allocation-track"><div className={`allocation-bar ${category}`} style={{ width: `${Math.min(100, minutes / 0.9)}%` }} /></div>
                  <b>{minutes}m</b>
                </div>;
              })}
            </div>
            <div className="week-total"><span>近 7 天正式记录</span><strong>{formatMinutes(weekMinutes)}</strong><span>{completedDays} 个闭环日</span></div>
          </section>
        </aside>
      </section>

      <section className="card archive-card">
        <div className="card-head">
          <div><div className="eyebrow">历史档案</div><h2 className="card-title">不止最近 7 天：每次保存都是以后能翻出来的证据。</h2><p className="card-caption">按日期倒序加载。旧版只有时长的数据会以“旧版累计”保留，不会丢失。</p></div>
          <span className="archive-count">已显示 {historyRecords.length} 天</span>
        </div>
        <div className="history-list">
          {historyRecords.length ? historyRecords.map((record) => {
            const events = eventsForRecord(record);
            return <article className="history-row" key={record.id}>
              <button className="history-date" type="button" onClick={() => setSelectedDate(record.record_date)}><strong>{dateLabel(record.record_date)}</strong><span>{record.record_date}</span></button>
              <div className="history-main"><strong>{record.top_goal || "未填写主目标"}</strong><div className="history-events">{events.length ? events.map((event) => <span key={event.id}>{event.title} · {event.minutes}m</span>) : <span>未记录具体事件</span>}</div></div>
              <div className="history-total"><strong>{formatMinutes(totalMinutes(events))}</strong><span>{record.completed ? "已闭环" : "进行中"}</span></div>
            </article>;
          }) : <p className="empty-state">{configured && session ? "还没有已同步的历史记录。保存今天的事件后，它会出现在这里。" : "登录并保存记录后，可以在这里查看全部历史。"}</p>}
        </div>
        {historyHasMore && <button className="button button-secondary load-more" type="button" disabled={historyLoading} onClick={loadMoreHistory}>{historyLoading ? "正在加载…" : "加载更早的记录"}</button>}
      </section>

      <p className="footer-note">隐私边界：只记录公开或脱敏的信息。不要输入公司账号、密码、IP、网络拓扑、客户资料、内部日志或未脱敏配置。</p>
    </main>
  );
}
