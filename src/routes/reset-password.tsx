import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password | AI Opportunity Finder" }, { name: "description", content: "Choose a new password for AI Opportunity Finder." }, { property: "og:title", content: "Reset password" }, { property: "og:description", content: "Choose a new password for your account." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recovery = typeof window !== "undefined" && (window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery"));
  async function update() {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error?.message ?? "Password updated. You can return to the app.");
    setBusy(false);
  }
  return <div className="grid min-h-screen place-items-center p-4"><section className="surface w-full max-w-sm p-6"><h1 className="text-xl font-semibold">Choose a new password</h1>{!recovery && <p className="mt-2 text-sm text-warning">Open this page from the password-reset email.</p>}<Input className="mt-5" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" /><Button className="mt-3 w-full" onClick={update} disabled={busy || password.length < 8}>{busy && <Loader2 className="size-4 animate-spin" />}Update password</Button>{message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}<Link to="/" className="mt-4 block text-sm text-primary">Return to sign in</Link></section></div>;
}