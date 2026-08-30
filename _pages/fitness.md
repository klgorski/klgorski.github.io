---
layout: single
title: "Fitness"
permalink: /fitness/
# This page lived at /running/ until it grew past running.
redirect_from:
  - /running/
author_profile: false
classes: wide
---

<link rel="stylesheet" href="{{ '/assets/css/running.css' | relative_url }}">

<div class="viz-root">

<!--
  The masthead line. There is no <h1> here on purpose: Minimal Mistakes has
  already rendered page.title above this content, and a second one would be a
  second h1 on the page. The counts in it follow the Range control.
-->
<p id="viz-headline" class="viz-headline" data-viz-summary></p>

<div id="viz-status" class="viz-status" hidden></div>

<!--
  The filter bar sits OUTSIDE the [data-viz-summary] blocks because the units
  toggle is shared chrome: forecast.js reads and listens to it too, and the
  forecast is allowed to render on a day when summary.json does not. Hiding the
  whole bar with the summary would leave the forecast charts stuck in km with no
  visible control. Range and the scope note are summary-only, so they carry the
  attribute individually.
-->
<div class="viz-filters">
  <div class="viz-filter-group" data-viz-summary>
    <span class="viz-filter-label" id="label-range">Range</span>
    <div class="viz-segmented" id="filter-range" role="group" aria-labelledby="label-range">
      <button type="button" data-value="30" aria-pressed="false">30d</button>
      <button type="button" data-value="90" aria-pressed="false">90d</button>
      <button type="button" data-value="365" aria-pressed="false">1y</button>
      <button type="button" data-value="all" aria-pressed="true">All</button>
    </div>
  </div>
  <div class="viz-filter-group">
    <span class="viz-filter-label" id="label-unit">Units</span>
    <div class="viz-segmented" id="filter-unit" role="group" aria-labelledby="label-unit">
      <button type="button" data-value="km" aria-pressed="true">km</button>
      <button type="button" data-value="mi" aria-pressed="false">miles</button>
    </div>
  </div>
  <span class="viz-footnote" id="viz-scope-note" style="margin:0" data-viz-summary></span>
</div>

<div id="viz-band" class="viz-band" data-viz-summary>

  <figure class="viz-figure">
    <div class="viz-figure-head">
      <h2 class="viz-figure-title">Recent activities</h2>
      <p class="viz-figure-note">The last ten sessions in this range, newest first.</p>
    </div>
    <div class="viz-log" id="recent-log"></div>
    <div class="viz-figure-foot"><a href="#every-activity" id="recent-all-link"></a></div>
  </figure>

  <figure class="viz-figure">
    <div class="viz-figure-head">
      <h2 class="viz-figure-title">Mean performance time by activity type</h2>
      <p class="viz-figure-note">Averages over every session of that type in this range.</p>
    </div>
    <div class="viz-matrix" id="table-sport-means"></div>
  </figure>

</div><!-- /viz-band -->

<!--
  Performance over time is the widest thing on the page: one point per activity
  against a date axis that can span a year. It used to sit in the band's right
  column, which is the page width less a 340px log, and the months bunched up.
  It carries data-viz-summary in its own right now -- leaving the band means it
  is no longer inside a block that already had the attribute.
-->
<figure class="viz-figure" data-viz-summary>
  <div class="viz-figure-head">
    <div class="viz-figure-headrow">
      <h2 class="viz-figure-title">Performance over time</h2>
      <div class="viz-legend" id="legend-performance"></div>
    </div>
    <p class="viz-figure-note">
      One point per activity. The pace axes are reversed, so higher is faster.
      Each sport carries its own polynomial trend line fitted to its own axis.
    </p>
  </div>
  <div class="viz-canvas-wrap">
    <canvas id="chart-performance" role="img" aria-label="Scatter of pace over time with a fitted polynomial trend line per sport. Every activity is listed in the table at the foot of the page."></canvas>
  </div>
  <div class="viz-figure-foot" id="fit-performance"></div>
</figure>

<!--
  The forecast is a SIBLING of the summary containers, not a child of one.
  running.js hides every [data-viz-summary] block if summary.json fails to
  load, and forecast.json is published by a separate step that is allowed to
  fail on its own -- so nesting this inside one of them would mean a missing
  summary took down a forecast that had loaded perfectly well.
-->
<section id="forecast-section" class="viz-section" hidden>

<h2>Forecast</h2>

<p class="viz-figure-note" id="forecast-meta" style="margin-bottom:0.4em"></p>
<p class="viz-figure-note" id="forecast-generated" style="margin-top:0;margin-bottom:1.4em"></p>
<p class="viz-callout" id="forecast-warning" hidden></p>

