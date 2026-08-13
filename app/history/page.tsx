"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../supabase-client";

type LearningCategory = "java_ai" | "platform" | "foundation";
type PlanNote = { blocker: string; reflection: string };
type LearningEvent = { id: string; title: string; category: LearningCategory; minutes: number; planId?: string; source?: string };
type EvidenceItem = { id: string; type: "text" | "link" | "github_commit"; text?: string; title?: string; url?: string; repo?: string; message?: string; commitUrl?: string; planId?: string; createdAt: string };
type StoredDay = { id: string; user_id: string; record_date: string; events?: unknown; evidence_json?: unknown; evidence?: string; plan_notes?: unknown; completed?: boolean; java_ai_minutes?: number; platform_minutes?: number; foundation_minutes?: number };
type WorkPlan = { id: string; title: string };

const pageSize = 12;
const categoryLabels: Record<LearningCategory, string> = { java_ai: "Java / AI 应用", platform: "云原生 / 平台", foundation: "算法 / 英语" };

function toDateLabel(dateKey: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${dateKey}T12:00:00`)); }
function formatMinutes(minutes: number) { if (minutes < 60) return `${minutes} 分钟`; const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`; }
function createId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function normalizeEvents(value: unknown, record: StoredDay): LearningEvent[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => { if (!item || typeof item !== "object") return []; const raw = item as Record<string, unknown>; if (typeof raw.title !== "string" || !raw.title.trim() || !["java_ai", "platform", "foundation"].includes(String(raw.category)) || typeof raw.minutes !== "number" || raw.minutes < 1) return []; return [{ id: typeof raw.id === "string" ? raw.id : `event-${index}`, title: raw.title.trim(), category: raw.category as LearningCategory, minutes: Math.round(raw.minutes), ...(typeof raw.planId === "string" && raw.planId ? { planId: raw.planId } : {}), source: typeof raw.source === "string" ? raw.source : undefined }]; });
  return ([ ["java_ai", record.java_ai_minutes], ["platform", record.platform_minutes], ["foundation", record.foundation_minutes] ] as Array<[LearningCategory, number | undefined]>).flatMap(([category, minutes]) => minutes && minutes > 0 ? [{ id: `legacy-${category}`, title: `${categoryLabels[category]}（旧版累计）`, category, minutes }] : []);
}
function normalizeEvidence(value: unknown): EvidenceItem[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => { if (!item || typeof item !== "object") return []; const raw = item as Record<string, unknown>; const type = raw.type === "link" || raw.type === "github_commit" ? raw.type : "text"; const message = typeof raw.message === "string" ? raw.message.trim() : ""; const text = typeof raw.text === "string" ? raw.text.trim() : ""; const url = typeof raw.url === "string" ? raw.url.trim() : ""; if (!message && !text && !url) return []; return [{ id: typeof raw.id === "string" ? raw.id : `evidence-${index}`, type, ...(text ? { text } : {}), ...(message ? { message } : {}), ...(url ? { url } : {}), ...(typeof raw.title === "string" ? { title: raw.title } : {}), ...(typeof raw.repo === "string" ? { repo: raw.repo } : {}), ...(typeof raw.commitUrl === "string" ? { commitUrl: raw.commitUrl } : {}), ...(typeof raw.planId === "string" && raw.planId ? { planId: raw.planId } : {}), createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString() }]; });
  if (typeof value === "string" && value.trim()) return [{ id: createId("evidence"), type: "text", text: value.trim(), createdAt: new Date().toISOString() }];
  return [];
}
function normalizePlanNotes(value: unknown): Record<string, PlanNote> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.entries(value as Record<string, unknown>).reduce<Record<string, PlanNote>>((notes, [id, item]) => { if (!item || typeof item !== "object") return notes; const raw = item as Record<string, unknown>; const blocker = typeof raw.blocker === "string" ? raw.blocker : ""; const reflection = typeof raw.reflection === "string" ? raw.reflection : ""; if (blocker || reflection) notes[id] = { blocker, reflection }; return notes; }, {}); }
function totalMinutes(events: LearningEvent[]) { return events.reduce((sum, event) => sum + event.minutes, 0); }

