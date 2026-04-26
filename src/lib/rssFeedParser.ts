/**
 * RSS/Atom Feed Parser — zero-dependency XML extraction
 *
 * Parses RSS 2.0 and Atom 1.0 feeds without external libraries.
 * For production, use rss-parser (MIT, rbren/rss-parser) for full spec compliance.
 */

export interface FeedItem {
  guid:        string;
  title:       string;
  link:        string;
  description: string;
  pubDate?:    Date;
}

export interface ParsedFeed {
  title:       string;
  description: string;
  link:        string;
  items:       FeedItem[];
}

function extractTag(xml: string, tag: string): string {
  // Try CDATA first
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  // Plain tag
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const plainMatch = xml.match(plainRe);
  return plainMatch?.[1]?.trim() ?? "";
}

function extractAttr(tag: string, attr: string): string {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  return tag.match(re)?.[1] ?? "";
}

export function parseFeed(xml: string): ParsedFeed {
  const isAtom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");

  if (isAtom) {
    return parseAtom(xml);
  }
  return parseRSS(xml);
}

function parseRSS(xml: string): ParsedFeed {
  const channelMatch = xml.match(/<channel>([\s\S]*?)<\/channel>/i);
  const channelXml = channelMatch?.[1] ?? xml;

  const title       = extractTag(channelXml, "title");
  const description = extractTag(channelXml, "description");
  const link        = extractTag(channelXml, "link");

  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const items: FeedItem[] = itemMatches.map((m, i) => {
    const itemXml = m[1];
    const itemTitle = extractTag(itemXml, "title");
    const itemLink  = extractTag(itemXml, "link");
    const guid      = extractTag(itemXml, "guid") || extractTag(itemXml, "link") || `item-${i}`;
    const desc      = extractTag(itemXml, "description");
    const pubDate   = extractTag(itemXml, "pubDate");

    return {
      guid,
      title:       itemTitle,
      link:        itemLink,
      description: desc,
      pubDate:     pubDate ? new Date(pubDate) : undefined,
    };
  });

  return { title, description, link, items };
}

function parseAtom(xml: string): ParsedFeed {
  const title = extractTag(xml, "title");
  const subtitle = extractTag(xml, "subtitle");

  // Extract link with rel="alternate" or first href
  const linkMatch = xml.match(/<link[^/]*rel="alternate"[^/]*href="([^"]*)"/) ??
                    xml.match(/<link[^/]*href="([^"]*)"/);
  const link = linkMatch?.[1] ?? "";

  const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  const items: FeedItem[] = entryMatches.map((m, i) => {
    const entryXml = m[1];
    const entryTitle = extractTag(entryXml, "title");
    const entryLink  = extractAttr(entryXml.match(/<link[^>]*>/)?.[0] ?? "", "href");
    const guid       = extractTag(entryXml, "id") || entryLink || `entry-${i}`;
    const desc       = extractTag(entryXml, "summary") || extractTag(entryXml, "content");
    const updated    = extractTag(entryXml, "updated") || extractTag(entryXml, "published");

    return {
      guid,
      title:       entryTitle,
      link:        entryLink,
      description: desc,
      pubDate:     updated ? new Date(updated) : undefined,
    };
  });

  return { title, description: subtitle, link, items };
}

/** Fetch and parse a feed URL. */
export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await fetch(url, {
    headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`Feed fetch error ${res.status}: ${url}`);
  const xml = await res.text();
  return parseFeed(xml);
}
