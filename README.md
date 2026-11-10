# 2D Weather Sandbox

Previously called "Weather_Sim_4"

This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.

The simulation requires a browser with WebGL2 and `EXT_color_buffer_float`; open it through a local web server rather than `file://`. Firefox performance depends on hardware acceleration being available. In Firefox, check the Graphics section of `about:support` if rendering is unexpectedly slow or WebGL is unavailable.

Audio assets use MP3 for broad Web Audio decoding support and load on demand, so unused sounds do not delay startup. Ambient sound-field samples use asynchronous GPU readback and update at most ten times per second.

The fluid solver bounds sounding-profile lookups at the bottom of the grid and sanitizes non-finite or runaway state values between update passes. These safeguards are intended to prevent a single unstable cell from corrupting the wider simulation; they only intervene outside broad physical ranges and do not replace the model's simplified physics.

Temperature and sounding profiles are uploaded as a small float texture rather than large fragment-shader uniform arrays, keeping shader uniform use within the WebGL2 minimum and improving compatibility with mobile GPUs.

The realistic display renders its HDR scene at 75% of the window dimensions and bloom at 50%, reducing their respective pixel workloads by about 44% and 75%. Thunder detection reads its GPU result once per rendered frame instead of synchronously after every simulation step. Startup fetches shader and image files concurrently; lightning artwork is generated in the background by at most two workers, at half the former dimensions, and transferred as image bitmaps instead of copied pixel arrays. Its aspect ratio and relative line width are preserved. The weather simulation grid, timestep, precipitation, and measurements remain unchanged; the upscaled image may look slightly softer.

The dat.GUI **Performance** folder, below **Exclusive Features**, contains Extreme, Quality, Balanced, and Performance presets for HDR and bloom rendering scale. Extreme uses full-resolution HDR and bloom, ACES filmic tone mapping, FXAA, cloud self-shadowing with cool cloud shadows and sun-warmed edges, a richer time-of-day sky gradient, and conservative screen-space temporal smoothing; the latter is clipped to current-frame neighbors and reset when the camera or display mode changes, rather than motion-reprojected. These effects increase GPU load, especially at high window resolutions. Individual effect controls are also available. The folder additionally includes controls for plant, precipitation-particle, and weather-station overlays, simulation iterations per frame, and an Auto FPS Target that defaults to 120 FPS, with targets up to 240 FPS and an Unlocked option. Unlocked leaves the iteration count unchanged and lets `requestAnimationFrame` run at the maximum rate supported by the browser and display. Numeric targets adjust simulation iterations, which affects simulation-time throughput and may change how quickly simulated time advances. A 120 FPS target does not guarantee 120 rendered FPS: actual rate is limited by the display refresh, browser, and rendering workload. Lower display scales only soften the rendered image; hiding overlays or bloom only affects presentation, while station measurements, precipitation, and plant growth continue. Hover performance controls for descriptions and color-coded impact levels; actual FPS gains depend on the workload and hardware bottleneck. The **Current Performance** section reports frame rate, frame time, simulation steps per second, render quality, and a face-icon score based on measured FPS.

The **Display** menu includes estimated reflectivity and surface-parcel CAPE views. Reflectivity is a radar-style visualization derived from cloud and precipitation fields, not calibrated dBZ or a radar product. CAPE is an approximate model-derived surface-parcel diagnostic; its column calculation refreshes periodically while the view is active, and hovering shows the latest CAPE, surface temperature/dew point, and LCL estimate for that column. Neither view replaces an operational weather analysis.

