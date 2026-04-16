(function () {
  "use strict";

  const state = {
    examples: [],
    sourceMeta: null,
    trace: null,
    timeline: [],
    filteredIndices: [],
    selectedIndex: -1,
    playTimer: null,
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    dom.traceFileInput = document.getElementById("trace-file-input");
    dom.exampleSelect = document.getElementById("example-select");
    dom.loadExampleButton = document.getElementById("load-example-button");
    dom.phaseFilter = document.getElementById("phase-filter");
    dom.kindFilter = document.getElementById("kind-filter");
    dom.eventSearchInput = document.getElementById("event-search-input");
    dom.eventList = document.getElementById("event-list");
    dom.eventDetails = document.getElementById("event-details");
    dom.variableBoundsTable = document.getElementById("variable-bounds-table");
    dom.lpStateView = document.getElementById("lp-state-view");
    dom.setupSummary = document.getElementById("setup-summary");
    dom.finalResponseSummary = document.getElementById("final-response-summary");
    dom.inputModelSummary = document.getElementById("input-model-summary");
    dom.inputModelJson = document.getElementById("input-model-json");
    dom.presolvedModelSummary = document.getElementById("presolved-model-summary");
    dom.presolvedModelJson = document.getElementById("presolved-model-json");
    dom.rawLogView = document.getElementById("raw-log-view");
    dom.trajectoryChart = document.getElementById("trajectory-chart");
    dom.eventCounter = document.getElementById("event-counter");
    dom.summaryProblem = document.getElementById("summary-problem");
    dom.summaryStatus = document.getElementById("summary-status");
    dom.summaryBound = document.getElementById("summary-bound");
    dom.summarySolution = document.getElementById("summary-solution");
    dom.summaryEvents = document.getElementById("summary-events");
    dom.summarySource = document.getElementById("summary-source");
    dom.exampleNote = document.getElementById("example-note");
    dom.prevEventButton = document.getElementById("prev-event-button");
    dom.playPauseButton = document.getElementById("play-pause-button");
    dom.nextEventButton = document.getElementById("next-event-button");

    dom.traceFileInput.addEventListener("change", onTraceFileSelected);
    dom.loadExampleButton.addEventListener("click", onLoadExampleClicked);
    dom.phaseFilter.addEventListener("change", applyFilters);
    dom.kindFilter.addEventListener("change", applyFilters);
    dom.eventSearchInput.addEventListener("input", applyFilters);
    dom.prevEventButton.addEventListener("click", () => stepSelection(-1));
    dom.nextEventButton.addEventListener("click", () => stepSelection(1));
    dom.playPauseButton.addEventListener("click", togglePlayback);

    populateExampleSelect();
    populateFilters();
    render();
    void loadBundledExamples();
  }

  function populateExampleSelect() {
    const options = state.examples
      .map(
        (example) =>
          `<option value="${escapeHtml(example.id || "")}">${escapeHtml(
            example.title || example.id || "example"
          )}</option>`
      )
      .join("");
    dom.exampleSelect.innerHTML =
      options || '<option value="">No bundled examples</option>';
  }

  function onTraceFileSelected(event) {
    const [file] = event.target.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const trace = JSON.parse(String(reader.result));
        loadTrace(trace, {
          id: file.name,
          title: file.name,
          description: "Uploaded JSON trace.",
          sourceLabel: `Uploaded file: ${file.name}`,
        });
      } catch (error) {
        window.alert(`Could not parse JSON trace.\n\n${error}`);
      }
    };
    reader.readAsText(file);
  }

  function onLoadExampleClicked() {
    void loadExample(dom.exampleSelect.value);
  }

  async function loadBundledExamples() {
    try {
      state.examples = await fetchJson("examples.json");
      populateExampleSelect();
      if (state.examples.length > 0) {
        await loadExample(state.examples[0].id);
      } else {
        render();
      }
    } catch (error) {
      state.examples = [];
      populateExampleSelect();
      render();
      dom.exampleNote.innerHTML =
        "<div>Bundled examples could not be loaded. File upload still works.</div>";
    }
  }

  async function loadExample(exampleId) {
    const example = state.examples.find((item) => item.id === exampleId);
    if (!example) return;
    try {
      const trace =
        example.trace !== undefined
          ? example.trace
          : await fetchJson(example.tracePath);
      let log = example.log;
      if (log === undefined && example.logPath) {
        try {
          log = await fetchText(example.logPath);
        } catch (error) {
          log = undefined;
        }
      }
      loadTrace(trace, { ...example, log });
    } catch (error) {
      window.alert(`Could not load bundled example.\n\n${error}`);
    }
  }

  function loadTrace(trace, sourceMeta) {
    stopPlayback();
    state.sourceMeta = sourceMeta || {};
    state.trace = trace || {};
    state.timeline = buildTimeline(state.trace);
    populateFilters();
    state.selectedIndex = state.timeline.length > 0 ? state.timeline[0].position : -1;
    applyFilters();
  }

  function buildTimeline(trace) {
    const events = Array.isArray(trace.events) ? trace.events.slice() : [];
    events.sort((left, right) => toNumber(left.index, 0) - toNumber(right.index, 0));

    let currentBounds = {};
    let currentVariableBounds = [];
    let currentLpState = null;

    return events.map((event, position) => {
      currentBounds = mergeBounds(currentBounds, event.bounds);
      if (Array.isArray(event.variable_bounds) && event.variable_bounds.length > 0) {
        currentVariableBounds = event.variable_bounds.map(cloneShallow);
      }
      if (event.lp_state) {
        currentLpState = {
          component_id: event.lp_state.component_id,
          managed_constraints: event.lp_state.managed_constraints,
          active_rows: event.lp_state.active_rows,
          active_row_indices: Array.isArray(event.lp_state.active_row_indices)
            ? event.lp_state.active_row_indices.slice()
            : [],
          highlighted_row_indices: Array.isArray(
            event.lp_state.highlighted_row_indices
          )
            ? event.lp_state.highlighted_row_indices.slice()
            : [],
          candidate_row_indices: Array.isArray(event.lp_state.candidate_row_indices)
            ? event.lp_state.candidate_row_indices.slice()
            : [],
        };
      }

      const fields = Array.isArray(event.fields) ? event.fields : [];
      const fieldMap = {};
      for (const field of fields) {
        fieldMap[field.key] = field.value;
      }

      return {
        position,
        raw: event,
        title: event.title || event.kind || `event ${position}`,
        fieldMap,
        snapshotBounds: cloneShallow(currentBounds),
        snapshotVariableBounds: currentVariableBounds.map(cloneShallow),
        snapshotLpState: currentLpState
          ? {
              component_id: currentLpState.component_id,
              managed_constraints: currentLpState.managed_constraints,
              active_rows: currentLpState.active_rows,
              active_row_indices: currentLpState.active_row_indices.slice(),
              highlighted_row_indices:
                currentLpState.highlighted_row_indices.slice(),
              candidate_row_indices: currentLpState.candidate_row_indices.slice(),
            }
          : null,
      };
    });
  }

  function mergeBounds(previous, next) {
    const merged = cloneShallow(previous);
    if (!next || typeof next !== "object") return merged;
    for (const key of Object.keys(next)) {
      merged[key] = next[key];
    }
    return merged;
  }

  function populateFilters() {
    const phases = new Set(["all"]);
    const kinds = new Set(["all"]);
    for (const event of state.timeline) {
      phases.add(event.raw.phase || "unknown");
      kinds.add(event.raw.kind || "unknown");
    }
    dom.phaseFilter.innerHTML = Array.from(phases)
      .map(
        (phase) =>
          `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`
      )
      .join("");
    dom.kindFilter.innerHTML = Array.from(kinds)
      .map(
        (kind) =>
          `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`
      )
      .join("");
    if (!dom.phaseFilter.value) dom.phaseFilter.value = "all";
    if (!dom.kindFilter.value) dom.kindFilter.value = "all";
  }

  function applyFilters() {
    stopPlayback();
    const selectedPhase = dom.phaseFilter.value || "all";
    const selectedKind = dom.kindFilter.value || "all";
    const query = (dom.eventSearchInput.value || "").trim().toLowerCase();

    state.filteredIndices = state.timeline
      .filter((event) => {
        if (selectedPhase !== "all" && event.raw.phase !== selectedPhase) return false;
        if (selectedKind !== "all" && event.raw.kind !== selectedKind) return false;
        if (!query) return true;
        const haystack = [
          event.title,
          event.raw.message,
          event.raw.phase,
          event.raw.kind,
          event.raw.subsolver,
          ...Object.entries(event.fieldMap).flat(),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .map((event) => event.position);

    if (!state.filteredIndices.includes(state.selectedIndex)) {
      state.selectedIndex =
        state.filteredIndices.length > 0 ? state.filteredIndices[0] : -1;
    }
    render();
  }

  function currentEvent() {
    if (state.selectedIndex < 0) return null;
    return state.timeline[state.selectedIndex] || null;
  }

  function render() {
    renderSummary();
    renderChart();
    renderEventList();
    renderEventDetails();
    renderVariableBounds();
    renderLpState();
    renderSetupSummary();
    renderFinalResponse();
    renderModels();
    renderRawLog();
    updatePlaybackButton();
  }

  function renderSummary() {
    const finalResponse = state.trace && state.trace.final_response ? state.trace.final_response : {};
    const current = currentEvent();
    const currentBounds = current ? current.snapshotBounds : {};
    const boundValue =
      parseMaybeNumber(finalResponse.best_objective_bound) ??
      parseMaybeNumber(currentBounds.best_bound);
    const solutionValue =
      parseMaybeNumber(finalResponse.objective_value) ??
      parseMaybeNumber(currentBounds.best_solution_objective);

    dom.summaryProblem.textContent =
      (state.trace && state.trace.problem_name) ||
      state.sourceMeta?.title ||
      "No trace loaded";
    dom.summaryStatus.textContent = finalResponse.status || "-";
    dom.summaryBound.textContent = formatValue(boundValue);
    dom.summarySolution.textContent = formatValue(solutionValue);
    dom.summaryEvents.textContent = String(state.timeline.length);
    dom.summarySource.textContent =
      state.sourceMeta?.sourceLabel ||
      state.sourceMeta?.title ||
      "Choose a bundled example or load a JSON trace.";

    const noteLines = [];
    if (state.sourceMeta?.description) noteLines.push(state.sourceMeta.description);
    if (state.sourceMeta?.command) noteLines.push(`Command: ${state.sourceMeta.command}`);
    dom.exampleNote.innerHTML = noteLines
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("");
  }

  function renderChart() {
    if (state.timeline.length === 0) {
      dom.trajectoryChart.innerHTML =
        '<div class="empty-state">No trace loaded yet.</div>';
      return;
    }

    const boundSeries = state.timeline.map((event) =>
      parseMaybeNumber(event.snapshotBounds.best_bound)
    );
    const solutionSeries = state.timeline.map((event) =>
      parseMaybeNumber(event.snapshotBounds.best_solution_objective)
    );
    const finiteValues = boundSeries
      .concat(solutionSeries)
      .filter((value) => Number.isFinite(value));

    if (finiteValues.length === 0) {
      dom.trajectoryChart.innerHTML =
        '<div class="empty-state">This trace does not contain numeric objective bounds.</div>';
      return;
    }

    let minValue = Math.min.apply(null, finiteValues);
    let maxValue = Math.max.apply(null, finiteValues);
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }

    const width = 900;
    const height = 280;
    const margin = { top: 18, right: 24, bottom: 34, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xStep =
      state.timeline.length > 1 ? plotWidth / (state.timeline.length - 1) : 0;
    const xFor = (position) => margin.left + position * xStep;
    const yFor = (value) =>
      margin.top + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

    const gridLines = [];
    for (let tick = 0; tick <= 4; ++tick) {
      const ratio = tick / 4;
      const y = margin.top + ratio * plotHeight;
      const value = maxValue - ratio * (maxValue - minValue);
      gridLines.push(
        `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(148,163,184,0.25)" stroke-width="1" />`
      );
      gridLines.push(
        `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="currentColor">${escapeHtml(
          formatValue(value)
        )}</text>`
      );
    }

    const svgParts = [
      `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Objective trajectory chart">`,
      `<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="transparent" />`,
      gridLines.join(""),
      `<line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${
        height - margin.bottom
      }" stroke="rgba(148,163,184,0.35)" stroke-width="1" />`,
      `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${
        height - margin.bottom
      }" stroke="rgba(148,163,184,0.35)" stroke-width="1" />`,
      `<text x="${margin.left}" y="${height - 10}" font-size="11" fill="currentColor">event 0</text>`,
      `<text x="${width - margin.right}" y="${height - 10}" text-anchor="end" font-size="11" fill="currentColor">event ${
        state.timeline.length - 1
      }</text>`,
      buildSeriesPath(boundSeries, xFor, yFor, "var(--accent)", "#38bdf8"),
      buildSeriesPath(solutionSeries, xFor, yFor, "var(--good)", "#34d399"),
    ];

    const current = currentEvent();
    if (current) {
      const x = xFor(current.position);
      svgParts.push(
        `<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#f87171" stroke-width="2" stroke-dasharray="5 4" />`
      );
      const currentBound = boundSeries[current.position];
      const currentSolution = solutionSeries[current.position];
      if (Number.isFinite(currentBound)) {
        svgParts.push(
          `<circle cx="${x}" cy="${yFor(currentBound)}" r="4.5" fill="#38bdf8" />`
        );
      }
      if (Number.isFinite(currentSolution)) {
        svgParts.push(
          `<circle cx="${x}" cy="${yFor(currentSolution)}" r="4.5" fill="#34d399" />`
        );
      }
    }

    svgParts.push("</svg>");
    dom.trajectoryChart.innerHTML = svgParts.join("");
  }

  function buildSeriesPath(values, xFor, yFor, cssColor, fallbackColor) {
    const points = [];
    for (let i = 0; i < values.length; ++i) {
      const value = values[i];
      if (!Number.isFinite(value)) continue;
      points.push(`${xFor(i)},${yFor(value)}`);
    }
    if (points.length === 0) return "";
    return `<polyline fill="none" stroke="${fallbackColor}" stroke-width="3" points="${points.join(
      " "
    )}" data-color="${cssColor}" />`;
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading ${path}`);
    }
    return await response.json();
  }

  async function fetchText(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading ${path}`);
    }
    return await response.text();
  }

  function renderEventList() {
    if (state.filteredIndices.length === 0) {
      dom.eventList.innerHTML =
        '<div class="empty-state">No events match the current filters.</div>';
      dom.eventCounter.textContent = "0 / 0";
      return;
    }

    dom.eventCounter.textContent = `${state.filteredIndices.indexOf(state.selectedIndex) + 1} / ${
      state.filteredIndices.length
    }`;

    dom.eventList.innerHTML = state.filteredIndices
      .map((position) => {
        const event = state.timeline[position];
        const activeClass = position === state.selectedIndex ? " active" : "";
        return `
          <button class="event-item${activeClass}" data-event-index="${position}" type="button">
            <div class="event-topline">
              <span class="badge phase-${escapeHtml(event.raw.phase || "unknown")}">${escapeHtml(
          event.raw.phase || "unknown"
        )}</span>
              <span class="muted">#${escapeHtml(String(event.raw.index ?? position))}</span>
            </div>
            <div class="event-title">${escapeHtml(event.title)}</div>
            <div class="event-meta">
              <span class="badge">${escapeHtml(event.raw.kind || "unknown")}</span>
              <span class="muted">dtime=${escapeHtml(
                formatValue(parseMaybeNumber(event.raw.deterministic_time))
              )}</span>
            </div>
            <div class="event-message">${escapeHtml(event.raw.message || "")}</div>
          </button>
        `;
      })
      .join("");

    for (const button of dom.eventList.querySelectorAll("[data-event-index]")) {
      button.addEventListener("click", () => {
        state.selectedIndex = Number(button.getAttribute("data-event-index"));
        render();
      });
    }
  }

  function renderEventDetails() {
    const event = currentEvent();
    if (!event) {
      dom.eventDetails.className = "event-details empty-state";
      dom.eventDetails.textContent = "No event selected.";
      return;
    }

    const metadataRows = [
      ["Index", event.raw.index ?? event.position],
      ["Phase", event.raw.phase || "-"],
      ["Kind", event.raw.kind || "-"],
      ["Subsolver", event.raw.subsolver || "-"],
      ["Decision level", event.raw.decision_level ?? 0],
      ["Integer enqueues", event.raw.num_integer_enqueues ?? "-"],
      ["Deterministic time", formatValue(parseMaybeNumber(event.raw.deterministic_time))],
    ];

    const boundsRows = [
      ["Best bound", formatValue(parseMaybeNumber(event.snapshotBounds.best_bound))],
      [
        "Best solution",
        formatValue(parseMaybeNumber(event.snapshotBounds.best_solution_objective)),
      ],
      [
        "Scaled objective lb",
        formatValue(parseMaybeNumber(event.snapshotBounds.scaled_objective_lb)),
      ],
      [
        "Scaled objective ub",
        formatValue(parseMaybeNumber(event.snapshotBounds.scaled_objective_ub)),
      ],
      [
        "Inner objective lb",
        formatValue(parseMaybeNumber(event.snapshotBounds.inner_objective_lb)),
      ],
      [
        "Inner objective ub",
        formatValue(parseMaybeNumber(event.snapshotBounds.inner_objective_ub)),
      ],
    ];

    dom.eventDetails.className = "event-details";
    dom.eventDetails.innerHTML = `
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.raw.message || "")}</p>
      ${renderKeyValueTable(metadataRows)}
      <h3>Fields</h3>
      ${renderKeyValueTable(
        Object.entries(event.fieldMap).length > 0
          ? Object.entries(event.fieldMap)
          : [["-", "No event-specific fields"]]
      )}
      <h3>Bounds Snapshot</h3>
      ${renderKeyValueTable(boundsRows)}
    `;
  }

  function renderVariableBounds() {
    const event = currentEvent();
    const bounds =
      event && event.snapshotVariableBounds.length > 0
        ? event.snapshotVariableBounds
        : fallbackVariableBoundsFromModel(state.trace?.input_model);

    if (!bounds.length) {
      dom.variableBoundsTable.innerHTML =
        '<div class="empty-state">No variable bounds were captured.</div>';
      return;
    }

    const rows = bounds
      .map((bound) => {
        const lower = bound.lower_bound ?? bound.lb ?? "-";
        const upper = bound.upper_bound ?? bound.ub ?? "-";
        const fixed = String(lower) === String(upper) ? "yes" : "no";
        return `
          <tr>
            <td>${escapeHtml(
              bound.proto_var !== undefined ? String(bound.proto_var) : "-"
            )}</td>
            <td>${escapeHtml(bound.name || "-")}</td>
            <td class="mono">${escapeHtml(String(lower))}</td>
            <td class="mono">${escapeHtml(String(upper))}</td>
            <td>${escapeHtml(fixed)}</td>
          </tr>
        `;
      })
      .join("");

    dom.variableBoundsTable.innerHTML = `
      <div class="table-scroll">
        <table class="summary-table">
          <thead>
            <tr>
              <th>Proto var</th>
              <th>Name</th>
              <th>Lower</th>
              <th>Upper</th>
              <th>Fixed</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderLpState() {
    const event = currentEvent();
    const lpState = event ? event.snapshotLpState : null;
    if (!lpState) {
      dom.lpStateView.innerHTML =
        '<div class="empty-state">This event does not carry LP state.</div>';
      return;
    }

    const component = Array.isArray(state.trace?.lp_components)
      ? state.trace.lp_components.find(
          (item) => item.component_id === lpState.component_id
        )
      : null;

    const activeRows = new Set(lpState.active_row_indices || []);
    const highlightedRows = new Set(lpState.highlighted_row_indices || []);
    const candidateRows = new Set(lpState.candidate_row_indices || []);

    let rowsHtml = '<div class="empty-state">No LP rows are registered for this component.</div>';
    if (component && Array.isArray(component.rows) && component.rows.length > 0) {
      rowsHtml = `
        <div class="table-scroll">
          <table class="summary-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Status</th>
                <th>Display</th>
                <th>Proto vars</th>
              </tr>
            </thead>
            <tbody>
              ${component.rows
                .map((row) => {
                  const classes = [
                    "lp-row",
                    activeRows.has(row.row_index) ? "active" : "",
                    highlightedRows.has(row.row_index) ? "highlight" : "",
                    candidateRows.has(row.row_index) ? "candidate" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const pills = [
                    activeRows.has(row.row_index)
                      ? '<span class="lp-row-pill active">active</span>'
                      : "",
                    highlightedRows.has(row.row_index)
                      ? '<span class="lp-row-pill highlight">highlight</span>'
                      : "",
                    candidateRows.has(row.row_index)
                      ? '<span class="lp-row-pill candidate">candidate</span>'
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return `
                    <tr class="${classes}">
                      <td>${escapeHtml(String(row.row_index))}</td>
                      <td>${pills || '<span class="muted">-</span>'}</td>
                      <td class="mono">${escapeHtml(row.display || "")}</td>
                      <td>${escapeHtml((row.proto_vars || []).join(", "))}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    const summaryRows = [
      ["Component", lpState.component_id],
      ["Managed constraints", lpState.managed_constraints ?? "-"],
      ["Active rows", lpState.active_rows ?? "-"],
      ["Columns", component ? component.num_columns : "-"],
      ["Objective defined", component ? String(component.objective_defined) : "-"],
    ];

    dom.lpStateView.innerHTML = `
      ${renderKeyValueTable(summaryRows)}
      <div class="muted" style="margin: 0.8rem 0 0.5rem;">
        Highlighted rows show the current focus of the LP event. Candidate rows
        are violated rows considered for addition.
      </div>
      ${rowsHtml}
    `;
  }

  function renderSetupSummary() {
    const setup = state.trace?.setup || {};
    const rows = [
      ["Subsolvers", Array.isArray(setup.subsolvers) ? setup.subsolvers.join(", ") : "-"],
      ["Propagators", Array.isArray(setup.propagators) ? setup.propagators.join(", ") : "-"],
      ["Generic propagators", setup.num_generic_propagators ?? "-"],
      ["SAT variables", setup.num_sat_variables ?? "-"],
      ["Binary implications", setup.num_binary_implications ?? "-"],
      ["Clauses", setup.num_clauses ?? "-"],
      ["Removable clauses", setup.num_removable_clauses ?? "-"],
      [
        "LP components",
        Array.isArray(state.trace?.lp_components)
          ? state.trace.lp_components.length
          : 0,
      ],
    ];
    dom.setupSummary.innerHTML = renderKeyValueTable(rows);
  }

  function renderFinalResponse() {
    const response = state.trace?.final_response || {};
    const rows = [
      ["Status", response.status || "-"],
      ["Objective", formatValue(parseMaybeNumber(response.objective_value))],
      ["Best bound", formatValue(parseMaybeNumber(response.best_objective_bound))],
      ["Conflicts", response.conflicts ?? "-"],
      ["Branches", response.branches ?? "-"],
      ["Propagations", response.propagations ?? "-"],
      ["Integer propagations", response.integer_propagations ?? "-"],
      ["LP iterations", response.lp_iterations ?? "-"],
      ["Deterministic time", formatValue(parseMaybeNumber(response.deterministic_time))],
      ["Wall time", formatValue(parseMaybeNumber(response.wall_time))],
    ];
    dom.finalResponseSummary.innerHTML = renderKeyValueTable(rows);
  }

  function renderModels() {
    const inputModel = state.trace?.input_model || {};
    const presolvedModel = state.trace?.presolved_model || {};
    dom.inputModelSummary.innerHTML = renderModelSummary(inputModel);
    dom.inputModelJson.textContent = prettyJson(inputModel);
    dom.presolvedModelSummary.innerHTML = renderModelSummary(presolvedModel);
    dom.presolvedModelJson.textContent = prettyJson(presolvedModel);
  }

  function renderRawLog() {
    dom.rawLogView.textContent =
      state.sourceMeta?.log || "No raw log bundled for this trace.";
  }

  function renderModelSummary(model) {
    const variables = Array.isArray(model?.variables) ? model.variables : [];
    const constraints = Array.isArray(model?.constraints) ? model.constraints : [];
    const samples = variables.slice(0, 8).map((variable, index) => [
      variable.name || `v${index}`,
      formatDomain(variable.domain),
    ]);

    const rows = [
      ["Variables", variables.length],
      ["Constraints", constraints.length],
      ["Has objective", model?.objective ? "yes" : "no"],
      [
        "Search strategy blocks",
        Array.isArray(model?.search_strategy) ? model.search_strategy.length : 0,
      ],
    ];

    const sampleHtml =
      samples.length === 0
        ? '<div class="muted">No variable summary available.</div>'
        : `
          <div class="table-scroll">
            <table class="summary-table">
              <thead><tr><th>Variable</th><th>Domain</th></tr></thead>
              <tbody>
                ${samples
                  .map(
                    ([name, domain]) =>
                      `<tr><td>${escapeHtml(name)}</td><td class="mono">${escapeHtml(
                        domain
                      )}</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;

    return `${renderKeyValueTable(rows)}${sampleHtml}`;
  }

  function fallbackVariableBoundsFromModel(model) {
    const variables = Array.isArray(model?.variables) ? model.variables : [];
    return variables.map((variable, index) => {
      const domain = Array.isArray(variable.domain) ? variable.domain : [];
      return {
        proto_var: index,
        name: variable.name || `v${index}`,
        lower_bound: domain.length > 0 ? domain[0] : "-",
        upper_bound: domain.length > 1 ? domain[domain.length - 1] : "-",
      };
    });
  }

  function stepSelection(direction) {
    if (state.filteredIndices.length === 0) return;
    const currentOffset = state.filteredIndices.indexOf(state.selectedIndex);
    const nextOffset = clamp(
      currentOffset + direction,
      0,
      state.filteredIndices.length - 1
    );
    state.selectedIndex = state.filteredIndices[nextOffset];
    render();
  }

  function togglePlayback() {
    if (state.playTimer) {
      stopPlayback();
      render();
      return;
    }
    if (state.filteredIndices.length <= 1) return;
    state.playTimer = window.setInterval(() => {
      const currentOffset = state.filteredIndices.indexOf(state.selectedIndex);
      if (currentOffset >= state.filteredIndices.length - 1) {
        stopPlayback();
      } else {
        state.selectedIndex = state.filteredIndices[currentOffset + 1];
      }
      render();
    }, 850);
    updatePlaybackButton();
  }

  function stopPlayback() {
    if (!state.playTimer) return;
    window.clearInterval(state.playTimer);
    state.playTimer = null;
    updatePlaybackButton();
  }

  function updatePlaybackButton() {
    dom.playPauseButton.textContent = state.playTimer ? "Pause" : "Play";
  }

  function renderKeyValueTable(rows) {
    return `
      <div class="table-scroll">
        <table class="kv-table">
          <tbody>
            ${rows
              .map(
                ([key, value]) => `
                  <tr>
                    <th>${escapeHtml(String(key))}</th>
                    <td>${escapeHtml(String(value))}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function prettyJson(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function formatDomain(domain) {
    if (!Array.isArray(domain) || domain.length === 0) return "-";
    return domain.map((item) => String(item)).join(", ");
  }

  function parseMaybeNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      if (value === "Infinity" || value === "+Infinity") return null;
      if (value === "-Infinity") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function formatValue(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
      return value.toPrecision(6).replace(/\.0+$/, "");
    }
    return value.toFixed(6).replace(/\.?0+$/, "");
  }

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, lower, upper) {
    return Math.max(lower, Math.min(upper, value));
  }

  function cloneShallow(value) {
    return value && typeof value === "object" ? { ...value } : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
