import { test, expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const adminEmail = "work-order-admin@multica.test";

test.use({ storageState: { cookies: [], origins: [] } });

test("administrators independently maintain customer projects and work orders reuse them", async ({ page }, testInfo) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail), "Requires the local acceptance administrator");
  test.setTimeout(180_000);
  const admin = new TestApiClient();
  const login = await admin.login(adminEmail, "工单系统管理员");
  await admin.markUserOnboarded();
  const run = Date.now().toString(36);
  const ws = await admin.createWorkspace("项目维护验收", `project-crud-${run}`);
  const name = `后台新增项目-${run}`;
  const renamed = `后台修改项目-${run}`;
  let productId = "";
  const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });
  try {
    const product = await (await admin.requestSystemProduct("", json({ name: `维护产品-${run}`, slug: `maintenance-${run}` }))).json();
    productId = product.id;
    const version = await (await admin.requestSystemProduct(`/${productId}/versions`, json({ name: "V1", enabled: true }))).json();
    await openOrders(page, admin, "/system/projects");
    await page.getByRole("button", { name: "新增项目", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "新增项目", exact: true });
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "项目名称", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "产品版本", exact: true }).click();
    await page.getByRole("option", { name: `${product.name} / V1`, exact: true }).click();
    await expect(page.getByRole("status")).toContainText("该版本尚未配置模块仓库");
    await page.getByRole("button", { name: "维护模块仓库", exact: true }).click();
    const codeDialog = page.getByRole("dialog", { name: "V1 · 代码配置", exact: true });
    await expect(codeDialog.getByText("修改此产品版本的模块或依赖会影响所有使用该版本的项目。", { exact: true })).toBeVisible();
    await codeDialog.getByRole("textbox", { name: "仓库地址", exact: true }).fill("https://git.example.test/main.git");
    await codeDialog.getByRole("textbox", { name: "分支 / 标签 / SHA", exact: true }).fill("legacy");
    await codeDialog.getByRole("button", { name: "添加模块", exact: true }).click();
    await expect(codeDialog.getByRole("textbox", { name: "模块标识", exact: true })).toHaveCount(2);
    await codeDialog.getByRole("button", { name: "移除", exact: true }).last().click();
    await expect(codeDialog.getByRole("textbox", { name: "模块标识", exact: true })).toHaveCount(1);
    await codeDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(codeDialog).toHaveCount(0);
    await page.getByRole("textbox", { name: "主仓库 / 客户项目分支", exact: true }).fill("customer/v1");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "修改项目名称", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "修改项目名称", exact: true });
    await dialog.getByRole("textbox", { name: "项目名称", exact: true }).fill(renamed);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "主仓库 / 客户项目分支", exact: true })).toHaveValue("customer/v1");
    await page.getByRole("button", { name: "主仓库 / 移除项目分支，恢复版本基线", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "主仓库 / 客户项目分支", exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "维护产品依赖", exact: true }).click();
    await expect(codeDialog.getByRole("button", { name: "添加依赖", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(codeDialog).toHaveCount(0);
    await page.getByRole("button", { name: "新增项目", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "新增项目", exact: true });
    await dialog.getByRole("textbox", { name: "项目名称", exact: true }).fill(renamed);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("已存在同名项目");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("project-crud-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "新增项目", exact: true })).toBeInViewport();
    expect(await page.locator("main").last().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("project-crud-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    const projects = (await (await admin.requestCustomerProjects()).json()).projects;
    const project = projects.find((p: { name: string }) => p.name === renamed);
    expect(project).toMatchObject({ product_version_id: version.id });
    expect((await admin.requestWorkOrder("", json({ external_id: run, title: "复用后台项目", assignee_id: login.user.id }))).ok).toBeTruthy();
    await page.goto(`/${ws.slug}/work-orders`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "复用后台项目", exact: true }).click();
    const orderDialog = page.getByRole("dialog");
    await orderDialog.getByRole("combobox", { name: "客户项目", exact: true }).click();
    await page.getByRole("option", { name: renamed, exact: true }).click();
    await expect(orderDialog.getByRole("combobox", { name: "产品版本", exact: true })).toContainText(`${product.name} / V1`);
    await orderDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(orderDialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.goto("/system/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(renamed) }).click();
    await page.getByRole("button", { name: "删除项目", exact: true }).click();
    const deletion = page.getByRole("alertdialog");
    await deletion.getByRole("button", { name: "删除项目", exact: true }).click();
    await expect(deletion.getByRole("alert")).toContainText("该项目已被工单引用");
    await deletion.getByRole("button", { name: "取消", exact: true }).click();
    await expect(deletion).toHaveCount(0);
    await admin.deleteWorkspace();
    await page.getByRole("button", { name: "删除项目", exact: true }).click();
    await deletion.getByRole("button", { name: "取消", exact: true }).click();
    await expect(deletion).toHaveCount(0);
    await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "删除项目", exact: true }).click();
    await deletion.getByRole("button", { name: "删除项目", exact: true }).click();
    await expect(deletion).toHaveCount(0);
    await expect(page.getByRole("heading", { name: renamed, exact: true })).toHaveCount(0);
    expect((await (await admin.requestCustomerProjects()).json()).projects.some((p: { id: string }) => p.id === project.id)).toBe(false);
  } finally {
    await admin.deleteWorkspace();
    await admin.deleteTestCustomerProject(name);
    await admin.deleteTestCustomerProject(renamed);
    if (productId) await admin.requestSystemProduct(`/${productId}`, { method: "DELETE" });
  }
});

test("versions start with a main repository and expand product-version dependencies into readable directories", async ({ page }, testInfo) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail), "Requires the local acceptance administrator");
  test.setTimeout(240_000);
  const admin = new TestApiClient();
  await admin.login(adminEmail, "工单系统管理员");
  await admin.markUserOnboarded();
  const run = Date.now().toString(36);
  await admin.createWorkspace("产品依赖验收", `dependency-${run}`);
  const productIds: string[] = [];
  const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });
  const create = async (name: string, slug: string, versionName: string) => {
    const response = await admin.requestSystemProduct("", json({ name, slug }));
    expect(response.ok).toBeTruthy();
    const product = await response.json();
    productIds.push(product.id);
    const versionResponse = await admin.requestSystemProduct(`/${product.id}/versions`, json({ name: versionName, enabled: true }));
    expect(versionResponse.ok).toBeTruthy();
    return { product, version: await versionResponse.json() };
  };
  try {
    const root = await create(`ECM-${run}`, `ecm-${run}`, "v6");
    const dependency = await create(`Inbiz-${run}`, `inbiz-${run}`, "v3");
    const depConfig = { modules: [{ key: "main", name: "主仓库", repo_url: "https://git.example.test/inbiz.git", ref: "legacy/v3" }], dependencies: [] };
    expect((await admin.requestSystemProduct(`/${dependency.product.id}/versions/${dependency.version.id}/code`, json(depConfig, "PUT"))).ok).toBeTruthy();
    await openOrders(page, admin, "/system/products");
    await page.getByText(root.product.name, { exact: true }).click();
    await page.getByRole("button", { name: "代码配置", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "主仓库", exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "模块标识", exact: true })).toHaveValue("main");
    await expect(dialog.getByRole("button", { name: "移除", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "仓库地址", exact: true }).fill("https://git.example.test/ecm.git");
    await dialog.getByRole("textbox", { name: "分支 / 标签 / SHA", exact: true }).fill("legacy/v6");
    await expect(dialog.getByText(`code/${root.product.slug}/v6/main/`, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    let saved = await (await admin.requestSystemProduct(`/${root.product.id}/versions/${root.version.id}/code`)).json();
    expect(saved.modules).toHaveLength(1);
    expect(saved.modules[0]).toMatchObject({ key: "main", ref: "legacy/v6", directory: "" });

    await page.getByRole("button", { name: "代码配置", exact: true }).click();
    await dialog.getByRole("textbox", { name: "代码落盘目录（可选）", exact: true }).fill("backend");
    await expect(dialog.getByText(`code/${root.product.slug}/v6/backend/`, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "添加模块", exact: true }).click();
    await dialog.getByRole("textbox", { name: "模块标识", exact: true }).last().fill("web");
    await dialog.getByRole("textbox", { name: "名称", exact: true }).last().fill("前端");
    await dialog.getByRole("textbox", { name: "仓库地址", exact: true }).last().fill("https://git.example.test/web.git");
    await dialog.getByRole("textbox", { name: "分支 / 标签 / SHA", exact: true }).last().fill("legacy/v6");
    await dialog.locator(".overflow-y-auto").evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath("version-code-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.locator(".overflow-y-auto").evaluate((el) => { el.scrollTop = 0; });
    await expect(dialog.getByRole("heading", { name: "主仓库", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("version-code-mobile.png") });
    await dialog.getByRole("tab", { name: "依赖产品与版本", exact: true }).click();
    await dialog.getByRole("button", { name: "添加依赖", exact: true }).click();
    await dialog.getByRole("combobox", { name: "依赖产品", exact: true }).click();
    await page.getByRole("option", { name: dependency.product.name, exact: true }).click();
    await dialog.getByRole("combobox", { name: `${dependency.product.name} / 产品版本`, exact: true }).click();
    await page.getByRole("option", { name: "v3", exact: true }).click();
    await expect(page.getByRole("option", { name: "v3", exact: true })).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("version-dependency-mobile.png") });
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    saved = await (await admin.requestSystemProduct(`/${root.product.id}/versions/${root.version.id}/code`)).json();
    expect(saved.dependencies).toEqual([dependency.version.id]);
    const planResponse = await admin.requestWorkOrder(`/project-baseline?version_id=${root.version.id}`);
    expect(planResponse.ok).toBeTruthy();
    const plan = await planResponse.json();
    expect(plan.repos.map((repo: { directory: string }) => repo.directory)).toEqual([
      `code/${root.product.slug}/v6/backend`, `code/${root.product.slug}/v6/web`, `code/${dependency.product.slug}/v3/main`,
    ]);
    expect(plan.repos.map((repo: { ref: string }) => repo.ref)).toEqual(["legacy/v6", "legacy/v6", "legacy/v3"]);
  } finally {
    for (const id of productIds) await admin.requestSystemProduct(`/${id}`, { method: "DELETE" });
    await admin.deleteWorkspace();
  }
});

