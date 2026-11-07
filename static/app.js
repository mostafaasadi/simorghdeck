let chart = null;
let snrPoints = [];
const MAX_POINTS = 900;
let lastStatsNow = null;
let activeInfoTip = null;

let cpuPoints = [];
let tempPoints = [];
let ramPoints = [];
const MAX_SYSTEM_POINTS = 30;

const aircraftHistory = new Map();
const MAX_AIRCRAFT_POINTS = 30;

const SPARK_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

const TAR1090_BASE_URL = '/tar1090/';
let tar1090BaseUrl = TAR1090_BASE_URL;

const EXTERNAL_LINK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="link-icon"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

const RESTART_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';

const STOP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';

const renderedActions = {};

document.addEventListener('DOMContentLoaded', () => {
    bindServiceControls();
    bindInfoTips();
    initChart();
    refresh();
    setInterval(refresh, 2000);

    if (window.lucide) {
        window.lucide.createIcons();
    }
});

async function refresh() {
    try {
        const response = await fetch('/deck/api/panel', {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('panel request failed');
        }

        const data = await response.json();

        if (data.links && data.links.tar1090) {
            tar1090BaseUrl = data.links.tar1090;
        }

        renderSystem(data.system);
        renderServices(data.services, data.service ? data.service.name : null);
        renderRtlSdr(data.receiver ? data.receiver.rtl_sdr : null);
        renderReceiver(data.receiver, data.aircraft);
        renderAircraft(data.aircraft || {});
        updateChart(data.receiver ? data.receiver.snr_db_5m : null, data.receiver ? data.receiver.stats_now : null);
    } catch (error) {
        console.error(error);
    }
}

function initChart() {
    const canvas = document.getElementById('snrChart');
    const empty = document.getElementById('chartEmpty');

    if (!window.Chart || !canvas) {
        if (empty) {
            empty.textContent = 'Chart library unavailable';
            empty.classList.remove('hidden');
        }
        return;
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.08)';

    chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'SNR dB',
                data: [],
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.14)',
                fill: true,
                tension: 0.25,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 6,
                        maxRotation: 0
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.08)'
                    }
                },
                y: {
                    ticks: {
                        maxTicksLimit: 6
                    },
                    grid: {
                        color: 'rgba(148, 163, 184, 0.08)'
                    }
                }
            }
        }
    });
}

function updateChart(snr, statsNow) {
    const empty = document.getElementById('chartEmpty');

    if (!chart) {
        if (empty) {
            empty.classList.remove('hidden');
        }
        return;
    }

    if (isNumber(snr) && statsNow !== lastStatsNow) {
        const now = new Date();

        snrPoints.push({
            t: now,
            y: snr
        });

        if (snrPoints.length > MAX_POINTS) {
            snrPoints.shift();
        }

        chart.data.labels = snrPoints.map(point => point.t.toLocaleTimeString([], {
            hour12: false
        }));

        chart.data.datasets[0].data = snrPoints.map(point => point.y);
        chart.update('none');

        lastStatsNow = statsNow;
    }

    if (empty) {
        empty.classList.toggle('hidden', snrPoints.length > 0);
    }
}

function renderSystem(system) {
    if (!system) {
        return;
    }

    setText('cpuUsage', isNumber(system.cpu_usage) ? Math.round(system.cpu_usage) + '%' : 'N/A');
    setText('cpuTemp', isNumber(system.cpu_temp) ? system.cpu_temp + ' °C' : 'N/A');
    setText('ramUsage', isNumber(system.ram_usage) ? Math.round(system.ram_usage) + '%' : 'N/A');

    if (isNumber(system.cpu_usage)) {
        cpuPoints.push(system.cpu_usage);
        if (cpuPoints.length > MAX_SYSTEM_POINTS) cpuPoints.shift();
        drawMiniSparkline('cpuSparkline', cpuPoints, '#38bdf8');
    }

    if (isNumber(system.cpu_temp)) {
        tempPoints.push(system.cpu_temp);
        if (tempPoints.length > MAX_SYSTEM_POINTS) tempPoints.shift();
        drawMiniSparkline('tempSparkline', tempPoints, '#f59e0b');
    }

    if (isNumber(system.ram_usage)) {
        ramPoints.push(system.ram_usage);
        if (ramPoints.length > MAX_SYSTEM_POINTS) ramPoints.shift();
        drawMiniSparkline('ramSparkline', ramPoints, '#10b981');
    }
}

