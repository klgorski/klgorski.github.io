/* Training dashboard.
 *
 * Reads assets/data/summary.json, which is written once a day by the
 * Strava-Analysis-Project sync workflow. That file is built from an allowlist
 * and carries no coordinates, routes, timezones or profile data.
 *
 * Everything on screen is computed here from summary.activities -- the atomic
 * records -- so the filter row can rescope all of it at once. Schema 2 stopped
 * publishing the derived series (daily, weekly, monthly, the histograms,
 * streaks, records) for that reason: a filtered view has to be recomputed
 * anyway, so the published copies were four fifths of a file committed once a
 * day that nothing read, and a second aggregation path that could disagree
 * with this one. `totals` and `by_sport` are still published -- they cost
 * almost nothing and they are what a person opening the file wants first --
 * but this file does not read them either.
 */
(function () {
  "use strict";

  var DATA_URL = document.currentScript && document.currentScript.dataset.src;
  var SCHEMA = 2;

  /* Formatting, escaping, the table builder and the chart chrome live in
     viz-core.js, which forecast.js loads too. Without it there is nothing to
     draw with, so say so rather than throwing on the first property read. */
  var core = window.VizCore;
  if (!core) {
    var missing = document.getElementById("viz-status");
    if (missing) {
      missing.hidden = false;
      missing.textContent = "A script this page needs did not load, so the charts are unavailable.";
    }
    return;
  }

  var esc = core.esc;
  var setText = core.setText;
  var renderTable = core.renderTable;
  var draw = core.draw;
  var num = core.num;
  var pace = core.mmss;
  var clock = core.clock;
  var parseDay = core.parseDay;
  var shortDate = core.shortDate;
  var longDate = core.longDate;

  var C = {};
  // Set once summary.json has loaded AND validated. The unit toggle is bound
  // before the fetch (forecast.js shares it), so the click handler needs to
  // know whether there is anything to re-render yet.
  var ready = false;

  // Categorical slots in fixed order. A sport is assigned a slot once, from the
  // full dataset, and keeps it for the life of the page -- filtering to a
  // shorter range must never repaint the survivors.
  var SPORT_COLORS = {};

  /* The design pass fixed which sport wears which slot, so the same hue means
     the same sport across the log, the tables and every chart. Swimming holds
     the blue because it is the series that sits on its own axis, and hiking
     takes the neutral -- a fourth *hue* would need the palette validator
     re-run, a fourth grey separates by lightness and does not.

     A sport not named here still gets a colour: the leftover slots are handed
     out most-frequent-first, exactly as they were before this table existed. */
  var SPORT_SLOTS = {
    Run: "series2",
    Walk: "series3",
    Hike: "neutral",
    Swim: "series1",
  };

  var SLOT_ORDER = ["series1", "series2", "series3", "neutral"];

  function assignSportColors(activities) {
    var counts = {};
    var seen = [];
    activities.forEach(function (a) {
      if (seen.indexOf(a.sport) === -1) seen.push(a.sport);
      counts[a.sport] = (counts[a.sport] || 0) + 1;
    });
    // Most-frequent first, so the leftover slots are handed out in an order
    // that is stable across days rather than following whatever was recorded
    // first.
    seen.sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    });

    // Named sports claim their slot before anything else is placed, so a
    // leftover can only ever be given a slot no named sport is using.
    var taken = {};
    seen.forEach(function (sport) {
      var slot = SPORT_SLOTS[sport];
      if (!slot) return;
      SPORT_COLORS[sport] = C[slot];
      taken[slot] = true;
    });
    var spare = SLOT_ORDER.filter(function (slot) { return !taken[slot]; });
    seen.forEach(function (sport) {
      if (SPORT_COLORS[sport]) return;
      // Past four sports the palette's all-pairs guarantee runs out, so the
      // tail folds into one "Other" color rather than inventing a ninth hue.
      SPORT_COLORS[sport] = spare.length ? C[spare.shift()] : C.muted;
    });
    return seen;
  }

  /* Sports that have never been recorded still need a colour, because the
     mean-performance table keeps a row for them. Falls back to the named slot
     rather than to muted, so a reserved row is drawn in the colour it will
     keep on the day the first activity of that kind arrives. */
  function sportColor(sport) {
    if (SPORT_COLORS[sport]) return SPORT_COLORS[sport];
    if (SPORT_SLOTS[sport] && C[SPORT_SLOTS[sport]]) return C[SPORT_SLOTS[sport]];
    return C.muted;
  }

  /* Sports the mean-performance table keeps a row for even when nothing has
     been recorded: an empty row says "tracked, none yet", a missing one says
     nothing at all. */
  var RESERVED_SPORTS = ["Swim"];

  /* Swimming pace lives on a different scale from running pace -- minutes per
     100 m against minutes per km -- so it gets the right-hand axis of the
     performance chart instead of flattening the land series into a band. */
  var POOL_SPORTS = ["Swim"];

  function isPool(sport) {
    return POOL_SPORTS.indexOf(sport) !== -1;
  }

  // -- units --------------------------------------------------------------

  var KM_PER_MI = core.KM_PER_MI;

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

  // -- date helpers -------------------------------------------------------

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

  /* "1h 05m" -- reads better in prose than core.clock()'s aligned h:mm:ss,
     and this file uses it in tooltips and tile values. */
  function duration(minutes) {
    if (!minutes) return "0m";
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    return h ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
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

  /* `asOfIso` is the day the current streak is read against -- see asOfDay().
     It is NOT the last activity's date: measuring the last activity against
     itself always gives zero, which made the "no active streak" branch below
     unreachable. */
  function streaks(activities, asOfIso) {
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
    var since = (parseDay(asOfIso) - parseDay(days[days.length - 1])) / 86400000;
    // A missing or unparseable reference day makes this NaN, which fails the
    // comparison and reports no active streak -- the safe way round.
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

  /* Each window is summed from scratch rather than slid along with
     `sum += new; sum -= old`. The sliding form is the cheaper one and it was
     wrong here: adding and subtracting the same distances in a different order
     leaves a residue of about -6e-17 once the window is a run of rest days,
     and toLocaleString renders that as "-0.00". It read as a negative distance
     in 248 of the 353 rows of the data table. Seven additions per row costs
     nothing at any history this page will ever hold, and a sum of
     non-negative values cannot come out below zero. */
  function rollingMean(values, window) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      // Only emit once a full window is behind us; a "7-day average" over four
      // days of data is not one, and the ramp-in reads as a training taper
      // that never happened.
      if (i < window - 1) {
        out.push(null);
        continue;
      }
      var sum = 0;
      for (var j = i - window + 1; j <= i; j++) sum += values[j];
      out.push(sum / window);
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

  // C is populated in start(), so the palette is read at call time.
  function tooltip(callbacks) {
    return core.tooltip(C, callbacks);
  }

  // -- table twins --------------------------------------------------------

  function chip(sport) {
    // sportColor() never returns undefined, which matters because the value
    // goes straight into a style attribute.
    return "<span class=\"viz-chip\" style=\"background:" + esc(sportColor(sport)) + "\"></span>" + esc(sport);
  }

  // -- rendering ----------------------------------------------------------

  function renderTiles(scoped, asOf) {
    var t = totals(scoped);
    var s = streaks(scoped, asOf);
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

  /* Activity names are opt-in on the publisher side: publish_site.sh defaults
     STRAVA_PUBLISH_NAMES to false, because a name like "Glider port run" is a
     location the key allowlist cannot catch -- it screens key names, not
     values. So summary.json usually has no `name` anywhere, and an unguarded
     Activity column is a header over a full column of dashes. Show the column
     only when something in scope actually has a name to put in it. */
  function renderActivities(scoped) {
    var unit = distanceUnit();
    var named = scoped.some(function (a) { return a.name; });
    var columns = ["Date", "Sport"];
    if (named) columns.push("Activity");
    columns.push("Distance (" + unit + ")", "Time", "Pace (" + paceUnit() + ")", "Elev (m)");

    renderTable(
      "table-activities",
      columns,
      scoped.slice().reverse().map(function (a) {
        var row = [longDate(a.date), chip(a.sport)];
        if (named) row.push(a.name ? esc(a.name) : "–");
        row.push(
          num(toDistance(a.distance_km), 2),
          duration(a.moving_time_min),
          a.pace_min_per_km ? pace(toPace(a.pace_min_per_km)) : "–",
          num(a.elevation_m, 0)
        );
        return row;
      })
    );
  }

  // -- the top band -------------------------------------------------------

  /* Swim pace is quoted per 100 m, or per 100 yd once the toggle is on miles.
     summary.json publishes one pace field for every sport -- minutes per km --
     so the conversion belongs here rather than in the published file. */
  var KM_PER_100YD = 0.09144;

  function toPoolPace(minPerKm) {
    return state.unit === "mi" ? minPerKm * KM_PER_100YD : minPerKm / 10;
  }

  function poolPaceUnit() {
    return state.unit === "mi" ? "/100 yd" : "/100 m";
  }

  function paceOf(activity) {
    if (!activity.pace_min_per_km) return null;
    return isPool(activity.sport)
      ? toPoolPace(activity.pace_min_per_km)
      : toPace(activity.pace_min_per_km);
  }

  function paceUnitOf(sport) {
    return isPool(sport) ? poolPaceUnit() : paceUnit();
  }

  function weekdayDate(iso) {
    return parseDay(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function renderHeadline(scoped) {
    var t = totals(scoped);
    var parts = [
      t.count + (t.count === 1 ? " activity" : " activities"),
      num(toDistance(t.distanceKm), 1) + " " + distanceUnit(),
    ];
    parts.push(generatedAt
      ? "synced from Strava, last updated " +
        generatedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "synced from Strava");
    setText("viz-headline", parts.join(" · "));
  }

  function renderRecent(scoped) {
    var host = document.getElementById("recent-log");
    if (!host) return;

    // Three, which is what it takes to match the four-row means table beside
    // it: a log row is about 90px at the theme's font size. The count is
    // stated in the card's note in _pages/fitness.md -- change both together.
    var rows = scoped.slice(-3).reverse();
    host.innerHTML = rows.length
      ? rows.map(function (a) {
          var p = paceOf(a);
          return "<div class=\"viz-log-row\">" +
            "<span class=\"viz-log-bar\" style=\"background:" + esc(sportColor(a.sport)) + "\"></span>" +
            "<span class=\"viz-log-main\">" +
              "<span class=\"viz-log-sport\">" + esc(a.sport) + "</span>" +
              "<span class=\"viz-log-when\">" + esc(weekdayDate(a.date)) +
                (a.time ? " · " + esc(a.time) : "") + "</span>" +
            "</span>" +
            "<span class=\"viz-log-side\">" +
              "<span class=\"viz-log-pace\">" + (p === null ? "–" : pace(p) +
                "<span class=\"viz-unit\"> " + paceUnitOf(a.sport) + "</span>") + "</span>" +
              "<span class=\"viz-log-meta\">" + num(toDistance(a.distance_km), 2) + " " +
                distanceUnit() + " · " + clock(a.moving_time_min) + "</span>" +
            "</span>" +
          "</div>";
        }).join("")
      : "<p class=\"viz-log-empty\">No activities in this range.</p>";

    var link = document.getElementById("recent-all-link");
    if (link) {
      link.textContent = "All " + scoped.length +
        (scoped.length === 1 ? " activity" : " activities") + " ↓";
    }
  }

  function renderSportMeans(scoped, sports) {
    var host = document.getElementById("table-sport-means");
    if (!host) return;

    var listed = sports.slice();
    RESERVED_SPORTS.forEach(function (sport) {
      if (listed.indexOf(sport) === -1) listed.push(sport);
    });

    var body = listed.map(function (sport) {
      var subset = scoped.filter(function (a) { return a.sport === sport; });
      if (!subset.length) {
        return "<tr class=\"is-absent\"><td>" + chip(sport) +
          "</td><td>0</td><td>–</td><td>–</td><td>–</td></tr>";
      }
      var t = totals(subset);
      // Ratio of sums, the same definition totals() uses everywhere else --
      // and the only one that makes the row multiply out. A reader who divides
      // the mean time in this row by the mean distance beside it has to land
      // on the pace at the end of it; the mean of the per-activity paces would
      // not, and the discrepancy would look like an arithmetic error.
      var shown = t.paceMinPerKm === null
        ? null
        : (isPool(sport) ? toPoolPace(t.paceMinPerKm) : toPace(t.paceMinPerKm));
      return "<tr>" +
        "<td>" + chip(sport) + "</td>" +
        "<td>" + subset.length + "</td>" +
        "<td class=\"is-lead\">" + clock(t.movingMin / subset.length) + "</td>" +
        "<td>" + num(toDistance(t.distanceKm / subset.length), 2) + " " + distanceUnit() + "</td>" +
        "<td>" + (shown === null ? "–" : pace(shown) +
          "<span class=\"viz-unit\"> " + paceUnitOf(sport) + "</span>") + "</td>" +
        "</tr>";
    }).join("");

    host.innerHTML =
      "<table><thead><tr>" +
        "<th scope=\"col\">Sport</th>" +
        "<th scope=\"col\">Activities</th>" +
        "<th scope=\"col\">Mean moving time <span class=\"viz-unit\">mm:ss</span></th>" +
        "<th scope=\"col\">Mean distance</th>" +
        "<th scope=\"col\">Mean pace</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  // -- the performance chart ----------------------------------------------

  var DEGREE_NAMES = { 1: "Linear", 2: "Quadratic", 3: "Cubic" };

  /* Least squares against a Vandermonde in x rescaled to [0, 1]. The rescale
     is not cosmetic: on raw epoch-day numbers the cubic normal equations are
     ill-conditioned enough that the solve comes back as noise.

     Returns null rather than a line when there is not enough data, and drops
     the degree before it drops the line. The rule is at least two observations
     per coefficient: a cubic through seven points still fits, but it fits the
     noise, and it says so by whipping upward at the last point. So a cubic
     wants eight runs, a quadratic six, a straight line four. */
  function polyfit(xs, ys, degree) {
    var n = xs.length;
    while (degree > 1 && n < 2 * (degree + 1)) degree -= 1;
    if (degree < 1 || n < 2 * (degree + 1)) return null;

    var lo = Math.min.apply(null, xs);
    var hi = Math.max.apply(null, xs);
    var span = hi - lo;
    if (!span) return null;

    var m = degree + 1;
    var t = xs.map(function (x) { return (x - lo) / span; });

    // Normal equations (X'X)b = X'y, assembled straight from power sums, with
    // the right-hand side carried as an extra column.
    var A = [];
    var i, j, k, s;
    for (i = 0; i < m; i++) {
      A[i] = [];
      for (j = 0; j < m; j++) {
        s = 0;
        for (k = 0; k < n; k++) s += Math.pow(t[k], i + j);
        A[i][j] = s;
      }
      s = 0;
      for (k = 0; k < n; k++) s += Math.pow(t[k], i) * ys[k];
      A[i][m] = s;
    }

    // Gauss-Jordan with partial pivoting.
    for (var c = 0; c < m; c++) {
      var pivot = c;
      for (var r = c + 1; r < m; r++) {
        if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
      }
      if (Math.abs(A[pivot][c]) < 1e-12) return null;
      var swap = A[c]; A[c] = A[pivot]; A[pivot] = swap;
      for (var r2 = 0; r2 < m; r2++) {
        if (r2 === c) continue;
        var f = A[r2][c] / A[c][c];
        for (var c2 = c; c2 <= m; c2++) A[r2][c2] -= f * A[c][c2];
      }
    }

    var coef = [];
    for (i = 0; i < m; i++) coef[i] = A[i][m] / A[i][i];

    function at(x) {
      var u = (x - lo) / span;
      var out = 0;
      for (var d = m - 1; d >= 0; d--) out = out * u + coef[d];
      return out;
    }

    var mean = ys.reduce(function (acc, v) { return acc + v; }, 0) / n;
    var ssTot = 0, ssRes = 0;
    for (k = 0; k < n; k++) {
      ssTot += Math.pow(ys[k] - mean, 2);
      ssRes += Math.pow(ys[k] - at(xs[k]), 2);
    }
    return { degree: degree, at: at, r2: ssTot > 0 ? 1 - ssRes / ssTot : null };
  }

  var MS_PER_DAY = 86400000;

  function dayValue(iso) {
    return parseDay(iso).getTime() / MS_PER_DAY;
  }

  function dayDate(value) {
    return new Date(Math.round(value * MS_PER_DAY));
  }

  /* Month boundaries inside the visible span. Built from local Date arithmetic
     rather than by adding a fixed number of days, so months keep their real
     lengths and a DST change does not walk the ticks off the first. */
  function monthTicks(minDay, maxDay) {
    var first = dayDate(minDay);
    var cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    if (cursor.getTime() / MS_PER_DAY < minDay) {
      cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    }
    var out = [];
    while (cursor.getTime() / MS_PER_DAY <= maxDay && out.length < 200) {
      out.push(cursor.getTime() / MS_PER_DAY);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return out;
  }

  function dayLabel(value) {
    var d = dayDate(value);
    // A tick on the 1st is a month boundary, and the month alone names it --
    // with the year attached in January, where the reader needs it.
    if (d.getDate() === 1) {
      return d.getMonth() === 0
        ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
        : d.toLocaleDateString(undefined, { month: "short" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function legendItem(label, color, aside, solid) {
    var stroke = esc(color);
    var line = solid
      ? "<line x1=\"0\" y1=\"5\" x2=\"26\" y2=\"5\" stroke=\"" + stroke + "\" stroke-width=\"2.4\"/>"
      : "<line x1=\"0\" y1=\"5\" x2=\"26\" y2=\"5\" stroke=\"" + stroke + "\" stroke-width=\"2.4\" stroke-dasharray=\"4 3\" opacity=\"0.45\"/>";
    var dot = solid
      ? "<circle cx=\"13\" cy=\"5\" r=\"4\" fill=\"" + stroke + "\" stroke=\"" + esc(C.surface) + "\" stroke-width=\"1.5\"/>"
      : "<circle cx=\"13\" cy=\"5\" r=\"4\" fill=\"" + esc(C.surface) + "\" stroke=\"" + stroke + "\" stroke-width=\"1.6\"/>";
    return "<span class=\"viz-legend-item\">" +
      "<svg width=\"26\" height=\"10\" viewBox=\"0 0 26 10\" aria-hidden=\"true\">" + line + dot + "</svg>" +
      esc(label) + " <span class=\"viz-legend-aside\">· " + esc(aside) + "</span></span>";
  }

  function renderPerformance(scoped, sports) {
    if (!document.getElementById("chart-performance")) return;

    var land = sports.filter(function (s) { return !isPool(s); });
    var pool = sports.filter(isPool);
    RESERVED_SPORTS.forEach(function (sport) {
      if (isPool(sport) && pool.indexOf(sport) === -1) pool.push(sport);
    });

    /* Only the primary land sport goes on the left axis. sports arrives
       most-frequent-first, so that is the sport the page is mostly about.
       Putting a 15 min/km hike on the same scale as a 5 min/km run squashes
       the runs into an unreadable band -- the chart that does show every sport
       at once plots pace against distance instead, further down the page. */
    var leftSport = land.length ? land[0] : null;
    var rightSport = pool.length ? pool[0] : null;

    var datasets = [];
    var notes = [];
    var hasRight = false;

    function addSeries(sport, axis) {
      var points = scoped
        .filter(function (a) { return a.sport === sport && a.pace_min_per_km; })
        .map(function (a) {
          return { x: dayValue(a.date), y: paceOf(a), raw: a };
        })
        .sort(function (p, q) { return p.x - q.x; });
      if (!points.length) return false;

      var xs = points.map(function (p) { return p.x; });
      var ys = points.map(function (p) { return p.y; });
      var fit = polyfit(xs, ys, 3);

      // Pushed before the marks so the marks draw over the line: with equal
      // `order`, Chart.js draws datasets in the order they are given.
      if (fit) {
        var lo = xs[0];
        var hi = xs[xs.length - 1];
        var line = [];
        for (var i = 0; i <= 60; i++) {
          var x = lo + ((hi - lo) * i) / 60;
          line.push({ x: x, y: fit.at(x) });
        }
        datasets.push({
          label: sport + " trend",
          data: line,
          yAxisID: axis,
          showLine: true,
          borderColor: sportColor(sport),
          borderWidth: 2.4,
          borderCapStyle: "round",
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0,
        });
        notes.push(
          DEGREE_NAMES[fit.degree] + " trend fitted on " + points.length + " " +
          sport.toLowerCase() + (points.length === 1 ? "" : "s") + " against date" +
          (fit.r2 === null ? "" : ", R² = " + num(fit.r2, 2))
        );
      } else {
        notes.push(
          "Too few " + sport.toLowerCase() + "s in this range to fit a trend line"
        );
      }

      datasets.push({
        label: sport,
        data: points,
        yAxisID: axis,
        showLine: false,
        backgroundColor: sportColor(sport),
        borderColor: C.surface,
        borderWidth: 1.5,
        pointRadius: 4.2,
        pointHoverRadius: 6,
        pointHitRadius: 12,
      });
      return true;
    }

    if (leftSport) addSeries(leftSport, "y");
    if (rightSport) hasRight = addSeries(rightSport, "y2");

    /* With nothing swum, the right axis has no data to scale it. Pinning it to
       a plausible pool range keeps the reserved axis legible instead of
       collapsing it onto a single value -- and the step is pinned too, because
       an auto-chosen step lands on values that read as ragged once pace()
       turns them into mm:ss. A quarter of a minute is 15 seconds. */
    var idleMin = state.unit === "mi" ? 1.25 : 1.5;
    var idleMax = state.unit === "mi" ? 2.75 : 3;
    var idleStep = 0.25;

    var legendHtml = [];
    if (leftSport) {
      legendHtml.push(legendItem(leftSport, sportColor(leftSport), "left axis", true));
    }
    if (rightSport) {
      legendHtml.push(legendItem(
        rightSport,
        sportColor(rightSport),
        "right axis" + (hasRight ? "" : ", no data yet"),
        hasRight
      ));
    }
    setText("legend-performance", legendHtml.join(""));

    if (rightSport && !hasRight) {
      notes.push("No " + rightSport + " activities recorded yet — the right axis is reserved");
    }
    setText("fit-performance", notes.length ? esc(notes.join(" · ")) + "." : "");

    draw("chart-performance", {
      type: "scatter",
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: axisX({
            type: "linear",
            ticks: {
              color: C.muted,
              font: { size: 11 },
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 8,
              callback: function (v) { return dayLabel(v); },
            },
            afterBuildTicks: function (axis) {
              // Only take the months over when there are enough of them to
              // read as an axis; on a 30-day range Chart.js's own tick
              // placement says more than one lonely month boundary would.
              var months = monthTicks(axis.min, axis.max);
              if (months.length >= 3) {
                axis.ticks = months.map(function (v) { return { value: v }; });
              }
            },
          }),
          y: axisY("min" + paceUnit(), {
            beginAtZero: false,
            // Faster is a smaller number, so up means quicker on both axes.
            reverse: true,
            display: !!leftSport,
            // The axis title carries its series' colour: with two axes on two
            // scales, that is what tells a reader which points belong to which
            // one without reading the legend first.
            title: leftSport
              ? { display: true, text: "min" + paceUnit(), color: sportColor(leftSport), font: { size: 11, weight: "600" } }
              : undefined,
            ticks: {
              color: C.muted,
              font: { size: 11 },
              padding: 8,
              callback: function (v) { return pace(v); },
            },
          }),
          y2: axisY("min" + poolPaceUnit(), {
            beginAtZero: false,
            reverse: true,
            display: !!rightSport,
            position: "right",
            title: rightSport
              ? { display: true, text: "min" + poolPaceUnit(), color: sportColor(rightSport), font: { size: 11, weight: "600" } }
              : undefined,
            // One set of horizontal gridlines, owned by the left axis.
            grid: { drawOnChartArea: false, drawTicks: false },
            min: hasRight ? undefined : idleMin,
            max: hasRight ? undefined : idleMax,
            ticks: {
              color: C.muted,
              font: { size: 11 },
              padding: 8,
              stepSize: hasRight ? undefined : idleStep,
              callback: function (v) { return pace(v); },
            },
          }),
        },
        plugins: {
          // The HTML legend beside the title carries the line styles, which a
          // Chart.js swatch square cannot.
          legend: legend(false),
          tooltip: tooltip({
            filter: function (item) {
              return item.dataset.label.indexOf(" trend") === -1;
            },
            title: function (items) {
              var a = items[0].raw.raw;
              return a && a.name ? a.name : items[0].dataset.label;
            },
            label: function (item) {
              var a = item.raw.raw;
              if (!a) return "";
              return [
                longDate(a.date),
                num(toDistance(a.distance_km), 2) + " " + distanceUnit() +
                  " in " + clock(a.moving_time_min),
                pace(paceOf(a)) + " " + paceUnitOf(a.sport),
              ];
            },
          }),
        },
      },
    });
  }

  // -- wiring -------------------------------------------------------------

  var summary = null;
  var sportOrder = [];
  var generatedAt = null;

  /* The day the "current streak" is measured against.
     `summary.last_day` is the last activity's own date, so passing it here --
     which is what this used to do -- asked whether the last activity happened
     within a day of itself. It always had, so `current` was never zero and the
     tile read "current: 1 day" over a log whose last session was months back.
     The sync timestamp is the page's own notion of now, and it is already what
     the masthead dates the page from, so a page that stops being rebuilt lets
     the streak lapse rather than freezing it. Falls back to the last activity
     only when there is no timestamp to use, which is the old behaviour and the
     most generous reading available. */
  function asOfDay() {
    if (generatedAt && !isNaN(generatedAt.getTime())) return dayKey(generatedAt);
    return summary.last_day ||
      (summary.activities.length ? summary.activities[summary.activities.length - 1].date : null);
  }

  function renderAll() {
    var scoped = inRange(summary.activities);

    renderHeadline(scoped);
    renderRecent(scoped);
    renderSportMeans(scoped, sportOrder);
    renderPerformance(scoped, sportOrder);

    renderTiles(scoped, asOfDay());
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
    C = core.palette();

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

    core.loadJSON(DATA_URL)
      .then(function (json) {
        summary = json;
        if (!summary.activities || !summary.activities.length) {
          fail("No activities have been published yet. The daily sync writes this file; it will fill in on the next run.");
          return;
        }
        if (summary.schema_version !== SCHEMA) {
          fail("This page reads schema version " + SCHEMA + ", but the data file is version " + summary.schema_version + ". The page needs updating.");
          return;
        }
        sportOrder = assignSportColors(summary.activities);

        // The sync date is part of the masthead line rather than a standalone
        // paragraph, so renderHeadline() -- not this -- writes it out.
        generatedAt = summary.generated_at ? new Date(summary.generated_at) : null;

        ready = true;
        renderAll();
      })
      .catch(function (error) {
        fail("Could not load the training data (" + error.message + ").");
      });
  }

  core.onReady(start);
})();
