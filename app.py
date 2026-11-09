import os
import json
import time
import threading
import subprocess
import urllib.request
import urllib.error
import psutil
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

DEFAULT_CONFIG = {
    "runtime_dirs": ["/run/readsb", "/run/dump1090-fa"],
    "decoder_service": "auto",
    "decoder_candidates": ["readsb", "dump1090-fa"],
    "monitored_services": ["tar1090", "graphs1090"],
    "controllable_services": ["tar1090", "graphs1090"],
    "service_probe_urls": {
        "tar1090": "http://127.0.0.1/tar1090/",
        "graphs1090": "http://127.0.0.1/graphs1090/"
    },
    "tar1090_base_url": "/tar1090/",
    "service_status_ttl": 15,
    "rtlsdr_cache_ttl": 10,
    "traffic_watch_interval": 20,
    "usb_devices_dir": "/sys/bus/usb/devices",
    "thermal_zone_path": "/sys/class/thermal/thermal_zone0/temp",
    "rtlsdr_usb_ids": [
        "0bda:2838",
        "0bda:2832",
        "0ccd:00d3",
        "0ccd:00e0",
        "0458:707f",
        "1554:5020",
        "1554:5021",
        "1b80:d393",
        "1b80:d394",
        "1b80:d395",
        "1b80:d397",
        "1b80:d398",
        "1b80:d39d",
        "1b80:d3a4",
        "1b80:d803",
        "1d19:1101",
        "1d19:1102",
        "1d19:1103",
        "1f4d:b803",
        "1f4d:c803"
    ]
}

app = FastAPI(title="SimorghDeck API")
router = APIRouter(prefix="/deck")

os.makedirs(STATIC_DIR, exist_ok=True)

_config = None
_rtlsdr_ids = None
_json_cache = {}
_service_status_cache = {}
_unit_cache = {}
_decoder_service_cache = {
    "time": 0.0,
    "name": None
}
_rtlsdr_cache = {
    "time": 0.0,
    "usb_id": None,
    "scan_ok": False
}
_last_traffic_timestamp = None

psutil.cpu_percent(interval=None)


def load_config():
    global _config
    if _config is not None:
        return _config

    merged = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, "r") as handle:
            user = json.load(handle)
        if isinstance(user, dict):
            for key, value in user.items():
                if key == "service_probe_urls" and isinstance(value, dict):
                    base = dict(DEFAULT_CONFIG["service_probe_urls"])
                    base.update(value)
                    merged[key] = base
                else:
                    merged[key] = value
    except Exception:
        pass

    _config = merged
    return _config


def get_rtlsdr_usb_ids():
    global _rtlsdr_ids
    if _rtlsdr_ids is not None:
        return _rtlsdr_ids

    ids = set()
    for item in load_config().get("rtlsdr_usb_ids", []):
        parts = str(item).lower().split(":")
        if len(parts) == 2:
            ids.add((parts[0].strip(), parts[1].strip()))

    _rtlsdr_ids = ids
    return _rtlsdr_ids


def clean_keys(value):
    if isinstance(value, dict):
        return {str(k).strip(): clean_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_keys(item) for item in value]
    return value


def to_number(value, default=None):
    if isinstance(value, bool) or value is None:
        return default
    try:
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text:
            return default
        return float(text)
    except Exception:
        return default


def to_int(value, default=None):
    number = to_number(value, None)
    if number is None:
        return default
    return int(number)


def find_runtime_file(name):
    for directory in load_config().get("runtime_dirs", []):
        path = os.path.join(directory, name)
        if os.path.exists(path):
            return path
    return None


def load_runtime_json(name):
    path = find_runtime_file(name)
    if not path:
        return {}

    try:
        mtime = os.path.getmtime(path)
    except Exception:
        mtime = None

    cached = _json_cache.get(name)
    if cached and cached.get("mtime") == mtime:
        return cached.get("data", {})

    try:
        with open(path, "r") as handle:
            data = clean_keys(json.load(handle))
        _json_cache[name] = {
            "mtime": mtime,
            "data": data
        }
        return data
    except Exception:
        if cached:
            return cached.get("data", {})
        return {}


def get_cpu_temp():
    try:
        with open(load_config().get("thermal_zone_path"), "r") as handle:
            return round(float(handle.read()) / 1000.0, 1)
    except Exception:
        return None


