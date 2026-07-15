/** Real device detection via the UA string — not viewport width. A desktop browser
 * resized down to phone/tablet dimensions (DevTools responsive mode, a narrow window)
 * still has no camera to hand off to, so gating "Scan via mobile" on screen size alone
 * would let people into a feature that can't actually work for them; this checks what
 * the browser itself claims to be running on instead. Covers phones and tablets alike
 * (Android's "Mobile" token is only present on phones, not tablets, but bare "Android"
 * already matches both; iPadOS and Windows tablets need the touch-points fallback
 * below since their UA strings are otherwise identical to their desktop counterparts). */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
  // iPadOS 13+ requests desktop sites by default, so its UA is byte-for-byte identical
  // to macOS Safari — no "iPad"/"Mobile" token survives. Same story for Windows
  // tablets (Surface etc.) against a plain Windows desktop UA. maxTouchPoints
  // disambiguates in both cases: a real tablet reports multiple touch points, a
  // mouse-and-keyboard desktop reports 0 (or 1, for some trackpads).
  if (/Macintosh|Windows/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}
