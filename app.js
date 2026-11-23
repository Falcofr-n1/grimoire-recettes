(() => {
  let recipes = [];
  let currentIndex = 0;
  let editingId = null;
  let isOpening = false;
  let wakeLock = null;
  let currentServings = null;
  let lastRecipeId = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isCoverVisible() {
    return !$("grimoire-overlay").classList.contains("is-hidden");
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
    overlay.classList.remove("is-hidden");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.remove("is-opening");
      });
    });
  }

  function animatePageTurn(direction) {
    const spread = $("book-spread");
    const cls = direction === "next" ? "turn-next" : "turn-prev";
    spread.classList.remove("turn-next", "turn-prev");
    void spread.offsetWidth;
    spread.classList.add(cls);
  }

  function switchView(viewName) {
    $("view-book").classList.toggle("active", viewName === "book");
    $("view-grid").classList.toggle("active", viewName === "grid");
    $("btn-view-book").classList.toggle("active", viewName === "book");
    $("btn-view-grid").classList.toggle("active", viewName === "grid");
    if (viewName === "grid") renderGrid();
    else renderBook();
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

    if (coverCount) {
      coverCount.textContent = recipes.length > 0
        ? `${recipes.length} formule${recipes.length > 1 ? "s" : ""} consignée${recipes.length > 1 ? "s" : ""}`
        : "Recueil de formules & potions";
    }

    if (recipes.length === 0) {
      indicator.textContent = "0 / 0";
      spread.innerHTML = `<div class="empty-state"><h3>Aucune formule dans le grimoire</h3><p>Clique sur <strong>Importer</strong> ou <strong>+ Formule</strong> pour inscrire ta première page.</p></div>`;
      return;
    }

    if (currentIndex >= recipes.length) currentIndex = recipes.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    const r = recipes[currentIndex];
    const baseServings = Number(r.servings) || 1;
    if (lastRecipeId !== r.id) {
      lastRecipeId = r.id;
      currentServings = baseServings;
    }
    const ratio = currentServings / baseServings;
    const totalTime = (Number(r.prepTime) || 0) + (Number(r.cookTime) || 0);
    indicator.textContent = `${currentIndex + 1} / ${recipes.length}`;

    const titleOptions = recipes.map((item, i) =>
      `<option value="${i}" ${i === currentIndex ? "selected" : ""}>${escapeHtml(item.title)}</option>`
    ).join("");

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
        <div class="section-header-row">
          <h3 class="section-heading">Ingrédients</h3>
          <button type="button" id="btn-undo-ing" class="btn-undo-step hidden">↶ Revenir</button>
        </div>
        <ul class="ingredients-list">
          ${r.ingredients.map((ing) => `<li title="Cliquer pour masquer">${formatScaledIngredient(ing, ratio)}</li>`).join("")}
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

    // Changement de recette via le titre
    $("book-toc").addEventListener("change", (e) => {
      const nextIdx = Number(e.target.value);
      const dir = nextIdx >= currentIndex ? "next" : "prev";
      currentIndex = nextIdx;
      renderBook();
      animatePageTurn(dir);
    });

    // Ajustement des portions
    $("btn-servings-minus").addEventListener("click", () => {
      if (currentServings > 1) {
        currentServings--;
        renderBook();
      }
    });
    $("btn-servings-plus").addEventListener("click", () => {
      currentServings++;
      renderBook();
    });

    // Zones tactiles latérales
    spread.querySelector(".book-tap-left").addEventListener("click", goPrev);
    spread.querySelector(".book-tap-right").addEventListener("click", goNext);

    // Masquage + pile d'annulation (Ingrédients)
    const hiddenIngStack = [];
    const undoIngBtn = $("btn-undo-ing");
    spread.querySelectorAll(".ingredients-list li").forEach((li) => {
      li.addEventListener("click", () => {
        li.classList.add("is-masked-item");
        hiddenIngStack.push(li);
        undoIngBtn.classList.remove("hidden");
      });
    });
    undoIngBtn.addEventListener("click", () => {
      const last = hiddenIngStack.pop();
      if (last) last.classList.remove("is-masked-item");
      if (hiddenIngStack.length === 0) undoIngBtn.classList.add("hidden");
    });

    // Masquage + pile d'annulation (Étapes)
    const hiddenStepStack = [];
    const undoStepBtn = $("btn-undo-step");
    spread.querySelectorAll(".steps-list li").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest(".inline-timer-btn")) return;
        li.classList.add("is-masked-item");
        hiddenStepStack.push(li);
        undoStepBtn.classList.remove("hidden");
      });
    });
    undoStepBtn.addEventListener("click", () => {
      const last = hiddenStepStack.pop();
      if (last) last.classList.remove("is-masked-item");
      if (hiddenStepStack.length === 0) undoStepBtn.classList.add("hidden");
    });

    // Lancement des minuteurs
    spread.querySelectorAll(".inline-timer-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        startKitchenTimer(Number(btn.dataset.seconds), btn.dataset.label);
      });
    });
  }
  function renderGrid() {
    const query = $("search-text").value.trim().toLowerCase();
    const cat = $("filter-category").value;
    const maxTime = Number($("filter-time").value) || Infinity;
    const exclude = $("filter-exclude").value.trim().toLowerCase();

    const filtered = recipes.filter((r) => {
      const totalTime = (Number(r.prepTime) || 0) + (Number(r.cookTime) || 0);
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
      return true;
    });

    $("grid-stats").textContent = `${filtered.length} formule(s) trouvée(s) sur ${recipes.length}`;
    const grid = $("recipe-grid");

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
  }

  async function runSync(showStatusInModal = false) {
    const statusEl = $("sync-status");
    const btn = $("btn-sync-now");
    btn.disabled = true;
    btn.textContent = "…";
    if (showStatusInModal) {
      statusEl.classList.remove("error");
      statusEl.textContent = "Synchronisation en cours...";
    }

    try {
      const count = await RecipeDB.pullFromCloud();
      await refreshData();
      if (showStatusInModal) statusEl.textContent = `Synchro réussie : ${count} formule(s) chargée(s).`;
    } catch (err) {
      if (showStatusInModal) {
        statusEl.classList.add("error");
        statusEl.textContent = `Erreur : ${err.message}`;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "↻";
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
    $("grimoire-book").addEventListener("click", openGrimoire);
    $("grimoire-book").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openGrimoire();
      }
    });
    $("btn-close-grimoire").addEventListener("click", closeGrimoire);
    $("btn-toggle-topbar").addEventListener("click", () => {
      const topbar = $("topbar");
      const collapsed = topbar.classList.toggle("is-collapsed");
      $("btn-toggle-topbar").setAttribute("aria-expanded", String(!collapsed));
      $("topbar-toggle-icon").textContent = collapsed ? "▼" : "▲";
      $("topbar-toggle-label").textContent = collapsed ? "Menu" : "Rétracter";
    });

    $("btn-view-book").addEventListener("click", () => switchView("book"));
    $("btn-view-grid").addEventListener("click", () => switchView("grid"));
    $("btn-new-recipe").addEventListener("click", () => openEditor(null));
    $("btn-sync-now").addEventListener("click", () => runSync(false));

    $("quick-import-input").addEventListener("change", async (e) => {
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

    $("btn-sync-config").addEventListener("click", () => {
      const cfg = RecipeDB.getSyncConfig();
      $("sync-url").value = cfg.url;
      $("sync-token").value = cfg.token;
      $("sync-status").textContent = "";
      $("modal-sync").classList.remove("hidden");
    });

    $("sync-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      RecipeDB.setSyncConfig($("sync-url").value, $("sync-token").value);
      await runSync(true);
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => $(btn.dataset.close).classList.add("hidden"));
    });

    $("btn-prev-page").addEventListener("click", goPrev);
    $("btn-next-page").addEventListener("click", goNext);

    document.addEventListener("keydown", (e) => {
      if (isCoverVisible() || !$("view-book").classList.contains("active") || !$("modal-editor").classList.contains("hidden")) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    });

    let touchStartX = 0;
    $("book-spread").addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    $("book-spread").addEventListener("touchend", (e) => {
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (diff > 60) goPrev();
      if (diff < -60) goNext();
    }, { passive: true });
$("btn-wake-lock").addEventListener("click", toggleWakeLock);
    $("btn-edit-current").addEventListener("click", () => {
      if (recipes[currentIndex]) openEditor(recipes[currentIndex]);
    });

    $("btn-delete-current").addEventListener("click", async () => {
      const current = recipes[currentIndex];
      if (!current || !confirm(`Bannir définitivement « ${current.title} » du grimoire ?`)) return;
      await RecipeDB.remove(current.id);
      await refreshData();
    });

    ["search-text", "filter-category", "filter-time", "filter-exclude"].forEach((id) => {
      $(id).addEventListener("input", renderGrid);
    });

    $("btn-parse-raw").addEventListener("click", () => parseRawRecipe($("raw-text-input").value));

    $("recipe-form").addEventListener("submit", async (e) => {
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
