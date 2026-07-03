import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@sedsolutions.online";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "SedAdmin#2026";

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/login/);
});

test("login → dashboard → admin nav visible for admin", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
});
