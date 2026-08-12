"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase-client";

type LearningCategory = "java_ai" | "platform" | "foundation";

type LearningEvent = {
  id: string;
  title: string;
  category: LearningCategory;
  minutes: number;
  planId?: string;
};

type PlanPriority = "high" | "medium" | "low";
type PlanStatus = "planned" | "in_progress" | "blocked" | "completed";

type WorkPlan = {
  id: string;
  user_id: string;
  title: string;
  priority: PlanPriority;
  target_date: string;
  next_action: string;
  details: string;
  status: PlanStatus;
  scheduled_date: string | null;
  created_at: string;
  updated_at: string;
};

type PlanForm = Pick<WorkPlan, "title" | "priority" | "target_date" | "next_action" | "details" | "status">;

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

type PersistedTimer = {
  id: string;
  userId: string | null;
  title: string;
  category: LearningCategory;
  planId: string | null;
  recordDate: string;
  startedAt: number | null;
  elapsedBeforePause: number;
  savedAt: number;
};

type PlanEffortEntry = {
  id: string;
  title: string;
  category: LearningCategory;
  minutes: number;
  recordDate: string;
};

type PlanEffort = {
  minutes: number;
  entries: PlanEffortEntry[];
};

const historyPageSize = 8;
const activeTimerStorageKey = "learning-os:active-timer";
const autosaveDelay = 1200;

type SyncStatus = "idle" | "pending" | "saving" | "saved" | "offline" | "error" | "local";

const planPriorityMeta: Record<PlanPriority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const planStatusMeta: Record<PlanStatus, string> = {
  planned: "待处理",
  in_progress: "进行中",
  blocked: "阻塞",
  completed: "已完成",
};

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

