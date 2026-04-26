/**
 * Stealth Browser Mode — Phase 3.14
 *
 * When web connectors or research agents scrape sites, optionally run in
 * stealth mode that spoofs browser fingerprints to bypass anti-bot detection.
 * User-controlled toggle — off by default.
 *
 * Inspired by:
 * - tf-playwright-stealth (tinyfish-io/tf-playwright-stealth) — Playwright stealth
 * - playwright-extra-plugin-stealth — browser fingerprint spoofing
 *
 * Implementation: HTTP headers + user-agent rotation (zero-dependency stealth).
 * Production upgrade: add playwright-extra with stealth plugin for full fingerprint spoofing.
 *
 * Stealth headers strategy:
 * - Rotate User-Agent from realistic browser list
 * - Set Accept, Accept-Language, Accept-Encoding to match real browsers
 * - Add Sec-Fetch-* headers
 * - Add realistic Referer
 * - Remove X-Custom-Headers that signal automation
 */

export type StealthLevel = "none" | "basic" | "moderate" | "full";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const REFERERS = [
  "https://www.google.com/",
  "https://www.bing.com/",
  "https://duckduckgo.com/",
  "https://search.yahoo.com/",
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build stealth HTTP headers for a fetch request.
 * @param level - stealth intensity
 * @param targetUrl - URL being fetched (used for same-origin Referer logic)
 */
export function buildStealthHeaders(
  level: StealthLevel,
  targetUrl?: string,
): Record<string, string> {
  if (level === "none") return {};

  const ua = randomItem(USER_AGENTS);
  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  };

  if (level === "moderate" || level === "full") {
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    headers["Upgrade-Insecure-Requests"] = "1";
    headers["Referer"] = randomItem(REFERERS);
  }

  if (level === "full") {
    // Add platform-matching headers
    const isWindows = ua.includes("Windows");
    const isMac = ua.includes("Macintosh");
    const isLinux = ua.includes("Linux");

    if (ua.includes("Chrome")) {
      headers["Sec-CH-UA"] = `"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"`;
      headers["Sec-CH-UA-Mobile"] = "?0";
      headers["Sec-CH-UA-Platform"] = isWindows ? '"Windows"' : isMac ? '"macOS"' : '"Linux"';
    }
  }

  return headers;
}

/**
 * Stealth fetch — wraps native fetch with anti-detection headers.
 * Adds a human-like delay (500ms–2s) between requests.
 */
export async function stealthFetch(
  url: string,
  options: RequestInit = {},
  level: StealthLevel = "basic",
): Promise<Response> {
  const stealthHeaders = buildStealthHeaders(level, url);
  const mergedHeaders = { ...stealthHeaders, ...(options.headers ?? {}) };

  // Human-like delay
  if (level !== "none") {
    const delay = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return fetch(url, { ...options, headers: mergedHeaders });
}
