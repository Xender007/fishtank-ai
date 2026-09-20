// =============================================================================
// chart.js - fitness and brain size over generations.
// =============================================================================
// TWO PANELS, NOT TWO Y-AXES.
//
// This used to plot survival seconds and parameter count on one set of axes
// with two different scales. That is the most common serious mistake in charting:
// a dual-axis plot lets you slide one series against the other until they appear
// to agree, and the reader cannot tell a real relationship from an artefact of
// where you happened to put the zero. Two measures of different units get two
// panels sharing one x-axis. Comparisons stay honest and nothing is implied that
// the data does not say.
//
// Colours are validated, not chosen by eye: aqua #199e70 and orange #d95926
// clear the colour-blind separation, lightness-band and contrast checks against
// this surface. Both lines are also labelled directly at their right-hand end,
// so identity never depends on colour alone.
// =============================================================================

const Chart = {

  SERIES: {
    mean:   { colour: '#199e70', label: 'mean' },
    best:   { colour: '#d95926', label: 'best' },
    params: { colour: '#9085e9', label: 'parameters' },
  },

  // Set by main.js when the pointer is over the chart; null otherwise.
  hover: null,

  // Where each panel sits, filled in by draw() so hit-testing can reuse it.
  geom: null,

  draw(ctx, world, w, h) {
    const pad = { l: 40, r: 64, t: 24, b: 20 };
    const gap = 26;
    const plotW = w - pad.l - pad.r;
    const panelH = (h - pad.t - pad.b - gap) * 0.62;
    const lowerH = (h - pad.t - pad.b - gap) - panelH;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a1a26';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';

    const hist = world.history;
    if (!hist.length) {
      ctx.fillStyle = 'rgba(159, 196, 214, 0.5)';
      ctx.textAlign = 'center';
      ctx.fillText('generation 1 in progress \u2014 the first scores land when it ends',
                   w / 2, h / 2);
      this.geom = null;
      return;
    }

    const span = Math.max(1, hist.length - 1);
    const xAt = i => pad.l + (i / span) * plotW;

    const upper = { y: pad.t, h: panelH };
    const lower = { y: pad.t + panelH + gap, h: lowerH };
    this.geom = { pad, plotW, span, xAt, upper, lower, count: hist.length };

    // ---- panel 1: survival ----
    const maxY = CONFIG.sim.generationSeconds;
    this.panel(ctx, w, pad, upper, maxY, 3, v => v.toFixed(0) + 's', 'survival');
    this.series(ctx, hist, 'mean', xAt, upper, maxY, 2.2);
    this.series(ctx, hist, 'best', xAt, upper, maxY, 1.6);
    this.endLabel(ctx, hist, 'best', xAt, upper, maxY, w - pad.r, v => v.toFixed(0) + 's');
    this.endLabel(ctx, hist, 'mean', xAt, upper, maxY, w - pad.r, v => v.toFixed(0) + 's');

    // ---- panel 2: brain size ----
    let maxP = 1;
    for (const row of hist) if (row.params > maxP) maxP = row.params;
    maxP = Math.ceil(maxP * 1.15);
    this.panel(ctx, w, pad, lower, maxP, 2, v => v.toFixed(0), 'brain size');
    this.series(ctx, hist, 'params', xAt, lower, maxP, 2);
    this.endLabel(ctx, hist, 'params', xAt, lower, maxP, w - pad.r, v => v.toFixed(0));

    // ---- x axis ----
    ctx.fillStyle = 'rgba(159, 196, 214, 0.55)';
    ctx.textAlign = 'left';
    ctx.fillText('gen ' + hist[0].generation, pad.l, h - pad.b / 2);
    if (hist.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText('gen ' + hist[hist.length - 1].generation, w - pad.r, h - pad.b / 2);
    }

    if (this.hover !== null) this.crosshair(ctx, world, w, h, pad);
  },

  // One panel's frame: title, horizontal grid, value labels.
  panel(ctx, w, pad, box, maxY, steps, fmt, title) {
    ctx.fillStyle = 'rgba(159, 196, 214, 0.75)';
    ctx.textAlign = 'left';
    ctx.fillText(title, pad.l, box.y - 9);

    ctx.strokeStyle = 'rgba(96, 186, 222, 0.12)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(159, 196, 214, 0.5)';
    for (let i = 0; i <= steps; i++) {
      const v = (maxY / steps) * i;
      const y = box.y + box.h - (v / maxY) * box.h;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmt(v), pad.l - 6, y);
    }
  },

  series(ctx, hist, key, xAt, box, maxY, width) {
    const s = this.SERIES[key];
    ctx.strokeStyle = s.colour;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    hist.forEach((row, i) => {
      const x = xAt(i);
      const y = box.y + box.h - (Math.min(row[key], maxY) / maxY) * box.h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  },

  // A label at the line's right-hand end. This is the secondary encoding that
  // means identity never rests on colour alone.
  endLabel(ctx, hist, key, xAt, box, maxY, x, fmt) {
    const s = this.SERIES[key];
    const row = hist[hist.length - 1];
    const y = box.y + box.h - (Math.min(row[key], maxY) / maxY) * box.h;

    ctx.fillStyle = s.colour;
    ctx.beginPath();
    ctx.arc(xAt(hist.length - 1), y, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillText(s.label + ' ' + fmt(row[key]), x + 6, y);
  },
  // ---------------------------------------------------------------------------
  // HOVER - a crosshair across BOTH panels plus one tooltip.
  // ---------------------------------------------------------------------------
  // An HTML chart is interactive by nature, so it ships with a read-out rather
  // than making people estimate values off a grid line. One crosshair spanning
  // both panels is what makes the shared x-axis do its job: you can see what the
  // brain size was at the generation where survival jumped.
  // ---------------------------------------------------------------------------
  crosshair(ctx, world, w, h, pad) {
    const g = this.geom;
    if (!g) return;

    const i = this.indexAt(this.hover);
    if (i === null) return;
    const row = world.history[i];
    const x = g.xAt(i);

    ctx.strokeStyle = 'rgba(190, 220, 235, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, g.upper.y);
    ctx.lineTo(x, g.lower.y + g.lower.h);
    ctx.stroke();
    ctx.setLineDash([]);

    const lines = [
      ['gen ' + row.generation, 'rgba(190, 220, 235, 0.9)'],
      ['mean   ' + row.mean.toFixed(1) + 's', this.SERIES.mean.colour],
      ['best   ' + row.best.toFixed(1) + 's', this.SERIES.best.colour],
      ['params ' + row.params.toFixed(1), this.SERIES.params.colour],
    ];

    const boxW = 104, boxH = lines.length * 14 + 8;
    // Flip to the other side near the right edge so the tooltip never leaves
    // the canvas.
    let bx = x + 10;
    if (bx + boxW > w - 4) bx = x - 10 - boxW;
    const by = g.upper.y + 4;

    ctx.fillStyle = 'rgba(4, 18, 28, 0.92)';
    ctx.strokeStyle = 'rgba(96, 186, 222, 0.35)';
    ctx.beginPath();
    ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    lines.forEach(([text, colour], n) => {
      ctx.fillStyle = colour;
      ctx.fillText(text, bx + 8, by + 12 + n * 14);
    });
  },

  // Nearest generation to a canvas x position, or null if outside the plot.
  indexAt(px) {
    const g = this.geom;
    if (!g || px === null) return null;
    const t = (px - g.pad.l) / g.plotW;
    if (t < -0.02 || t > 1.02) return null;
    return Math.max(0, Math.min(g.count - 1, Math.round(t * g.span)));
  },
};
