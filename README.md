# Scream Bird

A Flappy Bird style HTML/JavaScript game controlled by microphone sound level streamed from a phone running nikki Streams. It connects through nikki-build's official `streams.js` browser SDK, vendored as `streams-sdk.js` from version 1.0.5. The browser receives sensor numbers; it does not request microphone access or record audio. See the [upstream SDK repository](https://github.com/nikki-build/streams.js).

## Run it

1. Keep the phone and laptop on the same Wi-Fi network.
2. In nikki Streams, open the session, enable the Microphone sensor, and start streaming.
3. Serve this folder over HTTP. From this folder, run `py -m http.server 8000` in PowerShell.
4. On the laptop, open `http://localhost:8000` in a browser.
5. Check the server address in the Phone microphone panel, enter your Streams session ID, then click **Connect phone**. The server address defaults to `10.89.84.190:3000`; the session ID is left blank in the source and is saved only in this browser's local storage after you connect.
6. Wait for the status to say **Phone connected · listening**. Click **Start flight**, then make a short loud sound. Use the threshold slider or **Calibrate to room noise** if the level does not cross the trigger.

Use **Space**, **Up Arrow**, or a tap/click on the game as a manual fallback. When the game ends, click **Fly again** or flap to restart.

## How it works

`index.html` lays out the canvas and input controls. `game.js` initializes the official SDK with the Streams session ID, creates a device using the phone's local address, and awaits `device.connect()`. The SDK reports connection status and sends parsed sensor data to the callback. Incoming data is searched for microphone-related dB/level/amplitude fields, including nested payloads. Positive readings from a `Mic` field use a 30–120 dB trigger scale (default 72 dB); normalized amplitude values from 0 to 1 are converted to negative dBFS with `20 × log10(amplitude)` and use a matching negative threshold scale. The meter switches scales based on the first microphone reading. When sound exceeds the trigger, the bird flaps and repeats at a short interval if you sustain the sound; silence lets gravity pull it down and re-arms the trigger. The game loop applies gravity, moves the pipes, checks collisions, and updates score on the canvas.

The microphone sensor must already be enabled and streaming in the phone app. The app's messages should include a numeric microphone level. If connection succeeds but the meter stays blank, open **Sensor message details** to inspect the latest frame and adjust the parser in `findAudioReading()` to the exact field name your Streams app sends.

## Hosting online

This is a static site: upload `index.html`, `styles.css`, `game.js`, and the image/audio assets to any static host. For a hosted HTTPS page to connect to the phone, the Streams server must also offer secure WebSocket (`wss://`) support; browsers block an insecure `ws://` connection from an HTTPS page. Hosting this project does not insert it into or modify a third-party Flappy Bird website.

The session ID is stored in the browser's local storage to retain settings. Avoid sharing a public link with a live session ID; use a new session ID if needed.
