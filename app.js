// app.js - Universal XLSX Integration
"use strict";

const API_URL = "https://linewise-kccp.vercel.app/solve";
const CRITICAL_THRESHOLD = 0.1;
const MARGINAL_THRESHOLD = 0.3;

const App = {
  cy: null,
  lastPayload: null,
  stagedFile: null,
  activeFileName: "mock.json" 
};

function $(id) { return document.getElementById(id); }

function setStatus(msg) {
  const el = $("status-text");
  if (el) el.textContent = msg;
}

function logEvent(msg) {
  const logContainer = $("event-log");
  if (!logContainer) return;
  const time = new Date().toISOString().split("T")[1].slice(0, 8);
  const entry = document.createElement("div");
  entry.style.fontSize = "11px";
  entry.style.color = "#a9b4c2";
  entry.textContent = `[${time}] ${msg}`;
  logContainer.prepend(entry);
}

function fmt(x, d = 6) { return (typeof x === "number" && Number.isFinite(x)) ? x.toFixed(d) : "—"; }

function vciBand(vci) {
  if (vci < CRITICAL_THRESHOLD) return "critical";
  if (vci <= MARGINAL_THRESHOLD) return "marginal";
  return "stable";
}

function getBandColour(vci) {
  if (vci < CRITICAL_THRESHOLD) return "#e74c3c";
  if (vci <= MARGINAL_THRESHOLD) return "#f39c12";
  return "#2ecc71";
}

/* ================= DATA I/O PIPELINE ================= */

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  App.stagedFile = file;
  App.activeFileName = file.name;
  if ($("active-file")) $("active-file").textContent = `Staged: ${App.activeFileName}`;
  logEvent(`File staged for processing: ${file.name}`);
  setStatus("Ready to Run");
}

async function runSolver() {
  if (!App.stagedFile) {
    logEvent("ERROR: No dataset selected.");
    setStatus("Error: Select dataset first.");
    return;
  }

  setStatus("Status: SOLVING...");
  logEvent(`Transmitting ${App.activeFileName} to Cloud Math Engine...`);
  if ($("btn-run")) $("btn-run").style.background = "#f39c12"; 

  const formData = new FormData();
  formData.append("file", App.stagedFile);
  
  const sheetSelector = $("sheet-selector");
  if (sheetSelector) {
    formData.append("sheet", sheetSelector.value);
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) throw new Error(`API HTTP Error: ${response.status}`);
    
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);

    App.lastPayload = payload;
    renderMetadata(payload.solver_metadata, payload);
    mountOrUpdateGraph(payload);
    renderCharts(payload);
    
    if ($("btn-run")) $("btn-run").style.background = "#2ecc71";
    setStatus("Status: FINISHED");
    logEvent("Solver execution successful. UI Updated.");

  } catch (error) {
    console.error(error);
    if ($("btn-run")) $("btn-run").style.background = "#e74c3c";
    setStatus("Status: API FAILURE");
    logEvent(`API Failure: ${error.message}`);
  }
}

async function downloadResults() {
  if (!App.lastPayload) {
    logEvent("ERROR: No results to download.");
    return;
  }
  if (typeof XLSX === 'undefined') {
    logEvent("ERROR: SheetJS library not loaded.");
    return;
  }
  
  // 1. Create Data Array
  const data = [["Bus_ID", "Type", "Voltage_Magnitude_pu", "Angle_rad"]];
  App.lastPayload.buses.forEach(b => {
    data.push([b.bus_id, b.type, b.U, b.delta_rad]);
  });

  // 2. Use SheetJS to create an Excel Workbook
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Solved_Results");

  // 3. Trigger Binary Download
  XLSX.writeFile(wb, `Solved_${App.activeFileName.split('.')[0]}.xlsx`);
  logEvent("Resulting .xlsx file generated successfully.");
}

