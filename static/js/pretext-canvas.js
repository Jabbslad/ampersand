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
    "PRE", "CODE", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
    "SCRIPT", "STYLE", "CANVAS", "SVG", "IMG", "VIDEO", "IFRAME",
    "INPUT", "TEXTAREA", "SELECT", "BUTTON",
  ]);

  const REQUIRED_FONTS = ["Fraunces", "ZedTextFtl"];

  // --- Utilities ---

  function getCSSVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function buildFontString(weight, style, size, family) {
    var parts = [];
    if (style && style !== "normal") parts.push(style);
    if (weight && weight !== "400") parts.push(weight);
    parts.push(size);
    parts.push(family);
    return parts.join(" ");
  }

  function shouldEnhance(el) {
    if (el.querySelector("img, video, iframe, canvas, svg")) return false;
    if (el.closest("pre")) return false;
    var text = el.textContent || "";
    if (text.trim().length < 3) return false;
    if (el.classList.contains("pretext-enhanced")) return false;
    return true;
  }

  // --- Segment Extraction ---
  // Walks the DOM tree of an element and extracts styled text segments.
  // IMPORTANT: Must be called BEFORE adding pretext-enhanced class,
  // otherwise getComputedStyle returns transparent colors.

  function extractSegments(el) {
    var segments = [];
    var computedStyle = getComputedStyle(el);
    var baseFont = {
      family: computedStyle.fontFamily,
      size: computedStyle.fontSize,
      weight: computedStyle.fontWeight,
      style: computedStyle.fontStyle,
    };

    function walkNode(node, inheritedFont, inheritedColor, linkHref) {
      if (node.nodeType === Node.TEXT_NODE) {
        var text = node.textContent;
        if (!text || text.length === 0) return;
        segments.push({
          text: text,
          font: buildFontString(inheritedFont.weight, inheritedFont.style, inheritedFont.size, inheritedFont.family),
          color: inheritedColor,
          href: linkHref,
          isCode: false,
        });
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      var tag = node.tagName;

      if (tag === "BR") {
        segments.push({ type: "break" });
        return;
      }

      if (SKIP_TAGS.has(tag)) return;

      var nodeStyle = getComputedStyle(node);
      var nodeFont = {
        family: nodeStyle.fontFamily,
        size: nodeStyle.fontSize,
        weight: nodeStyle.fontWeight,
        style: nodeStyle.fontStyle,
      };
      var nodeColor = nodeStyle.color;
      var nodeHref = tag === "A" ? node.getAttribute("href") : linkHref;
      var isCode = tag === "CODE";

      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (isCode && child.nodeType === Node.TEXT_NODE) {
          segments.push({
            text: child.textContent,
            font: buildFontString(nodeFont.weight, nodeFont.style, nodeFont.size, nodeFont.family),
            color: nodeColor,
            href: nodeHref,
            isCode: true,
          });
        } else {
          walkNode(child, nodeFont, nodeColor, nodeHref);
        }
      }
    }

    var baseColor = computedStyle.color;
    for (var child = el.firstChild; child; child = child.nextSibling) {
      walkNode(child, baseFont, baseColor, null);
    }

    return segments;
  }

  // --- Line Composition ---
  // Composes lines from multiple segments using Pretext's layoutNextLine.
  // Each segment may have a different font, so we prepare each independently
  // and consume them sequentially across shared lines.

  function composeLines(segments, maxWidth) {
    var lines = [];
    var currentLine = { fragments: [], width: 0 };

    function pushLine() {
      if (currentLine.fragments.length > 0) {
        lines.push(currentLine);
      }
      currentLine = { fragments: [], width: 0 };
    }

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];

      if (seg.type === "break") {
        pushLine();
        continue;
      }

      // Prepare this segment's text with Pretext
      var prepared;
      try {
        prepared = Pretext.prepareWithSegments(seg.text, seg.font);
      } catch (e) {
        // Fallback: place entire text as one fragment
        currentLine.fragments.push({
          text: seg.text, x: currentLine.width, font: seg.font,
          color: seg.color, href: seg.href, isCode: seg.isCode, width: 0,
        });
        continue;
      }

      // Consume all lines from this segment
      var cursor = { segmentIndex: 0, graphemeIndex: 0 };
      var isFirstLineOfSegment = true;

      while (true) {
        var availableWidth = isFirstLineOfSegment
          ? (maxWidth - currentLine.width)
          : maxWidth;

        var line = Pretext.layoutNextLine(prepared, cursor, availableWidth);
        if (!line) break;

        // If not the first line of segment, the previous line is full
        if (!isFirstLineOfSegment) {
          pushLine();
        }

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
        isFirstLineOfSegment = false;
      }
    }

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

  function renderToCanvas(el, lines) {
    var dpr = window.devicePixelRatio || 1;
    var rect = el.getBoundingClientRect();
    var width = rect.width;
    var height = rect.height;

    if (width <= 0 || height <= 0) return false;

    // Find existing canvas or create new one
    var canvas = el.querySelector(".pretext-canvas");
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

    var ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.scale(dpr, dpr);
    ctx.textBaseline = "alphabetic";

    var colors = readThemeColors();
    var computedStyle = getComputedStyle(el);
    var fontSize = parseFloat(computedStyle.fontSize);
    var resolvedLineHeight = parseFloat(computedStyle.lineHeight);
    var effectiveLineHeight = isNaN(resolvedLineHeight) ? fontSize * 1.5 : resolvedLineHeight;
    var paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    var paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

    // Baseline offset — approximate ascender position within the line box
    var baselineOffset = fontSize * 0.78;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var y = paddingTop + i * effectiveLineHeight + baselineOffset;

      // Don't draw below the element
      if (y > height) break;

      for (var j = 0; j < line.fragments.length; j++) {
        var frag = line.fragments[j];
        var x = paddingLeft + frag.x;

        // Code background
        if (frag.isCode && colors.codeBg) {
          ctx.fillStyle = colors.codeBg;
          ctx.beginPath();
          var pad = 2;
          ctx.roundRect(x - pad, y - baselineOffset - pad, frag.width + pad * 2, fontSize + pad * 2, 3);
          ctx.fill();
        }

        ctx.font = frag.font;

        if (frag.href) {
          ctx.fillStyle = colors.text0;
        } else if (frag.isCode) {
          ctx.fillStyle = colors.accent;
        } else {
          ctx.fillStyle = frag.color || colors.text1;
        }

        ctx.fillText(frag.text, x, y);

        // Link underline
        if (frag.href) {
          ctx.fillStyle = colors.borderColor;
          ctx.fillRect(x, y + fontSize * 0.18, frag.width, 1);
        }
      }
    }

    return true;
  }

  // --- Element Enhancement ---

  var resizeObserver;

  function enhanceElement(el) {
    if (!shouldEnhance(el)) return;

    var computedStyle = getComputedStyle(el);
    var maxWidth = el.clientWidth
      - (parseFloat(computedStyle.paddingLeft) || 0)
      - (parseFloat(computedStyle.paddingRight) || 0);

    if (maxWidth <= 0) return;

    // Extract segments BEFORE making text transparent
    var segments = extractSegments(el);
    if (segments.length === 0) return;

    // Compose lines using Pretext measurement
    var lines = composeLines(segments, maxWidth);
    if (lines.length === 0) return;

    // Cache segment data (with original colors) for re-rendering
    el._pretextSegments = segments;
    el._pretextLastFontSize = computedStyle.fontSize;

    // Render canvas BEFORE making text transparent — verify it has content
    var ok = renderToCanvas(el, lines);
    if (!ok) {
      var c = el.querySelector(".pretext-canvas");
      if (c) c.remove();
      return;
    }

    // Verify the canvas actually drew visible pixels
    var canvas = el.querySelector(".pretext-canvas");
    if (canvas) {
      var ctx = canvas.getContext("2d");
      var sample = ctx.getImageData(0, 0, Math.min(canvas.width, 200), Math.min(canvas.height, 50));
      var hasContent = false;
      for (var p = 3; p < sample.data.length; p += 4) {
        if (sample.data[p] > 0) { hasContent = true; break; }
      }
      if (!hasContent) {
        canvas.remove();
        return;
      }
    }

    // Canvas has content — now make DOM text transparent
    el.classList.add("pretext-enhanced");

    if (resizeObserver) resizeObserver.observe(el);
  }

  function rerenderElement(el) {
    var segments = el._pretextSegments;
    if (!segments) return;

    var computedStyle = getComputedStyle(el);
    var maxWidth = el.clientWidth
      - (parseFloat(computedStyle.paddingLeft) || 0)
      - (parseFloat(computedStyle.paddingRight) || 0);

    if (maxWidth <= 0) return;

    // If font size changed (fluid clamp), we need to re-extract segments.
    // Temporarily remove pretext-enhanced class to get real colors.
    var currentFontSize = computedStyle.fontSize;
    if (el._pretextLastFontSize !== currentFontSize) {
      el.classList.remove("pretext-enhanced");
      segments = extractSegments(el);
      el._pretextSegments = segments;
      el._pretextLastFontSize = currentFontSize;
      el.classList.add("pretext-enhanced");
    }

    var lines = composeLines(segments, maxWidth);
    renderToCanvas(el, lines);
  }

  function rerenderAll() {
    document.querySelectorAll(".pretext-enhanced").forEach(rerenderElement);
  }

  // --- Initialization ---

  function init() {
    var targets = document.querySelectorAll(TARGET_SELECTORS);
    var elements = Array.from(targets).filter(shouldEnhance);
    if (elements.length === 0) return;

    // ResizeObserver for responsive re-rendering
    resizeObserver = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i].target;
        if (!el._pretextRafPending) {
          el._pretextRafPending = true;
          requestAnimationFrame(function (target) {
            return function () {
              rerenderElement(target);
              target._pretextRafPending = false;
            };
          }(el));
        }
      }
    });

    // IntersectionObserver for lazy enhancement
    var visibilityObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            // Enhance immediately — don't defer, as that causes flash of invisible text
            enhanceElement(entry.target);
            visibilityObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "100% 0px" }
    );

    elements.forEach(function (el) { visibilityObserver.observe(el); });

    // MutationObserver for theme changes (dark/light toggle)
    var themeObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === "class") {
          // Re-extract colors by temporarily removing class, re-extracting, re-rendering
          document.querySelectorAll(".pretext-enhanced").forEach(function (el) {
            el.classList.remove("pretext-enhanced");
            el._pretextSegments = extractSegments(el);
            el.classList.add("pretext-enhanced");
          });
          requestAnimationFrame(rerenderAll);
          break;
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true });
  }

  // --- Entry Point ---

  document.addEventListener("DOMContentLoaded", async function () {
    // Skip on narrow viewports — canvas text rendering has measurement
    // differences on mobile browsers that cause layout mismatches
    if (window.innerWidth < 768) return;

    if (typeof Pretext === "undefined" || !Pretext.prepareWithSegments) {
      console.warn("Pretext: library not loaded, skipping canvas enhancement");
      return;
    }

    try { await document.fonts.ready; } catch (e) { /* proceed */ }

    var fontsLoaded = REQUIRED_FONTS.every(function (name) {
      return document.fonts.check('16px "' + name + '"');
    });

    if (!fontsLoaded) {
      console.warn("Pretext: required fonts not available, skipping canvas enhancement");
      return;
    }

    init();
  });
})();
