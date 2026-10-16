(function () {
  var NS = "aia:";
  function store(op, key, value) {
    try {
      if (op === "get") return window.localStorage.getItem(NS + key);
      if (op === "set") { window.localStorage.setItem(NS + key, value); return true; }
      if (op === "del") { window.localStorage.removeItem(NS + key); return true; }
    } catch (e) {}
    return op === "get" ? null : false;
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".copy");
    if (!btn) return;
    var code = btn.closest(".code").querySelector("code");
    var text = code.innerText;
    function done(ok) {
      btn.textContent = ok ? "Copied" : "Press and hold to copy";
      setTimeout(function () { btn.textContent = "Copy"; }, 1600);
    }
    function legacy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        done(ok);
      } catch (err) { done(false); }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, legacy);
    } else {
      legacy();
    }
  });

  function initHome() {
    var cards = document.querySelectorAll(".card[data-slug]");
    var total = cards.length, finished = 0;
    cards.forEach(function (card) {
      var isDone = store("get", "done:" + card.getAttribute("data-slug")) === "1";
      var state = card.querySelector(".state");
      if (isDone) {
        finished++;
        state.setAttribute("data-state", "done");
        state.textContent = "Done";
        state.setAttribute("aria-label", "Done");
      }
    });
    var p = document.getElementById("progress");
    if (p && total) p.textContent = finished + " of " + total + " lessons done";
  }

  function initLesson() {
    var article = document.querySelector("article.lesson[data-slug]");
    if (!article) return;
    var slug = article.getAttribute("data-slug");
    var btn = document.getElementById("done-btn");
    var area = document.getElementById("predictions");
    var status = document.getElementById("save-status");
    function paint(on) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.querySelector(".label").textContent = on ? "Done" : "Mark as done";
    }
    paint(store("get", "done:" + slug) === "1");
    btn.addEventListener("click", function () {
      var on = btn.getAttribute("aria-pressed") !== "true";
      var ok = on ? store("set", "done:" + slug, "1") : store("del", "done:" + slug);
      paint(on);
      status.textContent = ok ? "" : "Browser storage is unavailable, so this will not be remembered.";
    });
    var saved = store("get", "pred:" + slug);
    if (saved) area.value = saved;
    var timer;
    area.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var ok = store("set", "pred:" + slug, area.value);
        status.textContent = ok ? "Saved in this browser." : "Browser storage is unavailable, so this text will not be kept.";
      }, 400);
    });
  }

  function initToc() {
    var d = document.getElementById("toc-details");
    if (d && window.matchMedia("(max-width: 61.99rem)").matches) d.removeAttribute("open");
    var links = document.querySelectorAll(".toc a");
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          links.forEach(function (a) { a.classList.remove("active"); });
          map[en.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-10% 0px -80% 0px" });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  function initMermaid() {
    var nodes = document.querySelectorAll("pre.mermaid");
    if (!nodes.length) return;
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    function run() {
      if (!window.mermaid) return;
      window.mermaid.initialize({ startOnLoad: false, theme: mq.matches ? "dark" : "default", securityLevel: "strict", flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true } });
      nodes.forEach(function (n) {
        n.removeAttribute("data-processed");
        n.textContent = n.getAttribute("data-src");
      });
      window.mermaid.run({ nodes: nodes }).catch(function () {});
    }
    if (window.mermaid) run();
    else window.addEventListener("load", run);
    if (mq.addEventListener) mq.addEventListener("change", run);
  }

  function initOffline() {
    var badge = document.getElementById("offline");
    function sync() { if (badge) badge.hidden = navigator.onLine !== false; }
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initHome(); initLesson(); initToc(); initMermaid(); initOffline();
  });
})();
