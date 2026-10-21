#!/bin/sh
# Assert the post article stays within a 68ch measure and meets the
# minimum inset: 48px at 1440px wide, 20px at 390px wide.
# The page ground is pure black and the panels are transparent.
# ASCII layers are decorative. Reduced motion shows the static footer
# wordmark instead of the pointer canvas.
set -eu
URL="${1:-http://127.0.0.1:1111/posts/loop-engineering/}"
export NODE_PATH="${NODE_PATH:-/tmp/node_modules}"

node - "$URL" << 'EOF'
const puppeteer = require("puppeteer-core");
const url = process.argv[2];

const cases = [
  { width: 1440, minPad: 48 },
  { width: 390, minPad: 20 },
];

const homeUrl = new URL("/", url).href;
const black = "rgb(0, 0, 0)";

function fail(message) {
  console.error("FAIL " + message);
  process.exitCode = 1;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("theme-storage", "dark");
  });

  for (const item of cases) {
    await page.setViewport({ width: item.width, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const article = document.querySelector("article");
      const cs = getComputedStyle(article);
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const contentWidth = article.clientWidth - padL - padR;
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(68);
      probe.style.cssText = "position:absolute;left:-9999px;white-space:nowrap;font:" + cs.font;
      document.body.appendChild(probe);
      const measure = probe.getBoundingClientRect().width;
      probe.remove();
      const hero = document.querySelector(".hero-banner");
      const footer = document.querySelector(".site-footer");
      const box = article.getBoundingClientRect();
      const pre = article.querySelector("pre");
      const h2 = article.querySelector(".body h2");
      const prev = h2 && h2.previousElementSibling;
      const footerContent = footer.querySelector(".footer-content");
      return {
        contentWidth: Math.round(contentWidth * 100) / 100,
        measure: Math.round(measure * 100) / 100,
        padL, padR,
        padT: parseFloat(cs.paddingTop),
        padB: parseFloat(cs.paddingBottom),
        gapHero: hero ? Math.round((box.top - hero.getBoundingClientRect().bottom) * 100) / 100 : null,
        gapFooter: footer ? Math.round((footer.getBoundingClientRect().top - box.bottom) * 100) / 100 : null,
        preWidth: pre ? Math.round(pre.getBoundingClientRect().width * 100) / 100 : null,
        beforeHeading: prev ? Math.round((h2.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) * 100) / 100 : null,
        afterHeading: h2 && h2.nextElementSibling
          ? Math.round((h2.nextElementSibling.getBoundingClientRect().top - h2.getBoundingClientRect().bottom) * 100) / 100
          : null,
        footerPadTop: parseFloat(getComputedStyle(footer).paddingTop),
        footerPadX: parseFloat(getComputedStyle(footerContent).paddingLeft),
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    });

    console.log(item.width + "px " + JSON.stringify(m));

    if (!(m.contentWidth <= m.measure + 1)) {
      fail(item.width + " content width " + m.contentWidth + "px exceeds 68ch measure " + m.measure + "px");
    }
    if (!(m.padL >= item.minPad && m.padR >= item.minPad)) {
      fail(item.width + " padding " + m.padL + "/" + m.padR + " is under " + item.minPad + "px");
    }
    if (m.preWidth != null && !(m.preWidth <= m.contentWidth + 1)) {
      fail(item.width + " code block " + m.preWidth + "px is wider than the measure " + m.contentWidth + "px");
    }
    if (m.beforeHeading != null && m.afterHeading != null) {
      if (m.beforeHeading < 32 || m.afterHeading < 32 || Math.abs(m.beforeHeading - m.afterHeading) > 1) {
        fail(item.width + " heading rhythm " + m.beforeHeading + " before / " + m.afterHeading + " after, want an even 32px");
      }
    }
    if (m.htmlBg !== black || m.bodyBg !== black) {
      fail(item.width + " page background html " + m.htmlBg + " body " + m.bodyBg + ", want " + black);
    }
  }

  async function readSurfaces() {
    return page.evaluate(() => {
      const transparent = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
      const panels = [...document.querySelectorAll("article, .featured-card, .home-section")].map((panel) => {
        const color = getComputedStyle(panel).backgroundColor;
        return { className: panel.className || panel.tagName, color, transparent: transparent(color) };
      });
      const masks = [...document.querySelectorAll(".article-header, article section.body, .featured-card-body")].map((node) => ({
        className: node.className,
        color: getComputedStyle(node).backgroundColor,
      }));
      return {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        panels,
        masks,
      };
    });
  }

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  for (const target of [url, homeUrl]) {
    await page.goto(target, { waitUntil: "networkidle0", timeout: 60000 });
    const report = await readSurfaces();
    console.log("surface " + target + " " + JSON.stringify(report));
    if (report.html !== black || report.body !== black) {
      fail("ground " + report.html + " / " + report.body + ", want " + black);
    }
    if (report.panels.length === 0) fail("found no panels on " + target);
    report.panels.forEach((row) => {
      if (!row.transparent) fail("panel " + row.className + " background " + row.color + " is not transparent");
    });
    report.masks.forEach((row) => {
      if (row.color !== black) fail("text ground " + row.className + " is " + row.color + ", want " + black);
    });
  }

  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  const ascii = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".ascii-burst, .hero-ascii, .footer-field, .footer-field-fallback")];
    return nodes.map((node) => ({
      className: node.className,
      hidden: node.getAttribute("aria-hidden") === "true",
    }));
  });
  console.log("ascii " + JSON.stringify(ascii));
  if (ascii.length < 4) fail("expected ASCII burst, hero dissolve, footer canvas and static fallback");
  ascii.forEach((node) => {
    if (!node.hidden) fail(node.className + " is missing aria-hidden");
  });

  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  const motion = await page.evaluate(() => {
    const canvas = document.querySelector(".footer-field");
    const fallback = document.querySelector(".footer-field-fallback");
    return {
      canvas: getComputedStyle(canvas).display,
      fallback: getComputedStyle(fallback).display,
      hidden: fallback.getAttribute("aria-hidden") === "true",
    };
  });
  console.log("reduced-motion " + JSON.stringify(motion));
  if (motion.canvas !== "none") fail("reduced motion still shows the footer canvas (" + motion.canvas + ")");
  if (motion.fallback === "none" || !motion.hidden) fail("reduced motion fallback is " + motion.fallback);

  await browser.close();
  if (process.exitCode) process.exit(process.exitCode);
  console.log("ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
