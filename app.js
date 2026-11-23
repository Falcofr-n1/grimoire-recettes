(() => {
  let recipes = [];
  let currentIndex = 0;
  let editingId = null;
  let isOpening = false;
  let wakeLock = null;
  let currentServings = null;
  let lastRecipeId = null;
  let currentGroceryText = "";
  const activeQuickFilters = new Set();

  const DAYS_OF_WEEK = [
    { key: "lundi", label: "Lundi" },
    { key: "mardi", label: "Mardi" },
    { key: "mercredi", label: "Mercredi" },
    { key: "jeudi", label: "Jeudi" },
    { key: "vendredi", label: "Vendredi" },
    { key: "samedi", label: "Samedi" },
    { key: "dimanche", label: "Dimanche" }
  ];

  const CATEGORY_RUNES = [
    { name: "Entrée", rune: "ᚠ", label: "Entrées" },
    { name: "Plat", rune: "ᚢ", label: "Plats" },
    { name: "Accompagnement", rune: "ᚦ", label: "Accompagnements" },
    { name: "Dessert", rune: "ᚨ", label: "Desserts" },
    { name: "Boisson / Base", rune: "ᚱ", label: "Boissons & Bases" }
  ];

  const EQUIPMENT_RULES = [
    { regex: /\bthermomix\b/i, icon: "⚗️", label: "Thermomix" },
    { regex: /\b(four|enfourner|rôti|gratin)\b/i, icon: "🔥", label: "Four" },
    { regex: /\b(cuiseur [àa] riz|rice cooker)\b/i, icon: "🍚", label: "Cuiseur à riz" },
    { regex: /\b(barbecue|bbq|plancha|grill)\b/i, icon: "🍖", label: "Grill / BBQ" },
    { regex: /\b(sans cuisson|cru)\b/i, icon: "❄️", label: "Sans cuisson" }
  ];

  const $ = (id) => document.getElementById(id);

  const on = (id, event, handler) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isCoverVisible() {
    const overlay = $("grimoire-overlay");
    return overlay ? !overlay.classList.contains("is-hidden") : false;
  }

  function openGrimoire() {
    if (isOpening || !isCoverVisible()) return;
    isOpening = true;
    const overlay = $("grimoire-overlay");
    overlay.classList.add("is-opening");

    setTimeout(() => {
      overlay.classList.add("is-hidden");
      isOpening = false;
    }, 1150);
  }

  function closeGrimoire() {
    const overlay = $("grimoire-overlay");
    if (!overlay) return;
    overlay.classList.remove("is-hidden");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.remove("is-opening");
      });
    });
  }

  function animatePageTurn(direction) {
    const spread = $("book-spread");
    if (!spread) return;
    const cls = direction === "next" ? "turn-next" : "turn-prev";
    spread.classList.remove("turn-next", "turn-prev");
    void spread.offsetWidth;
    spread.classList.add(cls);
  }

  function switchView(viewName) {
    ["book", "grid", "planner"].forEach((name) => {
      const viewEl = $(`view-${name}`);
      const btnEl = $(`btn-view-${name}`);
      if (viewEl) viewEl.classList.toggle("active", viewName === name);
      if (btnEl) btnEl.classList.toggle("active", viewName === name);
    });

    if (viewName === "grid") renderGrid();
    else if (viewName === "planner") renderPlanner();
    else renderBook();
  }

  function detectEquipment(recipe) {
    const haystack = [
      recipe.title,
      (recipe.tags || []).join(" "),
      (recipe.steps || []).join(" "),
      recipe.notes || ""
    ].join(" ");
    return EQUIPMENT_RULES.filter((rule) => rule.regex.test(haystack));
  }

  function renderRuneBookmarks(activeCategory) {
    const nav = $("rune-bookmarks");
    if (!nav) return;
    nav.innerHTML = CATEGORY_RUNES.map((item) => {
      const firstIndex = recipes.findIndex((r) => r.category === item.name);
      const isActive = activeCategory === item.name;
      return `<button type="button" class="rune-tab ${isActive ? "is-active" : ""}" data-first-index="${firstIndex}" ${firstIndex === -1 ? "disabled" : ""} title="Aller aux ${item.label}">
        <span class="rune-glyph">${item.rune}</span>
        <span>${item.label}</span>
      </button>`;
    }).join("");

    nav.querySelectorAll(".rune-tab:not(:disabled)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextIdx = Number(btn.dataset.firstIndex);
        if (nextIdx !== -1 && nextIdx !== currentIndex) {
          const dir = nextIdx >= currentIndex ? "next" : "prev";
          currentIndex = nextIdx;
          renderBook();
          animatePageTurn(dir);
        }
      });
    });
  }

  function buildGroupedTitleOptions() {
    const knownCats = CATEGORY_RUNES.map((c) => c.name);
    const groups = CATEGORY_RUNES.map((cat) => {
      const items = recipes
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.category === cat.name);
      if (!items.length) return "";
      const opts = items.map(({ item, i }) =>
        `<option value="${i}" ${i === currentIndex ? "selected" : ""}>${escapeHtml(item.title)}</option>`
      ).join("");
      return `<optgroup label="─── ${cat.rune} ${cat.label} ${cat.rune} ───">${opts}</optgroup>`;
    }).join("");

    const others = recipes
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !knownCats.includes(item.category));
    const otherGroup = others.length
      ? `<optgroup label="─── ✦ Autres ✦ ───">${others.map(({ item, i }) => `<option value="${i}" ${i === currentIndex ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</optgroup>`
      : "";

    return groups + otherGroup;
  }

  function formatScaledIngredient(line, ratio) {
    if (!ratio || Math.abs(ratio - 1) < 0.001) return escapeHtml(line);
    const updated = String(line).replace(
      /(^|\s)(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)(?=\s*(?:g|kg|mg|ml|cl|dl|l|c\.|cuill|pinc|tranche|gousse|oeuf|œuf|filet|boîte|sachet|verre|tasse|pot|feuille|brin|pomme|oignon|carotte|tomate|banane|courgette|citron|escalope|pavé|blanc|jaune|\b))/i,
      (match, prefix, numStr) => {
        let val = 0;
        if (numStr.includes("/")) {
          const [a, b] = numStr.split("/").map(Number);
          val = b ? a / b : 0;
        } else {
          val = parseFloat(numStr.replace(",", "."));
        }
        if (!val) return match;
        const scaled = val * ratio;
        const rounded = scaled >= 10
          ? Math.round(scaled)
          : Math.round(scaled * 10) / 10;
        return `${prefix}${String(rounded).replace(".", ",")}`;
      }
    );
    return escapeHtml(updated);
  }

  function formatStepWithTimers(stepText) {
    const escaped = escapeHtml(stepText);
    return escaped.replace(
      /\b(\d+(?:[.,]\d+)?)\s*(h(?:eures?)?|min(?:utes?)?|sec(?:ondes?)?)\b/gi,
      (full, rawNum, unit) => {
        const val = parseFloat(rawNum.replace(",", "."));
        if (!val || val <= 0) return full;
        const u = unit.toLowerCase();
        let seconds = 0;
        if (u.startsWith("h")) seconds = Math.round(val * 3600);
