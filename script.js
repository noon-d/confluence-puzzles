/*****************************************************************
 * Confluence — script.js (JSON-driven)
 *
 * Loads puzzle data from a JSON file, then runs the full Confluence
 * pairwise-merge game logic for ANY number of groups (G) and ANY
 * group size (N). (Group sizes may vary by group.)
 *
 * Expected JSON shape (example):
 * {
 *   "author": {"name":"...","url":"...","discordId":"..."},
 *   "puzzleName":"Confluence Sample 6x6",
 *   "description":"...",
 *   "groups":[ {"name":"Group A","items":["a","b"]}, ... ]
 * }
 *
 * Default file: puzzle.json
 * Override via query string: ?p=somefile.json
 *****************************************************************/

// ---------- Config ----------
const DEFAULT_PUZZLE_PATH = "puzzle.json";

// ---------- DOM ----------
const gridEl = document.getElementById("grid");
const completeCountEl = document.getElementById("completeCount");
const scoreCountEl = document.getElementById("scoreCount");
const resetBtn = document.getElementById("resetBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const sortBtn = document.getElementById("sortBtn");
const hintBtn = document.getElementById("hintBtn");
const flashBad = document.getElementById("flashBad");
const flashGood = document.getElementById("flashGood");
const tooltip = document.getElementById("tooltip");

const lightBtn = document.getElementById("lightBtn");
const fontBtn = document.getElementById("fontBtn");

// ---------- Toggles (light mode / font cycle) ----------
(function initToggles() {
  const body = document.body;

  // Restore saved prefs before first render
  if (localStorage.getItem("confluence-light") === "1") body.classList.add("light");

  function syncToggleBtns() {
    if (lightBtn) lightBtn.style.opacity = body.classList.contains("light") ? "1" : "0.55";
  }

  lightBtn?.addEventListener("click", () => {
    body.classList.toggle("light");
    localStorage.setItem("confluence-light", body.classList.contains("light") ? "1" : "0");
    syncToggleBtns();
  });

  syncToggleBtns();

  // Font cycling
	const FONTS = [
	  { name: "System",              stack: "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif", size: "12px", weight: "400" },
	  { name: "Mono",			     stack: '"Share Tech Mono",monospace', size: "14px", weight: "700" },/*
  	  { name: "DM Serif Display",    stack: '"DM Serif Display",serif', size: "16px" },
	  { name: "Playfair Display",    stack: '"Playfair Display",serif', size: "16px" },
	  { name: "Bebas Neue",          stack: '"Bebas Neue",sans-serif', size: "18px" },
	  { name: "Josefin Sans",        stack: '"Josefin Sans",sans-serif', size: "20px" },
	  { name: "Caveat",              stack: '"Caveat",cursive', size: "22px" },
	  { name: "Indie Flower",        stack: '"Indie Flower",cursive', size: "24x" },
	  { name: "Permanent Marker",    stack: '"Permanent Marker",cursive', size: "30px" },*/
	];

  let fontIdx = parseInt(localStorage.getItem("confluence-font") || "0", 10);
  if (isNaN(fontIdx) || fontIdx < 0 || fontIdx >= FONTS.length) fontIdx = 0;

  function applyFont() {
    document.documentElement.style.setProperty("--tile-family", FONTS[fontIdx].stack);
	document.documentElement.style.setProperty("--tile-font", FONTS[fontIdx].size || "12.5px");
	document.documentElement.style.setProperty("--tile-weight", FONTS[fontIdx].weight || "normal");

    if (fontBtn) fontBtn.textContent = fontIdx === 0 ? "A" : FONTS[fontIdx].name.split(" ")[0];
    if (fontBtn) fontBtn.title = FONTS[fontIdx].name;
  }

  applyFont();

  fontBtn?.addEventListener("click", () => {
    fontIdx = (fontIdx + 1) % FONTS.length;
    localStorage.setItem("confluence-font", String(fontIdx));
    applyFont();
  });
})();

// Optional header elements (if you add them later)
const titleEl =
  document.getElementById("puzzleTitle") ||
  document.querySelector("header .title h1") ||
  null;
const descEl =
  document.getElementById("puzzleDescription") ||
  document.querySelector("header .title .sub") ||
  null;

// ---------- Utilities ----------
function randInt(n) {
  return Math.floor(Math.random() * n);
}
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function flash(el) {
  if (!el) return;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 160);
}
function computeCols(total) {
  const plain = Math.max(1, Math.round(Math.sqrt(total)));
  const biased = Math.max(1, Math.floor(Math.sqrt(total * 0.85)));
  return Math.max(4, Math.min(plain, biased + 1));
}
function getPuzzlePathFromQuery() {
  const qs = new URLSearchParams(window.location.search);
  return qs.get("p") || DEFAULT_PUZZLE_PATH;
}
async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load puzzle JSON: ${path} (${res.status})`);
  return res.json();
}
function normalizePuzzleJson(puzzle) {
  if (!puzzle || typeof puzzle !== "object") throw new Error("Puzzle JSON is not an object.");
  if (!Array.isArray(puzzle.groups) || puzzle.groups.length === 0) throw new Error("Puzzle JSON has no groups[]");

  const groups = puzzle.groups.map((g, idx) => {
    const name = String(g?.name ?? `Group ${idx + 1}`);
    const items = Array.isArray(g?.items) ? g.items.map(String) : [];
    if (items.length === 0) throw new Error(`Group "${name}" has no items.`);
    return { name, items };
  });

  // Basic duplicate check (case-sensitive). If you want case-insensitive, change key to lowercased.
  const seen = new Set();
  for (const g of groups) {
    for (const item of g.items) {
      if (seen.has(item)) {
        // Allow duplicates if you want; for Confluence, duplicates are usually bad.
        throw new Error(`Duplicate item across puzzle: "${item}"`);
      }
      seen.add(item);
    }
  }

  return {
    author: puzzle.author ?? null,
    puzzleName: puzzle.puzzleName ?? "Confluence",
    description: puzzle.description ?? "",
    groups
  };
}

// ---------- Game state ----------
let GROUPS = []; // normalized groups from JSON
let tiles = [];
let selectedIds = [];
let errors = 0;
let mergedOps = 0;
let score = 0;
let hintMergeActive = false; // flag so hint merges don't award points
let nextTileId = 1;
let gameSolved = false;

function totalItemsCount() {
  return GROUPS.reduce((acc, g) => acc + g.items.length, 0);
}

// Total merges needed to fully solve = (total items) - (number of groups)
// e.g. 8 groups of 8 = 64 items - 8 groups = 56 merges
function totalMergesNeeded() {
  return totalItemsCount() - GROUPS.length;
}

function neededFor(tile) {
  return GROUPS[tile.groupId]?.items.length ?? Infinity;
}

function isComplete(tile) {
  return tile.items.length === neededFor(tile);
}

function compressLabel(items) {
  if (items.length <= 2) return items.join(", ");
  const firstTwo = items.slice(0, 2).join(", ");
  return `${firstTwo} +${items.length - 2}`;
}

function tileSortKey(tile) {
  const needed = neededFor(tile);

  if (tile.items.length === needed) {
    return (GROUPS[tile.groupId]?.name ?? `Group ${tile.groupId + 1}`).toLowerCase();
  }
  if (tile.items.length === 1) return String(tile.items[0]).toLowerCase();
  return compressLabel(tile.items).toLowerCase();
}

// ---------- Tooltip ----------
function showTooltip(evt, tile) {
  if (!tooltip) return;

  const needed = neededFor(tile);
  const fullList = tile.items.join(", ");

  tooltip.innerHTML = `
    <div><span class="muted">${tile.items.length}/${needed}</span></div>
    <div style="margin-top:6px">${escapeHtml(fullList)}</div>
  `;
  tooltip.style.display = "block";
  positionTooltip(evt);
}

function positionTooltip(evt) {
  if (!tooltip) return;

  const pad = 12;
  const rect = tooltip.getBoundingClientRect();
  let x = evt.clientX + 14;
  let y = evt.clientY + 14;

  if (x + rect.width + pad > window.innerWidth) x = window.innerWidth - rect.width - pad;
  if (y + rect.height + pad > window.innerHeight) y = window.innerHeight - rect.height - pad;

  tooltip.style.left = `${Math.max(pad, x)}px`;
  tooltip.style.top = `${Math.max(pad, y)}px`;
}

function hideTooltip() {
  if (!tooltip) return;
  tooltip.style.display = "none";
}

// ---------- Rendering ----------
function setStats() {
  if (completeCountEl) completeCountEl.textContent = `${mergedOps}/${totalMergesNeeded()}`;
  if (scoreCountEl) scoreCountEl.textContent = String(score);
}

function renderHeader(puzzleMeta) {
  // Keep "Confluence" branding but show puzzle name / description if present.
  if (titleEl) titleEl.textContent = puzzleMeta?.puzzleName || "Confluence";
  if (descEl) descEl.textContent = puzzleMeta?.description || "Merge tiles that belong to the same hidden group.";
  document.title = puzzleMeta?.puzzleName ? puzzleMeta.puzzleName : "Confluence";
}

function render() {
  if (!gridEl) return;

  gridEl.innerHTML = "";

  tiles.forEach((tile) => {
    const btn = document.createElement("div");
    btn.className = "tile";
    btn.dataset.id = String(tile.id);

    const needed = neededFor(tile);
    const complete = tile.items.length === needed;

    // Label: group name when complete (no group name in tooltip)
    let label;
    if (complete) {
      label = GROUPS[tile.groupId]?.name ?? `Group ${tile.groupId + 1}`;
    } else if (tile.items.length === 1) {
      label = tile.items[0];
    } else {
      label = compressLabel(tile.items);
    }
    btn.textContent = label;

    // Lock completed tiles (still visible)
    tile.locked = complete;
    if (tile.locked) btn.classList.add("locked");

    // Color classes: size2 / sizeMid / sizeFull
    if (complete) btn.classList.add("sizeFull");
    else if (tile.items.length === 2) btn.classList.add("size2");
    else if (tile.items.length >= 3 && tile.items.length < needed) btn.classList.add("sizeMid");

    // Selection highlight
    if (selectedIds.includes(tile.id)) btn.classList.add("selected");

    // Click
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      onTileClick(tile.id);
    });

    // Tooltip hover (desktop)
    btn.addEventListener("mouseenter", (e) => {
      if (tile.items.length > 1) showTooltip(e, tile);
    });
    btn.addEventListener("mousemove", (e) => {
      if (tooltip && tooltip.style.display === "block") positionTooltip(e);
    });
    btn.addEventListener("mouseleave", () => hideTooltip());

    // Long-press tooltip (mobile)
    let pressTimer = null;
    btn.addEventListener(
      "touchstart",
      (e) => {
        if (tile.items.length <= 1) return;
        pressTimer = window.setTimeout(() => {
          const touch = e.touches[0];
          showTooltip({ clientX: touch.clientX, clientY: touch.clientY }, tile);
        }, 420);
      },
      { passive: true }
    );
    btn.addEventListener("touchend", () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = null;
      window.setTimeout(() => hideTooltip(), 700);
    });

    gridEl.appendChild(btn);
  });

  setStats();
  checkWin();
}

// ---------- Core game logic ----------
function initTiles() {
  errors = 0;
  mergedOps = 0;
  score = 0;
  hintMergeActive = false;
  selectedIds = [];
  nextTileId = 1;
  gameSolved = false;

  const t = [];
  GROUPS.forEach((g, groupId) => {
    g.items.forEach((label) => {
      t.push({
        id: nextTileId++,
        groupId,
        items: [label],
        locked: false
      });
    });
  });

  shuffleInPlace(t);
  tiles = t;
  hideTooltip();
  render();
}

function onTileClick(id) {
  const tile = tiles.find((t) => t.id === id);
  if (!tile) return;
  if (tile.locked) return;

  // Toggle selection off
  if (selectedIds.includes(id)) {
    selectedIds = selectedIds.filter((x) => x !== id);
    hideTooltip();
    render();
    return;
  }

  // Pairwise only
  if (selectedIds.length >= 2) return;
  selectedIds.push(id);

  // If two selected, attempt merge
  if (selectedIds.length === 2) {
    attemptMerge(selectedIds[0], selectedIds[1]); // first click, second click
  } else {
    render();
  }
}

function attemptMerge(idA, idB) {
  console.log('attemptMerge called', idA, idB);	
  const aIdx = tiles.findIndex((t) => t.id === idA);
  const bIdx = tiles.findIndex((t) => t.id === idB);
  if (aIdx === -1 || bIdx === -1) {
    selectedIds = [];
    render();
    return;
  }
  const A = tiles[aIdx];
  const B = tiles[bIdx];
  if (A.groupId !== B.groupId) {
    errors += 1;
    score -= 1;
    selectedIds = [];
    flash(flashBad);
    render();
    return;
  }
  const mergedItems = B.items.concat(A.items);
  const completedGroup =
  mergedItems.length === neededFor(A);
  const insertionOriginal = bIdx;
  const hi = Math.max(aIdx, bIdx);
  const lo = Math.min(aIdx, bIdx);
  tiles.splice(hi, 1);
  tiles.splice(lo, 1);
  let insertion = insertionOriginal;
  if (lo < insertion) insertion -= 1;
  tiles.splice(insertion, 0, {
    id: nextTileId++,
    groupId: A.groupId,
    items: mergedItems,
    locked: false
  });
  // If A was before B, the merged tile is one position too high — nudge it down
  // unless it's already at the end
  if (aIdx < bIdx && insertion < tiles.length - 1) {
    const merged = tiles.splice(insertion, 1)[0];
    tiles.splice(insertion + 1, 0, merged);
  }
  mergedOps += 1;
  if (!hintMergeActive) {
	score += 10;
	if (completedGroup) score += 10;
  }
  hintMergeActive = false;
  selectedIds = [];
  flash(flashGood);
  hideTooltip();
  render();
}

function sortTiles() {

  function colorRank(t) {
    const n = t.items.length;
    const needed = neededFor(t);

    if (n >= needed) return 3; // complete
    if (n >= 3) return 2;      // sizeMid (3+)
    if (n === 2) return 1;     // size2
    return 0;                  // single
  }

  tiles.sort((a, b) => colorRank(b) - colorRank(a));
}

function maxPossibleScore() {
  // With your scoring: max = (#items) * 10
  return totalItemsCount() * 10;
}

function winMessage(score) {
  const max = maxPossibleScore();
  const ratio = max > 0 ? score / max : 0;

  if (score >= max) return "FLAWLESS VICTORY!!!";
  if (ratio >= 0.95) return "You win! Nearly perfect — ruthless efficiency.";
  if (ratio >= 0.85) return "You win! Great run — only a couple slips.";
  if (ratio >= 0.70) return "You win! Solid solve.";
  if (ratio >= 0.55) return "Success! A win is a win.";
  if (ratio >= 0.40) return "Your rank: chaos merger (but hey, it worked).";
  if (ratio >= 0.20) return "Your rank: misclick connoisseur.";
  return "Your rank: hint button enthusiast.";
}

function checkWin() {
  // Win when we have exactly one tile per group and each is complete
  if (tiles.length !== GROUPS.length) return;

  const seen = new Set();
  for (const t of tiles) {
    if (!isComplete(t)) return;
    if (seen.has(t.groupId)) return;
    seen.add(t.groupId);
  }

  if (!gameSolved) {
    gameSolved = true;
    tiles = tiles.map((t) => ({ ...t, locked: true }));
    render();
    window.setTimeout(() => {
	  const max = maxPossibleScore();
	  const tagline = winMessage(score);

	  alert(
		`${tagline}\n` +
		`\nFinal score: ${score} / ${max}` +
		`\nAccuracy: ${Math.round((max ? (score / max) : 0) * 100)}%`
	  );
	}, 50);
  }
}

// ---------- Hint ----------
// Returns a [tileA, tileB] pair to merge, or null if nothing to do.
// Priority:
//   1. Two singles in the same group
//   2. A single that can join a same-group partial (won't complete it)
//   3. Two partials in the same group that won't complete it
//   4. Any two incomplete same-group tiles (will complete the group — last resort)
function pickHintPair() {
  const incomplete = tiles.filter(t => !t.locked && !isComplete(t));
  if (incomplete.length < 2) return null;

  // Build a map: groupId -> [incomplete tiles]
  const byGroup = new Map();
  for (const t of incomplete) {
    if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
    byGroup.get(t.groupId).push(t);
  }

  // Only groups that have at least two incomplete tiles can merge
  const groups = [...byGroup.values()].filter(arr => arr.length >= 2);
  if (groups.length === 0) return null;

  // Helper: combined size if we merged two tiles
  const combined = (a, b) => a.items.length + b.items.length;

  // Priority 1 — two singles in the same group
  for (const arr of shuffleInPlace([...groups])) {
    const singles = arr.filter(t => t.items.length === 1);
    if (singles.length >= 2) {
      shuffleInPlace(singles);
      return [singles[0], singles[1]];
    }
  }

  // Priority 2 — a single merging into a partial without completing the group
  for (const arr of shuffleInPlace([...groups])) {
    const needed = neededFor(arr[0]);
    const singles  = arr.filter(t => t.items.length === 1);
    const partials = arr.filter(t => t.items.length > 1);
    // find a single + partial whose sum is still less than needed
    for (const s of shuffleInPlace([...singles])) {
      for (const p of shuffleInPlace([...partials])) {
        if (combined(s, p) < needed) return [s, p];
      }
    }
  }

  // Priority 3 — two partials in the same group that won't complete it
  for (const arr of shuffleInPlace([...groups])) {
    const needed   = neededFor(arr[0]);
    const partials = arr.filter(t => t.items.length > 1);
    for (let i = 0; i < partials.length; i++) {
      for (let j = i + 1; j < partials.length; j++) {
        if (combined(partials[i], partials[j]) < needed) return [partials[i], partials[j]];
      }
    }
  }

  // Priority 4 — any two incomplete same-group tiles (completes the group or advances it)
  const fallbackGroup = groups[randInt(groups.length)];
  shuffleInPlace(fallbackGroup);
  return [fallbackGroup[0], fallbackGroup[1]];
}

function useHint() {
  if (gameSolved) return;

  selectedIds = [];
  hideTooltip();

  const pair = pickHintPair();
  if (!pair) {
    flash(flashBad);
    return;
  }

  const [tileA, tileB] = pair;

  // Briefly highlight both tiles so the user can see what's merging
  const elA = gridEl.querySelector(`[data-id="${tileA.id}"]`);
  const elB = gridEl.querySelector(`[data-id="${tileB.id}"]`);
  elA?.classList.add("hint-highlight");
  elB?.classList.add("hint-highlight");

  window.setTimeout(() => {
    elA?.classList.remove("hint-highlight");
    elB?.classList.remove("hint-highlight");
    hintMergeActive = true;
    selectedIds = [tileA.id, tileB.id];
    attemptMerge(tileA.id, tileB.id);
  }, 600);
}

// ---------- Wiring ----------
resetBtn?.addEventListener("click", () => initTiles());
hintBtn?.addEventListener("click", () => useHint());
shuffleBtn?.addEventListener("click", () => {
  selectedIds = [];
  hideTooltip();
  shuffleInPlace(tiles);
  render();
});
sortBtn?.addEventListener("click", () => {
  selectedIds = [];
  hideTooltip();
  sortTiles();
  render();
});

// ---------- Boot ----------
(async function boot() {
  try {
    const puzzlePath = getPuzzlePathFromQuery();
    const puzzleRaw = await fetchJson(puzzlePath);
    const puzzle = normalizePuzzleJson(puzzleRaw);

    GROUPS = puzzle.groups;

    // set grid columns based on total items
    const total = totalItemsCount();
    document.documentElement.style.setProperty("--cols", String(computeCols(total)));

    renderHeader(puzzle);
    initTiles();
  } catch (err) {
    console.error(err);
    alert(String(err?.message ?? err));
  }
})();