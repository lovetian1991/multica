import { expect, test } from "@playwright/test";
import pg from "pg";
import { TestApiClient } from "./fixtures";

test.use({ screenshot: "only-on-failure", trace: "retain-on-failure" });

test("quick setup defaults to workspace inheritance and preserves project overrides", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const api = new TestApiClient();
  const db = new pg.Client(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  let workspaceCreated = false;
  await db.connect();
  try {
    const auth = await api.login(`setup-workflow-${suffix}@multica.ai`, "初始化确认人");
    const workspace = await api.createWorkspace("初始化验收", `setup-flow-${suffix}`);
    workspaceCreated = true;
    await api.markUserOnboarded();
    const target = await api.createProject("研发项目");
    const other = await api.createProject("其他项目");
    const squadIds: string[] = [];
    for (const name of ["产品设计小队", "开发小队"]) {
      const agent = await db.query<{ id: string }>(
        `INSERT INTO agent (workspace_id, name, description, instructions, runtime_mode, runtime_config,
          visibility, permission_mode, max_concurrent_tasks, owner_id)
         VALUES ($1, $2, '', '', 'cloud', '{}'::jsonb, 'private', 'private', 1, $3) RETURNING id`,
        [workspace.id, `${name}负责人`, auth.user.id],
      );
      const squad = await db.query<{ id: string }>(
        `INSERT INTO squad (workspace_id, name, description, leader_id, creator_id)
         VALUES ($1, $2, '', $3, $4) RETURNING id`,
        [workspace.id, name, agent.rows[0]!.id, auth.user.id],
      );
      squadIds.push(squad.rows[0]!.id);
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
    const read = async (path: string) => {
      const response = await fetch(`${apiBase}${path}`, {
        headers: { Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": workspace.id },
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${apiBase}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await context.addCookies([{
      name: "multica-locale", value: "zh-Hans", url: new URL(testInfo.project.use.baseURL!).origin,
    }]);
    await page.addInitScript((token) => {
      localStorage.setItem("multica_token", token!);
      localStorage.setItem("multica:chat:isOpen", "false");
    }, api.getToken());
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`/${workspace.slug}/settings?tab=setup`, { waitUntil: "domcontentloaded" });
    const configure = page.getByRole("switch", { name: "配置设计到开发流程" });
    await expect(configure).toBeChecked({ timeout: 30_000 });
    await expect(configure).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("combobox", { name: "产品设计小队" })).toContainText("产品设计小队");
    await expect(page.getByRole("combobox", { name: "开发小队", exact: true })).toContainText("开发小队");
    await expect(page.getByRole("combobox", { name: "确认与验收人" })).toContainText("初始化确认人");
    await expect(page.getByRole("combobox", { name: "流程范围" })).toContainText("工作区默认");
    await expect(page.getByRole("combobox", { name: "应用到项目" })).toHaveCount(0);
    await page.getByRole("switch", { name: "配置 GitLab 和 CI" }).click();
    const kb = page.getByRole("switch", { name: "配置知识库", exact: true });
    if (await kb.count()) await kb.click();
    const save = page.getByRole("button", { name: "一键初始化", exact: true });
    await save.click();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    const defaults = await read("/api/issue-workflows");
    expect(defaults.workflows).toHaveLength(1);
    const defaultWorkflow = defaults.workflows[0];
    expect(defaultWorkflow.is_default).toBe(true);
    expect(defaultWorkflow.steps).toHaveLength(8);
    for (const project of [target, other]) {
      expect((await read(`/api/projects/${project.id}`)).workflow_id).toBeNull();
    }
    for (const projectId of [undefined, other.id]) {
      const inherited = await api.createIssue("默认流程设计确认交接", { project_id: projectId, status: "backlog" });
      await api.updateIssue(inherited.id, { status: "todo", description: "已确认的设计上下文" });
      const designing = await read(`/api/issues/${inherited.id}`);
      expect(designing.assignee_type).toBe("squad");
      expect(designing.assignee_id).toBe(squadIds[0]);
      await api.updateIssue(inherited.id, { status: defaultWorkflow.steps[2].status_key });
      const approving = await read(`/api/issues/${inherited.id}`);
      expect(approving.assignee_type).toBe("member");
      expect(approving.assignee_id).toBe(auth.user.id);
      const queued = await db.query<{ count: string }>(
        "SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND squad_id = $2", [inherited.id, squadIds[1]],
      );
      expect(Number(queued.rows[0]!.count)).toBe(0);
      await api.updateIssue(inherited.id, { status: "in_progress" });
      const developing = await read(`/api/issues/${inherited.id}`);
      expect(developing.assignee_type).toBe("squad");
      expect(developing.assignee_id).toBe(squadIds[1]);
      expect(developing.description).toBe("已确认的设计上下文");
    }
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    expect((await read("/api/issue-workflows")).workflows).toHaveLength(1);
    await page.getByRole("combobox", { name: "流程范围" }).click();
    await page.getByRole("option", { name: "指定项目", exact: true }).click();
    await page.getByRole("combobox", { name: "应用到项目" }).click();
    await page.getByRole("option", { name: "研发项目", exact: true }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    const workflows = await read("/api/issue-workflows");
    const workflow = workflows.workflows.find((item: { is_default: boolean }) => !item.is_default);
    expect(workflow.steps).toHaveLength(8);
    expect(workflow.steps.slice(1, 5)).toEqual([
      expect.objectContaining({ status_key: "todo", handler: { type: "squad", id: squadIds[0] } }),
      expect.objectContaining({ handler: { type: "member", id: auth.user.id } }),
      expect.objectContaining({ status_key: "in_progress", handler: { type: "squad", id: squadIds[1] } }),
      expect.objectContaining({ status_key: "in_review", handler: { type: "member", id: auth.user.id } }),
    ]);
    expect((await read(`/api/projects/${target.id}`)).workflow_id).toBe(workflow.id);
    expect((await read(`/api/projects/${other.id}`)).workflow_id).not.toBe(workflow.id);
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    expect((await read("/api/issue-workflows")).workflows).toHaveLength(workflows.workflows.length);
    const issue = await api.createIssue("设计确认交接", { project_id: target.id, status: "backlog" });
    await api.updateIssue(issue.id, { status: "todo", description: "设计稿与验收标准" });
    await api.updateIssue(issue.id, { status: workflow.steps[2].status_key });
    const approval = await read(`/api/issues/${issue.id}`);
    expect(approval.assignee_type).toBe("member");
    expect(approval.assignee_id).toBe(auth.user.id);
    const queued = await db.query<{ count: string }>(
      "SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND squad_id = $2", [issue.id, squadIds[1]],
    );
    expect(Number(queued.rows[0]!.count)).toBe(0);
    await api.updateIssue(issue.id, { status: "in_progress" });
    const development = await read(`/api/issues/${issue.id}`);
    expect(development.assignee_type).toBe("squad");
    expect(development.assignee_id).toBe(squadIds[1]);
    expect(development.description).toBe("设计稿与验收标准");
    await page.screenshot({ path: testInfo.outputPath("quick-setup-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "产品设计小队" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("combobox", { name: "产品设计小队" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("quick-setup-mobile.png"), fullPage: true });
    await page.getByRole("combobox", { name: "应用到项目" }).click();
    await page.getByRole("option", { name: "新建项目", exact: true }).click();
    const projectName = page.getByRole("textbox", { name: "项目名称", exact: true });
    await expect(projectName).toHaveValue("产品研发");
    await projectName.fill("新建研发项目");
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    await expect(page.getByRole("combobox", { name: "应用到项目" })).toContainText("新建研发项目");
    await expect(projectName).toHaveCount(0);
    const created = (await read("/api/projects")).projects.filter((item: { title: string }) => item.title === "新建研发项目");
    expect(created).toHaveLength(1);
    const createdWorkflow = (await read("/api/issue-workflows")).workflows.find((item: { id: string }) => item.id === created[0].workflow_id);
    expect(createdWorkflow.steps).toEqual(workflow.steps);
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    expect((await read("/api/projects")).projects.filter((item: { title: string }) => item.title === "新建研发项目")).toHaveLength(1);
    expect((await read("/api/projects/" + target.id)).workflow_id).toBe(workflow.id);
    const override = await fetch(`${apiBase}/api/issue-workflows/${workflow.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": workspace.id, "Content-Type": "application/json" },
      body: JSON.stringify({
        steps: workflow.steps.map((step: { status_key: string; instructions: string }) =>
          step.status_key === "todo" ? { ...step, instructions: "Project-specific design" } : step),
      }),
    });
    expect(override.ok).toBe(true);
    await page.getByRole("combobox", { name: "流程范围" }).click();
    await page.getByRole("option", { name: "工作区默认", exact: true }).click();
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("所选配置已应用。");
    const finalWorkflows = (await read("/api/issue-workflows")).workflows;
    expect(finalWorkflows.find((item: { id: string }) => item.id === workflow.id).steps[1].instructions).toBe("Project-specific design");
    expect(finalWorkflows.find((item: { is_default: boolean }) => item.is_default).steps).toEqual(defaultWorkflow.steps);
    expect((await read("/api/projects/" + target.id)).workflow_id).toBe(workflow.id);
  } finally {
    await api.cleanup();
    if (workspaceCreated) await api.deleteWorkspace();
    await db.end();
  }
});
