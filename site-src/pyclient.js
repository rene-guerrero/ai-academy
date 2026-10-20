(function () {
  var P = window.__PAGE || {};
  var R = P.runtime;
  function Client() {
    this.worker = null;
    this.pending = {};
    this.seq = 0;
    this.listeners = [];
  }
  Client.prototype.available = function () {
    return Boolean(R) && typeof WebAssembly === "object" && typeof Worker === "function";
  };
  Client.prototype.onEvent = function (fn) { this.listeners.push(fn); };
  Client.prototype._ensure = function () {
    var self = this;
    if (this.worker) return this.worker;
    this.worker = new Worker(R.base + "py-worker.mjs", { type: "module" });
    this.worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === "result") {
        var p = self.pending[m.id];
        delete self.pending[m.id];
        if (!p) return;
        if (m.error) p.reject(new Error(m.error));
        else p.resolve({ value: JSON.parse(m.json), ms: m.ms });
        return;
      }
      self.listeners.forEach(function (fn) { fn(m); });
    };
    this.worker.onerror = function (e) {
      Object.keys(self.pending).forEach(function (k) { self.pending[k].reject(new Error(e.message || "worker error")); });
      self.pending = {};
      self.worker = null;
    };
    return this.worker;
  };
  Client.prototype.eval = function (code, opts) {
    var self = this;
    var id = ++this.seq;
    return new Promise(function (resolve, reject) {
      self.pending[id] = { resolve: resolve, reject: reject };
      self._ensure().postMessage({ type: "eval", id: id, code: code, persist: Boolean(opts && opts.persist) });
    });
  };
  Client.prototype.stop = function () {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    var p = this.pending;
    this.pending = {};
    Object.keys(p).forEach(function (k) { p[k].reject(new Error("stopped")); });
  };
  window.PyClient = Client;
  window.aiaFormatMB = function (b) { return (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + " MB"; };
})();
