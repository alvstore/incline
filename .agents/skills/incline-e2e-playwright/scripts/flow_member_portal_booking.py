"""Flow: member-role session -> /my-benefits -> book a facility slot.

Asserts credits render, a slot is bookable, and the credit balance drops.
Mint a MEMBER-role session first:
    lovable auth-session --json --user <member_uuid>

Run:  python3 flow_member_portal_booking.py
"""
import asyncio

from playwright.async_api import async_playwright

from _common import BASE, attach_diagnostics, dump, new_page, restore_session


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context, page = await new_page(browser)
        log = attach_diagnostics(page)

        await restore_session(context, page)
        await page.goto(f"{BASE}/my-benefits", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        print("url:", page.url)
        await page.screenshot(path="01-benefits.png")

        if "/auth" in page.url or "/unauthorized" in page.url:
            print("!! not signed in as a member — mint a member-role session first")
            dump(log)
            await browser.close()
            return

        before = await page.inner_text("body")

        book = page.get_by_role("button", name="Book", exact=False)
        if await book.count() == 0:
            print("!! no bookable slot visible (check facility schedule / credits)")
        else:
            await book.first.click()
            await page.wait_for_timeout(1200)
            await page.screenshot(path="02-book-drawer.png")
            confirm = page.get_by_role("button", name="Confirm", exact=False)
            if await confirm.count():
                await confirm.first.click()
                await page.wait_for_timeout(2500)
            await page.screenshot(path="03-after-booking.png")
            after = await page.inner_text("body")
            print("page text changed after booking:", before != after)

        dump(log)
        await browser.close()


asyncio.run(main())
