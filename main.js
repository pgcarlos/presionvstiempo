/* ============================================================
   ESTADO GLOBAL
   ============================================================ */

const state = {
    theme: "light",
    yScale: "logarithmic",
    series: [],
    currentRange: "all",
    customStart: null,
    customEnd: null
};

const SERIES_COLORS = [
    "#22c55e", "#0ea5e9", "#a855f7", "#f97316",
    "#e11d48", "#14b8a6", "#facc15", "#64748b"
];

let chartInstance = null;


/* ============================================================
   INICIALIZACIÓN GENERAL
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    initScaleState();
    initTheme();
    initSidebarTabs();
    initResponsiveSidebar();   // <<<<<< NUEVO
    initUploadArea();
    initChart();
    initScaleControl();
    initTimeRangeControl();
});

/* ============================================================
   0. SIDEBAR RESPONSIVO (Móvil + Tablet)
   ============================================================ */

function initResponsiveSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const openBtn = document.getElementById("menuToggle");
    const closeBtn = document.getElementById("closeSidebar");

    if (!sidebar || !overlay || !openBtn || !closeBtn) return;

    const openMenu = () => {
        sidebar.classList.add("open");
        overlay.classList.add("visible");
        document.body.style.overflow = "hidden";
    };

    const closeMenu = () => {
        sidebar.classList.remove("open");
        overlay.classList.remove("visible");
        document.body.style.overflow = "";
    };

    // Abrir menú hamburguesa
    openBtn.addEventListener("click", openMenu);

    // Botón ✖
    closeBtn.addEventListener("click", closeMenu);

    // Clic en overlay
    overlay.addEventListener("click", closeMenu);

    // Cerrar cuando cambias de pestaña dentro del sidebar
    document.querySelectorAll(".sidebar-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            closeMenu();
        });
    });

    // Cerrar cuando carga archivo (en móviles)
    const inputs = [document.getElementById("fileTxtInput"), document.getElementById("fileZipInput")];
    inputs.forEach(inp => {
        if (!inp) return;
        inp.addEventListener("change", () => {
            closeMenu();
        });
    });
}


/* ============================================================
   1. CONFIGURACIÓN DE TEMA Y ESCALA
   ============================================================ */

function initScaleState() {
    const savedScale = localStorage.getItem("pvt-y-scale");
    state.yScale = savedScale === "linear" ? "linear" : "logarithmic";
}

function initTheme() {
    const savedTheme = localStorage.getItem("pvt-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    state.theme = savedTheme || (prefersDark ? "dark" : "light");
    applyTheme(state.theme);

    const toggleBtn = document.getElementById("themeToggle");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            state.theme = state.theme === "light" ? "dark" : "light";
            applyTheme(state.theme);
            localStorage.setItem("pvt-theme", state.theme);
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const toggleBtn = document.getElementById("themeToggle");
    if (toggleBtn) toggleBtn.textContent = theme === "light" ? "🌙" : "☀️";
    applyHighchartsTheme(theme);
}


/* ============================================================
   2. SIDEBAR TABS
   ============================================================ */

function initSidebarTabs() {
    const tabs = document.querySelectorAll(".sidebar-tab");
    const sections = document.querySelectorAll(".sidebar-section");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.section;

            tabs.forEach(t => t.classList.remove("active"));
            sections.forEach(s => s.classList.remove("active"));

            tab.classList.add("active");
            document.getElementById(target).classList.add("active");
        });
    });
}


/* ============================================================
   3. UPLOAD AREA
   ============================================================ */

function initUploadArea() {
    const dropzone = document.getElementById("dropzone");
    const txtInput = document.getElementById("fileTxtInput");
    const zipInput = document.getElementById("fileZipInput");

    if (!dropzone || !txtInput || !zipInput) return;

    ["dragenter", "dragover"].forEach(evt =>
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            dropzone.classList.add("dragover");
        })
    );

    ["dragleave", "drop"].forEach(evt =>
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
        })
    );

    dropzone.addEventListener("drop", e => {
        handleIncomingFiles([...e.dataTransfer.files]);
    });

    txtInput.addEventListener("change", e => {
        handleIncomingFiles([...e.target.files].filter(f => f.name.endsWith(".txt")));
        txtInput.value = "";
    });

    zipInput.addEventListener("change", e => {
        handleIncomingFiles([...e.target.files].filter(f => f.name.endsWith(".zip")));
        zipInput.value = "";
    });
}


