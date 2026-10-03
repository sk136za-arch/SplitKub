import { describe, expect, it } from "vitest";
import { isClientSafeKey, sharedBillConfiguration } from "../client";

function jwtWithRole(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("shared bill client configuration", () => {
  it("stays unavailable unless explicitly enabled and fully configured", () => {
    expect(sharedBillConfiguration(false, "https://example.supabase.co", "sb_publishable_test"))
      .toEqual({ available: false, reason: "disabled" });
    expect(sharedBillConfiguration(true, undefined, "sb_publishable_test"))
      .toEqual({ available: false, reason: "not_configured" });
  });

  it("accepts HTTPS and local HTTP only", () => {
    expect(sharedBillConfiguration(true, "https://project.supabase.co", "sb_publishable_test").available).toBe(true);
    expect(sharedBillConfiguration(true, "http://localhost:54321", "sb_publishable_test").available).toBe(true);
    expect(sharedBillConfiguration(true, "http://project.supabase.co", "sb_publishable_test"))
      .toEqual({ available: false, reason: "not_configured" });
  });

  it("accepts publishable and legacy anon keys but rejects secret/service-role keys", () => {
    expect(isClientSafeKey("sb_publishable_test")).toBe(true);
    expect(isClientSafeKey(jwtWithRole("anon"))).toBe(true);
    expect(isClientSafeKey(jwtWithRole("service_role"))).toBe(false);
    expect(isClientSafeKey("sb_secret_test")).toBe(false);
    expect(sharedBillConfiguration(true, "https://project.supabase.co", "sb_secret_test"))
      .toEqual({ available: false, reason: "not_configured" });
  });
});