The **Updraft (Rising Air)** and **Downdraft (Sinking Air)** tools gently steer air vertically inside the brush. Their strength is limited to 5 m/s, defaults to 1 m/s, and blends into the existing flow to avoid abrupt velocity changes. The **Wind Push** tool can push air left or right and optionally set the pushed band's air temperature and relative humidity, allowing users to create contrasting air masses and experiment with front-like boundaries. Enable **Uninterrupted Mode** to feather the wind band's edges and limit temperature adjustment to 0.5 K per simulated hour. As temperature changes, the mode adjusts vapor to preserve relative humidity and blends optional humidity changes over simulated time, reducing abrupt cloud formation or dissipation. The selected temperature can take time to reach. Temperature and humidity overrides are off by default; band width and height use the whole-width and brush-size controls.

On touch screens, drag with one finger to use the selected tool, pinch with two fingers to zoom and pan, and use the on-screen settings panel to change tools and options. The setup preview responds to a single-finger drag and starts when you lift; a two-finger gesture only pans/zooms.


## Clouds and precipitation
Simulating clouds and precipitation are the main objectives of this project.
All the equations relating to water phase change are simplified versions of the real ones, to improve performance and ease programming.
Precipitation is simulated using discrete particles but can be viualized as both partiles and smooth realistic looking curtains.

Weather stations estimate cloud cover from a batched sample of the liquid cloud-water column above each station, using a 21-cell-wide viewing cone (10 cells to either side). Cloud fraction uses the same optical-density relationship as the renderer, and solid terrain/building cells are excluded from the sky scan. Station cards have separate Weather and Rain pages; scroll up or down over a station to switch between them. Their cards stay a fixed screen size while zooming, but remain anchored to their simulation locations. The current temperature and rain rate are shown prominently without labels in adaptive high-contrast text. The station icon and regular weather readings are on the Weather page, while precipitation totals, duration, peak rate, and sky conditions are on the Rain page. A hover hint indicates the scroll interaction, and page transitions fade text at the card edges. Station labels and the simulation clock sample the scene periodically and switch between light and dark text for contrast. The icon assets and license notice are in `resources/icons/weather`. Rain totals use liquid precipitation deposited at the surface within the station's existing 2.5 km sampling radius. A GPU-side accumulator retains deposition between station samples; the 0.2 mm tipping bucket reports rate over a simulation-time-based rolling window. Rain duration tracks intervals with at least 0.01 mm of deposited rain, while the rain icon requires a bucket tip. Totals retain sampled deposition. Deposition mass is model-calibrated rather than expressed in kilograms, so millimeter conversion uses the same calibration as soil-water accumulation.

## Sharing weather-station data on a LAN
The **Exclusive Features** menu includes **Share Weather Data to LAN**. To use it, run `python lan_weather_server.py` from this project folder on the computer running the simulation, then open the app on that computer (either `http://127.0.0.1:8000/` from this helper or a local development server such as `http://127.0.0.1:5500/`) and enable sharing. The helper's publishing API is always at `http://127.0.0.1:8000`; the server prints the LAN URL for the JSON endpoint:

```text
http://<server-LAN-IP>:8000/api/weather-stations
```

