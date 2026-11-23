const RecipeDB = (() => {
  const DB_NAME = "FamilyCookbookDB";
  const DB_VERSION = 1;
  const STORE_NAME = "recipes";
  const DEFAULT_URL = "https://script.google.com/macros/s/AKfycbxvkg-BSh-PDr3dL1hjXt2pLJCuGzl_VyRe4wmLP_VTSqnvHqKi7a0iWq7AIxq2ZPdguw/exec";
  let dbInstance = null;

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
      token: localStorage.getItem("cookbook_sync_token") || ""
    };
  }

  function setSyncConfig(url, token) {
    localStorage.setItem("cookbook_sync_url", url.trim());
    localStorage.setItem("cookbook_sync_token", token.trim());
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

    // text/plain contourne le preflight CORS (OPTIONS) non géré par Google Apps Script
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, token })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function save(recipe) {
    await saveLocal(recipe);
    try { await pushToCloud({ action: "upsert", recipe }); } catch (_) {}
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
    try { await pushToCloud({ action: "delete", id }); } catch (_) {}
  }

  async function pullFromCloud() {
    const { url, token } = getSyncConfig();
    if (!url || !token) throw new Error("Mot de passe famille non configuré.");
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await clearAndReplaceLocal(data.recipes || []);
    return (data.recipes || []).length;
  }

  async function parseFileWithCloud(base64, mimeType, fileName) {
    const data = await pushToCloud({ action: "parse", base64, mimeType, fileName });
    return data.recipe;
  }

  return { getAll, save, remove, pullFromCloud, parseFileWithCloud, getSyncConfig, setSyncConfig };
})();