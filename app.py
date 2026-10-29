import os
import json
import subprocess
import psutil
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="SimorghDeck API")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)

router = APIRouter(prefix="/deck")

RUNTIME_DIRS = [
    "/run/readsb",
    "/run/dump1090-fa"
]

_json_cache = {}

psutil.cpu_percent(interval=None)


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
    for directory in RUNTIME_DIRS:
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
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as handle:
            return round(float(handle.read()) / 1000.0, 1)
    except Exception:
        return None


def is_service_active(service_name="readsb"):
    try:
        result = subprocess.run(
            ["systemctl", "is-active", service_name],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        return result.stdout.strip() == "active"
    except Exception:
        return False


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

    items.sort(
        key=lambda item: (
            item["seen_s"] if item["seen_s"] is not None else 999,
            -(item["rssi_db"] if item["rssi_db"] is not None else -999)
        )
    )

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
    last15 = stats.get("last15min", {}) if isinstance(stats.get("last15min"), dict) else {}
    total = stats.get("total", {}) if isinstance(stats.get("total"), dict) else {}
    local_total = total.get("local", {}) if isinstance(total.get("local"), dict) else {}
    tracks = total.get("tracks", {}) if isinstance(total.get("tracks"), dict) else {}

    signal_1m = to_number(last1.get("local", {}).get("signal"))
    noise_1m = to_number(last1.get("local", {}).get("noise"))
    snr_1m = round(signal_1m - noise_1m, 1) if signal_1m is not None and noise_1m is not None else None

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

    tracks_all = to_int(tracks.get("all"), 0)
    tracks_single = to_int(tracks.get("single_message"), 0)
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

    return {
        "stats_now": to_number(stats.get("now"), to_number(status.get("now"))),
        "uptime_seconds": uptime,
        "gain_db": to_number(stats.get("gain_db")),
        "estimated_ppm": to_number(stats.get("estimated_ppm")),
        "aircraft_with_pos": with_pos,
        "aircraft_without_pos": without_pos,
        "signal_db_1m": signal_1m,
        "noise_db_1m": noise_1m,
        "snr_db_1m": snr_1m,
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
        "messages_1m": to_int(last1.get("messages_valid"), 0),
        "messages_5m": to_int(last5.get("messages_valid"), 0),
        "messages_15m": to_int(last15.get("messages_valid"), 0),
        "positions_1m": to_int(last1.get("position_count_total"), 0),
        "positions_5m": to_int(last5.get("position_count_total"), 0),
        "positions_15m": to_int(last15.get("position_count_total"), 0)
    }


@router.get("/")
def read_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.get("/api/panel")
def get_panel():
    return {
        "system": {
            "cpu_usage": psutil.cpu_percent(interval=None),
            "cpu_temp": get_cpu_temp(),
            "ram_usage": psutil.virtual_memory().percent
        },
        "service": {
            "readsb_active": is_service_active("readsb")
        },
        "receiver": parse_receiver(),
        "aircraft": parse_aircraft()
    }


@router.post("/api/service/{action}")
def control_service(action: str):
    if action not in ["start", "stop", "restart"]:
        raise HTTPException(status_code=400, detail="Invalid action")

    try:
        subprocess.run(
            ["sudo", "systemctl", action, "readsb"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        return {
            "status": "success",
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