/* ============================================================
   4. LECTURA TXT Y ZIP
   ============================================================ */

async function readTxtFile(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve({
            fileName: file.name,
            content: r.result.replace(/[^\x20-\x7E\t\r\n]/g, "")
        });
        r.onerror = reject;
        r.readAsText(file);
    });
}

async function readZipFile(file) {
    const zip = await JSZip.loadAsync(file);
    const result = [];

    for (const p in zip.files) {
        if (zip.files[p].dir) continue;
        if (!p.toLowerCase().endsWith(".txt")) continue;

        const text = await zip.files[p].async("text");
        result.push({
            fileName: p,
            content: text.replace(/[^\x20-\x7E\t\r\n]/g, "")
        });
    }

    return result;
}


/* ============================================================
   5. PARSEO DE DATOS
   ============================================================ */

function parseDataFromTxt(text) {
    const lines = text.split(/\r?\n/);
    const points = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split("\t");
        if (parts.length < 3) continue;

        const t = new Date(parts[0]).getTime();
        const v = parseFloat(parts[2]);

        if (isNaN(t) || isNaN(v)) continue;

        points.push([t, v]);
    }

    return points.sort((a, b) => a[0] - b[0]);
}


/* ============================================================
   6. PROCESAR ARCHIVOS
   ============================================================ */

function createSeriesObject(name, color, points) {
    return {
        id: "s" + Math.random().toString(36).slice(2),
        name,
        color,
        pointsOriginal: points,
        pointsFiltered: points
    };
}

async function handleIncomingFiles(files) {
    for (const file of files) {
        const color = pickSeriesColor(state.series.length);
        let loaded = [];

        if (file.name.toLowerCase().endsWith(".txt"))
            loaded = [await readTxtFile(file)];
        else
            loaded = await readZipFile(file);

        for (const txt of loaded) {
            const pts = parseDataFromTxt(txt.content);
            if (!pts.length) continue;

            state.series.push(createSeriesObject(txt.fileName, color, pts));
        }
    }

    renderFileList();
    applyRangeFilter();
}


/* ============================================================
   7. HIGHCHARTS
   ============================================================ */

function initChart() {
    chartInstance = Highcharts.chart("chartContainer", {
        chart: { zoomType: "x" },
        title: { text: "Presión vs Tiempo" },
        subtitle: { text: "Carga uno o varios archivos TXT/ZIP para comenzar." },
        xAxis: { type: "datetime" },
        yAxis: {
            type: state.yScale,
            title: { text: "Presión (mbar)" }
        },
        legend: { enabled: true },
        series: [],
        credits: { enabled: false }
    });

    applyHighchartsTheme(state.theme);
}


/* ============================================================
   7.1 TEMA DE HIGHCHARTS
   ============================================================ */

function applyHighchartsTheme(theme) {
    if (!chartInstance) return;

    const isDark = theme === "dark";

    chartInstance.update({
        chart: {
            backgroundColor: isDark ? "#020617" : "#ffffff",
            style: { fontFamily: "Inter, sans-serif" }
        },
        xAxis: {
            labels: { style: { color: isDark ? "#e5e7eb" : "#0f172a" } },
            gridLineColor: isDark ? "rgba(148,163,184,0.25)" : "rgba(148,163,184,0.3)"
        },
        yAxis: {
            labels: { style: { color: isDark ? "#e5e7eb" : "#0f172a" } },
            title: { style: { color: isDark ? "#e5e7eb" : "#0f172a" } },
            gridLineColor: isDark ? "rgba(148,163,184,0.25)" : "rgba(148,163,184,0.3)"
        },
        legend: {
            itemStyle: {
                color: isDark ? "#e5e7eb" : "#0f172a"
            }
        }
    }, false);

    chartInstance.redraw();
}


