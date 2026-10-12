const state = {
  method: "contiguous",
  blocks: [],          // each entry: null (free) or the owning file name
  files: new Map(),    // name -> { color, blocks, indexBlock, next, detail }
  hue: 0,
};

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- helpers ---------- */

function freeList() {
  const free = [];
  state.blocks.forEach((owner, i) => { if (owner === null) free.push(i); });
  return free;
}

function largestFreeRun() {
  let best = 0, run = 0;
  for (const owner of state.blocks) {
    run = owner === null ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function say(text, type) {
  const el = $("message");
  el.textContent = text;
  el.className = type || "";
}

/* ---------- allocation methods ---------- */
/* Each returns { blocks, indexBlock?, next?, detail } or { error } */

function allocateContiguous(size) {
  let start = -1, len = 0;
  for (let i = 0; i < state.blocks.length; i++) {
    if (state.blocks[i] === null) {
      if (len === 0) start = i;
      len++;
      if (len === size) {
        const blocks = Array.from({ length: size }, (_, k) => start + k);
        return { blocks, detail: `start = ${start}, length = ${size}` };
      }
    } else {
      len = 0;
    }
  }
  return {
    error: freeList().length < size
      ? "Not enough free blocks."
      : `No contiguous run of ${size} blocks (external fragmentation).`,
  };
}

function allocateLinked(size) {
  const free = freeList();
  if (free.length < size) return { error: "Not enough free blocks." };
  const blocks = free.slice(0, size);
  const next = {};
  blocks.forEach((b, i) => { next[b] = i + 1 < size ? blocks[i + 1] : null; });
  return { blocks, next, detail: blocks.join(" → ") + " → NULL" };
}

function allocateIndexed(size) {
  const free = freeList();
  if (free.length < size + 1) {
    return {
      error: `Need ${size + 1} blocks (${size} data + 1 index), only ${free.length} free.`,
    };
  }
  const indexBlock = free[0];
  const data = free.slice(1, size + 1);
  return {
    blocks: [indexBlock, ...data],
    indexBlock,
    detail: `index block ${indexBlock} → [${data.join(", ")}]`,
  };
}

const allocators = {
  contiguous: allocateContiguous,
  linked: allocateLinked,
  indexed: allocateIndexed,
};

/* ---------- actions ---------- */

function resetDisk() {
  const n = Math.min(128, Math.max(8, parseInt($("blocks").value, 10) || 32));
  $("blocks").value = n;
  state.method = $("method").value;
  state.blocks = Array(n).fill(null);
  state.files.clear();
  state.hue = 0;
  say(`Disk reset (${n} blocks). Using ${state.method} allocation.`, "ok");
  render();
}

function createFile() {
  const name = $("fname").value.trim();
  const size = parseInt($("fsize").value, 10);

  if (!name) return say("Enter a file name.", "error");
  if (state.files.has(name)) return say(`'${name}' already exists.`, "error");
  if (!Number.isInteger(size) || size < 1) {
    return say("Size must be a positive whole number.", "error");
  }

  const result = allocators[state.method](size);
  if (result.error) return say(`Failed to create '${name}': ${result.error}`, "error");

  const color = `hsl(${state.hue}, 62%, 45%)`;
  state.hue = (state.hue + 47) % 360;
  result.blocks.forEach((b) => { state.blocks[b] = name; });
  state.files.set(name, { color, ...result });

  $("fname").value = "";
  say(`Created '${name}'.`, "ok");
  render();
}

function deleteFile(name) {
  const file = state.files.get(name);
  if (!file) return;
  file.blocks.forEach((b) => { state.blocks[b] = null; });
  state.files.delete(name);
  say(`Deleted '${name}'.`, "ok");
  render();
}

/* ---------- rendering ---------- */

function render() {
  renderDisk();
  renderDiagrams();
  renderFiles();
  renderStats();
}

function renderDisk() {
  const disk = $("disk");
  disk.replaceChildren();

  state.blocks.forEach((owner, i) => {
    const cell = document.createElement("div");
    cell.className = "block";

    const num = document.createElement("span");
    num.textContent = i;
    cell.appendChild(num);

    if (owner === null) {
      cell.title = `Block ${i}: free`;
    } else {
      const file = state.files.get(owner);
      cell.classList.add("used");
      cell.style.background = file.color;
      let tip = `Block ${i}: ${owner}`;

      const sub = document.createElement("small");
      if (file.indexBlock === i) {
        cell.classList.add("index");
        sub.textContent = "INDEX";
        tip += " (index block)";
      } else if (file.next && file.next[i] !== undefined) {
        sub.textContent = file.next[i] === null ? "→ NULL" : `→ ${file.next[i]}`;
        tip += file.next[i] === null ? " → NULL" : ` → ${file.next[i]}`;
      } else {
        sub.textContent = owner.length > 6 ? owner.slice(0, 5) + "…" : owner;
      }
      cell.appendChild(sub);
      cell.title = tip;
    }
    disk.appendChild(cell);
  });

  const legend = $("legend");
  legend.replaceChildren();
  state.files.forEach((file, name) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = file.color;
    chip.append(sw, name);
    legend.appendChild(chip);
  });
}

/* ---------- file diagrams (SVG) ---------- */

let svgCounter = 0;

function svgBox(x, y, w, h, label, fill, o = {}) {
  const stroke = o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw || 1.5}"` : "";
  const dash = o.dash ? 'stroke-dasharray="4 3"' : "";
  const textFill = o.text || "#fff";
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" ${stroke} ${dash}/>` +
    `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" ` +
    `fill="${textFill}" font-size="13" font-weight="600">${label}</text>`
  );
}

