import { test, expect } from "@playwright/test";

test.describe("Image Transformations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/image-transform");
  });

  test("renders page title", async ({ page }) => {
    await expect(page.getByText("Image Transformations")).toBeVisible();
  });

  test("has img2img and img2video tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /image to image/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /image to video/i })).toBeVisible();
  });

  test("img2img shows drop zone and prompt input", async ({ page }) => {
    await expect(page.getByText(/drop an image/i)).toBeVisible();
    await expect(page.getByPlaceholder(/transform prompt/i)).toBeVisible();
  });

  test("transform button disabled without image", async ({ page }) => {
    const btn = page.getByRole("button", { name: /transform image/i });
    await expect(btn).toBeDisabled();
  });

  test("img2video tab has duration and fps inputs", async ({ page }) => {
    await page.getByRole("tab", { name: /image to video/i }).click();
    await expect(page.getByPlaceholder(/motion prompt/i)).toBeVisible();
  });

  test("animate button disabled without image", async ({ page }) => {
    await page.getByRole("tab", { name: /image to video/i }).click();
    const btn = page.getByRole("button", { name: /animate image/i });
    await expect(btn).toBeDisabled();
  });
});
