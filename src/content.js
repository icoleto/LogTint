/**
 * LogTint - content script.
 *
 * Detecta nodos de texto con secuencias ANSI y los reemplaza por HTML
 * coloreado, en tiempo real, usando MutationObserver para nuevo contenido
 * (streaming de logs) y un escaneo inicial para el contenido ya presente.
 */
(function () {
  "use strict";

  if (window.__logTintLoaded) return;
  window.__logTintLoaded = true;

  const TAG_SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"]);

  let enabled = true;
  let pending = new Set();
  let rafScheduled = false;

  // Editores Ace (u otros widgets con render loop propio) ya enganchados,
  // para no registrar el listener "afterRender" más de una vez por instancia.
  const hookedAceEditors = new WeakSet();

  function getHostname() {
    try {
      return location.hostname;
    } catch (e) {
      return "";
    }
  }

  function shouldSkipElement(el) {
    while (el) {
      if (el.nodeType === Node.ELEMENT_NODE) {
        if (TAG_SKIP.has(el.tagName)) return true;
        if (el.isContentEditable) return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  // Reemplaza un nodo de texto por el HTML equivalente coloreado.
  function processTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentNode;
    if (!parent) return;
    if (shouldSkipElement(parent)) return;

    const text = node.nodeValue;
    if (!text || !window.LogTint.containsAnsi(text)) return;

    const html = window.LogTint.ansiToHtml(text);
    if (html === null) return;

    const wrapper = document.createElement("span");
    wrapper.className = "logtint-line";
    // El HTML generado por ansiToHtml escapa todo el texto de usuario;
    // solo introduce marcado <span style="..."> controlado por nosotros.
    wrapper.innerHTML = html;
    parent.replaceChild(wrapper, node);
  }

  // Recorre un subárbol en busca de nodos de texto con ANSI.
  function scanSubtree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE && TAG_SKIP.has(root.tagName)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return shouldSkipElement(n.parentNode)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    // Procesar tras recolectar, para no mutar el árbol mientras se camina.
    nodes.forEach(processTextNode);
  }

  function flushPending() {
    rafScheduled = false;
    const targets = pending;
    pending = new Set();
    targets.forEach(scanSubtree);
  }

  // --- Integración con Ace Editor -----------------------------------------
  //
  // Ace Editor (y widgets similares con "render loop" propio) gestionan su
  // propio DOM: virtualizan las líneas visibles y las regeneran desde su
  // modelo interno de datos en cada repintado (scroll, nuevas líneas, etc.).
  // Si solo confiamos en MutationObserver, Ace puede pisar nuestro HTML
  // coloreado en el mismo frame en que lo insertamos, dando la sensación de
  // que "no pinta". La solución es engancharnos al evento propio de Ace
  // ("afterRender") y reprocesar justo después de cada uno de sus repintados,
  // en vez de competir con él.
  //
  // Ace expone la instancia del editor como `container.env.editor` sobre el
  // mismo elemento DOM que se le pasó a `ace.edit(container)`. Como los
  // content scripts comparten los nodos DOM con la página (solo el ámbito de
  // JS está aislado), podemos leer esa propiedad sin acceso privilegiado.
  function tryHookAceEditor(container, attemptsLeft) {
    if (hookedAceEditors.has(container)) return;

    const env = container.env;
    const editor = env && env.editor;
    const renderer = editor && editor.renderer;

    if (!renderer || typeof renderer.on !== "function") {
      // El editor puede tardar un tick en inicializarse tras insertarse
      // el contenedor en el DOM; reintentamos unas pocas veces.
      if (attemptsLeft > 0) {
        setTimeout(() => tryHookAceEditor(container, attemptsLeft - 1), 150);
      } else {
        console.debug("[LogTint] Ace editor detectado pero no se pudo enganchar (env.editor no disponible)", container);
      }
      return;
    }

    hookedAceEditors.add(container);
    const rescan = () => scanSubtree(container);
    renderer.on("afterRender", rescan);
    rescan();
    console.debug("[LogTint] Ace editor detectado y enganchado a afterRender", container);
  }

  function hookAceEditorsIn(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      // El propio nodo puede ser el editor (p. ej. cuando se añade
      // directamente, sin un ancestro común capturado por querySelectorAll).
      if (root && root.classList && root.classList.contains("ace_editor")) {
        tryHookAceEditor(root, 10);
      }
      return;
    }
    if (root.classList && root.classList.contains("ace_editor")) {
      tryHookAceEditor(root, 10);
    }
    root.querySelectorAll(".ace_editor").forEach((el) => tryHookAceEditor(el, 10));
  }

  function scheduleScan(node) {
    pending.add(node);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushPending);
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          scheduleScan(node);
          if (node.nodeType === Node.ELEMENT_NODE) hookAceEditorsIn(node);
        });
      } else if (mutation.type === "characterData") {
        scheduleScan(mutation.target);
      }
    }
  });

  function startObserving() {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function stopObserving() {
    observer.disconnect();
  }

  function initialScan() {
    scanSubtree(document.body);
    hookAceEditorsIn(document.body);
  }

  function applyEnabledState(nextEnabled) {
    enabled = nextEnabled;
    if (enabled) {
      initialScan();
      startObserving();
    } else {
      stopObserving();
    }
  }

  function loadSettingsAndStart() {
    chrome.storage.local.get(
      { globalEnabled: true, disabledHosts: [] },
      (settings) => {
        const host = getHostname();
        const isDisabledHere = settings.disabledHosts.includes(host);
        applyEnabledState(settings.globalEnabled && !isDisabledHere);
      }
    );
  }

  // Reacciona a cambios de configuración desde el popup en tiempo real.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!("globalEnabled" in changes) && !("disabledHosts" in changes)) return;
    loadSettingsAndStart();
  });

  // API expuesta para el popup (re-escaneo manual bajo demanda).
  window.__logTint = {
    rescan: initialScan,
    isEnabled: () => enabled
  };

  loadSettingsAndStart();
})();
