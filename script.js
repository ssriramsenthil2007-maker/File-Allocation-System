const state = {
  method: "contiguous",
  blocks: [],          // each entry: null (free) or the owning file name
  files: new Map(),    // name -> { color, blocks, indexBlock, next, detail }
  hue: 0,
};

const $ = (id) => document.getElementById(id);

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
  renderFiles();
  renderStats();
}

function renderDisk() {
  const disk = $("disk");
  disk.replaceChildren();

  state.blocks.forEach((owner, i) => {
    const cell = document.createElement("div");
    cell.className = "block";
    cell.textContent = i;

    if (owner === null) {
      cell.title = `Block ${i}: free`;
    } else {
      const file = state.files.get(owner);
      cell.classList.add("used");
      cell.style.background = file.color;
      let tip = `Block ${i}: ${owner}`;
      if (file.indexBlock === i) {
        cell.classList.add("index");
        tip += " (index block)";
      }
      if (file.next && file.next[i] !== undefined) {
        tip += file.next[i] === null ? " → NULL" : ` → ${file.next[i]}`;
      }
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