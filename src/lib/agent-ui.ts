import type { LucideIcon } from "lucide-react";
import {
  Brain,
  CheckCircle2,
  Globe,
  Loader2,
  PenLine,
  Search,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";

export type Stage =
  | "planning"
  | "opening"
  | "searching"
  | "collecting"
  | "writing"
  | "approval"
  | "finished"
  | "failed";

export const STAGES: Record<Stage, { label: string; icon: LucideIcon; tone: string }> = {
  planning: { label: "Planning the task", icon: Brain, tone: "text-primary" },
  opening: { label: "Opening browser", icon: Globe, tone: "text-primary" },
  searching: { label: "Searching", icon: Search, tone: "text-primary" },
  collecting: { label: "Collecting information", icon: Loader2, tone: "text-primary" },
  writing: { label: "Creating content", icon: PenLine, tone: "text-primary" },
  approval: { label: "Waiting for your approval", icon: ShieldQuestion, tone: "text-warning" },
  finished: { label: "Finished", icon: CheckCircle2, tone: "text-success" },
  failed: { label: "Something went wrong", icon: TriangleAlert, tone: "text-destructive" },
};

export const STAGE_ORDER: Stage[] = [
  "planning",
  "opening",
  "searching",
  "collecting",
  "writing",
  "finished",
];

type EventLike = { kind: string; data: Record<string, unknown> };

/** Turn raw worker events into a friendly, human-readable stage. */
export function deriveStage(events: EventLike[], runStatus?: string): Stage {
  if (runStatus === "failed") return "failed";
  if (runStatus === "succeeded") return "finished";

  let stage: Stage = "planning";
  for (const e of events) {
    if (e.kind === "error") return "failed";
    if (e.kind === "screenshot") stage = "collecting";
    if (e.kind === "tool_call") {
      const name = String(e.data.name ?? "").toLowerCase();
      if (name.includes("screenshot")) stage = "collecting";
      else if (name.includes("extract") || name.includes("read")) stage = "collecting";
      else if (name.includes("search")) stage = "searching";
      else if (name.includes("browse") || name.includes("goto") || name.includes("open"))
        stage = "opening";
      else if (name.includes("draft") || name.includes("write") || name.includes("compose"))
        stage = "writing";
      else stage = "collecting";
    }
    if (e.kind === "approval_request") return "approval";
  }
  return stage;
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export const STATUS_TONE: Record<string, string> = {
  running: "bg-primary/10 text-primary",
  pending: "bg-muted text-muted-foreground",
  succeeded: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
};
