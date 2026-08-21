import { describe, expect, it } from "vitest";
import { assertDemoSeedAllowed, assertExistingEnvAllowsDemoWrite, DemoSeedBlockedError, postgresHost } from "./demo-guard.js";

const localEnv = {
  NODE_ENV: "test",
  ALLOW_DEMO_SEED: "true",
  PLATFORM_DOMAIN: "localhost",
  DATABASE_OWNER_URL: "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp",
  DATABASE_URL: "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp",
};

describe("demo seed guard", () => {
  it("parses loopback postgres hosts", () => {
    expect(postgresHost(localEnv.DATABASE_OWNER_URL)).toBe("127.0.0.1");
    expect(postgresHost("postgres://user:pass@localhost:5432/schoolapp")).toBe("localhost");
    expect(postgresHost("not-a-url")).toBeNull();
  });

  it("allows an explicit local demo configuration", () => {
    expect(() => assertDemoSeedAllowed(localEnv)).not.toThrow();
  });

  it("blocks production even when ALLOW_DEMO_SEED is set", () => {
    expect(() => assertDemoSeedAllowed({ ...localEnv, NODE_ENV: "production" })).toThrow(
      DemoSeedBlockedError,
    );
  });

  it("blocks missing ALLOW_DEMO_SEED", () => {
    expect(() => assertDemoSeedAllowed({ ...localEnv, ALLOW_DEMO_SEED: undefined })).toThrow(
      /ALLOW_DEMO_SEED/,
    );
  });

  it("blocks a non-localhost platform domain", () => {
    expect(() =>
      assertDemoSeedAllowed({ ...localEnv, PLATFORM_DOMAIN: "schoolapp.example.com" }),
    ).toThrow(/PLATFORM_DOMAIN/);
  });

  it("blocks a remote database URL", () => {
    expect(() =>
      assertDemoSeedAllowed({
        ...localEnv,
        DATABASE_OWNER_URL: "postgres://schoolapp_owner:secret@db.example.com:5432/schoolapp",
      }),
    ).toThrow(/loopback/);
  });

  it("refuses to overwrite a production-looking existing env file", () => {
    expect(() =>
      assertExistingEnvAllowsDemoWrite({
        NODE_ENV: "production",
        PLATFORM_DOMAIN: "localhost",
        DATABASE_OWNER_URL: localEnv.DATABASE_OWNER_URL,
      }),
    ).toThrow(/NODE_ENV=production/);
    expect(() =>
      assertExistingEnvAllowsDemoWrite({
        PLATFORM_DOMAIN: "schoolapp.example.com",
        DATABASE_OWNER_URL: localEnv.DATABASE_OWNER_URL,
      }),
    ).toThrow(/PLATFORM_DOMAIN/);
    expect(() =>
      assertExistingEnvAllowsDemoWrite({
        DATABASE_URL: "postgres://schoolapp_app:secret@db.example.com:5432/schoolapp",
      }),
    ).toThrow(/loopback/);
  });

  it("allows overwriting a local env that is missing ALLOW_DEMO_SEED", () => {
    expect(() =>
      assertExistingEnvAllowsDemoWrite({
        PLATFORM_DOMAIN: "localhost",
        DATABASE_OWNER_URL: localEnv.DATABASE_OWNER_URL,
      }),
    ).not.toThrow();
  });
});
