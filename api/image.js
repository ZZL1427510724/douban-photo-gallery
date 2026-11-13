import { fetchImage } from "./_lib/douban.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const r = await fetchImage(req.query.url || "");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(r.status).end(buf);
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
