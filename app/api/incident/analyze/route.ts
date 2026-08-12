import { NextResponse } from "next/server";

type IncidentRequest = {
  alert?: { title?: string; service?: string; severity?: string; observedAt?: string };
  changes?: Array<{ id?: string; summary?: string; deployedAt?: string; author?: string }>;
  evidence?: Array<{ type?: string; content?: string; source?: string; observedAt?: string }>;
};

const evidenceTypes = new Set(["metric", "log", "trace", "deploy", "runbook"]);

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: Request) {
  let body: IncidentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const alert = body.alert ?? {};
  const title = text(alert.title);
  const service = text(alert.service);
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  const changes = Array.isArray(body.changes) ? body.changes : [];

  if (!title || !service) {
    return NextResponse.json({ error: "alert.title and alert.service are required." }, { status: 400 });
  }
  if (evidence.length > 20 || changes.length > 20) {
    return NextResponse.json({ error: "A request may contain at most 20 evidence items and 20 changes." }, { status: 400 });
  }

  const normalizedEvidence = evidence.map((item, index) => ({
    id: `evidence-${index + 1}`,
    type: evidenceTypes.has(text(item.type)) ? text(item.type) : "unknown",
    source: text(item.source, "unspecified"),
    content: text(item.content),
    observedAt: text(item.observedAt, "unspecified"),
  }));
  const normalizedChanges = changes.map((change, index) => ({
    id: text(change.id, `change-${index + 1}`),
    summary: text(change.summary, "Unspecified change"),
    deployedAt: text(change.deployedAt, "unspecified"),
    author: text(change.author, "unspecified"),
  }));

  const hasRecentChange = normalizedChanges.length > 0;
  const hasMetricEvidence = normalizedEvidence.some((item) => item.type === "metric");
  const hasLogEvidence = normalizedEvidence.some((item) => item.type === "log");
  const confidence = normalizedEvidence.length >= 3 && (hasMetricEvidence || hasLogEvidence) ? "medium" : "low";
  const risk = text(alert.severity).toLowerCase() === "critical" ? "high" : "medium";

  return NextResponse.json({
    schemaVersion: "incident-lens.v1",
    status: "needs_human_review",
    incident: { title, service, severity: text(alert.severity, "unknown"), observedAt: text(alert.observedAt, "unspecified") },
    assessment: {
      risk,
      confidence,
      summary: hasRecentChange
        ? `近期存在变更，${service} 的异常需要优先核对变更影响；当前证据不足以直接确认根因。`
        : `${service} 出现异常，但没有提供近期变更；需要补充指标、日志或链路证据后再判断。`,
      hypotheses: [
        {
          title: hasRecentChange ? "近期变更导致回归" : "运行时依赖或容量异常",
          confidence,
          evidenceIds: normalizedChanges.length ? normalizedChanges.map((change) => change.id) : normalizedEvidence.map((item) => item.id),
          falsificationCheck: hasRecentChange ? "对比变更前后错误率、延迟和依赖调用，确认异常是否随发布开始。" : "核对资源饱和度、依赖错误率和请求量是否同时升高。",
        },
      ],
      nextChecks: [
        "只读查询最近 30 分钟的错误率、p95 延迟和请求量。",
        "将异常时间线与最近部署或配置变更做关联。",
        "抽取 3 条代表性日志或 trace，确认是否为同一失败模式。",
      ],
      humanApprovalRequiredFor: ["rollback", "scale", "traffic_shift", "config_change"],
    },
    evidence: normalizedEvidence,
    changes: normalizedChanges,
    audit: {
      generatedAt: new Date().toISOString(),
      engine: "deterministic-baseline",
      model: null,
      evidenceCount: normalizedEvidence.length,
      changeCount: normalizedChanges.length,
      actionTaken: "none",
    },
  });
}
