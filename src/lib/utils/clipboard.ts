/**
 * Safe clipboard copy that works even when document is not focused
 * (e.g. after a toast action, async edge-fn response, or popover close).
 *
 * Falls back to a hidden <textarea> + execCommand('copy') if the async
 * Clipboard API throws (NotAllowedError / "Document is not focused").
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Make sure the window has focus before calling the async API.
  try {
    if (typeof window !== "undefined") {
      window.focus();
    }
  } catch {
    /* ignore */
  }

  // Try the modern async API first.
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function" &&
      typeof document !== "undefined" &&
      document.hasFocus()
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }

  // Legacy fallback — works without focus / in iframes.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
