# Flutter App — Workout Exercise Videos

How the Flutter member app should read and play exercise demo videos, matching
the web dashboard pattern exactly.

## 1. Data contract

Workout plans live in `member_fitness_plans.plan_data` (JSONB). Each exercise
inside `plan_data.weeks[].days[].exercises[]` (or flat `plan_data.days[].exercises[]`)
may carry these optional fields — all existing plans without them stay valid:

```json
{
  "name": "Barbell Bench Press",
  "sets": 4,
  "reps": "8-10",
  "rest": "60s",
  "equipment": "Barbell",
  "form_tips": ["Retract shoulder blades", "Feet flat on the floor"],
  "video_url": "https://…/bench-press.mp4",
  "video_file_path": "exercises/bench-press-1719.mp4"
}
```

| Field | Type | Meaning |
|---|---|---|
| `video_url` | string? | Directly playable URL (https .mp4/.webm, YouTube, Vimeo). **Play this.** |
| `video_file_path` | string? | Path inside the public `workout-videos` storage bucket. Fallback when `video_url` is absent: resolve via `Supabase.instance.client.storage.from('workout-videos').getPublicUrl(path)`. |
| `form_tips` | string[] or string | Form cues shown under the player as the text alternative. |

Rule: **if `video_url == null && video_file_path == null`, render no video UI** —
never show an empty player.

## 2. Dart model

```dart
class ExerciseEntry {
  final String name;
  final int sets;
  final String reps;
  final String? videoUrl;
  final String? videoFilePath;
  final List<String> formTips;

  ExerciseEntry.fromJson(Map<String, dynamic> j)
      : name = j['name'] ?? 'Exercise',
        sets = (j['sets'] is num) ? (j['sets'] as num).toInt() : 0,
        reps = '${j['reps'] ?? ''}',
        videoUrl = j['video_url'] as String?,
        videoFilePath = j['video_file_path'] as String?,
        formTips = j['form_tips'] is List
            ? (j['form_tips'] as List).map((e) => '$e').toList()
            : (j['form_tips'] is String && (j['form_tips'] as String).isNotEmpty)
                ? [j['form_tips'] as String]
                : const [];

  String? resolvePlayableUrl() {
    if (videoUrl != null && videoUrl!.isNotEmpty) return videoUrl;
    if (videoFilePath != null && videoFilePath!.isNotEmpty) {
      return Supabase.instance.client.storage
          .from('workout-videos')
          .getPublicUrl(videoFilePath!);
    }
    return null;
  }
}
```

## 3. Playback (video_player / chewie)

- Package: `video_player` (+ `chewie` for controls). All URLs are progressive
  MP4/WebM over HTTPS — no HLS needed.
- Initialise lazily: create the `VideoPlayerController.networkUrl(Uri.parse(url))`
  only when the member taps **Watch demo**, dispose on sheet close. Never
  auto-play, never preload all videos of a day (data usage).
- YouTube/Vimeo URLs: open in an in-app webview or external browser instead of
  the native player.
- Show `formTips` as a bulleted list under the player — it is the accessible
  text alternative and works offline.

```dart
Future<void> _openDemo(ExerciseEntry ex) async {
  final url = ex.resolvePlayableUrl();
  if (url == null) return;
  final controller = VideoPlayerController.networkUrl(Uri.parse(url));
  await controller.initialize();
  // present in a modal bottom sheet; dispose in onClose
}
```

## 4. UX parity with the web dashboard

- Exercise row shows a small **Watch demo** chip (play icon) only when a video exists.
- Tapping opens a bottom sheet: 16:9 player on top, exercise name, muscle/equipment
  caption, form cues below.
- Respect reduced-motion / data-saver: no autoplay, no looping GIF-style previews.
- Cache nothing sensitive — these are public training videos; HTTP caching headers
  from the CDN are enough.

## 5. Trainer-side attaching (web only, for reference)

Trainers attach videos in the web workout builder via three sources:
**Library** (curated `exercise_video_library` table, searched through the
`exercise-videos` edge function), **URL**, or **Upload** (to the `workout-videos`
bucket). Flutter only consumes the resulting `plan_data` JSON — no extra API.