function downloadTemplate() {
  if (typeof XLSX === 'undefined') {
    logEvent("ERROR: SheetJS library not loaded.");
    return;
  }

  // Row 0: Empty Col A, Date, Name, Base MVA (Index 3), Year, Season, Label
  const titleRow = [["", "01/01/26", "RYERSON UNIVERSITY", 100.0, 2026, "W", "Universal Grid Template"]];
  
  // Row 1: Bus Header
  const busHeader = [["BUS DATA FOLLOWS", "", "ITEMS"]];
  
  // Row 2: Example Data (Users will overwrite this)
  const busData = [[1, "Bus 1", "MV 1", 1, 3, 1.0, 0, 0, 0, 0, 0, 12.66, 0, 0, 0, 0, 0, 0]];
  
  // Row 3: Sentinel
  const busSentinel = [["-999"]];

  // Row 4: Branch Header
  const branchHeader = [["BRANCH DATA FOLLOWS", "", "ITEMS"]];
  
  // Row 5: Example Data (Users will overwrite this)
  const branchData = [[1, 2, 1, 1, 1, 0, 0.0922, 0.047, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 1.0]];
  
  // Row 6: Sentinel
  const branchSentinel = [["-999"]];
  
  // Serialize exactly mimicking the strict original IEEE CDF array pattern
  const ws = XLSX.utils.aoa_to_sheet([
    ...titleRow, 
    ...busHeader, 
    ...busData,
    ...busSentinel, 
    ...branchHeader, 
    ...branchData,
    ...branchSentinel
  ]);
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grid_Input");

  XLSX.writeFile(wb, "Universal_Grid_Template.xlsx");
  logEvent("Universal .xlsx template downloaded.");
}

function toggleHelp() {
  const modal = $("help-modal");
  if (modal) {
    modal.style.display = modal.style.display === "flex" ? "none" : "flex";
  }
}

/* ================= METRICS & CHARTS ================= */

function renderMetadata(meta, payload) {
  if ($("meta-method")) $("meta-method").textContent = meta.method ?? "—";
  if ($("meta-iter")) $("meta-iter").textContent = meta.iterations ?? "—";
  if ($("meta-err")) $("meta-err").textContent = meta.global_max_error ?? "—";
  if ($("meta-time")) $("meta-time").textContent = meta.execution_time_ms ?? "—";
  if ($("meta-conv")) $("meta-conv").textContent = String(meta.converged);

  const sevEl = $("meta-severity");
  if (sevEl && payload.lines.length > 0) {
    const sev = (payload.lines.filter(l => l.VCI < CRITICAL_THRESHOLD).length / payload.lines.length) * 100;
    sevEl.textContent = `${sev.toFixed(1)}%`;
    sevEl.style.color = sev > 10 ? "#e74c3c" : "#2ecc71";
  }

  let pLoss = 0, qLoss = 0;
  payload.lines.forEach(l => {
    pLoss += (l.PF + l.PS);
    qLoss += (l.QF + l.QS);
  });
  if ($("meta-ploss")) $("meta-ploss").textContent = `${pLoss.toFixed(4)} pu`;
  if ($("meta-qloss")) $("meta-qloss").textContent = `${qLoss.toFixed(4)} pu`;
}

function renderCharts(payload) {
  const busIds = payload.buses.map(b => `Bus ${b.bus_id}`);
  const vMags = payload.buses.map(b => b.U); 
  const vAngs = payload.buses.map(b => b.delta_rad);

  const vTrace = { x: busIds, y: vMags, type: 'scatter', mode: 'lines+markers', line: {color: '#3498db'}, name: '|V| (pu)' };
  const aTrace = { x: busIds, y: vAngs, type: 'scatter', mode: 'lines+markers', line: {color: '#e74c3c'}, name: 'δ (rad)' };

  const layoutBase = { 
    margin: { t: 30, b: 80, l: 40, r: 20 },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', 
    font: { color: '#e8eef6' },
    xaxis: { showgrid: false, tickangle: -45 }, 
    yaxis: { gridcolor: '#243041' }
  };

  Plotly.newPlot('chart-voltage', [vTrace], { ...layoutBase, title: { text: 'Voltage Profile', font: {size: 12} } });
  Plotly.newPlot('chart-angle', [aTrace], { ...layoutBase, title: { text: 'Phase Angle Profile', font: {size: 12} } });
}


/* ================= GRAPH & UI SELECTION ================= */