<div class="viz-tiles">
  <div class="viz-tile">
    <span class="viz-tile-label">Next session</span>
    <span class="viz-tile-value" id="forecast-next">–</span>
    <span class="viz-tile-note" id="forecast-next-meta"></span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Fitness trend</span>
    <span class="viz-tile-value" id="forecast-trend">–</span>
    <span class="viz-tile-note" id="forecast-trend-meta"></span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Cost of climbing</span>
    <span class="viz-tile-value" id="forecast-climb">–</span>
    <span class="viz-tile-note" id="forecast-climb-meta"></span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Sample</span>
    <span class="viz-tile-value" id="forecast-sample">–</span>
    <span class="viz-tile-note" id="forecast-sample-meta"></span>
  </div>
</div>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <div class="viz-figure-headrow">
      <h3 class="viz-figure-title" id="title-arma">Log trend</h3>
      <div class="viz-legend" id="legend-arma"></div>
    </div>
    <p class="viz-figure-note">
      Models improvement as a log trend with strong initial improvement but diminishing returns. ARMA components represent the relationship between previous performances and the current performance. Multiple high performance days may predict a low performance recovery days; previous innovations are important for predicting performance. Distance and elevation are also included as predictors in this model.  
    </p>
    <p class="viz-spec" id="spec-arma"></p>
  </div>
  <div class="viz-canvas-wrap is-tall">
    <canvas id="chart-forecast-arma" role="img" aria-label="Fan chart of observed pace, the fitted log trend, and a bootstrapped forecast with 80 and 95 percent intervals. Every value is in the data tables below."></canvas>
  </div>
  <div class="viz-params">
    <h4 class="viz-params-title">Estimated parameters</h4>
    <div id="params-arma"></div>
  </div>
  <div class="viz-figure-foot" id="fit-arma"></div>
  <details class="viz-table-toggle">
    <summary>Show forecast table</summary>
    <div id="table-forecast-arma"></div>
  </details>
  <details class="viz-table-toggle">
    <summary>Show observed and fitted values</summary>
    <div id="table-history-arma"></div>
  </details>
  <details class="viz-table-toggle">
    <summary>Show the BIC order selection</summary>
    <div id="table-bic"></div>
  </details>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <div class="viz-figure-headrow">
      <h3 class="viz-figure-title" id="title-llt">Local linear trend</h3>
      <div class="viz-legend" id="legend-llt"></div>
    </div>
    <p class="viz-figure-note">
      Instead of modeling fitness as a deterministic function of time, performance is modeled as a level of fitness, covariates, and a random white noise process. The level of fitness series is itself comprised of the previous level plus the pace of improvement and a white noise process; the pace of improvement is a moving average process. 
    </p>
    <p class="viz-spec" id="spec-llt"></p>
  </div>
  <div class="viz-canvas-wrap is-tall">
    <canvas id="chart-forecast-llt" role="img" aria-label="Fan chart of observed pace, the smoothed stochastic trend, and a bootstrapped forecast with 80 and 95 percent intervals. Every value is in the data tables below."></canvas>
  </div>
  <div class="viz-params">
    <h4 class="viz-params-title">Estimated parameters</h4>
    <div id="params-llt"></div>
  </div>
  <div class="viz-figure-foot" id="fit-llt"></div>
  <details class="viz-table-toggle">
    <summary>Show forecast table</summary>
    <div id="table-forecast-llt"></div>
  </details>
  <details class="viz-table-toggle">
    <summary>Show observed and fitted values</summary>
    <div id="table-history-llt"></div>
  </details>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">What the models say</h3>
    <p class="viz-figure-note">
      The specification each chart above was fitted from, then the same
      specification with the estimates substituted in. \(y_t\) is the response at
      session \(t\) and \(x_t\) collects the per-session effort regressors.
    </p>
  </div>
  <div class="viz-equations" id="model-equations"></div>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">Assumption checks</h3>
    <p class="viz-figure-note">
      
    </p>
  </div>
  <div class="viz-matrix" id="table-assumptions"></div>
  <div class="viz-figure-foot" id="assumptions-note"></div>
</figure>

<p class="viz-footnote" style="margin-top:0">
  Coefficients are in the units the models were estimated in and do not follow the
  km/miles toggle; only the charts and the forecast tables convert.
  <span id="forecast-failures"></span>
  Both models are refitted from scratch each day, and the intervals come from
  refitting on every bootstrap replicate, so the uncertainty in the parameters is
  inside the band rather than assumed away.
</p>

</section>

<div class="viz-section" data-viz-summary><!-- everything summary.json drives, part two -->

<h2>Training log</h2>

<div class="viz-tiles">
  <div class="viz-tile">
    <span class="viz-tile-label">Distance</span>
    <span class="viz-tile-value" id="stat-distance">–</span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Moving time</span>
    <span class="viz-tile-value" id="stat-time">–</span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Activities</span>
    <span class="viz-tile-value" id="stat-count">–</span>
    <span class="viz-tile-note" id="stat-active-note"></span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Average pace</span>
    <span class="viz-tile-value" id="stat-pace">–</span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Elevation</span>
    <span class="viz-tile-value" id="stat-elevation">–</span>
  </div>
  <div class="viz-tile">
    <span class="viz-tile-label">Longest streak</span>
    <span class="viz-tile-value" id="stat-streak">–</span>
    <span class="viz-tile-note" id="stat-streak-note"></span>
  </div>
