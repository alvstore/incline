# Security headers review + re-audit after publish

## What the live site already does (checked today)
- http://theincline.in redirects to https with a permanent redirect.
- HSTS is on: one year, includes subdomains.
- Referrer policy (strict-origin-when-cross-origin) and "nosniff" are on.
- www.theincline.in redirects to the main site, but with a temporary (302) redirect instead of a permanent one.

## What is missing
- Content Security Policy (which outside sites the page may load from).
- Permissions Policy (camera, microphone, location access).
- Protection against the site being framed by other sites.

## Limits of the hosting
Your hosting doesn't let the app set its own headers. So:
- Permissions Policy and framing protection can't be added from the app. They stay listed as open hosting items.
- The www redirect type is a hosting/domain setting, also listed as open.
- A Content Security Policy can be added inside the page itself.

## Plan
1. List every outside service the site really loads: backend, fonts, maps, payments, chat, 3D scan, push, images and video.
2. Add a Content Security Policy inside the page that allows only those services. It also blocks plugins and limits where forms may send data.
3. Check the homepage (3D dumbbell), registration, sign-in, a member payment page, the chat and push alerts in the browser. There must be no blocked-resource errors. If anything breaks, loosen that one rule only.
4. After you publish: re-audit live. This covers the security headers, the crawler rules, the missing-page screen, the address details and the sitemap. Then send the sitemap to Google Search Console and run a fresh SEO review.

## Technical details
- CSP via `<meta http-equiv="Content-Security-Policy">` in index.html (frame-ancestors, report-only and Permissions-Policy cannot be set through a meta tag).
- The allowlist comes from searching the code for outside addresses, plus the network log from a Playwright run.
- A test asserts the CSP includes the backend, font and payment hosts, so later edits can't silently break them.
