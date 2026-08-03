import { createFileRoute } from "@tanstack/react-router";

// One-shot admin endpoint: pushes LOVABLE_API_KEY + WORKFLOW_CALLBACK_SECRET
// into the configured GitHub repo's Actions secrets, verifies the workflow and
// worker files are present, and can dispatch/poll a Playwright self-test run.
// Only ever touches the pre-configured GITHUB_REPO.

const UA = "lovable-orchestrator-app";

export const Route = createFileRoute("/api/public/wire-github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const wantDispatch = url.searchParams.get("dispatch") === "1";
        const wantPoll = url.searchParams.get("poll") === "1";

        const repo = process.env.GITHUB_REPO?.trim();
        const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
        const lovableKey = process.env.LOVABLE_API_KEY?.trim();
        const callback = process.env.WORKFLOW_CALLBACK_SECRET;


        if (!repo || !token) {
          return Response.json(
            { ok: false, error: "GITHUB_REPO or GITHUB_DISPATCH_TOKEN missing" },
            { status: 400 },
          );
        }

        const gh = (path: string, init?: RequestInit) =>
          fetch(`https://api.github.com/repos/${repo}${path}`, {
            ...init,
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "x-github-api-version": "2022-11-28",
              "content-type": "application/json",
              "user-agent": UA,
              ...(init?.headers || {}),
            },
          });

        // 1. Repo reachable?
        const repoRes = await gh("");
        if (!repoRes.ok) {
          return Response.json(
            {
              ok: false,
              step: "repo",
              status: repoRes.status,
              error: (await repoRes.text()).slice(0, 400),
              hint:
                repoRes.status === 404
                  ? "Repo not found or token lacks access. GITHUB_REPO must be 'owner/repo' with repo + workflow scope."
                  : undefined,
            },
            { status: 200 },
          );
        }
        const repoInfo = (await repoRes.json()) as { default_branch?: string };
        const branch = repoInfo.default_branch || "main";

        // Poll-only mode: return latest runs for both workflows.
        if (wantPoll) {
          const runsRes = await gh(`/actions/runs?per_page=10`);
          const runsJson = (await runsRes.json()) as {
            workflow_runs?: Array<Record<string, unknown>>;
          };
          const runs = (runsJson.workflow_runs || []).map((r) => ({
            name: r.name,
            id: r.id,
            status: r.status,
            conclusion: r.conclusion,
            html_url: r.html_url,
            created_at: r.created_at,
          }));
          return Response.json({ ok: true, repo, runs });
        }

        // 2. Verify required files exist in the repo
        const checkPath = async (p: string) => {
          const r = await gh(`/contents/${p}?ref=${branch}`);
          return r.ok;
        };
        const [workflowFile, selftestFile, workerDir, workerRun, workerSelftest] =
          await Promise.all([
            checkPath(".github/workflows/run-command.yml"),
            checkPath(".github/workflows/selftest.yml"),
            checkPath("worker"),
            checkPath("worker/run.mjs"),
            checkPath("worker/selftest.mjs"),
          ]);

        // 3. Push encrypted secrets (non-fatal: report and continue)
        const secrets: Array<{ name: string; ok: boolean; status: number; body?: string }> = [];
        let secretsError: Record<string, unknown> | undefined;
        if (lovableKey && callback) {
          const keyRes = await gh("/actions/secrets/public-key");
          if (!keyRes.ok) {
            secretsError = {
              step: "public-key",
              status: keyRes.status,
              error: (await keyRes.text()).slice(0, 400),
              hint: "The stored GitHub token cannot write Actions secrets. A classic PAT needs 'repo' + 'workflow'; a fine-grained token needs Repository permissions → Secrets: Read and write (plus Actions: Read and write, Contents: Read).",
            };
          } else {
          const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };
          const sodium = (await import("libsodium-wrappers")).default;
          await sodium.ready;
          const keyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);

          for (const [name, value] of [
            ["LOVABLE_API_KEY", lovableKey],
            ["WORKFLOW_CALLBACK_SECRET", callback],
          ] as const) {
            const enc = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
            const encrypted_value = sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
            const r = await gh(`/actions/secrets/${name}`, {
              method: "PUT",
              body: JSON.stringify({ encrypted_value, key_id }),
            });
            secrets.push({
              name,
              ok: r.ok,
              status: r.status,
              body: r.ok ? undefined : (await r.text()).slice(0, 200),
            });
          }
          }
        }


        // 4. Optionally dispatch the Playwright self-test
        let dispatch: Record<string, unknown> | undefined;
        if (wantDispatch) {
          if (!selftestFile) {
            dispatch = { ok: false, error: "selftest.yml not present in repo yet" };
          } else {
            const d = await gh(`/actions/workflows/selftest.yml/dispatches`, {
              method: "POST",
              body: JSON.stringify({
                ref: branch,
                inputs: { target_url: "https://www.reddit.com" },
              }),
            });
            dispatch = {
              ok: d.ok,
              status: d.status,
              error: d.ok ? undefined : (await d.text()).slice(0, 300),
            };
          }
        }

        const secretsOk = secrets.length === 2 && secrets.every((s) => s.ok);
        return Response.json({
          ok: secretsOk && workflowFile && workerDir,
          repo,
          default_branch: branch,
          files: {
            ".github/workflows/run-command.yml": workflowFile,
            ".github/workflows/selftest.yml": selftestFile,
            "worker/": workerDir,
            "worker/run.mjs": workerRun,
            "worker/selftest.mjs": workerSelftest,
          },
          secrets,
          secretsError,
          dispatch,
          hint:

            workflowFile && workerDir
              ? undefined
              : "Repo is missing workflow/worker files — sync this project to GitHub.",
        });
      },
    },
  },
});
