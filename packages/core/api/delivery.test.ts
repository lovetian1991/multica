// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
const client = new ApiClient("https://api.example.test");
const delivery = {
  id: "delivery", project_config_id: "config", project_path: "team/app",
  sha: "a".repeat(40), ref: "feature", status: "future_status",
};
const integration = {
  source_ref: "feature", source_sha: delivery.sha, target_ref: "prod-9.1", state: "preview",
};

it("previews and explicitly confirms integration using the configured target", async () => {
  let fetcher = reply({ integration });
  const preview = await client.integrateDelivery("issue", "delivery");
  expect(preview.integration).toMatchObject({ targetRef: "prod-9.1", sourceSha: delivery.sha });
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ merge: false });
  fetcher = reply({ integration: { ...integration, state: "blocked", merge_request_url: "javascript:alert(1)" } });
  const blocked = await client.integrateDelivery("issue", "delivery", { merge: true, targetRef: "prod-9.1" });
  expect(blocked.integration.mergeRequestUrl).toBe("");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ merge: true, target_ref: "prod-9.1" });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/api/issues/issue/deliveries/delivery/integrate");
});

it("rejects incomplete or inconsistent integration evidence", async () => {
  for (const body of [{}, { integration: {} }, { integration: { ...integration, source_sha: "short" } },
    { integration: { ...integration, state: "merged", merge_sha: delivery.sha } },
    { integration: { ...integration, state: "merged", merge_sha: delivery.sha }, delivery },
  ]) {
    reply(body);
    await expect(client.integrateDelivery("issue", "delivery")).rejects.toThrow();
  }
  reply({ integration: { ...integration, state: "merged", merge_sha: delivery.sha },
    delivery: { ...delivery, ref: "prod-9.1", result: { integration: { ...integration, state: "merged" } } } });
  const result = await client.integrateDelivery("issue", "delivery");
  expect(result.delivery?.result.integration?.targetRef).toBe("prod-9.1");
});
function reply(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("rejects malformed delivery inventories instead of hiding ongoing work", async () => {
  for (const body of [{}, { deliveries: null }, { available: "false", deliveries: [] }, { deliveries: [{ ...delivery, terminal: "true" }] }]) {
    reply(body);
    await expect(client.listIssueDeliveries("issue")).rejects.toThrow();
  }
  reply({ projects: [{ id: "partial" }] });
  await expect(client.listDeliveryProjects("ws")).rejects.toThrow();
});

it("preserves empty, disabled and forward-compatible delivery results", async () => {
  reply({ available: false, deliveries: [] });
  await expect(client.listIssueDeliveries("issue")).resolves.toEqual({ available: false, deliveries: [] });
  reply({ available: true, deliveries: [delivery] });
  const result = await client.listIssueDeliveries("issue");
  expect(result.deliveries[0]).toMatchObject({
    status: "future_status", terminal: false, projectPath: "team/app",
    result: { pipelineId: 0, deploymentUrl: "", downstreamPipelines: [] },
  });
});

it("parses child pipeline evidence and rejects malformed child inventories", async () => {
  reply({ available: true, deliveries: [{ ...delivery, result: {
    downstream_pipelines: [{ id: 3, name: "trigger-aiagent", status: "failed", url: "https://git.test/pipelines/3" },
      { id: 4, url: "javascript:alert(1)" }],
  } }] });
  const result = await client.listIssueDeliveries("issue");
  expect(result.deliveries[0]?.result.downstreamPipelines).toEqual([
    { id: 3, name: "trigger-aiagent", status: "failed", url: "https://git.test/pipelines/3" },
    { id: 4, name: "", status: "unknown", url: "" },
  ]);
  for (const children of [null, [{ id: "3" }], [{ id: -1 }]]) {
    reply({ available: true, deliveries: [{ ...delivery, result: { downstream_pipelines: children } }] });
    await expect(client.listIssueDeliveries("issue")).rejects.toThrow();
  }
});

it("does not render unsafe delivery links", async () => {
  reply({ available: true, deliveries: [{ ...delivery, result: { deployment_url: "javascript:alert(1)", pipeline_url: "https://gitlab.test/pipeline/1" } }] });
  const result = await client.listIssueDeliveries("issue");
  expect(result.deliveries[0]?.result).toMatchObject({ deploymentUrl: "", pipelineUrl: "https://gitlab.test/pipeline/1" });
});

it("identifies configured remote instances without returning a token", async () => {
  reply({ projects: [{
    id: "config", connection_id: "connection", instance_url: "https://gitlab.test",
    project_id: 7, project_path: "team/app",
    rules: { deployment_job: "deploy", allowed_hosts: ["app.test"] },
  }] });
  const result = await client.listDeliveryProjects("ws");
  expect(result.projects[0]).toMatchObject({ instanceUrl: "https://gitlab.test", projectPath: "team/app" });
});

it("registers exact evidence and rejects malformed mutation responses", async () => {
  const fetcher = reply(delivery);
  await client.registerDelivery("issue", { projectConfigId: "config", sha: delivery.sha, ref: "feature" });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/api/issues/issue/deliveries");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    project_config_id: "config", sha: delivery.sha, ref: "feature",
  });
  reply({});
  await expect(client.registerDelivery("issue", { projectConfigId: "config", sha: delivery.sha, ref: "feature" })).rejects.toThrow();
  await expect(client.resumeDelivery("issue", "delivery")).rejects.toThrow();
  await expect(client.saveDeliveryProject("ws", {
    connectionId: "connection", projectId: 7,
    rules: { deploymentJob: "deploy", pipelineSource: "push", urlPrefix: "MULTICA_DEPLOY_URL=", allowedHosts: ["app.test"], timeoutMinutes: 120 },
  })).rejects.toThrow();
});

