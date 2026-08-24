"""Shared helpers for Incline Playwright flows.

Copy this next to your flow script in /tmp/browser/<slug>/ and import it.
"""
import json
import os

BASE = "http://localhost:8080"


async def restore_session(context, page):
    """Restore the Lovable-injected auth session (cookies + localStorage)."""
    cj = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cj:
        await context.add_cookies([{**c, "url": BASE} for c in json.loads(cj)])
    await page.goto(BASE, wait_until="domcontentloaded")
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if key and sj:
        await page.evaluate(
            f"localStorage.setItem({json.dumps(key)}, {json.dumps(sj)})"
        )
    return bool(key and sj)


def attach_diagnostics(page):
    """Collect console messages, page errors and failed/4xx-5xx responses."""
    log = {"console": [], "errors": [], "network": []}
    page.on("console", lambda m: log["console"].append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: log["errors"].append(str(e)))
    page.on(
        "requestfailed",
        lambda r: log["network"].append(f"FAILED {r.method} {r.url}"),
    )

    def _resp(r):
        if r.status >= 400:
            log["network"].append(f"{r.status} {r.request.method} {r.url}")

    page.on("response", _resp)
    return log


def dump(log, path="diagnostics.json"):
    with open(path, "w") as f:
        json.dump(log, f, indent=2)
    print("console errors:", [c for c in log["console"] if c.startswith("error")][:10])
    print("page errors:", log["errors"][:10])
    print("bad responses:", log["network"][:20])


async def new_page(browser):
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    return context, page
