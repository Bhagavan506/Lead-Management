import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-1";
const STAMP = Date.now().toString().slice(-6);
const LEAD = `E2E Lead ${STAMP}`;
const PHONE = `9${STAMP}0001`.padEnd(10, "0").slice(0, 10);

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the session to be established before the caller navigates away.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
// The label text wraps the control, so its accessible name includes the value; find by label then control.
const status = (d: Locator) => d.locator('label:has-text("Status") select');
const followUp = (d: Locator) => d.locator('label:has-text("Next follow-up") input');

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
}

test.describe.serial("lead lifecycle across both roles", () => {
  test("admin uploads a lead and assigns it to Priya", async ({ page }) => {
    await signIn(page, "admin@demo.com");
    await expect(page).toHaveURL(/\/admin\/overview/);
    await page.getByRole("link", { name: "Upload leads" }).click();

    await page
      .getByLabel("…or paste rows")
      .fill(
        `name,company,phone,source\n${LEAD},Acme E2E,${PHONE},Website\nBad Row,No Phone,,Website`,
      );
    await page.getByLabel("One employee").check();
    await page.getByLabel("Employee", { exact: true }).selectOption({ label: "Priya Sharma" });
    await page.getByRole("button", { name: "Upload" }).click();

    const result = page.getByRole("status");
    await expect(result).toContainText("1 added");
    await expect(result).toContainText("1 invalid");
    await expect(page.getByText("Assigned: Priya Sharma 1")).toBeVisible();

    await page.getByRole("link", { name: "All leads" }).click();
    await page.getByLabel("Search leads").fill(LEAD);
    await expect(page.getByText(LEAD).first()).toBeVisible();
    await expect(page.getByLabel(`Owner of ${LEAD}`).first()).toHaveValue(/.+/);
  });

  test("uploading the same file again skips the duplicate", async ({ page }) => {
    await signIn(page, "admin@demo.com");
    await page.getByRole("link", { name: "Upload leads" }).click();
    await page
      .getByLabel("…or paste rows")
      .fill(`name,company,phone,source\n${LEAD},Acme E2E,${PHONE},Website`);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("status")).toContainText("0 added");
    await expect(page.getByRole("status")).toContainText("1 skipped as duplicates");
  });

  test("Priya works the lead: call, note, status, follow-up", async ({ page }) => {
    await signIn(page, "priya@demo.com");
    await expect(page).toHaveURL(/\/app\/leads/);
    await page.getByRole("button", { name: `Open ${LEAD}` }).click();
    const dlg = page.getByRole("dialog", { name: `Lead: ${LEAD}` });
    await expect(dlg).toBeVisible();

    await dlg.getByRole("button", { name: "No answer" }).click();
    await expect(dlg.getByText("Call: No answer")).toBeVisible();
    // rule 8: a call on a New lead moves it to Contacted and No answer sets a follow-up
    await expect(status(dlg)).toHaveValue("CONTACTED");
    await expect(followUp(dlg)).not.toHaveValue("");

    await dlg.getByRole("textbox", { name: "Note" }).fill("Asked to call back after lunch");
    await dlg.getByRole("button", { name: "Add note" }).click();
    await expect(dlg.getByText("Note: Asked to call back after lunch")).toBeVisible();

    await status(dlg).selectOption("QUALIFIED");
    await expect(dlg.getByText("Status: Contacted → Qualified")).toBeVisible();

    // Lost needs a reason
    await status(dlg).selectOption("LOST");
    await dlg
      .getByRole("group", { name: "Lost reason" })
      .getByRole("button", { name: "Price" })
      .click();
    await expect(dlg.getByText("Status: Qualified → Lost (Price)")).toBeVisible();
  });

  test("Priya cannot open another employee's lead by URL", async ({ page, request }) => {
    await signIn(page, "priya@demo.com");
    await expect(page).toHaveURL(/\/app\/leads/);
    // Use a separate admin API session to find a lead that belongs to someone else.
    const admin = await request.post("/api/auth/login", {
      data: { email: "admin@demo.com", password: PASSWORD },
    });
    expect(admin.ok()).toBeTruthy();
    const users = (await (await request.get("/api/users")).json()).users as {
      id: string;
      name: string;
    }[];
    const rohan = users.find((u) => u.name === "Rohan Verma")!;
    const theirs = await (await request.get(`/api/leads?owner=${rohan.id}&pageSize=5`)).json();
    const other = (theirs.items ?? theirs.leads)[0];
    expect(other).toBeTruthy();
    await page.goto(`/app/leads?lead=${other.id}`);
    await expect(page.getByText("Lead not found.")).toBeVisible();
    await expect(page.getByText(other.name)).toHaveCount(0);
  });

  test("an employee is kept out of the admin area", async ({ page }) => {
    await signIn(page, "priya@demo.com");
    await page.goto("/admin/team");
    await expect(page).toHaveURL(/\/app\/leads/);
  });

  test("admin sees Priya's activity", async ({ page }) => {
    await signIn(page, "admin@demo.com");
    await page.getByRole("link", { name: "Activity" }).click();
    for (const text of [
      "Call: No answer",
      "Note: Asked to call back after lunch",
      "Status: Qualified → Lost (Price)",
    ]) {
      await expect(
        page
          .getByRole("button", { name: new RegExp(`${LEAD}.*${text.replace(/[()→]/g, ".")}`) })
          .first(),
      ).toBeVisible();
    }
    await expect(page.getByText(/Priya Sharma ·/).first()).toBeVisible();
    // the lost reason now shows in the team's numbers
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByText("Price").first()).toBeVisible();
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "admin@demo.com");
    await signOut(page);
    await page.goto("/admin/overview");
    await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  });
});