function drawMiniSparkline(canvasId, points, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || points.length < 2) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85;

    ctx.beginPath();
    points.forEach((point, index) => {
        const x = (index / (points.length - 1)) * width;
        const y = height - ((point - min) / range) * (height - 2) - 1;

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function updateAircraftHistory(hex, ac) {
    if (!aircraftHistory.has(hex)) {
        aircraftHistory.set(hex, {
            alt: [],
            spd: [],
            vert: [],
            rssi: []
        });
    }

    const h = aircraftHistory.get(hex);

    h.alt.push(isNumber(ac.alt_m) ? ac.alt_m : null);
    h.spd.push(isNumber(ac.speed_kmh) ? ac.speed_kmh : null);
    h.vert.push(isNumber(ac.vertical_mps) ? ac.vertical_mps : null);
    h.rssi.push(isNumber(ac.rssi_db) ? ac.rssi_db : null);

    if (h.alt.length > MAX_AIRCRAFT_POINTS) h.alt.shift();
    if (h.spd.length > MAX_AIRCRAFT_POINTS) h.spd.shift();
    if (h.vert.length > MAX_AIRCRAFT_POINTS) h.vert.shift();
    if (h.rssi.length > MAX_AIRCRAFT_POINTS) h.rssi.shift();
}

function cleanupAircraftHistory(activeHexes) {
    for (const hex of aircraftHistory.keys()) {
        if (!activeHexes.has(hex)) {
            aircraftHistory.delete(hex);
        }
    }
}

function sparklineBarsHtml(points, color) {
    const last8 = points.slice(-8);
    const validInWindow = last8.filter(p => p !== null && p !== undefined);

    if (validInWindow.length === 0) {
        return '';
    }

    const min = Math.min(...validInWindow);
    const max = Math.max(...validInWindow);
    const range = max - min;

    const bars = last8.map(point => {
        if (point === null || point === undefined) {
            return `<span style="color: ${color}; opacity: 0.25">·</span>`;
        }

        let index;
        if (range === 0) {
            index = 6;
        } else {
            const normalized = (point - min) / range;
            index = Math.min(Math.floor(normalized * SPARK_GLYPHS.length), SPARK_GLYPHS.length - 1);
        }

        return `<span style="color: ${color}">${SPARK_GLYPHS[index]}</span>`;
    }).join('');

    return `<div class="sparkline-bars">${bars}</div>`;
}

function renderServices(services, decoderName) {
    if (!services) {
        return;
    }

    if (decoderName && services[decoderName]) {
        const entry = services[decoderName];
        const nameEl = document.getElementById('svcDecoderName');
        const dot = document.getElementById('serviceDot');

        if (nameEl) {
            nameEl.textContent = decoderName;
        }

        if (dot) {
            dot.className = 'status-dot ' + (entry.status === 'running' ? 'active' : 'inactive');
        }

        setServiceStatus('svcDecoderStatus', entry.status);
        renderServiceActions('svcDecoderActions', entry.controllable ? decoderName : null);
    }

    renderServiceEntry('tar1090', services.tar1090, 'svcTar1090', 'svcTar1090Actions');
    renderServiceEntry('graphs1090', services.graphs1090, 'svcGraphs1090', 'svcGraphs1090Actions');
}

function renderServiceEntry(name, entry, statusId, actionsId) {
    if (!entry) {
        return;
    }

    setServiceStatus(statusId, entry.status);
    renderServiceActions(actionsId, entry.controllable ? name : null);
}

function renderServiceActions(containerId, serviceName) {
    const el = document.getElementById(containerId);

    if (!el) {
        return;
    }

    const target = serviceName || null;

    if (renderedActions[containerId] === target) {
        return;
    }

    renderedActions[containerId] = target;
    el.innerHTML = target ? serviceActionsHtml(target) : '';
}

function serviceActionsHtml(name) {
    const safeName = escapeHtml(name);

    return `
        <button class="btn btn-warning btn-sm" data-service-name="${safeName}" data-service-action="restart">
            ${RESTART_ICON}
            <span>Restart</span>
        </button>
        <button class="btn btn-danger btn-sm" data-service-name="${safeName}" data-service-action="stop">
            ${STOP_ICON}
            <span>Stop</span>
        </button>
    `;
}

function setServiceStatus(id, status) {
    const el = document.getElementById(id);

    if (!el) {
        return;
    }

    el.classList.remove('text-success', 'text-warning', 'text-danger');

    if (status === 'running') {
        el.textContent = 'Running';
        el.classList.add('text-success');
    } else if (status === 'stopped') {
        el.textContent = 'Stopped';
        el.classList.add('text-danger');
    } else if (status === 'failed') {
        el.textContent = 'Failed';
        el.classList.add('text-danger');
    } else {
        el.textContent = 'Unknown';
        el.classList.add('text-warning');
    }
}

function renderRtlSdr(rtl) {
    const el = document.getElementById('rtlSdrStatus');
    const idEl = document.getElementById('rtlSdrId');

    if (!el || !rtl) {
        return;
    }

    el.classList.remove('text-success', 'text-warning', 'text-danger');

    if (rtl.status === 'connected') {
        el.textContent = 'Connected';
        el.classList.add('text-success');
    } else if (rtl.status === 'missing') {
        el.textContent = 'Not Detected';
        el.classList.add('text-danger');
    } else {
        el.textContent = 'Unknown';
        el.classList.add('text-warning');
    }

    if (idEl) {
        if (rtl.usb_id) {
            idEl.textContent = rtl.usb_id;
            idEl.classList.remove('hidden');
        } else {
            idEl.textContent = '';
            idEl.classList.add('hidden');
        }
    }
}

function renderReceiver(receiver, aircraft) {
    if (!receiver) {
        return;
    }

    setText('gainDb', formatValue(receiver.gain_db, 'dB'));
    setText('ppmValue', formatValue(receiver.estimated_ppm, 'ppm'));
    setText('snrMetric', formatValue(receiver.snr_db_5m, 'dB'));
    setSnrColor('snrMetric', receiver.snr_db_5m);

    setText('snrCurrent', formatValue(receiver.snr_db_5m, 'dB'));
    setText('signalCurrent', formatValue(receiver.signal_db_5m, 'dB'));
    setText('noiseCurrent', formatValue(receiver.noise_db_5m, 'dB'));

    setText('uptime', formatDuration(receiver.uptime_seconds));

    setText('messagesPerHour', formatValue(receiver.messages_per_hour, '/h'));
    setText('positionsPerHour', formatValue(receiver.positions_per_hour, '/h'));
    setText('positionYield', formatValue(receiver.position_yield, '%'));
    setText('tracksMulti', formatInteger(receiver.tracks_multi));
    setText('trackCompletion', formatValue(receiver.track_completion, '%'));

    if (isNumber(receiver.max_distance_km)) {
        if (receiver.max_distance_km > 0) {
            setText('maxRange', formatValue(receiver.max_distance_km, 'km'));
        } else if (receiver.positions_total > 0) {
            setText('maxRange', 'Unavailable');
        } else {
            setText('maxRange', 'No positions yet');
        }
    } else {
        setText('maxRange', 'N/A');
    }

    setText('lastTraffic', receiver.last_traffic || 'N/A');
}

function renderAircraft(aircraft) {
    const list = document.getElementById('aircraftList');
    const count = document.getElementById('aircraftCount');
    const activeCount = document.getElementById('activeCount');

    if (count) {
        count.textContent = String(aircraft.active_count || 0);
    }

    if (activeCount) {
        activeCount.textContent = String(aircraft.active_count || 0);
    }

    if (!list) {
        return;
    }

    const items = Array.isArray(aircraft.items) ? aircraft.items : [];
    const activeHexes = new Set();

    items.forEach(item => {
        updateAircraftHistory(item.hex, item);
        activeHexes.add(item.hex);
    });

    cleanupAircraftHistory(activeHexes);

    if (!items.length) {
        list.innerHTML = '<div class="empty">No active aircraft</div>';
        return;
    }

    list.innerHTML = items.map(item => aircraftCard(item)).join('');
}

function infoTip(tooltipText) {
    return `
        <button class="info-tip data-tip" type="button" aria-label="Info">
            <i data-lucide="info"></i>
            <span class="info-fallback">?</span>
            <span class="tip" role="tooltip">${escapeHtml(tooltipText)}</span>
        </button>
    `;
}

function isValidIcaoHex(value) {
    return typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value);
}

function tar1090IcaoUrl(value) {
    if (!isValidIcaoHex(value)) {
        return null;
    }
    return tar1090BaseUrl + '?icao=' + value.toLowerCase();
}

function aircraftCard(ac) {
    const title = ac.flight || ac.hex || 'UNKNOWN';
    const hex = ac.hex;
    const icaoUrl = tar1090IcaoUrl(hex);
    const positionBadge = ac.has_position
        ? '<span class="badge info">POS</span>'
        : '<span class="badge muted">NO POS</span>';

    const squawkBadge = ac.squawk
        ? `<span class="badge ${ac.emergency ? 'danger pulse' : 'neutral'}">${escapeHtml(ac.squawk)}</span>`
        : '';

    const cardClass = ac.emergency ? 'aircraft-card emergency' : (ac.on_ground ? 'aircraft-card on-ground' : 'aircraft-card');

    const history = aircraftHistory.get(hex) || { alt: [], spd: [], vert: [], rssi: [] };

    const metaParts = [];
    if (ac.registration) {
        metaParts.push(escapeHtml(ac.registration));
    }
    if (ac.aircraft_type) {
        metaParts.push(escapeHtml(ac.aircraft_type));
    }
    const metaLine = metaParts.length
        ? `<span class="aircraft-meta">${metaParts.join(' · ')}</span>`
        : '';

    const flightNode = icaoUrl
        ? `<a class="flight ident-link" href="${icaoUrl}" target="_blank" rel="noopener">${escapeHtml(title)}${EXTERNAL_LINK_ICON}</a>`
        : `<span class="flight">${escapeHtml(title)}</span>`;

    const hexNode = icaoUrl
        ? `<a class="hex ident-link" href="${icaoUrl}" target="_blank" rel="noopener">${escapeHtml(hex)}</a>`
        : `<span class="hex">${escapeHtml(hex || '')}</span>`;

    return `
        <article class="${cardClass}">
            <div class="aircraft-top">
                <div class="ident">
                    ${flightNode}
                    ${hexNode}
                    ${metaLine}
                </div>
                <div class="badge-row">
                    ${positionBadge}
                    ${squawkBadge}
                </div>
            </div>

            <div class="aircraft-grid">
                <div class="data has-bars">
                    <span class="data-head">
                        <span>ALT</span>
                        ${infoTip('Barometric altitude above sea level.')}
                    </span>
                    <span class="value ${ac.on_ground ? 'ground-value' : ''}">${altitudeValue(ac)}</span>
                    ${sparklineBarsHtml(history.alt, '#38bdf8')}
                </div>

                <div class="data has-bars">
                    <span class="data-head">
                        <span>SPD</span>
                        ${infoTip('Ground speed in kilometers per hour.')}
                    </span>
                    <span class="value">${speedValue(ac)}</span>
                    ${sparklineBarsHtml(history.spd, '#10b981')}
                </div>

                <div class="data">
                    <span class="data-head">
                        <span>HDG</span>
                        ${infoTip('True track over ground in degrees (0-359).')}
                    </span>
                    <span class="value">${headingValue(ac.track_deg)}</span>
                </div>

                <div class="data has-bars">
                    <span class="data-head">
                        <span>VERT</span>
                        ${infoTip('Vertical rate in meters per second. Positive means climbing, negative means descending.')}
                    </span>
                    <span class="value ${verticalClass(ac.vertical_mps)}">${verticalValue(ac.vertical_mps)}</span>
                    ${sparklineBarsHtml(history.vert, '#f59e0b')}
                </div>

                <div class="data has-bars">
                    <span class="data-head">
                        <span>RSSI</span>
                        ${infoTip('Received Signal Strength Indicator. Higher (closer to 0) means stronger signal.')}
                    </span>
                    <span class="value ${rssiClass(ac.rssi_db)}">${rssiValue(ac.rssi_db)}</span>
                    ${sparklineBarsHtml(history.rssi, '#a78bfa')}
                </div>

                <div class="data">
                    <span class="data-head">
                        <span>SEEN</span>
                        ${infoTip('Seconds since the last message was received from this aircraft.')}
                    </span>
                    <span class="value ${seenClass(ac.seen_s)}">${seenValue(ac.seen_s)}</span>
                </div>
            </div>
        </article>
    `;
}

function rssiClass(value) {
    if (!isNumber(value)) {
        return '';
    }
    if (value >= -10) {
        return 'text-success';
    }
    if (value >= -20) {
        return 'text-warning';
    }
    return 'text-danger';
}

function seenClass(value) {
    if (!isNumber(value)) {
        return '';
    }
    if (value <= 15) {
        return 'text-success';
    }
    if (value <= 30) {
        return 'text-warning';
    }
    return 'text-danger';
}

function verticalClass(value) {
    if (!isNumber(value)) {
        return '';
    }
    if (value > 0.5) {
        return 'text-success';
    }
    if (value < -0.5) {
        return 'text-danger';
    }
    return '';
}

function bindServiceControls() {
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-service-action]');

        if (!button || button.disabled) {
            return;
        }

        controlService(button.getAttribute('data-service-name'), button.getAttribute('data-service-action'));
    });
}

