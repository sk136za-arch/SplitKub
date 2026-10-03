import { describe, expect, it } from "vitest";
import { sharedErrorMessage } from "../lib/sharedErrorMessage";

describe("shared bill error messages", () => {
  it("asks for a new link when the capability token is invalid", () => {
    expect(sharedErrorMessage({ code: "invalid_token" })).toContain("ขอลิงก์ใหม่");
  });

  it("explains that an unavailable bill is missing or expired", () => {
    expect(sharedErrorMessage({ code: "unavailable" })).toContain("ไม่พบบิลนี้ หรือบิลหมดอายุแล้ว");
  });
});
