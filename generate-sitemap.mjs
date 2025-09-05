// generate-sitemap.mjs
import { writeFile } from "fs/promises";
import { setTimeout as sleep } from "timers/promises";

const START = process.argv[2] || "https://www.baumechemical.com/";
const ORIGIN = new URL(START).origin;

// ปรับได้: จำกัดจำนวนหน้า, หน่วงเวลาระหว่างยิง, user-agent
const MAX_PAGES = Infinity;         // หรือ 500 ถ้าต้องการจำกัด
const DELAY_MS = 150;               // ไม่น้อยเกินจะสุภาพกว่า
const USER_AGENT = "BaumeSiteMapBot/1.0 (+https://www.baumechemical.com/)";

const EXT_SKIP = /\.(?:pdf|jpg|jpeg|png|gif|webp|svg|ico|js|css|json|txt|zip|rar|7z|mp4|mp3|wav|woff2?|ttf|eot)$/i;

const seen = new Set();
const queue = [normalizeUrl(START)];
const pages = []; // {loc, lastmod}

function normalizeUrl(u) {
  try {
    const url = new URL(u, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    url.hash = "";
    // ตัด query ทั้งหมด เพื่อหลีก duplicate
    url.search = "";
    // /index.html → /
    url.pathname = url.pathname.replace(/\/index\.html?$/i, "/");
    // ตัดซ้ำ // → /
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    // กันไฟล์ที่ไม่ใช่หน้า HTML
    if (EXT_SKIP.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

function guessChangefreq(path) {
  if (path === "/") return "weekly";
  if (path.startsWith("/blog")) return "weekly";
  if (path.startsWith("/products")) return "monthly";
  if (path.includes("contact")) return "yearly";
  return "monthly";
}

function guessPriority(path) {
  if (path === "/") return 1.0;
  if (path.startsWith("/blog/")) return 0.8;
  if (path === "/blog/") return 0.8;
  if (path.startsWith("/products")) return 0.7;
  if (path.includes("contact")) return 0.4;
  return 0.6;
}

async function fetchHtml(u) {
  const res = await fetch(u, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html,*/*" } });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return { html: "", lastmod: res.headers.get("last-modified") };
  const html = await res.text();
  return { html, lastmod: res.headers.get("last-modified") };
}

function extractLinks(html, base) {
  const links = [];
  // ดึงเฉพาะ <a href="">
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    const norm = normalizeUrl(new URL(href, base).toString());
    if (norm) links.push(norm);
  }
  return links;
}

(async () => {
  while (queue.length && pages.length < MAX_PAGES) {
    const u = queue.shift();
    if (!u || seen.has(u)) continue;
    seen.add(u);

    try {
      const { html, lastmod } = await fetchHtml(u);
      pages.push({ loc: u, lastmod: lastmod || new Date().toISOString() });

      // เก็บลิงก์ต่อไป
      if (html) {
        const links = extractLinks(html, u);
        for (const link of links) {
          if (!seen.has(link)) queue.push(link);
        }
      }
      await sleep(DELAY_MS);
    } catch (e) {
      // ข้ามหน้า error แต่เดินต่อ
      // console.warn("Skip:", u, e.message);
    }
  }

  // เรียงให้โฮมเพจมาก่อน
  pages.sort((a, b) => (a.loc === ORIGIN ? -1 : b.loc === ORIGIN ? 1 : a.loc.localeCompare(b.loc)));

  // สร้าง XML
  const urls = pages.map(p => {
    const path = new URL(p.loc).pathname || "/";
    const changefreq = guessChangefreq(path);
    const priority = guessPriority(path).toFixed(1);
    return `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${new Date(p.lastmod).toISOString()}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  await writeFile("sitemap.xml", xml, "utf8");
  console.log(`✅ Generated sitemap.xml with ${pages.length} URLs`);
})();