async function controlService(name, action) {
    if (!name || !action) {
        return;
    }

    const buttons = document.querySelectorAll('[data-service-action]');

    buttons.forEach(button => {
        button.disabled = true;
    });

    try {
        const response = await fetch(`/deck/api/service/${encodeURIComponent(name)}/${action}`, {
            method: 'POST'
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            await refresh();
        } else {
            alert(result.detail || 'Service action failed');
        }
    } catch (error) {
        console.error(error);
        alert('Service action failed');
    } finally {
        buttons.forEach(button => {
            button.disabled = false;
        });
    }
}

function altitudeValue(ac) {
    if (ac.on_ground) {
        return 'GND';
    }

    if (!isNumber(ac.alt_m)) {
        return 'N/A';
    }

    return Math.round(ac.alt_m).toLocaleString() + ' m';
}

function speedValue(ac) {
    if (!isNumber(ac.speed_kmh)) {
        return 'N/A';
    }

    return Math.round(ac.speed_kmh).toLocaleString() + ' km/h';
}

function headingValue(value) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    const deg = Math.round(value);

    return `
        <span class="heading">
            <span class="heading-arrow" style="transform: rotate(${deg}deg)">➤</span>
            ${deg}°
        </span>
    `;
}

function verticalValue(value) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    const abs = Math.abs(value).toFixed(1);

    if (value > 0.5) {
        return `↑ ${abs} m/s`;
    }

    if (value < -0.5) {
        return `↓ ${abs} m/s`;
    }

    return `→ ${abs} m/s`;
}