function handleSelection(ele) {
  const el = $("selection");
  if (!ele) {
    el.innerHTML = '<div class="selection__hint">Click a bus or line in the graph.</div>';
    return;
  }

  if (ele.isNode()) {
    const d = ele.data();
    const V = Number(d.U);
    const U_sq = V * V; 

    el.innerHTML = `<strong>Bus ${d.bus_id}</strong> <span style="color:var(--muted)">(${d.type})</span>
      <div id="math-render-target" style="margin-top: 12px; margin-bottom: 12px;"></div>`;
    const tex = `\\begin{aligned} |V| &= ${fmt(V)} \\text{ pu} \\\\ U &= ${fmt(U_sq)} \\text{ pu}^2 \\\\ \\delta &= ${fmt(Number(d.delta_rad))} \\text{ rad} \\end{aligned}`;
    katex.render(tex, $("math-render-target"), { displayMode: true });
    return;
  }

  if (ele.isEdge()) {
    const d = ele.data();
    const vci = Number(d.VCI);
  
    el.innerHTML = `<strong>Line ${d.id}</strong><br>
      <span style="color:var(--muted); font-size: 11px;">From ${d.from_bus} &rarr; ${d.to_bus}</span>
      <div id="math-render-target" style="margin-top: 12px; margin-bottom: 12px;"></div>
      Band: <span style="color:${getBandColour(vci)}; font-weight: bold;">${vciBand(vci).toUpperCase()}</span>`;
      
    const tex = `\\begin{aligned} P_F &= ${fmt(Number(d.PF))} & Q_F &= ${fmt(Number(d.QF))} \\\\ P_S &= ${fmt(Number(d.PS))} & Q_S &= ${fmt(Number(d.QS))} \\\\ \\text{VCI} &= ${fmt(vci)} \\end{aligned}`;
    katex.render(tex, $("math-render-target"), { displayMode: true });
  }
}

function cytoscapeStyle() {
  return [
    { selector: "node", style: { width: 30, height: 30, "background-color": "#3498db", "border-width": 1, "border-color": "#1f2a38", label: "data(bus_id)", "text-valign": "center", "text-halign": "center", color: "#ffffff", "font-size": 11, "font-weight": "bold" } },
    { selector: "edge", style: { width: 3, "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.8, color: "#a9b4c2" } },
    { selector: 'edge[vci_band="stable"]', style: { "line-color": "#2ecc71", "target-arrow-color": "#2ecc71" } },
    { selector: 'edge[vci_band="marginal"]', style: { "line-color": "#f39c12", "target-arrow-color": "#f39c12" } },
    { selector: 'edge[vci_band="critical"]', style: { "line-color": "#e74c3c", "target-arrow-color": "#e74c3c" } }
  ];
}

function mountOrUpdateGraph(payload) {
  const elements = [];
  payload.buses.forEach(b => elements.push({ data: { id: String(b.bus_id), bus_id: b.bus_id, type: b.type, U: b.U, delta_rad: b.delta_rad } }));
  payload.lines.forEach(l => elements.push({ data: { id: String(l.line_id), source: String(l.from_bus), target: String(l.to_bus), from_bus: l.from_bus, to_bus: l.to_bus, PF: l.PF, QF: l.QF, PS: l.PS, QS: l.QS, VCI: Number(l.VCI), vci_band: vciBand(Number(l.VCI)) } }));

  if (!App.cy) {
    App.cy = cytoscape({ container: $("cy"), elements, style: cytoscapeStyle() });
    App.cy.on("tap", "node, edge", evt => { App.cy.elements().unselect(); evt.target.select(); handleSelection(evt.target); });
  } else {
    App.cy.elements().remove();
    App.cy.add(elements);
  }
  App.cy.layout({ name: "dagre", rankDir: "LR", spacingFactor: 1.1, animate: true }).run();
}

function bindUI() {
  if ($("upload-cdf")) $("upload-cdf").addEventListener("change", handleFileUpload);
  if ($("btn-run")) $("btn-run").addEventListener("click", runSolver);
  if ($("btn-download")) $("btn-download").addEventListener("click", downloadResults);
}

bindUI();
