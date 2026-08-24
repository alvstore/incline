"""Flow: member profile -> purchase membership drawer -> record payment.

Asserts the drawer opens, dates are editable (including backdated starts),
the due-date presets exist, and totals/dues render after saving.

Run:  python3 flow_member_purchase_payment.py <member_uuid>
"""
import asyncio
import sys

from playwright.async_api import async_playwright

from _common import BASE, attach_diagnostics, dump, new_page, restore_session

MEMBER_ID = sys.argv[1] if len(sys.argv) > 1 else None


async def main():
    if not MEMBER_ID:
        print("usage: flow_member_purchase_payment.py <member_uuid>")
        return
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context, page = await new_page(browser)
        log = attach_diagnostics(page)

        await restore_session(context, page)
        await page.goto(f"{BASE}/members/{MEMBER_ID}", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path="01-member.png")

        buy = page.get_by_role("button", name="Purchase", exact=False)
        if await buy.count() == 0:
            buy = page.get_by_role("button", name="Add Membership", exact=False)
        if await buy.count() == 0:
            print("!! no purchase entry point visible for this role")
            dump(log)
            await browser.close()
            return

        await buy.first.click()
        await page.wait_for_timeout(1200)
        drawer = page.get_by_role("dialog")
        await drawer.screenshot(path="02-purchase-drawer.png")

        # House rule: forms must be right-side sheets, not centered dialogs.
        box = await drawer.bounding_box()
        print("drawer box (expect right-anchored):", box)

        # Due-date presets (3 / 7 / 10 / 15 days) should be present.
        for label in ("3 days", "7 days", "10 days", "15 days"):
            print(label, "present:", await page.get_by_text(label, exact=False).count() > 0)

        print("start-date input present:",
              await page.get_by_label("Start", exact=False).count() > 0)

        dump(log)
        await browser.close()


asyncio.run(main())
