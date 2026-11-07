# SimorghDeck

Mobile-first RTL-SDR ADS-B dashboard for readsb, tar1090, and graphs1090.

## Features

- Mobile-first RTL-SDR ADS-B dashboard with live aircraft cards and one-click tar1090 integration
- Trend sparklines for system health and per-aircraft metrics
- Rolling SNR chart with service status monitoring for readsb, tar1090, and graphs1090
- Session statistics and smart Last Traffic tracking
- Fully local frontend with readsb service control

## Prerequisites

This panel assumes you already have readsb (or dump1090-fa) and tar1090 installed and running on your system.

If you haven't installed them yet, the recommended method is using the automatic installation script by wiedehopf:

👉 [Automatic installation for readsb & tar1090](https://github.com/wiedehopf/adsb-scripts/wiki/Automatic-installation-for-readsb)

**Note on Graphs1090:**
graphs1090 is **not** installed automatically by the script above. If you want to use the performance graphs feature, you must install it manually:

👉 [graphs1090 Installation Guide](https://github.com/wiedehopf/graphs1090)

## Installation

```bash
cd ~
git clone https://github.com/mostafaasadi/simorghdeck.git
cd simorghdeck
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Configuration

SimorghDeck uses `config.json` for customization. If the file doesn't exist, default values are used.

Example `config.json`:

```json
{
    "runtime_dirs": ["/run/readsb", "/run/dump1090-fa"],
    "decoder_service": "auto",
    "decoder_candidates": ["readsb", "dump1090-fa"],
    "monitored_services": ["tar1090", "graphs1090"],
    "service_probe_urls": {
        "tar1090": "http://127.0.0.1/tar1090/",
        "graphs1090": "http://127.0.0.1/graphs1090/"
    },
    "tar1090_base_url": "/tar1090/",
    "service_status_ttl": 15,
    "rtlsdr_cache_ttl": 10,
    "usb_devices_dir": "/sys/bus/usb/devices",
    "thermal_zone_path": "/sys/class/thermal/thermal_zone0/temp"
}
```

Key configuration options:

- `decoder_service`: Set to `"auto"` for automatic detection, or specify `"readsb"` or `"dump1090-fa"`.
- `runtime_dirs`: Paths where the decoder writes JSON files.
- `tar1090_base_url`: Base URL for tar1090 (used for aircraft direct links).
- `service_probe_urls`: URLs to check service availability via HTTP.

## Systemd Service

Replace `YOUR_USERNAME` with your actual Linux username.

Create the service file:

```bash
sudo nano /etc/systemd/system/simorghdeck.service
```

Paste the following configuration:

```ini
[Unit]
Description=SimorghDeck Radar Dashboard
After=network.target readsb.service

[Service]
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/simorghdeck
ExecStart=/home/YOUR_USERNAME/simorghdeck/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable simorghdeck
sudo systemctl start simorghdeck
```

## Accessing the Panel

By default, SimorghDeck runs on `127.0.0.1:8000`.

On the Raspberry Pi itself:

```text
http://127.0.0.1:8000/deck/
```

For direct access from other devices, change `127.0.0.1` to `0.0.0.0` in the service file, restart the service, then open:

```text
http://YOUR_RASPBERRY_PI_IP:8000/deck/
```

If you want to serve it through a web server alongside tar1090, configure a reverse proxy.

Example for lighttpd:

```bash
sudo nano /etc/lighttpd/conf-enabled/89-simorghdeck.conf
```

Paste:

```lighttpd
$HTTP["url"] =~ "^/deck" {
    proxy.server = (
        "" => (
            (
                "host" => "127.0.0.1",
                "port" => 8000
            )
        )
    )
}
```

Enable the proxy module if needed and restart lighttpd:

```bash
sudo lighttpd-enable-mod proxy
sudo systemctl restart lighttpd
```

Then open:

```text
http://YOUR_RASPBERRY_PI_IP/deck/
```

## Credits

This project uses the following open-source libraries, served locally:

- Chart.js — https://www.chartjs.org/
- Lucide — https://lucide.dev/
