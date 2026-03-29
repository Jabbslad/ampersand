// Pretext Canvas Renderer — Progressive enhancement for text rendering
// Uses Pretext (text measurement) + Canvas 2D to render all text content.
// The original DOM stays transparent underneath for a11y, selection, and links.

(function () {
  "use strict";

  // --- Configuration ---

  const TARGET_SELECTORS = [
    "article section.body h1",
    "article section.body h2",
    "article section.body h3",
    "article section.body h4",
    "article section.body h5",
    "article section.body h6",
    "article section.body p",
    "article section.body li",
    "article section.body blockquote p",
    ".home-title",
    ".home-subtitle",
    ".post-header h1",
    ".post-header .description",
    ".page-header",
    ".section-kicker",
  ].join(", ");

  const SKIP_TAGS = new Set([
    "PRE",
    "CODE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "SCRIPT",
    "STYLE",
    "CANVAS",
    "SVG",
    "IMG",
    "VIDEO",
    "IFRAME",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "BUTTON",
  ]);

  const INLINE_TAGS = new Set([
    "STRONG",
    "B",
    "EM",
    "I",
    "A",
    "CODE",
    "SPAN",
    "MARK",
    "SUB",
    "SUP",
    "SMALL",
    "S",
    "U",
    "ABBR",
    "TIME",
  ]);

  const REQUIRED_FONTS = ["Fraunces", "ZedTextFtl"];

  // --- Utilities ---

  function getCSSVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function buildFontString(weight, style, size, family) {
    let parts = [];
    if (style && style !== "normal") parts.push(style);
    if (weight && weight !== "400") parts.push(weight);
    parts.push(size);
    parts.push(family);
    return parts.join(" ");
  }

  function shouldEnhance(el) {
    // Skip elements with media children
    if (el.querySelector("img, video, iframe, canvas, svg")) return false;
    // Skip elements inside code blocks
    if (el.closest("pre")) return false;
    // Skip elements with very little text
    const text = el.textContent || "";
    if (text.trim().length < 3) return false;
    // Skip elements already enhanced
    if (el.classList.contains("pretext-enhanced")) return false;
    return true;
  }

  // --- Segment Extraction ---
  // Walks the DOM tree of an element and extracts styled text segments.

  function extractSegments(el) {
    const segments = [];
    const computedStyle = getComputedStyle(el);
    const baseFont = {
      family: computedStyle.fontFamily,
      size: computedStyle.fontSize,
      weight: computedStyle.fontWeight,
      style: computedStyle.fontStyle,
      letterSpacing: computedStyle.letterSpacing,
    };

    function walkNode(node, inheritedFont, inheritedColor, linkHref) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text || text.length === 0) return;

        segments.push({
          text: text,
          font: buildFontString(
            inheritedFont.weight,
            inheritedFont.style,
            inheritedFont.size,
            inheritedFont.family
          ),
          color: inheritedColor,
          href: linkHref,
          isCode: false,
          letterSpacing: inheritedFont.letterSpacing,
        });
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;

      // Handle line breaks
      if (tag === "BR") {
        segments.push({ type: "break" });
        return;
      }

      // Skip non-inline elements that shouldn't be traversed
      if (SKIP_TAGS.has(tag)) return;

      const nodeStyle = getComputedStyle(node);
      const nodeFont = {
        family: nodeStyle.fontFamily,
        size: nodeStyle.fontSize,
        weight: nodeStyle.fontWeight,
        style: nodeStyle.fontStyle,
        letterSpacing: nodeStyle.letterSpacing,
      };
      const nodeColor = nodeStyle.color;
      const nodeHref =
        tag === "A" ? node.getAttribute("href") : linkHref;
      const isCode = tag === "CODE";

      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (isCode) {
          // For inline code, extract as a single code segment
          if (child.nodeType === Node.TEXT_NODE) {
            segments.push({
              text: child.textContent,
              font: buildFontString(
                nodeFont.weight,
                nodeFont.style,
                nodeFont.size,
                nodeFont.family
              ),
              color: nodeColor,
              href: nodeHref,
              isCode: true,
              letterSpacing: nodeFont.letterSpacing,
            });
          }
        } else {
          walkNode(child, nodeFont, nodeColor, nodeHref);
        }
      }
    }

    const baseColor = computedStyle.color;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      walkNode(child, baseFont, baseColor, null);
    }

    return segments;
  }

  // --- Line Composition ---
  // Composes lines from multiple segments, each with different fonts.
  // Uses Pretext's layoutNextLine per-segment to handle word wrapping.

  function composeLines(segments, maxWidth, lineHeight) {
    const lines = [];
    let currentLine = { fragments: [], width: 0 };

    function pushLine() {
      if (currentLine.fragments.length > 0) {
        lines.push(currentLine);
      }
      currentLine = { fragments: [], width: 0 };
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Handle forced line breaks
      if (seg.type === "break") {
        pushLine();
        continue;
      }

      // Prepare this segment's text with Pretext
      let prepared;
      try {
        prepared = Pretext.prepareWithSegments(seg.text, seg.font);
      } catch (e) {
        // Fallback: treat as a single fragment on current line
        currentLine.fragments.push({
          text: seg.text,
          x: currentLine.width,
          font: seg.font,
          color: seg.color,
          href: seg.href,
          isCode: seg.isCode,
          width: 0, // unknown
        });
        continue;
      }

      let cursor = { segmentIndex: 0, graphemeIndex: 0 };

      while (true) {
        const remainingWidth = maxWidth - currentLine.width;
        const line = Pretext.layoutNextLine(
          prepared,
          cursor,
          remainingWidth
        );

        if (!line) break;

        currentLine.fragments.push({
          text: line.text,
          x: currentLine.width,
          font: seg.font,
          color: seg.color,
          href: seg.href,
          isCode: seg.isCode,
          width: line.width,
        });
        currentLine.width += line.width;

        cursor = line.end;

        // Check if there's more text in this segment
        // If layoutNextLine returned text and the cursor hasn't reached the end,
        // it means a line break occurred within this segment
        const nextLine = Pretext.layoutNextLine(prepared, cursor, maxWidth);
        if (nextLine) {
          // There's more text — the previous line is complete
          pushLine();

          // Process this next line result
          currentLine.fragments.push({
            text: nextLine.text,
            x: 0,
            font: seg.font,
            color: seg.color,
            href: seg.href,
            isCode: seg.isCode,
            width: nextLine.width,
          });
          currentLine.width = nextLine.width;
          cursor = nextLine.end;

          // Continue consuming remaining text from this segment
          while (true) {
            const moreLine = Pretext.layoutNextLine(
              prepared,
              cursor,
              maxWidth
            );
            if (!moreLine) break;

            // Previous line done, start new
            pushLine();
            currentLine.fragments.push({
              text: moreLine.text,
              x: 0,
              font: seg.font,
              color: seg.color,
              href: seg.href,
              isCode: seg.isCode,
              width: moreLine.width,
            });
            currentLine.width = moreLine.width;
            cursor = moreLine.end;
          }
        }
        break; // Done with this segment
      }
    }

    // Push the final line
    pushLine();

    return lines;
  }

  // --- Canvas Rendering ---

  function readThemeColors() {
    return {
      text0: getCSSVar("--text-0"),
      text1: getCSSVar("--text-1"),
      text2: getCSSVar("--text-2"),
      accent: getCSSVar("--accent"),
      borderColor: getCSSVar("--border-color"),
      codeBg: getCSSVar("--code-bg"),
    };
  }

  function renderToCanvas(el, lines, lineHeight) {
    const dpr = window.devicePixelRatio || 1;
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Find existing canvas or create new one
    let canvas = el.querySelector(".pretext-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "pretext-canvas";
      canvas.setAttribute("aria-hidden", "true");
      el.appendChild(canvas);
    }

    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.textBaseline = "alphabetic";

    const colors = readThemeColors();

    // Compute the resolved lineHeight in pixels
    const computedStyle = getComputedStyle(el);
    const resolvedLineHeight = parseFloat(computedStyle.lineHeight);
    const fontSize = parseFloat(computedStyle.fontSize);
    const effectiveLineHeight =
      isNaN(resolvedLineHeight) ? fontSize * lineHeight : resolvedLineHeight;

    // Compute padding
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

    // Baseline offset: roughly 80% of fontSize from top of line
    const baselineRatio = 0.78;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y =
        paddingTop + i * effectiveLineHeight + fontSize * baselineRatio;

      for (const frag of line.fragments) {
        const x = paddingLeft + frag.x;

        // Draw code background
        if (frag.isCode && colors.codeBg) {
          const pad = 2;
          ctx.fillStyle = colors.codeBg;
          ctx.beginPath();
          const bgX = x - pad;
          const bgY = y - fontSize * baselineRatio - pad;
          const bgW = frag.width + pad * 2;
          const bgH = fontSize + pad * 2;
          ctx.roundRect(bgX, bgY, bgW, bgH, 3);
          ctx.fill();
        }

        // Set font and color
        ctx.font = frag.font;

        if (frag.href) {
          ctx.fillStyle = colors.text0;
        } else if (frag.isCode) {
          ctx.fillStyle = colors.accent;
        } else {
          ctx.fillStyle = frag.color || colors.text1;
        }

        // Apply letter-spacing by drawing character by character for
        // elements with non-default letter-spacing
        ctx.fillText(frag.text, x, y);

        // Draw link underline
        if (frag.href) {
          const underlineY = y + fontSize * 0.18;
          ctx.fillStyle = colors.borderColor;
          ctx.fillRect(x, underlineY, frag.width, 1);
        }
      }
    }
  }

  // --- Element Enhancement ---

  function enhanceElement(el) {
    if (!shouldEnhance(el)) return;

    const computedStyle = getComputedStyle(el);
    const lineHeight = parseFloat(computedStyle.lineHeight) / parseFloat(computedStyle.fontSize);
    const maxWidth = el.clientWidth -
      (parseFloat(computedStyle.paddingLeft) || 0) -
      (parseFloat(computedStyle.paddingRight) || 0);

    if (maxWidth <= 0) return;

    // Extract segments from DOM
    const segments = extractSegments(el);
    if (segments.length === 0) return;

    // Compose lines using Pretext measurement
    const lines = composeLines(segments, maxWidth, lineHeight);
    if (lines.length === 0) return;

    // Mark as enhanced (makes text transparent)
    el.classList.add("pretext-enhanced");

    // Cache data for resize/theme re-rendering
    el._pretextData = { segments, lineHeight, maxWidth };

    // Render to canvas
    renderToCanvas(el, lines, lineHeight);
  }

  function rerenderElement(el) {
    const data = el._pretextData;
    if (!data) return;

    const computedStyle = getComputedStyle(el);
    const maxWidth = el.clientWidth -
      (parseFloat(computedStyle.paddingLeft) || 0) -
      (parseFloat(computedStyle.paddingRight) || 0);

    if (maxWidth <= 0) return;

    // Re-extract segments if font size changed (fluid clamp values)
    const currentFontSize = computedStyle.fontSize;
    if (data.lastFontSize && data.lastFontSize !== currentFontSize) {
      data.segments = extractSegments(el);
    }
    data.lastFontSize = currentFontSize;

    const lineHeight = parseFloat(computedStyle.lineHeight) / parseFloat(computedStyle.fontSize);
    const lines = composeLines(data.segments, maxWidth, lineHeight);
    renderToCanvas(el, lines, lineHeight);
  }

  function rerenderAll() {
    document.querySelectorAll(".pretext-enhanced").forEach(rerenderElement);
  }

  // --- Initialization ---

  function init() {
    const targets = document.querySelectorAll(TARGET_SELECTORS);
    const elements = Array.from(targets).filter(shouldEnhance);

    if (elements.length === 0) return;

    // Set up IntersectionObserver for lazy enhancement
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if ("requestIdleCallback" in window) {
              requestIdleCallback(() => enhanceElement(entry.target));
            } else {
              requestAnimationFrame(() => enhanceElement(entry.target));
            }
            visibilityObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200% 0px" }
    );

    elements.forEach((el) => visibilityObserver.observe(el));

    // ResizeObserver for responsive re-rendering
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (!el._pretextRafPending) {
          el._pretextRafPending = true;
          requestAnimationFrame(() => {
            rerenderElement(el);
            el._pretextRafPending = false;
          });
        }
      }
    });

    // Observe enhanced elements as they appear
    const originalEnhance = enhanceElement;
    enhanceElement = function (el) {
      originalEnhance(el);
      if (el.classList.contains("pretext-enhanced")) {
        resizeObserver.observe(el);
      }
    };

    // MutationObserver for theme changes (dark/light toggle)
    const themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class") {
          requestAnimationFrame(rerenderAll);
          break;
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true });
  }

  // --- Entry Point ---

  document.addEventListener("DOMContentLoaded", async () => {
    // Ensure Pretext is available
    if (typeof Pretext === "undefined" || !Pretext.prepareWithSegments) {
      console.warn("Pretext: library not loaded, skipping canvas enhancement");
      return;
    }

    // Wait for web fonts to load
    try {
      await document.fonts.ready;
    } catch (e) {
      // fonts.ready not supported, proceed anyway
    }

    // Verify required fonts are available
    const fontsLoaded = REQUIRED_FONTS.every((name) =>
      document.fonts.check('16px "' + name + '"')
    );

    if (!fontsLoaded) {
      console.warn(
        "Pretext: required fonts not available, skipping canvas enhancement"
      );
      return;
    }

    init();
  });
})();
