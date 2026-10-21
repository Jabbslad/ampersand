(function () {
  var GLYPHS = " .:-=+*#%@";
  var BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  var GREEN = [120, 231, 114];
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pointer = null;

  function groundChannels() {
    var color = getComputedStyle(document.body).backgroundColor;
    var match = color.match(/[\d.]+/g);
    if (!match) return [14, 14, 14];
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }

  function fit(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!w || !h) return null;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function glyphIndex(value, row, col) {
    var threshold = (BAYER[row % 8][col % 8] + 0.5) / 64;
    var steps = GLYPHS.length - 1;
    var adjusted = value + (threshold - 0.5) / steps;
    var index = Math.round(Math.max(0, Math.min(1, adjusted)) * steps);
    return index;
  }

  function drawBurst(canvas) {
    var box = fit(canvas);
    if (!box) return;
    var cell = 9;
    var cols = Math.ceil(box.w / cell);
    var rows = Math.ceil(box.h / cell);
    var originX = box.w * 0.66;
    var originY = box.h * 0.08;
    box.ctx.font = cell + 'px "Geist Mono", ui-monospace, monospace';
    box.ctx.textBaseline = "top";
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var x = col * cell;
        var y = row * cell;
        var dx = x + cell * 0.5 - originX;
        var dy = (y + cell * 0.5 - originY) * 1.35;
        var dist = Math.sqrt(dx * dx + dy * dy) / Math.max(box.w, 1);
        var angle = Math.atan2(dy, dx);
        var spokes = Math.pow(Math.abs(Math.cos(angle * 9)), 0.42);
        var falloff = Math.pow(Math.max(0, 1 - dist * 1.25), 1.15);
        var value = spokes * falloff;
        var index = glyphIndex(value, row, col);
        if (index === 0) continue;
        var alpha = 0.18 + (index / (GLYPHS.length - 1)) * 0.62;
        box.ctx.fillStyle = "rgba(" + GREEN[0] + "," + GREEN[1] + "," + GREEN[2] + "," + alpha + ")";
        box.ctx.fillText(GLYPHS.charAt(index), x, y);
      }
    }
  }

  function drawHero(canvas) {
    var box = fit(canvas);
    if (!box) return;
    var ground = groundChannels();
    var cell = 10;
    var cols = Math.ceil(box.w / cell);
    var rows = Math.ceil(box.h / cell);
    box.ctx.font = cell + 'px "Geist Mono", ui-monospace, monospace';
    box.ctx.textBaseline = "top";
    for (var row = 0; row < rows; row++) {
      var down = rows <= 1 ? 1 : row / (rows - 1);
      for (var col = 0; col < cols; col++) {
        var index = glyphIndex(down, row, col);
        if (index === 0) continue;
        var mix = down;
        var r = Math.round(GREEN[0] + (ground[0] - GREEN[0]) * mix);
        var g = Math.round(GREEN[1] + (ground[1] - GREEN[1]) * mix);
        var b = Math.round(GREEN[2] + (ground[2] - GREEN[2]) * mix);
        box.ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + (0.2 + down * 0.8) + ")";
        box.ctx.fillText(GLYPHS.charAt(index), col * cell, row * cell);
      }
    }
  }

  function drawWordmark(canvas) {
    var box = fit(canvas);
    if (!box) return;
    var label = canvas.getAttribute("data-label") || "jamie.codes";
    var sample = document.createElement("canvas");
    var size = Math.max(56, Math.min(104, Math.round(box.h * 0.5)));
    sample.width = Math.ceil(box.w);
    sample.height = Math.ceil(box.h);
    var pen = sample.getContext("2d");
    pen.clearRect(0, 0, sample.width, sample.height);
    pen.font = '500 ' + size + 'px "Geist Mono", ui-monospace, monospace';
    pen.fillStyle = "#ffffff";
    pen.textBaseline = "middle";
    var textWidth = pen.measureText(label).width;
    pen.fillText(label, Math.max(24, (box.w - textWidth) * 0.5), box.h * 0.5);
    var pixels = pen.getImageData(0, 0, sample.width, sample.height).data;
    var step = 3;
    var px = pointer ? pointer.x : box.w * 0.42;
    var py = pointer ? pointer.y : box.h * 0.5;
    for (var y = 0; y < sample.height; y += step) {
      for (var x = 0; x < sample.width; x += step) {
        var alpha = pixels[(y * sample.width + x) * 4 + 3];
        if (alpha < 128) continue;
        var dx = x - px;
        var dy = y - py;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var influence = pointer ? Math.exp(-dist / 160) : 0;
        var shift = influence * 6;
        var ox = dist ? (-dx / dist) * shift : 0;
        var oy = dist ? (-dy / dist) * shift : 0;
        var ink = 0.42 + influence * 0.5;
        box.ctx.fillStyle = "rgba(" + GREEN[0] + "," + GREEN[1] + "," + GREEN[2] + "," + ink + ")";
        box.ctx.fillRect(x + ox, y + oy, 2.2, 2.2);
      }
    }
  }

  function draw() {
    document.querySelectorAll(".ascii-burst").forEach(drawBurst);
    document.querySelectorAll(".hero-ascii").forEach(drawHero);
    if (reduce) return;
    var footer = document.querySelector(".footer-field");
    if (footer && getComputedStyle(footer).display !== "none") drawWordmark(footer);
  }

  function track(event) {
    var footer = document.querySelector(".footer-field");
    if (!footer) return;
    var rect = footer.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (getComputedStyle(footer).display !== "none") drawWordmark(footer);
  }

  function boot() {
    draw();
    window.addEventListener("resize", draw);
    if (!reduce) window.addEventListener("pointermove", track);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(boot);
  } else {
    boot();
  }
})();