/* ============================================================
   8. AGREGAR / QUITAR SERIES EN GRÁFICO
   ============================================================ */

function plotAllFilteredSeries() {
    if (!chartInstance) return;

    while (chartInstance.series.length)
        chartInstance.series[0].remove(false);

    for (const s of state.series) {
        chartInstance.addSeries({
            name: s.name,
            data: s.pointsFiltered,
            color: s.color,
            lineWidth: 1.2
        }, false);
    }

    chartInstance.redraw();
    updateComparisonDiff();
    updateStats();
}


/* ============================================================
   9. LISTA DE ARCHIVOS
   ============================================================ */

function renderFileList() {
    const list = document.getElementById("fileList");
    list.innerHTML = "";

    if (!state.series.length) {
        list.innerHTML = `<li>No hay archivos cargados aún.</li>`;
        return;
    }

    for (const s of state.series) {
        const li = document.createElement("li");
        li.className = "file-item";

        li.innerHTML = `
            <div class="file-meta">
                <span class="file-color" style="background:${s.color}"></span>
                <span>${s.name}</span>
            </div>
            <button class="file-toggle">Eliminar</button>
        `;

        li.querySelector(".file-toggle").onclick = () => {
            state.series = state.series.filter(x => x.id !== s.id);
            renderFileList();
            applyRangeFilter();
        };

        list.appendChild(li);
    }
}


/* ============================================================
   10. EVENTOS AUTOMÁTICOS
   ============================================================ */

function clearEvents() {
    document.getElementById("eventLog").innerHTML = "";
}

function renderEvents(seriesObj) {
    clearEvents();
    const list = document.getElementById("eventLog");

    const pts = seriesObj.pointsFiltered;

    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1][1];
        const curr = pts[i][1];
        const t = pts[i][0];

        if (prev !== 0 && Math.abs(curr - prev) > prev * 0.05) {
            const li = document.createElement("li");
            li.className = "event-item";

            li.innerHTML = `
                <span class="event-dot" style="background:${seriesObj.color};"></span>
                <span class="event-text">
                    <strong>${seriesObj.name}</strong> – ${new Date(t).toLocaleString()}<br>
                    Variación: ${prev} → ${curr}
                </span>
            `;
            list.appendChild(li);
        }
    }
}


/* ============================================================
   11. MÉTRICAS
   ============================================================ */

function updateStats() {
    const pts = state.series.flatMap(s => s.pointsFiltered);

    const minEl = document.getElementById("metricMin");
    const maxEl = document.getElementById("metricMax");
    const avgEl = document.getElementById("metricAvg");
    const countEl = document.getElementById("statPointsCount");
    const seriesCountEl = document.getElementById("statSeriesCount");
    const startDateEl = document.getElementById("statStartDate");
    const endDateEl = document.getElementById("statEndDate");

    if (seriesCountEl) seriesCountEl.textContent = state.series.length;

    if (!pts.length) {
        minEl.innerText = "—";
        maxEl.innerText = "—";
        avgEl.innerText = "—";
        countEl.innerText = "0";
        startDateEl.innerText = "—";
        endDateEl.innerText = "—";
        return;
    }

    const values = pts.map(x => x[1]);
    const times = pts.map(x => x[0]);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    const tMin = new Date(Math.min(...times));
    const tMax = new Date(Math.max(...times));

    minEl.innerText = min.toExponential(3);
    maxEl.innerText = max.toExponential(3);
    avgEl.innerText = avg.toExponential(3);
    countEl.innerText = pts.length;

    startDateEl.innerText = tMin.toLocaleString();
    endDateEl.innerText = tMax.toLocaleString();
}


/* ============================================================
   12. ESCALA LOG/LINEAL
   ============================================================ */

function initScaleControl() {
    const el = document.getElementById("metricView");
    if (!el) return;

    el.onclick = () => {
        state.yScale = state.yScale === "logarithmic" ? "linear" : "logarithmic";
        localStorage.setItem("pvt-y-scale", state.yScale);

        chartInstance.yAxis[0].update({ type: state.yScale });

        plotAllFilteredSeries();
        updateScaleUI();
    };

    updateScaleUI();
}