function diagramContiguous(file) {
  const bw = 40, bh = 36, gap = 4, perRow = 16, pad = 8;
  const n = file.blocks.length;
  const cols = Math.min(perRow, n);
  const rows = Math.ceil(n / perRow);
  const W = pad * 2 + cols * bw + (cols - 1) * gap;
  const H = pad * 2 + rows * bh + (rows - 1) * gap;

  let body = "";
  file.blocks.forEach((b, i) => {
    const x = pad + (i % perRow) * (bw + gap);
    const y = pad + Math.floor(i / perRow) * (bh + gap);
    body += svgBox(x, y, bw, bh, b, file.color);
  });
  return { W, H, body, defs: "" };
}

function diagramLinked(file, id) {
  const bw = 46, bh = 38, gx = 34, gy = 46, perRow = 8, pad = 10, top = 20;
  const n = file.blocks.length;
  const total = n + 1; // the extra node is NULL
  const cols = Math.min(perRow, total);
  const rows = Math.ceil(total / perRow);
  const W = pad * 2 + cols * bw + (cols - 1) * gx;
  const H = top + rows * bh + (rows - 1) * gy + pad;

  const pos = (i) => ({
    x: pad + (i % perRow) * (bw + gx),
    y: top + Math.floor(i / perRow) * (bh + gy),
  });

  const defs =
    `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

  let body = "";
  const p0 = pos(0);
  body += `<text x="${p0.x + bw / 2}" y="${p0.y - 7}" text-anchor="middle" ` +
          `fill="currentColor" font-size="11" opacity="0.7">start</text>`;

  for (let i = 0; i < total; i++) {
    const p = pos(i);
    if (i < n) {
      body += svgBox(p.x, p.y, bw, bh, file.blocks[i], file.color);
    } else {
      body += svgBox(p.x, p.y, bw, bh, "NULL", "none",
        { stroke: "currentColor", dash: true, text: "currentColor", sw: 1.2 });
    }
    if (i < total - 1) {
      const q = pos(i + 1);
      if (q.y === p.y) {
        body += `<line x1="${p.x + bw + 2}" y1="${p.y + bh / 2}" x2="${q.x - 3}" y2="${q.y + bh / 2}" ` +
                `stroke="currentColor" stroke-width="1.6" marker-end="url(#${id})"/>`;
      } else {
        const midY = p.y + bh + gy / 2;
        body += `<path d="M${p.x + bw / 2},${p.y + bh + 2} L${p.x + bw / 2},${midY} ` +
                `L${q.x + bw / 2},${midY} L${q.x + bw / 2},${q.y - 3}" fill="none" ` +
                `stroke="currentColor" stroke-width="1.6" marker-end="url(#${id})"/>`;
      }
    }
  }
  return { W, H, body, defs };
}

