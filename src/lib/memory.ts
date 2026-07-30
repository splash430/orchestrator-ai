import { supabase } from "@/integrations/supabase/client";

export type Memory = {
  id: string;
  category: string;
  content: string;
  source: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export const MEMORY_CATEGORIES = [
  { value: "business", label: "Business info", emoji: "🏢" },
  { value: "audience", label: "Target audience", emoji: "🎯" },
  { value: "style", label: "Writing style", emoji: "✍️" },
  { value: "instruction", label: "Standing instruction", emoji: "📌" },
  { value: "connection", label: "Website / account", emoji: "🔗" },
  { value: "general", label: "General", emoji: "💡" },
] as const;

export function categoryMeta(value: string) {
  return MEMORY_CATEGORIES.find((c) => c.value === value) ?? MEMORY_CATEGORIES[5];
}

export async function listMemories(): Promise<Memory[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function addMemory(input: {
  content: string;
  category: string;
  userId: string;
  source?: string;
}) {
  const { data, error } = await supabase
    .from("memories")
    .insert({
      content: input.content,
      category: input.category,
      user_id: input.userId,
      source: input.source ?? "manual",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Memory;
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, "content" | "category" | "pinned">>) {
  const { error } = await supabase.from("memories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteMemory(id: string) {
  const { error } = await supabase.from("memories").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Lightweight client-side detection of facts worth remembering, so the
 * assistant picks things up automatically from the chat box.
 */
const PATTERNS: { re: RegExp; category: string }[] = [
  { re: /\bmy (?:website|site|product|business|company|brand|app|store)\b[^.!?\n]{0,160}/i, category: "business" },
  { re: /\bmy (?:target )?(?:customers?|audience|clients?|users?)\b[^.!?\n]{0,160}/i, category: "audience" },
  { re: /\b(?:my )?(?:writing )?(?:style|tone|voice)\s+(?:should|is|must)\b[^.!?\n]{0,160}/i, category: "style" },
  { re: /\b(?:always|never|from now on|remember (?:that|to)?)\b[^.!?\n]{0,160}/i, category: "instruction" },
];

export function detectMemories(text: string): { content: string; category: string }[] {
  const found: { content: string; category: string }[] = [];
  for (const { re, category } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const content = m[0].trim().replace(/\s+/g, " ");
      if (content.length > 8 && !found.some((f) => f.content === content))
        found.push({ content, category });
    }
  }
  return found.slice(0, 3);
}

/** Memories that look relevant to a command — used for the "memory used" chip. */
export function relevantMemories(memories: Memory[], command: string): Memory[] {
  const words = new Set(
    command
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  const scored = memories.map((m) => {
    const mWords = m.content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const overlap = mWords.filter((w) => words.has(w)).length;
    return { m, score: overlap + (m.pinned ? 2 : 0) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.m);
}
