"""Smoke flow: restore session -> dashboard -> search a member -> open profile.

Run:  python3 flow_login_member_search.py "Sachin"
"""
import asyncio
import sys

from playwright.async_api import async_playwright

from _common import BASE, attach_diagnostics, dump, new_page, restore_session

QUERY = sys.argv[1] if len(sys.argv) > 1 else "INC-26"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context, page = await new_page(browser)
        log = attach_diagnostics(page)

        await restore_session(context, page)
        await page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        print("after dashboard:", page.url)
        await page.screenshot(path="01-dashboard.png")

        # Global search is keyboard-triggered in the app header.
        await page.keyboard.press("Control+k")
        await page.wait_for_timeout(600)
        search = page.get_by_placeholder("Search", exact=False)
        if await search.count() == 0:
            print("!! global search input not found — check AppHeader / CommandPalette")
        else:
            await search.first.fill(QUERY)
            await page.wait_for_timeout(1800)
            await page.screenshot(path="02-search.png")
            first = page.get_by_role("option").first
            if await first.count():
                await first.click()
                await page.wait_for_timeout(2500)
                print("member profile:", page.url)
                await page.screenshot(path="03-member.png")
            else:
                print("!! no search results for", QUERY)

        dump(log)
        await browser.close()


asyncio.run(main())
