import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  // Defense in depth: fail closed on every non-local HTTP request.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

test("anonymous bill can be created, edited, copied, restored and closed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/bills");
  await page.getByRole("button", { name: "เริ่มสร้างบิล" }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const billUrl = page.url();
  await page.getByLabel("ชื่อบิล", { exact: true }).waitFor();
  await page.getByLabel("ชื่อบิล", { exact: true }).fill("มื้อเย็นทดสอบ");
  await page.getByRole("button", { name: "บันทึกชื่อ", exact: true }).click();
  for (const name of ["มะลิ", "ต้น"]) {
    await page.getByLabel("เพิ่มคน", { exact: true }).fill(name);
    await page.getByRole("button", { name: "+ เพิ่มคน", exact: true }).click();
    await expect(page.getByLabel(`PromptPay ของ ${name}`, { exact: true })).toBeVisible();
  }
  await page.getByLabel("PromptPay ของ มะลิ", { exact: true }).fill("0812345678");
  await page.getByLabel("PromptPay ของ มะลิ", { exact: true }).locator("xpath=ancestor::form").getByRole("button", { name: "บันทึกเลข" }).click();
  await page.getByLabel("ชื่อใบเสร็จใหม่").fill("ร้านอาหาร");
  await page.getByRole("button", { name: "+ เพิ่มใบเสร็จ", exact: true }).click();
  await page.getByLabel("คนที่จ่ายใบเสร็จนี้").selectOption({ label: "มะลิ" });
  await page.getByLabel("ชื่อรายการ", { exact: true }).fill("อาหาร");
  await page.getByLabel("ราคา (THB)", { exact: true }).fill("200");
  await page.getByRole("button", { name: "+ เพิ่ม", exact: true }).click();
  await page.getByRole("button", { name: "แก้ไข อาหาร", exact: true }).click();
  await page.getByLabel("ราคา (THB)", { exact: true }).fill("300");
  await page.getByLabel("ราคา (THB)", { exact: true }).locator("xpath=ancestor::form").getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByRole("button", { name: "สร้างลิงก์ให้เพื่อน" })).toBeDisabled();
  await page.getByRole("button", { name: "คัดลอกข้อความสรุป", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("มื้อเย็นทดสอบ");
  expect(copied).toContain("150.00");
  expect(copied).toContain("0812345678");
  await page.reload();
  await expect(page.getByLabel("ชื่อบิล", { exact: true })).toHaveValue("มื้อเย็นทดสอบ");
  await expect(page.getByRole("button", { name: "แก้ไข อาหาร", exact: true })).toBeVisible();
  await page.goto("/bills");
  const bill = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "มื้อเย็นทดสอบ", exact: true }) });
  await bill.getByRole("button", { name: "ยืนยันบิล", exact: true }).click();
  await expect(bill.getByText("ยืนยันแล้ว", { exact: true })).toBeVisible();
  await page.goto(billUrl);
  await expect(page.getByLabel("ชื่อบิล", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "แก้ไข อาหาร", exact: true })).toBeDisabled();
});

test("local groups survive reload and synchronize between tabs", async ({ page, context }) => {
  await page.goto("/groups");
  await page.getByPlaceholder("เช่น ทริปเชียงใหม่").fill("เพื่อนทดสอบ");
  await page.getByPlaceholder("ชื่อสมาชิก").fill("มะลิ");
  await page.getByRole("button", { name: "เพิ่มคน", exact: true }).click();
  await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
  await expect(page.getByRole("heading", { name: "เพื่อนทดสอบ" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "เพื่อนทดสอบ" })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/groups");
  const group = other.getByRole("article").filter({ has: other.getByRole("heading", { name: "เพื่อนทดสอบ" }) });
  await group.getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "เพื่อนทดสอบ" })).toHaveCount(0);
});
