import { test, expect } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const adminEmail = "work-order-admin@multica.test";
test.use({ storageState: { cookies: [], origins: [] } });

test("project code flattens cyclic dependencies and saves all project branches without changing product baselines", async ({ page }, testInfo) => {
  test.skip(!process.env.MULTICA_SYSTEM_ADMIN_EMAILS?.split(",").map((v) => v.trim()).includes(adminEmail), "Requires the local acceptance administrator");
  test.setTimeout(180_000);
  const admin = new TestApiClient();
  await admin.login(adminEmail, "Project code acceptance");
  await admin.markUserOnboarded();
  const run = Date.now().toString(36);
  const projectName = `中石化-${run}`;
  const products: string[] = [];
  const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });
  const createVersion = async (name: string, slug: string, versionName = "v6.0.0.0") => {
    const productResponse = await admin.requestSystemProduct("", json({ name, slug }));
    expect(productResponse.ok).toBeTruthy();
    const product = await productResponse.json();
    products.push(product.id);
    const versionResponse = await admin.requestSystemProduct(`/${product.id}/versions`, json({ name: versionName, enabled: true }));
    expect(versionResponse.ok).toBeTruthy();
    return { product, version: await versionResponse.json() };
  };
  try {
    const root = await createVersion(`ECM-${run}`, `project-ecm-${run}`);
    const dependency = await createVersion(`低代码-${run}`, `project-base-${run}`, "v3.0.0.0");
    const missing = await createVersion(`未配置-${run}`, `project-missing-${run}`);
    const config = {
      modules: [{ key: "main", name: "ECM repository", repo_url: "https://git.example.test/ecm.git", ref: "legacy/v6", directory: "backend", subpath: "src" }],
      dependencies: [dependency.version.id],
    };
    expect((await admin.requestSystemProduct(`/${root.product.id}/versions/${root.version.id}/code`, json(config, "PUT"))).ok).toBeTruthy();
    const dependencyConfig = {
      modules: [
        { key: "runtime", name: "Dependency runtime", repo_url: "https://git.example.test/runtime.git", ref: "release/v3", directory: "runtime" },
        { key: "ui", name: "Dependency UI", repo_url: "https://git.example.test/ui.git", ref: "release/ui-v3", directory: "ui" },
      ],
      dependencies: [root.version.id, missing.version.id],
    };
    expect((await admin.requestSystemProduct(`/${dependency.product.id}/versions/${dependency.version.id}/code`, json(dependencyConfig, "PUT"))).ok).toBeTruthy();
    expect((await admin.requestCustomerProjects(json({ name: projectName }))).ok).toBeTruthy();
    // Use the selected acceptance API even when reusing an already-running web server.
    const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${apiBase}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await page.addInitScript((token) => {
      localStorage.setItem("multica_token", token!);
      localStorage.setItem("multica:chat:isOpen", "false");
    }, admin.getToken());
    await page.goto("/system/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(projectName) }).click();
    await page.locator("label").filter({ hasText: "产品版本" }).getByRole("button").click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("button", { name: root.product.name, exact: true }).click();
    await picker.getByRole("button", { name: "v6.0.0.0", exact: true }).click();
    const branch = page.getByRole("textbox", { name: "ECM repository / 客户项目分支", exact: true });
    const expectedRef = `proj-zhong-shi-hua-${run}-v6.0.0.0`;
    const expectedDependencyRef = `proj-zhong-shi-hua-${run}-v3.0.0.0`;
    const dependencyRegion = page.getByRole("region", { name: `${dependency.product.name} / v3.0.0.0`, exact: true });
    const runtimeBranch = dependencyRegion.getByRole("textbox", { name: "Dependency runtime / 客户项目分支", exact: true });
    const uiBranch = dependencyRegion.getByRole("textbox", { name: "Dependency UI / 客户项目分支", exact: true });
    await expect(branch).toHaveValue(expectedRef);
    await expect(runtimeBranch).toHaveValue(expectedDependencyRef);
    await expect(uiBranch).toHaveValue(expectedDependencyRef);
    await expect(dependencyRegion).toHaveCount(1);
    const rootRegion = page.getByRole("region", { name: `${root.product.name} / v6.0.0.0`, exact: true });
    await expect(rootRegion.getByRole("textbox", { name: "仓库地址", exact: true })).toHaveValue(config.modules[0]!.repo_url);
    await expect(rootRegion.getByRole("textbox", { name: "仓库地址", exact: true })).toHaveAttribute("readonly");
    const missingRegion = page.getByRole("region", { name: `${missing.product.name} / v6.0.0.0`, exact: true });
    await expect(missingRegion.getByRole("status")).toContainText("该版本尚未配置模块仓库");
    await expect(missingRegion.getByRole("textbox")).toHaveValue(expectedRef);
    const customRef = `${expectedDependencyRef}-ui`;
    await uiBranch.fill(customRef);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await expect(page.locator("main").last().getByRole("alert")).toHaveCount(0);
    const savedProjects = await (await admin.requestCustomerProjects()).json();
    const savedProject = savedProjects.projects.find((p: { name: string }) => p.name === projectName);
    expect(savedProject.product_version_id).toBe(root.version.id);
    const branches = await (await admin.requestWorkOrder(`/branches?project_id=${savedProject.id}`, undefined, true)).json();
    expect(branches.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ version_id: root.version.id, module_key: "main" }),
      expect.objectContaining({ version_id: dependency.version.id, module_key: "runtime" }),
      expect.objectContaining({ version_id: dependency.version.id, module_key: "ui" }),
    ]));
    expect(branches.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expectedRef }),
      expect.objectContaining({ ref: expectedDependencyRef }),
      expect.objectContaining({ ref: customRef }),
    ]));
    const unchanged = await (await admin.requestSystemProduct(`/${root.product.id}/versions/${root.version.id}/code`)).json();
    expect(unchanged.modules[0].ref).toBe("legacy/v6");
    const unchangedDependency = await (await admin.requestSystemProduct(`/${dependency.product.id}/versions/${dependency.version.id}/code`)).json();
    expect(unchangedDependency.modules.map((m: { ref: string }) => m.ref)).toEqual(["release/v3", "release/ui-v3"]);
    await page.screenshot({ path: testInfo.outputPath("project-code-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await runtimeBranch.scrollIntoViewIfNeeded();
    await expect(runtimeBranch).toBeInViewport();
    expect(await page.locator("main").last().evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("project-code-mobile.png") });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: new RegExp(projectName) }).click();
    await expect(branch).toHaveValue(expectedRef);
    await expect(runtimeBranch).toHaveValue(expectedDependencyRef);
    await expect(uiBranch).toHaveValue(customRef);
  } finally {
    await admin.deleteTestCustomerProject(projectName);
    for (const id of products) await admin.requestSystemProduct(`/${id}`, { method: "DELETE" });
  }
});
