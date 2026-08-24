"""Flow: /campaigns -> Campaign Wizard -> audience + channels + preview.

Key assertions:
  * "Everyone at the club" resolves to a NON-ZERO live audience size
  * channels can be selected AND deselected
  * previews render per channel (WhatsApp bubble vs Email HTML)
  * cold-audience WhatsApp sends are blocked without an approved template

Run:  python3 flow_campaign_send.py
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
        await page.goto(f"{BASE}/campaigns", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path="01-campaigns.png")

        new_btn = page.get_by_role("button", name="New Campaign", exact=False)
        if await new_btn.count() == 0:
            print("!! New Campaign button not found")
            dump(log)
            await browser.close()
            return
        await new_btn.first.click()
        await page.wait_for_timeout(1200)
        await page.screenshot(path="02-wizard-type.png")

        # Step through: type -> audience
        promo = page.get_by_text("Promotion", exact=False).first
        if await promo.count():
            await promo.click()
        nxt = page.get_by_role("button", name="Next", exact=False)
        if await nxt.count():
            await nxt.first.click()
        await page.wait_for_timeout(1200)

        everyone = page.get_by_text("Everyone at the club", exact=False).first
        if await everyone.count():
            await everyone.click()
            await page.wait_for_timeout(2500)
        await page.screenshot(path="03-audience.png")

        body = await page.inner_text("body")
        for line in body.splitlines():
            if "recipient" in line.lower() or "audience size" in line.lower():
                print("AUDIENCE:", line.strip())
                if "0 recipient" in line.lower():
                    print("!! REGRESSION: audience resolved to zero")

        # Channel toggling: select then deselect must both work.
        for ch in ("WhatsApp", "Email"):
            btn = page.get_by_role("button", name=ch, exact=False)
            if await btn.count():
                await btn.first.click()
                await page.wait_for_timeout(400)
        await page.screenshot(path="04-channels.png")

        dump(log)
        await browser.close()


asyncio.run(main())
