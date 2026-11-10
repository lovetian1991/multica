// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
const client = new ApiClient("https://api.example.test");
const delivery = {
  id: "delivery", project_config_id: "config", project_path: "team/app",
  sha: "a".repeat(40), ref: "feature", status: "future_status",
};
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
    result: { pipelineId: 0, deploymentUrl: "" },
  });
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