Other devices on the same private network can fetch that URL with an ordinary browser `fetch()`; the endpoint allows cross-origin GET requests and requires no token. It is read-only, returns HTTP 503 when sharing is off or its update is older than 10 seconds, and returns JSON with this shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-06T00:16:16.952Z",
  "simulationTime": "2000-06-28T21:39:49.536Z",
  "simulation": {
    "resolutionX": 7000,
    "resolutionY": 390,
    "cellSizeMeters": 38.46,
    "worldWidthMeters": 269230.77,
    "worldHeightMeters": 12000,
    "wrapsHorizontally": true
  },
  "units": {
    "temperature": "degrees Celsius",
    "windSpeed": "meters per second",
    "precipitation": "millimeters",
    "altitude": "meters",
    "soilMoisture": "millimeters",
    "snowDepth": "centimeters",
    "cloudCover": "percent and oktas",
    "solarAndInfraredPower": "watts per square meter"
  },
  "stations": [
    {
      "id": 29,
      "position": {
        "xCell": 3894,
        "yCell": 132,
        "xMeters": 149769.23,
        "altitudeMeters": 5076.92
      },
      "observedAt": "2000-06-28T21:39:30.048Z",
      "surfaceType": "land",
      "airTemperatureC": -12.15,
      "nearSurfaceAirTemperatureC": -12.15,
      "dewPointC": -15.0,
      "relativeHumidityPercent": 80.5,
      "windSpeedMetersPerSecond": 4.2,
      "groundTemperatureC": null,
      "waterTemperatureC": null,
      "soilMoistureMm": 12.3,
      "snowDepthCm": 0.0,
      "snowDepthChangeThisSampleCm": 0.0,
      "snowDepthChangeLastHourCm": 0.0,
      "rainRateMmPerHour": 0.0,
      "rainSinceLastSampleMm": 0.0,
      "rainTipsSinceLastSample": 0,
      "rainBucketWaterMm": 0.03,
      "rainTotalLastHourMm": 0.0,
      "rainTotalLast24HoursMm": 0.0,
      "peakRainRateLastHourMmPerHour": 0.0,
      "rainDurationMinutes": 0.0,
      "airQualityIndex": 0.5,
      "cloudCoverPercent": 35.0,
      "cloudCoverOktas": 3,
      "cloudCeilingMeters": 1200.0,
      "skyCondition": "SCT",
      "weatherIcon": "cloud-sun",
      "solarPowerWattsPerSquareMeter": 200.0,
      "netInfraredPowerWattsPerSquareMeter": -40.0
    }
  ]
}
```

The sample values above illustrate field types and are not live readings. All fields are present in each station object. `schemaVersion` identifies the response schema. `generatedAt` is the UTC time the response was built; `simulationTime` is the simulation's UTC clock. `simulation` describes the grid: `resolutionX`/`resolutionY` are cell counts, `cellSizeMeters` is the cell width/height, `worldWidthMeters` and `worldHeightMeters` are dimensions, and `wrapsHorizontally` reports whether the simulation wraps at its sides. `units` states the units used by measurements.

Station field reference:

| Field | Meaning |
|---|---|
| `id` | Stable numeric identifier for this station during the current page session. |
| `position.xCell`, `position.yCell` | Station grid coordinates. |
| `position.xMeters`, `position.altitudeMeters` | Horizontal position and altitude derived from the grid and cell size. |
| `observedAt` | UTC timestamp of the station's most recent measurement. |
| `surfaceType` | `land`, `water`, or `air`, based on the sampled cell below the station. |
| `airTemperatureC` | Air temperature at the station's grid cell, in °C. |
| `nearSurfaceAirTemperatureC` | Same measured air temperature, provided with an explicit near-surface name; not a separate ground measurement. |
| `dewPointC` | Dew point in °C. |
| `relativeHumidityPercent` | Relative humidity in percent. It can exceed 100% when supersaturated unless the simulation's real-dew-point option caps it. |
| `windSpeedMetersPerSecond` | Wind-speed magnitude in m/s. |
| `groundTemperatureC` | Always `null`; the simulation does not provide a separate ground-temperature measurement. |
| `waterTemperatureC` | Water-surface temperature in °C for water stations; otherwise `null`. |
| `soilMoistureMm` | Soil moisture for land stations; otherwise `null`. |
| `snowDepthCm` | Snow depth for land stations; otherwise `null`. |
| `snowDepthChangeThisSampleCm` | Snow-depth change since the preceding station measurement. |
| `snowDepthChangeLastHourCm` | Accumulated sampled snow-depth change over approximately the previous simulation hour. |
| `rainRateMmPerHour` | Tipping-bucket-derived rain rate in mm/h, averaged over a 10-minute simulation-time window. |
| `rainSinceLastSampleMm` | Precipitation deposited in the station's sampling area since its previous measurement. |
| `rainTipsSinceLastSample` | Number of 0.2 mm bucket tips since the preceding station measurement. |
| `rainBucketWaterMm` | Remaining water in the bucket toward its next tip, in mm. |
| `rainTotalLastHourMm` | Sampled precipitation total over the previous simulation hour, in mm. |
| `rainTotalLast24HoursMm` | Sampled precipitation total over the previous simulation day, in mm. |
| `peakRainRateLastHourMmPerHour` | Highest sampled interval rain rate during the previous simulation hour, in mm/h. |
| `rainDurationMinutes` | Continuous measurable-rain duration in simulation minutes. |
| `airQualityIndex` | Model-derived smoke concentration scaled to an AQI-like value; not an official air-quality index. |
| `cloudCoverPercent` | Estimated cloud cover in percent over the station's overhead sampling area. |
| `cloudCoverOktas` | Cloud cover rounded to eighths, from 0 to 8. |
| `cloudCeilingMeters` | Estimated lowest overhead cloud base in meters; `null` if none is detected. |
| `skyCondition` | Cloud-cover category: `CLR`, `FEW`, `SCT`, `BKN`, or `OVC`. |
| `weatherIcon` | Icon key: `sun`, `moon`, `cloud`, `cloud-sun`, `cloud-rain`, or `cloud-snow`. |
| `solarPowerWattsPerSquareMeter` | Direct solar power at the station, in W/m². |
| `netInfraredPowerWattsPerSquareMeter` | Downward minus upward infrared power, in W/m²; negative values mean net upward infrared power. |

Measurement values are JSON numbers, not display-formatted strings; unavailable measurements use `null`. Temperatures are Celsius, wind is meters per second, and precipitation is millimeters regardless of the simulation UI's selected display units. Humidity is a percentage and can exceed 100% in supersaturated air. Station IDs are stable only for the current page session and are not persisted across reloads. Sharing is opt-in and is reset to off when a save is loaded. The helper accepts publishing only from the sandbox opened at localhost, limits network clients to private/loopback/link-local addresses, and serves the sandbox on port 8000; your firewall may still need to allow Python on the private network. Stop the helper with Ctrl+C to close the endpoint.

Example client code:

```js
const response = await fetch('http://<server-LAN-IP>:8000/api/weather-stations');
if (!response.ok)
  throw new Error(`Weather data unavailable: HTTP ${response.status}`);
