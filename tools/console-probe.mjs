/* Print every console message in full, so shader errors are readable. */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const puppeteer = require("C:/Users/abhi/AppData/Roaming/npm/node_modules/puppeteer");

const url = process.argv[2] || "http://127.0.0.1:8802/?hero=0.2&reveal=0.4&envs=2";
const wait = Number(process.argv[3] || 4000);

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,900"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("console", (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, wait));
await browser.close();
