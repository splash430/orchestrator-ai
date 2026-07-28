import { createFileRoute } from "@tanstack/react-router";

// One-shot admin endpoint: pushes ANTHROPIC_API_KEY + WORKFLOW_CALLBACK_SECRET
// into the configured GitHub repo's Actions secrets, and reports whether the
// run-command.yml workflow is present. Guarded by WORKFLOW_CALLBACK_SECRET
// (same shared secret the worker uses) sent as `x-admin-secret` header.

export const Route = createFileRoute("/api/public/wire-github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const repo = process.env.GITHUB_REPO;
        const token = process.env.GITHUB_DISPATCH_TOKEN;
        const anthropic = process.env.ANTHROPIC_API_KEY;
        const callback = process.env.WORKFLOW_CALLBACK_SECRET;

        // Idempotent one-shot wiring; only touches the pre-configured repo
        // that the stored token already has access to.
        void request;
        if (!callback) {
          return Response.json({ ok: false, error: "WORKFLOW_CALLBACK_SECRET missing" }, { status: 400 });
        }
        if (!repo || !token) {
          return Response.json(
            { ok: false, error: "GITHUB_REPO or GITHUB_DISPATCH_TOKEN missing" },
            { status: 400 },
          );
        }
        if (!anthropic) {
          return Response.json(
            { ok: false, error: "ANTHROPIC_API_KEY missing" },
            { status: 400 },
          );
        }

        const gh = async (path: string, init?: RequestInit) => {
          const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
            ...init,
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "x-github-api-version": "2022-11-28",
              "content-type": "application/json",
              ...(init?.headers || {}),
            },
          });
          return res;
        };

        // 1. Repo reachable?
        const repoRes = await gh("");
        if (!repoRes.ok) {
          const t = await repoRes.text();
          return Response.json(
            {
              ok: false,
              step: "repo",
              status: repoRes.status,
              error: t.slice(0, 400),
              hint:
                repoRes.status === 404
                  ? "Repo not found or token lacks access. GITHUB_REPO must be 'owner/repo' and the token needs repo + workflow scope."
                  : undefined,
            },
            { status: 200 },
          );
        }
        const repoInfo = (await repoRes.json()) as { default_branch?: string };

        // 2. Push encrypted secrets
        const keyRes = await gh("/actions/secrets/public-key");
        if (!keyRes.ok) {
          const t = await keyRes.text();
          return Response.json(
            {
              ok: false,
              step: "public-key",
              status: keyRes.status,
              error: t.slice(0, 400),
              hint: "Token likely missing 'actions:write' / 'secrets' permission.",
            },
            { status: 200 },
          );
        }
        const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };
        const sodium = (await import("libsodium-wrappers")).default;
        await sodium.ready;
        const keyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        const putSecret = async (name: string, value: string) => {
          const enc = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
          const encrypted_value = sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
          const r = await gh(`/actions/secrets/${name}`, {
            method: "PUT",
            body: JSON.stringify({ encrypted_value, key_id }),
          });
          return { name, ok: r.ok, status: r.status, body: r.ok ? "" : (await r.text()).slice(0, 200) };
        };
        const s1 = await putSecret("ANTHROPIC_API_KEY", anthropic);
        const s2 = await putSecret("WORKFLOW_CALLBACK_SECRET", callback);

        // 3. Verify workflow file present
        const wfRes = await gh("/actions/workflows");
        let workflowPresent = false;
        let workflowList: string[] = [];
        if (wfRes.ok) {
          const j = (await wfRes.json()) as { workflows?: Array<{ path: string; name: string }> };
          workflowList = (j.workflows || []).map((w) => w.path);
          workflowPresent = workflowList.some((p) => p.endsWith("run-command.yml"));
        }

        return Response.json({
          ok: s1.ok && s2.ok,
          repo,
          default_branch: repoInfo.default_branch,
          secrets: [s1, s2],
          workflow_present: workflowPresent,
          workflows: workflowList,
          hint: workflowPresent
            ? undefined
            : "Push .github/workflows/run-command.yml + worker/ to the repo (Lovable → GitHub sync).",
        });
      },
    },
  },
});
