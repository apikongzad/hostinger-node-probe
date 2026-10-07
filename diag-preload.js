'use strict';
// diag-preload.js (temporary diagnostic, remove after use).
// Usage: node --require /abs/path/diag-preload.js <next standalone server.js>
// Zero dependencies, CommonJS. Never prints env values.
const Module = require("module");
const origLoad = Module._load;
function fromName(p) {
  return (p && p.filename) ? p.filename : "-";
}
function errCode(e) {
  return (e && e.code) ? String(e.code) : "-";
}
function errMsg(e) {
  try {
    return String((e && e.message) || e).slice(0, 300);
  } catch (_) {
    return "-";
  }
}
function isTraced(r) {
  return typeof r === "string" && (r.indexOf("middleware") !== -1 || r.indexOf("functions-config-manifest") !== -1 || r.indexOf("middleware-manifest") !== -1);
}
const nm = (typeof process.env.NEXT_MINIMAL === "undefined") ? "unset" : "set";
const nen = String(process.env.NODE_ENV);
process.stderr.write("[diag-preload] start pid=" + process.pid + " node=" + process.version + " NEXT_MINIMAL=" + nm + " NODE_ENV=" + nen + "\n");
Module._load = function (request, parent, isMain) {
  const from = fromName(parent);
  const traced = isTraced(request);
  try {
    const res = origLoad.apply(this, arguments);
    if (traced) process.stderr.write("[diag-preload] load " + request + " from " + from + " -> ok\n");
    return res;
  } catch (e) {
    const c = errCode(e);
    const m = errMsg(e);
    if (traced) process.stderr.write("[diag-preload] load " + request + " from " + from + " -> ERR " + c + " " + m + "\n");
    process.stderr.write("[diag-preload] FAIL " + request + " from " + from + " " + c + " " + m + "\n");
    throw e;
  }
};
process.on("uncaughtException", function (e) {
  try {
    const s = String((e && e.stack) || e).slice(0, 1500);
    process.stderr.write("[diag-preload] uncaught " + s + "\n");
  } catch (_) {}
  process.exit(1);
});
process.on("unhandledRejection", function (e) {
  try {
    const s = String((e && e.stack) || e).slice(0, 1500);
    process.stderr.write("[diag-preload] unhandled " + s + "\n");
  } catch (_) {}
});
