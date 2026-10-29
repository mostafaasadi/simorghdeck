let chart = null;
let snrPoints = [];
const MAX_POINTS = 900;
let activeInfoTip = null;

document.addEventListener('DOMContentLoaded', () => {
    bindServiceButtons();
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

        renderSystem(data.system);
        renderService(data.service);
        renderReceiver(data.receiver);
        renderAircraft(data.aircraft || {});
        updateChart(data.receiver ? data.receiver.snr_db : null);
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

function updateChart(snr) {
    const empty = document.getElementById('chartEmpty');

    if (!chart) {
        if (empty) {
            empty.classList.remove('hidden');
        }
        return;
    }

    if (isNumber(snr)) {
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
}

function renderService(service) {
    if (!service) {
        return;
    }

    const active = Boolean(service.readsb_active);
    const badge = document.getElementById('serviceStatus');
    const dot = document.getElementById('serviceDot');

    if (badge) {
        badge.textContent = active ? 'Active' : 'Inactive';
        badge.className = 'badge ' + (active ? 'active' : 'inactive');
    }

    if (dot) {
        dot.className = 'status-dot ' + (active ? 'active' : 'inactive');
    }
}

function renderReceiver(receiver) {
    if (!receiver) {
        return;
    }

    setText('gainDb', formatValue(receiver.gain_db, 'dB'));
    setText('ppmValue', formatValue(receiver.estimated_ppm, 'ppm'));
    setText('snrMetric', formatValue(receiver.snr_db, 'dB'));
    setSnrColor('snrMetric', receiver.snr_db);

    setText('withPos', isNumber(receiver.aircraft_with_pos) ? String(receiver.aircraft_with_pos) : 'N/A');
    setText('withoutPos', isNumber(receiver.aircraft_without_pos) ? String(receiver.aircraft_without_pos) : 'N/A');

    setText('snrCurrent', formatValue(receiver.snr_db, 'dB'));
    setText('signalCurrent', formatValue(receiver.signal_db, 'dB'));
    setText('noiseCurrent', formatValue(receiver.noise_db, 'dB'));

    setText('messages1m', formatInteger(receiver.messages_1m));
    setText('positions1m', formatInteger(receiver.positions_1m));
    setText('maxRange', formatValue(receiver.max_distance_km, 'km'));
    setText('uptime', formatDuration(receiver.uptime_seconds));

    setAlertCount('samplesDropped', receiver.samples_dropped);
    setAlertCount('samplesLost', receiver.samples_lost);
}

function renderAircraft(aircraft) {
    const list = document.getElementById('aircraftList');
    const count = document.getElementById('activeCount');

    if (count) {
        count.textContent = String(aircraft.active_count || 0);
    }

    if (!list) {
        return;
    }

    const items = Array.isArray(aircraft.items) ? aircraft.items : [];

    if (!items.length) {
        list.innerHTML = '<div class="empty">No active aircraft</div>';
        return;
    }

    list.innerHTML = items.map(item => aircraftCard(item)).join('');
}

function aircraftCard(ac) {
    const title = ac.flight || ac.hex || 'UNKNOWN';
    const positionBadge = ac.has_position
        ? '<span class="badge info">POS</span>'
        : '<span class="badge muted">NO POS</span>';

    const squawkBadge = ac.squawk
        ? `<span class="badge ${ac.emergency ? 'danger' : 'neutral'}">${escapeHtml(ac.squawk)}</span>`
        : '';

    return `
        <article class="aircraft-card ${ac.emergency ? 'emergency' : ''}">
            <div class="aircraft-top">
                <div class="ident">
                    <span class="flight">${escapeHtml(title)}</span>
                    <span class="hex">${escapeHtml(ac.hex || '')}</span>
                </div>
                <div class="badge-row">
                    ${positionBadge}
                    ${squawkBadge}
                </div>
            </div>

            <div class="aircraft-grid">
                <div class="data">
                    <span class="label">ALT</span>
                    <span class="value">${altitudeValue(ac)}</span>
                </div>

                <div class="data">
                    <span class="label">SPD</span>
                    <span class="value">${speedValue(ac)}</span>
                </div>

                <div class="data">
                    <span class="label">HDG</span>
                    <span class="value">${headingValue(ac.track_deg)}</span>
                </div>

                <div class="data">
                    <span class="label">VERT</span>
                    <span class="value">${verticalValue(ac.vertical_mps)}</span>
                </div>

                <div class="data">
                    <span class="label">RSSI</span>
                    <span class="value">${rssiValue(ac.rssi_db)}</span>
                </div>

                <div class="data">
                    <span class="label">SEEN</span>
                    <span class="value">${seenValue(ac.seen_s)}</span>
                </div>
            </div>
        </article>
    `;
}

function bindServiceButtons() {
    document.querySelectorAll('[data-service-action]').forEach(button => {
        button.addEventListener('click', () => {
            controlService(button.getAttribute('data-service-action'));
        });
    });
}

async function controlService(action) {
    const buttons = document.querySelectorAll('[data-service-action]');

    buttons.forEach(button => {
        button.disabled = true;
    });

    try {
        const response = await fetch(`/deck/api/service/${action}`, {
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

    return `${value.toFixed(1)} dB ${rssiBars(value)}`;
}

function rssiBars(value) {
    let level = 0;

    if (value >= -3) {
        level = 5;
    } else if (value >= -8) {
        level = 4;
    } else if (value >= -14) {
        level = 3;
    } else if (value >= -22) {
        level = 2;
    } else if (value >= -30) {
        level = 1;
    }

    const glyphs = ['▂', '▄', '▆', '▇', '█'];
    const visible = glyphs.slice(0, level).join('');

    return `<span class="rssi">${visible || '·'}</span>`;
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

function setAlertCount(id, value) {
    const el = document.getElementById(id);

    if (!el) {
        return;
    }

    if (!isNumber(value)) {
        el.textContent = 'N/A';
        el.classList.remove('text-danger');
        return;
    }

    const count = Math.round(value);
    el.textContent = String(count);
    el.classList.toggle('text-danger', count > 0);
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
    document.querySelectorAll('.info-tip').forEach(tip => {
        tip.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            const isOpen = tip.classList.contains('show');

            closeInfoTips();

            if (!isOpen) {
                tip.classList.add('show');
                activeInfoTip = tip;
            }
        });

        tip.addEventListener('mouseenter', () => {
            if (!activeInfoTip || activeInfoTip === tip) {
                tip.classList.add('show');
            }
        });

        tip.addEventListener('mouseleave', () => {
            if (activeInfoTip !== tip) {
                tip.classList.remove('show');
            }
        });

        tip.addEventListener('focus', () => {
            tip.classList.add('show');
        });

        tip.addEventListener('blur', () => {
            if (activeInfoTip !== tip) {
                tip.classList.remove('show');
            }
        });
    });

    document.addEventListener('click', event => {
        if (!event.target.closest('.info-tip')) {
            closeInfoTips();
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
