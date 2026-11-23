(() => {
  let recipes = [];
  let currentIndex = 0;
  let editingId = null;
  let isOpening = false;
  let wakeLock = null;
  let currentServings = null;
  let lastRecipeId = null;
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
    $("view-planner").classList.toggle("active", viewName === "planner");

    $("btn-view-book").classList.toggle("active", viewName === "book");
    $("btn-view-grid").classList.toggle("active", viewName === "grid");
    $("btn-view-planner").classList.toggle("active", viewName === "planner");

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