test("dependencies can create their product and version inline before repositories are configured", async ({ page }, testInfo) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail), "Requires the local acceptance administrator");
  test.setTimeout(180_000);
  const admin = new TestApiClient();
  await admin.login(adminEmail, "工单系统管理员");
  await admin.markUserOnboarded();
  const run = Date.now().toString(36);
  const dependencyName = `依赖新产品-${run}`;
  let productId = "";
  let dependencyId = "";
  const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });
  try {
    const product = await (await admin.requestSystemProduct("", json({ name: `分步配置-${run}`, slug: `staged-${run}` }))).json();
    productId = product.id;
    const version = await (await admin.requestSystemProduct(`/${productId}/versions`, json({ name: "v6", enabled: true }))).json();
    await openOrders(page, admin, "/system/products");
    await page.getByText(product.name, { exact: true }).click();
    await page.getByRole("button", { name: "代码配置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "v6 · 代码配置", exact: true });
    await dialog.getByRole("tab", { name: "依赖产品与版本", exact: true }).click();
    await dialog.getByRole("button", { name: "添加依赖", exact: true }).click();
    await dialog.getByRole("button", { name: "新建产品", exact: true }).click();
    const productDialog = page.getByRole("dialog", { name: "新建产品", exact: true });
    await productDialog.getByRole("textbox", { name: "产品名称", exact: true }).fill(dependencyName);
    await productDialog.getByRole("textbox", { name: "产品英文标识", exact: true }).fill(`inline-${run}`);
    await productDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(productDialog).toHaveCount(0);
    const catalog = await (await admin.requestSystemProduct()).json();
    dependencyId = catalog.products.find((p: { name: string }) => p.name === dependencyName).id;
    await expect(dialog.getByRole("combobox", { name: "依赖产品", exact: true })).toContainText(dependencyName);
    await dialog.getByRole("button", { name: "新建版本", exact: true }).click();
    const versionDialog = page.getByRole("dialog", { name: `${dependencyName} / 新建版本`, exact: true });
    await versionDialog.getByRole("textbox", { name: "版本名称", exact: true }).fill("v3");
    await versionDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(versionDialog).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: `${dependencyName} / 产品版本`, exact: true })).toContainText("v3");
    await page.screenshot({ path: testInfo.outputPath("inline-dependency-desktop.png") });
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const saved = await (await admin.requestSystemProduct(`/${productId}/versions/${version.id}/code`)).json();
    expect(saved.modules).toEqual([]);
    expect(saved.dependencies).toHaveLength(1);
    const partialBaseline = await admin.requestWorkOrder(`/project-baseline?version_id=${version.id}`, undefined, true);
    expect(partialBaseline.status).toBe(200);
    expect((await partialBaseline.json()).missing_versions).toHaveLength(2);
    await page.getByRole("button", { name: "代码配置", exact: true }).click();
    await dialog.getByRole("tab", { name: /依赖产品与版本/ }).click();
    await dialog.getByRole("button", { name: `${dependencyName} / 移除依赖`, exact: true }).click();
    await expect(dialog.getByText("暂无依赖产品", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await (await admin.requestSystemProduct(`/${productId}/versions/${version.id}/code`)).json()).dependencies).toEqual([]);
  } finally {
    if (productId) await admin.requestSystemProduct(`/${productId}`, { method: "DELETE" });
    if (dependencyId) await admin.requestSystemProduct(`/${dependencyId}`, { method: "DELETE" });
  }
});

