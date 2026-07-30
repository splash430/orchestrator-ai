import { createFileRoute } from "@tanstack/react-router";
import { Pin, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Empty, LoadingScreen, Panel } from "@/routes/dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequireSession } from "@/hooks/use-session";
import {
  addMemory,
  categoryMeta,
  deleteMemory,
  listMemories,
  MEMORY_CATEGORIES,
  updateMemory,
  type Memory,
} from "@/lib/memory";

export const Route = createFileRoute("/memory")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AI memory — Operator" },
      {
        name: "description",
        content: "See and edit everything your AI assistant remembers about your business.",
      },
      { property: "og:title", content: "AI memory — Operator" },
      {
        property: "og:description",
        content: "See and edit everything your AI assistant remembers about your business.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemoryPage,
});

function MemoryPage() {
  const { userId } = useRequireSession();
  const [items, setItems] = useState<Memory[]>([]);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("business");

  useEffect(() => {
    if (!userId) return;
    listMemories().then(setItems).catch(() => {});
  }, [userId]);

  async function add() {
    if (!content.trim() || !userId) return;
    const m = await addMemory({ content: content.trim(), category, userId });
    setItems((p) => [m, ...p]);
    setContent("");
  }

  async function remove(id: string) {
    await deleteMemory(id);
    setItems((p) => p.filter((x) => x.id !== id));
  }

  async function togglePin(m: Memory) {
    await updateMemory(m.id, { pinned: !m.pinned });
    setItems((p) => p.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)));
  }

  if (userId === undefined) return <LoadingScreen />;
  if (userId === null) return null;

  return (
    <AppShell title="AI memory" subtitle="What the assistant knows and reuses in every task">
      <Panel title="Add something to remember">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMORY_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.emoji} {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="e.g. My website sells AI templates for creators"
            className="flex-1"
          />
          <Button onClick={add} className="gap-2 rounded-xl">
            <Plus className="size-4" /> Save
          </Button>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        {MEMORY_CATEGORIES.map((c) => {
          const list = items.filter((m) => m.category === c.value);
          if (!list.length) return null;
          return (
            <Panel key={c.value} title={`${c.emoji} ${c.label}`}>
              <ul className="space-y-2">
                {list.map((m) => (
                  <li
                    key={m.id}
                    className="group flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="flex-1">{m.content}</span>
                    <button
                      onClick={() => togglePin(m)}
                      aria-label="Pin memory"
                      className={m.pinned ? "text-primary" : "text-muted-foreground opacity-60"}
                    >
                      <Pin className="size-4" />
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      aria-label="Delete memory"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>

      {items.length === 0 && (
        <Panel title="Nothing remembered yet">
          <Empty text="Chat with the assistant — it picks up facts like “my website sells AI templates” automatically." />
        </Panel>
      )}
      <p className="text-xs text-muted-foreground">
        Memories in <strong>{categoryMeta("business").label}</strong> and other categories are sent
        with every task so messages sound like you.
      </p>
    </AppShell>
  );
}
