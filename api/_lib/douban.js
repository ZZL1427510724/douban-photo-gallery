// douban.js — Douban fetching logic for the Cloudflare Worker.
//
// VERIFIED 2026-11-14 (from this VM, plain fetch, no login, no signature):
//   GET https://m.douban.com/rexxar/api/v2/personage/34914546
//     -> 200 {"celebrity_id":"1427992","id":"34914546","title":"李妍锡", ...}
//   GET https://m.douban.com/rexxar/api/v2/celebrity/1427992
//     -> 200 (person detail)
//   GET https://m.douban.com/rexxar/api/v2/celebrity/1427992/photos?start=0&count=50
//     -> 200 {"total":106,"photos":[...]}  (pages 0/50/100 return 50+50+6)
//   Image hosts: https://img{1..9}.doubanio.com/view/photo/{s|m|l}/public/p<photoId>.jpg
//     -> HEAD 200 image/jpeg with Referer https://www.douban.com/
//
// NOT verified / best-effort:
//   Frodo signed API (frodo.douban.com/api/v2/...) — every variant tested
//   returned code 996 (signature error) or 997 (unsigned). The Worker tries
//   it only as a last resort and never claims it works.
//   Desktop pages https://www.douban.com/personage/<id>/photos/ return
//   403 "error code: 01004 Please login" without a session, and the mobile
//   HTML pages are JS shells with no photo data in them — HTML scraping
//   alone does NOT yield photos.

export const DOUBAN_REFERER = "https://m.douban.com/";
export const DOUBAN_IMAGE_REFERER = "https://www.douban.com/";
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const REXXAR = "https://m.douban.com/rexxar/api/v2";

function rexxarHeaders() {
  return {
    "User-Agent": BROWSER_UA,
    Referer: DOUBAN_REFERER,
    Accept: "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: rexxarHeaders() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Douban ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

/** Parse a pasted Douban personage/celebrity link or a plain ID. */
export function parseInput(input) {
  let s = String(input || "").trim();
  if (!s) throw new Error("请输入豆瓣人物链接或 ID");
  // Douban App share links are dispatch URLs with the real link URL-encoded
  // in the uri/fallback params (e.g. %2Fsubject%2F27502918). Decode first so
  // the patterns below can match; tolerate malformed % sequences.
  try {
    s = decodeURIComponent(s);
  } catch { /* keep the raw input */ }
  const personage = s.match(/personage\/(\d+)/);
  if (personage) return { kind: "personage", id: personage[1] };
  const celebrity = s.match(/celebrity\/(\d+)/);
  if (celebrity) return { kind: "celebrity", id: celebrity[1] };
  const subject = s.match(/subject\/(\d+)/);
  if (subject) return { kind: "personage", id: subject[1] };
  const plain = s.match(/^(\d{5,})$/);
  if (plain) return { kind: "plain", id: plain[1] };
  throw new Error("没认出这是豆瓣人物链接：请粘贴 personage / celebrity 链接或纯数字 ID");
}

/** Resolve any input to {name, celebrityId, personageId, avatar, photoTotal, doubanUrl}. */
export async function resolvePerson(input) {
  const parsed = parseInput(input);

  if (parsed.kind === "celebrity") {
    const d = await getJson(`${REXXAR}/celebrity/${parsed.id}`);
    return normalisePerson(d, parsed.id, null);
  }

  // personage (or plain ID: try personage first, then celebrity)
  try {
    const d = await getJson(`${REXXAR}/personage/${parsed.id}`);
    if (!d.celebrity_id) throw new Error("personage 接口没有返回 celebrity_id");
    const person = normalisePerson(d, d.celebrity_id, parsed.id);
    // photoTotal comes from the photos endpoint; fetch page 0 cheaply.
    try {
      const page = await getJson(`${REXXAR}/celebrity/${d.celebrity_id}/photos?start=0&count=1`);
      person.photoTotal = page.total ?? 0;
    } catch {
      person.photoTotal = 0;
    }
    return person;
  } catch (e) {
    if (parsed.kind === "plain") {
      const d = await getJson(`${REXXAR}/celebrity/${parsed.id}`);
      return normalisePerson(d, parsed.id, null);
    }
    throw e;
  }
}

function normalisePerson(d, celebrityId, personageId) {
  const name = d.title || d.name || "";
  const avatar =
    (d.avatar && typeof d.avatar === "string" ? d.avatar : null) ||
    (d.cover && d.cover.large && d.cover.large.url) ||
    "";
  return {
    name,
    celebrityId: String(celebrityId),
    personageId: personageId ? String(personageId) : null,
    avatar,
    photoTotal: 0,
    doubanUrl: personageId
      ? `https://www.douban.com/personage/${personageId}/photos/`
      : `https://movie.douban.com/celebrity/${celebrityId}/`,
  };
}

/** One page of photos, normalised. seq = crawl order (0-based, global). */
export async function fetchPhotos(celebrityId, start = 0, count = 30) {
  const d = await getJson(
    `${REXXAR}/celebrity/${celebrityId}/photos?start=${start}&count=${count}`,
  );
  const photos = (d.photos || []).map((p, i) => normalisePhoto(p, start + i));
  return { total: d.total ?? photos.length, photos };
}

export function normalisePhoto(p, seq) {
  const img = p.image || {};
  const large = img.large || {};
  const normal = img.normal || {};
  const small = img.small || {};
  const raw = img.raw && typeof img.raw === "object" ? img.raw : null;
  return {
    id: String(p.id),
    seq,
    thumb: small.url || normal.url || large.url || "",
    large: large.url || "",
    // image.raw is null in the Rexxar response; the "large" (l) size is
    // the biggest publicly served version, so it is the original here.
    original: (raw && raw.url) || large.url || "",
    author: (p.author && p.author.name) || "",
    authorAvatar: (p.author && p.author.avatar) || "",
    likes: p.likers_count ?? 0,
    comments: p.comments_count ?? 0,
    created: p.create_time || "",
    width: large.width || 0,
    height: large.height || 0,
    description: p.description || "",
    url: p.url || "",
    // NOTE: Douban's `position` field repeats / scrambles page 1 — never
    // sort by it. Display order is the crawl sequence (seq).
    position: p.position ?? null,
  };
}

/** Fetch one Douban image server-side, with the Referer the CDN requires.
 * Retries a few times: when the gallery fires dozens of image requests at
 * once, Douban sometimes throttles a burst and a single attempt fails even
 * though the same URL works a moment later. */
export async function fetchImage(url, attempts = 3) {
  const u = new URL(url);
  if (!u.hostname.endsWith(".doubanio.com")) {
    throw new Error("只允许代理 doubanio.com 的图片");
  }
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: DOUBAN_IMAGE_REFERER,
          Accept: "image/*,*/*",
        },
      });
      if (!res.ok) throw new Error(`图片 ${res.status}: ${url}`);
      return res;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw lastError;
}
