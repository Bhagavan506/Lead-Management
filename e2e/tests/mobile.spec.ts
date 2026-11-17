import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Mobile QA (10.4): every screen at 360, 390 and 768 px, light and dark.
 * Fails on: sideways page scroll, content poking out of the viewport, phone tap targets under 42px,
 * form text under 16px on phones (iOS zooms the page otherwise), and unstyled/placeholder text.
 * Screenshots go to e2e/screenshots for a visual pass.
 */
const PASSWORD = "e2e-password-1";
const WIDTHS = [360, 390, 768] as const;
const THEMES = ["light", "dark"] as const;
const SHOTS = "screenshots";
mkdirSync(SHOTS, { recursive: true });

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

interface Finding {
  kind: string;
  what: string;
}

async function audit(page: Page, phone: boolean): Promise<Finding[]> {
  return page.evaluate((isPhone) => {
    const out: { kind: string; what: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    if (document.documentElement.scrollWidth > vw + 1)
      out.push({
        kind: "page-scrolls-sideways",
        what: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`,
      });

    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    for (const el of document.querySelectorAll("body *")) {
      if (!shown(el) || inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1)
        out.push({
          kind: "outside-viewport",
          what: `${label(el)} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`,
        });
    }
    if (isPhone) {
      for (const el of document.querySelectorAll(
        "button, select, a.tap, [role=button], input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea",
      )) {
        if (!shown(el) || el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.height < 41.5)
          out.push({
            kind: "small-tap-target",
            what: `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          });
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(cs.fontSize) < 16)
          out.push({ kind: "small-form-text", what: `${label(el)} ${cs.fontSize}` });
      }
    }
    const body = document.body.innerText;
    if (/built in a later task|lorem ipsum|TODO|undefined|\[object Object\]|NaN/.test(body))
      out.push({
        kind: "placeholder-or-broken-text",
        what: (body.match(
          /built in a later task|lorem ipsum|TODO|undefined|\[object Object\]|NaN/,
        ) ?? [""])[0],
      });
    return out;
  }, phone);
}

type Screen = { name: string; as: "admin" | "priya" | null; go: (p: Page) => Promise<void> };
const SCREENS: Screen[] = [
  { name: "login", as: null, go: async (p) => void (await p.goto("/")) },
  {
    name: "admin-overview",
    as: "admin",
    go: async (p) => void (await p.getByRole("link", { name: "Overview" }).click()),
  },
  {
    name: "admin-leads",
    as: "admin",
    go: async (p) => void (await p.getByRole("link", { name: "All leads" }).click()),
  },
  {
    name: "admin-leads-drawer",
    as: "admin",
    go: async (p) => {
      await p.getByRole("link", { name: "All leads" }).click();
      await p
        .getByRole("button", { name: /^Aarav Mehta/ })
        .first()
        .click();
      await expect(p.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "admin-upload-result",
    as: "admin",
    go: async (p) => {
      await p.getByRole("link", { name: "Upload leads" }).click();
      await p
        .getByLabel("…or paste rows")
        .fill(
          "name,company,phone,source\nMobile Mia,Co,98765 4321" +
            Math.floor(Math.random() * 9) +
            ",Web\nBad Row,No Phone,,Web\nAarav Mehta,Northwind Traders,9810000001,Website",
        );
      await p.getByRole("button", { name: "Upload" }).click();
      await expect(p.getByRole("status")).toBeVisible();
    },
  },
  {
    name: "admin-team",
    as: "admin",
    go: async (p) => void (await p.getByRole("link", { name: "Team" }).click()),
  },
  {
    name: "admin-reminders",
    as: "admin",
    go: async (p) => void (await p.getByRole("link", { name: "Reminders" }).click()),
  },
  {
    name: "admin-activity",
    as: "admin",
    go: async (p) => void (await p.getByRole("link", { name: "Activity" }).click()),
  },
  { name: "employee-leads", as: "priya", go: async () => {} },
  {
    name: "employee-drawer",
    as: "priya",
    go: async (p) => {
      await p.getByRole("button", { name: /^Open Aarav Mehta/ }).click();
      await expect(p.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "employee-drawer-lost-reason",
    as: "priya",
    go: async (p) => {
      await p.getByRole("button", { name: /^Open Aarav Mehta/ }).click();
      await p.locator('label:has-text("Status") select').selectOption("LOST");
      await expect(p.getByRole("group", { name: "Lost reason" })).toBeVisible();
    },
  },
  {
    name: "employee-followups",
    as: "priya",
    go: async (p) => void (await p.getByRole("link", { name: "Follow-ups" }).click()),
  },
];

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`${theme} ${width}px`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme: theme });
      for (const s of SCREENS) {
        test(s.name, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("lb.theme", t), theme);
          if (s.as) await signIn(page, `${s.as === "admin" ? "admin" : "priya"}@demo.com`);
          await s.go(page);
          await page.waitForLoadState("networkidle");
          await page.screenshot({
            path: `${SHOTS}/${s.name}-${width}-${theme}.png`,
            fullPage: true,
          });
          const findings = await audit(page, width < 768);
          expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
        });
      }
    });
  }
}

test.describe("first sign-in screen (temporary password)", () => {
  for (const width of WIDTHS) {
    test(`change password at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 800 });
      await request.post("/api/auth/login", {
        data: { email: "admin@demo.com", password: PASSWORD },
      });
      const email = `new${width}${Date.now()}@demo.com`;
      const created = await request.post("/api/users", {
        data: { name: "New Hire", email, phone: "9876543210" },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const temp = (await created.json()).temporaryPassword as string;
      await page.goto("/");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(temp);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/change-password-${width}.png`, fullPage: true });
      const findings = await audit(page, width < 768);
      expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
    });
  }
});