function diagramIndexed(file, id) {
  const bw = 46, bh = 38, gx = 14, pad = 10, top = 10, drop = 62, idxW = 150;
  const data = file.blocks.filter((b) => b !== file.indexBlock);
  const n = data.length;
  const rowW = n * bw + (n - 1) * gx;
  const W = Math.max(rowW, idxW) + pad * 2;
  const H = top + bh + drop + bh + pad;
  const startX = (W - rowW) / 2;
  const dataY = top + bh + drop;

  const defs =
    `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

  let body = "";
  data.forEach((b, i) => {
    const x = startX + i * (bw + gx);
    body += `<line x1="${W / 2}" y1="${top + bh}" x2="${x + bw / 2}" y2="${dataY - 3}" ` +
            `stroke="currentColor" stroke-width="1.4" opacity="0.75" marker-end="url(#${id})"/>`;
  });
  body += svgBox(W / 2 - idxW / 2, top, idxW, bh, `Index block ${file.indexBlock}`,
                 file.color, { stroke: "currentColor", sw: 2.5 });
  data.forEach((b, i) => {
    body += svgBox(startX + i * (bw + gx), dataY, bw, bh, b, file.color);
  });
  return { W, H, body, defs };
}

function renderDiagrams() {
  const box = $("diagrams");
  box.replaceChildren();

  if (state.files.size === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Create a file to see its allocation diagram.";
    box.appendChild(p);
    return;
  }

  state.files.forEach((file, name) => {
    const id = `arrow${++svgCounter}`;
    let d;
    if (file.indexBlock !== undefined) d = diagramIndexed(file, id);
    else if (file.next) d = diagramLinked(file, id);
    else d = diagramContiguous(file);

    const card = document.createElement("div");
    card.className = "diagram";
    card.innerHTML =
      `<h3>${esc(name)} <span>· ${esc(state.method)} allocation</span></h3>` +
      `<svg viewBox="0 0 ${d.W} ${d.H}" width="${d.W}" xmlns="http://www.w3.org/2000/svg" ` +
      `role="img" aria-label="Allocation diagram for ${esc(name)}">${d.defs}${d.body}</svg>` +
      `<p class="caption">${esc(file.detail)}</p>`;
    box.appendChild(card);
  });
}

/* ---------- files table & stats ---------- */

function renderFiles() {
  const body = $("files");
  body.replaceChildren();

  if (state.files.size === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = "No files yet. Create one above.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  state.files.forEach((file, name) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = name;

    const sizeTd = document.createElement("td");
    sizeTd.textContent = file.blocks.length;

    const locTd = document.createElement("td");
    locTd.className = "loc";
    locTd.textContent = file.detail;

    const actTd = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteFile(name));
    actTd.appendChild(del);

    tr.append(nameTd, sizeTd, locTd, actTd);
    body.appendChild(tr);
  });
}

function renderStats() {
  const free = freeList().length;
  const total = state.blocks.length;
  const run = largestFreeRun();
  let text = `Free: ${free}/${total} blocks · Largest contiguous free run: ${run}`;
  if (free > 0 && run < free) {
    text += " · External fragmentation present (free space is scattered).";
  }
  $("stats").textContent = text;
}

/* ---------- events ---------- */

$("create").addEventListener("click", createFile);
$("reset").addEventListener("click", resetDisk);
$("method").addEventListener("change", resetDisk);
$("fname").addEventListener("keydown", (e) => { if (e.key === "Enter") createFile(); });
$("fsize").addEventListener("keydown", (e) => { if (e.key === "Enter") createFile(); });

resetDisk();