const weather = await response.json();
console.log(weather.simulationTime, weather.stations[0]?.airTemperatureC);
```

## Automatically sharing saves between devices

The GitHub Pages app can share a snapshot of the current simulation with devices on the same public IP address. Save files are stored on your own always-on Proxmox machine; a Cloudflare Worker provides the HTTPS front door and IP-based discovery. This setup does not use Cloudflare R2 or `lan_weather_server.py`.

### Set up the Proxmox relay

1. Create a small Debian VM on Proxmox. Installing Docker inside a VM is preferable to installing it on the Proxmox host.
2. Install Docker Engine with the Compose plugin and Tailscale on the VM. Sign in to Tailscale, enable HTTPS for your tailnet, and enable Funnel in your Tailscale policy. Funnel is available on Tailscale plans without a custom domain and does not require router port forwarding.
3. Copy the `relay-server` folder from this repository to your VM. From PowerShell in the project root, for example:

   ```powershell
   scp -r .\relay-server <linux-user>@<debian-vm-ip>:weather-save-relay
   ```

4. Generate a random secret on your computer with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Save it somewhere temporarily; use it for the VM's `RELAY_SECRET` and the Worker secret. Do not publish it.
5. On the VM, create `~/weather-save-relay/.env` with this line, replacing the placeholder with the generated secret:

   ```text
   RELAY_SECRET=replace-with-your-64-character-secret
   ```

6. On the VM, start the storage service:

   ```sh
   cd ~/weather-save-relay
   docker compose up -d --build
   ```

   Its save data is kept in a persistent Docker volume. The service listens only on the VM's loopback interface.
7. Expose that local service with Tailscale Funnel:

   ```sh
   sudo tailscale funnel --bg --https=443 http://127.0.0.1:8787
   sudo tailscale funnel status
   ```

   Use the HTTPS URL shown by the status command (for example, `https://your-vm.your-tailnet.ts.net`) as the relay origin below. Tailscale may ask you to enable Funnel/HTTPS or adjust your tailnet policy first.