</div>

<!--
  Six charts, three rows of two. The pairing is the point: weekly totals beside
  the rolling average reads as one series smoothed against its raw form, and
  the three distribution charts sit beside the things they are most often read
  against. The grid drops to one column below 900px.
-->
<div class="viz-grid">

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">Distance per week</h3>
    <p class="viz-figure-note">Weeks with no activity are shown as gaps rather than skipped, so a break in training reads as one.</p>
  </div>
  <div class="viz-canvas-wrap">
    <canvas id="chart-weekly" role="img" aria-label="Bar chart of distance covered each week, split by sport. The same values are in the data table below."></canvas>
  </div>
  <details class="viz-table-toggle">
    <summary>Show data table</summary>
    <div id="table-weekly"></div>
  </details>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">Seven-day rolling average</h3>
    <p class="viz-figure-note"></p>
  </div>
  <div class="viz-canvas-wrap">
    <canvas id="chart-rolling" role="img" aria-label="Line chart of the seven-day rolling average of daily distance. The same values are in the data table below."></canvas>
  </div>
  <details class="viz-table-toggle">
    <summary>Show data table</summary>
    <div id="table-rolling"></div>
  </details>
</figure>

</div>

<div class="viz-grid">

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">By sport</h3>
  </div>
  <div class="viz-canvas-wrap is-short">
    <canvas id="chart-sports" role="img" aria-label="Bar chart of total distance by sport. The same values are in the data table below."></canvas>
  </div>
  <details class="viz-table-toggle">
    <summary>Show data table</summary>
    <div id="table-sports"></div>
  </details>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">By day of week</h3>
  </div>
  <div class="viz-canvas-wrap is-short">
    <canvas id="chart-weekday" role="img" aria-label="Bar chart of how many activities fall on each weekday. The same values are in the data table below."></canvas>
  </div>
  <details class="viz-table-toggle">
    <summary>Show data table</summary>
    <div id="table-weekday"></div>
  </details>
</figure>

</div>

<div class="viz-grid">

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">Time of day</h3>
    <p class="viz-figure-note"></p>
  </div>
  <div class="viz-canvas-wrap is-short">
    <canvas id="chart-hour" role="img" aria-label="Bar chart of how many activities start in each hour of the day. The same values are in the data table below."></canvas>
  </div>
  <details class="viz-table-toggle">
    <summary>Show data table</summary>
    <div id="table-hour"></div>
  </details>
</figure>

<figure class="viz-figure">
  <div class="viz-figure-head">
    <h3 class="viz-figure-title">Pace against distance</h3>
    <p class="viz-figure-note"></p>
  </div>
  <div class="viz-canvas-wrap is-tall">
    <canvas id="chart-pace" role="img" aria-label="Scatter plot of pace against distance, one point per activity, coloured by sport. Every activity is listed in the table at the foot of the page."></canvas>
  </div>
</figure>

</div>

<h2>Records</h2>

<div class="viz-records">
  <div class="viz-record">
    <span class="viz-record-label">Longest</span>
    <span class="viz-record-value" id="record-distance">–</span>
    <span class="viz-record-meta" id="record-distance-meta"></span>
  </div>
  <div class="viz-record">
    <span class="viz-record-label">Longest by time</span>
    <span class="viz-record-value" id="record-duration">–</span>
    <span class="viz-record-meta" id="record-duration-meta"></span>
  </div>
  <div class="viz-record">
    <span class="viz-record-label">Fastest pace</span>
    <span class="viz-record-value" id="record-pace">–</span>
    <span class="viz-record-meta" id="record-pace-meta"></span>
  </div>
  <div class="viz-record">
    <span class="viz-record-label">Most climbing</span>
    <span class="viz-record-value" id="record-climb">–</span>
    <span class="viz-record-meta" id="record-climb-meta"></span>
  </div>
</div>

<h2 id="every-activity">Every activity</h2>

<figure class="viz-figure">
  <div id="table-activities"></div>
</figure>

<p class="viz-footnote">
  Synced from Strava once a day by
  <a href="https://github.com/klgorski/Strava-Analysis-Project">a small Python package</a>
  and a GitHub Actions workflow. The published file holds aggregate numbers only —
  no coordinates, routes, time zones or profile details ever leave the private
  repository. The data behind this page is two JSON files:
  <a href="{{ '/assets/data/summary.json' | relative_url }}">summary.json</a> for the
  training log and <a href="{{ '/assets/data/forecast.json' | relative_url }}">forecast.json</a>
  for the fitted models.
</p>

</div>
</div>

<script src="{{ '/assets/js/lib/chart.umd.min.js' | relative_url }}"></script>
<script src="{{ '/assets/js/viz-core.js' | relative_url }}"></script>
<script src="{{ '/assets/js/running.js' | relative_url }}" data-src="{{ '/assets/data/summary.json' | relative_url }}"></script>
<script src="{{ '/assets/js/forecast.js' | relative_url }}" data-src="{{ '/assets/data/forecast.json' | relative_url }}"></script>
