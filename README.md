# SimorghDeck

Mobile-first RTL-SDR ADS-B dashboard for readsb, tar1090, and graphs1090.

## Features

- Live RTL-SDR receiver stats (Gain, PPM, SNR, Dropped/Lost samples)
- Active aircraft cards with telemetry (Altitude, Speed, Heading, RSSI)
- Advanced session statistics (hourly rates, track completion, max range)
- Live SNR trend chart
- readsb service control (Start / Stop / Restart)
- Quick links to tar1090, pTracks, Heatmap, Replay, and Graphs1090
- Fully local frontend assets (No internet required after setup)
- Mobile-optimized responsive UI

## Prerequisites

This panel assumes you already have `readsb` and `tar1090` installed and running on your system.

If you haven't installed them yet, the recommended method is using the automatic installation script by wiedehopf:
👉 [Automatic installation for readsb & tar1090](https://github.com/wiedehopf/adsb-scripts/wiki/Automatic-installation-for-readsb)

**Note on Graphs1090:**
`graphs1090` is **not** installed automatically by the script above. If you want to use the performance graphs feature, you must install it manually:
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

## Systemd Service

Replace `YOUR_USERNAME` with your actual Linux username.

1. Create the service file:
   ```bash
   sudo nano /etc/systemd/system/simorghdeck.service
   ```

2. Paste the following configuration:
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

3. Enable and start the service:
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
