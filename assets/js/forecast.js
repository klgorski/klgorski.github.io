/* Forecast charts.
 *
 * Reads assets/data/forecast.json, written by the same daily workflow that
 * writes summary.json. That file holds two fitted models of pace -- a log
 * trend with ARMA errors and a local linear trend -- each with a bootstrapped
 * forecast, and the estimated coefficients behind them.
 *
 * The page draws from those numbers rather than embedding pictures, so a new
 * run moves the fan the next morning with nothing to re-render. If the file is
 * missing or its schema moved, this whole section hides itself: a stale or
 * unreadable model is worth less than no model, and the rest of the dashboard
 * does not depend on it.
 *
 * Independent of running.js on purpose -- these are separate files that fail
 * separately. The one thing they share is the km/miles toggle, which both bind
 * to by listening for the same click rather than by talking to each other.
 */
(function () {
  "use strict";

  var DATA_URL = document.currentScript && document.currentScript.dataset.src;
  var SCHEMA = 1;
  var KM_PER_MI = 1.609344;

  var C = {};
  var payload = null;
  // payload is assigned before the schema/shape checks run, so "assigned" is
  // not the same as "usable". renderAll() waits on this instead.
  var ready = false;
  var charts = {};
  var unit = "km";

  // -- palette ------------------------------------------------------------

  function token(name, fallback) {
    var root = document.querySelector(".viz-root");
    if (!root) return fallback;
    var value = getComputedStyle(root).getPropertyValue(name);
    return (value && value.trim()) || fallback;
  }

  /* The bands are the model's own hue at low opacity, not a separate color:
     they are the same entity as the forecast line, drawn less certainly. */
  function fade(hex, alpha) {
    var value = String(hex).trim().replace("#", "");
    if (value.length === 3) {
      value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
    }
    if (!/^[0-9a-f]{6}$/i.test(value)) return "rgba(235, 104, 52, " + alpha + ")";
    return (
      "rgba(" +
      parseInt(value.slice(0, 2), 16) + ", " +
      parseInt(value.slice(2, 4), 16) + ", " +
      parseInt(value.slice(4, 6), 16) + ", " +
      alpha + ")"
    );
  }

  // -- units --------------------------------------------------------------

  /* The response is whatever metric the model was fitted to, and only some of
     them convert. The publisher says which kind it is (unit_kind) rather than
     leaving JavaScript to guess from the column name. */
  function convert(value) {
    if (value === null || value === undefined) return null;
    if (unit !== "mi") return value;
    if (payload.unit_kind === "pace_min_per_km") return value * KM_PER_MI;
    if (payload.unit_kind === "speed_kmh") return value / KM_PER_MI;
    return value;
  }

  function isPace() {
    return payload && payload.unit_kind === "pace_min_per_km";
  }

  function responseUnit() {
    if (isPace()) return unit === "mi" ? "min/mi" : "min/km";
    if (payload.unit_kind === "speed_kmh") return unit === "mi" ? "mph" : "km/h";
    return nativeUnit();
  }

  /* Coefficients are never converted. "min/km per metre climbed" is a ratio of
     two units, and scaling only the numerator would quietly produce a number
     that means nothing -- so the parameter tables stay in the units the model
     was estimated in, and say so. */
  function nativeUnit() {
    if (payload.unit_kind === "pace_min_per_km") return "min/km";
    if (payload.unit_kind === "speed_kmh") return "km/h";
    if (payload.unit_kind === "minutes") return "min";
    if (payload.unit_kind === "distance_km") return "km";
    if (payload.unit_kind === "bpm") return "bpm";
    return "";
  }

  // -- formatting ---------------------------------------------------------

  function num(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: digits === undefined ? 2 : digits,
    });
  }

  function clock(minutes) {
    if (minutes === null || minutes === undefined || !isFinite(minutes)) return "–";
    var total = Math.round(minutes * 60);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* Paces read as mm:ss; everything else reads as a number. */
  function value(v, digits) {
    if (v === null || v === undefined) return "–";
    return isPace() ? clock(v) : num(v, digits);
  }

  function signed(v, digits) {
    if (v === null || v === undefined) return "–";
    return (v > 0 ? "+" : "") + num(v, digits === undefined ? 3 : digits);
  }

  function pvalue(p) {
    if (p === null || p === undefined) return "–";
    if (p < 0.001) return "<0.001";
    return num(p, 3);
  }

  function shortDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function longDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function setText(id, html) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = html;
  }

  // -- coefficient names --------------------------------------------------

  /* statsmodels' parameter names are the model's, not the reader's. The
     mapping is explicit rather than a prettifier, so a name this page has
     never seen shows up as itself instead of as something invented. */
  var PARAM_LABELS = {
    intercept: "Intercept",
    const: "Intercept",
    log_t: "log(t) — trend",
    distance_km: "Distance",
    total_elevation_gain: "Elevation gain",
    sigma2: "σ² innovation",
    "sigma2.irregular": "σ² irregular",
    "sigma2.level": "σ² level",
    "sigma2.trend": "σ² slope",
  };

  var PARAM_UNITS = {
    log_t: "per log-session",
    distance_km: "per km",
    total_elevation_gain: "per m climbed",
  };

  // Parameter names come from statsmodels, not from anything a person typed,
  // but the unmapped fallback returns them verbatim into an innerHTML table --
  // so escape there rather than rely on that staying true.
  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }

  function paramLabel(name) {
    var bare = name.indexOf("beta.") === 0 ? name.slice(5) : name;
    if (PARAM_LABELS[bare]) return PARAM_LABELS[bare];
    var ar = /^ar\.L(\d+)$/.exec(bare);
    if (ar) return "AR(" + ar[1] + ")";
    var ma = /^ma\.L(\d+)$/.exec(bare);
    if (ma) return "MA(" + ma[1] + ")";
    return esc(bare);
  }

  function paramUnit(name) {
    var bare = name.indexOf("beta.") === 0 ? name.slice(5) : name;
    return PARAM_UNITS[bare] || "";
  }

  // -- chart chrome -------------------------------------------------------

  function tooltip(callbacks) {
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

  function draw(id, config) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas.getContext("2d"), config);
  }

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

  // -- the fan chart ------------------------------------------------------

  /* One series of observations, one fitted line, and the forecast fan.
   *
   * The bands are built as pairs of line datasets where the upper one fills
   * down to the lower ("fill: '-1'" is the previous dataset). Both members of
   * a pair carry the forecast-origin value at index n-1, so the fan opens from
   * the last fitted point at zero width rather than appearing out of nowhere
   * one step later. */
  function fanChart(id, model) {
    var observed = payload.observed;
    var n = observed.length;
    var steps = model.forecast;
    var labels = observed.map(function (row) { return shortDate(row.date); })
      .concat(steps.map(function (row) { return "+" + row.step; }));

    var fitted = model.fitted.map(convert);
    var origin = fitted[n - 1];

    function future(key) {
      var out = new Array(n - 1).fill(null);
      out.push(origin);
      steps.forEach(function (row) { out.push(convert(row[key])); });
      return out;
    }

    function bandPair(key, label, alpha) {
      return [
        {
          label: label + " (lower)",
          data: future("lo" + key),
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
        },
        {
          label: label,
          data: future("hi" + key),
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          backgroundColor: fade(C.series2, alpha),
          fill: "-1",
        },
      ];
    }

    var datasets = bandPair("95", "95% interval", 0.14)
      .concat(bandPair("80", "80% interval", 0.26))
      .concat([
        {
          label: model.fitted_label,
          data: fitted.concat(new Array(steps.length).fill(null)),
          borderColor: C.series2,
          backgroundColor: C.series2,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 16,
          fill: false,
          spanGaps: false,
        },
        {
          label: "Forecast",
          data: future("mean"),
          borderColor: C.series2,
          backgroundColor: C.series2,
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          // A 2px surface ring, so a forecast point stays countable where the
          // band edges crowd it.
          pointBorderColor: C.surface,
          pointBorderWidth: 2,
          pointBackgroundColor: C.series2,
          fill: false,
          spanGaps: false,
        },
        {
          label: "Observed",
          data: observed.map(function (row) { return convert(row.value); })
            .concat(new Array(steps.length).fill(null)),
          borderColor: C.series1,
          backgroundColor: C.series1,
          borderWidth: 2,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointHitRadius: 16,
          pointBorderColor: C.surface,
          pointBorderWidth: 1.5,
          fill: false,
        },
      ]);

    // Named so the legend and the tooltip can both keep the band edges out.
    var SHOWN = ["Observed", model.fitted_label, "Forecast", "80% interval", "95% interval"];

    var unitLabel = responseUnit();

    draw(id, {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            grid: { display: false },
            border: { color: C.baseline },
            ticks: { color: C.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 16 },
          },
          y: {
            beginAtZero: false,
            // Faster is a smaller number, so a pace axis is reversed: up means
            // quicker, which is where a reader expects "better" to be.
            reverse: isPace(),
            grid: { color: C.gridline, drawTicks: false },
            border: { display: false },
            ticks: {
              color: C.muted,
              font: { size: 11 },
              padding: 8,
              callback: function (v) { return isPace() ? clock(v) : v; },
            },
            title: { display: true, text: unitLabel, color: C.muted, font: { size: 11 } },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              color: C.textSecondary,
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 2,
              useBorderRadius: true,
              font: { size: 12 },
              padding: 12,
              filter: function (item) { return SHOWN.indexOf(item.text) !== -1; },
            },
          },
          tooltip: tooltip({
            // Seven datasets share every index; only three of them are a value
            // anybody wants read out. The forecast line carries the fitted
            // value at the origin so the fan has something to open from -- it
            // is the same number the fitted line already shows there, so it is
            // dropped rather than read out twice.
            filter: function (item) {
              if (item.dataset.label === "Forecast" && item.dataIndex < n) return false;
              return ["Observed", model.fitted_label, "Forecast"].indexOf(item.dataset.label) !== -1;
            },
            title: function (items) {
              if (!items.length) return "";
              var i = items[0].dataIndex;
              return i < n ? longDate(observed[i].date) : "Session +" + steps[i - n].step;
            },
            label: function (item) {
              return item.dataset.label + ": " + value(item.parsed.y, 2) + " " + unitLabel;
            },
            afterBody: function (items) {
              if (!items.length) return [];
              var i = items[0].dataIndex;
              if (i < n) return [];
              var row = steps[i - n];
              return [
                "80%: " + value(convert(row.lo80), 2) + " – " + value(convert(row.hi80), 2),
                "95%: " + value(convert(row.lo95), 2) + " – " + value(convert(row.hi95), 2),
              ];
            },
          }),
        },
      },
    });
  }

  // -- tables -------------------------------------------------------------

  function forecastTable(id, model) {
    var u = responseUnit();
    renderTable(
      id,
      ["Session", "Forecast (" + u + ")", "80% interval", "95% interval"],
      model.forecast.map(function (row) {
        return [
          "+" + row.step,
          value(convert(row.mean), 2),
          value(convert(row.lo80), 2) + " – " + value(convert(row.hi80), 2),
          value(convert(row.lo95), 2) + " – " + value(convert(row.hi95), 2),
        ];
      })
    );
  }

  function historyTable(id, model) {
    var u = responseUnit();
    renderTable(
      id,
      ["Date", "Observed (" + u + ")", esc(model.fitted_label) + " (" + u + ")", "Distance (km)", "Elevation (m)"],
      payload.observed.map(function (row, i) {
        return [
          longDate(row.date),
          value(convert(row.value), 2),
          value(convert(model.fitted[i]), 2),
          num(row.distance_km, 2),
          num(row.elevation_m, 0),
        ];
      }).reverse()
    );
  }

  /* The coefficients, and the interval around each. Not behind a toggle: the
     estimates are the point of fitting a model, and a coefficient without its
     interval is a number pretending to be a fact. */
  function paramTable(id, model) {
    renderTable(
      id,
      ["Parameter", "Estimate", "Std. error", "p", "95% interval"],
      model.parameters.map(function (p) {
        var unitNote = paramUnit(p.name);
        return [
          paramLabel(p.name) + (unitNote ? " <span class=\"viz-unit\">" + unitNote + "</span>" : ""),
          signed(p.estimate, 4),
          num(p.std_err, 4),
          pvalue(p.p_value),
          p.ci_lower === null ? "–" : signed(p.ci_lower, 3) + " – " + signed(p.ci_upper, 3),
        ];
      })
    );
  }

  function bicTable(id, model) {
    if (!model.bic_grid) return;
    renderTable(
      id,
      ["Order (p, q)", "BIC", "ΔBIC", "Converged"],
      model.bic_grid.map(function (row) {
        var name = "ARMA(" + row.p + ", " + row.q + ")" + (row.selected ? " — selected" : "");
        return [
          row.selected ? "<strong>" + name + "</strong>" : name,
          num(row.bic, 2),
          row.delta ? "+" + num(row.delta, 2) : "–",
          row.converged ? "yes" : "no",
        ];
      })
    );
  }

  // -- headline numbers ---------------------------------------------------

  function renderHeadline() {
    var arma = byKey("log_arma");
    var llt = byKey("local_linear_trend");
    var u = responseUnit();

    var trend = arma && arma.parameters.filter(function (p) { return p.name === "log_t"; })[0];
    if (trend) {
      setText("forecast-trend", signed(trend.estimate, 3));
      setText(
        "forecast-trend-meta",
        "per log-session, p = " + pvalue(trend.p_value) +
        (trend.p_value !== null && trend.p_value < 0.05 ? "" : " — not distinguishable from no trend")
      );
    }

    var climb = arma && arma.parameters.filter(function (p) {
      return p.name === "total_elevation_gain" || p.name === "beta.total_elevation_gain";
    })[0];
    if (climb) {
      setText("forecast-climb", signed(climb.estimate, 3));
      setText("forecast-climb-meta", nativeUnit() + " per metre climbed, p = " + pvalue(climb.p_value));
    }

    if (llt && llt.final_state) {
      setText("forecast-level", value(convert(llt.final_state.level), 2));
      setText(
        "forecast-level-meta",
        llt.final_state.slope === null
          ? "current level, no slope in this form"
          : "current level; slope " + signed(convert(llt.final_state.slope), 3) + " " + u + " per session"
      );
    }

    var next = arma && arma.forecast[0];
    if (next) {
      setText("forecast-next", value(convert(next.mean), 2));
      setText(
        "forecast-next-meta",
        "next session, 95% " + value(convert(next.lo95), 2) + " – " + value(convert(next.hi95), 2)
      );
    }
  }

  function byKey(key) {
    var found = payload.models.filter(function (m) { return m.key === key; });
    return found.length ? found[0] : null;
  }

  // -- wiring -------------------------------------------------------------

  function renderAll() {
    var arma = byKey("log_arma");
    var llt = byKey("local_linear_trend");
    if (!arma || !llt) return hide("The published forecast does not contain both models.");

    setText("title-arma", esc(arma.label));
    setText("title-llt", esc(llt.label));
    setText("spec-arma", esc(arma.specification));
    setText("spec-llt", esc(llt.specification));

    fanChart("chart-forecast-arma", arma);
    fanChart("chart-forecast-llt", llt);

    forecastTable("table-forecast-arma", arma);
    forecastTable("table-forecast-llt", llt);
    historyTable("table-history-arma", arma);
    historyTable("table-history-llt", llt);
    paramTable("params-arma", arma);
    paramTable("params-llt", llt);
    bicTable("table-bic", arma);

    renderHeadline();

    setText(
      "fit-arma",
      "log-likelihood " + num(arma.fit.loglik, 2) + " · AIC " + num(arma.fit.aic, 2) +
      " · BIC " + num(arma.fit.bic, 2) +
      (arma.ljung_box
        ? " · Ljung–Box(" + arma.ljung_box.lags + ") " + num(arma.ljung_box.statistic, 2) +
          ", p = " + pvalue(arma.ljung_box.p_value)
        : "")
    );
    setText(
      "fit-llt",
      "log-likelihood " + num(llt.fit.loglik, 2) + " · AIC " + num(llt.fit.aic, 2) +
      " · BIC " + num(llt.fit.bic, 2) +
      (llt.ljung_box
        ? " · Ljung–Box(" + llt.ljung_box.lags + ") " + num(llt.ljung_box.statistic, 2) +
          ", p = " + pvalue(llt.ljung_box.p_value)
        : "")
    );
  }

  function renderMeta() {
    var settings = payload.forecast_settings;
    var EFFORT_UNITS = { distance_km: " km", total_elevation_gain: " m" };
    var effort = Object.keys(settings.future_effort).map(function (name) {
      var digits = name === "distance_km" ? 2 : 0;
      return paramLabel(name).toLowerCase() + " " +
        num(settings.future_effort[name], digits) + (EFFORT_UNITS[name] || "");
    }).join(", ");

    setText(
      "forecast-meta",
      "Fitted to " + payload.n_observations + " " + esc(payload.sport_types.join("/")) + " activities, " +
      longDate(payload.first_activity) + " to " + longDate(payload.last_activity) + ". " +
      settings.steps + " sessions forecast at " + effort + ", from " +
      settings.bootstrap_replicates.toLocaleString() + " bootstrap replicates."
    );

    var generated = payload.generated_at ? new Date(payload.generated_at) : null;
    setText(
      "forecast-generated",
      generated
        ? "Models refitted " + generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
        : ""
    );

    var warning = document.getElementById("forecast-warning");
    if (warning) {
      if (payload.warning) {
        warning.textContent = payload.warning;
        warning.hidden = false;
      } else {
        warning.hidden = true;
      }
    }

    var failures = payload.models.reduce(function (sum, m) { return sum + (m.bootstrap_failures || 0); }, 0);
    setText(
      "forecast-failures",
      failures
        ? failures + " bootstrap replicate" + (failures === 1 ? "" : "s") + " failed to refit and were dropped."
        : ""
    );
  }

  function hide(message) {
    var section = document.getElementById("forecast-section");
    if (section) section.hidden = true;
    if (message && window.console && console.info) console.info("forecast: " + message);
  }

  /* Both scripts on this page bind the same unit toggle. Neither owns it, so
     neither has to exist for the other to work. */
  function bindUnits() {
    var group = document.getElementById("filter-unit");
    if (!group) return;
    group.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-value]");
      if (!button || button.dataset.value === unit) return;
      unit = button.dataset.value;
      // A click can land while forecast.json is still in flight. Record the
      // choice either way; render only once there is something to render, and
      // start() re-reads the unit after the fetch so the first paint uses it.
      if (ready) renderAll();
    });
  }

  function currentUnit() {
    var pressed = document.querySelector("#filter-unit button[aria-pressed=\"true\"]");
    return pressed ? pressed.dataset.value : unit;
  }

  function start() {
    var section = document.getElementById("forecast-section");
    if (!section || !DATA_URL) return;

    if (typeof Chart === "undefined") return hide("Chart.js did not load.");

    C = {
      surface: token("--surface-1", "#ffffff"),
      textPrimary: token("--text-primary", "#0b0b0b"),
      textSecondary: token("--text-secondary", "#52514e"),
      muted: token("--text-muted", "#898781"),
      gridline: token("--gridline", "#e1e0d9"),
      baseline: token("--baseline", "#c3c2b7"),
      series1: token("--series-1", "#2a78d6"),
      series2: token("--series-2", "#eb6834"),
    };

    // Bound before the fetch, not after it: running.js owns the toggle's
    // pressed state and binds on its own schedule, so a click during the
    // in-flight window would otherwise switch the training charts to miles and
    // leave the forecast charts in km with no listener to correct them.
    unit = currentUnit();
    bindUnits();

    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (json) {
        payload = json;
        if (payload.schema_version !== SCHEMA) {
          return hide("schema " + payload.schema_version + ", this page reads " + SCHEMA + ".");
        }
        if (!payload.models || !payload.models.length || !payload.observed || !payload.observed.length) {
          return hide("no fitted models in the published file.");
        }
        section.hidden = false;
        ready = true;
        // Re-read in case the toggle was clicked while this was in flight.
        unit = currentUnit();
        renderMeta();
        renderAll();
      })
      .catch(function (error) {
        hide("could not load (" + error.message + ").");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
