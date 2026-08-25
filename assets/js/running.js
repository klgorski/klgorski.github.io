/* Training dashboard.
 *
 * Reads assets/data/summary.json, which is written once a day by the
 * Strava-Analysis-Project sync workflow. That file is built from an allowlist
 * and carries no coordinates, routes, timezones or profile data.
 *
 * Everything on screen is computed here from summary.activities -- the atomic
 * records -- so the filter row can rescope all of it at once. The precomputed
 * aggregates in the JSON (totals, weekly, daily, by_sport, ...) are the
 * published dataset for anyone else reading the file; they are deliberately
 * not the source for these charts, because a filtered view has to be
 * recomputed anyway and two aggregation paths would eventually disagree.
 */
(function () {
  "use strict";

  var DATA_URL = document.currentScript && document.currentScript.dataset.src;

  // Read the palette from the stylesheet rather than repeating the hexes, so
  // there is one place to change a color.
  function token(name, fallback) {
    var root = document.querySelector(".viz-root");
    if (!root) return fallback;
    var value = getComputedStyle(root).getPropertyValue(name);
    return (value && value.trim()) || fallback;
  }

  var C = {};
  // Set once summary.json has loaded AND validated. The unit toggle is bound
  // before the fetch (forecast.js shares it), so the click handler needs to
  // know whether there is anything to re-render yet.
  var ready = false;

  // Categorical slots in fixed order. A sport is assigned a slot once, from the
  // full dataset, and keeps it for the life of the page -- filtering to a
  // shorter range must never repaint the survivors.
  var SPORT_COLORS = {};

  function assignSportColors(activities) {
    var slots = [C.series1, C.series2, C.series3];
    var seen = [];
    activities.forEach(function (a) {
      if (seen.indexOf(a.sport) === -1) seen.push(a.sport);
    });
    // Most-frequent first, so the commonest sport gets slot 1 and the order is
    // stable across days rather than following whatever was recorded first.
    var counts = {};
    activities.forEach(function (a) {
      counts[a.sport] = (counts[a.sport] || 0) + 1;
    });
    seen.sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });
    seen.forEach(function (sport, i) {
      // Past three sports the palette's all-pairs guarantee runs out, so the
      // tail folds into one "Other" color rather than inventing a ninth hue.
      SPORT_COLORS[sport] = i < slots.length ? slots[i] : C.muted;
    });
    return seen;
  }

  // -- units --------------------------------------------------------------

  var KM_PER_MI = 1.609344;

  var state = { unit: "km", range: "all" };

  function toDistance(km) {
    return state.unit === "mi" ? km / KM_PER_MI : km;
  }

  function distanceUnit() {
    return state.unit === "mi" ? "mi" : "km";
  }

  function paceUnit() {
    return state.unit === "mi" ? "/mi" : "/km";
  }

  function toPace(minPerKm) {
    return state.unit === "mi" ? minPerKm * KM_PER_MI : minPerKm;
  }

  // -- formatting ---------------------------------------------------------

  function num(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits === undefined ? 1 : digits,
      maximumFractionDigits: digits === undefined ? 1 : digits,
    });
  }

  function pace(minPerUnit) {
    if (!minPerUnit || !isFinite(minPerUnit)) return "–";
    var total = Math.round(minPerUnit * 60);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function duration(minutes) {
    if (!minutes) return "0m";
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    return h ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
  }

  function shortDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function longDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // -- date helpers -------------------------------------------------------

  function parseDay(iso) {
    return new Date(iso + "T00:00:00");
  }

  function dayKey(date) {
    var m = date.getMonth() + 1;
    var d = date.getDate();
    return date.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }

  function mondayOf(date) {
    var copy = new Date(date.getTime());
    // getDay() is 0 for Sunday; shift so weeks start on Monday.
    var offset = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - offset);
    return copy;
  }

  // -- aggregation --------------------------------------------------------

  function inRange(activities) {
    if (state.range === "all" || !activities.length) return activities.slice();
    var days = parseInt(state.range, 10);
    var last = parseDay(activities[activities.length - 1].date);
    var cutoff = new Date(last.getTime());
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return activities.filter(function (a) {
      return parseDay(a.date) >= cutoff;
    });
  }

  function totals(activities) {
    var distance = 0, moving = 0, elevation = 0;
    activities.forEach(function (a) {
      distance += a.distance_km || 0;
      moving += a.moving_time_min || 0;
      elevation += a.elevation_m || 0;
    });
    return {
      count: activities.length,
      distanceKm: distance,
      movingMin: moving,
      elevationM: elevation,
      // Ratio of sums, not the mean of the paces: a 1 km jog must not weigh as
      // much as a 20 km long run.
      paceMinPerKm: distance > 0 ? moving / distance : null,
    };
  }

  function streaks(activities, lastDayIso) {
    var days = [];
    activities.forEach(function (a) {
      if (days.indexOf(a.date) === -1) days.push(a.date);
    });
    days.sort();
    if (!days.length) return { longest: 0, current: 0, active: 0 };

    var longest = 1, run = 1;
    for (var i = 1; i < days.length; i++) {
      var gap = (parseDay(days[i]) - parseDay(days[i - 1])) / 86400000;
      run = gap === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }

    var current = 0;
    var since = (parseDay(lastDayIso) - parseDay(days[days.length - 1])) / 86400000;
    if (since <= 1) {
      current = 1;
      for (var j = days.length - 1; j > 0; j--) {
        if ((parseDay(days[j]) - parseDay(days[j - 1])) / 86400000 !== 1) break;
        current++;
      }
    }
    return { longest: longest, current: current, active: days.length };
  }

  function byWeek(activities, sports) {
    var buckets = {};
    activities.forEach(function (a) {
      var key = dayKey(mondayOf(parseDay(a.date)));
      if (!buckets[key]) buckets[key] = {};
      buckets[key][a.sport] = (buckets[key][a.sport] || 0) + (a.distance_km || 0);
    });
    var keys = Object.keys(buckets).sort();
    if (!keys.length) return { labels: [], series: [] };

    // Zero-fill the weeks with no activity: a gap in training is information,
    // and dropping the empty weeks would silently compress the time axis.
    var labels = [];
    var cursor = parseDay(keys[0]);
    var end = parseDay(keys[keys.length - 1]);
    while (cursor <= end) {
      labels.push(dayKey(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }

    var series = sports.map(function (sport) {
      return {
        sport: sport,
        values: labels.map(function (week) {
          return (buckets[week] && buckets[week][sport]) || 0;
        }),
      };
    });
    return { labels: labels, series: series };
  }

  function dailyDistance(activities) {
    var buckets = {};
    activities.forEach(function (a) {
      buckets[a.date] = (buckets[a.date] || 0) + (a.distance_km || 0);
    });
    var keys = Object.keys(buckets).sort();
    if (!keys.length) return { labels: [], values: [] };

    var labels = [], values = [];
    var cursor = parseDay(keys[0]);
    var end = parseDay(keys[keys.length - 1]);
    while (cursor <= end) {
      var key = dayKey(cursor);
      labels.push(key);
      values.push(buckets[key] || 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    return { labels: labels, values: values };
  }

  function rollingMean(values, window) {
    var out = [], sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= window) sum -= values[i - window];
      // Only emit once a full window is behind us; a "7-day average" over four
      // days of data is not one, and the ramp-in reads as a training taper
      // that never happened.
      out.push(i >= window - 1 ? sum / window : null);
    }
    return out;
  }

  var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function byWeekday(activities) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    var distance = [0, 0, 0, 0, 0, 0, 0];
    activities.forEach(function (a) {
      var index = (parseDay(a.date).getDay() + 6) % 7;
      counts[index]++;
      distance[index] += a.distance_km || 0;
    });
    return { counts: counts, distance: distance };
  }

  function byHour(activities) {
    var counts = new Array(24).fill(0);
    activities.forEach(function (a) {
      if (!a.time) return;
      var hour = parseInt(a.time.split(":")[0], 10);
      if (!isNaN(hour)) counts[hour]++;
    });
    return counts;
  }

  function bySport(activities, sports) {
    return sports
      .map(function (sport) {
        var subset = activities.filter(function (a) {
          return a.sport === sport;
        });
        return { sport: sport, total: totals(subset) };
      })
      .filter(function (row) {
        return row.total.count > 0;
      });
  }

  // -- chart chrome -------------------------------------------------------

  function axisX(extra) {
    var base = {
      grid: { display: false },
      border: { color: C.baseline },
      ticks: { color: C.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
    };
    return Object.assign(base, extra || {});
  }

  function axisY(title, extra) {
    var base = {
      beginAtZero: true,
      // Solid hairlines, one shade off the surface. Never dashed.
      grid: { color: C.gridline, drawTicks: false },
      border: { display: false },
      ticks: { color: C.muted, font: { size: 11 }, padding: 8 },
      title: title ? { display: true, text: title, color: C.muted, font: { size: 11 } } : undefined,
    };
    return Object.assign(base, extra || {});
  }

  function legend(show) {
    return {
      display: !!show,
      position: "top",
      align: "end",
      labels: {
        color: C.textSecondary,
        boxWidth: 10,
        boxHeight: 10,
        borderRadius: 2,
        useBorderRadius: true,
        font: { size: 12 },
        padding: 14,
      },
    };
  }

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

  var charts = {};

  function draw(id, config) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas.getContext("2d"), config);
  }

  // -- table twins --------------------------------------------------------

  // Table cells and tiles are assembled as HTML strings (chip() and the unit
  // spans are real markup), so anything that came out of the JSON as free text
  // has to be escaped at the point it goes in. Activity names are the only
  // genuinely free-text values on the page.
  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
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

  function chip(sport) {
    // SPORT_COLORS is a fixed lookup, but an unrecognised sport would put the
    // literal "undefined" into a style attribute; fall back to the muted token.
    var color = SPORT_COLORS[sport] || "var(--text-muted)";
    return "<span class=\"viz-chip\" style=\"background:" + esc(color) + "\"></span>" + esc(sport);
  }

  // -- rendering ----------------------------------------------------------

  function setText(id, html) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = html;
  }

  function renderTiles(scoped, lastDay) {
    var t = totals(scoped);
    var s = streaks(scoped, lastDay);
    var unit = distanceUnit();

    setText("stat-distance", num(toDistance(t.distanceKm), 1) + "<span class=\"viz-tile-unit\">" + unit + "</span>");
    setText("stat-time", duration(t.movingMin));
    setText("stat-count", t.count.toLocaleString());
    setText("stat-elevation", num(t.elevationM, 0) + "<span class=\"viz-tile-unit\">m</span>");
    setText("stat-pace", t.paceMinPerKm ? pace(toPace(t.paceMinPerKm)) + "<span class=\"viz-tile-unit\">" + paceUnit() + "</span>" : "–");
    setText("stat-streak", s.longest + "<span class=\"viz-tile-unit\">d</span>");
    setText("stat-streak-note", s.current ? "current: " + s.current + (s.current === 1 ? " day" : " days") : "no active streak");
    setText("stat-active-note", s.active + " active " + (s.active === 1 ? "day" : "days"));
  }

  function renderWeekly(scoped, sports) {
    var data = byWeek(scoped, sports);
    var unit = distanceUnit();
    var multi = data.series.filter(function (s) {
      return s.values.some(function (v) { return v > 0; });
    }).length > 1;

    draw("chart-weekly", {
      type: "bar",
      data: {
        labels: data.labels.map(shortDate),
        datasets: data.series.map(function (s) {
          return {
            label: s.sport,
            data: s.values.map(toDistance),
            backgroundColor: SPORT_COLORS[s.sport],
            // A 2px surface-colored ring is the gap between stacked segments
            // and between adjacent bars -- not an outline drawn to separate them.
            borderColor: C.surface,
            borderWidth: 2,
            borderRadius: 4,
            borderSkipped: "bottom",
            categoryPercentage: 0.82,
            barPercentage: 0.92,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: axisX({ stacked: true }),
          y: axisY(unit, { stacked: true }),
        },
        plugins: {
          legend: legend(multi),
          tooltip: tooltip({
            title: function (items) {
              return "Week of " + longDate(data.labels[items[0].dataIndex]);
            },
            label: function (item) {
              return item.dataset.label + ": " + num(item.parsed.y, 1) + " " + unit;
            },
          }),
        },
      },
    });

    renderTable(
      "table-weekly",
      ["Week of"].concat(data.series.map(function (s) { return esc(s.sport) + " (" + unit + ")"; })).concat(["Total (" + unit + ")"]),
      data.labels.map(function (week, i) {
        var row = [longDate(week)];
        var sum = 0;
        data.series.forEach(function (s) {
          sum += s.values[i];
          row.push(num(toDistance(s.values[i]), 1));
        });
        row.push(num(toDistance(sum), 1));
        return row;
      }).reverse()
    );
  }

  function renderRolling(scoped) {
    var daily = dailyDistance(scoped);
    var unit = distanceUnit();
    var window = 7;
    var rolled = rollingMean(daily.values, window);

    draw("chart-rolling", {
      type: "line",
      data: {
        labels: daily.labels.map(shortDate),
        datasets: [{
          label: window + "-day average",
          data: rolled.map(function (v) { return v === null ? null : toDistance(v); }),
          borderColor: C.series1,
          backgroundColor: C.series1,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          // The hit area is far bigger than the mark, so a value never has to
          // be landed on dead-centre.
          pointHitRadius: 24,
          tension: 0.25,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { x: axisX(), y: axisY(unit + " / day") },
        plugins: {
          // One series: the figure title names it, so no legend box.
          legend: legend(false),
          tooltip: tooltip({
            title: function (items) {
              return longDate(daily.labels[items[0].dataIndex]);
            },
            label: function (item) {
              return num(item.parsed.y, 2) + " " + unit + "/day (" + window + "-day avg)";
            },
          }),
        },
      },
    });

    renderTable(
      "table-rolling",
      ["Day", "Distance that day (" + unit + ")", window + "-day avg (" + unit + ")"],
      daily.labels.map(function (day, i) {
        return [longDate(day), num(toDistance(daily.values[i]), 2), rolled[i] === null ? "–" : num(toDistance(rolled[i]), 2)];
      }).reverse()
    );
  }

  function renderSports(scoped, sports) {
    var rows = bySport(scoped, sports);
    var unit = distanceUnit();

    draw("chart-sports", {
      type: "bar",
      data: {
        labels: rows.map(function (r) { return r.sport; }),
        datasets: [{
          label: "Distance",
          data: rows.map(function (r) { return toDistance(r.total.distanceKm); }),
          // Each bar wears its sport's own hue -- identity, the same hue it has
          // in every other chart here, not a value ramp on a nominal axis.
          backgroundColor: rows.map(function (r) { return SPORT_COLORS[r.sport]; }),
          borderRadius: 4,
          borderSkipped: "start",
          categoryPercentage: 0.7,
          barPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: axisY(unit, { grid: { color: C.gridline, drawTicks: false } }),
          y: { grid: { display: false }, border: { color: C.baseline }, ticks: { color: C.textSecondary, font: { size: 12 } } },
        },
        plugins: {
          legend: legend(false),
          tooltip: tooltip({
            label: function (item) {
              var row = rows[item.dataIndex];
              return [
                num(item.parsed.x, 1) + " " + unit,
                row.total.count + (row.total.count === 1 ? " activity" : " activities"),
                "avg " + pace(toPace(row.total.paceMinPerKm)) + paceUnit(),
              ];
            },
          }),
        },
      },
    });

    renderTable(
      "table-sports",
      ["Sport", "Activities", "Distance (" + unit + ")", "Time", "Avg pace (" + paceUnit() + ")", "Elevation (m)"],
      rows.map(function (r) {
        return [
          chip(r.sport),
          r.total.count.toLocaleString(),
          num(toDistance(r.total.distanceKm), 1),
          duration(r.total.movingMin),
          pace(toPace(r.total.paceMinPerKm)),
          num(r.total.elevationM, 0),
        ];
      })
    );
  }

  function renderWeekday(scoped) {
    var data = byWeekday(scoped);

    draw("chart-weekday", {
      type: "bar",
      data: {
        labels: WEEKDAYS,
        datasets: [{
          label: "Activities",
          data: data.counts,
          backgroundColor: C.series1,
          borderRadius: 4,
          borderSkipped: "bottom",
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { x: axisX(), y: axisY(null, { ticks: { precision: 0, color: C.muted, font: { size: 11 }, padding: 8 } }) },
        plugins: {
          legend: legend(false),
          tooltip: tooltip({
            label: function (item) {
              var i = item.dataIndex;
              return [
                item.parsed.y + (item.parsed.y === 1 ? " activity" : " activities"),
                num(toDistance(data.distance[i]), 1) + " " + distanceUnit(),
              ];
            },
          }),
        },
      },
    });

    renderTable(
      "table-weekday",
      ["Weekday", "Activities", "Distance (" + distanceUnit() + ")"],
      WEEKDAYS.map(function (day, i) {
        return [day, data.counts[i].toLocaleString(), num(toDistance(data.distance[i]), 1)];
      })
    );
  }

  function renderHour(scoped) {
    var counts = byHour(scoped);
    var labels = counts.map(function (_, h) { return (h < 10 ? "0" : "") + h; });

    draw("chart-hour", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Activities",
          data: counts,
          backgroundColor: C.series1,
          borderRadius: 4,
          borderSkipped: "bottom",
          categoryPercentage: 0.85,
          barPercentage: 0.95,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: axisX({ ticks: { color: C.muted, font: { size: 10 }, autoSkip: false, callback: function (v, i) { return i % 3 === 0 ? labels[i] : ""; } } }),
          y: axisY(null, { ticks: { precision: 0, color: C.muted, font: { size: 11 }, padding: 8 } }),
        },
        plugins: {
          legend: legend(false),
          tooltip: tooltip({
            title: function (items) {
              return labels[items[0].dataIndex] + ":00–" + labels[items[0].dataIndex] + ":59";
            },
            label: function (item) {
              return item.parsed.y + (item.parsed.y === 1 ? " activity" : " activities");
            },
          }),
        },
      },
    });

    renderTable(
      "table-hour",
      ["Hour (local)", "Activities"],
      labels.map(function (label, i) {
        return [label + ":00", counts[i].toLocaleString()];
      }).filter(function (row, i) {
        return counts[i] > 0;
      })
    );
  }

  function renderPace(scoped, sports) {
    var unit = distanceUnit();
    var present = sports.filter(function (sport) {
      return scoped.some(function (a) { return a.sport === sport && a.pace_min_per_km; });
    });

    draw("chart-pace", {
      type: "scatter",
      data: {
        datasets: present.map(function (sport) {
          return {
            label: sport,
            data: scoped.filter(function (a) {
              return a.sport === sport && a.pace_min_per_km;
            }).map(function (a) {
              return { x: toDistance(a.distance_km), y: toPace(a.pace_min_per_km), raw: a };
            }),
            backgroundColor: SPORT_COLORS[sport],
            // 10px marks with a 2px surface ring, so overlapping points stay
            // countable.
            pointRadius: 5,
            pointHoverRadius: 7,
            pointHitRadius: 12,
            borderColor: C.surface,
            borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: axisY("distance (" + unit + ")", { grid: { color: C.gridline, drawTicks: false } }),
          y: axisY("pace (min" + paceUnit() + ")", {
            beginAtZero: false,
            // Faster is a smaller number, so the axis is reversed: up means
            // quicker, which is the direction a reader expects "better" to go.
            reverse: true,
            ticks: { color: C.muted, font: { size: 11 }, padding: 8, callback: function (v) { return pace(v); } },
          }),
        },
        plugins: {
          legend: legend(present.length > 1),
          tooltip: tooltip({
            title: function (items) {
              var a = items[0].raw.raw;
              return a.name ? a.name : a.sport;
            },
            label: function (item) {
              var a = item.raw.raw;
              return [
                longDate(a.date),
                num(toDistance(a.distance_km), 2) + " " + unit + " in " + duration(a.moving_time_min),
                pace(toPace(a.pace_min_per_km)) + paceUnit(),
              ];
            },
          }),
        },
      },
    });
  }

  function renderRecords(scoped) {
    var unit = distanceUnit();
    var best = function (list, key, largest) {
      var pool = list.filter(function (a) { return a[key]; });
      if (!pool.length) return null;
      return pool.reduce(function (acc, a) {
        return (largest ? a[key] > acc[key] : a[key] < acc[key]) ? a : acc;
      });
    };

    var longest = best(scoped, "distance_km", true);
    var longestTime = best(scoped, "moving_time_min", true);
    var climb = best(scoped, "elevation_m", true);
    var fastest = best(scoped.filter(function (a) { return a.distance_km >= 1; }), "pace_min_per_km", false);

    function fill(id, value, activity) {
      setText(id, value);
      setText(id + "-meta", activity ? longDate(activity.date) + (activity.name ? " · " + esc(activity.name) : "") : "");
    }

    fill("record-distance", longest ? num(toDistance(longest.distance_km), 2) + " " + unit : "–", longest);
    fill("record-duration", longestTime ? duration(longestTime.moving_time_min) : "–", longestTime);
    fill("record-pace", fastest ? pace(toPace(fastest.pace_min_per_km)) + paceUnit() : "–", fastest);
    fill("record-climb", climb ? num(climb.elevation_m, 0) + " m" : "–", climb);
  }

  function renderActivities(scoped) {
    var unit = distanceUnit();
    renderTable(
      "table-activities",
      ["Date", "Sport", "Activity", "Distance (" + unit + ")", "Time", "Pace (" + paceUnit() + ")", "Elev (m)"],
      scoped.slice().reverse().map(function (a) {
        return [
          longDate(a.date),
          chip(a.sport),
          a.name ? esc(a.name) : "–",
          num(toDistance(a.distance_km), 2),
          duration(a.moving_time_min),
          a.pace_min_per_km ? pace(toPace(a.pace_min_per_km)) : "–",
          num(a.elevation_m, 0),
        ];
      })
    );
  }

  // -- wiring -------------------------------------------------------------

  var summary = null;
  var sportOrder = [];

  function renderAll() {
    var scoped = inRange(summary.activities);
    var lastDay = summary.last_day || (summary.activities.length ? summary.activities[summary.activities.length - 1].date : null);

    renderTiles(scoped, lastDay);
    renderWeekly(scoped, sportOrder);
    renderRolling(scoped);
    renderSports(scoped, sportOrder);
    renderWeekday(scoped);
    renderHour(scoped);
    renderPace(scoped, sportOrder);
    renderRecords(scoped);
    renderActivities(scoped);

    setText("viz-scope-note", scoped.length
      ? scoped.length + (scoped.length === 1 ? " activity" : " activities") + " from " + longDate(scoped[0].date) + " to " + longDate(scoped[scoped.length - 1].date)
      : "No activities in this range.");
  }

  function bindSegmented(selector, key) {
    var group = document.querySelector(selector);
    if (!group) return;
    group.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-value]");
      if (!button) return;
      state[key] = button.dataset.value;
      group.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === button));
      });
      // aria-pressed is updated either way -- forecast.js reads it to decide
      // which units to draw in, and it has its own data, so the toggle has to
      // keep working even when this file's summary never arrived. Only the
      // rendering waits for a validated payload.
      if (ready) renderAll();
    });
  }

  function fail(message) {
    var host = document.getElementById("viz-status");
    if (host) {
      host.hidden = false;
      host.textContent = message;
    }
    // Hides the summary-driven blocks only. The forecast section is a sibling
    // of these and is owned by forecast.js, which publishes independently and
    // is allowed to succeed on a day when summary.json does not.
    var blocks = document.querySelectorAll("[data-viz-summary]");
    for (var i = 0; i < blocks.length; i++) blocks[i].hidden = true;
  }

  function start() {
    C = {
      surface: token("--surface-1", "#ffffff"),
      textPrimary: token("--text-primary", "#0b0b0b"),
      textSecondary: token("--text-secondary", "#52514e"),
      muted: token("--text-muted", "#898781"),
      gridline: token("--gridline", "#e1e0d9"),
      baseline: token("--baseline", "#c3c2b7"),
      series1: token("--series-1", "#2a78d6"),
      series2: token("--series-2", "#eb6834"),
      series3: token("--series-3", "#1baf7a"),
    };

    if (typeof Chart === "undefined") {
      fail("The charting library did not load, so the charts are unavailable. The data tables below each chart are unaffected on a reload.");
      return;
    }

    Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    Chart.defaults.color = C.textSecondary;
    Chart.defaults.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? false
      : { duration: 300 };

    // Bound before the fetch, not inside its .then(). forecast.js reads this
    // toggle's aria-pressed to pick its units and publishes independently, so a
    // click that lands while summary.json is in flight -- or on a day when it
    // never arrives -- must still move the control.
    bindSegmented("#filter-range", "range");
    bindSegmented("#filter-unit", "unit");

    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (json) {
        summary = json;
        if (!summary.activities || !summary.activities.length) {
          fail("No activities have been published yet. The daily sync writes this file; it will fill in on the next run.");
          return;
        }
        if (summary.schema_version !== 1) {
          fail("This page reads schema version 1, but the data file is version " + summary.schema_version + ". The page needs updating.");
          return;
        }
        sportOrder = assignSportColors(summary.activities);

        var generated = summary.generated_at ? new Date(summary.generated_at) : null;
        setText("viz-generated", generated
          ? "Data last synced " + generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
          : "");

        ready = true;
        renderAll();
      })
      .catch(function (error) {
        fail("Could not load the training data (" + error.message + ").");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