const primaryProjectSteps = [
  "识别物品与缺失信息，减少来回补充。",
  "生成标题、描述和买家回复，用户自己发布。",
  "标出价格依据与不确定项，不登录账号、不自动操作。",
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

function blankPlanForm(targetDate: string): PlanForm {
  return {
    title: "",
    priority: "medium",
    target_date: targetDate,
    next_action: "",
    details: "",
    status: "planned",
  };
}

function aiBatchPlanForm(targetDate: string): PlanForm {
  return {
    ...blankPlanForm(targetDate),
    title: "AI 批量化需求：",
    next_action: "先确认输入、输出与验收标准，再拆出第一批可验证样本。",
    details: "批量对象：\n输入来源：\n预期输出：\n验收标准：\n风险与边界：\n",
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

    const planId = typeof event.planId === "string" && event.planId ? event.planId : undefined;
    return [{
      id: typeof event.id === "string" && event.id ? event.id : `restored-${index}`,
      title,
      category: event.category,
      minutes,
      ...(planId ? { planId } : {}),
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

type MergedEvent = {
  key: string;
  title: string;
  category: LearningCategory;
  minutes: number;
  count: number;
  ids: string[];
  planId?: string;
};

function mergeEventsForDisplay(events: LearningEvent[]): MergedEvent[] {
  const groups = new Map<string, MergedEvent>();
  for (const event of events) {
    const key = `${event.title}\u0000${event.category}`;
    const existing = groups.get(key);
    if (existing) {
      existing.minutes += event.minutes;
      existing.count += 1;
      existing.ids.push(event.id);
      if (!existing.planId && event.planId) existing.planId = event.planId;
    } else {
      groups.set(key, {
        key,
        title: event.title,
        category: event.category,
        minutes: event.minutes,
        count: 1,
        ids: [event.id],
        ...(event.planId ? { planId: event.planId } : {}),
      });
    }
  }
  return Array.from(groups.values());
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
    const value = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
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
    window.localStorage.setItem(key, JSON.stringify(form));
  } catch {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(form));
    } catch {
      // The dashboard remains usable when browser storage is unavailable.
    }
  }
}

function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // The dashboard remains usable when browser storage is unavailable.
  }
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

function readPersistedTimer(): PersistedTimer | null {
  try {
    const raw = window.localStorage.getItem(activeTimerStorageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const timer = value as Record<string, unknown>;
    if (
      typeof timer.id !== "string" || !timer.id ||
      typeof timer.title !== "string" || !timer.title.trim() ||
      !isLearningCategory(timer.category) ||
      typeof timer.recordDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(timer.recordDate) ||
      (typeof timer.startedAt !== "number" && timer.startedAt !== null) ||
      typeof timer.elapsedBeforePause !== "number" || timer.elapsedBeforePause < 0
    ) return null;

    return {
      id: timer.id,
      userId: typeof timer.userId === "string" ? timer.userId : null,
      title: timer.title.trim(),
      category: timer.category,
      planId: typeof timer.planId === "string" && timer.planId ? timer.planId : null,
      recordDate: timer.recordDate,
      startedAt: timer.startedAt,
      elapsedBeforePause: timer.elapsedBeforePause,
      savedAt: typeof timer.savedAt === "number" ? timer.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writePersistedTimer(timer: PersistedTimer) {
  try {
    window.localStorage.setItem(activeTimerStorageKey, JSON.stringify(timer));
  } catch {
    // Timer recovery is best-effort when browser storage is unavailable.
  }
}

function clearPersistedTimer() {
  try {
    window.localStorage.removeItem(activeTimerStorageKey);
  } catch {
    // The in-memory timer remains usable when browser storage is unavailable.
  }
}

function planEffortFromRecords(records: Array<Pick<StoredDay, "record_date" | "events">>): Record<string, PlanEffort> {
  return records.reduce<Record<string, PlanEffort>>((totals, record) => {
    normalizeEvents(record.events).forEach((event) => {
      if (!event.planId) return;
      const current = totals[event.planId] ?? { minutes: 0, entries: [] };
      current.minutes += event.minutes;
      current.entries.push({
        id: event.id,
        title: event.title,
        category: event.category,
        minutes: event.minutes,
        recordDate: record.record_date,
      });
      totals[event.planId] = current;
    });
    return totals;
  }, {});
}

export function LearningDashboard() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [form, setForm] = useState<DayForm>(blankForm);
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [authorizationChecked, setAuthorizationChecked] = useState(false);
  const [weeklyRecords, setWeeklyRecords] = useState<StoredDay[]>([]);
  const [historyRecords, setHistoryRecords] = useState<StoredDay[]>([]);
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [planEfforts, setPlanEfforts] = useState<Record<string, PlanEffort>>({});
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [dateChanging, setDateChanging] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [planComposerOpen, setPlanComposerOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(() => blankPlanForm(toDateKey(new Date())));
  const [eventTitle, setEventTitle] = useState("");
  const [eventCategory, setEventCategory] = useState<LearningCategory>("java_ai");
  const [timerPlanId, setTimerPlanId] = useState<string | null>(null);
  const [timerSessionId, setTimerSessionId] = useState<string | null>(null);
  const [timerRecordDate, setTimerRecordDate] = useState<string | null>(null);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerElapsedBeforePause, setTimerElapsedBeforePause] = useState(0);
  const [timerNow, setTimerNow] = useState(0);
  const [pendingTimerRecovery, setPendingTimerRecovery] = useState<PersistedTimer | null>(() => typeof window === "undefined" ? null : readPersistedTimer());
  const recoveringTimerRef = useRef<string | null>(null);
  const formRef = useRef(form);
  const saveVersionRef = useRef(0);
  const latestSaveRef = useRef<{ version: number; form: DayForm; date: string } | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const flushAutosaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  const configured = isSupabaseConfigured;
  const currentDraftKey = useMemo(
    () => draftKey(session?.user.id, selectedDate),
    [selectedDate, session?.user.id],
  );
  const todayMinutes = useMemo(() => eventMinutes(form.events), [form.events]);
  const todayTotal = totalMinutes(form.events);
  const mergedEvents = useMemo(() => mergeEventsForDisplay(form.events), [form.events]);
  const weekMinutes = weeklyRecords.reduce((sum, record) => sum + totalMinutes(eventsForRecord(record)), 0);
  const completedDays = weeklyRecords.filter((record) => record.completed).length;
  const timerInProgress = timerSessionId !== null;
  const timerElapsed = timerElapsedBeforePause + (timerStartedAt ? timerNow - timerStartedAt : 0);
  const timerPlan = plans.find((plan) => plan.id === timerPlanId) ?? null;
  const scheduledPlans = plans.filter((plan) => plan.status !== "completed" && plan.scheduled_date === selectedDate);
  const otherOpenPlans = plans.filter((plan) => plan.status !== "completed" && plan.scheduled_date !== selectedDate);
  const completedPlans = plans.filter((plan) => plan.status === "completed");
  const displayName = session?.user.user_metadata.user_name || session?.user.email?.split("@")[0] || "GitHub 用户";
  const syncStatusLabel: Record<SyncStatus, string> = {
    idle: configured ? "等待记录" : "本地预览",
    pending: "待同步",
    saving: "正在同步…",
    saved: "已自动保存",
    offline: "离线草稿",
    error: "同步失败",
    local: "仅保存在本机",
  };
  const refreshPlanEfforts = useCallback(async () => {
    const client = getSupabase();
    if (!client || !session || !authorized) return;
    const { data, error } = await client.from("learning_days").select("record_date, events");
    if (!error) {
      setPlanEfforts(planEffortFromRecords((data as Array<Pick<StoredDay, "record_date" | "events">> | null) ?? []));
    }
  }, [authorized, session]);

  const refreshSavedViews = useCallback(async (dateKey: string) => {
    const client = getSupabase();
    if (!client || !session || !authorized) return;
    const [{ data: week }, { data: history }] = await Promise.all([
      client.from("learning_days").select("*").gte("record_date", weekStartKey(dateKey)).lte("record_date", dateKey).order("record_date", { ascending: true }),
      client.from("learning_days").select("*").order("record_date", { ascending: false }).range(0, historyPageSize - 1),
    ]);
    setWeeklyRecords((week as StoredDay[] | null) ?? []);
    const records = (history as StoredDay[] | null) ?? [];
    setHistoryRecords(records);
    setHistoryHasMore(records.length === historyPageSize);
    void refreshPlanEfforts();
  }, [authorized, refreshPlanEfforts, session]);

  const persistDay = useCallback(async (savedForm: DayForm, dateKey: string) => {
    const client = getSupabase();
    if (!client || !session || !authorized) return false;

    const minutes = eventMinutes(savedForm.events);
    const { error } = await client.from("learning_days").upsert(
      {
        ...savedForm,
        events: savedForm.events,
        java_ai_minutes: minutes.java_ai,
        platform_minutes: minutes.platform,
        foundation_minutes: minutes.foundation,
        user_id: session.user.id,
        record_date: dateKey,
      },
      { onConflict: "user_id,record_date" },
    );

    if (error) return false;
    await refreshSavedViews(dateKey);
    return true;
  }, [authorized, refreshSavedViews, session]);

  const flushAutosave = useCallback(async () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const snapshot = latestSaveRef.current;
    if (!snapshot) return false;
    if (savingRef.current) return savingPromiseRef.current ?? false;
    if (!configured || !session || !authorized) {
      setSyncStatus("local");
      latestSaveRef.current = null;
      return false;
    }

    savingRef.current = true;
    setSaving(true);
    setSyncStatus("saving");
    const savePromise = persistDay(snapshot.form, snapshot.date);
    savingPromiseRef.current = savePromise;
    const saved = await savePromise;
    savingPromiseRef.current = null;
    savingRef.current = false;
    setSaving(false);

    const isLatest = latestSaveRef.current?.version === snapshot.version;
    if (saved) {
      if (isLatest) {
        latestSaveRef.current = null;
        const key = draftKey(session.user.id, snapshot.date);
        const latestDraft = readDraft(key);
        if (latestDraft && sameForm(latestDraft, snapshot.form)) clearDraft(key);
        setSyncStatus("saved");
      } else {
        setSyncStatus("pending");
        void flushAutosaveRef.current();
      }
      return true;
    }

    setSyncStatus(configured && session && authorized ? "offline" : "local");
    return false;
  }, [authorized, configured, persistDay, session]);

  useEffect(() => {
    flushAutosaveRef.current = flushAutosave;
  }, [flushAutosave]);

  const queueAutosave = useCallback((nextForm: DayForm, dateKey: string, immediate = false) => {
    const version = saveVersionRef.current + 1;
    saveVersionRef.current = version;
    latestSaveRef.current = { version, form: nextForm, date: dateKey };
    setSyncStatus(configured && session && authorized ? "pending" : "local");
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    if (immediate) {
      void flushAutosave();
    } else {
      autosaveTimerRef.current = window.setTimeout(() => {
        autosaveTimerRef.current = null;
        void flushAutosave();
      }, autosaveDelay);
    }
  }, [authorized, configured, flushAutosave, session]);

  useEffect(() => {
    if (!timerStartedAt) return;
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timerStartedAt]);

  useEffect(() => {
    if (!timerSessionId || !timerRecordDate || !eventTitle.trim()) return;
    writePersistedTimer({
      id: timerSessionId,
      userId: session?.user.id ?? null,
      title: eventTitle.trim(),
      category: eventCategory,
      planId: timerPlanId,
      recordDate: timerRecordDate,
      startedAt: timerStartedAt,
      elapsedBeforePause: timerElapsedBeforePause,
      savedAt: Date.now(),
    });
  }, [eventCategory, eventTitle, session?.user.id, timerElapsedBeforePause, timerPlanId, timerRecordDate, timerSessionId, timerStartedAt]);

  useEffect(() => {
    if (!timerSessionId || !timerRecordDate) return;
    const saveSnapshot = () => {
      writePersistedTimer({
        id: timerSessionId,
        userId: session?.user.id ?? null,
        title: eventTitle.trim(),
        category: eventCategory,
        planId: timerPlanId,
        recordDate: timerRecordDate,
        startedAt: timerStartedAt,
        elapsedBeforePause: timerElapsedBeforePause,
        savedAt: Date.now(),
      });
    };
    window.addEventListener("pagehide", saveSnapshot);
    return () => window.removeEventListener("pagehide", saveSnapshot);
  }, [eventCategory, eventTitle, session?.user.id, timerElapsedBeforePause, timerPlanId, timerRecordDate, timerSessionId, timerStartedAt]);

  useEffect(() => {
    const retry = () => {
      if (latestSaveRef.current) void flushAutosave();
    };
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden" && latestSaveRef.current) void flushAutosave();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", flushOnHidden);
    window.addEventListener("pagehide", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", flushOnHidden);
      window.removeEventListener("pagehide", retry);
    };
  }, [flushAutosave]);

  useEffect(() => {
    if (!configured) {
      return;
    }
    const client = getSupabase();
    if (!client) return;

    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthorized(false);
      setAuthorizationChecked(false);
    });

    return () => listener.subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    if (!pendingTimerRecovery || recoveringTimerRef.current === pendingTimerRecovery.id) return;
    if (configured && session && !authorizationChecked) return;
    if (pendingTimerRecovery.userId && session?.user.id && pendingTimerRecovery.userId !== session.user.id) return;

    const recoveredEvent: LearningEvent = {
      id: pendingTimerRecovery.id,
      title: pendingTimerRecovery.title,
      category: pendingTimerRecovery.category,
      minutes: Math.max(1, Math.round((pendingTimerRecovery.elapsedBeforePause + (pendingTimerRecovery.startedAt ? Date.now() - pendingTimerRecovery.startedAt : 0)) / 60000)),
      ...(pendingTimerRecovery.planId ? { planId: pendingTimerRecovery.planId } : {}),
    };
    const recoveredDraftKey = draftKey(pendingTimerRecovery.userId ?? session?.user.id, pendingTimerRecovery.recordDate);
    const mergeRecoveredEvent = (base: DayForm) => ({
      ...base,
      events: base.events.some((event) => event.id === recoveredEvent.id) ? base.events : [...base.events, recoveredEvent],
    });
    const finishRecovery = (nextForm: DayForm, synced: boolean) => {
      if (!synced) writeDraft(recoveredDraftKey, nextForm);
      clearPersistedTimer();
      recoveringTimerRef.current = null;
      setPendingTimerRecovery(null);
      if (selectedDate === pendingTimerRecovery.recordDate) setForm(nextForm);
      else setSelectedDate(pendingTimerRecovery.recordDate);
      setMessage(synced ? `页面刷新前的计时已自动结束并同步：${recoveredEvent.title}。` : `页面刷新前的计时已自动结束，已保存在本地草稿，登录同步后会写入记录。`);
    };

    if (!configured || !session || !authorized) {
      const existingDraft = readDraft(recoveredDraftKey) ?? blankForm();
      finishRecovery(mergeRecoveredEvent(existingDraft), false);
      return;
    }

    recoveringTimerRef.current = pendingTimerRecovery.id;
    const client = getSupabase();
    if (!client) {
      const existingDraft = readDraft(recoveredDraftKey) ?? blankForm();
      finishRecovery(mergeRecoveredEvent(existingDraft), false);
      return;
    }

    async function recoverIntoCloud() {
      const { data: storedDay, error: readError } = await client
        .from("learning_days")
        .select("*")
        .eq("record_date", pendingTimerRecovery.recordDate)
        .maybeSingle();
      const existingDraft = readDraft(recoveredDraftKey);
      const nextForm = mergeRecoveredEvent(existingDraft ?? (readError || !storedDay ? blankForm() : formFromRecord(storedDay as StoredDay)));
      const minutes = eventMinutes(nextForm.events);
      const { error: saveError } = await client.from("learning_days").upsert(
        {
          ...nextForm,
          events: nextForm.events,
          java_ai_minutes: minutes.java_ai,
          platform_minutes: minutes.platform,
          foundation_minutes: minutes.foundation,
          user_id: session.user.id,
          record_date: pendingTimerRecovery.recordDate,
        },
        { onConflict: "user_id,record_date" },
      );

      if (saveError) {
        finishRecovery(nextForm, false);
        return;
      }
      if (pendingTimerRecovery.planId) {
        await client.from("work_plans").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", pendingTimerRecovery.planId);
      }
      void refreshPlanEfforts();
      finishRecovery(nextForm, true);
    }

    void recoverIntoCloud();
  }, [authorizationChecked, authorized, configured, pendingTimerRecovery, refreshPlanEfforts, selectedDate, session]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setMessage("");
      const anonymousDraft = session?.user.id ? readDraft(draftKey(undefined, selectedDate)) : null;
      const initialDraft = readDraft(currentDraftKey) ?? anonymousDraft;
      if (anonymousDraft && session?.user.id && !readDraft(currentDraftKey)) writeDraft(currentDraftKey, anonymousDraft);
      const initialForm = initialDraft ?? blankForm();
      formRef.current = initialForm;
      setForm(initialForm);
      setWeeklyRecords([]);
      setHistoryRecords([]);
      setPlans([]);
      setPlanEfforts({});
      setHistoryHasMore(false);
      setAuthorized(false);
      setAuthorizationChecked(false);

      if (!configured || !session) {
        setAuthorizationChecked(true);
        return;
      }
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
        setAuthorizationChecked(true);
        return;
      }

      setAuthorized(true);
      setAuthorizationChecked(true);
      const startKey = weekStartKey(selectedDate);
      const [{ data: today, error: todayError }, { data: week, error: weekError }, { data: history, error: historyError }, { data: planData, error: plansError }, { data: effortData }] = await Promise.all([
        client.from("learning_days").select("*").eq("record_date", selectedDate).maybeSingle(),
        client.from("learning_days").select("*").gte("record_date", startKey).lte("record_date", selectedDate).order("record_date", { ascending: true }),
        client.from("learning_days").select("*").order("record_date", { ascending: false }).range(0, historyPageSize - 1),
        client.from("work_plans").select("*").order("target_date", { ascending: true }).order("created_at", { ascending: false }),
        client.from("learning_days").select("record_date, events"),
      ]);

      if (cancelled) return;

      if (todayError || weekError || historyError) {
        setMessage("读取同步记录失败。请检查 Supabase 表结构、RLS 策略和网络连接。");
      } else {
        const latestDraft = readDraft(currentDraftKey);
        const loadedForm = latestDraft ?? (today ? formFromRecord(today as StoredDay) : initialForm);
        formRef.current = loadedForm;
        setForm(loadedForm);
        setWeeklyRecords((week as StoredDay[] | null) ?? []);
        const records = (history as StoredDay[] | null) ?? [];
        setHistoryRecords(records);
        setHistoryHasMore(records.length === historyPageSize);
        if (plansError) {
          setMessage("计划库尚未初始化。请在 Supabase 执行更新后的 schema.sql 后重新加载。");
        } else {
          setPlans((planData as WorkPlan[] | null) ?? []);
        }
        setPlanEfforts(planEffortFromRecords((effortData as Array<Pick<StoredDay, "record_date" | "events">> | null) ?? []));
      }
      setLoading(false);
      setHistoryLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [configured, currentDraftKey, selectedDate, session]);

  useEffect(() => {
    if (!configured || !session || !authorized) return;
    const draft = readDraft(currentDraftKey);
    if (draft) window.setTimeout(() => queueAutosave(draft, selectedDate), 0);
  }, [authorized, configured, currentDraftKey, queueAutosave, selectedDate, session]);

  function updateForm(update: (current: DayForm) => DayForm, immediate = false) {
    const next = update(formRef.current);
    formRef.current = next;
    writeDraft(currentDraftKey, next);
    setForm(next);
    queueAutosave(next, selectedDate, immediate);
  }

  async function handleDateChange(nextDate: string) {
    if (nextDate === selectedDate) return;
    setDateChanging(true);
    await flushAutosave();
    setSelectedDate(nextDate);
    setDateChanging(false);
  }

  function openPlanComposer(template: "general" | "ai_batch") {
    setEditingPlanId(null);
    setPlanForm(template === "ai_batch" ? aiBatchPlanForm(selectedDate) : blankPlanForm(selectedDate));
    setPlanComposerOpen(true);
  }

  function editPlan(plan: WorkPlan) {
    setEditingPlanId(plan.id);
    setPlanForm({
      title: plan.title,
      priority: plan.priority,
      target_date: plan.target_date,
      next_action: plan.next_action,
      details: plan.details,
      status: plan.status,
    });
    setPlanComposerOpen(true);
  }

  function getPlanClient() {
    const client = getSupabase();
    if (!client) {
      setMessage("计划库需要先配置 Supabase 同步。");
      return null;
    }
    if (!session) {
      setMessage("请先登录后再保存跨日计划。");
      return null;
    }
    if (!authorized) {
      setMessage("当前账号没有计划库写入权限。请先完成允许名单配置。");
      return null;
    }
    return client;
  }

  function replacePlan(nextPlan: WorkPlan) {
    setPlans((current) => {
      const index = current.findIndex((plan) => plan.id === nextPlan.id);
      if (index < 0) return [nextPlan, ...current];
      return current.map((plan) => plan.id === nextPlan.id ? nextPlan : plan);
    });
  }

  async function updateExistingPlan(plan: WorkPlan, changes: Partial<WorkPlan>, successMessage?: string) {
    const client = getPlanClient();
    if (!client) return;

    setPlanSaving(true);
    const { data, error } = await client
      .from("work_plans")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", plan.id)
      .select("*")
      .single();

    if (error || !data) {
      setMessage(`更新计划失败：${error?.message ?? "未返回计划数据"}`);
    } else {
      replacePlan(data as WorkPlan);
      if (successMessage) setMessage(successMessage);
    }
    setPlanSaving(false);
  }

  async function savePlan() {
    const title = planForm.title.trim();
    const nextAction = planForm.next_action.trim();
    if (!title || !planForm.target_date || !nextAction) {
      setMessage("请填写计划标题、目标日和下一步，再保存计划。");
      return;
    }

    const client = getPlanClient();
    if (!client || !session) return;

    const payload = {
      title,
      priority: planForm.priority,
      target_date: planForm.target_date,
      next_action: nextAction,
      details: planForm.details.trim(),
      status: planForm.status,
      updated_at: new Date().toISOString(),
    };
    setPlanSaving(true);

    if (editingPlanId) {
      const { data, error } = await client
        .from("work_plans")
        .update(payload)
        .eq("id", editingPlanId)
        .select("*")
        .single();
      if (error || !data) {
        setMessage(`保存计划失败：${error?.message ?? "未返回计划数据"}`);
      } else {
        replacePlan(data as WorkPlan);
        setMessage(`已更新计划「${title}」。`);
        setPlanComposerOpen(false);
        setEditingPlanId(null);
      }
    } else {
      const { data, error } = await client
        .from("work_plans")
        .insert({ ...payload, user_id: session.user.id, scheduled_date: null })
        .select("*")
        .single();
      if (error || !data) {
        setMessage(`保存计划失败：${error?.message ?? "未返回计划数据"}`);
      } else {
        replacePlan(data as WorkPlan);
        setMessage(`已创建计划「${title}」，可手动排入当天。`);
        setPlanComposerOpen(false);
      }
    }
    setPlanSaving(false);
  }

  function schedulePlan(plan: WorkPlan) {
    void updateExistingPlan(plan, { scheduled_date: selectedDate }, `已安排「${plan.title}」在 ${dateLabel(selectedDate)} 处理。`);
  }

  function unschedulePlan(plan: WorkPlan) {
    void updateExistingPlan(plan, { scheduled_date: null }, `已将「${plan.title}」移出当天安排。`);
  }

  function prepareTimerForPlan(plan: WorkPlan) {
    if (timerInProgress) {
      setMessage("请先结束或暂停当前计时，再关联另一条计划。");
      return;
    }
    setTimerPlanId(plan.id);
    setEventTitle(plan.title);
    setMessage(`已关联「${plan.title}」。选择能力主线后开始计时，计划会变为进行中；结束一次投入不会自动完成计划。`);
  }

  function clearTimerPlan() {
    if (timerInProgress) return;
    setTimerPlanId(null);
    setMessage("已取消本次计时与计划的关联。");
  }

  function startTimer() {
    if (!eventTitle.trim()) {
      setMessage("先写下这段时间要完成的具体事件，再开始计时。");
      return;
    }
    const startedAt = Date.now();
    setMessage("");
    if (timerPlan && timerPlan.status !== "in_progress") {
      void updateExistingPlan(timerPlan, { status: "in_progress" });
    }
    setTimerSessionId(createEventId());
    setTimerRecordDate(selectedDate);
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
    const elapsed = timerElapsedBeforePause + (timerStartedAt ? timerNow - timerStartedAt : 0);
    const minutes = Math.max(1, Math.round(elapsed / 60000));
    const title = eventTitle.trim();
    const planId = timerPlanId;
    const eventId = timerSessionId ?? createEventId();
    updateForm((current) => ({
      ...current,
      events: [...current.events, { id: eventId, title, category: eventCategory, minutes, ...(planId ? { planId } : {}) }],
    }), true);
    setTimerStartedAt(null);
    setTimerElapsedBeforePause(0);
    setTimerSessionId(null);
    setTimerRecordDate(null);
    setTimerPlanId(null);
    clearPersistedTimer();
    setEventTitle("");
    setMessage(`已记录「${title}」：${formatMinutes(minutes)}。`);
  }

  function removeEvents(ids: string[]) {
    const removed = new Set(ids);
    updateForm((current) => ({ ...current, events: current.events.filter((event) => !removed.has(event.id)) }));
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
    latestSaveRef.current = null;
    const emptyForm = blankForm();
    formRef.current = emptyForm;
    setForm(emptyForm);
    setWeeklyRecords([]);
    setHistoryRecords([]);
    setPlans([]);
    setTimerPlanId(null);
    setSyncStatus("local");
  }

  async function saveDay() {
    queueAutosave(formRef.current, selectedDate);
    const saved = await flushAutosave();
    setMessage(saved ? "已立即同步今天的记录。" : "记录已保留在本地，网络恢复后会自动重试。");
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

  function renderPlanEffort(planId: string) {
    const effort = planEfforts[planId];
    if (!effort) return <span className="plan-effort-empty">尚未记录投入</span>;
    return <details className="plan-effort">
      <summary>累计投入 {formatMinutes(effort.minutes)} · {effort.entries.length} 条记录</summary>
      <div className="plan-effort-log">
        {[...effort.entries].sort((left, right) => right.recordDate.localeCompare(left.recordDate)).map((entry) => <span key={entry.id}>{entry.recordDate} · {entry.title} · {formatMinutes(entry.minutes)}</span>)}
      </div>
    </details>;
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
          <div className={`sync-pill sync-status-${syncStatus}`}>
            <span className={`sync-dot ${syncStatus === "saved" || (configured && session && authorized && syncStatus === "idle") ? "ok" : ""}`} />
            {syncStatus === "idle" && configured && session && !authorized ? "等待授权" : syncStatusLabel[syncStatus]}
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
            <input id="record-date" type="date" value={selectedDate} disabled={timerInProgress || dateChanging} onChange={(event) => void handleDateChange(event.target.value)} />
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

      <section className="card plan-library">
        <div className="card-head plan-library-head">
          <div>
            <div className="eyebrow">跨日需求计划库</div>
            <h2 className="card-title">先把需求放进计划，再把投入沉淀成可追溯事件。</h2>
            <p className="card-caption">计划可跨日保留；只有你手动排入的事项会出现在当天。一次计时结束不会自动关闭长期计划。</p>
          </div>
          <div className="plan-head-actions">
            <button className="button button-secondary" type="button" disabled={!configured || !session || !authorized || planSaving} onClick={() => openPlanComposer("general")}>新建计划</button>
            <button className="button" type="button" disabled={!configured || !session || !authorized || planSaving} onClick={() => openPlanComposer("ai_batch")}>AI 批量化示例</button>
          </div>
        </div>

        {!configured || !session || !authorized ? (
          <p className="empty-state">登录并完成允许名单配置后，即可保存跨日计划并在不同设备上继续跟进。</p>
        ) : (
          <>
            {planComposerOpen && (
              <form className="plan-composer" onSubmit={(event) => { event.preventDefault(); void savePlan(); }}>
                <div className="plan-composer-head">
                  <div><strong>{editingPlanId ? "编辑计划" : "快速记录计划"}</strong><span>AI 批量化示例只是静态预填内容，不会调用 AI 或要求 API Key。</span></div>
                  <button className="button-quiet" type="button" onClick={() => { setPlanComposerOpen(false); setEditingPlanId(null); }}>收起</button>
                </div>
                <div className="plan-form-grid">
                  <label className="plan-title-field"><span>计划标题</span><input value={planForm.title} autoFocus placeholder="例如：梳理 AI 批量处理需求的输入和验收标准" onChange={(event) => setPlanForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label><span>优先级</span><select value={planForm.priority} onChange={(event) => setPlanForm((current) => ({ ...current, priority: event.target.value as PlanPriority }))}>{(Object.keys(planPriorityMeta) as PlanPriority[]).map((priority) => <option key={priority} value={priority}>{planPriorityMeta[priority]}</option>)}</select></label>
                  <label><span>目标日</span><input type="date" value={planForm.target_date} onChange={(event) => setPlanForm((current) => ({ ...current, target_date: event.target.value }))} /></label>
                  <label><span>状态</span><select value={planForm.status} onChange={(event) => setPlanForm((current) => ({ ...current, status: event.target.value as PlanStatus }))}>{(Object.keys(planStatusMeta) as PlanStatus[]).map((status) => <option key={status} value={status}>{planStatusMeta[status]}</option>)}</select></label>
                  <label className="plan-wide-field"><span>下一步</span><input value={planForm.next_action} placeholder="例如：先拿到一小批脱敏样本并确认输出格式" onChange={(event) => setPlanForm((current) => ({ ...current, next_action: event.target.value }))} /></label>
                  <label className="plan-wide-field"><span>需求说明（可选）</span><textarea value={planForm.details} placeholder="记录背景、范围、验收标准、风险或依赖；不要填写敏感信息。" onChange={(event) => setPlanForm((current) => ({ ...current, details: event.target.value }))} /></label>
                </div>
                <div className="plan-composer-actions">
                  <button className="button button-secondary" type="button" onClick={() => { setPlanComposerOpen(false); setEditingPlanId(null); }}>取消</button>
                  <button className="button" type="submit" disabled={planSaving}>{planSaving ? "正在保存…" : editingPlanId ? "保存修改" : "保存计划"}</button>
                </div>
              </form>
            )}

            <div className="plan-section-head"><div><span className="eyebrow">当天安排</span><strong>{dateLabel(selectedDate)}</strong></div><span>{scheduledPlans.length} 条已排入</span></div>
            <div className="plan-list">
              {scheduledPlans.length ? scheduledPlans.map((plan) => <article className="plan-row" data-status={plan.status} key={plan.id}>
                <div className="plan-row-main">
                  <div className="plan-badges"><span className={`plan-priority ${plan.priority}`}>{planPriorityMeta[plan.priority]}</span><span className={`plan-status ${plan.status}`}>{planStatusMeta[plan.status]}</span></div>
                  <strong>{plan.title}</strong>
                  <p><b>下一步：</b>{plan.next_action}</p>
                  <span className="plan-meta">目标日 {plan.target_date}</span>
                  {renderPlanEffort(plan.id)}
                  {plan.details && <details className="plan-details"><summary>查看需求说明</summary><p>{plan.details}</p></details>}
                </div>
                <div className="plan-row-actions">
                  <button className="button" type="button" disabled={planSaving || timerInProgress} onClick={() => prepareTimerForPlan(plan)}>关联到计时器</button>
                  <button className="button button-secondary" type="button" disabled={planSaving} onClick={() => unschedulePlan(plan)}>移出当天</button>
                  <select aria-label={`更新计划状态：${plan.title}`} value={plan.status} disabled={planSaving} onChange={(event) => void updateExistingPlan(plan, { status: event.target.value as PlanStatus }, `已更新「${plan.title}」状态。`)}>{(Object.keys(planStatusMeta) as PlanStatus[]).map((status) => <option key={status} value={status}>{planStatusMeta[status]}</option>)}</select>
                  <button className="button-quiet" type="button" disabled={planSaving} onClick={() => editPlan(plan)}>编辑</button>
                </div>
              </article>) : <p className="empty-state">今天还没有排入计划。可以从下方需求库选择一项，或直接新建。</p>}
            </div>

            <details className="plan-pool" open={otherOpenPlans.length < 4}>
              <summary>未排入当天的进行中计划（{otherOpenPlans.length}）</summary>
              <div className="plan-list">
                {otherOpenPlans.length ? otherOpenPlans.map((plan) => <article className="plan-row compact" data-status={plan.status} key={plan.id}>
                  <div className="plan-row-main"><div className="plan-badges"><span className={`plan-priority ${plan.priority}`}>{planPriorityMeta[plan.priority]}</span><span className={`plan-status ${plan.status}`}>{planStatusMeta[plan.status]}</span></div><strong>{plan.title}</strong><p><b>下一步：</b>{plan.next_action}</p><span className="plan-meta">目标日 {plan.target_date}{plan.scheduled_date ? ` · 当前安排 ${plan.scheduled_date}` : " · 尚未安排"}</span>{renderPlanEffort(plan.id)}</div>
                  <div className="plan-row-actions"><button className="button button-secondary" type="button" disabled={planSaving} onClick={() => schedulePlan(plan)}>{plan.scheduled_date ? "改排到当天" : "排入当天"}</button><button className="button-quiet" type="button" disabled={planSaving} onClick={() => editPlan(plan)}>编辑</button></div>
                </article>) : <p className="empty-state">暂无其他未完成计划。</p>}
              </div>
            </details>

            <details className="plan-pool completed-plans">
              <summary>已完成计划（{completedPlans.length}）</summary>
              <div className="plan-list">
                {completedPlans.map((plan) => <article className="plan-row compact" data-status={plan.status} key={plan.id}><div className="plan-row-main"><div className="plan-badges"><span className={`plan-priority ${plan.priority}`}>{planPriorityMeta[plan.priority]}</span><span className="plan-status completed">已完成</span></div><strong>{plan.title}</strong><p><b>最后下一步：</b>{plan.next_action}</p><span className="plan-meta">目标日 {plan.target_date}</span>{renderPlanEffort(plan.id)}</div><div className="plan-row-actions"><button className="button-quiet" type="button" disabled={planSaving} onClick={() => editPlan(plan)}>查看 / 重开</button></div></article>)}
                {!completedPlans.length && <p className="empty-state">完成的计划会保留在这里，方便以后回看。</p>}
              </div>
            </details>
          </>
        )}
      </section>

      <section className="main-grid">
        <section className="card focus-card">
          <div className="card-head">
            <div>
              <div className="eyebrow">今日行动</div>
              <h2 className="card-title">先记录事件，时间由计时器生成。</h2>
              <p className="card-caption">每条记录都要能回答：我做了什么、属于哪条能力主线、花了多久。</p>
            </div>
            <div className="record-status-cluster">
              {loading && <span className="sync-pill">正在读取…</span>}
              {!loading && <span className={`record-sync-status ${syncStatus}`} role="status"><span className="status-mark" />{syncStatusLabel[syncStatus]}</span>}
            </div>
          </div>

          {timerPlan && <div className="timer-plan-link"><div><span>本次投入已关联计划</span><strong>{timerPlan.title}</strong></div>{!timerInProgress && <button className="button-quiet" type="button" onClick={clearTimerPlan}>取消关联</button>}</div>}

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
            <p>{mergedEvents.length ? `共 ${mergedEvents.length} 条可复盘事件` : "完成一次具体行动后，记录会出现在这里。"}</p>
          </div>

          <div className="event-list" aria-live="polite">
            {mergedEvents.length ? mergedEvents.map((event) => {
              const linkedPlan = event.planId ? plans.find((plan) => plan.id === event.planId) : null;
              return <article className="event-row" key={event.key}>
                <span className={`event-dot ${event.category}`} />
                <div><strong>{event.title}</strong><span>{categoryMeta[event.category].label}{event.count > 1 ? ` · ${event.count} 次` : ""}{linkedPlan ? ` · 关联计划：${linkedPlan.title}` : ""}</span></div>
                <time>{formatMinutes(event.minutes)}</time>
                <button className="button-quiet" type="button" onClick={() => removeEvents(event.ids)} aria-label={`删除事件：${event.title}`}>删除</button>
              </article>;
            }) : <p className="empty-state">还没有事件。选择一件 20 分钟内可完成的小事，点击“开始计时”。</p>}
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
            <button className="button" type="button" disabled={saving || dateChanging} onClick={saveDay}>{saving ? "正在同步…" : "立即同步"}</button>
          </div>
          {message && <p className="feedback" role="status">{message}</p>}
        </section>

        <aside className="side-stack">
          <section className="card project-card">
            <div className="eyebrow">作品集主项目 · 闲置贩子</div>
            <h2 className="card-title">把一件闲置，变成一条能发布的商品</h2>
            <p>它不是自动发帖工具，而是从一张照片开始，帮普通人补齐商品信息、写出可信文案，并给出带依据的挂牌建议。</p>
            <ol>
              {primaryProjectSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <div className="project-first-step"><strong>第一版：</strong>先支持少量明确品类；用户补充品牌、型号、成色和配件后，再输出挂牌建议、文案草稿与待补照片清单。</div>
            <div className="project-secondary-note"><strong>另一个方向：</strong>消费维权助手「要钱官」暂作为备选，先不和主项目争夺首页注意力。</div>
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
            const mergedEvents = mergeEventsForDisplay(events);
            return <article className="history-row" key={record.id}>
              <button className="history-date" type="button" onClick={() => setSelectedDate(record.record_date)}><strong>{dateLabel(record.record_date)}</strong><span>{record.record_date}</span></button>
              <div className="history-main"><strong>{record.top_goal || "未填写主目标"}</strong><div className="history-events">{events.length ? mergedEvents.map((event) => <span key={event.key}>{event.title}{event.count > 1 ? ` ×${event.count}` : ""} · {event.minutes}m</span>) : <span>未记录具体事件</span>}</div></div>
              <div className="history-total"><strong>{formatMinutes(totalMinutes(events))}</strong><span>{record.completed ? "已闭环" : "进行中"}</span></div>
            </article>;
          }) : <p className="empty-state">{configured && session ? "还没有已同步的历史记录。保存今天的事件后，它会出现在这里。" : "登录并保存记录后，可以在这里查看全部历史。"}</p>}
        </div>
        {historyHasMore && <button className="button button-secondary load-more" type="button" disabled={historyLoading} onClick={loadMoreHistory}>{historyLoading ? "正在加载…" : "加载更早的记录"}</button>}
      </section>

      <p className="footer-note">隐私边界：项目只应使用公开或脱敏样例。不要上传账号密码、身份证/手机号、完整聊天记录、订单隐私、公司内部日志或其他可直接识别个人与组织的信息。</p>
    </main>
  );
}
