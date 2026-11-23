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
        else if (u.startsWith("min")) seconds = Math.round(val * 60);
        else seconds = Math.round(val);
        return `<button type="button" class="inline-timer-btn" data-seconds="${seconds}" data-label="${full}" title="Lancer un minuteur de ${full}">⏱ ${full}</button>`;
      }
    );
  }

  function renderBook() {
    const spread = $("book-spread");
    const indicator = $("book-page-indicator");
    const coverCount = $("cover-recipe-count");
    if (!spread || !indicator) return;

    if (coverCount) {
      coverCount.textContent = recipes.length > 0
        ? `${recipes.length} formule${recipes.length > 1 ? "s" : ""} consignée${recipes.length > 1 ? "s" : ""}`
        : "Recueil de formules & potions";
    }

    if (recipes.length === 0) {
      renderRuneBookmarks("");
      indicator.textContent = "0 / 0";
      spread.innerHTML = `<div class="empty-state"><h3>Aucune formule dans le grimoire</h3><p>Clique sur <strong>Importer</strong> ou <strong>+ Formule</strong> pour inscrire ta première page.</p></div>`;
      return;
    }

    if (currentIndex >= recipes.length) currentIndex = recipes.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    const r = recipes[currentIndex];
    renderRuneBookmarks(r.category);

    const baseServings = Number(r.servings) || 1;
    if (lastRecipeId !== r.id) {
      lastRecipeId = r.id;
      currentServings = baseServings;
    }
    const ratio = currentServings / baseServings;
    const totalTime = (Number(r.prepTime) || 0) + (Number(r.cookTime) || 0);
    indicator.textContent = `${currentIndex + 1} / ${recipes.length}`;

    const titleOptions = buildGroupedTitleOptions();
    const equipments = detectEquipment(r);
    const equipmentHtml = equipments.length
      ? `<div class="equipment-seals">${equipments.map((eq) => `<span class="equip-seal">${eq.icon} ${eq.label}</span>`).join("")}</div>`
      : "";

    spread.innerHTML = `
      <div class="book-tap-zone book-tap-left" title="Folio précédent"></div>
      <div class="book-tap-zone book-tap-right" title="Folio suivant"></div>
      <div class="book-page book-page-left">
        <span class="recipe-category">${escapeHtml(r.category)}</span>
        <div class="recipe-title-wrapper">
          <select id="book-toc" class="recipe-title-select" aria-label="Changer de formule">
            ${titleOptions}
          </select>
        </div>
        <div class="recipe-meta">
          <span>⏱ Prépa : <strong>${r.prepTime} min</strong></span>
          <span>🔥 Cuisson : <strong>${r.cookTime} min</strong></span>
          <span>⏳ Total : <strong>${totalTime} min</strong></span>
          <span class="servings-control">
            🍽 Portions :
            <button type="button" id="btn-servings-minus" class="btn-serving" aria-label="Réduire les portions">−</button>
            <strong>${currentServings}</strong>
            <button type="button" id="btn-servings-plus" class="btn-serving" aria-label="Augmenter les portions">+</button>
          </span>
        </div>
        ${r.tags && r.tags.length ? `<div class="tag-list">${r.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        ${equipmentHtml}
        <div class="section-header-row">
          <h3 class="section-heading">Ingrédients</h3>
          <button type="button" id="btn-toggle-ingredients" class="btn-undo-step" aria-expanded="true">Masquer</button>
        </div>
        <ul id="ingredients-list" class="ingredients-list">
          ${r.ingredients.map((ing) => `<li>${formatScaledIngredient(ing, ratio)}</li>`).join("")}
        </ul>
      </div>
      <div class="book-page book-page-right">
        <div class="section-header-row">
          <h3 class="section-heading">Incantation &amp; Préparation</h3>
          <button type="button" id="btn-undo-step" class="btn-undo-step hidden">↶ Revenir à la dernière étape</button>
        </div>
        <ol class="steps-list">
          ${r.steps.map((st) => `<li title="Cliquer pour masquer cette étape">${formatStepWithTimers(st)}</li>`).join("")}
        </ol>
        ${r.notes ? `<div class="recipe-notes"><strong>Notes de l'alchimiste :</strong><br>${escapeHtml(r.notes)}</div>` : ""}
      </div>
    `;

    on("book-toc", "change", (e) => {
      const nextIdx = Number(e.target.value);
      const dir = nextIdx >= currentIndex ? "next" : "prev";
      currentIndex = nextIdx;
      renderBook();
      animatePageTurn(dir);
    });

    on("btn-servings-minus", "click", () => {
      if (currentServings > 1) {
        currentServings--;
        renderBook();
      }
    });
    on("btn-servings-plus", "click", () => {
      currentServings++;
      renderBook();
    });

    spread.querySelector(".book-tap-left").addEventListener("click", goPrev);
    spread.querySelector(".book-tap-right").addEventListener("click", goNext);

    const toggleIngBtn = $("btn-toggle-ingredients");
    const ingList = $("ingredients-list");
    if (toggleIngBtn && ingList) {
      toggleIngBtn.addEventListener("click", () => {
        const collapsed = ingList.classList.toggle("is-collapsed");
        toggleIngBtn.textContent = collapsed ? "Afficher" : "Masquer";
        toggleIngBtn.setAttribute("aria-expanded", String(!collapsed));
      });
    }

    const hiddenStepStack = [];
    const undoStepBtn = $("btn-undo-step");
    spread.querySelectorAll(".steps-list li").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest(".inline-timer-btn")) return;
        li.classList.add("is-masked-item");
        hiddenStepStack.push(li);
        if (undoStepBtn) undoStepBtn.classList.remove("hidden");
      });
    });
    if (undoStepBtn) {
      undoStepBtn.addEventListener("click", () => {
        const last = hiddenStepStack.pop();
        if (last) last.classList.remove("is-masked-item");
        if (hiddenStepStack.length === 0) undoStepBtn.classList.add("hidden");
      });
    }

    spread.querySelectorAll(".inline-timer-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        startKitchenTimer(Number(btn.dataset.seconds), btn.dataset.label);
      });
    });
  }
  function renderGrid() {
    const searchEl = $("search-text");
    const grid = $("recipe-grid");
    if (!searchEl || !grid) return;

    const query = searchEl.value.trim().toLowerCase();
    const cat = $("filter-category").value;
    const maxTime = Number($("filter-time").value) || Infinity;
    const exclude = $("filter-exclude").value.trim().toLowerCase();

    const filtered = recipes.filter((r) => {
      const prepTime = Number(r.prepTime) || 0;
      const totalTime = prepTime + (Number(r.cookTime) || 0);
      if (cat && r.category !== cat) return false;
      if (totalTime > maxTime) return false;

      const haystack = [
        r.title, r.category,
        (r.tags || []).join(" "),
        (r.ingredients || []).join(" "),
        (r.steps || []).join(" "),
        r.notes || ""
      ].join(" ").toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (exclude && haystack.includes(exclude)) return false;

      if (activeQuickFilters.has("express") && prepTime > 20) return false;
      if (activeQuickFilters.has("batch") && !haystack.includes("batch") && (Number(r.servings) || 0) < 6) return false;

      return true;
    });

    $("grid-stats").textContent = `${filtered.length} formule(s) trouvée(s) sur ${recipes.length}`;

    if (!filtered.length) {
      grid.innerHTML = `<p style="color:#cfb78a">Aucune formule ne correspond à ces critères.</p>`;
      return;
    }

    grid.innerHTML = filtered.map((r) => {
      const total = (Number(r.prepTime) || 0) + (Number(r.cookTime) || 0);
      const realIndex = recipes.findIndex((item) => item.id === r.id);
      return `
        <article class="recipe-card" data-index="${realIndex}">
          <span class="recipe-category">${escapeHtml(r.category)}</span>
          <h3 class="card-title">${escapeHtml(r.title)}</h3>
          <div class="card-meta">⏳ ${total} min · 🍽 ${r.servings} pers.</div>
          <div class="tag-list">${(r.tags || []).slice(0, 4).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".recipe-card").forEach((card) => {
      card.addEventListener("click", () => {
        currentIndex = Number(card.dataset.index);
        switchView("book");
      });
    });
  }

  function buildPlannerSelectOptions(selectedId) {
    const emptyOpt = `<option value="">— Libre —</option>`;
    const knownCats = CATEGORY_RUNES.map((c) => c.name);
    const groups = CATEGORY_RUNES.map((cat) => {
      const items = recipes.filter((r) => r.category === cat.name);
      if (!items.length) return "";
      const opts = items.map((r) =>
        `<option value="${escapeHtml(r.id)}" ${r.id === selectedId ? "selected" : ""}>${escapeHtml(r.title)}</option>`
      ).join("");
      return `<optgroup label="${cat.rune} ${cat.label}">${opts}</optgroup>`;
    }).join("");

    const others = recipes.filter((r) => !knownCats.includes(r.category));
    const otherGroup = others.length
      ? `<optgroup label="✦ Autres">${others.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === selectedId ? "selected" : ""}>${escapeHtml(r.title)}</option>`).join("")}</optgroup>`
      : "";

    return emptyOpt + groups + otherGroup;
  }

  function renderPlanner() {
    const grid = $("planner-grid");
    if (!grid) return;
    const planner = RecipeDB.getPlanner();

    grid.innerHTML = DAYS_OF_WEEK.map((day) => {
      const midiId = planner[`${day.key}_midi`] || "";
      const soirId = planner[`${day.key}_soir`] || "";
      return `
        <article class="planner-day-card">
          <h3 class="planner-day-title">${day.label}</h3>
          <div class="planner-slot">
            <div class="planner-slot-head">
              <span>☀ Midi</span>
              ${midiId ? `<button type="button" class="planner-open-btn" data-open-id="${escapeHtml(midiId)}">Ouvrir</button>` : ""}
            </div>
            <select class="planner-select" data-slot="${day.key}_midi">
              ${buildPlannerSelectOptions(midiId)}
            </select>
          </div>
          <div class="planner-slot">
            <div class="planner-slot-head">
              <span>☾ Soir</span>
              ${soirId ? `<button type="button" class="planner-open-btn" data-open-id="${escapeHtml(soirId)}">Ouvrir</button>` : ""}
            </div>
            <select class="planner-select" data-slot="${day.key}_soir">
              ${buildPlannerSelectOptions(soirId)}
            </select>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".planner-select").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        const nextPlanner = RecipeDB.getPlanner();
        nextPlanner[e.target.dataset.slot] = e.target.value;
        await RecipeDB.savePlanner(nextPlanner);
        renderPlanner();
      });
    });

    grid.querySelectorAll(".planner-open-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = recipes.findIndex((r) => r.id === btn.dataset.openId);
        if (idx !== -1) {
          currentIndex = idx;
          switchView("book");
        }
      });
    });
  }

  function normalizeUnit(unitRaw) {
    const u = (unitRaw || "").toLowerCase().replace(/\.$/, "");
    if (u === "gr" || u === "g") return "g";
    if (u === "kg") return "kg";
    if (u === "ml") return "ml";
    if (u === "cl") return "cl";
    if (u === "dl") return "dl";
    if (u === "l") return "l";
    return u;
  }

  function normalizeIngredientKey(label) {
    return label
      .toLowerCase()
      .replace(/^d['’]\s*|^de\s+/i, "")
      .replace(/[()]/g, "")
      .trim()
      .split(/\s+/)
      .map((w) => (w.length > 3 ? w.replace(/(s|x)$/i, "") : w))
      .join(" ");
  }

  function buildAggregatedGroceries(selectedIds) {
    const selectedRecipes = recipes.filter((r) => selectedIds.includes(r.id));
    if (!selectedRecipes.length) return [];

    const mergedMap = new Map();
    const rawLines = [];

    for (const r of selectedRecipes) {
      for (const line of r.ingredients || []) {
        const clean = line.trim();
        if (!clean) continue;

        const mUnit = clean.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|kg|mg|ml|cl|dl|l)\b\s*(?:de\s+|d['’]\s*)?(.+)$/i);
        const mCount = !mUnit
          ? clean.match(/^(\d+(?:[.,]\d+)?)\s+(?!g\b|gr\b|kg\b|mg\b|ml\b|cl\b|dl\b|l\b)(.+)$/i)
          : null;

        if (mUnit) {
          const qty = parseFloat(mUnit[1].replace(",", "."));
          const unit = normalizeUnit(mUnit[2]);
          const itemLabel = mUnit[3].trim();
          const key = `u|${normalizeIngredientKey(itemLabel)}|${unit}`;
          if (mergedMap.has(key)) mergedMap.get(key).qty += qty;
          else mergedMap.set(key, { qty, unit, label: itemLabel });
        } else if (mCount) {
          const qty = parseFloat(mCount[1].replace(",", "."));
          const itemLabel = mCount[2].trim();
          const key = `c|${normalizeIngredientKey(itemLabel)}`;
          if (mergedMap.has(key)) mergedMap.get(key).qty += qty;
          else mergedMap.set(key, { qty, unit: "", label: itemLabel });
        } else {
          rawLines.push(clean);
        }
      }
    }

    const result = [];
    for (const entry of mergedMap.values()) {
      const formattedQty = Number.isInteger(entry.qty)
        ? String(entry.qty)
        : String(Math.round(entry.qty * 10) / 10).replace(".", ",");
      result.push(entry.unit ? `${formattedQty} ${entry.unit} ${entry.label}` : `${formattedQty} ${entry.label}`);
    }
    for (const line of rawLines) {
      result.push(line);
    }
    return result;
  }

  function openGroceriesModal() {
    const selector = $("grocery-recipe-selector");
    const listEl = $("grocery-checklist");
    const modal = $("modal-groceries");
    if (!selector || !listEl || !modal) return;

    const planner = RecipeDB.getPlanner();
    const plannedIds = new Set(Object.values(planner).filter(Boolean));
    if (plannedIds.size === 0 && recipes[currentIndex]) {
      plannedIds.add(recipes[currentIndex].id);
    }

    selector.innerHTML = recipes.map((r) => `
      <label class="grocery-check-item">
        <input type="checkbox" value="${escapeHtml(r.id)}" ${plannedIds.has(r.id) ? "checked" : ""}>
        <span>${escapeHtml(r.title)}</span>
      </label>
    `).join("");

    const refreshOutput = () => {
      const checked = Array.from(selector.querySelectorAll("input:checked")).map((el) => el.value);
      const items = buildAggregatedGroceries(checked);
      currentGroceryText = items.map((it) => `• ${it}`).join("\n");
      if (!items.length) {
        listEl.innerHTML = `<li style="color:#cbb489">Aucune formule sélectionnée.</li>`;
        return;
      }
      listEl.innerHTML = items.map((it) => `
        <li>
          <label>
            <input type="checkbox">
            <span>${escapeHtml(it)}</span>
          </label>
        </li>
      `).join("");
    };

    selector.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", refreshOutput));
    refreshOutput();
    modal.classList.remove("hidden");
  }

  function rollRandomRecipe() {
    if (!recipes.length) return;
    const plats = recipes
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.category === "Plat");
    const pool = plats.length > 0 ? plats : recipes.map((r, i) => ({ r, i }));
    const candidates = pool.length > 1 ? pool.filter(({ i }) => i !== currentIndex) : pool;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    currentIndex = pick.i;
    renderBook();
    animatePageTurn("next");
  }

  function fileToBase64Payload(file) {
    return new Promise((resolve, reject) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
            resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(",")[1];
        resolve({ base64, mimeType: file.type || "application/octet-stream" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function parseRawRecipe(raw) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    let title = lines[0].replace(/^#+\s*/, "");
    const ingredients = [];
    const steps = [];
    let mode = "auto";

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const low = line.toLowerCase();
      if (/^(#+\s*)?(ingr[ée]dients?)\b/.test(low)) { mode = "ing"; continue; }
      if (/^(#+\s*)?(pr[ée]paration|[ée]tapes?|instructions?|recette)\b/.test(low)) { mode = "step"; continue; }

      const cleaned = line.replace(/^[-*•\d.)]+\s*/, "");
      if (mode === "ing") ingredients.push(cleaned);
      else if (mode === "step") steps.push(cleaned);
      else if (/^[-*•]/.test(line) || /\b(\d+\s?(g|kg|ml|cl|l|c\.|cuill))/i.test(line)) ingredients.push(cleaned);
      else steps.push(cleaned);
    }

    $("field-title").value = title;
    if (ingredients.length) $("field-ingredients").value = ingredients.join("\n");
    if (steps.length) $("field-steps").value = steps.join("\n");
  }

  function openEditor(recipe = null, isNewPrefill = false) {
    editingId = (!isNewPrefill && recipe) ? recipe.id : null;
    $("editor-title").textContent = editingId ? "Réécrire la formule" : "Nouvelle formule";
    $("recipe-form").reset();
    $("raw-text-input").value = "";

    if (recipe) {
      $("field-title").value = recipe.title || "";
      $("field-category").value = recipe.category || "Plat";
      $("field-prep").value = recipe.prepTime ?? 15;
      $("field-cook").value = recipe.cookTime ?? 30;
      $("field-servings").value = recipe.servings ?? 4;
      $("field-tags").value = (recipe.tags || []).join(", ");
      $("field-ingredients").value = (recipe.ingredients || []).join("\n");
      $("field-steps").value = (recipe.steps || []).join("\n");
      $("field-notes").value = recipe.notes || "";
    }
    $("modal-editor").classList.remove("hidden");
  }

  async function refreshData(selectId = null) {
    recipes = await RecipeDB.getAll();
    if (selectId) {
      const idx = recipes.findIndex((r) => r.id === selectId);
      if (idx !== -1) currentIndex = idx;
    }
    renderBook();
    renderGrid();
    renderPlanner();
  }

  async function runSync(showStatusInModal = false) {
    const statusEl = $("sync-status");
    const btn = $("btn-sync-now");
    const dot = $("sync-dot");
    btn.disabled = true;
    btn.innerHTML = `…<span id="sync-dot" class="${dot ? dot.className : "sync-dot"}"></span>`;
    if (showStatusInModal && statusEl) {
      statusEl.classList.remove("error");
      statusEl.textContent = "Synchronisation en cours...";
    }

    try {
      const count = await RecipeDB.pullFromCloud();
      await refreshData();
      if (showStatusInModal && statusEl) statusEl.textContent = `Synchro réussie : ${count} formule(s) chargée(s).`;
    } catch (err) {
      if (showStatusInModal && statusEl) {
        statusEl.classList.add("error");
        statusEl.textContent = `Erreur : ${err.message}`;
      }
    } finally {
      btn.disabled = false;
      const currentStatus = RecipeDB.getSyncStatus();
      btn.innerHTML = `↻<span id="sync-dot" class="sync-dot ${currentStatus !== "synced" ? `is-${currentStatus}` : ""}"></span>`;
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderBook();
      animatePageTurn("prev");
    }
  }

  function goNext() {
    if (currentIndex < recipes.length - 1) {
      currentIndex++;
      renderBook();
      animatePageTurn("next");
    }
  }

  function playTimerChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.18 + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.18);
        osc.stop(ctx.currentTime + idx * 0.18 + 0.65);
      });
    } catch (_) {}
  }

  function startKitchenTimer(totalSeconds, label) {
    const dock = $("timer-dock");
    if (!dock) return;
    let remaining = totalSeconds;
    let paused = false;

    const pill = document.createElement("div");
    pill.className = "timer-pill";

    const formatClock = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    };

    pill.innerHTML = `
      <span>⏱ <strong>${escapeHtml(label)}</strong> · <span class="timer-clock">${formatClock(remaining)}</span></span>
      <span class="timer-pill-actions">
        <button type="button" class="timer-pill-btn timer-pause" title="Pause / Reprendre">❚❚</button>
        <button type="button" class="timer-pill-btn timer-close" title="Fermer">✕</button>
      </span>
    `;
    dock.appendChild(pill);

    const clockEl = pill.querySelector(".timer-clock");
    const pauseBtn = pill.querySelector(".timer-pause");

    const interval = setInterval(() => {
      if (paused) return;
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        clockEl.textContent = "00:00";
        pill.classList.add("is-finished");
        playTimerChime();
      } else {
        clockEl.textContent = formatClock(remaining);
      }
    }, 1000);

    pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "▶" : "❚❚";
    });

    pill.querySelector(".timer-close").addEventListener("click", () => {
      clearInterval(interval);
      pill.remove();
    });
  }

  async function toggleWakeLock() {
    const btn = $("btn-wake-lock");
    if (!("wakeLock" in navigator)) {
      alert("Ton navigateur ne supporte pas le maintien de l'écran allumé.");
      return;
    }
    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
        btn.classList.remove("is-active");
        btn.setAttribute("aria-pressed", "false");
      } else {
        wakeLock = await navigator.wakeLock.request("screen");
        btn.classList.add("is-active");
        btn.setAttribute("aria-pressed", "true");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
          btn.classList.remove("is-active");
          btn.setAttribute("aria-pressed", "false");
        });
      }
    } catch (_) {}
  }

  function bindEvents() {
    RecipeDB.onSyncStatusChange((status) => {
      const dot = $("sync-dot");
      const btn = $("btn-sync-now");
      if (!dot || !btn) return;
      dot.className = `sync-dot ${status !== "synced" ? `is-${status}` : ""}`;
      const labels = {
        synced: "Synchronisé avec Google Sheets",
        pending: "Modifications locales en attente de synchronisation",
        offline: "Hors-ligne : sauvegarde locale active",
        error: "Erreur de synchronisation"
      };
      btn.title = labels[status] || "Synchronisation";
    });

    on("grimoire-book", "click", openGrimoire);
    on("grimoire-book", "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openGrimoire();
      }
    });
    on("btn-close-grimoire", "click", closeGrimoire);
    on("btn-toggle-topbar", "click", () => {
      const topbar = $("topbar");
      const collapsed = topbar.classList.toggle("is-collapsed");
      $("btn-toggle-topbar").setAttribute("aria-expanded", String(!collapsed));
      $("topbar-toggle-icon").textContent = collapsed ? "▼" : "▲";
      $("topbar-toggle-label").textContent = collapsed ? "Menu" : "Rétracter";
    });

    on("btn-view-book", "click", () => switchView("book"));
    on("btn-view-grid", "click", () => switchView("grid"));
    on("btn-view-planner", "click", () => switchView("planner"));
    on("btn-new-recipe", "click", () => openEditor(null));
    on("btn-sync-now", "click", () => runSync(false));

    on("quick-import-input", "change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const label = $("btn-import-label");
      const originalText = label.firstChild.textContent;
      label.firstChild.textContent = "Analyse en cours... ";
      try {
        const { base64, mimeType } = await fileToBase64Payload(file);
        const parsed = await RecipeDB.parseFileWithCloud(base64, mimeType, file.name);
        openEditor(parsed, true);
      } catch (err) {
        alert(`Échec de l'import : ${err.message}`);
      } finally {
        label.firstChild.textContent = originalText;
        e.target.value = "";
      }
    });

    on("btn-sync-config", "click", () => {
      const cfg = RecipeDB.getSyncConfig();
      $("sync-url").value = cfg.url;
      $("sync-token").value = cfg.token;
      if ($("sync-pin")) $("sync-pin").value = cfg.pin || "";
      $("sync-status").textContent = "";
      $("modal-sync").classList.remove("hidden");
    });

    on("sync-form", "submit", async (e) => {
      e.preventDefault();
      const pinVal = $("sync-pin") ? $("sync-pin").value : null;
      RecipeDB.setSyncConfig($("sync-url").value, $("sync-token").value, pinVal);
      await runSync(true);
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => $(btn.dataset.close).classList.add("hidden"));
    });

    on("btn-prev-page", "click", goPrev);
    on("btn-next-page", "click", goNext);
    on("btn-random-recipe", "click", rollRandomRecipe);

    document.addEventListener("keydown", (e) => {
      if (isCoverVisible() || !$("view-book").classList.contains("active") || !$("modal-editor").classList.contains("hidden")) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    });

    let touchStartX = 0;
    on("book-spread", "touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    on("book-spread", "touchend", (e) => {
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (diff > 60) goPrev();
      if (diff < -60) goNext();
    }, { passive: true });

    on("btn-wake-lock", "click", toggleWakeLock);

    const nightBtn = $("btn-night-parchment");
    const nightIcon = $("night-parchment-icon");
    if (nightBtn && nightIcon) {
      const applyNightMode = (enabled) => {
        document.body.classList.toggle("night-parchment", enabled);
        nightBtn.classList.toggle("is-active", enabled);
        nightBtn.setAttribute("aria-pressed", String(enabled));
        nightIcon.textContent = enabled ? "☀" : "☾";
      };
      if (localStorage.getItem("grimoire_night_mode") === "1") {
        applyNightMode(true);
      }
      nightBtn.addEventListener("click", () => {
        const nextState = !document.body.classList.contains("night-parchment");
        localStorage.setItem("grimoire_night_mode", nextState ? "1" : "0");
        applyNightMode(nextState);
      });
    }

    on("btn-print-recipe", "click", () => {
      if (!recipes[currentIndex]) return;
      document.body.classList.remove("night-parchment");
      setTimeout(() => window.print(), 60);
    });

    on("btn-edit-current", "click", () => {
      if (recipes[currentIndex]) openEditor(recipes[currentIndex]);
    });

    on("btn-delete-current", "click", async () => {
      const current = recipes[currentIndex];
      if (!current) return;

      let savedPin = RecipeDB.getBanPin();
      if (!savedPin) {
        const newPin = prompt("Définis un code PIN à 4 chiffres pour protéger le bannissement :");
        if (newPin === null) return;
        if (!RecipeDB.setBanPin(newPin)) {
          alert("Le code doit contenir exactement 4 chiffres.");
          return;
        }
        savedPin = newPin.trim();
      }

      const enteredPin = prompt(`Entre le code PIN à 4 chiffres pour bannir « ${current.title} » :`);
      if (enteredPin === null) return;
      if (enteredPin.trim() !== savedPin) {
        alert("Code PIN incorrect.");
        return;
      }

      await RecipeDB.remove(current.id);
      await refreshData();
    });

    ["search-text", "filter-category", "filter-time", "filter-exclude"].forEach((id) => {
      on(id, "input", renderGrid);
    });

    document.querySelectorAll(".quick-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const key = chip.dataset.qf;
        if (activeQuickFilters.has(key)) {
          activeQuickFilters.delete(key);
          chip.classList.remove("is-active");
        } else {
          activeQuickFilters.add(key);
          chip.classList.add("is-active");
        }
        renderGrid();
      });
    });

    on("btn-open-groceries", "click", openGroceriesModal);
    on("btn-clear-planner", "click", async () => {
      if (!confirm("Vider tout le menu de la semaine ?")) return;
      await RecipeDB.savePlanner({});
      renderPlanner();
    });

    on("btn-copy-groceries", "click", async () => {
      const unchecked = Array.from(document.querySelectorAll("#grocery-checklist li"))
        .filter((li) => !li.querySelector("input:checked"))
        .map((li) => `• ${li.textContent.trim()}`);
      const textToCopy = unchecked.length ? unchecked.join("\n") : currentGroceryText;
      try {
        await navigator.clipboard.writeText(textToCopy);
      } catch (_) {}
      const btn = $("btn-copy-groceries");
      btn.textContent = "Copié !";
      setTimeout(() => { btn.textContent = "Copier la liste"; }, 1800);
    });

    on("btn-parse-raw", "click", () => parseRawRecipe($("raw-text-input").value));

    on("recipe-form", "submit", async (e) => {
      e.preventDefault();
      const recipe = {
        id: editingId || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: $("field-title").value.trim(),
        category: $("field-category").value,
        prepTime: Number($("field-prep").value) || 0,
        cookTime: Number($("field-cook").value) || 0,
        servings: Number($("field-servings").value) || 1,
        tags: $("field-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        ingredients: $("field-ingredients").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        steps: $("field-steps").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        notes: $("field-notes").value.trim(),
        updatedAt: Date.now()
      };
      await RecipeDB.save(recipe);
      $("modal-editor").classList.add("hidden");
      await refreshData(recipe.id);
      switchView("book");
    });
  }

  async function init() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    bindEvents();
    await refreshData();
    if (RecipeDB.getSyncConfig().token) {
      runSync(false);
    }
  }

  init();
})();
