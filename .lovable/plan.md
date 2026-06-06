# Audit — Instagram comment shows post ID instead of the post media

## Root cause

`supabase/functions/meta-webhook/index.ts → ingestInstagramComment` captures `value.media.id` but never asks the Graph API for the post's media. Line 741 just builds:

```
const content = `[Comment on ${mediaId || "media"}] ${text}`;
```

and inserts the message with `message_type: "comment"`, no `media_url`, no `media_meta`, no `permalink`. The chat bubble (`WhatsAppChat.tsx` line 1295+) only renders media when `media_url` exists; with none, it falls back to printing the raw `content` — which is why the user sees `[Comment on 18436385950191564] When and where it's opening?` instead of the post / reel preview.

Ad comments are the same code path — Meta delivers the comment with `media.id` but never inlines the creative.

## Fix

### 1. Enrich the comment at ingest time (`meta-webhook/index.ts`)

After we have `mediaId`, `igAccountId`, and the page `access_token` from the integration, call Graph once:

```
GET /{media-id}?fields=id,media_type,media_url,thumbnail_url,permalink,caption&access_token=...
```

Map the response → message row fields:
- `media_url` ← `thumbnail_url` (videos/reels) or `media_url` (image / carousel item)
- `media_meta` ← JSON `{ kind, media_type, permalink, caption, media_id, thumbnail_url, media_url, source: "ig_comment_media" }`
- `message_type` ← keep `comment` (so badge stays correct), but the bubble can branch on `media_meta.kind` (`image|video|reels|carousel`)
- `content` ← drop the noisy `[Comment on …]` prefix; store `💬 ${text}` (or just `text` plus a small "Commented on your post" badge in UI). Keep the original media id inside `media_meta.media_id` for traceability.

Graph fallbacks:
- Carousel (`CAROUSEL_ALBUM`) → also fetch `/{media-id}/children?fields=media_url,thumbnail_url,media_type` and store the first child's URL as preview, rest in `media_meta.children`.
- Reels (`VIDEO` with `media_product_type=REELS`) → `thumbnail_url` is the still; `permalink` opens the reel.
- API errors (deleted media, missing perms, dark posts/IG ads where the media object is private) → keep current text fallback but use `media_meta: { kind: "comment_only", media_id, error }` so the UI can show a neutral "Comment on a post" card with a "View on Instagram" link to `https://www.instagram.com/p/<shortcode>/` when permalink is available.

Cache: dedupe Graph calls per `mediaId` inside one request burst with a short-lived in-memory map (avoid hitting the rate limit when 10 comments land on the same ad).

### 2. Reuse existing campaign cache when available

If an `ig_comment_campaigns` row matches this `media_id`, copy its `ig_media_permalink` and `ig_media_url`/thumbnail straight onto the message — skip the Graph call. This already exists for comment-to-DM runs; just read it during ingest.

### 3. Render in the chat (`WhatsAppChat.tsx`)

Add a `MessageCommentMediaCard` (or branch inside the existing bubble) for `message_type === 'comment'`:

```
┌───────────────────────────────────────┐
│ [thumb 64×64]  📷 Commented on your   │
│                Reel / Post             │
│                "Free Membership – fol… │  ← truncated caption
│                ↗ Open on Instagram     │
└───────────────────────────────────────┘
"When and where it's opening?"
11:49 ✓
```

Behavior:
- Thumbnail comes from `media_meta.thumbnail_url || media_meta.media_url || msg.media_url`.
- Whole card is an `<a target="_blank" rel="noopener">` to `media_meta.permalink`.
- Reels get a small ▶ overlay on the thumb.
- Carousel gets a stacked-frames icon.
- Fallback (no media resolved): show a generic card "Comment on a post" with "Open on Instagram" linking to `https://www.instagram.com/?utm=…` only if we have a shortcode; otherwise just the badge + the comment text.

### 4. Backfill existing comment rows (migration)

Update `public.whatsapp_messages` where `message_type='comment'` AND `media_url IS NULL` AND `media_meta` doesn't include `permalink`:
- Parse `media_id` out of the existing `content` (`/^\[Comment on (\d+)\]/`).
- For rows whose `media_id` matches a known `ig_comment_campaigns.ig_media_id`, copy `permalink` + `media_url` into `media_meta` + `media_url`.
- Leave the rest for the next inbound enrichment cycle (no Graph calls from SQL).

## Files

- `supabase/functions/meta-webhook/index.ts` — enrich `ingestInstagramComment`; add `fetchIgMediaPreview(mediaId, accessToken)` helper with carousel/reel handling and 5-min in-memory cache.
- `src/pages/WhatsAppChat.tsx` — add `<IgCommentMediaCard>` (small inline component) used when `msg.message_type === 'comment'`; drop the bare `[Comment on …]` text rendering when a real preview is present.
- New migration — backfill existing comment rows from `ig_comment_campaigns` cache.

## Verification

1. Trigger a fresh comment on the same ad post; chat now shows a thumbnail card + caption + "Open on Instagram", followed by the comment text "When and where it's opening?".
2. Comment on a reel → ▶ overlay + thumbnail; click opens the reel.
3. Comment on a carousel → first frame + stacked-frames icon.
4. Comment on a dark/deleted ad creative → graceful card without thumbnail, no `[Comment on 184…]` raw text.
5. Backfilled rows from the previous @e.lvnnn / @shweta_mulani threads show the cached ad preview where the campaign row knew the permalink.

## Out of scope

- Story replies (already handled separately via `isStoryReply` + `[Story reply → …]` prefix).
- Mentions (`ingestInstagramMention`) — same fix can be applied later in a small follow-up; structure is identical.
- Downloading IG media into our own Storage bucket for permanent caching (Meta CDN URLs expire after ~24h, but `permalink` is stable forever, so the card still works after the thumbnail expires — we can do permanent caching later if the UX needs it).
