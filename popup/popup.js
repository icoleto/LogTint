(function () {
  "use strict";

  const globalEnabledEl = document.getElementById("globalEnabled");
  const hostDisabledEl = document.getElementById("hostDisabled");
  const hostLabelEl = document.getElementById("hostLabel");
  const rescanBtn = document.getElementById("rescanBtn");

  let currentHost = "";

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0]);
      });
    });
  }

  function loadSettings() {
    chrome.storage.local.get({ globalEnabled: true, disabledHosts: [] }, (settings) => {
      globalEnabledEl.checked = settings.globalEnabled;
      hostDisabledEl.checked = settings.disabledHosts.includes(currentHost);
    });
  }

  async function init() {
    const tab = await getActiveTab();
    if (tab && tab.url) {
      try {
        currentHost = new URL(tab.url).hostname;
      } catch (e) {
        currentHost = "";
      }
    }
    hostLabelEl.textContent = currentHost
      ? `Desactivar en ${currentHost}`
      : "Desactivar en este sitio";
    loadSettings();
  }

  globalEnabledEl.addEventListener("change", () => {
    chrome.storage.local.set({ globalEnabled: globalEnabledEl.checked });
  });

  hostDisabledEl.addEventListener("change", () => {
    if (!currentHost) return;
    chrome.storage.local.get({ disabledHosts: [] }, (settings) => {
      const set = new Set(settings.disabledHosts);
      if (hostDisabledEl.checked) set.add(currentHost);
      else set.delete(currentHost);
      chrome.storage.local.set({ disabledHosts: Array.from(set) });
    });
  });

  rescanBtn.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        if (window.__logTint && typeof window.__logTint.rescan === "function") {
          window.__logTint.rescan();
        }
      }
    });
  });

  init();
})();