function rssiValue(value) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    return `${value.toFixed(1)} dB`;
}

function seenValue(value) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    return `${value.toFixed(1)} s`;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text;
    }
}

function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function formatValue(value, unit) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    return value + (unit ? ' ' + unit : '');
}

function formatInteger(value) {
    if (!isNumber(value)) {
        return 'N/A';
    }

    return String(Math.round(value));
}

function formatDuration(seconds) {
    if (!isNumber(seconds)) {
        return 'N/A';
    }

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);

    if (h > 0) {
        return `${h}h ${m}m`;
    }

    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
}

function setSnrColor(id, value) {
    const el = document.getElementById(id);

    if (!el) {
        return;
    }

    el.classList.remove('text-success', 'text-warning', 'text-danger');

    if (!isNumber(value)) {
        return;
    }

    if (value >= 10) {
        el.classList.add('text-success');
    } else if (value >= 0) {
        el.classList.add('text-warning');
    } else {
        el.classList.add('text-danger');
    }
}

function escapeHtml(value) {
    const text = value === null || value === undefined ? '' : String(value);

    return text.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function bindInfoTips() {
    document.addEventListener('click', event => {
        const tip = event.target.closest('.info-tip');

        if (!tip) {
            closeInfoTips();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const isOpen = tip.classList.contains('show');

        closeInfoTips();

        if (!isOpen) {
            tip.classList.add('show');
            activeInfoTip = tip;
        }
    });

    document.addEventListener('mouseover', event => {
        const tip = event.target.closest('.info-tip');
        if (tip && (!activeInfoTip || activeInfoTip === tip)) {
            tip.classList.add('show');
        }
    });

    document.addEventListener('mouseout', event => {
        const tip = event.target.closest('.info-tip');
        if (tip && activeInfoTip !== tip) {
            tip.classList.remove('show');
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeInfoTips();
        }
    });
}

function closeInfoTips() {
    activeInfoTip = null;

    document.querySelectorAll('.info-tip.show').forEach(item => {
        item.classList.remove('show');
    });
}
