# Changelog

## V1.1 Beta

This release focuses on making the simulator easier to use on phones, adding
vertical-air tools, and reducing rendering and GPU compatibility issues. The
mobile simulation-size limit is an estimate based on browser-reported hardware;
it is a safety guide, not a guarantee of performance.

### Mobile controls and navigation

- Added a touch-friendly controls drawer styled to match the desktop dat.GUI.
  In portrait it opens from the bottom and can be expanded, half-expanded, or
  minimized. In landscape it docks at the right edge and opens or closes with a
  separate grip.
- Added animated drawer movement, section transitions, safe-area spacing, and
  orientation handling.
- Added an integrated quick-action bar containing the three most recently used
  tools, each with its own icon, plus a separate pause/resume action. The active
  tool highlight and shortcut positions animate when the selection changes.
- Added press-and-hold labels for quick actions.
- Added mobile gestures: one-finger dragging uses the selected tool; two-finger
  gestures pan and zoom. The setup preview responds to a single-finger drag and
  starts on release; a two-finger gesture only pans or zooms.
- Added a mobile fullscreen request with a visible fallback button when the
  browser does not support or allow fullscreen.
- Reworked the mobile status bar to respect screen safe areas and show the
  simulation clock, date, elapsed time, solar-event information, and FPS in a
  compact layout.

### Haptics and audio

- Added a mobile-only **Toggle Haptics** setting in Advanced, enabled by
  default, with an explanation of the supported motor type. Disabling it
  suppresses haptic feedback.
- Added synthesized audio pulses alongside haptic feedback when sound is
  enabled.
- Made lightning and thunder feedback respond to storm distance from the
  current camera view. Thunder audio is delayed according to simulated
  sound-travel time, and audio balance follows the storm's position.

### Simulation tools and touch input

- Added **Updraft (Rising Air)** and **Downdraft (Sinking Air)** tools. They
  gently steer air vertically inside the brush, default to 1 m/s, and are
  limited to 5 m/s to avoid abrupt changes to the flow.
- Improved mobile interactions so multi-finger camera gestures do not also
  apply the selected simulation tool.
- Improved placement of weather stations by resolving the intended
  simulation-grid position from screen coordinates.

### Performance and graphics

- Added **Extreme**, **Quality**, **Balanced**, **Performance**, and **Custom**
  graphics presets, with individual controls for rendering effects.
- Added smooth transitions between graphics settings.
- Added controls for HDR and bloom rendering scale, tone mapping, FXAA,
  temporal smoothing, cloud lighting, sky appearance, and an eye-friendly
  display option. Temporal smoothing is constrained against current-frame
  neighbors and reset when the camera or display mode changes; it is not
  motion-reprojected.
- Added a **Current Performance** readout for FPS, frame time, simulation steps
  per second, render quality, and a performance score. Added an Auto FPS Target
  to adjust simulation iterations toward a target; this can change how quickly
  simulated time advances. A target does not guarantee a particular display
  frame rate.
- Reduced the realistic HDR scene render scale to 75% of the window dimensions
  and bloom to 50%. This reduces pixel work at the cost of some image
  sharpness.
- Changed thunder detection to read its GPU result once per rendered frame
  rather than synchronously after every simulation step.
- Fetches shader and image resources concurrently at startup. Lightning
  artwork is generated in the background by at most two workers, at half the
  previous dimensions, and transferred as image bitmaps. This reduces startup
  work and memory copying; the upscaled artwork may appear slightly softer.
- Replaced large shader uniform arrays for temperature and sounding profiles
  with a small float texture to reduce shader uniform requirements and improve
  compatibility with mobile WebGL2 GPUs.
- Added checks for framebuffer and texture allocation failures so GPU resource
  failures are reported explicitly.

### Mobile simulation sizing and reliability

- Added a hardware-informed estimate of mobile simulation capacity. Setup
  sliders adjust their allowed ranges and clamp oversized resolutions; starting
  a simulation checks the estimate again and explains when the requested size
  is too large.
- Applied the same estimated cell limit to loaded save files before allocating
  their simulation arrays.
- Added validation for save-file headers, dimensions, array lengths, settings,
  and weather-station positions, with clearer errors for invalid or incomplete
  files.
- The mobile capacity estimate depends on what the browser reports and cannot
  predict every device's actual GPU or memory limits. Desktop simulation
  limits remain unchanged.

### Visual and interface updates

- Changed plant sprite sizing to follow camera zoom without imposing a minimum
  screen-space height, so plants scale more consistently as users zoom.
- Added the **V1.1** version label and a beta notice to the main menu.
- Updated the README with touch-control instructions and descriptions of the
  vertical-air tools and rendering/performance options.

### Simulation behavior

- Rendering-scale and graphics-quality changes affect presentation workload
  and image sharpness; they do not reduce the simulation grid resolution,
  change the simulation timestep, or disable precipitation, station
  measurements, or plant growth.