function updateScaleUI() {
    document.getElementById("metricView").innerText =
        state.yScale === "logarithmic" ? "Logarítmica" : "Lineal";
}


/* ============================================================
   13. DIFERENCIA ENTRE SERIES
   ============================================================ */

function updateComparisonDiff() {
    if (!chartInstance) return;

    const existing = chartInstance.series.find(s => s.userOptions.isDiff);
    if (existing) existing.remove(false);

    if (state.series.length !== 2) {
        chartInstance.redraw();
        return;
    }

    const [s1, s2] = state.series;
    const p1 = s1.pointsFiltered;
    const p2 = s2.pointsFiltered;
    const len = Math.min(p1.length, p2.length);

    const diff = [];

    for (let i = 0; i < len; i++) {
        diff.push([(p1[i][0] + p2[i][0]) / 2, Math.abs(p1[i][1] - p2[i][1])]);
    }

    chartInstance.addSeries({
        name: "Diferencia",
        data: diff,
        color: "#f97316",
        dashStyle: "ShortDash",
        isDiff: true
    }, false);

    chartInstance.redraw();
}


/* ============================================================
   14. WARNING SERIES EXCLUIDAS
   ============================================================ */

function showExcludedSeriesWarning(excluded) {
    const warn = document.getElementById("rangeWarning");

    if (!excluded.length) {
        warn.style.display = "none";
        warn.innerHTML = "";
        return;
    }

    warn.style.display = "block";
    warn.innerHTML = `
        ⚠ Las siguientes series no contienen datos en el rango seleccionado:<br>
        ${excluded.map(s => `<strong>${s.name}</strong>`).join(", ")}
    `;
}


/* ============================================================
   15. FILTRO DE RANGO DE TIEMPO
   ============================================================ */

function initTimeRangeControl() {
    const select = document.getElementById("timeRange");
    const customDiv = document.getElementById("customRange");
    const applyBtn = document.getElementById("applyCustomRange");

    if (!select) return;

    select.onchange = () => {
        state.currentRange = select.value;

        customDiv.style.display = state.currentRange === "custom" ? "block" : "none";

        if (state.currentRange !== "custom")
            applyRangeFilter();
    };

    applyBtn.onclick = () => {
        const s = document.getElementById("customStart").value;
        const e = document.getElementById("customEnd").value;

        if (!s || !e) return;

        state.customStart = new Date(s).getTime();
        state.customEnd = new Date(e).getTime();

        applyRangeFilter();
    };
}


function applyRangeFilter() {
    if (!state.series.length) {
        plotAllFilteredSeries();
        clearEvents();
        return;
    }

    const allPoints = state.series.flatMap(s => s.pointsOriginal);
    const minTime = Math.min(...allPoints.map(p => p[0]));
    const maxTime = Math.max(...allPoints.map(p => p[0]));

    let start = minTime;
    let end = maxTime;

    switch (state.currentRange) {
        case "all":
            start = minTime;
            end = maxTime;
            break;
        case "24h":
            start = maxTime - 24 * 3600 * 1000;
            break;
        case "48h":
            start = maxTime - 48 * 3600 * 1000;
            break;
        case "7d":
            start = maxTime - 7 * 24 * 3600 * 1000;
            break;
        case "30d":
            start = maxTime - 30 * 24 * 3600 * 1000;
            break;
        case "custom":
            start = state.customStart;
            end = state.customEnd;
            break;
    }

    const excluded = [];

    for (const s of state.series) {
        s.pointsFiltered = s.pointsOriginal.filter(p => p[0] >= start && p[0] <= end);
        if (s.pointsFiltered.length === 0) excluded.push(s);
    }

    showExcludedSeriesWarning(excluded);

    plotAllFilteredSeries();
    clearEvents();

    if (state.series.length > 0)
        renderEvents(state.series[state.series.length - 1]);
}


/* ============================================================
   16. UTILIDADES
   ============================================================ */

function pickSeriesColor(i) {
    return SERIES_COLORS[i % SERIES_COLORS.length];
}
