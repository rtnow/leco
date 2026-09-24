(() => {
  "use strict";
  const aliases = { time: ["time_s", "time", "t", "timestamp_s"], fx: ["fx", "force_x"], fy: ["fy", "force_y"], fz: ["fz", "force_z"], tx: ["tx", "mx", "torque_x"], ty: ["ty", "my", "torque_y"], tz: ["tz", "mz", "torque_z"], fn: ["force_n", "force_norm", "resultant_force"], tn: ["torque_nm", "torque_norm", "resultant_torque"] };
  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 3) throw new Error("The CSV needs a header and at least two measurement samples.");
    const split = line => line.split(",").map(value => value.trim().replace(/^"(.*)"$/, "$1"));
    const headers = split(lines[0]).map(value => value.toLowerCase());
    if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column names.");
    const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(name => names.includes(name))]));
    const vectors = ["fx", "fy", "fz", "tx", "ty", "tz"].every(key => columns[key] >= 0);
    if (columns.time < 0) throw new Error("Add a time_s column in seconds, increasing strictly from one sample to the next.");
    if (!vectors && !(columns.fn >= 0 && columns.tn >= 0)) throw new Error("Provide fx,fy,fz,tx,ty,tz, or both force_n and torque_nm.");
    const required = ["time", ...(vectors ? ["fx", "fy", "fz", "tx", "ty", "tz"] : ["fn", "tn"])];
    const rows = lines.slice(1).map((line, index) => {
      const values = split(line);
      if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} does not match the header.`);
      const data = {};
      for (const key of required) {
        const value = values[columns[key]];
        if (value === "" || !Number.isFinite(Number(value))) throw new Error(`CSV row ${index + 2} has an invalid ${key} value.`);
        data[key] = Number(value);
      }
      if (vectors) { data.fn = Math.hypot(data.fx, data.fy, data.fz); data.tn = Math.hypot(data.tx, data.ty, data.tz); }
      else if (data.fn < 0 || data.tn < 0) throw new Error(`CSV row ${index + 2} contains a negative resultant magnitude.`);
      return data;
    });
    const intervals = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].time <= rows[i - 1].time) throw new Error(`CSV row ${i + 2} must have a later timestamp than the previous row.`);
      intervals.push(rows[i].time - rows[i - 1].time);
    }
    intervals.sort((a, b) => a - b);
    const middle = Math.floor(intervals.length / 2);
    const interval = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
    return { rows, vectors, maxGap: interval * 5, first: rows[0].time, last: rows.at(-1).time };
  }
  function sample(trace, time) {
    if (!trace || time < trace.first || time > trace.last) return null;
    const rows = trace.rows;
    let lo = 0, hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].time === time) return rows[mid];
      if (rows[mid].time < time) lo = mid + 1; else hi = mid - 1;
    }
    const a = rows[hi], b = rows[lo];
    if (!a || !b || b.time - a.time > trace.maxGap) return null;
    const ratio = (time - a.time) / (b.time - a.time);
    const result = { time };
    for (const key of Object.keys(a)) if (key !== "time") result[key] = a[key] + (b[key] - a[key]) * ratio;
    return result;
  }
  function reduce(points, key, buckets = 600) {
    if (points.length <= buckets * 4) return points;
    const selected = new Set([0, points.length - 1]);
    const size = Math.ceil(points.length / buckets);
    for (let start = 0; start < points.length; start += size) {
      const end = Math.min(start + size, points.length);
      let min = start, max = start;
      for (let i = start + 1; i < end; i++) {
        if (points[i][key] < points[min][key]) min = i;
        if (points[i][key] > points[max][key]) max = i;
      }
      selected.add(start); selected.add(end - 1); selected.add(min); selected.add(max);
    }
    return [...selected].sort((a, b) => a - b).map(i => points[i]);
  }
  window.LeCoTrace = { parseCSV, sample, reduce };
})();