### Configure the Cloudflare Worker front door

1. From the project root, set the Worker secrets. Use the same `RELAY_SECRET` value as the VM's `.env`; enter the VM's Tailscale Funnel HTTPS URL (for example, `https://your-vm.your-tailnet.ts.net`) for `RELAY_ORIGIN`:

   ```powershell
   npx wrangler secret put RELAY_SECRET --config worker/wrangler.jsonc
   npx wrangler secret put RELAY_ORIGIN --config worker/wrangler.jsonc
   ```

   Paste each value when Wrangler prompts. These values are deployment secrets and must not be committed. This Worker does not bind to R2.
2. Deploy the Worker:

   ```powershell
   npm run relay:deploy
   ```

   Wrangler prints its `workers.dev` URL. Put that URL in `save-relay-config.js` as `window.WEATHER_SAVE_RELAY_URL = 'https://your-worker.your-subdomain.workers.dev';`, then deploy the updated site to GitHub Pages.

After setup, load or create a simulation on the PC and choose **Share Simulation with Device** below **Save Simulation to File** in the dat.GUI controls. Sharing is opt-in; confirm the prompt to upload a snapshot of the current world through the Worker to your Proxmox machine. Copy the random access code shown and share it only with trusted devices. A phone using the app on the same Wi-Fi (or the same VPN egress) discovers the **Load save from …** pill; selecting it requires entering that code. Discovery refreshes every ten seconds and is based on the exact public IP seen by Cloudflare, not the Wi-Fi name: cellular data, VPNs, privacy relays, or different public IPv4/IPv6 addresses can put devices in separate groups even when they use the same router. Keep the PC tab open while sharing. Uploads can take up to 20 minutes before timing out. Heartbeats and deleting a share require a separate owner key held only in that tab. Shares expire ten minutes after their last heartbeat and are removed from Proxmox storage automatically.

Save files pass through Cloudflare's Worker but are not stored there; the Proxmox relay stores and serves them. Discovery is grouped by public IP, not by home network or account, so other people sharing that public IP can see active share filenames and device labels. They cannot download a save without its random access code. The Worker limits each public IP to 120 requests per minute and three uploads per minute (Cloudflare's limits are approximate); the relay also caps uploads at 90 MiB each, active data at 180 MiB per public IP, total stored save data at 1 GiB by default, active shares at ten per public IP, and network metadata to 10,000 active IP groups. Configure `RELAY_MAX_STORAGE_BYTES` in the VM's `.env` to change the disk quota. Do not load sensitive saves while sharing a public IP with untrusted users. Browsers do not reveal a computer's actual hostname to websites, so the pill uses a platform label such as “Windows PC” instead of a custom PC name. Cloudflare Workers and Tailscale Funnel have service limits that may change; review their current plan limits before relying on them.

The Worker Origin allowlist and CORS are browser protections, not authentication. Save download authorization uses the per-share code; owner actions use a different random key; Worker-to-Proxmox proxy requests use `RELAY_SECRET`. The relay binds only to VM loopback and should only be exposed through the Worker/Tailscale Funnel. Keep both secrets out of public repositories and logs.

To update the relay after changing `relay-server` files, copy the folder to the VM again and rebuild it:

```powershell
scp -r .\relay-server <linux-user>@<debian-vm-ip>:weather-save-relay-update
```

Then on the VM run:

```sh
cp -a ~/weather-save-relay-update/. ~/weather-save-relay/
cd ~/weather-save-relay
sudo docker compose up -d --build
```

