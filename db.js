const RecipeDB = (() => {
  const DB_NAME = "FamilyCookbookDB";
  const DB_VERSION = 1;
  const STORE_NAME = "recipes";
  const DEFAULT_URL = "https://script.google.com/macros/s/AKfycbxvkg-BSh-PDr3dL1hjXt2pLJCuGzl_VyRe4wmLP_VTSqnvHqKi7a0iWq7AIxq2ZPdguw/exec";
  const PENDING_KEY = "cookbook_pending_ops";
  const PLANNER_KEY = "cookbook_weekly_planner";
  const PIN_KEY = "cookbook_ban_pin";

  let dbInstance = null;
  let syncStatus = navigator.onLine ? "synced" : "offline";
  const statusListeners = [];

  function notifyStatus(status) {
    syncStatus = status;
    statusListeners.forEach((fn) => fn(status));
  }

  function onSyncStatusChange(fn) {
    statusListeners.push(fn);
    fn(getSyncStatus());
  }

  function getPendingOps() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); }
    catch (_) { return []; }
  }

  function setPendingOps(ops) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(ops));
    if (!navigator.onLine) notifyStatus("offline");
    else if (ops.length > 0) notifyStatus("pending");
    else notifyStatus("synced");
  }

  function queueOp(op) {
    const ops = getPendingOps().filter((item) => !(item.type === op.type && item.id === op.id));
    ops.push(op);
    setPendingOps(ops);
  }

  function getSyncStatus() {
    if (!navigator.onLine) return "offline";
    if (getPendingOps().length > 0) return "pending";
    return syncStatus;
  }

  window.addEventListener("online", () => {
    notifyStatus(getPendingOps().length > 0 ? "pending" : "synced");
  });
  window.addEventListener("offline", () => notifyStatus("offline"));

  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
          e.target.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = () => reject(req.error);
    });
  }

  function getSyncConfig() {
    return {
      url: localStorage.getItem("cookbook_sync_url") || DEFAULT_URL,
      token: localStorage.getItem("cookbook_sync_token") || "",
      pin: localStorage.getItem(PIN_KEY) || ""
    };
  }

  function setSyncConfig(url, token, pin = null) {
    localStorage.setItem("cookbook_sync_url", url.trim());
    localStorage.setItem("cookbook_sync_token", token.trim());
    if (pin !== null && /^\d{4}$/.test(pin.trim())) {
      localStorage.setItem(PIN_KEY, pin.trim());
    }
  }

  function getBanPin() {
    return localStorage.getItem(PIN_KEY) || "";
  }

  function setBanPin(pin) {
    if (/^\d{4}$/.test(String(pin).trim())) {
      localStorage.setItem(PIN_KEY, String(pin).trim());
      return true;
    }
    return false;
  }

  function getPlanner() {
    try { return JSON.parse(localStorage.getItem(PLANNER_KEY) || "{}"); }
    catch (_) { return {}; }
  }

  async function savePlanner(plannerObj) {
    localStorage.setItem(PLANNER_KEY, JSON.stringify(plannerObj));
    try {
      await pushToCloud({ action: "savePlanner", planner: plannerObj });
    } catch (_) {}
  }

  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => a.title.localeCompare(b.title, "fr"));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveLocal(recipe) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(recipe);
      tx.oncomplete = () => resolve(recipe);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAndReplaceLocal(list) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const item of list) store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function pushToCloud(payload) {
    const { url, token } = getSyncConfig();
    if (!url || !token) throw new Error("Configure d'abord le mot de passe dans Synchro.");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, token })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function flushPendingOps() {
    const ops = getPendingOps();
    if (!ops.length) return;
    const remaining = [];
    for (const op of ops) {
      try {
        if (op.type === "upsert") await pushToCloud({ action: "upsert", recipe: op.recipe });
        else if (op.type === "delete") await pushToCloud({ action: "delete", id: op.id });
      } catch (_) {
        remaining.push(op);
      }
    }
    setPendingOps(remaining);
  }

  async function save(recipe) {
    await saveLocal(recipe);
    try {
      await pushToCloud({ action: "upsert", recipe });
      notifyStatus(getPendingOps().length ? "pending" : "synced");
    } catch (_) {
      queueOp({ type: "upsert", id: recipe.id, recipe });
    }
    return recipe;
  }

  async function remove(id) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    try {
      await pushToCloud({ action: "delete", id });
      notifyStatus(getPendingOps().length ? "pending" : "synced");
    } catch (_) {
      queueOp({ type: "delete", id });
    }
  }

  async function pullFromCloud() {
    const { url, token } = getSyncConfig();
    if (!url || !token) throw new Error("Mot de passe famille non configuré.");
    try {
      await flushPendingOps();
      const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await clearAndReplaceLocal(data.recipes || []);
      if (data.planner && typeof data.planner === "object") {
        localStorage.setItem(PLANNER_KEY, JSON.stringify(data.planner));
      }
      notifyStatus(getPendingOps().length ? "pending" : "synced");
      return (data.recipes || []).length;
    } catch (err) {
      notifyStatus(navigator.onLine ? "error" : "offline");
      throw err;
    }
  }

  async function parseFileWithCloud(base64, mimeType, fileName) {
    const data = await pushToCloud({ action: "parse", base64, mimeType, fileName });
    return data.recipe;
  }

  return {
    getAll, save, remove, pullFromCloud, parseFileWithCloud,
    getSyncConfig, setSyncConfig, getSyncStatus, onSyncStatusChange,
    getBanPin, setBanPin, getPlanner, savePlanner
  };
})();
