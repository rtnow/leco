(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const tasks = window.LECO_TASKS.map(task => ({ ...task, measurements: null, traceError: null, videoError: false, videoName: null, traceName: null }));
  const video = $("evaluation-video"), timeline = $("timeline");
  const colors = ["#176c62", "#ca7645", "#547ea6"];
  const preview = new URLSearchParams(location.search).get("preview") === "1";
  let active = tasks[0], generation = 0, mode = "norm", request = null, animation = null;
  const geometry = { width: 440, height: 133, left: 39, right: 431, top: 13, bottom: 110 };
  const plots = {};
  const finiteDuration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  const duration = () => finiteDuration() || Math.max(1, (active.measurements?.last ?? 1) - active.offset);
  const clock = time => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, "0")}`;
  const number = value => Math.abs(value) >= 1000 ? value.toExponential(1) : Number(value.toFixed(2)).toString();
  function visibleSegments(trace, seconds) {
    if (!trace) return [];
    const segments = []; let current = [];
    const rows = trace.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], t = row.time - active.offset;
      if (t < 0 && i + 1 < rows.length && rows[i + 1].time - active.offset < 0) continue;
      if (t > seconds && i > 0 && rows[i - 1].time - active.offset > seconds) break;
      if (current.length && row.time - current.at(-1).time > trace.maxGap) { segments.push(current); current = []; }
      current.push(row);
    }
    if (current.length) segments.push(current);
    return segments;
  }
  function renderPlot(kind) {
    const trace = active.measurements, seconds = duration(), g = geometry;
    const axes = mode === "axes" && trace?.vectors;
    const keys = axes ? (kind === "force" ? ["fx", "fy", "fz"] : ["tx", "ty", "tz"]) : [kind === "force" ? "fn" : "tn"];
    const segments = visibleSegments(trace, seconds);
    let low = 0, high = 0;
    for (const segment of segments) for (const row of segment) for (const key of keys) { low = Math.min(low, row[key]); high = Math.max(high, row[key]); }
    const padding = Math.max(high - low, 0.01) * 0.12;
    if (axes && low < 0) low -= padding;
    high += padding;
    const x = time => g.left + time / seconds * (g.right - g.left);
    const y = value => g.bottom - (value - low) / (high - low) * (g.bottom - g.top);
    const hasData = segments.some(segment => segment.length > 1 && segment.at(-1).time >= active.offset && segment[0].time <= active.offset + seconds);
    let markup = `<svg viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${kind === "force" ? "Force" : "Torque"} versus video time${hasData ? "; click the plot to seek" : "; measurements pending"}" class="${hasData ? "has-data" : ""}"><defs><clipPath id="clip-${kind}"><rect x="${g.left}" y="${g.top - 3}" width="${g.right - g.left}" height="${g.bottom - g.top + 6}"/></clipPath></defs>`;
    for (let i = 0; i < 4; i++) {
      const yy = g.top + i * (g.bottom - g.top) / 3;
      markup += `<line class="gridline" x1="${g.left}" x2="${g.right}" y1="${yy}" y2="${yy}"/>`;
      if (hasData) markup += `<text class="axis-label" x="${g.left - 8}" y="${yy + 3}" text-anchor="end">${number(high - i * (high - low) / 3)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const xx = x(seconds * i / 4);
      markup += `<line class="gridline" x1="${xx}" x2="${xx}" y1="${g.top}" y2="${g.bottom}"/>`;
      if (hasData || finiteDuration()) markup += `<text class="axis-label" x="${xx}" y="${g.bottom + 17}" text-anchor="middle">${number(seconds * i / 4)}</text>`;
    }
    if (hasData) {
      markup += `<g clip-path="url(#clip-${kind})">`;
      keys.forEach((key, index) => {
        for (const segment of segments) {
          const points = window.LeCoTrace.reduce(segment, key);
          const d = points.map((row, i) => `${i ? "L" : "M"}${x(row.time - active.offset).toFixed(2)},${y(row[key]).toFixed(2)}`).join(" ");
          markup += `<path class="data-line" stroke="${colors[index]}" d="${d}"/>`;
        }
      });
      markup += `</g><g class="plot-cursor"><line class="cursor-line" y1="${g.top}" y2="${g.bottom}"/>`;
      keys.forEach((key, i) => { markup += `<circle class="cursor-dot" data-key="${key}" fill="${colors[i]}" r="3.1"/>`; });
      markup += "</g>";
    } else markup += `<text class="plot-placeholder" x="${(g.left + g.right) / 2}" y="${(g.top + g.bottom) / 2}" text-anchor="middle">${trace ? "No measurements in this time window" : "Awaiting synchronized measurements"}</text>`;
    markup += "</svg>";
    const target = $(`${kind}-plot`); target.innerHTML = markup;
    plots[kind] = { x, y, keys, hasData, target };
    target.querySelector("svg").addEventListener("click", event => {
      if (!finiteDuration()) return;
      const svg = event.currentTarget;
      const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const position = point.matrixTransform(svg.getScreenCTM().inverse()).x;
      seek((position - g.left) / (g.right - g.left) * seconds);
    });
  }
  function renderPlots() {
    const axesButton = document.querySelector('[data-mode="axes"]');
    axesButton.disabled = !active.measurements?.vectors;
    if (mode === "axes" && axesButton.disabled) mode = "norm";
    document.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    $("plot-legend").innerHTML = mode === "axes" ? '<span class="legend-axis x">X</span><span class="legend-axis y">Y</span><span class="legend-axis z">Z</span>' : '<i class="legend-line"></i> Resultant magnitude';
    renderPlot("force"); renderPlot("torque"); updateCursor(); updateStatus();
  }
  function updateCursor() {
    const t = video.currentTime || 0;
    const values = window.LeCoTrace.sample(active.measurements, t + active.offset);
    for (const kind of ["force", "torque"]) {
      const plot = plots[kind]; if (!plot) continue;
      const cursor = plot.target.querySelector(".plot-cursor");
      if (cursor) {
        const line = cursor.querySelector("line"); line.setAttribute("x1", plot.x(t)); line.setAttribute("x2", plot.x(t));
        cursor.querySelectorAll("circle").forEach(dot => {
          dot.style.display = values ? "" : "none";
          if (values) { dot.setAttribute("cx", plot.x(t)); dot.setAttribute("cy", plot.y(values[dot.dataset.key])); }
        });
      }
      $(`${kind}-value`).textContent = values && plot.hasData ? plot.keys.map(key => values[key].toFixed(2)).join(" / ") : "—";
    }
    if (finiteDuration()) {
      timeline.value = t;
      $("time-display").textContent = `${clock(t)} / ${clock(video.duration)}`;
      timeline.setAttribute("aria-valuetext", `${t.toFixed(2)} of ${video.duration.toFixed(2)} seconds`);
    }
  }
  function updateStatus() {
    const hasVideo = Boolean(active.video) && !active.videoError, hasTrace = Boolean(active.measurements);
    const overlap = hasTrace && active.measurements.last >= active.offset && active.measurements.first <= active.offset + duration();
    const ready = hasVideo && hasTrace && overlap && Boolean(finiteDuration());
    $("trace-status").textContent = active.traceError || active.videoError ? "Media unavailable" : ready ? "Synchronized playback" : hasVideo ? "Video evaluation" : hasTrace ? "Trace loaded" : "Media pending";
    $("trace-status").classList.toggle("ready", ready);
    let message = "Video and synchronized force / torque recordings will be added for this task.";
    if (active.videoError) message = "The video could not be loaded. Check the video file and browser format support.";
    else if (active.traceError) message = `Measurements could not be loaded: ${active.traceError}`;
    else if (hasVideo && hasTrace && !overlap) message = "The trace and video time windows do not overlap. Adjust the time offset to align the same trial.";
    else if (ready) message = "Play or drag the timeline to follow contact measurements. Click either plot to seek to that moment.";
    else if (hasVideo && !hasTrace) message = "Evaluation video available. Synchronized force / torque measurements are pending.";
    else if (!hasVideo && hasTrace) message = "Measurements loaded. Add the matching evaluation video to enable synchronized playback.";
    $("synchronization-note").textContent = message;
    if (preview) $("preview-status").textContent = [active.videoName && `Video: ${active.videoName}`, active.traceName && `Trace: ${active.traceName}`, active.measurements && `${active.measurements.rows.length.toLocaleString()} samples`].filter(Boolean).join(" · ");
  }
  function seek(time) {
    if (!finiteDuration()) return;
    video.currentTime = Math.max(0, Math.min(time, video.duration)); updateCursor();
  }
  function refreshPlayButton() {
    $("play-icon").textContent = video.paused ? "▶" : "Ⅱ";
    $("play").setAttribute("aria-label", video.paused ? "Play evaluation video" : "Pause evaluation video");
  }
  function tick() {
    updateCursor(); if (!video.paused && !video.ended) animation = requestAnimationFrame(tick);
  }
  async function selectTask(id) {
    const task = tasks.find(item => item.id === id); if (!task) return;
    generation++; const selectedGeneration = generation;
    request?.abort(); request = new AbortController();
    video.pause(); cancelAnimationFrame(animation);
    active = task;
    $("task-title").textContent = task.title; $("task-description").textContent = task.description;
    $("task-poster").src = task.poster; $("task-poster").alt = `${task.title} setup from the paper`;
    $("task-panel").setAttribute("aria-labelledby", `tab-${id}`);
    document.querySelectorAll("[data-task]").forEach(button => { const selected = button.dataset.task === id; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
    $("play").disabled = true; timeline.disabled = true; $("fullscreen").disabled = true; timeline.value = 0;
    $("time-display").textContent = "—:— / —:—"; $("time-offset").value = task.offset;
    $("video-file").value = ""; $("trace-file").value = "";
    video.removeAttribute("src"); video.load();
    video.hidden = !task.video; $("video-placeholder").hidden = Boolean(task.video);
    $("video-message").textContent = "Evaluation video pending";
    if (task.video) { task.videoError = false; video.src = task.video; video.load(); }
    renderPlots(); refreshPlayButton();
    if (task.trace && !task.measurements) {
      try {
        const response = await fetch(task.trace, { signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = window.LeCoTrace.parseCSV(await response.text());
        if (selectedGeneration !== generation) return;
        task.measurements = data; task.traceError = null; renderPlots();
      } catch (error) {
        if (error.name === "AbortError" || selectedGeneration !== generation) return;
        task.traceError = error.message; renderPlots();
      }
    }
  }
  document.querySelectorAll("[data-task]").forEach(button => {
    button.addEventListener("click", () => selectTask(button.dataset.task));
    button.addEventListener("keydown", event => {
      const buttons = [...document.querySelectorAll("[data-task]")]; let index = buttons.indexOf(button);
      if (event.key === "ArrowRight") index = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") index = (index + buttons.length - 1) % buttons.length;
      else if (event.key === "Home") index = 0; else if (event.key === "End") index = buttons.length - 1; else return;
      event.preventDefault(); buttons[index].focus(); selectTask(buttons[index].dataset.task);
    });
  });
  document.querySelectorAll("[data-select-task]").forEach(link => link.addEventListener("click", () => selectTask(link.dataset.selectTask)));
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => { mode = button.dataset.mode; renderPlots(); }));
  $("play").addEventListener("click", async () => {
    if (!video.paused) { video.pause(); return; }
    if (video.ended) video.currentTime = 0;
    try { await video.play(); } catch (error) { $("synchronization-note").textContent = `Playback could not start: ${error.message}`; }
  });
  timeline.addEventListener("input", () => seek(Number(timeline.value)));
  $("playback-speed").addEventListener("change", event => { video.playbackRate = Number(event.target.value); });
  $("loop").addEventListener("change", event => { video.loop = event.target.checked; });
  video.addEventListener("loadedmetadata", () => {
    if (!finiteDuration()) return;
    timeline.max = video.duration; timeline.disabled = false; $("play").disabled = false; $("fullscreen").disabled = false;
    video.playbackRate = Number($("playback-speed").value); video.loop = $("loop").checked; renderPlots();
  });
  video.addEventListener("timeupdate", updateCursor); video.addEventListener("seeked", updateCursor);
  video.addEventListener("play", () => { refreshPlayButton(); cancelAnimationFrame(animation); tick(); });
  video.addEventListener("pause", () => { refreshPlayButton(); cancelAnimationFrame(animation); updateCursor(); });
  video.addEventListener("ended", () => { refreshPlayButton(); cancelAnimationFrame(animation); updateCursor(); });
  video.addEventListener("error", () => {
    if (!active.video || video.getAttribute("src") !== active.video) return;
    active.videoError = true; video.hidden = true; $("video-placeholder").hidden = false;
    $("video-message").textContent = "Video could not be loaded";
    $("play").disabled = true; timeline.disabled = true; $("fullscreen").disabled = true; updateStatus();
  });
  $("fullscreen").addEventListener("click", async () => {
    if ($("video-stage").requestFullscreen) await $("video-stage").requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  document.addEventListener("fullscreenchange", () => { video.controls = Boolean(document.fullscreenElement); });
  if (preview) {
    $("preview-tools").hidden = false;
    $("video-file").addEventListener("change", event => {
      const file = event.target.files[0]; if (!file) return;
      if (active.video?.startsWith("blob:")) URL.revokeObjectURL(active.video);
      active.video = URL.createObjectURL(file); active.videoName = file.name; active.videoError = false;
      selectTask(active.id);
    });
    $("trace-file").addEventListener("change", async event => {
      const file = event.target.files[0]; if (!file) return;
      const task = active;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error("Use a CSV smaller than 25 MB for browser playback.");
        const data = window.LeCoTrace.parseCSV(await file.text());
        task.measurements = data; task.traceName = file.name; task.traceError = null;
      } catch (error) { task.measurements = null; task.traceError = error.message; task.traceName = null; }
      if (task === active) renderPlots();
    });
    $("time-offset").addEventListener("input", event => {
      if (event.target.value === "" || !Number.isFinite(Number(event.target.value))) return;
      active.offset = Number(event.target.value); renderPlots();
    });
  }
  selectTask(tasks[0].id);
})();
