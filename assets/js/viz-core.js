/* Shared plumbing for the dashboard scripts.
 *
 * running.js and forecast.js read different files, fail apart, and share no
 * state -- but they were carrying byte-identical copies of the same dozen
 * helpers: the palette read, HTML escaping, the table builder, the tooltip
 * chrome, number and clock formatting, the date labels. Two copies is two
 * places to fix a bug in, and they had already drifted (`pace` here was
 * `clock` there).
 *
 * This is a third file both depend on rather than a dependency between them:
 * the same relationship they already have with the vendored Chart.js. Neither
 * script knows the other exists, and either can still be deleted on its own.
 */
window.VizCore = (function () {
  "use strict";

  var KM_PER_MI = 1.609344;

  // -- palette ------------------------------------------------------------

  /* Read from the stylesheet rather than repeating the hexes, so there is one
     place to change a colour. */
  function token(name, fallback) {
    var root = document.querySelector(".viz-root");
    if (!root) return fallback;
    var value = getComputedStyle(root).getPropertyValue(name);
    return (value && value.trim()) || fallback;
  }

  function palette() {
    return {
      surface: token("--surface-1", "#ffffff"),
      textPrimary: token("--text-primary", "#0b0b0b"),
      textSecondary: token("--text-secondary", "#52514e"),
      muted: token("--text-muted", "#898781"),
      gridline: token("--gridline", "#e1e0d9"),
      baseline: token("--baseline", "#c3c2b7"),
      series1: token("--series-1", "#2a78d6"),
      series2: token("--series-2", "#eb6834"),
      series3: token("--series-3", "#1baf7a"),
      neutral: token("--series-neutral", "#7a7873"),
    };
  }

  // -- markup -------------------------------------------------------------

  /* Cells, tiles and legends are assembled as HTML strings, so anything that
     came out of a JSON file has to be escaped at the point it goes in. */
  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }

  function setText(id, html) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = html;
  }

  /* First cell of every row is the row header, and the whole table scrolls
     inside its own box rather than widening the page. */
  function renderTable(id, columns, rows) {
    var host = document.getElementById(id);
    if (!host) return;
    var head = "<thead><tr>" + columns.map(function (c) {
      return "<th scope=\"col\">" + c + "</th>";
    }).join("") + "</tr></thead>";
    var body = "<tbody>" + rows.map(function (row) {
      return "<tr>" + row.map(function (cell, i) {
        return i === 0 ? "<th scope=\"row\">" + cell + "</th>" : "<td>" + cell + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody>";
    host.innerHTML = "<div class=\"viz-table-scroll\"><table>" + head + body + "</table></div>";
  }

  // -- charts -------------------------------------------------------------

  var charts = {};

  /* Keyed by canvas id, which is unique across the page, so one registry
     serves both callers. Re-drawing destroys the previous chart -- Chart.js
     leaves the old one bound to the canvas otherwise. */
  function draw(id, config) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas.getContext("2d"), config);
  }

  function tooltip(C, callbacks) {
    return {
      backgroundColor: C.textPrimary,
      titleColor: "#ffffff",
      bodyColor: "#ffffff",
      borderWidth: 0,
      padding: 10,
      cornerRadius: 6,
      displayColors: true,
      boxWidth: 10,
      boxHeight: 10,
      boxPadding: 4,
      callbacks: callbacks || {},
    };
  }

  // -- formatting ---------------------------------------------------------

  function num(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    var places = digits === undefined ? 1 : digits;
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    });
  }

  /* m:ss. A pace of zero is a missing pace, not a very fast one -- callers
     reach this with `null * 1.609`, which JavaScript makes 0. */
  function mmss(minutes) {
    if (!minutes || !isFinite(minutes)) return "–";
    var total = Math.round(minutes * 60);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* The same, but carrying hours once a session runs past one. A column of
     times reads better aligned than duration()'s "1h 05m" does in prose. */
  function clock(minutes) {
    if (!minutes || !isFinite(minutes)) return "–";
    var total = Math.round(minutes * 60);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // -- dates --------------------------------------------------------------

  /* The published dates are bare days. Parsing them with a time attached
     keeps them in the reader's own zone instead of shifting a UTC midnight
     back a day west of Greenwich. */
  function parseDay(iso) {
    return new Date(iso + "T00:00:00");
  }

  function shortDate(iso) {
    return parseDay(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function longDate(iso) {
    return parseDay(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // -- loading ------------------------------------------------------------

  function loadJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  return {
    KM_PER_MI: KM_PER_MI,
    token: token,
    palette: palette,
    esc: esc,
    setText: setText,
    renderTable: renderTable,
    draw: draw,
    tooltip: tooltip,
    num: num,
    mmss: mmss,
    clock: clock,
    parseDay: parseDay,
    shortDate: shortDate,
    longDate: longDate,
    loadJSON: loadJSON,
    onReady: onReady,
  };
})();
