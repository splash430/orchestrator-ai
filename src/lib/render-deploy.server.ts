const RENDER_API = "https://api.render.com/v1";

type RenderServiceCreateResult = {
  service: {
    id: string;
    serviceDetails?: { url?: string };
  };
};

type RenderServiceResult = {
  serviceDetails?: { url?: string };
  suspended?: string;
};

export function normalizeRepoUrl(input: string) {
  const urlMatch = input.match(/https?:\/\/(?:www\.)?(?:github|gitlab)\.com\/[^\s/]+\/[^\s/]+/i);
  const candidate = (urlMatch?.[0] ?? input).trim().replace(/\.git$/i, "").replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid GitHub or GitLab repository URL.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com" && host !== "gitlab.com") {
    throw new Error("Render requires a GitHub or GitLab repository URL.");
  }

  const [namespace, repository, ...extraParts] = parsed.pathname.split("/").filter(Boolean);
  if (!namespace || !repository || extraParts.length > 0) {
    throw new Error("Use the repo root URL only, for example https://github.com/owner/repo.");
  }

  return `https://${host}/${namespace}/${repository.replace(/\.git$/i, "")}`;
}

async function renderFetch(path: string, apiKey: string, init: RequestInit = {}) {
  const res = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const hint = text.includes("invalid or unfetchable")
      ? " Render could not access that repo. Make sure the repo exists and the Render GitHub integration has access to it, then retry."
      : "";
    throw new Error(`render ${path} ${res.status}: ${text.slice(0, 500)}${hint}`);
  }
  return json;
}

async function getOwnerId(apiKey: string): Promise<string> {
  const list = (await renderFetch("/owners?limit=1", apiKey)) as Array<{ owner: { id: string } }>;
  const id = list?.[0]?.owner?.id;
  if (!id) throw new Error("No Render owner found on this account.");
  return id;
}

export async function createWorkerService(params: {
  renderKey: string;
  workerToken: string;
  userId: string;
  repoUrl: string;
  branch: string;
}) {
  const ownerId = await getOwnerId(params.renderKey);
  const serviceName = `playwright-worker-${params.userId.slice(0, 8)}`;

  const created = (await renderFetch("/services", params.renderKey, {
    method: "POST",
    body: JSON.stringify({
      type: "web_service",
      name: serviceName,
      ownerId,
      repo: params.repoUrl,
      branch: params.branch,
      autoDeploy: "yes",
      serviceDetails: {
        env: "docker",
        region: "oregon",
        plan: "starter",
        runtime: "docker",
        dockerfilePath: "./worker/Dockerfile",
        dockerContext: "./worker",
        envSpecificDetails: {
          dockerfilePath: "./worker/Dockerfile",
          dockerContext: "./worker",
        },
        envVars: [
          { key: "WORKER_TOKEN", value: params.workerToken },
          { key: "NODE_ENV", value: "production" },
        ],
      },
    }),
  })) as RenderServiceCreateResult;

  return {
    serviceId: created.service.id,
    url: created.service.serviceDetails?.url ?? null,
  };
}

export async function getRenderService(renderKey: string, serviceId: string) {
  return (await renderFetch(`/services/${serviceId}`, renderKey)) as RenderServiceResult;
}