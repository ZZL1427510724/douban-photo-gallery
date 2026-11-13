import { fetchPhotos } from "./_lib/douban.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const celebrityId = req.query.celebrityId;
    if (!celebrityId) return res.status(400).json({ ok: false, error: "缺少 celebrityId" });
    const start = Math.max(0, parseInt(req.query.start || "0", 10) || 0);
    const count = Math.min(50, Math.max(1, parseInt(req.query.count || "30", 10) || 30));
    const { total, photos } = await fetchPhotos(celebrityId, start, count);
    res.status(200).json({ ok: true, total, photos });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