it("does not swallow tracking permission failures", async () => {
  reply({ error: "forbidden" }, 403);
  await expect(client.resumeDelivery("issue", "delivery")).rejects.toThrow();
  await expect(client.deleteDeliveryProject("ws", "config")).rejects.toThrow();
});

const defaults = {
  enabled: true,
  rules: { auto_discover: true, deployment_job: "", pipeline_source: "push",
    url_prefix: "MULTICA_DEPLOY_URL=", allowed_hosts: [], timeout_minutes: 120 },
};

it("reads and saves workspace defaults without per-repository identifiers or credentials", async () => {
  reply(defaults);
  const result = await client.getDeliveryDefaults("ws");
  expect(result).toMatchObject({ enabled: true, rules: { autoDiscover: true, deploymentJob: "", allowedHosts: [] } });
  const fetcher = reply(defaults);
  await client.saveDeliveryDefaults("ws", result);
  expect(fetcher.mock.calls[0]?.[0]).toContain("/api/workspaces/ws/vcs/delivery-defaults");
  expect(fetcher.mock.calls[0]?.[1].method).toBe("PUT");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual(defaults);
});

it("rejects missing and malformed tracking defaults on reads and writes", async () => {
  reply(defaults);
  const input = await client.getDeliveryDefaults("ws");
  for (const body of [{}, { ...defaults, enabled: "true" },
    { ...defaults, rules: { ...defaults.rules, auto_discover: "true" } },
    { ...defaults, rules: { ...defaults.rules, allowed_hosts: null } }]) {
    reply(body);
    await expect(client.getDeliveryDefaults("ws")).rejects.toThrow();
    await expect(client.saveDeliveryDefaults("ws", input)).rejects.toThrow();
  }
});

it("registers an actual repository URL without requiring a numeric or configuration ID", async () => {
  const fetcher = reply(delivery);
  await client.registerDelivery("issue", { repositoryUrl: "git@git.test:team/app.git", sha: delivery.sha, ref: "feature" });
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    repository_url: "git@git.test:team/app.git", sha: delivery.sha, ref: "feature",
  });
});

it("preserves inherited rules and defaults old explicit configurations to overrides", async () => {
  const project = { id: "config", connection_id: "connection", project_id: 7, project_path: "team/app", rules: defaults.rules };
  reply({ projects: [{ ...project, inherits_defaults: true }, project] });
  const result = await client.listDeliveryProjects("ws");
  expect(result.projects.map((p) => p.inheritsDefaults)).toEqual([true, false]);
  reply({ projects: [{ ...project, inherits_defaults: "true" }] });
  await expect(client.listDeliveryProjects("ws")).rejects.toThrow();
});