test("Chinese is the default and an explicit language choice is preserved", async ({ page, context }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("登录 Multica", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await context.addCookies([{ name: "multica-locale", value: "en", url: page.url() }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in to Multica", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

async function openOrders(page: Page, api: TestApiClient, path: string) {
  await page.addInitScript((token) => {
    localStorage.setItem("multica_token", token!);
    localStorage.setItem("multica:chat:isOpen", "false");
  }, api.getToken());
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
}

test("administrators assign work orders and members edit only their own", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const owner = new TestApiClient();
  const member = new TestApiClient();
  const run = Date.now().toString(36);
  const ownerLogin = await owner.login(`work-order-owner-${run}@multica.test`, "工单管理员");
  const ws = await owner.createWorkspace("工单验收", `order-acceptance-${run}`);
  await owner.markUserOnboarded();
  const memberLogin = await member.login(`work-order-member-${run}@multica.test`, "工单处理人");
  await member.markUserOnboarded();
  await owner.addMemberByEmail(`work-order-member-${run}@multica.test`);
  member.setWorkspaceId(ws.id);
  member.setWorkspaceSlug(ws.slug);
  const memberContext = await browser.newContext();
  try {
    for (const [id, title, assignee] of [
      ["own", "管理员自己的工单", ownerLogin.user.id],
      ["assign", "历史产品问题修复", ""],
    ]) {
      const response = await owner.requestWorkOrder("", {
        method: "POST",
        body: JSON.stringify({ external_id: `${run}-${id}`, title, description: "MIS 原始工单内容", assignee_id: assignee }),
      });
      expect(response.ok).toBeTruthy();
    }
    await openOrders(page, owner, `/${ws.slug}/work-orders`);
    await expect(page.getByRole("heading", { name: "工单处理", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "全部工单", exact: true }).click();
    await page.getByRole("button", { name: "历史产品问题修复", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "负责人", exact: true }).click();
    await page.getByRole("option", { name: "工单处理人", exact: true }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("已保存", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    const memberPage = await memberContext.newPage();
    await openOrders(memberPage, member, `/${ws.slug}/work-orders`);
    await expect(memberPage.getByRole("button", { name: "历史产品问题修复", exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "管理员自己的工单", exact: true })).toHaveCount(0);
    await expect(memberPage.getByRole("tab", { name: "全部工单", exact: true })).toBeDisabled();
    const forced = await member.requestWorkOrder(`?all=true&assignee_id=${ownerLogin.user.id}`);
    const forcedList = await forced.json();
    expect(forcedList.orders).toHaveLength(1);
    expect(forcedList.orders[0].assignee_id).toBe(memberLogin.user.id);
    await memberPage.getByRole("button", { name: "历史产品问题修复", exact: true }).click();
    const memberDialog = memberPage.getByRole("dialog");
    await memberDialog.getByRole("textbox", { name: "处理草稿", exact: true }).fill("先在历史版本分支复现问题，再修改代码。");
    await memberDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(memberPage.getByText("已保存", { exact: true }).first()).toBeVisible();
    await memberPage.keyboard.press("Escape");
    await memberPage.reload();
    await memberPage.getByRole("button", { name: "历史产品问题修复", exact: true }).click();
    await expect(memberDialog.getByRole("textbox", { name: "处理草稿", exact: true })).toHaveValue("先在历史版本分支复现问题，再修改代码。");
    expect(await memberDialog.evaluate((el) => el.clientWidth)).toBeGreaterThan(700);
    const saveButton = memberDialog.getByRole("button", { name: "保存", exact: true });
    await expect(saveButton).toBeInViewport({ ratio: 1 });
    await expect(memberDialog.getByText("更新工单", { exact: true }).first()).toBeVisible();
    await expect(memberPage.locator("html")).toHaveAttribute("lang", "zh-CN");
    await memberPage.screenshot({ path: testInfo.outputPath("work-order-desktop.png") });
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await expect(saveButton).toBeInViewport({ ratio: 1 });
    expect(await memberDialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await memberPage.screenshot({ path: testInfo.outputPath("work-order-mobile.png") });
  } finally {
    await memberContext.close();
    await owner.deleteWorkspace();
  }
});

test("system administrators have a separate maintenance list", async ({ page }) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail),
    "Requires the local work-order acceptance account on the system administrator allowlist");
  test.setTimeout(120_000);
  const admin = new TestApiClient();
  await admin.login(adminEmail, "Order System Admin");
  await admin.markUserOnboarded();
  const ws = await admin.createWorkspace("Order system acceptance", `order-system-${Date.now().toString(36)}`);
  try {
    const response = await admin.requestWorkOrder("", {
      method: "POST",
      body: JSON.stringify({ external_id: `system-${Date.now()}`, title: "后台维护工单" }),
    }, true);
    expect(response.ok).toBeTruthy();
    await openOrders(page, admin, "/system/work-orders");
    await expect(page.getByRole("heading", { name: "工单维护", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "后台维护工单", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "工单维护", exact: true })).toBeVisible();
  } finally {
    await admin.deleteWorkspace();
  }
});

test("confirmed projects are global across workspaces and survive workspace deletion", async ({ page, browser }, testInfo) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail),
    "Requires the local work-order acceptance administrator");
  test.setTimeout(240_000);
  const admin = new TestApiClient();
  const run = Date.now().toString(36);
  const login = await admin.login(adminEmail, "工单系统管理员");
  await admin.markUserOnboarded();
  const ws = await admin.createWorkspace("项目分支验收", `project-orders-${run}`);
  const other = new TestApiClient();
  const otherLogin = await other.login(`shared-project-${run}@multica.test`, "跨工作区处理人");
  await other.markUserOnboarded();
  const otherWorkspace = await other.createWorkspace("共享项目验收", `shared-project-${run}`);
  const otherContext = await browser.newContext();
  const productName = `历史产品-${run}`;
  const projectName = `客户项目-${run}`;
  const root = await (await admin.requestWorkOrderRoot()).json();
  let productId = "";
  const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });
  try {
    const p = await admin.requestSystemProduct("", json({ name: productName, slug: `legacy-${run}` }));
    expect(p.ok).toBeTruthy();
    const product = await p.json();
    productId = product.id;
    const v = await admin.requestSystemProduct(`/${productId}/versions`, json({ name: "V1", enabled: true }));
    expect(v.ok).toBeTruthy();
    const version = await v.json();
    const config = {
      modules: [
        { key: "api", name: "服务端", repo_url: "https://git.example.test/api.git", ref: "legacy/v1",
          images: [{ service: "api", image: "registry.example.test/api:v1", ci_url: "https://ci.example.test/legacy" }] },
        { key: "web", name: "前端", repo_url: "https://git.example.test/web.git", ref: "legacy/v1" },
      ],
      dependencies: [], compose: "services:\n  api:\n    image: registry.example.test/api:v1",
    };
    expect((await admin.requestSystemProduct(`/${productId}/versions/${version.id}/code`, json(config, "PUT"))).ok).toBeTruthy();
    if (!root.kb_root_id) {
      expect((await admin.requestWorkOrderRoot(json({ kb_root_id: "project-order-acceptance" }, "PUT"))).ok).toBeTruthy();
    }
    const execution = await admin.createProject("工单专用执行");
    expect((await admin.requestWorkOrder("/settings", json({ execution_project_id: execution.id }, "PUT"))).ok).toBeTruthy();
    const imported = await admin.requestWorkOrder("", json({
      external_id: run, title: "确认后登记项目", source_project: projectName,
      assignee_id: login.user.id, product_version_id: version.id,
    }));
    expect(imported.ok).toBeTruthy();
    await openOrders(page, admin, `/${ws.slug}/work-orders`);
    await page.getByRole("button", { name: "确认后登记项目", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "创建处理任务", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "确认项目与版本", exact: true });
    await expect(confirmation.getByRole("textbox", { name: "项目名称", exact: true })).toHaveValue(projectName);
    await expect(confirmation.getByText("legacy/v1", { exact: false }).first()).toBeVisible();
    await confirmation.getByRole("button", { name: "确认并创建任务", exact: true }).click();
    await expect(page.getByRole("link", { name: "打开任务", exact: true })).toBeVisible();
    const options = await (await admin.requestWorkOrder("/options")).json();
    const project = options.projects.find((item: { name: string }) => item.name === projectName);
    expect(project).toMatchObject({ product_id: productId, product_version_id: version.id });
    expect(options.projects.find((item: { id: string }) => item.id === execution.id).purpose).toBe("execution");
    expect(project.purpose).toBe("customer");
    await page.keyboard.press("Escape");

    await page.goto("/system/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "项目管理", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("combobox", { name: "工作区", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(projectName) }).click();
    const apiBranch = page.getByRole("textbox", { name: "服务端 / 客户项目分支", exact: true });
    await expect(apiBranch).toHaveValue("");
    await apiBranch.fill("customer/v1");
    const savedBranches = page.waitForResponse((response) => response.url().includes("/work-orders/projects") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await savedBranches).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await expect(apiBranch).toHaveValue("customer/v1");
    await expect(page.getByRole("textbox", { name: "前端 / 客户项目分支", exact: true })).toHaveValue("");
    await page.screenshot({ path: testInfo.outputPath("project-management-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator("main").last().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("project-management-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });

    await admin.requestWorkOrder("", json({ external_id: `${run}-again`, title: "复用已确认项目", assignee_id: login.user.id }));
    await page.goto(`/${ws.slug}/work-orders`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "复用已确认项目", exact: true }).click();
    const orderDialog = page.getByRole("dialog");
    await orderDialog.getByRole("combobox", { name: "客户项目", exact: true }).click();
    await page.getByRole("option", { name: projectName, exact: true }).click();
    await expect(orderDialog.getByRole("combobox", { name: "产品版本", exact: true })).toContainText(`${productName} / V1`);
    await orderDialog.getByRole("button", { name: "校验代码计划", exact: true }).click();
    await expect(orderDialog.getByText("服务端 · customer/v1 (客户项目分支)", { exact: true })).toBeVisible();
    await expect(orderDialog.getByText("前端 · legacy/v1 (版本基线)", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await admin.requestWorkOrder("", json({
      external_id: `${run}-source`, title: "按来源名称复用项目", source_project: projectName,
      assignee_id: login.user.id, product_version_id: version.id,
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "按来源名称复用项目", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "创建处理任务", exact: true }).click();
    await expect(confirmation.getByText(projectName, { exact: true })).toBeVisible();
    await expect(confirmation.getByRole("textbox", { name: "项目名称", exact: true })).toHaveCount(0);
    await expect(confirmation.getByText("customer/v1", { exact: false })).toBeVisible();
    await confirmation.getByRole("button", { name: "确认并创建任务", exact: true }).click();
    await expect(page.getByRole("link", { name: "打开任务", exact: true })).toBeVisible();
    const reusedOptions = await (await admin.requestWorkOrder("/options")).json();
    expect(reusedOptions.projects.filter((item: { name: string }) => item.name === projectName)).toHaveLength(1);
    await page.keyboard.press("Escape");

    await page.goto("/system/products", { waitUntil: "domcontentloaded" });
    await page.getByText(productName, { exact: true }).click();
    await page.getByRole("button", { name: "打开 V1 的操作菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "代码配置", exact: true }).click();
    const codeDialog = page.getByRole("dialog");
    await expect(codeDialog.getByRole("tab", { name: "模块代码", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(codeDialog.getByRole("textbox", { name: "镜像引用", exact: true })).toHaveCount(0);
    await codeDialog.getByRole("tab", { name: "构建与部署（可选）", exact: true }).click();
    await expect(codeDialog.getByRole("textbox", { name: "镜像引用", exact: true })).toHaveValue("registry.example.test/api:v1");
    await codeDialog.getByRole("tab", { name: "模块代码", exact: true }).click();
    await codeDialog.getByRole("textbox", { name: "备注", exact: true }).first().fill("继续使用原有流水线");
    await codeDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(codeDialog).toHaveCount(0);
    const saved = await (await admin.requestSystemProduct(`/${productId}/versions/${version.id}/code`)).json();
    expect(saved.compose).toBe(config.compose);
    expect(saved.modules[0].images).toEqual(config.modules[0].images);
    expect(saved.modules[0].remark).toBe("继续使用原有流水线");

    await admin.deleteWorkspace();
    expect((await admin.getWorkspaces()).some((item) => item.id === ws.id)).toBe(false);
    const catalog = await admin.requestCustomerProjects();
    expect(catalog.ok).toBeTruthy();
    expect((await catalog.json()).projects).toContainEqual(expect.objectContaining({ id: project.id }));
    expect((await other.requestCustomerProjects()).status).toBe(403);
    expect((await other.requestCustomerProjects(json({
      project_id: project.id, version_id: version.id, refs: {},
    }, "PUT"))).status).toBe(403);
    const otherOptions = await (await other.requestWorkOrder("/options")).json();
    expect(otherOptions.projects).toContainEqual(expect.objectContaining({ id: project.id, purpose: "customer" }));
    expect(otherOptions.projects.some((item: { id: string }) => item.id === execution.id)).toBe(false);
    expect((await other.requestWorkOrder("", json({
      external_id: `${run}-shared`, title: "跨工作区复用项目", assignee_id: otherLogin.user.id,
    }))).ok).toBeTruthy();
    const otherPage = await otherContext.newPage();
    await openOrders(otherPage, other, `/${otherWorkspace.slug}/work-orders`);
    await otherPage.getByRole("button", { name: "跨工作区复用项目", exact: true }).click();
    const sharedDialog = otherPage.getByRole("dialog");
    await sharedDialog.getByRole("combobox", { name: "客户项目", exact: true }).click();
    await otherPage.getByRole("option", { name: projectName, exact: true }).click();
    await expect(sharedDialog.getByRole("combobox", { name: "产品版本", exact: true })).toContainText(`${productName} / V1`);
    await sharedDialog.getByRole("button", { name: "校验代码计划", exact: true }).click();
    await expect(sharedDialog.getByText("服务端 · customer/v1 (客户项目分支)", { exact: true })).toBeVisible();
    await expect(sharedDialog.getByText("前端 · legacy/v1 (版本基线)", { exact: true })).toBeVisible();
    await otherPage.screenshot({ path: testInfo.outputPath("shared-project-other-workspace.png") });
  } finally {
    await otherContext.close();
    await other.deleteWorkspace();
    await admin.deleteWorkspace();
    await admin.deleteTestCustomerProject(projectName);
    if (productId) await admin.requestSystemProduct(`/${productId}`, { method: "DELETE" });
    if (!root.kb_root_id) await admin.requestWorkOrderRoot(json({ kb_root_id: "" }, "PUT"));
  }
});