def systemd_unit_state(name):
    try:
        result = subprocess.run(
            ["systemctl", "is-active", name],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return None


def unit_exists(name):
    now = time.monotonic()
    cached = _unit_cache.get(name)
    if cached and (now - cached[0]) < 60:
        return cached[1]

    state = systemd_unit_state(name)
    exists = state is not None and state != "unknown"
    _unit_cache[name] = (now, exists)
    return exists


def get_decoder_service():
    configured = load_config().get("decoder_service", "auto")
    if configured and configured != "auto":
        return configured

    now = time.monotonic()
    if _decoder_service_cache["name"] and (now - _decoder_service_cache["time"]) < 60:
        return _decoder_service_cache["name"]

    detected = None
    for candidate in load_config().get("decoder_candidates", []):
        state = systemd_unit_state(candidate)
        if state is not None and state != "unknown":
            detected = candidate
            break

    _decoder_service_cache["time"] = now
    _decoder_service_cache["name"] = detected
    return detected


def get_decoder_name():
    return get_decoder_service() or load_config().get("decoder_candidates", ["readsb"])[0]


def find_rtlsdr_usb():
    ttl = load_config().get("rtlsdr_cache_ttl", 10)
    now = time.monotonic()
    if (now - _rtlsdr_cache["time"]) < ttl:
        return _rtlsdr_cache["usb_id"], _rtlsdr_cache["scan_ok"]

    usb_id = None
    scan_ok = False
    known_ids = get_rtlsdr_usb_ids()

    try:
        scan_ok = True
        devices_dir = load_config().get("usb_devices_dir")
        for entry in os.listdir(devices_dir):
            vendor_path = os.path.join(devices_dir, entry, "idVendor")
            product_path = os.path.join(devices_dir, entry, "idProduct")
            if not os.path.isfile(vendor_path) or not os.path.isfile(product_path):
                continue
            with open(vendor_path, "r") as handle:
                vendor = handle.read().strip().lower()
            with open(product_path, "r") as handle:
                product = handle.read().strip().lower()
            if (vendor, product) in known_ids:
                usb_id = f"{vendor}:{product}"
                break
    except Exception:
        scan_ok = False
        usb_id = None

    _rtlsdr_cache["time"] = now
    _rtlsdr_cache["usb_id"] = usb_id
    _rtlsdr_cache["scan_ok"] = scan_ok
    return usb_id, scan_ok


def probe_http(url):
    try:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status < 400
    except urllib.error.HTTPError:
        return False
    except Exception:
        return None


def probe_service(name):
    state = systemd_unit_state(name)
    if state is None:
        return "unknown"
    if state == "active":
        return "running"
    if state == "failed":
        return "failed"
    if state in ("inactive", "deactivating"):
        return "stopped"
    if state == "activating":
        return "unknown"

    url = load_config().get("service_probe_urls", {}).get(name)
    if not url:
        return "unknown"

    ok = probe_http(url)
    if ok is True:
        return "running"
    if ok is False:
        return "stopped"
    return "unknown"


def get_service_status(name):
    ttl = load_config().get("service_status_ttl", 15)
    now = time.monotonic()
    cached = _service_status_cache.get(name)
    if cached and (now - cached[0]) < ttl:
        return cached[1]

    status = probe_service(name)
    _service_status_cache[name] = (now, status)
    return status


def format_minutes_ago(minutes):
    if minutes is None:
        return None
    minutes = int(round(minutes))
    if minutes < 1:
        return "Just now"
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    mins = minutes % 60
    if mins > 0:
        return f"{hours}h {mins}m ago"
    return f"{hours}h ago"


def refresh_last_traffic():
    global _last_traffic_timestamp

    stats = load_runtime_json("stats.json")
    status = load_runtime_json("status.json")
    last1 = stats.get("last1min", {}) if isinstance(stats.get("last1min"), dict) else {}

    stats_now = to_number(stats.get("now"), to_number(status.get("now"), 0))
    if not stats_now:
        return

    positions_1m = to_int(last1.get("position_count_total"), 0)
    current_aircraft = to_int(status.get("aircraft_with_pos"), 0) + to_int(status.get("aircraft_without_pos"), 0)

    if current_aircraft > 0 or positions_1m > 0:
        if _last_traffic_timestamp is None or stats_now > _last_traffic_timestamp:
            _last_traffic_timestamp = stats_now


def watch_last_traffic():
    interval = load_config().get("traffic_watch_interval", 20)
    while True:
        try:
            refresh_last_traffic()
        except Exception:
            pass
        time.sleep(interval)


threading.Thread(target=watch_last_traffic, daemon=True).start()


def parse_aircraft():
    data = load_runtime_json("aircraft.json")
    raw_items = data.get("aircraft", [])
    if not isinstance(raw_items, list):
        raw_items = []

    items = []

    for raw in raw_items:
        if not isinstance(raw, dict):
            continue

        seen = to_number(raw.get("seen"))
        if seen is None or seen > 60:
            continue

        hex_code = str(raw.get("hex") or "").strip().upper()
        flight = str(raw.get("flight") or "").strip()
        if flight.replace("@", "").strip() == "":
            flight = ""
        registration = str(raw.get("r") or "").strip()
        aircraft_type = str(raw.get("t") or "").strip()

        alt_raw = raw.get("alt_baro", raw.get("altitude"))
        on_ground = str(alt_raw).strip().lower() == "ground"
        alt_ft = to_number(alt_raw)
        alt_m = int(round(alt_ft * 0.3048)) if alt_ft is not None else None
        if on_ground:
            alt_m = 0

        gs = to_number(raw.get("gs"))
        speed_kmh = int(round(gs * 1.852)) if gs is not None else None

        track = to_number(raw.get("track"))
        if track is not None:
            track = track % 360

        vertical_raw = raw.get("baro_rate")
        if vertical_raw is None:
            vertical_raw = raw.get("geom_rate")

        vertical_ftmin = to_number(vertical_raw)
        vertical_mps = round(vertical_ftmin * 0.00508, 1) if vertical_ftmin is not None else None

        rssi = to_number(raw.get("rssi"))
        rssi_db = round(rssi, 1) if rssi is not None else None

        squawk = str(raw.get("squawk") or "").strip()

        lat = to_number(raw.get("lat"))
        lon = to_number(raw.get("lon"))

        items.append({
            "hex": hex_code,
            "flight": flight,
            "registration": registration,
            "aircraft_type": aircraft_type,
            "alt_m": alt_m,
            "on_ground": on_ground,
            "speed_kmh": speed_kmh,
            "track_deg": track,
            "vertical_mps": vertical_mps,
            "rssi_db": rssi_db,
            "seen_s": round(seen, 1),
            "squawk": squawk,
            "has_position": lat is not None and lon is not None,
            "emergency": squawk in {"7500", "7600", "7700"}
        })

    items.sort(key=lambda item: item["hex"])

    with_pos = sum(1 for item in items if item["has_position"])

    return {
        "active_count": len(items),
        "with_pos_count": with_pos,
        "items": items
    }


def parse_receiver():
    stats = load_runtime_json("stats.json")
    status = load_runtime_json("status.json")

    last1 = stats.get("last1min", {}) if isinstance(stats.get("last1min"), dict) else {}
    last5 = stats.get("last5min", {}) if isinstance(stats.get("last5min"), dict) else {}
    total = stats.get("total", {}) if isinstance(stats.get("total"), dict) else {}
    local_total = total.get("local", {}) if isinstance(total.get("local"), dict) else {}
    tracks_total = total.get("tracks", {}) if isinstance(total.get("tracks"), dict) else {}
    local_5 = last5.get("local", {}) if isinstance(last5.get("local"), dict) else {}

    usb_id, scan_ok = find_rtlsdr_usb()
    if usb_id:
        rtl_status = "connected"
    elif scan_ok:
        rtl_status = "missing"
    else:
        rtl_status = "unknown"

    signal_5m = to_number(local_5.get("signal"))
    noise_5m = to_number(local_5.get("noise"))
    samples_5m = to_int(local_5.get("samples_processed"))

    snr_5m = None
    if signal_5m is not None and noise_5m is not None and noise_5m < 0:
        if samples_5m is None or samples_5m > 0:
            snr_5m = round(signal_5m - noise_5m, 1)

    signal_total = to_number(local_total.get("signal"))
    noise_total = to_number(local_total.get("noise"))
    snr_total = round(signal_total - noise_total, 1) if signal_total is not None and noise_total is not None else None

    max_distance = to_number(total.get("max_distance"))
    max_distance_km = round(max_distance / 1000.0, 1) if max_distance is not None else None

    position_count_total = to_int(total.get("position_count_total"), 0)
    messages_valid = to_int(total.get("messages_valid"), 0)

    uptime = to_number(status.get("uptime"))
    if uptime is None:
        start = to_number(total.get("start"))
        end = to_number(total.get("end"))
        if start is not None and end is not None:
            uptime = end - start

    messages_per_hour = round(messages_valid / uptime * 3600, 1) if uptime and uptime > 0 else None
    positions_per_hour = round(position_count_total / uptime * 3600, 1) if uptime and uptime > 0 else None
    position_yield = round(position_count_total / messages_valid * 100, 1) if messages_valid > 0 else None

    tracks_all = to_int(tracks_total.get("all"), 0)
    tracks_single = to_int(tracks_total.get("single_message"), 0)
    tracks_multi = tracks_all - tracks_single
    track_completion = round(tracks_multi / tracks_all * 100, 1) if tracks_all > 0 else None

    with_pos = to_int(
        status.get("aircraft_with_pos"),
        to_int(stats.get("aircraft_with_pos"), 0)
    )
    without_pos = to_int(
        status.get("aircraft_without_pos"),
        to_int(stats.get("aircraft_without_pos"), 0)
    )

    stats_now = to_number(stats.get("now"), to_number(status.get("now"), 0))
    positions_1m = to_int(last1.get("position_count_total"), 0)

    refresh_last_traffic()

    if _last_traffic_timestamp is not None and stats_now:
        minutes = (stats_now - _last_traffic_timestamp) / 60
        if minutes < 0:
            minutes = 0
        last_traffic = format_minutes_ago(minutes) or "Just now"
    else:
        last_traffic = "No traffic"

    return {
        "stats_now": stats_now,
        "uptime_seconds": uptime,
        "gain_db": to_number(stats.get("gain_db")),
        "estimated_ppm": to_number(stats.get("estimated_ppm")),
        "aircraft_with_pos": with_pos,
        "aircraft_without_pos": without_pos,
        "signal_db_5m": signal_5m,
        "noise_db_5m": noise_5m,
        "snr_db_5m": snr_5m,
        "signal_db": signal_total,
        "noise_db": noise_total,
        "snr_db": snr_total,
        "messages_total": messages_valid,
        "positions_total": position_count_total,
        "messages_per_hour": messages_per_hour,
        "positions_per_hour": positions_per_hour,
        "position_yield": position_yield,
        "tracks_all": tracks_all,
        "tracks_single": tracks_single,
        "tracks_multi": tracks_multi,
        "track_completion": track_completion,
        "max_distance_km": max_distance_km,
        "peak_signal": to_number(local_total.get("peak_signal")),
        "strong_signals": to_int(local_total.get("strong_signals"), 0),
        "samples_dropped": to_int(local_total.get("samples_dropped"), 0),
        "samples_lost": to_int(local_total.get("samples_lost"), 0),
        "positions_1m": positions_1m,
        "rtl_sdr": {
            "status": rtl_status,
            "usb_id": usb_id
        },
        "last_traffic": last_traffic
    }


@router.get("/")
def read_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.get("/api/panel")
def get_panel():
    config = load_config()
    decoder_name = get_decoder_name()

    services = {
        decoder_name: {
            "status": get_service_status(decoder_name),
            "controllable": unit_exists(decoder_name)
        }
    }

    for name in config.get("monitored_services", []):
        if name in services:
            continue
        services[name] = {
            "status": get_service_status(name),
            "controllable": name in config.get("controllable_services", []) and unit_exists(name)
        }

    return {
        "system": {
            "cpu_usage": psutil.cpu_percent(interval=None),
            "cpu_temp": get_cpu_temp(),
            "ram_usage": psutil.virtual_memory().percent
        },
        "service": {
            "name": decoder_name,
            "active": services[decoder_name]["status"] == "running"
        },
        "services": services,
        "links": {
            "tar1090": config.get("tar1090_base_url", "/tar1090/")
        },
        "receiver": parse_receiver(),
        "aircraft": parse_aircraft()
    }


@router.post("/api/service/{name}/{action}")
def control_service(name: str, action: str):
    if action not in ["stop", "restart"]:
        raise HTTPException(status_code=400, detail="Invalid action")

    config = load_config()
    allowed = set(config.get("controllable_services", []))
    allowed.add(get_decoder_name())

    if name not in allowed or not unit_exists(name):
        raise HTTPException(status_code=400, detail="Service is not controllable")

    try:
        subprocess.run(
            ["sudo", "systemctl", action, name],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        return {
            "status": "success",
            "service": name,
            "action": action
        }
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode().strip() if error.stderr else str(error)
        raise HTTPException(status_code=500, detail=detail or "Service action failed")
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


app.include_router(router)

app.mount(
    "/deck/static",
    StaticFiles(directory=STATIC_DIR),
    name="static"
)
