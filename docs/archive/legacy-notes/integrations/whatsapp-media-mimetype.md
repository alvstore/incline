---
name: WhatsApp media MIME type requirement
description: Meta rejects template/freeform media whose URL serves the wrong Content-Type (error 131053); CDN caches the header per URL, so fixes need a fresh object path.
type: constraint
---

# WhatsApp media MIME type (Meta error 131053)

- Meta's Cloud API downloads header/attachment media from the provided URL and rejects anything whose served `Content-Type` is not an allowed type (video must be `video/mp4` or `video/3gpp`). Error: `131053 Media upload error`.
- Files uploaded without an explicit content type land in storage as `application/octet-stream` — always set the correct MIME type **at upload time** (Storage API `Content-Type` header), not afterwards.
- The CDN caches the served content type per URL. Updating `storage.objects` metadata after the fact does NOT reliably change what Meta fetches — upload to a **new object path** instead.
- Birthday video canonical URL: `template-media/birthday/incline-birthday-video-v3.mp4` (verified `video/mp4` on GET, Oct 2026). The original `incline-birthday-video.mp4` and `-v2` paths are cache-poisoned with `octet-stream` — do not reuse them.
- Verify with a full GET (not just HEAD): `curl -s -o /dev/null -D - <url> | grep -i content-type` — HEAD and GET can disagree while caches warm.
