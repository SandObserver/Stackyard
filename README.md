<h1 align="center">Stackyard</h1>

<p align="center"><b>A self-hosted homelab dashboard you actually want to look at.</b></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue"></a>
  <a href="https://github.com/SandObserver/stackyard/pkgs/container/stackyard"><img alt="Container" src="https://img.shields.io/badge/ghcr.io-stackyard-2496ED?logo=docker&logoColor=white"></a>
  <a href="https://stackyard-demo.onrender.com"><img alt="Live demo" src="https://img.shields.io/badge/demo-live-58c0cd"></a>
</p>

<p align="center"><img src="docs/screenshot.png" width="85%" alt="Stackyard dashboard"></p>

<p align="center">Try it: <b><a href="https://stackyard-demo.onrender.com">stackyard-demo.onrender.com</a></b><br>

Most dashboards are a wall of numbers and charts. Stackyard is the opposite: a calm, launcher-style grid of app tiles, folders, and a small number of
*genuinely useful* widgets, running in a single container with no external services or dependencies. Built to be glanced at a hundred times a day without feeling cluttered.

## Contents

- [Why Stackyard](#why-stackyard)
- [Getting started](#getting-started)
- [Building from source](#building-from-source)
- [Configuring](#configuring)
- [Icons](#icons)
- [Widgets](#widgets)
- [Live activity badges](#live-activity-badges)
- [Security](#security)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [License](#license)

## Why Stackyard

- **Attention goes where it's needed, not everywhere at once.** A calm grid, no charts or counters. Health badges only appear when something's wrong.
- **A glance should tell you more than a number would.** Widgets are small visuals, not readouts.
- **Anything can be a badge.** Point Stackyard at any API, pick a value from the response, and show it as a [live activity badge](#live-activity-badges). No custom widget, no code.
- **Configured by clicking, not by editing files.** Everything is set up in the web UI, with config import and export.
- **No dependencies.** Review it once and stop worrying about the supply chain.

Launcher-style grid of app links, folders, and widgets, with a mobile layout.
Available in English, Persian, Chinese, Spanish, German, and French.

## Getting started

You need Docker.

**Using Docker Compose** (`docker-compose.yml`):

```yaml
services:
  stackyard:
    image: ghcr.io/sandobserver/stackyard:latest
    container_name: stackyard
    restart: unless-stopped
    ports:
      - "8700:80"
    volumes:
      - ./data:/data
      - ./icons:/icons
```

```sh
docker compose up -d
```

**Or with `docker run`:**

```sh
docker run -d \
  --name stackyard \
  --restart unless-stopped \
  -p 8700:80 \
  -v ./data:/data \
  -v ./icons:/icons \
  ghcr.io/sandobserver/stackyard:latest
```

Then open `http://localhost:8700` and set things up from the admin app on the dashboard (or go to `/admin`). Config and uploaded icons persist in `./data` and `./icons`.

The [`docker-compose.yml`](docker-compose.yml) in the repo is the recommended version: it adds resource limits, dropped capabilities, and commented options for a reverse proxy, host access, and Docker health checks.

## Building from source

```sh
git clone https://github.com/SandObserver/stackyard.git
cd stackyard
docker build -t stackyard:local .
```

Then run `stackyard:local` the same way as above. For working on the code without Docker, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuring

Everything is configured in the admin UI (`/admin`), split into a few sections:

- **General**: title, description, and your server's **Host IP** (used to allow your own server in badge URLs and SSRF checks). Also **Monitoring** (logging level, Docker container health checks, and the socket URL used to reach Docker), optional **password protection**, and config **import / export**.
- **Appearance**: wallpaper and the overall look.
- **Dashboard**: add and arrange your apps, folders, and widgets, and configure each one (including live activity badges).
- **About**: version and links.

## Icons

App icons resolve automatically by name from the community [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) set, served over a CDN. You can also upload your own; custom icons are stored in `./icons`.

## Widgets

Current widgets and the services they integrate with:

- **Clock**
- **Now Playing**: Plex, Jellyfin, Emby, Navidrome
- **Weather**: Open-Meteo (no API key required)
- **DNS**: AdGuard, Pi-hole, Technitium, NextDNS
- **GitHub**: contribution graph and pull requests
- **Books**: Audiobookshelf, Komga, Kavita
- **System stats**: CPU, memory, disk usage, network speed (SpeedTest Tracker, MySpeed), RX/TX throughput, and uptime.
- **Disk health**: TrueNAS, Scrutiny
- **Backup**: Duplicati, Kopia
- **Connections**: Gluetun, Psiphon Conduit, Netbird, Plausible, Umami

Adding one is a folder plus one registry entry, with no changes to the rest of the app. See [docs/widgets.md](docs/widgets.md).

## Live activity badges

Instead of writing a widget to surface one number, point Stackyard at any API endpoint and it lists the values in the response. Pick the one you care about (pending requests in a media server, items in a queue) and it becomes a small badge on that tile. Any service with an API, without code.

## Security

Stackyard never returns stored secrets to the browser, guards the URLs you test in the admin UI against SSRF and pins the resolved IP, and bounds every upstream call so one slow service cannot hang the dashboard. Some features trade safety for convenience and are opt-in with warnings. Read [docs/security.md](docs/security.md) before exposing Stackyard beyond your LAN.

## Contributing

Contributions are welcome, within the constraints that keep Stackyard small and auditable (one container, no backend dependencies, vanilla frontend). See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/frontend.md](docs/frontend.md).

## Changelog

Notable changes are listed in [CHANGELOG.md](CHANGELOG.md); per-release notes are on the [GitHub Releases](https://github.com/SandObserver/stackyard/releases) page.

## License

Licensed under the [Apache License 2.0](LICENSE). You are free to use, modify, fork, and build on Stackyard, including commercially. In return you must keep the existing copyright and attribution notices, and the license does not grant rights to the **Stackyard** name or logo: forks are welcome but must use their own name and not present themselves as the original project. See [NOTICE](NOTICE).
