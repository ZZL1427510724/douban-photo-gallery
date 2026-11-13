# 豆瓣人物图片画廊

粘贴任意豆瓣人物（personage / celebrity）链接或 ID，爬取该人物的全部公开照片：深色画廊在线浏览、原图下载、整包 ZIP 下载。

示例：李妍锡（personage 34914546），共 106 张照片。

## 部署（Vercel）

1. 在 Vercel 里新建项目或在已有项目里点 **Connect Git Repository**，选择本仓库。
2. 不需要任何环境变量，部署完成后直接访问。

也可以用 `vercel deploy` 从本地部署。

## 结构

- `public/`：前端（深色画廊、灯箱、分包 ZIP 下载）
- `api/`：Vercel Serverless 函数
  - `resolve.js`：解析豆瓣人物链接/ID
  - `photos.js`：分页拉取照片列表
  - `image.js`：图片代理（带豆瓣 Referer，绕过防盗链）
  - `zip.js`：打包原图 ZIP
  - `health.js`：健康检查
- `public/data/photos-1427992.json`：李妍锡 106 张照片的种子数据

## 原理

不走需要登录签名的 Frodo 接口，直接调用豆瓣移动端 Rexxar 接口
（`m.douban.com/rexxar/api/v2/...`），无需登录、无需签名。
图片一律经 `/api/image` 代理加载，避免豆瓣防盗链。
