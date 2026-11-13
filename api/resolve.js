import { resolvePerson } from "./_lib/douban.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const person = await resolvePerson(req.query.input || "");
    res.status(200).json({ ok: true, person });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
