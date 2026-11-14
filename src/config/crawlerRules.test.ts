// @ts-expect-error bun test runner types
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

const robots = readFileSync("public/robots.txt", "utf8");
const groups = robots.split(/\n(?=User-agent:)/).filter((g) => g.startsWith("User-agent:"));
const sitemap = readFileSync("public/sitemap.xml", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("robots.txt", () => {
  for (const bot of ["*", "Googlebot", "GPTBot", "PerplexityBot", "OAI-SearchBot", "ClaudeBot", "Applebot"]) {
    test(`${bot} is blocked from private areas`, () => {
      const g = groups.find((x) => x.startsWith(`User-agent: ${bot}\n`));
      expect(g).toBeDefined();
      for (const p of ["/admin", "/dashboard", "/member/", "/api/", "/auth", "/pos", "/trainer-dashboard"]) {
        expect(g!).toContain(`Disallow: ${p}\n`);
      }
    });
  }
});

describe("sitemap.xml", () => {
  const locs = [...sitemap.matchAll(/<loc>https:\/\/theincline\.in([^<]*)<\/loc>/g)].map((m) => m[1]);
  test("lists only real public pages, no duplicates or staff pages", () => {
    for (const p of locs) expect(app).toContain(`path="${p}"`);
    expect(locs).not.toContain("/feedback");
    expect(locs).not.toContain("/terms-of-service");
  });
});