## Plant ecosystem
Land surfaces support a lightweight plant community that responds to local near-surface temperature, wind, atmospheric relative humidity, soil moisture, snow cover, latitude, and elevation. Air humidity and soil moisture both affect biome classification, species establishment, reproduction, and drought stress. Hovering over a plant shows its health, wind damage and force, local air humidity, soil moisture, and temperature. The desert catalog includes specialized ultra-arid species such as welwitschia and resurrection plants. Plants are rooted at the terrain surface, flex under a damped wind-force model, and accumulate stress and structural damage when winds exceed species resistance; grasses, flowers, mosses, and shrubs can form visible clumps. Plants in dry biomes use muted, drought-adapted colors. Suitable bare ground can germinate from a dormant seed bank even without nearby parent plants. Plants grow when conditions are suitable, reproduce into nearby open ground, become stressed when conditions deteriorate, and eventually die if they cannot recover. The Ecosystem controls can pause plant growth or hide the plant layer.

Ecosystem controls are grouped in the dat.GUI **Exclusive Features** folder. The page title fades out when the simulation starts.

The plant community includes at least ten species in each of the ten supported biomes. Every plant is drawn procedurally in code; no plant image files are loaded. This is a qualitative ecosystem model for the 2D weather sandbox, not a detailed ecological or vegetation simulation.

