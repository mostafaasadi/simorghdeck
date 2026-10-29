# SimorghDeck

Mobile-first RTL-SDR ADS-B dashboard for readsb.

## Features

- readsb service control
- CPU, temperature and RAM metrics
- RTL-SDR gain and PPM
- Receiver SNR chart
- Active aircraft cards
- Aircraft position and signal indicators
- tar1090 and pTracks shortcuts
- Fully local frontend assets

## Requirements

- Python 3
- FastAPI
- Uvicorn
- psutil
- readsb or dump1090-fa

## Project Structure

app.py
static/
  index.html
  style.css
  app.js
  vendor/
    chart.umd.js
    lucide.min.js

## Local Assets

All frontend assets are served locally.
No CDN or external runtime dependency is required.

To refresh vendor assets:

bash download_assets.sh

## Run

python3 -m uvicorn app:app --host 0.0.0.0 --port 8080

## Open

http://RASPBERRY_PI_IP:8080/deck/

## readsb Data Sources

The panel reads:

/run/readsb/aircraft.json
/run/readsb/stats.json
/run/readsb/status.json

Fallback:

/run/dump1090-fa/
