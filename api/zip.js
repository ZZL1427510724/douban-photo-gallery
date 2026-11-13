import { fetchPhotos, fetchImage } from "./_lib/douban.js";
import { createZip, zipEntryName } from "./_lib/zip.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const celebrityId = req.query.celebrityId;
    const start = Math.max(0, parseInt(req.query.start || "0", 10) || 0);
    const count = Math.min(50, Math.max(1, parseInt(req.query.count || "50", 10) || 50));
    const name = (req.query.name || "豆瓣照片").trim() || "豆瓣照片";
    if (!celebrityId) return res.status(400).json({ ok: false, error: "缺少 celebrityId" });

    const { photos } = await fetchPhotos(celebrityId, start, count);
    if (photos.length === 0) return res.status(400).json({ ok: false, error: "这一包没有照片" });

    const entries = [];
    const skipped = [];
    for (let i = 0; i < photos.length; i += 10) {
      const chunk = photos.slice(i, i + 10);
      const results = await Promise.all(
        chunk.map(async (photo, j) => {
          try {
            const r = await fetchImage(photo.original || photo.large);
            const buf = new Uint8Array(await r.arrayBuffer());
            if (buf.length < 100) throw new Error("图片太小，疑似错误页");
            return { name: zipEntryName(photo, i + j, start), data: buf };
          } catch (e) {
            skipped.push({ id: photo.id, error: String(e.message || e) });
            return null;
          }
        }),
      );
      for (const r of results) if (r) entries.push(r);
    }
    if (entries.length === 0) {
      return res.status(502).json({ ok: false, error: "这一包的原图全部下载失败", skipped });
    }

    const blob = createZip(entries);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
      return res.status(500).json({ ok: false, error: "生成的不是有效 ZIP，已拒绝返回" });
    }

    const batch = Math.floor(start / count) + 1;
    const filename = `${name}-照片-第${batch}包.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("X-Zip-Entries", String(entries.length));
    res.setHeader("X-Zip-Skipped", String(skipped.length));
    res.status(200).end(buf);
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