Forming Cell:
![Screenshot (7)](https://user-images.githubusercontent.com/42830240/232745061-25c860c3-8c52-4704-86af-bcba13f74cd6.png)

Mature Cell 1:
![Screenshot (23)](https://user-images.githubusercontent.com/42830240/232744315-5207396b-57e4-4aaa-968a-e85cd9283f3d.png)
Mature Cell 1 with Precipitation Particles:
![Screenshot (26)](https://user-images.githubusercontent.com/42830240/232744406-ba1c7230-a8b2-492a-85bb-c1c57c1c8a81.png)


Mature Cell 2:
![Screenshot (10)](https://user-images.githubusercontent.com/42830240/232746561-341b867e-9fcd-4d34-b200-61c403695d5a.png)


Mature Cell 3 zoomed out:
![Screenshot (17)](https://user-images.githubusercontent.com/42830240/232746022-dcb4755a-219c-474e-8ae6-8a6ebfadbd0e.png)


Sunlight with realistic colors makes clouds and precipitation look real
![Screenshot (31)](https://user-images.githubusercontent.com/42830240/232749322-d4602f66-015e-4405-9da7-2e4969473c55.png)
![Screenshot (32)](https://user-images.githubusercontent.com/42830240/232749511-1e5c2010-e65a-44eb-bbfe-f9e9b87f5c10.png)



![Bui5](https://user-images.githubusercontent.com/42830240/160260713-32ffee8a-18a2-45bc-98be-b4396793b466.PNG)


## Limitations
Due to the two-dimensional nature of the simulation, it cannot simulate 3D vortices such as tornadoes, dust devils or hurricanes. It can only simulate linear storm systems.


# Example: low intensity cell analysis
Warm moist air is rising into the cloud on the right condensing water and releasing heat until it eventually rises well above the freezing level and forming ice (snow), realeasing even more heat. The snow grows until it descents down under the freezing level and melts into rain, absorbing heat and creating a downdraft. Below the cloud level some of the rain evaporates, absorbing even more heat and strengtening the downward motion. Near the surface the air spreads out sideways and in this case mostly to the right, creating a small low level cold front. This cold front pushes even more warm air up.
![Schermopname (92)_LI](https://user-images.githubusercontent.com/42830240/173361271-23383858-f0d3-485d-91b9-21e0d3c75211.jpg)
The dew points and cape are very low in this example, but it's just enough to form a nice stable cell.
![Naamloos](https://user-images.githubusercontent.com/42830240/173365013-cdea3b40-f470-4390-a8fa-b8d93025d893.png)

# The Code
The simulation is based on a simple fluid simulation topology.
All code was written by me (Niels Daemen) except for the libraries included

## Fluid Model
The fluid model consists of a 2 dimensional grid of cells. 
Each cell has the following properties:

<img width="1095" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/f08e08e9-4d96-4d80-b890-1f213085668f">


These properties are not simply defined at the center of each cell, but using a so called staggered grid. the velocities are defined exactly on the border between cells. They are therefore exactly in between the centers of the cells, which is where the pressures are defined. In this way the velocities define the exact flow rate from one cell to its neighbor. This makes calculating new velocities and pressures very simple.

![image](https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/107d58f9-359c-4507-b7a9-bb1019a60934)


### Iteration
One iteration or timestep consists of the following steps:
1.	Calculating pressure 
2.	Calculating velocities
3.	Advection
Every step is completed for each cell in the grid, before the next step is executed.



### Calculating pressure
Pressure can be imagined as being the amount of fluid that is in a cell.
The velocities can be imagined as a flow of fluid from a cell to a neighbouring cell. Therefore the change in pressure is equal to the net inflow to the cell this is also known as the divergence (or convergence) in the velocity vector field. To calculate the net inflow to the cell, the total outflow is simply subtracted from the total inflow. This is done for both x and y directions. 

<img width="460" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/b2500548-5145-451f-b67b-84d2d8673811">

![image](https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/83ea332f-c5c9-46de-8afb-5a0bf28c7b31)



### Calculating velocities

The change in the velocity trough a point is proportional to the pressure across it. This is basically just Newton's 2nd law (F = m * a) Pressure is force / area, and since the area of the cell is constant, the force (F) is simply the pressure gradient across the point. The mass (M) is also assumed to be constant as if the fluid has a constant density, this is not physically accurate. The acceleration (a) is then simply a function of the pressure gradient. Acceleration is simply the change in velocity / time, and because the timestep is constant all that remains is simply adding the pressure gradients to the velocities for both x and y axis:


<img width="566" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/3c8714fc-8b32-4fa8-8591-3a07509001a7">




## Libraries

The simulation and visualization itself is entirely custom js and glsl written by me (Niels Daemen). The sounding graph, keyboard and mouse controls are also custom code. The simulation can run and be partly controlled without any libraries. I do however use the following libraries for part of the user interface and file compression:

DatGui: Used for the user interface because it's very easy to add more controllable variables. It is however getting a bit cluttered and other options should be evaluated. Building a custom interface is also an option.

Pako: Only used for data compression to reduce save file sizes. Size reduction can be 2-4 times depending on the state of the simulation. Not essential. Downside is that it takes longer to save and load files.
  
# How to run it locally and modify code
  1. Install VS code: https://code.visualstudio.com/
  2. Install VS Code extensions:
   * Live Server (required)
   * GLSL lint (recommended)
   * Clang-Format, requires installing CLANG/LLVM: https://github.com/llvm/llvm-project/releases/tag/llvmorg-16.0.0 (recommended)
  
  3. Clone project using GIT, or just download ZIP
  4. Open project folder in VS Code
  5. Open index.html
  6. Start live server (Go Live), automatically opens page in browser

## Deploying a GitHub Pages copy

This project is a static site and can be deployed directly from GitHub Pages. The workflow in `.github/workflows/pages.yml` publishes the repository root whenever code is pushed to `main` or `master`, and can also be started manually from the repository's Actions tab.

For `zaioiemeerkat-commits/2dweathersimoptimized`, push this project to that repository. The deployment workflow enables GitHub Pages and publishes the repository root. After the workflow succeeds, the site will be available at:

https://zaioiemeerkat-commits.github.io/2dweathersimoptimized/

The site name and simulation performance defaults are unchanged. GitHub Pages only hosts the files; it does not change the browser, GPU, or simulation workload.
