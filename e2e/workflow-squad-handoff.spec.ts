import { expect, test } from "@playwright/test";
import pg from "pg";
import { TestApiClient } from "./fixtures";

test.use({ screenshot: "only-on-failure", trace: "retain-on-failure" });

test("saves design and development squad handoffs and reloads their stage controls", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const api = new TestApiClient();
  const suffix = Date.now().toString(36);
  const db = new pg.Client(process.env.DATABASE_URL);
  let workspaceCreated = false;
  await db.connect();
  try {
    const auth = await api.login(`workflow-squads-${suffix}@multica.ai`, "Workflow owner");
    const workspace = await api.createWorkspace("Squad workflow acceptance", `squad-flow-${suffix}`);
    workspaceCreated = true;
    await api.markUserOnboarded();
    const squads: string[] = [];
    for (const name of ["Product design squad", "Development squad"]) {
      const agent = await db.query<{ id: string }>(
        `INSERT INTO agent (workspace_id, name, description, instructions, runtime_mode, runtime_config,
          visibility, permission_mode, max_concurrent_tasks, owner_id)
         VALUES ($1, $2, '', '', 'cloud', '{}'::jsonb, 'private', 'private', 1, $3) RETURNING id`,
        [workspace.id, `${name} leader`, auth.user.id],
      );
      const squad = await db.query<{ id: string }>(
        `INSERT INTO squad (workspace_id, name, description, leader_id, creator_id)
         VALUES ($1, $2, '', $3, $4) RETURNING id`,
        [workspace.id, name, agent.rows[0]!.id, auth.user.id],
      );
      squads.push(squad.rows[0]!.id);
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${apiBase}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await page.addInitScript((token) => {
      localStorage.setItem("multica_token", token!);
      localStorage.setItem("multica:chat:isOpen", "false");
    }, api.getToken());
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`/${workspace.slug}/settings?tab=workflows&workflow=new`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("button[aria-pressed]").filter({ hasText: /^In Progress/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Design to development");
    await page.getByRole("radio", { name: /Hand to a squad/ }).click();
    await expect(page.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Choose a squad", exact: true }).click();
    await page.getByRole("button", { name: "Product design squad", exact: true }).click();
    await page.getByRole("textbox", { name: "What this step does" }).fill("Attach the approved design before handing off.");
    await page.getByRole("combobox", { name: "When done, move to" }).click();
    await page.getByRole("option", { name: "In Progress", exact: true }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
    const developmentStage = page.locator("button[aria-pressed]").filter({ hasText: /^In Progress/ });
    await developmentStage.click();
    await page.getByRole("radio", { name: /Hand to a squad/ }).click();
    await page.getByRole("button", { name: "Choose a squad", exact: true }).click();
    await page.getByRole("button", { name: "Development squad", exact: true }).click();
    await page.getByRole("textbox", { name: "What this step does" }).fill("Implement the approved design and retain the existing issue context.");
    await page.getByRole("combobox", { name: "When done, move to" }).click();
    await page.getByRole("option", { name: "In Review", exact: true }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
    await page.getByRole("combobox", { name: "If rejected, send back to" }).scrollIntoViewIfNeeded();
    await page.getByRole("combobox", { name: "If rejected, send back to" }).click();
    await expect(page.getByRole("option", { name: "Todo", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Todo", exact: true }).click();
    const saving = page.waitForResponse((res) => res.url().includes("/api/issue-workflows") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const response = await saving;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    expect(saved.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ status_key: "todo", handler: { type: "squad", id: squads[0] }, next_status_key: "in_progress" }),
      expect.objectContaining({
        status_key: "in_progress", handler: { type: "squad", id: squads[1] },
        instructions: "Implement the approved design and retain the existing issue context.",
        next_status_key: "in_review", back_status_key: "todo",
      }),
    ]));
    await expect(page).toHaveURL(new RegExp(`workflow=${saved.id}`));
    await page.reload({ waitUntil: "domcontentloaded" });
    await developmentStage.click();
    await expect(page.getByRole("radio", { name: /Hand to a squad/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Choose a squad", exact: true })).toContainText("Development squad");
    await expect(page.getByRole("textbox", { name: "What this step does" })).toHaveValue("Implement the approved design and retain the existing issue context.");
    await expect(page.getByRole("combobox", { name: "When done, move to" })).toContainText("In Review");
    await expect(page.getByRole("combobox", { name: "If rejected, send back to" })).toContainText("Todo");
    await page.screenshot({ path: testInfo.outputPath("squad-workflow-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("radio", { name: /Hand to a squad/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("radio", { name: /Hand to a squad/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("squad-workflow-mobile.png"), fullPage: true });
  } finally {
    await api.cleanup();
    if (workspaceCreated) await api.deleteWorkspace();
    await db.end();
  }
});
