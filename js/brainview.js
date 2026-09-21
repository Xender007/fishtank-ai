// =============================================================================
// brainview.js - drawing a brain, and reading its arithmetic.
// =============================================================================
// Draws whatever graph() hands it, so it works for a growing genome and the
// fixed layered network alike, and keeps working as the genome grows new
// neurons and new columns.
//
// THE COLOUR LANGUAGE (used consistently since the activation bars):
//   NODES        orange = firing positive, blue = firing negative,
//                pale    = near zero. Brightness tracks magnitude.
//   CONNECTIONS  green = positive weight, red = negative, THICKNESS = strength.
//                A dashed grey line is a disabled gene - still in the genome,
//                still inherited, just switched off.
//
// Identity never rests on colour alone: every node carries its name, weights
// are readable on hover, and the legend names each mark.
// =============================================================================

const BrainView = {

  nodes: [],      // laid-out copies with screen positions, for hit-testing
  edges: [],      // laid-out edges, for hover
  hover: null,    // {x, y} in canvas pixels, set by main.js
  t: 0,           // frame counter, drives the signal animation
  hoveredNode: null,
  hoveredEdge: null,
  // How boldly to draw. The fish's network has small weights and inputs that
  // sit at zero until a shark is in view, so at 1 it read as faint next to the
  // dense, busy shark graph. main.js turns the fish view up; the shark's own
  // instance keeps 1.
  emphasis: 1,

  // ---------------------------------------------------------------------------
  // LAYOUT - columns by depth.
  // ---------------------------------------------------------------------------
  // A node's depth is one more than its deepest input, so inputs land in the
  // first column and anything depending on them lands to the right. When
  // evolution grows a hidden neuron, a new column appears on its own.
  //
  // Within a column, nodes are spread evenly and the column is centred, so a
  // sparse hidden layer does not sit jammed against the top edge.
  // ---------------------------------------------------------------------------
  layout(graph, w, h) {
    const padX = 74, padTop = 14, padBottom = 34;
    const cols = Math.max(1, graph.maxDepth);
    const byDepth = new Map();

    for (const n of graph.nodes) {
      if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
      byDepth.get(n.depth).push(n);
    }

    // Inputs keep their sensor order; hidden nodes sort by id so a neuron does
    // not jump around the diagram between frames.
    for (const [, group] of byDepth) group.sort((a, b) => a.id - b.id);

    this.nodes = [];
    const pos = new Map();
    const usableH = h - padTop - padBottom;

    for (const [depth, group] of byDepth) {
      const x = cols === 0 ? w / 2 : padX + (depth / cols) * (w - padX * 2);
      const step = usableH / group.length;
      group.forEach((n, i) => {
        const y = padTop + step * (i + 0.5);
        const laid = Object.assign({}, n, { x, y });
        this.nodes.push(laid);
        pos.set(n.id, laid);
      });
    }
    return pos;
  },

  draw(ctx, brain, w, h, opts) {
    const graph = brain.graph();
    const pos = this.layout(graph, w, h);
    const reveal = opts.revealDepth;          // -1 means "show everything"
    const selected = opts.selectedId;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#081722';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';

    this.resolveHover(pos, graph);

    // --- connections, under the nodes ---
    this.edges = [];
    for (const c of graph.conns) {
      const a = pos.get(c.from), b = pos.get(c.to);
      if (!a || !b) continue;

      const pending = reveal >= 0 && b.depth > reveal;
      // When a neuron is selected we show ITS inputs at full strength and push
      // everything else back, so one neuron's working can be read out of a
      // diagram with fifty edges in it.
      const focused = selected !== null && selected !== undefined;
      const relevant = !focused || c.to === selected || c.from === selected;

      const E = this.emphasis;
      const mag = Math.min(1, Math.abs(c.w) / (2 / E));
      let alpha = pending ? 0.10 : Math.min(1, (0.26 + 0.6 * mag) * E);
      if (focused && !relevant) alpha *= 0.18;
      if (this.hoveredEdge === c) alpha = 1;

      if (!c.enabled) {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(140, 170, 190, ' + (focused && !relevant ? 0.06 : 0.24) + ')';
        ctx.lineWidth = 1;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = (c.w >= 0 ? 'rgba(96, 220, 140, ' : 'rgba(255, 110, 130, ') + alpha + ')';
        ctx.lineWidth = (0.7 * E + 3.4 * mag) * (this.hoveredEdge === c ? 1.6 : 1);
      }

      // MEMORY EDGES look different because they ARE different: they carry
      // last tick's value, not this one. A self-loop becomes a ring beside the
      // neuron; a backwards edge bows out sideways so it cannot be mistaken
      // for an ordinary forward connection running the other way.
      if (c.recurrent) {
        ctx.beginPath();
        if (c.from === c.to) {
          ctx.arc(a.x + 15, a.y, 8, 0, Math.PI * 2);
        } else {
          const bow = (a.y + b.y) / 2 - 38;
          ctx.moveTo(a.x, a.y);
          ctx.bezierCurveTo(a.x, bow, b.x, bow, b.x, b.y);
        }
        ctx.stroke();
        this.edges.push({ conn: c, ax: a.x, ay: a.y, bx: b.x, by: b.y,
                          mx: (a.x + b.x) / 2, from: a, to: b, pending, relevant });
        continue;
      }

      const mx = (a.x + b.x) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y);
      ctx.stroke();

      this.edges.push({ conn: c, ax: a.x, ay: a.y, bx: b.x, by: b.y, mx,
                        from: a, to: b, pending, relevant });
    }
    ctx.setLineDash([]);

    // Signal beads and the breathing halo are motion for its own sake once
    // the reader has asked for less of it; the diagram itself still reads.
    const still = typeof REDUCED_MOTION !== 'undefined' && REDUCED_MOTION;
    if (!still) { this.t++; this.pulses(ctx, selected); }
    this.drawNodes(ctx, reveal, selected);
    this.legend(ctx, w, h);
    this.tooltip(ctx, w, h);
  },
  // --- nodes -----------------------------------------------------------------
  drawNodes(ctx, reveal, selected) {
    for (const n of this.nodes) {
      const pending = reveal >= 0 && n.depth > reveal;
      const v = pending ? 0 : n.value;
      const mag = Math.min(1, Math.abs(v));
      const r = n.type === 2 ? 8.5 : 10;

      // A halo that grows and breathes with the activation. Zero-firing
      // neurons get none at all, so the handful doing the work stand out of a
      // diagram where every node is otherwise the same size.
      if (!pending && mag > 0.06) {
        const breathe = 0.85 + 0.15 * Math.sin(this.t * 0.06 + n.id);
        const halo = ctx.createRadialGradient(n.x, n.y, r * 0.6,
                                              n.x, n.y, r + 9 * mag * breathe);
        const tint = v >= 0 ? '255, 157, 77' : '77, 166, 255';
        halo.addColorStop(0, 'rgba(' + tint + ', ' + (0.35 * mag) + ')');
        halo.addColorStop(1, 'rgba(' + tint + ', 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 9 * mag * breathe, 0, Math.PI * 2);
        ctx.fill();
      }

      if (pending) {
        ctx.fillStyle = 'rgba(30, 55, 72, 0.9)';
      } else if (v >= 0) {
        ctx.fillStyle = 'rgba(255, 157, 77, ' + (0.14 + 0.86 * mag) + ')';
      } else {
        ctx.fillStyle = 'rgba(77, 166, 255, ' + (0.14 + 0.86 * mag) + ')';
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();

      const isSel = n.id === selected;
      const isHov = this.hoveredNode && this.hoveredNode.id === n.id;
      ctx.lineWidth = isSel ? 2.2 : isHov ? 1.8 : 1;
      ctx.strokeStyle = isSel ? '#ffffff' : isHov ? 'rgba(190, 220, 235, 0.9)'
                                                  : 'rgba(159, 196, 214, ' + Math.min(0.9, 0.4 * this.emphasis) + ')';
      ctx.stroke();

      // Inputs are labelled on the left with their live value, outputs on the
      // right. Hidden neurons carry their id inside. Nothing is identified by
      // colour alone.
      if (n.type === 0) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(190, 220, 235, 0.85)';
        ctx.fillText(n.name, n.x - r - 5, n.y - 4);
        ctx.fillStyle = 'rgba(190, 220, 235, 0.5)';
        ctx.fillText(v.toFixed(2), n.x - r - 5, n.y + 6);
      } else if (n.type === 1) {
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(190, 220, 235, 0.85)';
        ctx.fillText(n.name, n.x + r + 5, n.y - 4);
        ctx.fillStyle = 'rgba(190, 220, 235, 0.5)';
        ctx.fillText(v.toFixed(2), n.x + r + 5, n.y + 6);
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(8, 23, 34, 0.85)';
        ctx.fillText(String(n.id), n.x, n.y);
      }
    }
  },

  // --- legend ----------------------------------------------------------------
  legend(ctx, w, h) {
    const y = h - 16;
    let x = 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const swatch = (colour, label, dashed) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = dashed ? 1 : 2.4;
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 14, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(159, 196, 214, 0.75)';
      ctx.fillText(label, x + 18, y);
      x += 22 + ctx.measureText(label).width;
    };

    const dot = (colour, label) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x + 5, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(159, 196, 214, 0.75)';
      ctx.fillText(label, x + 14, y);
      x += 18 + ctx.measureText(label).width;
    };

    dot('rgba(255, 157, 77, 0.95)', '+firing');
    dot('rgba(77, 166, 255, 0.95)', '−firing');
    swatch('rgba(96, 220, 140, 0.9)', '+weight', false);
    swatch('rgba(255, 110, 130, 0.9)', '−weight', false);
    swatch('rgba(140, 170, 190, 0.5)', 'off', true);
    ctx.strokeStyle = 'rgba(190, 220, 235, 0.75)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + 6, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159, 196, 214, 0.75)';
    ctx.fillText('memory', x + 16, y);
  },

  // --- hover -----------------------------------------------------------------
  resolveHover(pos, graph) {
    this.hoveredNode = null;
    this.hoveredEdge = null;
    if (!this.hover) return;

    const { x, y } = this.hover;
    for (const n of this.nodes) {
      const dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy <= 14 * 14) { this.hoveredNode = n; return; }
    }

    // Edges are thin, so the hit test samples along the curve rather than
    // asking for a pixel-perfect hit nobody could land.
    let best = null, bestD = 7;
    for (const e of this.edges) {
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t;
        const px = u*u*u*e.ax + 3*u*u*t*e.mx + 3*u*t*t*e.mx + t*t*t*e.bx;
        const py = u*u*u*e.ay + 3*u*u*t*e.ay + 3*u*t*t*e.by + t*t*t*e.by;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) { bestD = d; best = e.conn; }
      }
    }
    this.hoveredEdge = best;
  },

  tooltip(ctx, w, h) {
    if (!this.hover) return;
    let lines = null;

    if (this.hoveredNode) {
      const n = this.hoveredNode;
      lines = [n.name,
               'firing ' + (n.value >= 0 ? '+' : '') + n.value.toFixed(3),
               n.type === 0 ? 'input sensor' : 'bias ' + (n.bias >= 0 ? '+' : '') + n.bias.toFixed(3)];
    } else if (this.hoveredEdge) {
      const c = this.hoveredEdge;
      // The shark's brain names its own nodes; the fish genome's are global.
      lines = [(c.fromName || Genome.nodeName(c.from)) + ' → ' + (c.toName || Genome.nodeName(c.to)),
               'weight ' + (c.w >= 0 ? '+' : '') + c.w.toFixed(3),
               (c.recurrent ? 'MEMORY - reads last tick' :
                 (c.enabled ? 'enabled' : 'disabled gene'))];
    }
    if (!lines) return;

    ctx.font = '9px ui-monospace, Consolas, monospace';
    let width = 0;
    for (const l of lines) width = Math.max(width, ctx.measureText(l).width);
    const bw = width + 16, bh = lines.length * 13 + 8;
    let bx = this.hover.x + 12, by = this.hover.y + 10;
    if (bx + bw > w - 4) bx = this.hover.x - 12 - bw;
    if (by + bh > h - 4) by = h - 4 - bh;

    ctx.fillStyle = 'rgba(4, 18, 28, 0.95)';
    ctx.strokeStyle = 'rgba(96, 186, 222, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(190, 220, 235, 0.8)';
      ctx.fillText(l, bx + 8, by + 11 + i * 13);
    });
  },

  // Which node did the user click? Returns an id, or null.
  hitTest(x, y) {
    for (const n of this.nodes) {
      const dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy <= 14 * 14) return n.id;
    }
    return null;
  },
  // ---------------------------------------------------------------------------
  // TERMS - the arithmetic behind one neuron, with this tick's real numbers.
  // ---------------------------------------------------------------------------
  // Every incoming connection contributes (source value x weight). Add the
  // bias, squash with tanh, done. There is nothing else in there.
  // ---------------------------------------------------------------------------
  terms(brain, nodeId) {
    const graph = brain.graph();
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node || node.type === 0) return null;

    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const rows = [];
    let sum = node.bias;

    for (const c of graph.conns) {
      if (c.to !== nodeId || !c.enabled) continue;
      const src = byId.get(c.from);
      if (!src) continue;
      // A memory edge delivers what its source held LAST tick.
      const value = c.recurrent && src.prevValue !== undefined ? src.prevValue : src.value;
      const product = value * c.w;
      sum += product;
      rows.push({ name: src.name + (c.recurrent ? ' (last tick)' : ''),
                  value, weight: c.w, product });
    }

    // Largest contributions first, so whatever is actually driving this neuron
    // is at the top rather than buried among near-zero terms.
    rows.sort((a, b) => Math.abs(b.product) - Math.abs(a.product));
    return { name: node.name, rows, bias: node.bias, sum, out: Math.tanh(sum) };
  },
  // ---------------------------------------------------------------------------
  // SIGNAL PULSES - the forward pass, animated.
  // ---------------------------------------------------------------------------
  // Beads travel each connection from source to target. This is not ornament:
  //
  //   - direction shows which way information actually flows, which a static
  //     diagram of curves cannot,
  //   - a bead's BRIGHTNESS is the source neuron's activation times the weight,
  //     so a fat connection carrying nothing stays dark while a thin one
  //     carrying a strong signal lights up. That is the distinction between
  //     capacity and use, and it is the thing people most often get wrong when
  //     reading a network diagram,
  //   - speed follows |weight|, so the strongest paths visibly dominate.
  //
  // Dead connections produce no beads at all, which makes a half-used brain
  // obvious at a glance.
  // ---------------------------------------------------------------------------
  pulses(ctx, selected) {
    const focused = selected !== null && selected !== undefined;

    for (const e of this.edges) {
      const c = e.conn;
      if (!c.enabled || e.pending || c.recurrent) continue;

      // What is actually travelling this wire right now.
      const carried = Math.abs(e.from.value * c.w);
      if (carried < 0.02 / this.emphasis) continue;

      const mag = Math.min(1, Math.abs(c.w) / 2);
      const strength = Math.min(1, carried);
      let alpha = 0.25 + 0.75 * strength;
      if (focused && !e.relevant) alpha *= 0.15;

      // Phase is seeded from the connection's own endpoints, so beads on
      // different wires do not march in lockstep.
      const seed = (c.from * 31 + c.to * 17) % 100 / 100;
      const speed = 0.006 + 0.014 * mag;
      const beads = carried > 0.5 ? 3 : 2;

      for (let k = 0; k < beads; k++) {
        let u = (this.t * speed + seed + k / beads) % 1;

        // Cubic bezier with both controls at the midpoint x - the same curve
        // the edge itself was drawn with, so a bead never leaves its wire.
        const v = 1 - u;
        const x = v*v*v*e.ax + 3*v*v*u*e.mx + 3*v*u*u*e.mx + u*u*u*e.bx;
        const y = v*v*v*e.ay + 3*v*v*u*e.ay + 3*v*u*u*e.by + u*u*u*e.by;

        // Fade in and out at the ends so beads emerge from the source neuron
        // and are absorbed by the target rather than blinking in mid-air.
        const ends = Math.min(1, Math.min(u, 1 - u) * 6);

        ctx.fillStyle = (c.w >= 0 ? 'rgba(150, 255, 200, ' : 'rgba(255, 170, 185, ')
                        + (alpha * ends) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + 1.5 * strength, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
