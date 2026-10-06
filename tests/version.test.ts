import { describe, expect, it } from "vite-plus/test";
import { compareVersions, nextVersion } from "../src/version.ts";

describe("nextVersion", () => {
  it("bumps patch, minor, and major", () => {
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("releases a prerelease as its version on patch", () => {
    expect(nextVersion("1.3.0-rc.1", "patch")).toBe("1.3.0");
  });

  it("accepts an explicit version and rejects anything else", () => {
    expect(nextVersion("1.2.3", "2.0.0-beta.1")).toBe("2.0.0-beta.1");
    expect(() => nextVersion("1.2.3", "next")).toThrow(/not a version/);
  });
});

describe("compareVersions", () => {
  it("orders by semver precedence, prereleases before their release", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