export default function HistoryPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [records, setRecords] = useState<StoredDay[]>([]);
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const configured = isSupabaseConfigured;

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    const client = getSupabase(); if (!client) { setLoading(false); return; }
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthorized(false); });
    return () => listener.subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    async function load() {
      if (!configured || !session) { setLoading(false); return; }
      const client = getSupabase(); if (!client) { setLoading(false); return; }
      setLoading(true);
      const [{ data: access, error: accessError }, { data, error }, { data: planData, error: planError }] = await Promise.all([
        client.from("allowed_users").select("user_id").eq("user_id", session.user.id).maybeSingle(),
        client.from("learning_days").select("*").order("record_date", { ascending: false }).range(0, pageSize - 1),
        client.from("work_plans").select("id, title").order("target_date", { ascending: true }),
      ]);
      if (accessError || !access) { setMessage(accessError?.message ?? "??????????????????? Supabase ?????"); setLoading(false); return; }
      if (error) { setMessage(error.message || "???????????? Supabase ?????????"); setLoading(false); return; }
      setAuthorized(true);
      if (planError) setMessage("?????????????????????");
      setRecords((data as StoredDay[] | null) ?? []); setPlans((planData as WorkPlan[] | null) ?? []); setHasMore((data?.length ?? 0) === pageSize); setLoading(false);
    }
    void load();
  }, [configured, session]);

  async function loadMore() {
    if (!session || !authorized || loadingMore || !hasMore) return;
    const client = getSupabase(); if (!client) return;
    setLoadingMore(true);
    const { data, error } = await client.from("learning_days").select("*").order("record_date", { ascending: false }).range(records.length, records.length + pageSize - 1);
    if (error) setMessage("加载更早的历史记录失败，请稍后重试。");
    const next = (data as StoredDay[] | null) ?? [];
    setRecords((current) => [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))]); setHasMore(next.length === pageSize); setLoadingMore(false);
  }

  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.id, plan.title])), [plans]);

  const zh = (value: string) => value.split(" ").map((token) => /^[0-9a-fA-F]+$/.test(token) ? String.fromCodePoint(Number.parseInt(token, 16)) : token).join("");
  const ui = {
    subtitle: zh("6bcf 5929 7684 6295 5165 3001 8bc1 636e 4e0e 590d 76d8"), history: zh("5386 53f2 6863 6848"), back: zh("8fd4 56de 4eca 65e5 884c 52a8"), intro: zh("6bcf 5929 7559 4e0b 4e86 4ec0 4e48 3001 6309 65e5 671f 6162 6162 56de 770b 3002"), description: zh("8fd9 91cc 8bb0 5f55 6bcf 5929 5b9e 9645 53d1 751f 7684 4e8b 4ef6 3001 5173 8054 8ba1 5212 3001 8bc1 636e 548c 590d 76d8 3001 4e0d 518d 8981 6c42 586b 5199 4e3b 76ee 6807 3002"), preview: zh("9884 89c8 6a21 5f0f"), previewText: zh("914d 7f6e  Supabase 5e76 767b 5f55 540e 3001 53ef 4ee5 67e5 770b 8de8 8bbe 5907 540c 6b65 7684 6bcf 65e5 6863 6848 3002"), checking: zh("6b63 5728 68c0 67e5 8d26 53f7 6388 6743 2026"), login: zh("767b 5f55 5e76 5b8c 6210 6388 6743 540e 3001 8fd9 91cc 4f1a 663e 793a 6bcf 5929 7684 8bb0 5f55 3002"), loading: zh("6b63 5728 52a0 8f7d 6bcf 65e5 6863 6848 2026"), events: zh("5f53 5929 4e8b 4ef6"), noEvents: zh("8fd9 4e00 5929 6ca1 6709 8bb0 5f55 5177 4f53 4e8b 4ef6 3002"), evidence: zh("8bc1 636e 4e0e 8ba1 5212 590d 76d8"), noEvidence: zh("8fd9 4e00 5929 6ca1 6709 7559 4e0b 8bc1 636e 3002"), noRecords: zh("8fd8 6ca1 6709 5df2 540c 6b65 7684 6bcf 65e5 6863 6848 3002"), openDay: zh("6253 5f00 5f53 5929 8bb0 5f55"), more: zh("52a0 8f7d 66f4 65e9 7684 8bb0 5f55"), loadingMore: zh("6b63 5728 52a0 8f7d 2026"), unlinked: zh("672a 5173 8054 8ba1 5212"), plan: zh("8ba1 5212"), text: zh("6587 5b57"), link: zh("94fe 63a5"), deletedPlan: zh("5df2 5220 9664 7684 8ba1 5212"), blocker: zh("5361 70b9 3a"), tomorrow: zh("660e 65e5 7b2c 4e00 6b65 3a"), closed: zh("5df2 5f62 6210 95ed 73af"), ongoing: zh("8fdb 884c 4e2d"), minutes: zh("5206 949f")
  };
  const content = !configured || !session || !authorized
    ? <section className="card archive-empty"><p className="empty-state">{configured && session ? message || ui.checking : ui.login}</p></section>
    : loading
      ? <section className="card archive-empty"><p className="empty-state">{ui.loading}</p></section>
      : <section className="daily-records">
          {records.length ? records.map((record) => {
            const events = normalizeEvents(record.events, record);
            const evidence = normalizeEvidence(record.evidence_json ?? record.evidence);
            const notes = normalizePlanNotes(record.plan_notes);
            return <article className="card daily-record" key={record.id}>
              <div className="daily-record-head"><div><div className="eyebrow">{toDateLabel(record.record_date)}</div><h2>{record.record_date}</h2></div><div className="daily-record-total"><strong>{formatMinutes(totalMinutes(events))}</strong><span>{record.completed ? ui.closed : ui.ongoing}</span></div></div>
              <div className="daily-record-grid">
                <section><h3>{ui.events}</h3>{events.length ? <div className="daily-event-list">{events.map((event) => <div className="daily-event" key={event.id}><div><strong>{event.title}</strong><span>{categoryLabels[event.category]}{event.planId ? " " + ui.dot + " " + (planMap.get(event.planId) ?? ui.plan) : " " + ui.dot + " " + ui.unlinked}</span></div><b>{formatMinutes(event.minutes)}</b></div>)}</div> : <p className="empty-state">{ui.noEvents}</p>}</section>
                <section><h3>{ui.evidence}</h3>{evidence.length ? <div className="daily-evidence-list">{evidence.map((item) => <div className="daily-evidence" key={item.id}><span>{item.type === "github_commit" ? "GitHub " + ui.dot + " " + (item.repo ?? "") : item.type === "link" ? ui.link : ui.text}{item.planId ? " " + ui.dot + " " + (planMap.get(item.planId) ?? ui.plan) : " " + ui.dot + " " + ui.unlinked}</span><strong>{item.message ?? item.text ?? item.title ?? item.url}</strong></div>)}</div> : <p className="empty-state">{ui.noEvidence}</p>}{Object.entries(notes).length ? <div className="daily-notes">{Object.entries(notes).map(([planId, note]) => <div className="daily-note" key={planId}><strong>{planMap.get(planId) ?? ui.deletedPlan}</strong>{note.blocker && <p><b>{ui.blocker}</b>{note.blocker}</p>}{note.reflection && <p><b>{ui.tomorrow}</b>{note.reflection}</p>}</div>)}</div> : null}</section>
              </div>
              <div className="daily-record-footer"><Link className="button-quiet" href={"/?date=" + record.record_date}>{ui.openDay}</Link></div>
            </article>;
          }) : <section className="card archive-empty"><p className="empty-state">{ui.noRecords}</p></section>}
          {hasMore && <button className="button button-secondary load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? ui.loadingMore : ui.more}</button>}
        </section>;

  return <main className="app-shell history-page">
    <header className="topbar"><div className="brand"><div className="brand-mark">LO</div><div><div className="brand-name">LEARNING OS</div><div className="brand-subtitle">{ui.subtitle}</div></div></div><div className="account-area"><Link className="button button-secondary" href="/">{ui.back}</Link>{session && <span className="sync-pill">{session.user.user_metadata?.user_name ?? session.user.email ?? ui.loggedIn}</span>}</div></header>
    <section className="page-intro"><div className="eyebrow">{ui.history}</div><h1>{ui.intro}</h1><p>{ui.description}</p></section>
    {!configured && <section className="notice"><strong>{ui.preview}{ui.colon}</strong>{ui.previewText}</section>}
    {message && <p className="feedback" role="status">{message}</p>}
    {content}
  </main>;
}
