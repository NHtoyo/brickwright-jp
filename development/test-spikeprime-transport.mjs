// Fake-WebBluetooth coverage for the unified SPIKE extension. This test never
// opens a browser chooser or accesses a physical hub.
//
// Wire layouts below follow LEGO's published SPIKE Prime protocol:
// https://lego.github.io/spike-prime-docs/connect.html
// https://lego.github.io/spike-prime-docs/messages.html
// https://lego.github.io/spike-prime-docs/encoding.html
//
//   node development/test-spikeprime-transport.js

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const officialTransferVectors = JSON.parse(
  fs.readFileSync(
    path.join(here, "fixtures/spikeprime-official-transfer-vectors.json"),
    "utf8"
  )
);
const source = fs.readFileSync(
  path.join(here, "../static/extensions/CrispStrobe/legospike_turbowarp_transpile.js"),
  "utf8"
);

class FakeClock {
  constructor() {
    this._next = 1;
    this._now = 1000;
    this._tasks = new Map();
  }

  setTimeout(callback, delay = 0) {
    const id = this._next++;
    this._tasks.set(id, { callback, due: this._now + Number(delay) });
    return id;
  }

  clearTimeout(id) {
    this._tasks.delete(id);
  }

  advance(milliseconds) {
    this._now += milliseconds;
    while (true) {
      const next = [...this._tasks.entries()]
        .filter(([, task]) => task.due <= this._now)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this._tasks.delete(next[0]);
      next[1].callback();
    }
  }
}

class FakeRuntime {
  static PERIPHERAL_CONNECTED = "peripheral-connected";
  static PERIPHERAL_DISCONNECTED = "peripheral-disconnected";
  static PERIPHERAL_LIST_UPDATE = "peripheral-list-update";
  static USER_PICKED_PERIPHERAL = "user-picked-peripheral";
  static PERIPHERAL_SCAN_TIMEOUT = "peripheral-scan-timeout";
  static PERIPHERAL_REQUEST_ERROR = "peripheral-request-error";
  static PERIPHERAL_CONNECTION_LOST_ERROR = "peripheral-connection-lost-error";

  constructor() {
    this.events = [];
    this.listeners = new Map();
    this.peripheralExtensions = {};
  }

  emit(event, payload) {
    this.events.push({ event, payload });
    for (const callback of this.listeners.get(event) || []) callback(payload);
  }

  on(event, callback) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.push(callback);
    this.listeners.set(event, callbacks);
  }

  registerPeripheralExtension(id, peripheral) {
    this.peripheral = { id, peripheral };
    this.peripheralExtensions[id] = peripheral;
  }
}

class FakeCharacteristic {
  constructor({ writes = null, failNextWrite = false } = {}) {
    this.writes = writes;
    this.failNextWrite = failNextWrite;
    this.listeners = new Map();
  }

  startNotifications() {
    this.notificationsStarted = true;
    return Promise.resolve(this);
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  removeEventListener(name, callback) {
    this.listeners.set(
      name,
      (this.listeners.get(name) || []).filter(
        (listener) => listener !== callback
      )
    );
  }

  writeValueWithoutResponse(bytes) {
    if (this.failNextWrite || this.writes.length + 1 === this.failWriteNumber) {
      this.failNextWrite = false;
      this.failWriteNumber = null;
      throw new Error("simulated fake-device write failure");
    }
    this.writes.push(Array.from(bytes));
    return Promise.resolve();
  }

  emit(bytes, byteOffset = 3) {
    const padded = new Uint8Array(byteOffset + bytes.length + 2);
    padded.set(bytes, byteOffset);
    const value = new DataView(padded.buffer, byteOffset, bytes.length);
    const event = { target: { value } };
    for (const callback of this.listeners.get("characteristicvaluechanged") ||
      []) {
      callback(event);
    }
  }
}

class FakeHubDevice {
  constructor(protocol = "spike3") {
    this.protocol = protocol;
    this.id =
      protocol === "lwp3" ? "fake-spike-essential-hub" : "fake-spike-prime-hub";
    this.listeners = new Map();
    this.writes = [];
    this.rx = new FakeCharacteristic({ writes: this.writes });
    this.tx = protocol === "lwp3" ? this.rx : new FakeCharacteristic();
    this.gatt = {
      connected: false,
      connect: () => {
        this.gatt.connected = true;
        return Promise.resolve(this.gatt);
      },
      disconnect: () => {
        this.gatt.connected = false;
        this.dispatch("gattserverdisconnected", {});
      },
      getPrimaryService: (uuid) => {
        const lwp3 = "00001623-1212-efde-1623-785feabcd123";
        const spike3 = "0000fd02-0000-1000-8000-00805f9b34fb";
        if (this.protocol === "lwp3" && uuid !== lwp3) {
          return Promise.reject(new Error("service unavailable"));
        }
        if (this.protocol !== "lwp3" && uuid !== spike3) {
          return Promise.reject(new Error("service unavailable"));
        }
        return Promise.resolve({
          getCharacteristic: (characteristicUUID) => {
            if (this.protocol === "lwp3") {
              assert.equal(
                characteristicUUID,
                "00001624-1212-efde-1623-785feabcd123"
              );
              return Promise.resolve(this.rx);
            }
            if (characteristicUUID === "0000fd02-0001-1000-8000-00805f9b34fb") {
              return Promise.resolve(this.rx);
            }
            assert.equal(
              characteristicUUID,
              "0000fd02-0002-1000-8000-00805f9b34fb"
            );
            return Promise.resolve(this.tx);
          },
        });
      },
    };
  }

  emitLWP3(message) {
    this.tx.emit(Uint8Array.from(message));
  }

  handleLWP3Write(message) {
    if (message.length < 5 || message[0] !== message.length) return;
    if (message[2] !== 0x01 || message[4] !== 0x05) return;
    const property = message[3];
    if (property === 0x0b) {
      this.emitLWP3([6, 0, 0x01, property, 0x06, 0x83]);
    } else if (property === 0x03) {
      this.emitLWP3([9, 0, 0x01, property, 0x06, 1, 0, 0, 0]);
    } else if (property === 0x06) {
      this.emitLWP3([6, 0, 0x01, property, 0x06, 85]);
    }
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  removeEventListener(name, callback) {
    this.listeners.set(
      name,
      (this.listeners.get(name) || []).filter(
        (listener) => listener !== callback
      )
    );
  }

  dispatch(name, event) {
    for (const callback of this.listeners.get(name) || []) callback(event);
  }
}

// Independent fixture encoder, intentionally kept outside the production VM.
// It follows LEGO's extended COBS code_word = block + 2 + delimiter * 84.
function packMessage(message) {
  const output = [0xff];
  let codeIndex = 0;
  let blockSize = 1;
  for (const byte of message) {
    if (byte <= 2) {
      output[codeIndex] = blockSize + 2 + byte * 84;
      codeIndex = output.length;
      output.push(0xff);
      blockSize = 1;
    } else {
      output.push(byte);
      blockSize++;
      if (blockSize > 84) {
        codeIndex = output.length;
        output.push(0xff);
        blockSize = 1;
      }
    }
  }
  output[codeIndex] = blockSize + 2;
  return Uint8Array.from([...output.map((byte) => byte ^ 3), 2]);
}

function emitControllerBootMarker(
  state,
  text = "BWCTRL:boot:tunnel-callback-registered\n"
) {
  state.device.tx.emit(packMessage([0x21, ...new TextEncoder().encode(text)]));
}

function unpackMessage(frame) {
  assert.equal(frame.at(-1), 2, "wire message has a 0x02 delimiter");
  const encoded = Array.from(frame.slice(0, -1), (byte) => byte ^ 3);
  const decoded = [];
  let offset = 0;
  while (offset < encoded.length) {
    const code = encoded[offset++];
    assert.ok(code > 2, "COBS code is not reserved");
    const adjusted = code === 0xff ? null : code - 3;
    const delimiter = adjusted === null ? null : Math.floor(adjusted / 84);
    const blockSize = adjusted === null ? 84 : adjusted % 84;
    assert.ok(delimiter === null || delimiter <= 2, "COBS delimiter is valid");
    assert.ok(offset + blockSize <= encoded.length, "COBS block is complete");
    for (let i = 0; i < blockSize; i++) decoded.push(encoded[offset++]);
    if (delimiter !== null && offset < encoded.length) decoded.push(delimiter);
  }
  return decoded;
}

function unpackWrittenMessages(writes) {
  const messages = [];
  let frame = [];
  for (const packet of writes) {
    for (const byte of packet) {
      frame.push(byte);
      if (byte === 2) {
        messages.push(unpackMessage(Uint8Array.from(frame)));
        frame = [];
      }
    }
  }
  assert.equal(frame.length, 0, "all outbound COBS frames have a delimiter");
  return messages;
}

function bytesFromHex(hex) {
  assert.equal(hex.length % 2, 0, "hex data contains complete bytes");
  return Uint8Array.from(hex.match(/.{2}/g) || [], (byte) =>
    Number.parseInt(byte, 16)
  );
}

function infoResponse() {
  // InfoResponse fields per messages.html: RPC 2.42, firmware 1.6.62,
  // packet size 64, message size 100, chunk size 50, SPIKE Prime product 0.
  return Uint8Array.from([
    0x01, 2, 0, 42, 0, 1, 6, 62, 0, 64, 0, 100, 0, 50, 0, 0, 0,
  ]);
}

function notification(payload) {
  return Uint8Array.from([
    0x3c,
    payload.length & 0xff,
    payload.length >> 8,
    ...payload,
  ]);
}

function imuRecord({
  yaw = 0,
  pitch = 0,
  roll = 0,
  accelerationX = 0,
  accelerationY = 0,
  accelerationZ = 0,
  gyroX = 0,
  gyroY = 0,
  gyroZ = 0,
} = {}) {
  const bytes = new Uint8Array(21);
  bytes[0] = 0x01;
  bytes[1] = 0; // Hub face up: top.
  bytes[2] = 0; // Configured yaw face: top.
  const view = new DataView(bytes.buffer);
  view.setInt16(3, yaw, true);
  view.setInt16(5, pitch, true);
  view.setInt16(7, roll, true);
  view.setInt16(9, accelerationX, true);
  view.setInt16(11, accelerationY, true);
  view.setInt16(13, accelerationZ, true);
  view.setInt16(15, gyroX, true);
  view.setInt16(17, gyroY, true);
  view.setInt16(19, gyroZ, true);
  return bytes;
}

function controllerSensorTunnelMessage(snapshot) {
  const payload = new TextEncoder().encode(
    JSON.stringify({ e: "sensor", v: snapshot }) + "\n"
  );
  return Uint8Array.from([
    0x32,
    payload.length & 0xff,
    payload.length >> 8,
    ...payload,
  ]);
}

function motorRecord({
  port = 0,
  motorType = 0x31,
  absolute = -37,
  power = -500,
  speed = -12,
  position = -123456,
} = {}) {
  const bytes = new Uint8Array(12);
  bytes[0] = 0x0a;
  bytes[1] = port;
  bytes[2] = motorType;
  const view = new DataView(bytes.buffer);
  view.setInt16(3, absolute, true);
  view.setInt16(5, power, true);
  bytes[7] = speed & 0xff;
  view.setInt32(8, position, true);
  return bytes;
}

function bytes(...parts) {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitUntil(predicate, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

async function settleWithFakeClock(promises, clock, maxSteps = 500) {
  let settledCount = 0;
  const settled = promises.map((promise) => Promise.resolve(promise).then(
    () => { settledCount += 1; },
    () => { settledCount += 1; }
  ));
  for (let step = 0; settledCount < promises.length && step < maxSteps; step++) {
    await tick();
    if (settledCount === promises.length) break;
    const nextDue = Math.min(...[...clock._tasks.values()].map(task => task.due));
    if (!Number.isFinite(nextDue)) {
      await tick();
      if (settledCount < promises.length && clock._tasks.size === 0) {
        assert.fail("fake-clock promises are pending without a scheduled timer");
      }
      continue;
    }
    clock.advance(Math.max(1, nextDue - clock._now));
  }
  assert.equal(settledCount, promises.length, "all fake-clock operations settle");
  await Promise.all(settled);
}

function setup({
  failRequestWrite = false,
  failWriteMessageType = null,
  failBluetoothChooser = false,
  locale = "en",
  developerMode = false,
  hubKind = "prime",
} = {}) {
  const clock = new FakeClock();
  const runtime = new FakeRuntime();
  const device = new FakeHubDevice(hubKind === "essential" ? "lwp3" : "spike3");
  const bluetooth = {
    requests: [],
    requestDevice: (options) => {
      bluetooth.requests.push(options);
      if (failBluetoothChooser) {
        return Promise.reject(
          new Error("simulated Web Bluetooth chooser failure")
        );
      }
      return Promise.resolve(device);
    },
  };
  const savedValues = new Map();
  const storage = {
    getItem: (key) => savedValues.get(key) ?? null,
    setItem: (key, value) => savedValues.set(key, String(value)),
    removeItem: (key) => savedValues.delete(key),
  };
  const confirmationCalls = [];
  const alertCalls = [];
  const rxWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  let incomingFrame = [];
  device.rx.writeValueWithoutResponse = async (packet) => {
    if (hubKind === "essential") {
      await rxWrite(packet);
      device.handleLWP3Write(Array.from(packet));
      return;
    }
    const completeMessages = [];
    for (const byte of packet) {
      incomingFrame.push(byte);
      if (byte === 2) {
        completeMessages.push(unpackMessage(Uint8Array.from(incomingFrame)));
        incomingFrame = [];
      }
    }
    if (
      failRequestWrite &&
      completeMessages.some((message) => message[0] === 0x28)
    ) {
      device.rx.failNextWrite = true;
    }
    if (
      failWriteMessageType !== null &&
      completeMessages.some((message) => message[0] === failWriteMessageType)
    ) {
      device.rx.failNextWrite = true;
    }
    await rxWrite(packet);
    for (const decoded of completeMessages) {
      if (device.autoInfoResponse && decoded[0] === 0x00) {
        device.tx.emit(packMessage(infoResponse()));
      }
      if (device.protocolHandler) await device.protocolHandler(decoded);
    }
  };
  const context = vm.createContext({
    Scratch: {
      vm: { runtime },
      extensions: {
        unsandboxed: true,
        register: (extension) => (context.extension = extension),
      },
      BWConfirm: (message) => {
        confirmationCalls.push(message);
        return true;
      },
      ArgumentType: new Proxy({}, { get: (_target, key) => String(key) }),
      BlockType: new Proxy({}, { get: (_target, key) => String(key) }),
      Cast: {
        toString: (value) => String(value),
        toNumber: (value) =>
          Number.isFinite(Number(value)) ? Number(value) : 0,
        toBoolean: Boolean,
      },
    },
    navigator: { language: locale, languages: [locale], bluetooth },
    window: {
      setTimeout: clock.setTimeout.bind(clock),
      clearTimeout: clock.clearTimeout.bind(clock),
      addEventListener() {},
      location: {
        search: developerMode ? "?spikePrimeDiagnostics=1" : "",
      },
    },
    performance: {now: () => clock._now},
    document: { documentElement: { lang: locale } },
    localStorage: storage,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    setInterval: () => 0,
    clearInterval: () => {},
    alert(...args) {
      alertCalls.push(args);
    },
    TextEncoder,
    TextDecoder,
    DataView,
    Uint8Array,
    Date,
    Promise,
    btoa,
    atob,
  });
  vm.runInContext(source, context);
  assert.ok(context.extension, "extension registered");
  const ext = context.extension;
  ext._peripheral.setMode("web-ble");
  return {
    clock,
    runtime,
    device,
    bluetooth,
    ext,
    context,
    failRequestWrite,
    confirmationCalls,
    alertCalls,
    storage,
  };
}

async function connect(setupResult) {
  await setupResult.ext._peripheral.scan();
  await tick();
  const { device, ext } = setupResult;
  assert.equal(
    device.tx.notificationsStarted,
    true,
    "TX notifications enabled"
  );
  assert.equal(ext.isConnected(), true, "fake hub connected");
  assert.equal(
    ext._peripheral.detectedHubModel,
    null,
    "connected transport alone does not identify the hub model"
  );
  assert.deepEqual(unpackMessage(Uint8Array.from(device.writes[0])), [0x00]);
  device.tx.emit(packMessage(infoResponse()));
  await tick();
  assert.equal(ext.getFirmwareVersion(), "1.6.62");
  assert.equal(ext._peripheral.detectedHubModel, "prime");
  await tick();
  if (!setupResult.failRequestWrite) {
    assert.deepEqual(
      unpackMessage(Uint8Array.from(device.writes[1])),
      [0x28, 100, 0],
      "the hub is asked for 100 ms device notifications"
    );
    assert.equal(
      Buffer.from(device.writes[1]).toString("hex"),
      "062b670002",
      "the raw 0x28 request uses LEGO's expected SPIKE COBS framing"
    );
  }
}

async function connectEssential(setupResult) {
  await setupResult.ext._peripheral.scan();
  const { device, ext } = setupResult;
  assert.equal(
    device.tx.notificationsStarted,
    true,
    "LWP3 notifications enabled"
  );
  assert.equal(ext.isConnected(), true, "fake Essential hub connected");
  const diagnostics = JSON.parse(ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.protocol, "lwp3-essential");
  assert.equal(diagnostics.hubSystemType, 0x83);
  assert.equal(diagnostics.detectedHubModel, "essential");
  assert.deepEqual(diagnostics.availablePorts, ["A", "B"]);
}

async function acknowledgeEssentialMotorPositionMode(state, portId) {
  await acknowledgeEssentialApos(state, portId);
}

async function advertiseEssentialApos(
  state,
  portId = 0,
  { combinable = false, dataType = 1, decimals = 0 } = {}
) {
  const { device } = state;
  const capabilities = 0x01 | (combinable ? 0x04 : 0);
  device.emitLWP3([
    11,
    0,
    0x43,
    portId,
    0x01,
    capabilities,
    4,
    0x0c,
    0x00,
    0x00,
    0x00,
  ]);
  await tick();
  if (combinable) {
    device.emitLWP3([7, 0, 0x43, portId, 0x02, 0x0c, 0x00]);
  }
  device.emitLWP3([10, 0, 0x44, portId, 3, 0, 65, 80, 79, 83]);
  device.emitLWP3([10, 0, 0x44, portId, 3, 0x80, 1, dataType, 3, decimals]);
  const range = Buffer.alloc(8);
  range.writeFloatLE(-180, 0);
  range.writeFloatLE(179, 4);
  device.emitLWP3([14, 0, 0x44, portId, 3, 3, ...range]);
  device.emitLWP3([9, 0, 0x44, portId, 3, 4, 68, 69, 71]);
  await tick();
}

async function acknowledgeEssentialApos(state, portId = 0) {
  const { device } = state;
  const port = portId === 0 ? "A" : "B";
  const essential = state.ext._peripheral._essential;
  const motorState = essential._motorPositionModes[port];
  if (!motorState?.modeInfo) await advertiseEssentialApos(state, portId);
  assert.deepEqual(
    device.writes
      .filter((message) => message[2] === 0x41 && message[3] === portId)
      .at(-1),
    [10, 0, 0x41, portId, 3, 15, 0, 0, 0, 1],
    "APOS mode 3 uses a 15-degree notification threshold"
  );
  device.emitLWP3([10, 0, 0x47, portId, 3, 15, 0, 0, 0, 1]);
  await tick();
}

async function acknowledgeEssentialDistance(state, portId = 1, {mode = 0, unit = "cm"} = {}) {
  const {device} = state;
  const port = portId === 0 ? "A" : "B";
  const deviceState = state.ext._peripheral._essential._devices[port];
  if (deviceState?.type !== "distance") {
    throw new Error(`Expected a distance sensor on port ${port}`);
  }
  const name = mode === 0 ? "DISTL" : "DISTS";
  device.emitLWP3([11, 0, 0x44, portId, mode, 0, ...Buffer.from(name)]);
  device.emitLWP3([10, 0, 0x44, portId, mode, 0x80, 1, 1, 4, 1]);
  const range = Buffer.alloc(8);
  range.writeFloatLE(5, 0);
  range.writeFloatLE(mode === 0 ? 200 : 30, 4);
  device.emitLWP3([14, 0, 0x44, portId, mode, 3, ...range]);
  device.emitLWP3([6 + Buffer.byteLength(unit), 0, 0x44, portId, mode, 4, ...Buffer.from(unit)]);
  await tick();
  const delta = 10;
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === mode
  ), `distance input format request for port ${port}`);
  assert.deepEqual(
    device.writes.filter(message => message[2] === 0x41 && message[3] === portId).at(-1),
    [10, 0, 0x41, portId, mode, delta, 0, 0, 0, 1]
  );
  device.emitLWP3([10, 0, 0x47, portId, mode, delta, 0, 0, 0, 1]);
  await tick();
}

function emitEssentialModeMetadata(state, portId, mode, {
  name,
  dataSets = 1,
  dataType = 1,
  decimals = 1,
  symbol = "cm",
  min = 0,
  max = 200,
} = {}) {
  const range = Buffer.alloc(8);
  range.writeFloatLE(min, 0);
  range.writeFloatLE(max, 4);
  const encodedName = Buffer.from(name);
  const encodedSymbol = Buffer.from(symbol);
  state.device.emitLWP3([6 + encodedName.length, 0, 0x44, portId, mode, 0, ...encodedName]);
  state.device.emitLWP3([10, 0, 0x44, portId, mode, 0x80, dataSets, dataType, 4, decimals]);
  state.device.emitLWP3([14, 0, 0x44, portId, mode, 3, ...range]);
  state.device.emitLWP3([6 + encodedSymbol.length, 0, 0x44, portId, mode, 4, ...encodedSymbol]);
}

async function acknowledgeEssentialColorMode(state, portId, mode) {
  const inputModeRequest = state.device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === mode
  ).at(-1);
  assert.ok(inputModeRequest, `mode ${mode} input request was sent on port ${portId}`);
  state.device.emitLWP3([
    10, 0, 0x47, portId, mode,
    inputModeRequest[5], inputModeRequest[6], inputModeRequest[7],
    inputModeRequest[8], inputModeRequest[9],
  ]);
  await tick();
}

function autoAcknowledgeEssentialPositionModes(state) {
  const {device} = state;
  const write = device.rx.writeValueWithoutResponse.bind(device.rx);
  device.rx.writeValueWithoutResponse = async packet => {
    await write(packet);
    const message = device.writes.at(-1);
    if (message[2] === 0x22 && message[4] === 2 && message[5] === 0x80) {
      device.emitLWP3([10, 0, 0x44, message[3], 2, 0x80, 1, 2, 4, 0]);
    } else if (message[2] === 0x41 && (message[4] === 2 || message[4] === 3)) {
      device.emitLWP3([
        10, 0, 0x47, message[3], message[4],
        message[5], message[6], message[7], message[8], message[9]
      ]);
    }
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("the bundled SPIKE source contains no blocking alert calls", () => {
  assert.doesNotMatch(source, /\balert\s*\(/, "SPIKE source is modal");
});

test("transfer message builders match byte vectors from the LEGO upstream serializer", () => {
  const hub = setup().ext._peripheral._spike3;
  const messages = officialTransferVectors.messages;
  const asHex = (bytes) => Buffer.from(bytes).toString("hex");

  assert.equal(
    asHex(hub._buildClearSlotRequest(messages.clear_slot_19.slot)),
    messages.clear_slot_19.hex
  );
  assert.equal(
    asHex(
      hub._buildStartFileUploadRequest(
        messages.start_file_upload_brickwright_py.filename,
        messages.start_file_upload_brickwright_py.slot,
        messages.start_file_upload_brickwright_py.crc32
      )
    ),
    messages.start_file_upload_brickwright_py.hex
  );
  assert.equal(
    asHex(
      hub._buildTransferChunkRequest(
        messages.transfer_chunk.running_crc32,
        Uint8Array.from(messages.transfer_chunk.chunk)
      )
    ),
    messages.transfer_chunk.hex
  );
  assert.equal(
    asHex(
      hub._buildProgramFlowRequest(
        messages.program_flow_start_slot_19.stop,
        messages.program_flow_start_slot_19.slot
      )
    ),
    messages.program_flow_start_slot_19.hex
  );

  const crcVectors = officialTransferVectors.crc32;
  const alignedAbc = hub._crc32(Uint8Array.from(crcVectors.aligned_abc.data));
  assert.equal(
    alignedAbc.toString(16).padStart(8, "0"),
    crcVectors.aligned_abc.hex
  );
  const firstChunk = hub._crc32(Uint8Array.from(crcVectors.chunk_1.data));
  assert.equal(
    firstChunk.toString(16).padStart(8, "0"),
    crcVectors.chunk_1.hex
  );
  const secondChunk = hub._crc32(
    Uint8Array.from(crcVectors.chunk_2.data),
    firstChunk
  );
  assert.equal(
    secondChunk.toString(16).padStart(8, "0"),
    crcVectors.chunk_2.hex
  );
});

function crc32Aligned(data, seed = 0) {
  const bytes = Buffer.from(data);
  const padding = (4 - (bytes.length % 4)) % 4;
  return crc32(Buffer.concat([bytes, Buffer.alloc(padding)]), seed);
}

function attachFakeControllerHub(
  state,
  {
    failChunkIndex = -1,
    motorPorts = [0, 1, 2, 3, 4, 5],
    malformedResponseType = null,
    startNotificationDelayMs = 0,
    stopNotificationDelayMs = 0,
    unattributedStopAfterStartDelayMs = null,
    suppressStartNotification = false,
    suppressStopNotification = false,
    failProgramFlowStop = false,
    disconnectAfterProgramFlowResponse = false,
    startupConsoleError = null,
    helloResponseDelayMs = 0,
    suppressReadyMarker = false,
    ignoreFirstHellos = 0,
    controllerVersion = 3,
    failProgramFlowStart = false,
    failClearSlots = [],
  } = {}
) {
  const { device } = state;
  const slots = new Map([
    [19, Buffer.from("user program, must be confirmed before replacing")],
  ]);
  const controller = {
    slots,
    actions: [],
    receivedCommands: [],
    receivedRequests: [],
    events: [],
    currentUpload: null,
    running: false,
    maxChunkSize: 50,
    chunkIndex: 0,
    failChunkIndex,
    startCount: 0,
    startNotificationDelayMs,
    stopNotificationDelayMs,
    unattributedStopAfterStartDelayMs,
    ignoreCommands: new Set(),
    rejectCommands: new Set(),
    helloCount: 0,
    helloResponseDelayMs,
    controllerVersion,
    suppressStopNotification,
    failProgramFlowStop,
    failProgramFlowStart,
    failClearSlots: new Set(failClearSlots),
    failHello: false,
  };
  const emit = (message) => device.tx.emit(packMessage(message));
  const status = (type, ok) =>
    emit(
      Uint8Array.from([
        type,
        ok ? 0 : 1,
        ...(type === malformedResponseType ? [0xff] : []),
      ])
    );
  const emitTunnel = (response) => {
    const payload = new TextEncoder().encode(JSON.stringify(response) + "\n");
    emit(
      Uint8Array.from([
        0x32,
        payload.length & 0xff,
        payload.length >> 8,
        ...payload,
      ])
    );
  };

  device.protocolHandler = (message) => {
    const messageBytes = Uint8Array.from(message);
    switch (message[0]) {
      case 0x46: {
        assert.equal(
          message.length,
          2,
          "ClearSlotRequest is exactly two bytes"
        );
        const existed = controller.failClearSlots.has(message[1])
          ? false
          : slots.delete(message[1]);
        controller.events.push({
          type: "clear",
          slot: message[1],
          helloCount: controller.helloCount,
          cleared: existed,
        });
        status(0x47, existed);
        break;
      }
      case 0x0c: {
        const terminator = message.indexOf(0, 1);
        assert.notEqual(terminator, -1, "filename is NUL-terminated");
        assert.equal(
          message.length,
          terminator + 6,
          "StartFileUploadRequest ends after the NUL name, slot, and CRC"
        );
        const name = Buffer.from(message.slice(1, terminator)).toString("utf8");
        const slot = message[terminator + 1];
        const expectedCrc = new DataView(
          messageBytes.buffer,
          messageBytes.byteOffset
        ).getUint32(terminator + 2, true);
        controller.currentUpload = {
          name,
          slot,
          expectedCrc,
          chunks: [],
          rollingCrc: 0,
        };
        controller.events.push({
          type: "upload-start",
          slot,
          name,
        });
        controller.chunkIndex = 0;
        status(0x0d, true);
        break;
      }
      case 0x10: {
        const upload = controller.currentUpload;
        if (!upload) {
          status(0x11, false);
          break;
        }
        const view = new DataView(messageBytes.buffer, messageBytes.byteOffset);
        const runningCrc = view.getUint32(1, true);
        const size = view.getUint16(5, true);
        const chunk = Buffer.from(message.slice(7));
        if (controller.chunkIndex === controller.failChunkIndex) {
          status(0x11, false);
          break;
        }
        if (
          message.length !== 7 + size ||
          size > controller.maxChunkSize ||
          size !== chunk.length
        ) {
          status(0x11, false);
          break;
        }
        const computed = crc32Aligned(chunk, upload.rollingCrc);
        if (computed !== runningCrc) {
          status(0x11, false);
          break;
        }
        upload.rollingCrc = runningCrc;
        upload.chunks.push(chunk);
        controller.chunkIndex++;
        controller.events.push({
          type: "chunk-acknowledged",
          offset: upload.chunks
            .slice(0, -1)
            .reduce((size, previous) => size + previous.length, 0),
          length: chunk.length,
        });
        status(0x11, true);
        break;
      }
      case 0x1e: {
        const upload = controller.currentUpload;
        if (
          message.length !== 3 ||
          ![0, 1].includes(message[1]) ||
          message[2] > 19
        ) {
          status(0x1f, false);
          break;
        }
        if (message[1] === 1) {
          controller.events.push({
            type: "stop-request",
            slot: message[2],
          });
          if (!controller.running || controller.failProgramFlowStop) {
            status(0x1f, false);
            break;
          }
          status(0x1f, true);
          controller.running = false;
          if (!suppressStopNotification) {
            const notifyStopped = () => emit(Uint8Array.from([0x20, 1]));
            if (controller.stopNotificationDelayMs > 0) {
              state.clock.setTimeout(
                notifyStopped,
                controller.stopNotificationDelayMs
              );
            } else {
              notifyStopped();
            }
          }
          break;
        }
        controller.events.push({
          type: "start-request",
          slot: message[2],
        });
        if (controller.failProgramFlowStart) {
          status(0x1f, false);
          break;
        }
        const isCurrentUpload = upload && upload.slot === message[2];
        const program = isCurrentUpload
          ? Buffer.concat(upload.chunks)
          : slots.get(message[2]);
        if (
          !program ||
          (isCurrentUpload && crc32Aligned(program) !== upload.expectedCrc)
        ) {
          status(0x1f, false);
          break;
        }
        const sourceText = program.toString("utf8");
        const isControllerProgram = sourceText.includes(
          "BWCTRL:boot:tunnel-callback-registered"
        );
        if (isCurrentUpload) {
          assert.match(sourceText, /hub\.config\["module_tunnel"\]/);
          assert.match(sourceText, /def _receive\(data\)/);
          assert.match(sourceText, /motor\.run_for_degrees/);
          assert.match(sourceText, /light_matrix\.set_pixel/);
          assert.match(sourceText, /sound\.beep/);
          assert.doesNotMatch(sourceText, /\b(?:eval|exec)\s*\(/);
          slots.set(upload.slot, program);
        }
        controller.running = true;
        controller.programSource = sourceText;
        if (isControllerProgram) {
          const version = sourceText.match(/CONTROLLER_VERSION\s*=\s*(\d+)/);
          if (version) controller.controllerVersion = Number(version[1]);
        }
        controller.startCount++;
        status(0x1f, true);
        if (disconnectAfterProgramFlowResponse) {
          device.gatt.disconnect();
          break;
        }
        if (startupConsoleError) {
          const output = new TextEncoder().encode(`${startupConsoleError}\0`);
          emit(Uint8Array.from([0x21, ...output]));
          controller.running = false;
          emit(Uint8Array.from([0x20, 1]));
          break;
        }
        if (!suppressStartNotification) {
          const notifyStarted = () => {
            emit(Uint8Array.from([0x20, 0]));
            if (!suppressReadyMarker && isControllerProgram) {
              emit(
                Uint8Array.from([
                  0x21,
                  ...new TextEncoder().encode(
                    "BWCTRL:boot:tunnel-callback-registered\n"
                  ),
                ])
              );
            }
          };
          if (controller.startNotificationDelayMs > 0) {
            state.clock.setTimeout(
              notifyStarted,
              controller.startNotificationDelayMs
            );
          } else {
            notifyStarted();
          }
        }
        if (controller.unattributedStopAfterStartDelayMs !== null) {
          state.clock.setTimeout(
            () => emit(Uint8Array.from([0x20, 1])),
            controller.unattributedStopAfterStartDelayMs
          );
        }
        break;
      }
      case 0x32: {
        const length = message[1] | (message[2] << 8);
        const request = JSON.parse(
          Buffer.from(message.slice(3)).toString("utf8")
        );
        assert.equal(length, Buffer.byteLength(JSON.stringify(request)));
        const names = {
          h: "controller.hello",
          p: "controller.ping",
          x: "controller.stop_all",
          r: "motor.run",
          s: "motor.stop",
          u: "motor.power",
          d: "motor.run_degrees",
          t: "motor.run_time",
          a: "motor.run_to_position",
          J: "motor.run_relative_target",
          U: "motion.set_yaw_face",
          l: "matrix.pixel",
          m: "matrix.pattern",
          w: "matrix.text",
          c: "matrix.clear",
          b: "sound.beep",
          q: "sound.stop",
          Z: "motor_pair.stop",
        };
        const fieldNames = {
          p: "port",
          v: "velocity",
          d: "degrees",
          t: "duration_ms",
          g: "position",
          u: "power",
          x: "x",
          y: "y",
          b: "brightness",
          z: "pixels",
          f: "frequency",
          n: "stop_mode",
          h: "path",
          A: "acceleration",
          B: "deceleration",
          H: "face",
        };
        const action = { cmd: names[request.c] };
        controller.receivedCommands.push(action.cmd);
        controller.receivedRequests.push({...request});
        for (const [key, value] of Object.entries(request)) {
          if (key in fieldNames) action[fieldNames[key]] = value;
        }
        if (!controller.running) {
          emitTunnel({
            i: request.i,
            ok: false,
            error: "not_running",
            detail: "controller is not running",
          });
          break;
        }
        if (request.c === "p") {
          emitTunnel({ c: "o", version: controller.controllerVersion });
          break;
        }
        if (request.c === "h") {
          controller.helloCount++;
          controller.events.push({
            type: "controller-hello",
            count: controller.helloCount,
          });
          if (controller.failHello) {
            emitTunnel({
              i: request.i,
              ok: false,
              error: "execution_failed",
              detail: "simulated hello failure",
            });
            break;
          }
          if (controller.helloCount <= ignoreFirstHellos) break;
          const acknowledge = () =>
            emitTunnel({
              i: request.i,
              ok: true,
              result: `bw-spike-${controller.controllerVersion}`,
            });
          if (helloResponseDelayMs > 0) {
            state.clock.setTimeout(acknowledge, helloResponseDelayMs);
          } else {
            acknowledge();
          }
          break;
        }
        if (!action.cmd) {
          emitTunnel({
            i: request.i,
            ok: false,
            error: "unsupported",
            detail: `unsupported command ${request.c}`,
          });
          break;
        }
        if (controller.ignoreCommands.has(action.cmd)) break;
        if (controller.rejectCommands.has(action.cmd)) {
          emitTunnel({
            i: request.i,
            ok: false,
            error: "execution_failed",
            detail: "simulated motor API failure",
          });
          break;
        }
        controller.actions.push(action);
        emitTunnel({ i: request.i, ok: true });
        break;
      }
      default:
        break;
    }
  };
  for (const port of motorPorts) {
    emit(notification(motorRecord({ port })));
  }
  return controller;
}

function attachFakeStartupProbeHub(
  state,
  {
    failChunkIndex = -1,
    emitStartNotification = true,
    emitStopNotification = true,
    stopImmediatelyAfterStart = false,
    consoleOutput = "",
    emitProbeMarkers = false,
    naturalCompletion = false,
  } = {}
) {
  const { device } = state;
  const slots = new Map([[7, Buffer.from("existing program in slot 7")]]);
  const fake = {
    slots,
    upload: null,
    running: false,
    programSource: null,
    chunkIndex: 0,
    flowStarts: 0,
    flowStops: 0,
  };
  const emit = (message) => device.tx.emit(packMessage(message));
  const status = (type, ok) => emit(Uint8Array.from([type, ok ? 0 : 1]));
  device.protocolHandler = (message) => {
    const messageBytes = Uint8Array.from(message);
    switch (message[0]) {
      case 0x46:
        status(0x47, slots.delete(message[1]));
        break;
      case 0x0c: {
        const terminator = message.indexOf(0, 1);
        assert.notEqual(terminator, -1);
        const view = new DataView(messageBytes.buffer);
        fake.upload = {
          fileName: Buffer.from(message.slice(1, terminator)).toString("utf8"),
          slot: message[terminator + 1],
          expectedCrc: view.getUint32(terminator + 2, true),
          chunks: [],
          runningCrc: 0,
        };
        fake.chunkIndex = 0;
        status(0x0d, true);
        break;
      }
      case 0x10: {
        const upload = fake.upload;
        const view = new DataView(messageBytes.buffer);
        const runningCrc = view.getUint32(1, true);
        const length = view.getUint16(5, true);
        const chunk = Buffer.from(message.slice(7));
        if (
          !upload ||
          fake.chunkIndex === failChunkIndex ||
          length !== chunk.length ||
          crc32Aligned(chunk, upload.runningCrc) !== runningCrc
        ) {
          status(0x11, false);
          break;
        }
        upload.runningCrc = runningCrc;
        upload.chunks.push(chunk);
        fake.chunkIndex++;
        status(0x11, true);
        break;
      }
      case 0x1e: {
        const isStop = message[1] === 1;
        if (message.length !== 3 || !fake.upload) {
          status(0x1f, false);
          break;
        }
        if (isStop) {
          fake.flowStops++;
          fake.running = false;
          status(0x1f, true);
          if (emitStopNotification) emit(Uint8Array.from([0x20, 1]));
          break;
        }
        fake.flowStarts++;
        const program = Buffer.concat(fake.upload.chunks);
        if (
          message[2] !== fake.upload.slot ||
          crc32Aligned(program) !== fake.upload.expectedCrc
        ) {
          status(0x1f, false);
          break;
        }
        fake.slots.set(fake.upload.slot, program);
        fake.running = true;
        fake.programSource = program.toString("utf8");
        status(0x1f, true);
        const emitConsole = (text) => {
          emit(
            Uint8Array.from([0x21, ...new TextEncoder().encode(`${text}\0`)])
          );
        };
        if (consoleOutput) {
          emitConsole(consoleOutput);
        }
        const runId = fake.programSource.match(
          /BWPROBE00:(\d+):TOP_LEVEL/
        )?.[1];
        const emitProbeStage = (stage) =>
          emitConsole(`BWPROBE00:${runId}:${stage}`);
        if (emitProbeMarkers && runId) {
          emitProbeStage("TOP_LEVEL");
          emitProbeStage("RUNLOOP_IMPORTED");
          emitProbeStage("MAIN_STARTED");
        }
        if (emitStartNotification) emit(Uint8Array.from([0x20, 0]));
        if (naturalCompletion && emitProbeMarkers && runId) {
          state.clock.setTimeout(() => {
            emitProbeStage("SLEEP_COMPLETED");
            emitProbeStage("MAIN_COMPLETED");
            fake.running = false;
            if (emitStopNotification) emit(Uint8Array.from([0x20, 1]));
          }, 2000);
        } else if (stopImmediatelyAfterStart) {
          fake.running = false;
          emit(Uint8Array.from([0x20, 1]));
        }
        break;
      }
      default:
        break;
    }
  };
  // connect() sends the ordinary sensor-notification request before this
  // command interpreter is installed. Complete that pending fake response so
  // the probe tests do not accidentally advance its timeout while observing.
  device.tx.emit(packMessage(Uint8Array.from([0x29, 0])));
  // The fake hub also emits the valid sensor stream expected after accepting
  // the subscription, so the bounded no-telemetry recovery stays out of the
  // independent program-transfer lifecycle test.
  emit(notification(imuRecord()));
  return fake;
}

test("Web Bluetooth requests notifications and records the hub acknowledgement", async () => {
  const state = setup();
  await connect(state);
  assert.equal(state.ext.getConnectionMode(), "web-ble");
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).notificationRequest
      .status,
    "pending"
  );
  const acknowledgedRequest =
    state.ext._peripheral._spike3.setDeviceNotifications(true);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.doesNotReject(acknowledgedRequest);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "acknowledged");
  assert.equal(diagnostics.notificationRequest.responseCode, 0);
  assert.equal(diagnostics.notificationRequest.requestMessageHex, "286400");
  assert.equal(diagnostics.notificationRequest.responseMessageHex, "2900");
  assert.equal(
    diagnostics.notificationTelemetry.validNotificationCount,
    0,
    "a 0x29 acknowledgement is not evidence of a 0x3c sensor sample"
  );
  assert.equal(diagnostics.notificationTelemetry.status, "not-received");
  const acknowledgedAt = diagnostics.notificationRequest.responseAt;
  state.device.tx.emit(packMessage([0x29, 0x00]));
  const afterDuplicate = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(afterDuplicate.notificationRequest.status, "acknowledged");
  assert.equal(afterDuplicate.notificationRequest.responseAt, acknowledgedAt);
  assert.equal(afterDuplicate.lateNotificationResponseCount, 1);

  const rejectedRequest =
    state.ext._peripheral._spike3.setDeviceNotifications(true);
  await tick();
  state.device.tx.emit(packMessage([0x29, 0x01]));
  await assert.rejects(rejectedRequest, /did not acknowledge/);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).notificationRequest
      .status,
    "not-acknowledged"
  );
});

test("IMU values decode signed angles and distinguish received zero from no data", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  let diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.imuNotificationCount, 0);
  assert.equal(diagnostics.lastImuReceivedAt, null);

  state.device.tx.emit(packMessage(notification(imuRecord())));
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.imuNotificationCount, 1);
  assert.ok(diagnostics.lastImuReceivedAt > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(hub.angle)), {
    pitch: 0,
    roll: 0,
    yaw: 0,
  });

  state.device.tx.emit(
    packMessage(notification(imuRecord({ yaw: -123, pitch: 45, roll: -6 })))
  );
  assert.deepEqual(JSON.parse(JSON.stringify(hub.angle)), {
    pitch: 4.5,
    roll: -0.6,
    yaw: -12.3,
  });
});

test("Prime IMU decodes signed acceleration and gyro values on all three axes", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(
    packMessage(
      notification(
        imuRecord({
          accelerationX: -1001,
          accelerationY: 202,
          accelerationZ: -303,
          gyroX: -404,
          gyroY: 505,
          gyroZ: -606,
        })
      )
    )
  );
  const hub = state.ext._peripheral._spike3;
  assert.deepEqual(JSON.parse(JSON.stringify(hub.acceleration)), {
    x: -1001,
    y: 202,
    z: -303,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(hub.gyro)), {
    x: -40.4,
    y: 50.5,
    z: -60.6,
  });
});

test("motor position and 5x5 matrix records are parsed from one notification", async () => {
  const state = setup();
  await connect(state);
  const pixels = Uint8Array.from({ length: 25 }, (_, index) => index);
  state.device.tx.emit(
    packMessage(notification(bytes(motorRecord(), [0x02], pixels)))
  );
  const hub = state.ext._peripheral._spike3;
  assert.equal(hub.portValues.A.position, 323);
  assert.equal(hub.portValues.A.absolutePosition, -37);
  assert.equal(hub.portValues.A.relativePosition, -123456);
  assert.equal(hub.portValues.A.degreesCounted, -123456);
  assert.equal(hub.portValues.A.power, -500);
  assert.equal(hub.portValues.A.speed, -12);
  assert.equal(hub.portValues.A.speedDerived, false);
  assert.equal(hub.portValues.A.speedUnit, "percent-of-max");
  assert.equal(hub._sensors.motorPositions.A.speedDerived, false);
  assert.equal(state.ext.getPosition({ PORT: "A" }), 323);
  assert.equal(state.ext.getRelativePosition({ PORT: "A" }), -123456);
  assert.equal(state.ext.getAbsolutePosition({ PORT: "A" }), -37);
  assert.equal(state.ext.getSpeed({ PORT: "A" }), -126);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.motorNotificationCount, 1);
  assert.equal(diagnostics.matrix5x5NotificationCount, 1);
  assert.deepEqual(diagnostics.lastMatrix5x5, Array.from(pixels));
});

test("Prime getPosition uses signed APOS while speed remains a hub percentage", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(packMessage(notification(motorRecord())));
  const motor = state.ext._peripheral.portValues.A;
  assert.equal(motor.absolutePosition, -37);
  assert.equal(motor.relativePosition, -123456);
  assert.equal(state.ext.getPosition({ PORT: "A" }), 323);
  assert.equal(state.ext.getRelativePosition({ PORT: "A" }), -123456);
  assert.equal(state.ext.getSpeed({ PORT: "A" }), -126);
});

test("Prime SPIKE reporters preserve measured zero, units, and sensor freshness", async () => {
  const state = setup();
  await connect(state);
  const ext = state.ext;
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), "");
  assert.equal(ext.getDistanceIn({PORT: "B", UNIT: "cm"}), "");
  assert.equal(ext.getForce({PORT: "C", UNIT: "N"}), "");
  assert.equal(ext.getMotorPower({PORT: "D"}), "");
  assert.equal(ext.getAngle({AXIS: "yaw"}), "");
  const color = Uint8Array.from([
    0x0c, 0, 0, 0, 2, 0xff, 3, 0, 0,
  ]);
  const distance = Uint8Array.from([0x0d, 1, 0xe8, 0x03]); // 1000 mm
  const force = Uint8Array.from([0x0b, 2, 50, 1]);
  const motor = motorRecord({port: 3, absolute: 0, power: 5000, speed: 0, position: 0});
  state.device.tx.emit(packMessage(notification(bytes(
    imuRecord({accelerationZ: -303}), color, distance, force, motor
  ))));
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), 128);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "green"}), 255);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "blue"}), 0);
  assert.equal(ext.getDistanceIn({PORT: "B", UNIT: "cm"}), 100);
  assert.equal(ext.getDistanceIn({PORT: "B", UNIT: "%"}), 50);
  assert.ok(Math.abs(ext.getDistanceIn({PORT: "B", UNIT: "in"}) - 100 / 2.54) < 1e-9);
  assert.equal(ext.isDistanceCompared({PORT: "B", UNIT: "%", DISTANCE: 60, RELATION: "near"}), true);
  assert.equal(ext.isDistanceCompared({PORT: "B", UNIT: "%", DISTANCE: 40, RELATION: "far"}), true);
  assert.equal(ext.getForce({PORT: "C", UNIT: "%"}), 50);
  assert.equal(ext.getForce({PORT: "C", UNIT: "N"}), 5);
  assert.equal(ext.isForceSensorPressed({PORT: "C", STATE: "pressed"}), true);
  assert.equal(ext.isForceSensorPressed({PORT: "C", STATE: "released"}), false);
  assert.equal(ext.getMotorPower({PORT: "D"}), 50);
  assert.equal(ext.getAcceleration({AXIS: "z"}), -303);
  assert.equal(ext.getAngle({AXIS: "yaw"}), 0, "a measured zero angle is not missing data");
  assert.equal(ext.getOrientation(), "top");

  state.device.tx.emit(packMessage(notification(Uint8Array.from([0x0d, 1, 0, 0]))));
  state.device.tx.emit(packMessage(notification(Uint8Array.from([0x0b, 2, 0, 0]))));
  assert.equal(ext.getDistanceIn({PORT: "B", UNIT: "%"}), 0);
  assert.equal(ext.isDistanceCompared({PORT: "B", UNIT: "%", DISTANCE: 1, RELATION: "near"}), true);
  assert.equal(ext.getForce({PORT: "C", UNIT: "N"}), 0);
  assert.equal(ext.isForceSensorPressed({PORT: "C", STATE: "released"}), true);
  assert.equal(ext.isForceSensorPressed({PORT: "C", STATE: "pressed"}), false);

  state.ext._peripheral._spike3._diagnostics.lastImuReceivedAt = Date.now() - 3000;
  state.ext._peripheral.portValues.B.receivedAt = Date.now() - 3000;
  state.ext._peripheral.portValues.C.receivedAt = Date.now() - 3000;
  state.ext._peripheral.portValues.A.receivedAt = Date.now() - 3000;
  state.ext._peripheral.portValues.D.receivedAt = Date.now() - 3000;
  assert.equal(ext.getAcceleration({AXIS: "z"}), "");
  assert.equal(ext.getAngle({AXIS: "yaw"}), "");
  assert.equal(ext.getOrientation(), "");
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), "");
  assert.equal(ext.getDistanceIn({PORT: "B", UNIT: "cm"}), "");
  assert.equal(ext.isDistanceCompared({PORT: "B", UNIT: "cm", DISTANCE: 150, RELATION: "near"}), false);
  assert.equal(ext.getForce({PORT: "C", UNIT: "%"}), "");
  assert.equal(ext.isForceSensorPressed({PORT: "C", STATE: "released"}), false);
  assert.equal(ext.getMotorPower({PORT: "D"}), "");
});

test("Prime hub sensors use the active 150 ms and idle 500 ms freshness limits", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(packMessage(notification(imuRecord({yaw: 123}))));
  const {ext} = state;
  const hub = ext._peripheral._spike3;
  hub._diagnostics.lastImuReceivedAt = Date.now() - 200;
  assert.equal(ext.getAngle({AXIS: "yaw"}), "", "a reading older than 150 ms is not used after activation");
  assert.equal(ext._peripheral.isSensorDemandActive("HUB"), true);
  hub._diagnostics.lastImuReceivedAt = Date.now() - 120;
  assert.equal(ext.getAngle({AXIS: "yaw"}), 12.3);
  ext._peripheral.setSensorDemand("HUB", false);
  hub._diagnostics.lastImuReceivedAt = Date.now() - 400;
  assert.equal(ext._hasFreshSensorTimestamp(hub._diagnostics.lastImuReceivedAt, "HUB"), true,
    "idle monitoring retains samples up to 500 ms");
  hub._diagnostics.lastImuReceivedAt = Date.now() - 501;
  assert.equal(ext.getAngle({AXIS: "yaw"}), "", "a sample older than 500 ms is stale while idle");
});

test("truncated motor records are rejected without replacing the last angle", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  state.device.tx.emit(packMessage(notification(motorRecord())));
  const before = { ...hub.portValues.A };
  const truncated = motorRecord().slice(0, 11);
  state.device.tx.emit(packMessage(notification(truncated)));
  assert.deepEqual({ ...hub.portValues.A }, before);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.malformedNotificationCount, 1);
  assert.match(diagnostics.lastCommunicationError, /truncated motor record/);
});

test("localized diagnostic summary distinguishes missing IMU data and lists motor positions", async () => {
  const state = setup({ locale: "ja" });
  await connect(state);
  const pending = state.ext.getCommunicationDiagnosticsSummary();
  assert.match(pending, /Bluetooth 接続: 接続中/);
  assert.match(pending, /Hub OS バージョン: 1\.6\.62/);
  assert.match(pending, /IMU通知件数: 0/);
  assert.match(pending, /角度: 未受信/);

  state.device.tx.emit(packMessage([0x29, 0x00]));
  state.device.tx.emit(
    packMessage(notification(imuRecord({ yaw: -9, pitch: 12, roll: -3 })))
  );
  state.device.tx.emit(packMessage(notification(motorRecord())));
  const received = state.ext.getCommunicationDiagnosticsSummary();
  assert.match(received, /Pitch 1\.2°/);
  assert.match(received, /Roll -0\.3°/);
  assert.match(received, /Yaw -0\.9°/);
  assert.match(received, /A: 相対位置 -123456°, 絶対位置 -37°/);
  assert.match(received, /速度値 -12/);
});

test("Japanese communication diagnostics summarize errors and retain raw details", async () => {
  const state = setup({ locale: "ja" });
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const cases = [
    [
      "device notification response timed out",
      /センサー通知要求に対するハブの応答が時間内にありませんでした/,
    ],
    [
      "COBS decode failed: truncated COBS block",
      /Bluetoothフレームを解析できませんでした/,
    ],
    ["unsupported device record: 0x7f", /未対応の通知レコード（0x7f）/],
    [
      "DeviceNotification payload size mismatch: expected 4, received 2",
      /申告値 4 バイト、受信値 2 バイト/,
    ],
  ];
  const summaries = [];
  for (const [rawError, expectedSummary] of cases) {
    hub._recordCommunicationError(rawError);
    const summary = state.ext.getCommunicationDiagnosticsSummary();
    const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
    assert.match(summary, expectedSummary);
    assert.ok(summary.includes(`技術詳細: ${rawError}`));
    assert.equal(diagnostics.lastCommunicationError, rawError);
    summaries.push(summary);
  }
  assert.equal(new Set(summaries).size, cases.length);
});

test("split COBS frames and multiple frames in one BLE notification are reassembled", async () => {
  const state = setup();
  await connect(state);
  const frame = packMessage(
    notification(imuRecord({ yaw: 12, pitch: 34, roll: 56 }))
  );
  state.device.tx.emit(frame.slice(0, 4));
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).imuNotificationCount,
    0
  );
  state.device.tx.emit(frame.slice(4));
  const second = packMessage(
    notification(imuRecord({ yaw: 78, pitch: 90, roll: 12 }))
  );
  const third = packMessage([0x21, 0x4f, 0x4b]);
  // BLE protocol fields carry tenths of a degree in this extension's public
  // block values. The protocol document does not state units, so the source
  // parser conversion is pinned here as a regression expectation only.
  state.device.tx.emit(bytes(second, third));
  const hub = state.ext._peripheral._spike3;
  assert.deepEqual(JSON.parse(JSON.stringify(hub.angle)), {
    pitch: 9,
    roll: 1.2,
    yaw: 7.8,
  });
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).imuNotificationCount,
    2
  );
  assert.equal(hub.replOutput, "OK");
});

test("broken frames, malformed sizes, and unknown records are diagnosed and recovery continues", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(Uint8Array.from([0x03, 0x02])); // Unescaped control byte.
  state.device.tx.emit(Uint8Array.from([0x00, 0x02])); // Decodes to an empty message.
  state.device.tx.emit(packMessage([0x3c, 0x02, 0x00, 0x01])); // Declares 2 bytes, has 1.
  state.device.tx.emit(
    packMessage(notification(Uint8Array.from([0x7f, 0xaa])))
  );
  state.device.tx.emit(packMessage(notification(imuRecord({ yaw: 8 }))));
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.cobsDecodeFailureCount, 1);
  assert.equal(diagnostics.malformedMessageCount, 1);
  assert.equal(diagnostics.malformedNotificationCount, 1);
  assert.equal(diagnostics.unsupportedRecordCount, 1);
  assert.equal(diagnostics.imuNotificationCount, 1);
  assert.match(
    diagnostics.lastCommunicationError,
    /unsupported device record/i
  );
});

test("a missing notification acknowledgement gets at most one read-only recovery attempt", async () => {
  const state = setup();
  await connect(state);
  const request = state.ext._peripheral._spike3.setDeviceNotifications(true);
  await tick();
  const writesAfterRequest = state.device.writes.length;
  state.clock.advance(2001);
  await assert.rejects(request, /device notification response timed out/);
  let diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "timeout");
  assert.equal(diagnostics.notificationTelemetry.validNotificationCount, 0);
  assert.equal(state.ext.isConnected(), true);
  assert.equal(diagnostics.disconnectCount, 0);
  assert.equal(
    diagnostics.notificationRecovery.status,
    "waiting-for-late-response"
  );
  assert.equal(state.device.writes.length, writesAfterRequest);

  state.clock.advance(500);
  await tick();
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(
    diagnostics.notificationRecovery.status,
    "retrying-read-only-subscription"
  );
  assert.equal(diagnostics.notificationRecovery.attempts, 1);
  const requests = unpackWrittenMessages(state.device.writes).filter(
    ([type]) => type === 0x28
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], [0x28, 100, 0]);
  assert.deepEqual(requests[1], [0x28, 100, 0]);
  assert.equal(
    unpackWrittenMessages(state.device.writes).some(([type]) =>
      [0x1e, 0x32, 0x46, 0x0c, 0x10].includes(type)
    ),
    false,
    "recovery is read-only and does not start a program or controller"
  );

  state.clock.advance(2001);
  await tick();
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "timeout");
  assert.equal(diagnostics.notificationRecovery.status, "retry-limit-reached");
  assert.equal(diagnostics.notificationRecovery.attempts, 1);
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28)
      .length,
    2,
    "the retry limit prevents an unbounded request loop"
  );
});

test("a delayed acknowledgement is retained without a duplicate subscription request", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const pending = hub._pendingNotificationRequest.promise;
  state.clock.advance(1999);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.doesNotReject(pending);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "acknowledged");
  assert.equal(
    diagnostics.notificationRequest.responseAttribution,
    "active-request"
  );
  state.clock.advance(600);
  await tick();
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28)
      .length,
    1
  );
});

test("an acknowledged subscription without telemetry gets one bounded read-only retry", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const initialRequest = hub._pendingNotificationRequest.promise;
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.doesNotReject(initialRequest);

  let diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "acknowledged");
  assert.equal(diagnostics.notificationTelemetry.validNotificationCount, 0);
  assert.equal(diagnostics.notificationRecovery.status, "waiting-for-telemetry");
  state.clock.advance(1999);
  await tick();
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28).length,
    1,
    "the recovery waits for telemetry before retrying"
  );

  state.clock.advance(1);
  await tick();
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRecovery.status, "retrying-read-only-subscription");
  assert.equal(diagnostics.notificationRecovery.attempts, 1);
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28).length,
    2
  );
  assert.equal(
    unpackWrittenMessages(state.device.writes).some(([type]) =>
      [0x1e, 0x32, 0x46, 0x0c, 0x10].includes(type)
    ),
    false,
    "the recovery does not start or control a program"
  );

  const retryRequest = hub._pendingNotificationRequest.promise;
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.doesNotReject(retryRequest);
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRecovery.status, "retry-acknowledged-without-telemetry");
  state.clock.advance(10000);
  await tick();
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28).length,
    2,
    "no further retry loop is scheduled"
  );
});

test("valid telemetry after an acknowledgement suppresses the no-telemetry retry", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const initialRequest = hub._pendingNotificationRequest.promise;
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.doesNotReject(initialRequest);
  state.clock.advance(1999);
  state.device.tx.emit(packMessage(notification(imuRecord({ pitch: 12 }))));
  state.clock.advance(10000);
  await tick();

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationTelemetry.validNotificationCount, 1);
  assert.equal(diagnostics.notificationRecovery.status, "suppressed-telemetry-received");
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28).length,
    1
  );
});

test("a late acknowledgement does not falsely acknowledge a changed subscription intent", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const pending = hub._pendingNotificationRequest.promise;
  state.clock.advance(2001);
  await assert.rejects(pending, /device notification response timed out/);
  const manualDisable = hub.setDeviceNotifications(false);
  await tick();
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28)
      .length,
    2,
    "the caller's changed subscription intent is still sent"
  );
  assert.deepEqual(
    unpackWrittenMessages(state.device.writes).filter(
      ([type]) => type === 0x28
    )[1],
    [0x28, 0, 0]
  );
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await assert.rejects(
    manualDisable,
    /may belong to a previous timed-out request/
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "ambiguous-response");
  assert.equal(diagnostics.notificationRequest.responseCode, 0);
  assert.equal(
    diagnostics.notificationRequest.responseAttribution,
    "uncorrelated-after-previous-timeout"
  );
  assert.equal(diagnostics.lastLateNotificationResponse.responseCode, 0);
  assert.equal(diagnostics.lateNotificationResponseCount, 1);
  assert.equal(
    diagnostics.notificationRecovery.status,
    "cancelled-by-new-subscription-request"
  );
  state.clock.advance(600);
  await tick();
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28)
      .length,
    2
  );
});

test("valid telemetry without an acknowledgement is not conflated and suppresses recovery", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const pending = hub._pendingNotificationRequest.promise;
  state.device.tx.emit(packMessage(notification(imuRecord({ pitch: 1 }))));
  let diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationTelemetry.status, "received");
  assert.equal(diagnostics.notificationTelemetry.validNotificationCount, 1);
  assert.equal(diagnostics.notificationRequest.status, "pending");
  state.clock.advance(2001);
  await assert.rejects(pending, /device notification response timed out/);
  state.clock.advance(500);
  await tick();
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "timeout");
  assert.equal(
    diagnostics.notificationRecovery.status,
    "suppressed-telemetry-received"
  );
  assert.equal(
    unpackWrittenMessages(state.device.writes).filter(([type]) => type === 0x28)
      .length,
    1
  );
  assert.equal(hub.angle.pitch, 0.1);
});

test("connection monitoring sends no tunnel or program-flow commands", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  state.device.tx.emit(packMessage(notification(imuRecord())));
  const sentTypes = unpackWrittenMessages(state.device.writes).map(
    ([type]) => type
  );
  assert.deepEqual(sentTypes, [0x00, 0x28]);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerStatus, "not-installed");
  assert.equal(diagnostics.notificationTelemetry.validNotificationCount, 1);
});

test("control-center connection auto-prepares slot 0 before output and preserves telemetry", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  state.ext.disconnectHub();
  state.device.autoInfoResponse = true;
  const beforeConnect = state.device.writes.length;
  const connectedState =
    await state.runtime.brickwrightSpikePrimeControl.connect();
  assert.equal(connectedState.controllerReady, true);
  assert.equal(connectedState.controllerSlot, 0);
  assert.equal(fakeHub.startCount, 1);
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(fakeHub.running, true);
  const connectionMessages = unpackWrittenMessages(
    state.device.writes.slice(beforeConnect)
  );
  assert.ok(
    connectionMessages.some(([type, slot]) => type === 0x46 && slot === 0)
  );
  assert.ok(connectionMessages.some(([type]) => type === 0x1e));
  assert.ok(connectionMessages.some(([type]) => type === 0x32));

  state.device.tx.emit(packMessage(notification(imuRecord({ pitch: 800 }))));
  assert.equal(hub.angle.pitch, 80);
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));
  const startsBeforeOutput = fakeHub.startCount;
  const writesBeforeOutput = state.device.writes.length;
  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  assert.equal(fakeHub.startCount, startsBeforeOutput);
  assert.equal(fakeHub.helloCount, 1);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerSlot,
    0
  );
  assert.equal(state.ext.isConnected(), true);

  const outputMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeOutput)
  );
  assert.ok(outputMessages.some(([type]) => type === 0x32));
  assert.equal(
    outputMessages.some(([type]) => type === 0x1e),
    false
  );
});

test("an unrelated ProgramFlow start does not authorize hello; a fragmented current-session marker does", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  fakeHub.running = true;
  state.device.tx.emit(packMessage([0x20, 0]));
  const writesBeforeVerify = state.device.writes.length;

  await assert.rejects(
    state.runtime.brickwrightSpikePrimeControl.verifyController(),
    /hub remains connected|ハブの接続は維持されています/i
  );
  assert.equal(state.device.writes.length, writesBeforeVerify);
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "not-verified",
    "an unrelated ProgramFlow start does not label a controller as starting or ready"
  );

  emitControllerBootMarker(state, "BWCTRL:boot:tunnel-callback-");
  emitControllerBootMarker(state, "registered\n");
  await state.runtime.brickwrightSpikePrimeControl.verifyController();
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastWrite
      .controllerCommand,
    "controller.hello"
  );
  state.device.tx.emit(packMessage([0x20, 1]));
  emitControllerBootMarker(state);
  const writesAfterStop = state.device.writes.length;
  await assert.rejects(
    state.runtime.brickwrightSpikePrimeControl.verifyController(),
    /hub remains connected|ハブの接続は維持されています/i
  );
  assert.equal(state.device.writes.length, writesAfterStop);
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerBootEvidence
      .status,
    "not-observed"
  );
});

test("a delayed hello response is discarded when ProgramFlow invalidates its boot evidence", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, { helloResponseDelayMs: 500 });
  fakeHub.running = true;
  emitControllerBootMarker(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;

  const verify = state.runtime.brickwrightSpikePrimeControl.verifyController();
  await waitUntil(() => fakeHub.helloCount === 1, "hello request sent");
  state.device.tx.emit(packMessage([0x20, 1]));
  await assert.rejects(
    verify,
    /hub remains connected|ハブの接続は維持されています/i
  );
  state.clock.advance(500);
  await tick();

  assert.equal(hub._controllerReady, false);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "not-verified"
  );
  assert.equal(fakeHub.helloCount, 1);
});

test("SPIKE 3.x auto-installs its fixed controller slot before output", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  const writesBefore = state.device.writes.length;
  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  const commandMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBefore)
  );
  assert.ok(
    commandMessages.some(([type, slot]) => type === 0x46 && slot === 0)
  );
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(fakeHub.startCount, 1);
  assert.equal(fakeHub.receivedCommands.includes("controller.hello"), true);
  assert.equal(
    commandMessages.some(([type, slot]) => type === 0x46 && slot !== 0),
    false,
    "the command only replaces the fixed internal slot"
  );
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    true,
    "motor output follows a verified hello"
  );
});

test("GATT disconnect clears the partial frame but preserves its diagnostic history", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(
    packMessage(notification(imuRecord({ pitch: 10 }))).slice(0, 5)
  );
  state.device.gatt.disconnect();
  assert.equal(state.ext.isConnected(), false);
  await state.ext._peripheral.scan();
  await tick();
  const latest = state.device.tx;
  latest.emit(packMessage(infoResponse()));
  await tick();
  latest.emit(packMessage(notification(imuRecord({ pitch: 20 }))));
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.imuNotificationCount, 1);
  assert.equal(diagnostics.disconnectCount, 1);
  assert.equal(diagnostics.lastDisconnect.origin, "gattserverdisconnected");
  assert.equal(diagnostics.lastFirmwareVersion, "1.6.62");
  assert.ok(
    diagnostics.recentEvents.some(
      (event) =>
        event.type === "disconnect" && event.origin === "gattserverdisconnected"
    )
  );
  // BLE reports decidegrees; the extension's sensor API exposes degrees.
  assert.equal(state.ext._peripheral._spike3.angle.pitch, 2);
});

test("old notification callbacks and request timers cannot affect a reconnected Prime session", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  state.device.tx.emit(packMessage([0x29, 0x00]));
  const oldLink = hub._link;
  const oldReceiver = hub._link._characteristicDidChangeCallback;
  const oldRequest = hub.setDeviceNotifications(true);
  await tick();
  state.device.gatt.disconnect();
  await assert.rejects(oldRequest, /disconnected while awaiting/);
  assert.equal(hub._connectionSession > 0, true);

  await state.ext._peripheral.scan();
  await tick();
  const newSessionId = hub._connectionSession;
  assert.ok(newSessionId > 1);
  state.ext._peripheral._handleWebBLEReset(oldLink, {
    origin: "stale-test-callback",
  });
  assert.equal(
    state.ext.isConnected(),
    true,
    "a prior link's delayed reset cannot clear the new active connection"
  );
  state.clock.advance(1000);
  await tick();
  const diagnosticsBeforeStaleFrame = JSON.parse(
    state.ext.getCommunicationDiagnostics()
  );
  assert.equal(
    diagnosticsBeforeStaleFrame.notificationRequest.status,
    "pending"
  );
  oldReceiver(Buffer.from(packMessage([0x29, 0x00])).toString("base64"));
  let diagnosticsAfterStaleFrame = JSON.parse(
    state.ext.getCommunicationDiagnostics()
  );
  assert.equal(
    diagnosticsAfterStaleFrame.notificationRequest.status,
    "pending",
    "a prior link's 0x29 frame is ignored"
  );
  state.clock.advance(1000);
  diagnosticsAfterStaleFrame = JSON.parse(
    state.ext.getCommunicationDiagnostics()
  );
  assert.equal(
    diagnosticsAfterStaleFrame.recentEvents.some(
      (event) => event.type === "device-notification-response-timeout"
    ),
    false,
    "the previous session's timeout does not fire into the new session"
  );
});

test("a requested local disconnect is recorded separately from a GATT disconnect event", async () => {
  const state = setup();
  await connect(state);
  state.ext._peripheral._spike3.disconnect();

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastDisconnect.origin, "user-requested");
  assert.equal(diagnostics.lastDisconnect.requested, true);
  assert.equal(diagnostics.disconnectCount, 1);
  assert.equal(
    diagnostics.recentEvents.some(
      (event) => event.origin === "gattserverdisconnected"
    ),
    false
  );
});

test("a fake-device write failure is surfaced in diagnostics", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await tick();
  state.device.rx.failNextWrite = true;
  await assert.rejects(
    state.ext._peripheral._spike3.setDeviceNotifications(true),
    /simulated fake-device write failure/
  );
  assert.equal(state.ext.isConnected(), false);
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.notificationRequest.status, "write-error");
  assert.match(
    diagnostics.lastCommunicationError,
    /simulated fake-device write failure/
  );
  assert.equal(diagnostics.lastDisconnect.origin, "ble-write-exception");
  assert.equal(
    diagnostics.recentEvents.filter((event) => event.type === "transport-error")
      .length,
    1,
    "the write callback and rejected command must not log the same transport error twice"
  );
  assert.equal(diagnostics.lastTransportError.messageType, 0x28);
  assert.equal(
    diagnostics.lastTransportError.messageName,
    "DeviceNotificationRequest"
  );
  assert.match(
    diagnostics.lastTransportError.stack,
    /simulated fake-device write failure/
  );
});

test("SPIKE 3.x transport write errors propagate without starting Python fallback", async () => {
  const state = setup();
  await connect(state);
  const controller = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  assert.equal(controller.running, true);
  state.device.tx.emit(packMessage([0x29, 0x00]));
  await tick();
  const successfulWrites = state.device.writes.length;
  state.device.rx.failNextWrite = true;
  await assert.rejects(
    state.ext.motorStart({ PORT: "A", DIRECTION: 1 }),
    /simulated fake-device write failure/
  );
  assert.equal(
    state.device.writes.length,
    successfulWrites,
    "a transport failure must not trigger a second Python write"
  );
});

test("a mid-frame BLE write failure disconnects and blocks later commands", async () => {
  const state = setup();
  await connect(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  const writesBefore = state.device.writes.length;
  state.device.rx.failWriteNumber = writesBefore + 2;
  await assert.rejects(
    state.ext._peripheral._spike3._sendTunnelPayload("x".repeat(90)),
    /simulated fake-device write failure/
  );
  assert.equal(state.device.writes.length, writesBefore + 1);
  assert.equal(state.ext.isConnected(), false);
  await assert.rejects(
    state.ext._peripheral._spike3._sendTunnelPayload("another command"),
    /接続|connected/i
  );
  assert.equal(state.device.writes.length, writesBefore + 1);
});

test("raw Python over TunnelMessage is rejected and sends no bytes", async () => {
  const state = setup();
  await connect(state);
  const hub = state.ext._peripheral._spike3;
  const before = state.device.writes.length;
  await assert.rejects(
    hub.sendPythonCommand('import hub; hub.display.show("Hello")'),
    /Raw Python is not executed by TunnelMessage/
  );
  assert.equal(state.device.writes.length, before);
});

test("controller installation is non-modal, CRC-checked, transferred, started, and version-probed", async () => {
  const state = setup({ locale: "ja" });
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  const original = Buffer.from(fakeHub.slots.get(19));
  const result = await state.ext.installHubController({ SLOT: 19 });
  assert.equal(result.protocol, "brickwright-spike-controller");
  assert.equal(result.version, 3);
  assert.deepEqual(state.confirmationCalls, []);
  assert.deepEqual(state.alertCalls, []);
  assert.equal(fakeHub.running, true);
  assert.equal(fakeHub.currentUpload.name, "program.py");
  assert.ok(state.device.writes.every((packet) => packet.length <= 64));
  const uploadedMessages = unpackWrittenMessages(state.device.writes);
  const clearRequest = uploadedMessages.find((message) => message[0] === 0x46);
  const uploadRequest = uploadedMessages.find((message) => message[0] === 0x0c);
  const chunkRequests = uploadedMessages.filter(
    (message) => message[0] === 0x10
  );
  const programFlowRequest = uploadedMessages.find(
    (message) => message[0] === 0x1e
  );
  assert.equal(
    Buffer.from(clearRequest).toString("hex"),
    officialTransferVectors.messages.clear_slot_19.hex
  );
  assert.equal(uploadRequest.length, 17);
  assert.equal(
    Buffer.from(uploadRequest.slice(1, 12)).toString("utf8"),
    "program.py\0"
  );
  assert.equal(uploadRequest[12], 19);
  assert.equal(
    new DataView(Uint8Array.from(uploadRequest).buffer).getUint32(13, true),
    crc32Aligned(fakeHub.slots.get(19))
  );
  assert.ok(uploadedMessages.some((message) => message[0] === 0x10));
  assert.ok(chunkRequests.length > 1);
  const installedProgram = fakeHub.slots.get(19);
  let uploadedOffset = 0;
  assert.ok(
    chunkRequests.every((message) => {
      const view = new DataView(Uint8Array.from(message).buffer);
      const size = view.getUint16(5, true);
      const expectedSize = Math.min(
        50,
        installedProgram.length - uploadedOffset
      );
      const payload = Buffer.from(message.slice(7));
      const expectedPayload = installedProgram.subarray(
        uploadedOffset,
        uploadedOffset + expectedSize
      );
      uploadedOffset += size;
      return (
        size === expectedSize && size <= 50 && payload.equals(expectedPayload)
      );
    })
  );
  assert.equal(uploadedOffset, installedProgram.length);
  assert.equal(
    Buffer.from(programFlowRequest).toString("hex"),
    officialTransferVectors.messages.program_flow_start_slot_19.hex
  );
  assert.ok(uploadedMessages.some((message) => message[0] === 0x32));
  assert.notDeepEqual(fakeHub.slots.get(19), original);
  assert.equal(
    fakeHub.slots.get(19).toString("utf8").includes("module_tunnel"),
    true
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerStatus, "ready");
  assert.equal(diagnostics.controllerVersion, "brickwright-spike-controller/3");
  assert.equal(diagnostics.controllerInstallAttempt.outcome, "ready");
  assert.equal(
    diagnostics.controllerInstallAttempt.lastSuccessfulStage,
    "controller-hello-acknowledged"
  );
  assert.equal(diagnostics.lastProgramFlowNotification.action, "start");
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerSlot,
    19,
    "the UI remembers only the slot whose controller hello was verified"
  );
});

test("control center reconnect prepares fixed slot 0 and leaves the prior slot intact", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 19 });
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerReady,
    true
  );
  const helloCountBeforeReconnect = fakeHub.helloCount;

  state.ext.disconnectHub();
  fakeHub.running = false;
  state.device.autoInfoResponse = true;
  const writesBeforeReconnect = state.device.writes.length;
  const connectedState =
    await state.runtime.brickwrightSpikePrimeControl.connect();
  await tick();

  assert.equal(connectedState.connected, true);
  assert.equal(connectedState.controllerSlot, 0);
  assert.equal(connectedState.controllerReady, true);
  assert.equal(
    fakeHub.startCount,
    2,
    "the fixed internal controller starts during the completed connection flow"
  );
  assert.equal(
    fakeHub.helloCount,
    helloCountBeforeReconnect + 1,
    "connection resolves only after a fresh hello response"
  );

  const reconnectMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeReconnect)
  );
  assert.ok(reconnectMessages.some(([type]) => type === 0x00));
  assert.ok(reconnectMessages.some(([type]) => type === 0x28));
  assert.equal(
    reconnectMessages.some(([type, slot]) => type === 0x46 && slot === 19),
    false,
    "automatic preparation never clears the prior slot"
  );
  assert.ok(
    reconnectMessages.some(([type, slot]) => type === 0x46 && slot === 0)
  );
  assert.equal(fakeHub.slots.has(19), true, "slot 19 program remains intact");
});

test("control center connection automatically installs and verifies slot 0", async () => {
  const state = setup();
  state.device.autoInfoResponse = true;
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  const connectedState =
    await state.runtime.brickwrightSpikePrimeControl.connect();
  await tick();

  assert.equal(connectedState.connected, true);
  assert.equal(connectedState.controllerSlot, 0);
  assert.equal(connectedState.controllerReady, true);
  assert.equal(fakeHub.startCount, 1);
  assert.equal(fakeHub.helloCount, 1);
  const messages = unpackWrittenMessages(state.device.writes);
  assert.ok(messages.some(([type]) => type === 0x00));
  assert.ok(messages.some(([type]) => type === 0x28));
  assert.equal(
    messages.some(([type, slot]) => type === 0x46 && slot === 0),
    true,
    "first connection installs the fixed controller in slot 0"
  );
  assert.ok(messages.some(([type]) => type === 0x1e));
  assert.ok(messages.some(([type]) => type === 0x32));
});

test("first intentional controller command verifies an already-running controller", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  fakeHub.running = true;
  state.ext._writeControllerSlot(0);
  emitControllerBootMarker(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });

  assert.equal(fakeHub.helloCount, 1);
  assert.ok(fakeHub.receivedCommands.includes("controller.hello"));
  assert.equal(fakeHub.running, true);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  const messages = unpackWrittenMessages(state.device.writes);
  assert.ok(messages.some((message) => message[0] === 0x32));
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x1e, 0x46].includes(type)),
    false,
    "readiness verification never starts or uploads a slot"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
});

test("a Prime motor command works without any slot registration by preparing slot 0", async () => {
  const state = setup({ locale: "ja" });
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));

  await state.ext.motorRunFor({
    PORT: "A",
    DIRECTION: 1,
    VALUE: 1,
    UNIT: "rotations",
  });

  assert.equal(fakeHub.startCount, 1);
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(
    fakeHub.actions.find((action) => action.cmd === "motor.run_degrees")
      .degrees,
    360
  );
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerSlot,
    0
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerCommandPreparation.outcome, "ready");
  assert.notEqual(
    diagnostics.lastCommunicationError?.code,
    "ERR_CONTROLLER_SLOT_NOT_REGISTERED"
  );
});
test("automatic slot 0 preparation stops an identified active slot without clearing it", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 19 });

  // Model a current-session ProgramFlow start notification for another
  // program. The slot has no correlation ID in the notification itself, so
  // the router's already-tracked start state is the authority for this guard.
  hub._invalidateControllerBootEvidence("different standalone program");
  hub._controllerReady = false;
  hub._diagnostics.controllerStatus = "starting-user-program";
  hub._runningControllerSlot = 7;
  hub._runningControllerSession = hub._connectionSession;
  const startsBeforeCommand = fakeHub.startCount;
  const writesBeforeCommand = state.device.writes.length;
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));

  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });

  assert.equal(fakeHub.startCount, startsBeforeCommand + 1);
  assert.equal(fakeHub.running, true);
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerSlot,
    0
  );
  assert.equal(fakeHub.slots.has(19), true);
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeCommand)
  );
  assert.equal(
    messages.some(
      ([type, action, slot]) => type === 0x1e && action === 1 && slot === 7
    ),
    true,
    "the currently running standalone program is stopped before internal setup"
  );
  assert.equal(
    messages.some(([type, slot]) => type === 0x46 && slot === 0),
    true
  );
  assert.equal(
    messages.some(([type, slot]) => type === 0x46 && slot !== 0),
    false,
    "automatic preparation never clears the other active or saved slot"
  );
});

test("reconnecting automatically starts the saved internal slot before Scratch commands", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  const startCountBeforeReconnect = fakeHub.startCount;

  state.ext.disconnectHub();
  fakeHub.running = false;
  state.device.autoInfoResponse = true;
  const writesBeforeReconnect = state.device.writes.length;
  const reconnected = await api.connect();
  assert.equal(reconnected.connected, true);
  assert.equal(reconnected.controllerSlot, 0);
  assert.equal(reconnected.controllerReady, true);
  assert.equal(
    fakeHub.startCount,
    startCountBeforeReconnect + 1,
    "connection completes only after the internal controller starts"
  );
  const reconnectMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeReconnect)
  );
  assert.ok(
    reconnectMessages.some(([type, action]) => type === 0x1e && action === 0)
  );
  assert.ok(reconnectMessages.some(([type]) => type === 0x32));

  // HubRouter's registered API is authoritative. The older direct runtime
  // mirror can be stale after editor reconfiguration.
  state.runtime.brickwrightSpikePrimeControl = { ...api };

  state.device.tx.emit(packMessage(notification(motorRecord({ port: 1 }))));
  const writesBeforeCommand = state.device.writes.length;
  const command = state.ext.motorRunFor({
    PORT: "B",
    DIRECTION: 1,
    VALUE: 1,
    UNIT: "rotations",
  });
  const parallelCommand = state.ext.displayClear();

  await waitUntil(
    () => fakeHub.actions.some((action) => action.cmd === "motor.run_degrees"),
    "Scratch command follows the automatically prepared controller"
  );
  await Promise.all([command, parallelCommand]);

  assert.equal(fakeHub.startCount, startCountBeforeReconnect + 1);
  assert.equal(fakeHub.running, true);
  assert.equal(fakeHub.helloCount, 2, "connection startup verifies with hello");
  assert.equal(
    fakeHub.actions
      .filter((action) => action.cmd === "motor.run_degrees")
      .at(-1).degrees,
    360,
    "the standalone one-rotation block reaches the controller after hello"
  );
  assert.ok(fakeHub.actions.some((action) => action.cmd === "matrix.clear"));

  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeCommand)
  );
  const motorIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message[0] === 0x32 &&
        JSON.parse(Buffer.from(message.slice(3)).toString("utf8")).c !== "h"
    )
    .map(({ index }) => index);
  assert.equal(motorIndexes.length, 2);
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "automatic reuse does not restart, clear, or upload after connection readiness"
  );
});

test("Prime motorRunFor rejects a force sensor port and runs the reported motor port", async () => {
  const state = setup({ locale: "ja" });
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, { motorPorts: [] });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  // Current-session SPIKE 3 notification records from the user's report:
  // B is a force sensor, while D reports DeviceMotor type 0x41 (small motor).
  state.device.tx.emit(
    packMessage(
      notification(
        bytes(
          Uint8Array.from([0x0b, 1, 62, 1]),
          motorRecord({ port: 3, motorType: 0x41, absolute: 0, speed: 0 })
        )
      )
    )
  );
  const hub = state.ext._peripheral._spike3;
  assert.equal(hub.portValues.B.type, "force");
  assert.equal(hub.portValues.D.type, "motor");
  assert.equal(hub.portValues.D.motorType, 0x41);

  const writesBeforeWrongPort = state.device.writes.length;
  await assert.rejects(
    state.ext.motorRunFor({
      PORT: "B",
      DIRECTION: 1,
      VALUE: 1,
      UNIT: "rotations",
    }),
    (error) => {
      assert.equal(error.code, "ERR_SPIKE_PORT_NOT_MOTOR");
      assert.equal(
        error.message,
        "Bはフォースセンサーです。モーターはDに接続されています。"
      );
      return true;
    }
  );
  assert.equal(
    state.device.writes.length,
    writesBeforeWrongPort,
    "a known non-motor port is rejected before any BLE write"
  );
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run_degrees"),
    false,
    "the selected force-sensor port is never rerouted to a motor"
  );

  await state.ext.motorRunFor({
    PORT: "D",
    DIRECTION: 1,
    VALUE: 1,
    UNIT: "rotations",
  });
  const motorAction = fakeHub.actions.find(
    (action) => action.cmd === "motor.run_degrees"
  );
  assert.equal(motorAction.port, "D");
  assert.equal(motorAction.degrees, 360);
  assert.equal(motorAction.velocity, 495);
});

test("a normal motor-stop block after red stop restarts slot 0 and then stops the motor", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await api.prepareInternalController("connection");
  const stopped = await api.stop();
  assert.equal(stopped.stopped, true);
  assert.equal(fakeHub.running, false);

  const startsBeforeStopBlock = fakeHub.startCount;
  const writesBeforeStopBlock = state.device.writes.length;
  await state.ext.motorStop({ PORT: "A" });
  assert.equal(
    fakeHub.startCount,
    startsBeforeStopBlock + 1,
    "a normal Scratch stop block prepares the stopped internal controller"
  );
  assert.equal(fakeHub.helloCount, 2);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.stop"));

  const startsBeforeAction = fakeHub.startCount;
  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });

  assert.equal(fakeHub.startCount, startsBeforeAction);
  assert.equal(fakeHub.helloCount, 2);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeStopBlock)
  );
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "restart reuses the installed slot 0 controller file"
  );
});

test("normal motor-pair and sound stop blocks prepare the controller after red stop", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await api.prepareInternalController("connection");

  await api.stop();
  const beforePairStop = fakeHub.startCount;
  await state.ext.stopMovement();
  assert.equal(fakeHub.startCount, beforePairStop + 1);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor_pair.stop"));

  await api.stop();
  const beforeSoundStop = fakeHub.startCount;
  await state.ext.stopSound();
  assert.equal(fakeHub.startCount, beforeSoundStop + 1);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "sound.stop"));
});

test("PROJECT_START resumes sensor-only Prime programs and rejects stale controller snapshots", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await api.prepareInternalController("connection");

  const firstSnapshot = {
    angles: [10, 20, 30],
    gyro_filtered: [40, 50, 60],
    acceleration_filtered: [100, 200, 300],
    gesture: null,
    buttons: { left: false, right: false },
    hub_temperature: 250,
  };
  state.device.tx.emit(
    packMessage(controllerSensorTunnelMessage(firstSnapshot))
  );
  let diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerSensorStatus, "received");
  assert.deepEqual(JSON.parse(JSON.stringify(hub.accelerationFiltered)), {
    x: 100,
    y: 200,
    z: 300,
  });

  await api.stop();
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerSensorStatus, "stopped");
  assert.equal(diagnostics.controllerSensorReceivedAt, null);
  assert.ok(diagnostics.lastControllerSensorReceivedAt > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(hub.accelerationFiltered)), {
    x: null,
    y: null,
    z: null,
  });
  assert.equal(hub.hubTemp, null);

  state.device.tx.emit(
    packMessage(
      notification(
        imuRecord({
          yaw: 15,
          pitch: -25,
          roll: 35,
          accelerationX: 101,
          accelerationY: -202,
          accelerationZ: 303,
        })
      )
    )
  );
  assert.deepEqual(JSON.parse(JSON.stringify(hub.acceleration)), {
    x: 101,
    y: -202,
    z: 303,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(hub.angle)), {
    yaw: 1.5,
    pitch: -2.5,
    roll: 3.5,
  });

  state.device.tx.emit(
    packMessage(
      controllerSensorTunnelMessage({
        ...firstSnapshot,
        acceleration_filtered: [900, 900, 900],
      })
    )
  );
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerSensorStatus, "stopped");
  assert.deepEqual(JSON.parse(JSON.stringify(hub.accelerationFiltered)), {
    x: null,
    y: null,
    z: null,
  });

  const startsBeforeGreenFlag = fakeHub.startCount;
  const writesBeforeGreenFlag = state.device.writes.length;
  state.runtime.emit("PROJECT_START");
  state.runtime.emit("PROJECT_START");
  await waitUntil(
    () => fakeHub.startCount === startsBeforeGreenFlag + 1,
    "green flag should restart the saved internal controller"
  );
  await waitUntil(() => hub._controllerReady, "controller hello response");
  assert.equal(fakeHub.helloCount, 2);
  const restartMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeGreenFlag)
  );
  assert.equal(
    restartMessages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "green-flag restart reuses slot 0 without a transfer"
  );

  state.device.tx.emit(
    packMessage(controllerSensorTunnelMessage(firstSnapshot))
  );
  diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerSensorStatus, "received");
  assert.ok(diagnostics.controllerSensorReceivedAt > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(hub.accelerationFiltered)), {
    x: 100,
    y: 200,
    z: 300,
  });
});

test("red stop cancels a Scratch command waiting for its automatically started controller", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await api.prepareInternalController("connection");
  await api.stop();
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));
  fakeHub.startNotificationDelayMs = 500;

  const startsBeforeCommand = fakeHub.startCount;
  const firstCommand = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await waitUntil(
    () => fakeHub.startCount === startsBeforeCommand + 1,
    "saved controller start request"
  );

  state.runtime.emit("PROJECT_STOP_ALL");
  await assert.rejects(firstCommand, /cancelled|stopped|停止/i);
  await waitUntil(
    () => fakeHub.events.some((event) => event.type === "stop-request"),
    "red stop reaches the running program slot"
  );

  assert.equal(
    fakeHub.helloCount,
    1,
    "hello is not sent after stop cancels startup"
  );
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false,
    "the cancelled Scratch action never reaches the controller"
  );
  const messages = unpackWrittenMessages(state.device.writes);
  assert.ok(
    messages.some(
      ([type, action, slot]) => type === 0x1e && action === 1 && slot === 0
    ),
    "red stop sends ProgramFlow stop to the exact pending saved slot"
  );
});

test("disconnect cancels the first Scratch command while slot 0 is restarting", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await api.prepareInternalController("connection");
  await api.stop();
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));
  fakeHub.startNotificationDelayMs = 500;
  const writesBeforeCommand = state.device.writes.length;
  const startsBeforeCommand = fakeHub.startCount;
  const command = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await waitUntil(
    () => fakeHub.startCount === startsBeforeCommand + 1,
    "saved controller start request before disconnect"
  );

  state.device.gatt.disconnect();
  await assert.rejects(
    command,
    /not connected|disconnect|connection|hub.*changed/i
  );

  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false
  );
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeCommand)
  );
  assert.equal(
    messages.some(([type]) => type === 0x32),
    false,
    "disconnect prevents hello and the pending motor action"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).connected,
    false
  );
});

test("control center sensor snapshot exposes fresh hardware notification timestamps", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 5 }))));
  const snapshot = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(snapshot.portSensors.F.type, "motor");
  assert.ok(Number.isFinite(snapshot.portSensors.F.receivedAt));
  assert.equal(snapshot.motorPorts.F.relativePosition, -123456);
});

test("control center API is registered on the same router used by Scratch blocks", () => {
  const state = setup();
  const router = state.runtime.peripheralExtensions.spikeprime;
  const api = router.getControlCenterAPI();

  assert.equal(router, state.ext._peripheral);
  assert.equal(api, state.runtime.brickwrightSpikePrimeControl);
  assert.equal(api.extensionId, "spikeprime");
  assert.equal(api.hubRouterId, router.instanceId);
  assert.equal(api.getState().hubRouterId, router.instanceId);
  assert.equal(api.getState().runtimeRegistered, true);

  api.setMode("scratchlink-ble");
  assert.equal(router.mode, "scratchlink-ble");
  assert.equal(api.getState().selectedConnectionMode, "scratchlink-ble");
});

test("control center exposes an explicit read-only controller verification action", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  fakeHub.running = true;
  emitControllerBootMarker(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const writesBefore = state.device.writes.length;

  const result = await api.verifyController();

  assert.equal(result.version, 3);
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastWrite
      .controllerCommand,
    "controller.hello"
  );
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBefore)
  );
  assert.ok(messages.some(([type]) => type === 0x32));
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x1e, 0x46].includes(type)),
    false,
    "verification sends only the hello TunnelMessage"
  );
});

test("control center explicitly restarts only the current hub's saved controller slot", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 19 });
  await api.stop();
  assert.equal(fakeHub.running, false);

  const writesBeforeStart = state.device.writes.length;
  fakeHub.startNotificationDelayMs = 100;
  const firstStart = api.startSavedController(19);
  const duplicateStart = api.startSavedController(19);
  assert.strictEqual(
    firstStart,
    duplicateStart,
    "duplicate clicks share one explicit start operation"
  );
  await waitUntil(() => fakeHub.startCount === 2, "saved controller start");
  state.clock.advance(100);
  const result = await firstStart;

  assert.equal(result.version, 3);
  assert.equal(result.slot, 19);
  assert.equal(fakeHub.running, true);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeStart)
  );
  assert.ok(messages.some(([type, action]) => type === 0x1e && action === 0));
  assert.ok(messages.some(([type]) => type === 0x32));
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "restarting a saved controller never clears or retransfers its slot"
  );

  const writesBeforeReadyStart = state.device.writes.length;
  const alreadyRunning = await api.startSavedController(19);
  assert.equal(alreadyRunning.alreadyRunning, true);
  assert.equal(state.device.writes.length, writesBeforeReadyStart);
});

test("control-center reconnect starts fixed slot 0 before hello", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  const startCountBeforeReconnect = fakeHub.startCount;

  state.ext.disconnectHub();
  state.device.autoInfoResponse = true;
  const writesBeforeReconnect = state.device.writes.length;
  const connectedState =
    await state.runtime.brickwrightSpikePrimeControl.connect();
  assert.equal(connectedState.controllerReady, true);
  assert.equal(connectedState.controllerSlot, 0);
  assert.equal(fakeHub.startCount, startCountBeforeReconnect + 1);
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeReconnect)
  );
  const startIndex = messages.findIndex(
    ([type, action]) => type === 0x1e && action === 0
  );
  const helloIndex = messages.findIndex(([type]) => type === 0x32);
  assert.ok(startIndex >= 0);
  assert.ok(helloIndex > startIndex);
  assert.equal(fakeHub.helloCount, 2);
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "saved-slot restart sends ProgramFlow before hello and never clears or retransfers"
  );
});

test("saved-controller start rejects missing or mismatched slots without writing", async () => {
  const state = setup();
  await connect(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  const writesBefore = state.device.writes.length;

  await assert.rejects(
    api.startSavedController(19),
    /No Brickwright controller slot/
  );
  assert.equal(state.device.writes.length, writesBefore);

  state.ext._writeControllerSlot(7);
  await assert.rejects(
    api.startSavedController(8),
    /not the saved Brickwright controller slot/
  );
  assert.equal(state.device.writes.length, writesBefore);
  assert.equal(hub._controllerReady, false);
});

test("legacy explicit slot recovery registers only after a fresh start and hello", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await api.installController(6);
  const installedBytes = Buffer.from(fakeHub.slots.get(6));
  const deviceId = state.ext._controllerDeviceId();
  assert.equal(state.ext._removeControllerSlotForDevice(deviceId), true);
  await api.stop();

  const writesBeforeRecovery = state.device.writes.length;
  const startsBeforeRecovery = fakeHub.startCount;

  const result = await api.recoverControllerSlot(6);

  assert.equal(result.version, 3);
  assert.equal(result.registeredSlot, 6);
  assert.equal(fakeHub.startCount, startsBeforeRecovery + 1);
  assert.equal(api.getState().controllerSlot, 6);
  assert.equal(api.getState().controllerReady, true);
  assert.deepEqual(fakeHub.slots.get(6), installedBytes);
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeRecovery)
  );
  const startIndex = messages.findIndex(
    ([type, action]) => type === 0x1e && action === 0
  );
  const helloIndex = messages.findIndex(([type]) => type === 0x32);
  assert.ok(startIndex >= 0);
  assert.ok(helloIndex > startIndex);
  assert.equal(
    messages.some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "recovery never uploads or clears the selected slot"
  );
});

test("legacy slot recovery does not register unrelated contents or failed hello", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.slots.set(8, Buffer.from("unrelated user program"));
  const writesBefore = state.device.writes.length;

  const recovery = api.recoverControllerSlot(8);
  await waitUntil(
    () =>
      unpackWrittenMessages(state.device.writes.slice(writesBefore)).some(
        ([type, action, slot]) => type === 0x1e && action === 0 && slot === 8
      ),
    "recovery should start only the explicitly selected slot"
  );
  state.clock.advance(5000);
  await assert.rejects(
    recovery,
    (error) => error.code === "ERR_CONTROLLER_BOOT_EVIDENCE_TIMEOUT"
  );
  assert.equal(api.getState().controllerSlot, null);
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(
    unpackWrittenMessages(state.device.writes.slice(writesBefore)).some(
      ([type]) => [0x0c, 0x10, 0x46].includes(type)
    ),
    false
  );

  const installState = setup();
  await connect(installState);
  const controller = attachFakeControllerHub(installState);
  const installApi = installState.runtime.brickwrightSpikePrimeControl;
  installState.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await installApi.installController(5);
  const controllerDeviceId = installState.ext._controllerDeviceId();
  installState.ext._removeControllerSlotForDevice(controllerDeviceId);
  await installApi.stop();
  controller.failHello = true;
  const recoveryWritesBefore = installState.device.writes.length;
  await assert.rejects(
    installApi.recoverControllerSlot(5),
    /simulated hello failure/
  );
  assert.equal(installApi.getState().controllerSlot, null);
  assert.equal(controller.running, true);
  assert.equal(
    unpackWrittenMessages(
      installState.device.writes.slice(recoveryWritesBefore)
    ).some(([type]) => [0x0c, 0x10, 0x46].includes(type)),
    false,
    "a failed hello does not clear or retransmit the selected program"
  );
});

test("controller-slot recovery rejects invalid identity and a known different running slot", async () => {
  const state = setup();
  await connect(state);
  attachFakeControllerHub(state);
  const api = state.runtime.brickwrightSpikePrimeControl;
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const writesBefore = state.device.writes.length;

  await assert.rejects(
    api.recoverControllerSlot(20),
    /Controller slot must be from 0 to 19/
  );
  const deviceId = state.ext._controllerDeviceId();
  hub._runningControllerSlot = 4;
  hub._runningControllerSession = hub._connectionSession;
  await assert.rejects(
    api.recoverControllerSlot(5),
    (error) => error.code === "ERR_CONTROLLER_DIFFERENT_PROGRAM_RUNNING"
  );
  assert.equal(state.device.writes.length, writesBefore);
  assert.equal(state.ext._readControllerSlotForDevice(deviceId), null);

  state.ext._writeControllerSlot(4, deviceId);
  hub._link._device.id = "different-hub-identity";
  await assert.rejects(
    api.startSavedController(4),
    /No Brickwright controller slot/
  );
  assert.equal(state.device.writes.length, writesBefore);

  hub._link._device.id = deviceId;
  state.ext._removeControllerSlotForDevice(deviceId);
  hub._runningControllerSlot = null;
  hub._runningControllerSession = null;
  hub._link._device.id = null;
  await assert.rejects(
    api.recoverControllerSlot(5),
    (error) => error.code === "ERR_CONTROLLER_HUB_IDENTITY_REQUIRED"
  );
  assert.equal(state.device.writes.length, writesBefore);
});

test("control center installs to slot 0 by default without a migration", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.slots.set(0, Buffer.from("existing target program"));

  const result =
    await state.runtime.brickwrightSpikePrimeControl.installController();

  assert.equal(result.version, 3);
  assert.equal(fakeHub.currentUpload.slot, 0);
  assert.equal(fakeHub.running, true);
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState()
      .controllerMigrationSlot,
    0
  );
  assert.equal(
    fakeHub.events.some((event) => event.type === "clear" && event.slot !== 0),
    false,
    "the default install must not clear any previous slot"
  );
});

test("control center clears a confirmed previous slot after upload and before start", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.slots.set(0, Buffer.from("new target slot"));
  fakeHub.slots.set(7, Buffer.from("remembered old controller"));
  const api = state.runtime.brickwrightSpikePrimeControl;
  await api.installController(7);
  fakeHub.events.length = 0;

  const result = await api.installController(0, { previousSlot: 7 });

  const lastChunk = fakeHub.events.findLastIndex(
    (event) => event.type === "chunk-acknowledged"
  );
  const oldSlotClear = fakeHub.events.findIndex(
    (event) => event.type === "clear" && event.slot === 7
  );
  const newStart = fakeHub.events.findIndex(
    (event) => event.type === "start-request" && event.slot === 0
  );
  assert.ok(lastChunk >= 0 && lastChunk < oldSlotClear);
  assert.ok(oldSlotClear < newStart);
  assert.equal(result.cleanup.status, "deleted");
  assert.equal(fakeHub.slots.has(7), false);
  assert.equal(fakeHub.slots.has(0), true);
  assert.equal(api.getState().controllerMigrationSlot, 0);
});

test("failed target upload preserves the confirmed previous controller slot", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.slots.set(0, Buffer.from("new target slot"));
  fakeHub.slots.set(7, Buffer.from("remembered old controller"));
  const api = state.runtime.brickwrightSpikePrimeControl;
  await api.installController(7);
  const oldProgram = Buffer.from(fakeHub.slots.get(7));
  fakeHub.failChunkIndex = 0;

  await assert.rejects(
    api.installController(0, { previousSlot: 7 }),
    /chunk at byte 0/
  );

  assert.deepEqual(fakeHub.slots.get(7), oldProgram);
  assert.equal(api.getState().controllerMigrationSlot, 7);
  assert.equal(
    fakeHub.events.filter((event) => event.type === "clear" && event.slot === 7)
      .length,
    1,
    "only the initial target install may have cleared slot 7"
  );
});

test("control center reports the Web Bluetooth chooser error to the GUI", async () => {
  const state = setup({ failBluetoothChooser: true });
  const api =
    state.runtime.peripheralExtensions.spikeprime.getControlCenterAPI();

  await assert.rejects(
    api.connect("web-ble"),
    /simulated Web Bluetooth chooser failure/
  );
  assert.equal(state.runtime.brickwrightSpikePrimeControl, api);
  assert.equal(state.ext._peripheral.isConnected(), false);
  assert.equal(
    api.getState().diagnostics.lastTransportError.message,
    "simulated Web Bluetooth chooser failure"
  );
});

test("reinstall stops the running controller before clearing and replacing the same slot", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 6 });
  fakeHub.events.length = 0;
  const writesBeforeReinstall = state.device.writes.length;

  const result = await state.ext.installHubController({ SLOT: 6 });
  const stopIndex = fakeHub.events.findIndex(
    (event) => event.type === "stop-request"
  );
  const clearIndex = fakeHub.events.findIndex(
    (event) => event.type === "clear" && event.slot === 6
  );
  const uploadIndex = fakeHub.events.findIndex(
    (event) => event.type === "upload-start" && event.slot === 6
  );
  const startIndex = fakeHub.events.findIndex(
    (event) => event.type === "start-request" && event.slot === 6
  );
  assert.ok(stopIndex >= 0);
  assert.ok(stopIndex < clearIndex);
  assert.ok(clearIndex < uploadIndex);
  assert.ok(uploadIndex < startIndex);
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeReinstall)
  );
  const tunnelStopIndex = messages.findIndex(
    (message) =>
      message[0] === 0x32 &&
      JSON.parse(Buffer.from(message.slice(3)).toString()).c === "x"
  );
  const programStopIndex = messages.findIndex(
    (message) => message[0] === 0x1e && message[1] === 1
  );
  const clearMessageIndex = messages.findIndex(
    (message) => message[0] === 0x46
  );
  const startMessageIndex = messages.findIndex(
    (message) => message[0] === 0x1e && message[1] === 0
  );
  assert.ok(tunnelStopIndex >= 0);
  assert.ok(tunnelStopIndex < programStopIndex);
  assert.ok(programStopIndex < clearMessageIndex);
  assert.ok(clearMessageIndex < startMessageIndex);
  assert.equal(fakeHub.events[stopIndex].slot, 6);
  assert.ok(fakeHub.receivedCommands.includes("controller.stop_all"));
  assert.equal(result.version, 3);
  assert.equal(fakeHub.running, true);
  assert.equal(hub._runningControllerSlot, 6);
  await state.ext.setPixel({ X: 1, Y: 1, BRIGHTNESS: 100 });
  assert.ok(fakeHub.actions.some((action) => action.cmd === "matrix.pixel"));
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
  assert.deepEqual(state.confirmationCalls, []);
  assert.deepEqual(state.alertCalls, []);
});

test("reinstall waits for the old stop notification before clearing the requested slot", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(4);
  fakeHub.stopNotificationDelayMs = 250;
  fakeHub.events.length = 0;

  const reinstall = hub.installController(4);
  await waitUntil(
    () => fakeHub.events.some((event) => event.type === "stop-request"),
    "reinstall should first ask the active program to stop"
  );
  assert.equal(
    fakeHub.events.some((event) => event.type === "clear"),
    false,
    "the slot must not be cleared while the old program is still stopping"
  );
  state.clock.advance(249);
  await tick();
  assert.equal(
    fakeHub.events.some((event) => event.type === "clear"),
    false,
    "the transfer must wait for stop confirmation"
  );
  state.clock.advance(1);
  await reinstall;
  assert.ok(
    fakeHub.events.findIndex((event) => event.type === "stop-request") <
      fakeHub.events.findIndex((event) => event.type === "clear")
  );
});

test("an uncorrelated old stop notification during restart does not fail the new start", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(5);
  fakeHub.startNotificationDelayMs = 1400;
  fakeHub.unattributedStopAfterStartDelayMs = 2;

  let settled = false;
  const reinstall = hub.installController(5).finally(() => {
    settled = true;
  });
  await waitUntil(
    () => fakeHub.startCount === 2,
    "the replacement ProgramFlow start request should be sent"
  );
  state.clock.advance(2);
  await tick();

  const duringRestart = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(settled, false);
  assert.equal(duringRestart.controllerInstallAttempt.outcome, "in-progress");
  assert.equal(
    duringRestart.controllerInstallAttempt.programFlowStoppedAt,
    null
  );
  assert.equal(
    duringRestart.controllerInstallAttempt.unattributedStopNotifications.length,
    1
  );

  state.clock.advance(1398);
  await reinstall;
  const finished = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(finished.controllerStatus, "ready");
  assert.equal(finished.controllerInstallAttempt.outcome, "ready");
  assert.equal(fakeHub.running, true);
});

test("switching controller slots stops the old slot before uploading the new one", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(8);
  fakeHub.events.length = 0;

  await hub.installController(9);
  const stop = fakeHub.events.find((event) => event.type === "stop-request");
  const clear = fakeHub.events.find((event) => event.type === "clear");
  const upload = fakeHub.events.find((event) => event.type === "upload-start");
  const start = fakeHub.events.find((event) => event.type === "start-request");
  assert.equal(stop.slot, 8);
  assert.equal(clear.slot, 9);
  assert.equal(upload.slot, 9);
  assert.equal(start.slot, 9);
  assert.ok(fakeHub.events.indexOf(stop) < fakeHub.events.indexOf(clear));
  assert.equal(hub._runningControllerSlot, 9);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
});

test("failed old-program stop aborts reinstall before clearing or transferring", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(10);
  const clearCount = fakeHub.events.filter(
    (event) => event.type === "clear"
  ).length;
  const startCount = fakeHub.startCount;
  fakeHub.failProgramFlowStop = true;

  const reinstall = hub.installController(10);
  const rejected = assert.rejects(reinstall, /stop was not fully confirmed/i);
  await waitUntil(
    () => fakeHub.events.some((event) => event.type === "stop-request"),
    "the old program stop should be attempted"
  );
  state.clock.advance(3000);
  await rejected;

  assert.equal(
    fakeHub.events.filter((event) => event.type === "clear").length,
    clearCount,
    "failed stop confirmation must prevent slot clearing"
  );
  assert.equal(fakeHub.startCount, startCount);
  assert.equal(fakeHub.running, true);
});

test("concurrent controller installs run serially and each explicit request completes", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;

  const results = await Promise.all([
    hub.installController(11),
    hub.installController(12),
  ]);
  const starts = fakeHub.events.filter(
    (event) => event.type === "start-request"
  );
  const clears = fakeHub.events.filter((event) => event.type === "clear");
  assert.equal(results.length, 2);
  assert.equal(starts.length, 2);
  assert.deepEqual(
    starts.map((event) => event.slot),
    [11, 12]
  );
  assert.deepEqual(
    clears.map((event) => event.slot),
    [11, 12]
  );
  assert.equal(hub._runningControllerSlot, 12);
  assert.equal(fakeHub.running, true);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
});

test("a transfer failure after confirmed stop never starts the replacement program", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(13);
  const startCount = fakeHub.startCount;
  fakeHub.failChunkIndex = 0;

  await assert.rejects(hub.installController(13), /chunk at byte 0/);
  assert.equal(fakeHub.startCount, startCount);
  assert.equal(fakeHub.running, false);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "error"
  );
  assert.ok(fakeHub.events.some((event) => event.type === "stop-request"));
});

test("a ProgramFlow start failure after reinstall is returned and not treated as ready", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(14);
  fakeHub.failProgramFlowStart = true;

  await assert.rejects(
    hub.installController(14),
    /Hub rejected ProgramFlowRequest/
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(fakeHub.running, false);
  assert.equal(fakeHub.helloCount, 1, "only the first install may handshake");
  assert.equal(diagnostics.controllerStatus, "error");
  assert.equal(diagnostics.controllerInstallAttempt.outcome, "failed");
});

test("PROJECT_STOP_ALL cancels queued reinstall requests before they can restart the controller", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await hub.installController(15);
  const clearsBefore = fakeHub.events.filter(
    (event) => event.type === "clear"
  ).length;

  const queuedOne = hub.installController(16);
  const queuedTwo = hub.installController(17);
  state.runtime.emit("PROJECT_STOP_ALL");
  await hub._projectStopPromise;
  const outcomes = await Promise.allSettled([queuedOne, queuedTwo]);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
  assert.ok(
    outcomes.every(
      (outcome) =>
        outcome.reason.code === "ERR_CONTROLLER_INSTALL_CANCELLED_BY_STOP"
    )
  );
  assert.equal(
    fakeHub.events.filter((event) => event.type === "clear").length,
    clearsBefore,
    "queued installs must not clear a slot after emergency stop"
  );
  assert.equal(fakeHub.running, false);
  assert.equal(hub._controllerReady, false);
  assert.equal(state.ext.isConnected(), true);
});

test("transpilation errors reject instead of being swallowed after console logging", async () => {
  const state = setup();
  state.ext._transpiler.transpileProject = () => {
    throw new Error("simulated transpilation failure");
  };

  await assert.rejects(
    Promise.resolve().then(() => state.ext.transpileProject()),
    /simulated transpilation failure/
  );
  assert.deepEqual(state.alertCalls, []);
});

test("standalone value conversion reports the unsupported opcode structurally", () => {
  const state = setup();
  assert.throws(
    () =>
      state.ext._transpiler.evaluateBlock(
        { opcode: "extension_unknown_value", fields: {}, inputs: {} },
        { _blocks: {} }
      ),
    (error) => {
      assert.match(
        error.message,
        /Unsupported value block in SPIKE Python conversion: extension_unknown_value/
      );
      assert.equal(error.code, "ERR_SPIKE_STANDALONE_UNSUPPORTED_VALUE");
      assert.equal(error.opcode, "extension_unknown_value");
      return true;
    }
  );
});

test("official SPIKE extension blocks expose correct shapes, handlers, menus and Python code", () => {
  const state = setup({locale: "ja"});
  const ext = state.ext;
  const info = ext.getInfo();
  const byOpcode = new Map(info.blocks.filter((block) => typeof block === "object").map((block) => [block.opcode, block]));
  const expected = {
    isColor: "BOOLEAN",
    getColor: "REPORTER",
    getReflection: "REPORTER",
    isReflectionCompared: "BOOLEAN",
    getForce: "REPORTER",
    isForceSensorPressed: "BOOLEAN",
    getDistanceIn: "REPORTER",
    isDistanceCompared: "BOOLEAN",
    isHubOrientation: "BOOLEAN",
    isOrientation: "BOOLEAN",
    getOrientation: "REPORTER",
    isGesture: "BOOLEAN",
    getAngle: "REPORTER",
    resetYaw: "COMMAND",
    isButtonPressed: "BOOLEAN",
    getTimer: "REPORTER",
    resetTimer: "COMMAND",
    whenColor: "HAT",
    whenForceSensor: "HAT",
    whenGesture: "HAT",
    whenButtonPressed: "HAT",
    getColorRGB: "REPORTER",
    getAcceleration: "REPORTER",
    getGyroRate: "REPORTER",
    getGesture: "REPORTER",
    getRawColor255: "REPORTER",
    motorRunToRelativePosition: "COMMAND",
    getMotorPower: "REPORTER",
    setMotorAcceleration: "COMMAND",
    setMovementStopAction: "COMMAND",
    setMovementAcceleration: "COMMAND",
  };
  for (const [opcode, shape] of Object.entries(expected)) {
    assert.equal(byOpcode.get(opcode)?.blockType, shape, opcode);
    assert.equal(typeof ext[opcode], "function", `${opcode} has a browser handler`);
  }
  assert.equal(byOpcode.get("isColor").text, "[PORT] 色が [COLOR]");
  assert.equal(byOpcode.get("getAngle").text, "[AXIS] 角");
  assert.equal(byOpcode.get("getOrientation").text, "向き");
  assert.equal(byOpcode.get("getDistanceIn").text, "[PORT] 距離 [UNIT]");
  assert.equal(byOpcode.get("getForce").text, "[PORT] 圧力 [UNIT]");
  assert.equal(byOpcode.get("motorStartPower").text, "[PORT] モーターを [POWER] のパワーで動かす");
  assert.equal(byOpcode.get("motorSetStopAction").text, "[PORT] モーターを停止時 [ACTION] に設定");
  assert.equal(byOpcode.get("startTank").text, "[LEFT_SPEED] [RIGHT_SPEED] %のスピードで移動開始する");
  assert.equal(
    byOpcode.get("motorRunToRelativePosition").tooltip,
    byOpcode.get("motorRunToRelativePosition").text,
    "long SPIKE labels expose their complete text in the flyout tooltip"
  );
  assert.equal(byOpcode.get("getTimer").tooltip, undefined, "short labels do not add redundant tooltips");
  assert.deepEqual(
    Array.from(info.menus.MOTOR_PATH.items, (item) => [item.text, item.value]),
    [["最短経路", "shortest"], ["時計回り", "clockwise"], ["反時計回り", "counterclockwise"]]
  );
  assert.deepEqual(
    Array.from(info.menus.AXIS.items, item => [item.text, item.value]),
    [["ピッチ", "pitch"], ["ロール", "roll"], ["ヨー", "yaw"]]
  );
  assert.deepEqual(
    Array.from(info.menus.DISTANCE_UNIT.items, item => [item.text, item.value]),
    [["cm", "cm"], ["mm", "mm"], ["インチ", "in"], ["%", "%"]]
  );
  assert.deepEqual(
    Array.from(info.menus.GESTURE.items, item => [item.text, item.value]),
    [["タップ", "tapped"], ["ダブルタップ", "doubletapped"], ["シェイク", "shake"], ["自由落下", "freefall"]]
  );
  for (const locale of ["en", "ja", "de"]) {
    const localized = setup({locale}).ext.getInfo();
    assert.deepEqual(
      Array.from(localized.menus.MOTOR_PATH.items, item => item.value),
      ["shortest", "clockwise", "counterclockwise"],
      `${locale} labels do not change saved path values`
    );
    for (const item of Object.values(localized.menus).flatMap((menu) => menu.items || [])) {
      if (typeof item === "object") {
        assert.doesNotMatch(item.text, /^(motorPath|state|face|acceleration|relation|color)\./, `${locale} menu has no raw translation key`);
      }
    }
  }

  const transpiler = ext._transpiler;
  const blocks = {_blocks: {}};
  const input = (value) => [1, [typeof value === "number" ? 4 : 10, value]];
  const expression = (opcode, fields) => transpiler.evaluateBlock(
    {opcode: `spikeprime_${opcode}`, fields: {}, inputs: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, input(value)]))},
    blocks
  );
  assert.match(expression("getPosition", {PORT: "A"}), /motor\.absolute_position/);
  assert.match(expression("getRelativePosition", {PORT: "A"}), /motor\.relative_position/);
  assert.match(expression("getRawColor255", {PORT: "A", CHANNEL: "red"}), /color_rgb_255/);
  assert.match(expression("isReflectionCompared", {PORT: "A", OPERATOR: "<", THRESHOLD: 50}), /compare_number/);
  assert.match(expression("isDistanceCompared", {PORT: "B", DISTANCE: 15, UNIT: "%", RELATION: "near"}), /distance_value/);
  assert.match(expression("getForce", {PORT: "B", UNIT: "N"}), /force_value/);
  assert.match(expression("isForceSensorPressed", {PORT: "B", STATE: "hard pressed"}), /force_state/);
  assert.match(expression("getMotorPower", {PORT: "A"}), /motor\.get_duty_cycle/);
  assert.match(expression("getGesture", {}), /hub_gesture_name/);
  assert.match(expression("isHubOrientation", {FACE: "front"}), /face_up_name\(\)/);

  const emit = (opcode, values) => {
    transpiler.pythonCode = "";
    transpiler.indentLevel = 0;
    transpiler.processBlock(
      {opcode: `spikeprime_${opcode}`, fields: {}, inputs: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, input(value)]))},
      blocks
    );
    return transpiler.pythonCode;
  };
  assert.match(emit("motorRunToRelativePosition", {PORT: "A", SPEED: 60, POSITION: 0}), /await motor\.run_to_relative_position\(int\(0\)/);
  assert.match(emit("setMotorAcceleration", {PORT: "A", ACCELERATION: "high"}), /set_motor_acceleration\("A", "high"\)/);
  assert.match(emit("setMovementStopAction", {ACTION: "hold"}), /set_movement_stop_action\("hold"\)/);
  assert.match(emit("setMovementAcceleration", {ACCELERATION: "medium"}), /set_movement_acceleration\("medium"\)/);
  assert.match(emit("setYawFace", {FACE: "front"}), /set_yaw_reference_face\("front"\)/);

  transpiler.pythonCode = "";
  transpiler.indentLevel = 0;
  transpiler.generateHelperFunctions();
  assert.match(transpiler.pythonCode, /motor\.run_to_relative_position/);
  assert.match(transpiler.pythonCode, /distance_value\(name, unit\)/);
  assert.match(transpiler.pythonCode, /color_rgb_255\(name, channel\)/);
  assert.match(transpiler.pythonCode, /motion_sensor\.set_yaw_face\(face\)/);
});

test("startup probe block and menu are hidden unless developer mode is opted in", () => {
  const regularInfo = setup().ext.getInfo();
  assert.equal(
    regularInfo.blocks.some((block) => block.opcode === "runStartupProbe"),
    false
  );
  assert.equal(regularInfo.menus.SPIKE_STARTUP_PROBE, undefined);

  const developerInfo = setup({
    developerMode: true,
    locale: "ja",
  }).ext.getInfo();
  const probeBlock = developerInfo.blocks.find(
    (block) => block.opcode === "runStartupProbe"
  );
  assert.ok(probeBlock);
  assert.match(probeBlock.text, /SPIKE起動プローブ/);
  assert.deepEqual(
    Array.from(
      developerInfo.menus.SPIKE_STARTUP_PROBE.items,
      (item) => item.value
    ),
    ["00", "01", "02"]
  );
  assert.match(
    developerInfo.menus.SPIKE_STARTUP_PROBE.items[0].text,
    /runloop/
  );
});

test("startup probe overwrite confirmation names the slot and cancellation sends nothing", async () => {
  const state = setup({ developerMode: true, locale: "ja" });
  await connect(state);
  attachFakeStartupProbeHub(state);
  const before = state.device.writes.length;
  let confirmation = "";
  state.context.Scratch.BWConfirm = (message) => {
    confirmation = message;
    return false;
  };

  const result = await state.ext.runStartupProbe({ PROBE: "00", SLOT: 7 });
  assert.equal(result, undefined);
  assert.match(confirmation, /プローブ00/);
  assert.match(confirmation, /スロット7/);
  assert.match(confirmation, /program\.py/);
  assert.match(confirmation, /SPIKEアプリで上書きしてよいスロットか確認/);
  assert.equal(state.device.writes.length, before);
  assert.deepEqual(
    JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns,
    []
  );
});

test("fake-device records probe 00 bytes, Python markers, and a simulated flow lifecycle", async () => {
  const state = setup({ developerMode: true, locale: "ja" });
  await connect(state);
  const fakeHub = attachFakeStartupProbeHub(state, {
    emitProbeMarkers: true,
    naturalCompletion: true,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  const confirmations = [];
  state.context.Scratch.BWConfirm = (message) => {
    confirmations.push(message);
    return true;
  };

  const resultPromise = state.ext.runStartupProbe({ PROBE: "00", SLOT: 7 });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
        ?.stage === "observing-running-program",
    "probe 00 reaches the observation window"
  );
  state.clock.advance(2000);
  const result = await resultPromise;

  assert.equal(result.probeId, "00");
  assert.equal(result.slot, 7);
  assert.equal(result.outcome, "success");
  assert.equal(result.notifications.start.action, "start");
  assert.equal(result.notifications.stop.action, "stop");
  assert.equal(result.transferResponses.startFileUpload.ok, true);
  assert.ok(result.transferResponses.transferChunks.length > 0);
  assert.ok(
    result.transferResponses.transferChunks.every((chunk) => chunk.ok === true)
  );
  assert.equal(result.transferResponses.programFlowStart.ok, true);
  assert.equal(result.transferResponses.programFlowStop, null);
  assert.ok(result.runtimeMs >= 0);
  assert.equal(result.pythonExecution.status, "completed");
  assert.equal(result.pythonExecution.allStagesObserved, true);
  assert.equal(result.consoleObservation.status, "probe-markers-observed");
  assert.equal(result.consoleObservation.notificationCount, 5);
  assert.equal(result.consoleObservation.probeMarkerCount, 5);
  assert.equal(result.finalStage, "observing-running-program");
  assert.equal(
    result.executionStartedAt,
    result.pythonExecution.stageMarkers[0].receivedAt
  );
  assert.equal(
    result.executionFinishedAt,
    result.pythonExecution.stageMarkers.at(-1).receivedAt
  );
  assert.equal(
    result.executionDurationMs,
    result.executionFinishedAt - result.executionStartedAt
  );
  assert.deepEqual(
    Array.from(result.pythonExecution.stageMarkers, (stage) => stage.id),
    [
      "top-level",
      "runloop-imported",
      "main-started",
      "sleep-completed",
      "main-completed",
    ]
  );
  assert.equal(result.consoleOutput.length, 5);
  assert.ok(
    result.consoleOutput.every((item) => item.decodedProtocolMessageHex)
  );
  assert.equal(result.flowCorrelation.notificationContainsSlot, false);
  assert.match(
    result.runtimeMsMeaning,
    /includes info wait, slot clear, transfer/i
  );
  assert.equal(result.source.encoding, "UTF-8");
  assert.equal(result.source.hasTrailingNewline, true);
  assert.equal(result.source.lineEndings, "LF");
  assert.equal(result.source.byteLength, result.transferredBytes);
  assert.equal(result.transferResponses.infoRequest.requestMessageHex, "00");
  assert.deepEqual(
    bytesFromHex(result.transferResponses.infoRequest.requestFrameHex),
    packMessage([0x00])
  );
  assert.equal(
    result.transferResponses.infoRequest.responseMessageHex,
    "0102002a0001063e004000640032000000"
  );
  assert.equal(
    result.transferResponses.notificationRequest.status,
    "acknowledged"
  );
  assert.equal(
    result.transferResponses.notificationRequest.requestMessageHex,
    "286400"
  );
  assert.equal(
    result.transferResponses.notificationRequest.responseMessageHex,
    "2900"
  );
  assert.equal(fakeHub.programSource, result.source.text);
  assert.equal(
    Number.parseInt(result.source.crc32.slice(2), 16),
    fakeHub.upload.expectedCrc
  );
  assert.equal(
    result.transferResponses.programFlowStart.protocolMessageHex,
    "1e0007"
  );
  assert.equal(
    result.transferResponses.programFlowStart.responseMessageHex,
    "1f00"
  );
  assert.deepEqual(
    bytesFromHex(result.transferResponses.programFlowStart.requestFrameHex),
    packMessage([0x1e, 0x00, 0x07])
  );
  assert.deepEqual(
    bytesFromHex(result.transferResponses.programFlowStart.responseFrameHex),
    packMessage([0x1f, 0x00])
  );
  assert.equal(
    result.transferResponses.programFlowStart.requestPacketLengths.reduce(
      (sum, length) => sum + length,
      0
    ),
    bytesFromHex(result.transferResponses.programFlowStart.requestFrameHex)
      .length
  );
  assert.equal(result.notifications.start.decodedProtocolMessageHex, "2000");
  assert.equal(result.notifications.stop.decodedProtocolMessageHex, "2001");
  assert.deepEqual(
    bytesFromHex(result.notifications.start.wireFrameHex),
    packMessage([0x20, 0x00])
  );
  assert.deepEqual(
    bytesFromHex(result.notifications.stop.wireFrameHex),
    packMessage([0x20, 0x01])
  );
  assert.ok(
    result.consoleOutput.every(
      (item) =>
        bytesFromHex(item.wireFrameHex).length >
        bytesFromHex(item.decodedProtocolMessageHex).length
    )
  );
  assert.match(confirmations[0], /スロット7/);

  const fixture = fs
    .readFileSync(
      path.join(here, "fixtures/spikeprime-startup-00-runloop.py"),
      "utf8"
    )
    .replace(/\r\n/g, "\n")
    .replaceAll("__RUN_ID__", result.runId);
  assert.equal(fakeHub.upload.fileName, "program.py");
  assert.equal(fakeHub.slots.get(7).toString("utf8"), fixture);
  assert.equal(fakeHub.flowStarts, 1, "only the selected probe is started");
  assert.equal(fakeHub.flowStops, 0, "probe 00 reaches its natural completion");
  const writtenMessages = unpackWrittenMessages(state.device.writes);
  assert.equal(
    writtenMessages.some((message) => message[0] === 0x32),
    false,
    "the diagnostic flow does not send TunnelMessage or Python commands"
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.startupProbeRuns[0].outcome, "success");
});

for (const probeId of ["01", "02"]) {
  test(`selected probe ${probeId} is the exact reviewed fixture`, async () => {
    const state = setup({ developerMode: true });
    await connect(state);
    const fakeHub = attachFakeStartupProbeHub(state);
    const hub = state.ext._peripheral._spike3;
    hub._rateLimiter.reserve = () => 0;
    const runPromise = hub.runStartupProbe(probeId, 7, {
      observationMs: 0,
      startTimeoutMs: 10,
      stopTimeoutMs: 10,
    });
    await waitUntil(
      () =>
        JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
          ?.stage === "observing-running-program",
      `probe ${probeId} reaches the observation window`
    );
    state.clock.advance(0);
    const result = await runPromise;
    const fixture = fs
      .readFileSync(
        path.join(
          here,
          `fixtures/spikeprime-startup-${probeId}-${probeId === "01" ? "public-imports" : "tunnel-registration"}.py`
        ),
        "utf8"
      )
      .replace(/\r\n/g, "\n");
    assert.equal(result.outcome, "success");
    assert.equal(fakeHub.upload.fileName, "program.py");
    assert.equal(fakeHub.slots.get(7).toString("utf8"), fixture);
    assert.equal(fakeHub.flowStarts, 1);
    assert.equal(fakeHub.flowStops, 1);
  });
}

test("missing probe start notification is indeterminate even if stop cleanup responds", async () => {
  const state = setup({ developerMode: true });
  await connect(state);
  attachFakeStartupProbeHub(state, { emitStartNotification: false });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const runPromise = hub.runStartupProbe("00", 7, {
    observationMs: 0,
    startTimeoutMs: 20,
    stopTimeoutMs: 20,
  });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
        ?.stage === "waiting-for-start-notification",
    "probe waits for its start notification"
  );
  state.clock.advance(20);
  const result = await runPromise;
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.notifications.start, null);
  assert.equal(result.transferResponses.programFlowStart.ok, true);
  assert.equal(result.transferResponses.programFlowStop.ok, true);
  assert.equal(result.notifications.stop.action, "stop");
  assert.equal(result.terminationStatus, "cleanup-stop-notification-received");
});

test("Python completion markers do not make an uncorrelated stop notification a protocol success", async () => {
  const state = setup({ developerMode: true });
  await connect(state);
  attachFakeStartupProbeHub(state, {
    emitStartNotification: false,
    emitProbeMarkers: true,
    naturalCompletion: true,
  });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const runPromise = hub.runStartupProbe("00", 7, {
    observationMs: 0,
    startTimeoutMs: 5000,
    stopTimeoutMs: 20,
  });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
        ?.stage === "waiting-for-start-notification",
    "probe waits for the missing start notification"
  );
  state.clock.advance(2000);
  const result = await runPromise;
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.pythonExecution.status, "completed");
  assert.equal(result.notifications.start, null);
  assert.equal(result.notifications.stop.action, "stop");
  assert.equal(result.terminationStatus, "stop-without-start-notification");
  assert.equal(
    result.executionDurationMs,
    result.executionFinishedAt - result.executionStartedAt
  );
  assert.equal(result.transferResponses.programFlowStop, null);
});

test("missing probe stop notification is indeterminate", async () => {
  const state = setup({ developerMode: true });
  await connect(state);
  attachFakeStartupProbeHub(state, { emitStopNotification: false });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const runPromise = hub.runStartupProbe("00", 7, {
    observationMs: 5,
    startTimeoutMs: 20,
    stopTimeoutMs: 20,
  });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
        ?.stage === "observing-running-program",
    "probe reaches its observation window"
  );
  state.clock.advance(5);
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics()).startupProbeRuns[0]
        ?.stage === "waiting-for-stop-notification",
    "probe waits for stop notification"
  );
  state.clock.advance(20);
  const result = await runPromise;
  assert.equal(result.outcome, "indeterminate");
  assert.equal(result.notifications.start.action, "start");
  assert.equal(result.notifications.stop, null);
  assert.equal(result.transferResponses.programFlowStop.ok, true);
  assert.equal(
    result.terminationStatus,
    "diagnostic-stop-notification-missing"
  );
});

test("an uncorrelated early stop without Python markers is indeterminate", async () => {
  const state = setup({ developerMode: true });
  await connect(state);
  attachFakeStartupProbeHub(state, { stopImmediatelyAfterStart: true });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const result = await hub.runStartupProbe("00", 7, {
    observationMs: 50,
    startTimeoutMs: 20,
    stopTimeoutMs: 20,
  });
  assert.equal(result.outcome, "indeterminate");
  assert.match(result.reason, /notification has no slot field/i);
  assert.equal(result.pythonExecution.status, "not-observed");
  assert.equal(result.consoleObservation.status, "no-console-notifications");
  assert.equal(result.finalStage, "waiting-for-start-notification");
  assert.equal(
    result.executionFinishedAt,
    null,
    "a stop notification is not a Python completion timestamp"
  );
  assert.equal(result.notifications.start.action, "start");
  assert.equal(result.notifications.stop.action, "stop");
  assert.equal(result.terminationStatus, "stop-before-diagnostic-stop-request");
  assert.equal(result.notifications.stop.decodedProtocolMessageHex, "2001");
  assert.equal(result.transferResponses.programFlowStop, null);
});

test("a failed probe transfer is recorded as failure and does not start the slot", async () => {
  const state = setup({ developerMode: true });
  await connect(state);
  const fakeHub = attachFakeStartupProbeHub(state, { failChunkIndex: 0 });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const result = await hub.runStartupProbe("00", 7);
  assert.equal(result.outcome, "failure");
  assert.equal(result.transferResponses.transferChunks[0].ok, false);
  assert.equal(result.transferResponses.programFlowStart, null);
  assert.equal(fakeHub.flowStarts, 0);
});

test("a GATT disconnect after ProgramFlowResponse is distinct from a failed BLE write", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    disconnectAfterProgramFlowResponse: true,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  await assert.rejects(
    state.ext.installHubController({ SLOT: 7 }),
    /disconnected before the controller start was verified/i
  );

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastDisconnect.origin, "gattserverdisconnected");
  assert.equal(diagnostics.controllerStatus, "disconnected");
  assert.equal(
    diagnostics.lastSuccessfulControllerStage.stage,
    "program-flow-response-accepted"
  );
  assert.equal(diagnostics.controllerInstallAttempt.outcome, "interrupted");
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(
    unpackWrittenMessages(state.device.writes).some(
      (message) => message[0] === 0x32
    ),
    false,
    "the extension does not tunnel hello after the GATT connection is gone"
  );
});

test("a Python startup failure is recorded from ConsoleNotification and stop notification", async () => {
  const state = setup();
  await connect(state);
  const startupTraceback = "Traceback: KeyError: module_tunnel";
  const fakeHub = attachFakeControllerHub(state, {
    startupConsoleError: startupTraceback,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  const chainedMotor = state.ext
    .installHubController({ SLOT: 8 })
    .then(() => state.ext.motorStart({ PORT: "A", DIRECTION: 1 }));
  await assert.rejects(
    chainedMotor,
    /stopped before it completed its startup handshake.*KeyError: module_tunnel/i
  );

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerStatus, "startup-error");
  assert.equal(diagnostics.lastProgramFlowNotification.action, "stop");
  assert.match(diagnostics.recentConsoleOutput, /KeyError: module_tunnel/);
  assert.equal(diagnostics.controllerInstallAttempt.outcome, "startup-error");
  assert.equal(
    diagnostics.lastSuccessfulControllerStage.stage,
    "program-flow-response-accepted"
  );
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false,
    "a failed installation must not continue into the next Scratch block"
  );
});

test("a failed ProgramFlow BLE write records its exception and is not labeled a GATT event", async () => {
  const state = setup({ failWriteMessageType: 0x1e });
  await connect(state);
  attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  await assert.rejects(
    state.ext.installHubController({ SLOT: 9 }),
    /simulated fake-device write failure/
  );

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastDisconnect.origin, "ble-write-exception");
  assert.equal(diagnostics.lastWrite.messageType, 0x1e);
  assert.equal(diagnostics.lastWrite.messageName, "ProgramFlowRequest");
  assert.equal(diagnostics.lastWrite.status, "failed");
  assert.match(
    diagnostics.lastWrite.errorStack,
    /simulated fake-device write failure/
  );
  assert.equal(diagnostics.lastTransportError.messageType, 0x1e);
  assert.equal(
    diagnostics.lastTransportError.messageName,
    "ProgramFlowRequest"
  );
  assert.equal(
    diagnostics.controllerInstallAttempt.lastSuccessfulStage,
    "program-upload-complete"
  );
});

test("Scratch hardware command waits for hello readiness and then runs without popups", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    startNotificationDelayMs: 300,
    helloResponseDelayMs: 500,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  let nextBlockStarted = false;
  const command = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics())
        .lastSuccessfulControllerStage?.stage ===
      "program-flow-response-accepted",
    "ProgramFlowResponse should be acknowledged before waiting for start"
  );
  let commandFinished = false;
  const observedCommand = command.then((result) => {
    commandFinished = true;
    nextBlockStarted = true;
    return result;
  });
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(nextBlockStarted, false);
  assert.equal(commandFinished, false);
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false
  );
  state.clock.advance(299);
  await tick();
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(nextBlockStarted, false);
  assert.equal(commandFinished, false);

  state.clock.advance(1);
  await waitUntil(
    () => fakeHub.helloCount === 1,
    "hello should follow start notification"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "checking"
  );
  assert.equal(nextBlockStarted, false);
  assert.equal(commandFinished, false);
  state.clock.advance(499);
  await tick();
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "checking"
  );
  assert.equal(nextBlockStarted, false);
  assert.equal(commandFinished, false);
  state.clock.advance(1);
  await observedCommand;
  assert.equal(nextBlockStarted, true);
  assert.equal(commandFinished, true);
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().controllerSlot,
    0
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  assert.deepEqual(state.confirmationCalls, []);
  assert.deepEqual(state.alertCalls, []);
});

test("Scratch greenFlag's synchronous stop/start pair does not stop the SPIKE controller", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.runtime.brickwrightSpikePrimeControl.prepareInternalController(
    "connection"
  );
  const writesBeforeRun = state.device.writes.length;

  // scratch-vm Runtime.greenFlag() calls stopAll() and then emits
  // PROJECT_START synchronously, before queued Scratch blocks run.
  const motorCommand = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  state.runtime.emit("PROJECT_STOP_ALL");
  const pairedStop = hub._projectStopPromise;
  state.runtime.emit("PROJECT_START");
  await pairedStop;
  await motorCommand;

  assert.equal(fakeHub.running, true);
  assert.equal(hub._controllerReady, true);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  assert.equal(
    fakeHub.receivedCommands.includes("controller.stop_all"),
    false,
    "the paired green-flag event must not send a hub stop command"
  );
  const newMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeRun)
  );
  assert.equal(
    newMessages.some((message) => message[0] === 0x1e && message[1] === 1),
    false,
    "the paired green-flag event must not send ProgramFlow stop"
  );
});

test("a deferred stop and queued command never target a replacement hub", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.runtime.brickwrightSpikePrimeControl.prepareInternalController(
    "connection"
  );

  const queuedMotor = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  state.runtime.emit("PROJECT_STOP_ALL");
  const deferredStop = hub._projectStopPromise;
  const replacementWrites = [];
  hub.attach({
    kind: "gatt",
    isConnected: () => true,
    startNotifications: () => Promise.resolve(),
    write: (_service, _characteristic, data) => {
      replacementWrites.push(Buffer.from(data, "base64"));
      return Promise.resolve();
    },
  });

  await deferredStop;
  await assert.rejects(
    queuedMotor,
    /stopped the pending SPIKE controller command|SPIKE hub changed during controller preparation/i
  );
  assert.equal(fakeHub.running, true);
  assert.deepEqual(replacementWrites, []);
});

test("a rate-limited command cannot leak after a standalone emergency stop", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.runtime.brickwrightSpikePrimeControl.prepareInternalController(
    "connection"
  );
  hub._rateLimiter.reserve = () => 100;
  const writesBeforeCommand = state.device.writes.length;

  const queuedMotor = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await tick();
  state.runtime.emit("PROJECT_STOP_ALL");
  await hub._projectStopPromise;
  await assert.rejects(
    queuedMotor,
    /stopped the pending SPIKE controller command/i
  );
  state.clock.advance(100);
  await tick();

  assert.equal(fakeHub.running, false);
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false,
    "a command waiting in the BLE rate limiter is cancelled by emergency stop"
  );
  const messages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeCommand)
  );
  assert.equal(
    messages.some(
      (message) =>
        message[0] === 0x32 &&
        JSON.parse(Buffer.from(message.slice(3)).toString()).c === "r"
    ),
    false,
    "the delayed motor TunnelMessage must never be written"
  );
});

test("PROJECT_STOP_ALL preempts queued commands, stops hardware and Python, then permits restart", async () => {
  const state = setup();
  await connect(state);
  state.device.tx.emit(
    packMessage(
      notification(bytes(motorRecord({ port: 0 }), motorRecord({ port: 1 })))
    )
  );
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );

  fakeHub.ignoreCommands.add("motor.run");
  const activeMotor = state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  const activeMotorRejected = assert.rejects(
    activeMotor,
    /stopped the pending SPIKE controller command/i
  );
  await waitUntil(
    () => fakeHub.receivedCommands.includes("motor.run"),
    "the active motor command should reach the fake controller"
  );
  const queuedMotor = state.ext.motorStart({ PORT: "B", DIRECTION: 1 });
  const queuedMotorRejected = assert.rejects(
    queuedMotor,
    /stopped the pending SPIKE controller command/i
  );
  const writesBeforeStop = state.device.writes.length;
  state.runtime.emit("PROJECT_STOP_ALL");
  await state.ext._peripheral._spike3._projectStopPromise;
  await Promise.all([activeMotorRejected, queuedMotorRejected]);

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerStatus, "stopped");
  assert.equal(diagnostics.lastStopAttempt.outcome, "success");
  assert.equal(diagnostics.lastStopAttempt.slot, 0);
  assert.equal(
    diagnostics.lastStopAttempt.controllerStop.status,
    "acknowledged"
  );
  assert.equal(
    diagnostics.lastStopAttempt.programFlowStop.status,
    "acknowledged"
  );
  assert.ok(diagnostics.lastStopAttempt.programFlowStoppedAt);
  assert.equal(state.ext._peripheral._spike3._controllerReady, false);
  assert.equal(state.ext._peripheral._spike3._controllerHeartbeatTimer, null);
  assert.equal(
    state.ext.isConnected(),
    true,
    "stop must preserve BLE connection"
  );

  const stopMessages = unpackWrittenMessages(
    state.device.writes.slice(writesBeforeStop)
  );
  const stopTunnelIndex = stopMessages.findIndex((message) => {
    if (message[0] !== 0x32) return false;
    return JSON.parse(Buffer.from(message.slice(3)).toString()).c === "x";
  });
  const stopFlowIndex = stopMessages.findIndex(
    (message) => message[0] === 0x1e && message[1] === 1
  );
  assert.ok(stopTunnelIndex >= 0, "controller.stop_all TunnelMessage sent");
  assert.ok(
    stopFlowIndex > stopTunnelIndex,
    "ProgramFlow stop follows hardware stop"
  );
  assert.equal(
    fakeHub.receivedCommands.includes("motor.run"),
    true,
    "only the already in-flight motor command reaches the hub"
  );
  assert.equal(
    fakeHub.actions.some(
      (action) => action.cmd === "motor.run" && action.port === "B"
    ),
    false,
    "queued motor command is cancelled"
  );

  const afterStop = state.device.writes.length;
  state.runtime.emit("PROJECT_STOP_ALL");
  await tick();
  assert.equal(
    state.device.writes.length,
    afterStop,
    "repeated stop is idempotent"
  );
  fakeHub.ignoreCommands.clear();
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 2 }))));
  const startsBeforeNextUserAction = fakeHub.startCount;
  await state.ext.motorStart({ PORT: "C", DIRECTION: 1 });
  assert.equal(
    fakeHub.startCount,
    startsBeforeNextUserAction + 1,
    "a new Scratch action after red stop reuses the saved controller slot"
  );
  assert.ok(
    fakeHub.actions.some(
      (action) => action.cmd === "motor.run" && action.port === "C"
    )
  );

  await state.ext.installHubController({ SLOT: 0 });
  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await state.ext.setPixel({ X: 2, Y: 2, BRIGHTNESS: 100 });
  assert.equal(fakeHub.running, true, "a new install starts after the stop");
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  assert.ok(fakeHub.actions.some((action) => action.cmd === "matrix.pixel"));
  assert.deepEqual(state.alertCalls, []);
});

test("a timed out controller motor stop still sends ProgramFlow stop and reports partial failure", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  fakeHub.ignoreCommands.add("controller.stop_all");

  state.runtime.emit("PROJECT_STOP_ALL");
  const stopPromise = state.ext._peripheral._spike3._projectStopPromise;
  const rejected = assert.rejects(stopPromise, /stop was not fully confirmed/i);
  await waitUntil(
    () => fakeHub.receivedCommands.includes("controller.stop_all"),
    "the controller should receive the first, priority stop command"
  );
  assert.equal(
    unpackWrittenMessages(state.device.writes).some(
      (message) => message[0] === 0x1e && message[1] === 1
    ),
    false,
    "ProgramFlow stop waits for the controller stop acknowledgement or timeout"
  );
  state.clock.advance(1500);
  await waitUntil(
    () => state.device.writes.length > 0 && !fakeHub.running,
    "ProgramFlow stop should still stop Python after the motor-stop error"
  );
  await rejected;

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastStopAttempt.controllerStop.status, "failed");
  assert.equal(
    diagnostics.lastStopAttempt.programFlowStop.status,
    "acknowledged"
  );
  assert.equal(diagnostics.lastStopAttempt.outcome, "partial-failure");
  assert.equal(diagnostics.controllerStatus, "stop-partial");
  assert.match(diagnostics.lastCommunicationError, /stop/i);
  assert.deepEqual(state.alertCalls, []);
});

test("a failed ProgramFlow stop is not reported as success", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    failProgramFlowStop: true,
    suppressStopNotification: true,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  state.runtime.emit("PROJECT_STOP_ALL");
  const stopPromise = state.ext._peripheral._spike3._projectStopPromise;
  const rejected = assert.rejects(stopPromise, /stop was not fully confirmed/i);
  await tick();
  state.clock.advance(3000);
  await rejected;

  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(fakeHub.running, true);
  assert.equal(
    diagnostics.lastStopAttempt.controllerStop.status,
    "acknowledged"
  );
  assert.equal(diagnostics.lastStopAttempt.programFlowStop.status, "failed");
  assert.equal(diagnostics.lastStopAttempt.programFlowStoppedAt, null);
  assert.equal(diagnostics.lastStopAttempt.outcome, "failure");
  assert.equal(diagnostics.controllerStatus, "stop-unconfirmed");
});

test("a disconnected hub is recorded as an unconfirmed stop, never as success", async () => {
  const state = setup();
  await connect(state);
  attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  state.device.gatt.disconnect();

  state.runtime.emit("PROJECT_STOP_ALL");
  await assert.rejects(
    state.ext._peripheral._spike3._projectStopPromise,
    /not connected/i
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastStopAttempt.outcome, "failure");
  assert.equal(diagnostics.lastStopAttempt.controllerStop.status, "not-sent");
  assert.equal(diagnostics.controllerStatus, "disconnected");
});

test("an emergency stop never targets a replacement hub after reconnect", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  fakeHub.ignoreCommands.add("controller.stop_all");

  state.runtime.emit("PROJECT_STOP_ALL");
  const stopPromise = hub._projectStopPromise;
  const rejected = assert.rejects(stopPromise, /stop was not fully confirmed/i);
  await waitUntil(
    () => fakeHub.receivedCommands.includes("controller.stop_all"),
    "the original hub should receive the priority stop request"
  );

  const replacementWrites = [];
  const replacementLink = {
    kind: "gatt",
    isConnected: () => true,
    startNotifications: () => Promise.resolve(),
    write: (_service, _characteristic, data) => {
      replacementWrites.push(Buffer.from(data, "base64"));
      return Promise.resolve();
    },
  };
  hub.attach(replacementLink);
  hub._onConnect();
  await tick();
  state.clock.advance(1500);
  await rejected;

  const messages = replacementWrites.flatMap((frame) => [unpackMessage(frame)]);
  assert.ok(messages.some((message) => message[0] === 0x00));
  assert.equal(
    messages.some((message) => message[0] === 0x32 || message[0] === 0x1e),
    false,
    "neither controller nor ProgramFlow stop is sent to the replacement hub"
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastStopAttempt.connectionChanged, true);
  assert.equal(diagnostics.lastStopAttempt.outcome, "failure");
  assert.equal(
    diagnostics.controllerStatus,
    "not-verified",
    "the old stop attempt must not overwrite the replacement connection state"
  );
});

test("missing callback-ready console does not send a speculative hello", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    suppressReadyMarker: true,
    ignoreFirstHellos: 1,
  });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const install = state.ext.installHubController({ SLOT: 2 });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics())
        .lastSuccessfulControllerStage?.stage === "program-start-notified",
    "start notification"
  );
  assert.equal(fakeHub.helloCount, 0);
  state.clock.advance(5000);
  await assert.rejects(install, /startup callback was not observed/i);
  assert.equal(fakeHub.helloCount, 0);
  assert.equal(hub._pendingControllerCommands.size, 0);
  assert.equal(
    unpackWrittenMessages(state.device.writes).some(([type]) => type === 0x32),
    false,
    "ProgramFlow start alone does not authorize a Tunnel hello"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerBootEvidence
      .status,
    "not-observed"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerInstallAttempt
      .outcome,
    "not-verified",
    "missing console evidence is not reported as proven execution failure"
  );
});

test("late hello response cannot resolve the next attempt", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    helloResponseDelayMs: 5000,
  });
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  const install = state.ext.installHubController({ SLOT: 2 });
  await waitUntil(() => fakeHub.helloCount === 1, "first hello");
  state.clock.advance(4000);
  await waitUntil(() => fakeHub.helloCount === 2, "second hello");
  state.clock.advance(1000);
  await tick();
  assert.equal(hub._controllerReady, false);
  assert.equal(hub._pendingControllerCommands.size, 1);
  state.clock.advance(3000);
  await waitUntil(() => fakeHub.helloCount === 3, "third hello");
  state.clock.advance(1000);
  await tick();
  assert.equal(hub._controllerReady, false);
  state.clock.advance(3000);
  await assert.rejects(install, /did not acknowledge the command in time/i);
  assert.equal(hub._pendingControllerCommands.size, 0);
});

test("manual controller check can verify an already-running program without clearing or retransferring", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, {
    suppressStartNotification: true,
  });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;

  const install = state.ext.installHubController({ SLOT: 11 });
  await waitUntil(
    () =>
      JSON.parse(state.ext.getCommunicationDiagnostics())
        .lastSuccessfulControllerStage?.stage ===
      "program-flow-response-accepted",
    "the program-start request should be acknowledged"
  );
  state.clock.advance(7000);
  await assert.rejects(install, /ProgramFlowRequest but did not report/i);
  assert.equal(fakeHub.running, true);
  assert.equal(fakeHub.helloCount, 0);

  const beforeCheck = unpackWrittenMessages(state.device.writes);
  const priorClearCount = beforeCheck.filter(
    (message) => message[0] === 0x46
  ).length;
  const priorChunkCount = beforeCheck.filter(
    (message) => message[0] === 0x10
  ).length;
  await assert.rejects(
    state.ext.checkHubController(),
    /hub remains connected|ハブの接続は維持されています/i
  );
  assert.equal(fakeHub.helloCount, 0);
  assert.deepEqual(state.alertCalls, []);
  const afterCheck = unpackWrittenMessages(state.device.writes);
  assert.equal(
    afterCheck.filter((message) => message[0] === 0x46).length,
    priorClearCount
  );
  assert.equal(
    afterCheck.filter((message) => message[0] === 0x10).length,
    priorChunkCount
  );
  assert.equal(
    afterCheck.some((message) => message[0] === 0x32),
    false,
    "a saved slot and a ProgramFlow start notification are not callback-ready proof"
  );
});

test("all normal SPIKE 3 dispatch commands opt into controller preparation", () => {
  const allowlist = source.match(
    /const SPIKE3_CONTROLLER_STARTABLE_COMMANDS = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(allowlist, "controller preparation allowlist exists");
  const allowlisted = new Set(
    [...allowlist[1].matchAll(/"(scratch\.[^"]+)"/g)].map((match) =>
      match[1]
    )
  );
  const dispatchStart = source.indexOf("    _sendCommand(method, params) {");
  const dispatchEnd = source.indexOf("    _speed(value)", dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);
  const handled = new Set(
    [...dispatch.matchAll(/case "(scratch\.[^"]+)"/g)].map(
      (match) => match[1]
    )
  );
  assert.deepEqual([...allowlisted].sort(), [...handled].sort());
});

test("host output blocks are interpreted by the fake controller and return execution acknowledgements", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  await state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  await state.ext.motorStartPower({ PORT: "A", POWER: 1 });
  await state.ext.stopMotor({ PORT: "A", ACTION: "brake" });
  await state.ext._peripheral.active.sendCommand(
    "scratch.motor_run_for_degrees",
    {
      port: "A",
      speed: 20,
      degrees: 90,
    }
  );
  await state.ext.setPixel({ X: 1, Y: 1, BRIGHTNESS: 0 });
  await state.ext.setPixel({ X: 1, Y: 1, BRIGHTNESS: 100 });
  await state.ext.displayClear();
  await state.ext.playBeep({ FREQUENCY: 440, DURATION: 150 });
  await state.ext.stopSound();

  await state.ext._peripheral.active.sendCommand("scratch.motor_stop", {
    port: "A",
    stop_mode: "hold",
  });

  assert.deepEqual(
    fakeHub.actions.map((action) => action.cmd),
    [
      "motor.run",
      "motor.power",
      "motor.stop",
      "motor.run_degrees",
      "matrix.pixel",
      "matrix.pixel",
      "matrix.clear",
      "sound.beep",
      "sound.stop",
      "motor.stop",
    ]
  );
  assert.equal(fakeHub.actions[0].velocity, 788);
  assert.deepEqual(
    [fakeHub.actions[4].brightness, fakeHub.actions[5].brightness],
    [0, 100]
  );
  assert.equal(fakeHub.actions.at(-1).stop_mode, "hold");
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "ready"
  );
});

test("controller serializes simultaneous commands and preserves their order", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  const first = state.ext._peripheral.active.sendCommand(
    "scratch.motor_start",
    {
      port: "A",
      speed: 10,
    }
  );
  const second = state.ext._peripheral.active.sendCommand(
    "scratch.motor_stop",
    {
      port: "A",
      stop: "brake",
    }
  );
  await Promise.all([first, second]);
  assert.deepEqual(
    fakeHub.actions.map((action) => action.cmd),
    ["motor.run", "motor.stop"]
  );
});

test("controller execution failures reach the caller with technical detail", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  fakeHub.rejectCommands.add("motor.run");
  await assert.rejects(
    state.ext.motorStart({ PORT: "A", DIRECTION: 1 }),
    /simulated motor API failure/
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.match(
    diagnostics.lastCommunicationError,
    /simulated motor API failure/
  );
});

test("a controller command timeout fails visibly and is never retried", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });
  fakeHub.ignoreCommands.add("motor.run");

  const writesBefore = state.device.writes.length;
  const command = state.ext._peripheral.active.sendCommand(
    "scratch.motor_start",
    {
      port: "A",
      speed: 10,
    }
  );
  await tick();
  state.clock.advance(4001);
  await assert.rejects(command, /did not acknowledge the command in time/i);
  assert.equal(state.device.writes.length, writesBefore + 1);
  assert.equal(
    fakeHub.actions.some((action) => action.cmd === "motor.run"),
    false
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerStatus, "timeout");
  assert.equal(state.ext.isConnected(), true);
  assert.equal(diagnostics.disconnectCount, 0);
  assert.equal(diagnostics.lastDisconnect, null);
});

test("failed transfer acknowledgement aborts before ProgramFlow starts a program", async () => {
  const state = setup();
  await connect(state);
  attachFakeControllerHub(state, { failChunkIndex: 0 });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  state.context.Scratch.BWConfirm = () => true;
  await assert.rejects(
    state.ext.installHubController({ SLOT: 5 }),
    /Hub rejected program chunk at byte 0/
  );
  const outgoing = unpackWrittenMessages(state.device.writes);
  assert.equal(
    outgoing.some((message) => message[0] === 0x1e),
    false
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).controllerStatus,
    "error"
  );
});

test("malformed StartFileUploadResponse aborts transfer before sending chunks", async () => {
  const state = setup();
  await connect(state);
  attachFakeControllerHub(state, { malformedResponseType: 0x0d });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  state.context.Scratch.BWConfirm = () => true;
  await assert.rejects(
    state.ext.installHubController({ SLOT: 5 }),
    /invalid protocol response length.*expected 2, received 3/
  );
  const outgoing = unpackWrittenMessages(state.device.writes);
  assert.equal(
    outgoing.some((message) => message[0] === 0x10),
    false
  );
  assert.equal(
    outgoing.some((message) => message[0] === 0x1e),
    false
  );
});

test("SPIKE 3.x display text uses acknowledged controller command", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 2 });
  await state.ext.displayText({ TEXT: "Hello" });
  const message = unpackWrittenMessages(state.device.writes)
    .filter((m) => m[0] === 0x32)
    .map((m) => JSON.parse(Buffer.from(m.slice(3)).toString()))
    .find((m) => m.c === "w");
  assert.equal(message.t, "Hello");
  assert.ok(fakeHub.actions.some((action) => action.cmd === "matrix.text"));
  const events = JSON.parse(
    state.ext.getCommunicationDiagnostics()
  ).recentEvents;
  assert.ok(
    events.some(
      (event) =>
        event.type === "controller-text-request" &&
        event.requestId === message.i
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "controller-text-completed" &&
        event.requestId === message.i
    )
  );
  await assert.rejects(
    state.ext.displayText({ TEXT: "x".repeat(33) }),
    /32 UTF-8 bytes/
  );
});

test("the real shared router identifies Essential from an LWP3 property response", async () => {
  const state = setup({ hubKind: "essential" });
  const api = state.runtime.brickwrightSpikePrimeControl;
  assert.ok(api, "the same VM has the SPIKE control API");
  api.setHubModel("essential");
  assert.deepEqual(
    Array.from(api.getState().availablePorts),
    ["A", "B"],
    "Essential ports are known before connecting"
  );
  const controlState = await api.connect("web-ble");
  assert.equal(controlState.connected, true);
  assert.equal(controlState.selectedHubModel, "essential");
  assert.equal(controlState.detectedHubModel, "essential");
  assert.equal(controlState.effectiveHubModel, "essential");
  assert.equal(controlState.standaloneCapable, false);
  assert.deepEqual(Array.from(controlState.availablePorts), ["A", "B"]);
  assert.equal(
    state.ext.isConnected(),
    true,
    "Scratch blocks share the connection"
  );
  const writesBeforeControllerRequest = state.device.writes.length;
  await assert.rejects(api.installController(2));
  assert.equal(
    state.device.writes.length,
    writesBeforeControllerRequest,
    "Essential never attempts a Prime slot transfer"
  );
  assert.deepEqual(
    state.device.writes.slice(0, 3),
    [
      [5, 0, 0x01, 0x0b, 0x05],
      [5, 0, 0x01, 0x03, 0x05],
      [5, 0, 0x01, 0x06, 0x05],
    ],
    "connect queries LWP3 system type, firmware, and battery properties"
  );
});

test("verified connected Prime model overrides a conflicting Essential selection", async () => {
  const state = setup();
  await connect(state);
  state.ext._peripheral.setHubModel("essential");
  const controlState = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(controlState.detectedHubModel, "prime");
  assert.equal(controlState.effectiveHubModel, "prime");
  assert.equal(controlState.modelStatus, "selection-mismatch");
  assert.deepEqual(Array.from(controlState.availablePorts), [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ]);
});

test("Prime model detection stays unknown for truncated or unsupported product-group IDs", () => {
  const truncated = setup().ext._peripheral._spike3;
  truncated._handleInfoResponse(infoResponse().slice(0, 16));
  assert.equal(truncated.detectedHubModel, null);
  assert.equal(truncated.standaloneCapable, false);

  const unsupported = setup().ext._peripheral._spike3;
  const response = infoResponse();
  response[15] = 1;
  unsupported._handleInfoResponse(response);
  assert.equal(unsupported.detectedHubModel, null);
  assert.equal(unsupported.standaloneCapable, false);
});

test("Essential rejects nonexistent ports and executes motor commands on real LWP3 wire messages", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const router = ext._peripheral;
  const motorAttached = [7, 0, 0x04, 0, 0x01, 0x41, 0x00];
  device.emitLWP3(motorAttached);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);

  const inputFormat = device.writes.find((message) => message[2] === 0x41);
  assert.deepEqual(
    inputFormat,
    [10, 0, 0x41, 0, 3, 15, 0, 0, 0, 1],
    "the default absolute-angle stream uses a 15-degree change threshold"
  );
  const writesBeforeInvalidPort = device.writes.length;
  await assert.rejects(
    router.sendCommand("scratch.motor_start", { port: "C", speed: 20 }),
    /only ports A and B exist/
  );
  assert.equal(device.writes.length, writesBeforeInvalidPort);

  device.emitLWP3([6, 0, 0x45, 0, 0xc4, 0xff]); // APOS -60 => 300° normalized
  await tick();
  assert.equal(router.portValues.A.absolutePosition, -60);
  assert.equal(router.portValues.A.position, 300);
  assert.equal(typeof router.portValues.A.receivedAt, "number");
  await new Promise((resolve) => setTimeout(resolve, 3));
  device.emitLWP3([6, 0, 0x45, 0, 0xf6, 0xff]); // APOS -10 => 350° normalized
  await tick();
  assert.equal(router.portValues.A.absolutePosition, -10);
  assert.equal(router.portValues.A.position, 350);
  assert.equal(ext.getPosition({ PORT: "A" }), 350);
  assert.equal(ext.getRelativePosition({ PORT: "A" }), "");
  await router.sendCommand("scratch.motor_start", { port: "A", speed: 25 });
  assert.deepEqual(device.writes.slice(writesBeforeInvalidPort).slice(-3), [
    [9, 0, 0x81, 0, 0x10, 0x05, 0xc2, 0x01, 1],
    [9, 0, 0x81, 0, 0x10, 0x06, 0xc2, 0x01, 1],
    [9, 0, 0x81, 0, 0x11, 0x07, 25, 100, 0x11],
  ]);
  await router.sendCommand("scratch.motor_stop", {
    port: "A",
    stop_mode: "brake",
  });
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 127]);
  await router.stopAll();
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 127]);
});

test("Essential classifies the real Medium Angular Motor ID from AttachedIO", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const router = ext._peripheral;

  // The real reported packet: A attached with DeviceType 0x0030.
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);

  const controlState = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(controlState.portSensors.A.connected, true);
  assert.equal(controlState.portSensors.A.deviceId, 0x30);
  assert.equal(controlState.portSensors.A.deviceType, 0x30);
  assert.equal(controlState.portSensors.A.type, "motor");
  assert.equal(controlState.portSensors.A.deviceName, "Medium Angular Motor");
  assert.equal(controlState.portSensors.A.receivedAt, null);
  assert.equal(controlState.portDevices.A.type, "motor");
  assert.equal(controlState.motorPorts.A.receivedAt, null);

  const modeRequest = device.writes.find(
    (message) => message[2] === 0x41 && message[3] === 0 && message[4] === 3
  );
  assert.deepEqual(modeRequest, [10, 0, 0x41, 0, 3, 15, 0, 0, 0, 1]);

  device.emitLWP3([6, 0, 0x45, 0, 0xc4, 0xff]); // APOS -60 => 300° normalized
  await tick();
  assert.equal(router.portValues.A.absolutePosition, -60);
  assert.equal(typeof router.portValues.A.receivedAt, "number");
  await new Promise((resolve) => setTimeout(resolve, 5));
  device.emitLWP3([6, 0, 0x45, 0, 0xf6, 0xff]); // APOS -10 => 350° normalized
  await tick();
  assert.equal(router.portValues.A.absolutePosition, -10);
  assert.equal(ext.getPosition({ PORT: "A" }), 350);

  const beforeMotorCommand = device.writes.length;
  await router.sendCommand("scratch.motor_start", { port: "A", speed: 25 });
  assert.deepEqual(device.writes.slice(beforeMotorCommand), [
    [9, 0, 0x81, 0, 0x10, 0x05, 0xc2, 0x01, 1],
    [9, 0, 0x81, 0, 0x10, 0x06, 0xc2, 0x01, 1],
    [9, 0, 0x81, 0, 0x11, 0x07, 25, 100, 0x11],
  ]);
  await router.sendCommand("scratch.motor_stop", { port: "A" });
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 127]);
  await router.stopAllMotors();
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 127]);

  assert.equal(router.protocol, "spike3");
  const writesBeforeFailure = device.writes.length;
  device.rx.failNextWrite = true;
  await assert.rejects(
    ext.motorStart({ PORT: "A", DIRECTION: 1 }),
    /simulated fake-device write failure/
  );
  assert.equal(device.writes.length, writesBeforeFailure);
  assert.match(
    JSON.parse(ext.getCommunicationDiagnostics()).lastCommunicationError,
    /simulated fake-device write failure/
  );

  await ext.motorSetSpeed({ PORT: "A", SPEED: 20 });
  await ext.motorStart({ PORT: "A", DIRECTION: 1 });
  assert.deepEqual(
    device.writes.at(-1),
    [9, 0, 0x81, 0, 0x11, 0x07, 20, 100, 0x11]
  );
  await ext.motorStop({ PORT: "A" });
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 127]);
  await ext.stopMotor({ PORT: "A", ACTION: "coast" });
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 0, 0x11, 0x51, 0, 0]);
});

test("Essential uses signed APOS mode 3 for position and keeps cumulative POS separate", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await advertiseEssentialApos(state, 0);
  assert.equal(
    ext._peripheral.portValues.A.absolutePositionStatus,
    "subscribing"
  );
  assert.equal(ext._peripheral.portValues.A.connected, true);
  assert.equal(ext._peripheral.portValues.A.absolutePositionAvailable, false);
  await acknowledgeEssentialApos(state, 0);
  assert.deepEqual(device.writes.at(-1), [5, 0, 0x21, 0, 0]);

  // LEGO's Medium Angular Motor mode 3 VALUE FORMAT is one signed int16.
  device.emitLWP3([6, 0, 0x45, 0, 0x85, 0xff]); // -123 degrees
  await tick();
  const reading = ext._peripheral.portValues.A;
  assert.equal(reading.absolutePositionRaw, -123);
  assert.equal(reading.absolutePosition, -123);
  assert.equal(reading.absolutePositionDecimals, 0);
  assert.equal(reading.absolutePositionAvailable, true);
  assert.equal(reading.position, 237);
  assert.equal(ext.getPosition({ PORT: "A" }), 237);
  assert.equal(ext.getAbsolutePosition({ PORT: "A" }), -123);
  assert.equal(ext.getRelativePosition({ PORT: "A" }), "");
  assert.equal(reading.relativePosition, null);
  assert.equal(reading.speed, null, "APOS alone cannot provide motor speed");
});

test("Essential APOS does not wait for optional mode name, SI range or symbol replies", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  device.emitLWP3([11, 0, 0x43, 0, 0x01, 0x01, 4, 0x0c, 0, 0, 0]);
  device.emitLWP3([10, 0, 0x44, 0, 3, 0x80, 1, 1, 3, 0]);
  await tick();
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xf0, 0xff]); // -16 degrees
  await tick();
  assert.equal(ext._peripheral.portValues.A.absolutePosition, -16);
  assert.equal(ext._peripheral.portValues.A.position, 344);
  assert.equal(ext._peripheral.portValues.A.absolutePositionStatus, "ready");
});

test("Essential APOS honors float32 wire format and display decimals without rescaling", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0, { dataType: 3, decimals: 2 });
  assert.equal(
    device.writes.some((message) => message[2] === 0x41 && message[4] === 3),
    true,
    "a declared float32 APOS format is subscribed"
  );
  await acknowledgeEssentialApos(state, 0);
  const sample = Buffer.alloc(4);
  sample.writeFloatLE(-12.5, 0);
  device.emitLWP3([8, 0, 0x45, 0, ...sample]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.absolutePosition, -12.5);
  assert.equal(ext._peripheral.portValues.A.absolutePositionRaw, -12.5);
  assert.equal(ext._peripheral.portValues.A.absolutePositionDecimals, 2);
  assert.equal(ext.getPosition({ PORT: "A" }), 347.5);
  const validTimestamp =
    ext._peripheral.portValues.A.absolutePositionReceivedAt;
  const nonFinite = Buffer.alloc(4);
  nonFinite.writeFloatLE(Number.NaN, 0);
  device.emitLWP3([8, 0, 0x45, 0, ...nonFinite]);
  device.emitLWP3([6, 0, 0x45, 0, 0, 0]); // wrong width for float32
  await tick();
  assert.equal(ext._peripheral.portValues.A.absolutePosition, -12.5);
  assert.equal(
    ext._peripheral.portValues.A.absolutePositionReceivedAt,
    validTimestamp,
    "non-finite and wrong-width values cannot replace the last valid APOS"
  );
});

test("later unsupported POS format does not erase a valid Essential APOS sample", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xf4, 0xff]); // APOS -12 degrees
  await tick();
  const aposReceivedAt =
    ext._peripheral.portValues.A.absolutePositionReceivedAt;

  device.emitLWP3([10, 0, 0x44, 0, 2, 0x80, 2, 2, 4, 0]);
  await tick();
  const reading = ext._peripheral.portValues.A;
  assert.equal(reading.absolutePosition, -12);
  assert.equal(reading.absolutePositionReceivedAt, aposReceivedAt);
  assert.equal(reading.position, 348);
  assert.equal(ext.getPosition({ PORT: "A" }), 348);
  assert.equal(reading.relativePosition, null);
});

test("Essential communication diagnostics include bounded raw LWP3 TX and RX frames", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xef, 0xff]); // APOS -17 degrees
  await tick();
  const router = ext._peripheral._essential;
  const positionState = router._motorPositionModes.A;
  const failedSetup = {
    locked: false,
    ackWaiter: null,
    singleModeWaiter: null,
  };
  positionState.combinedSetup = failedSetup;
  const writesBeforeFallback = device.writes.length;
  await router._failCombinedPositionMode(
    "A",
    positionState,
    failedSetup,
    new Error("simulated combined-format acknowledgement timeout")
  );
  assert.deepEqual(
    device.writes.slice(writesBeforeFallback).at(-1),
    [10, 0, 0x41, 0, 3, 15, 0, 0, 0, 1],
    "fallback explicitly re-subscribes APOS even if the cached mode was 3"
  );
  const initialFrames = JSON.parse(
    ext.getCommunicationDiagnostics()
  ).recentProtocolFrames;
  assert.ok(
    initialFrames.some(
      (frame) =>
        frame.direction === "rx" &&
        frame.messageType === 0x04 &&
        frame.frameHex === "07000400013000" &&
        frame.port === "A"
    ),
    "the real attached-IO packet is retained with raw bytes"
  );
  assert.ok(
    initialFrames.some(
      (frame) =>
        frame.direction === "tx" &&
        frame.messageType === 0x22 &&
        frame.messageName === "PortModeInformationRequest" &&
        frame.status === "write-completed"
    ),
    "mode setup requests and write result are visible"
  );
  device.rx.failNextWrite = true;
  await assert.rejects(
    router._send([5, 0, 0x21, 0, 0]),
    /simulated fake-device write failure/
  );
  const failedFrame = JSON.parse(
    ext.getCommunicationDiagnostics()
  ).recentProtocolFrames.at(-1);
  assert.equal(failedFrame.messageType, 0x21);
  assert.equal(failedFrame.status, "write-failed");
  assert.match(
    failedFrame.error.message,
    /simulated fake-device write failure/
  );
  for (let index = 0; index < 70; index++) {
    router._recordProtocolFrame(
      "rx",
      [5, 0, 0x45, 0, index & 0xff],
      "received"
    );
  }
  const diagnostics = JSON.parse(ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.recentProtocolFrames.length, 64);
  assert.equal(
    diagnostics.motorPositionModes.A.modeMetadata["3"].format.dataType,
    1,
    "the 0x44 format stays inspectable after older raw frames rotate out"
  );
  assert.equal(
    ext._peripheral.portValues.A.absolutePositionReceivedAt,
    null,
    "failed combined-mode recovery invalidates the old APOS sample"
  );
  assert.equal(
    diagnostics.motorPositionModes.A.aposStatus,
    "subscribing"
  );
  assert.equal(
    diagnostics.motorPositionModes.A.lastAposSource,
    "port-value-mode-3"
  );
  assert.match(
    diagnostics.motorPositionModes.A.combinedFailure,
    /simulated combined-format acknowledgement timeout/
  );
  assert.equal(
    diagnostics.recentProtocolFrames.every(
      (frame) =>
        typeof frame.timestamp === "number" &&
        /^[0-9a-f]+$/.test(frame.frameHex)
    ),
    true
  );
  assert.equal(
    Object.values(diagnostics.recentProtocolFrames).some((frame) =>
      Object.values(frame).some((value) => value && typeof value === "object")
    ),
    false,
    "diagnostics expose only serializable frame metadata"
  );
});

test("Essential POS reset switches modes, confirms POS with a real sample, and restores APOS", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xfa, 0xff]); // -6 degrees
  await tick();
  autoAcknowledgeEssentialPositionModes(state);
  const readsBefore = device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const reset = ext.resetMotorPosition({ PORT: "A", POSITION: 0 });
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x81 && message[5] === 0x51 && message[6] === 2
  ), "POS reset command should run after the verified mode switch");
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length > readsBefore, "POS reset should request a confirming sample");
  device.emitLWP3([8, 0, 0x45, 0, 0, 0, 0, 0]);
  await tick();
  await reset;
  const reading = ext._peripheral.portValues.A;
  assert.equal(reading.absolutePosition, null, "old APOS is invalidated during mode changes");
  assert.equal(reading.position, null);
  assert.equal(reading.relativePosition, null);
  assert.equal(reading.positionResetPending, false);
  assert.equal(reading.positionResetStatus, "confirmed-by-pos-sample");
  assert.equal(
    ext._peripheral._essential._portModes.A,
    3,
    "APOS stream is restored after the POS-only reset operation"
  );
});

test("Essential keeps APOS as the default and does not probe combined mode at attachment", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0, {combinable: true});
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0x85, 0xff]); // -123 degrees
  await tick();
  const peripheral = ext._peripheral._essential;
  assert.equal(peripheral.portValues.A.absolutePosition, -123);
  assert.equal(peripheral.portValues.A.position, 237);
  assert.equal(peripheral._motorPositionModes.A.combinedAttemptCount, 0);
  assert.equal(device.writes.some(message => message[2] === 0x42), false,
    "combined mode is not probed during ordinary attachment");
});
test("Essential switches to verified mode-2 POS on demand and reset restores APOS", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const router = ext._peripheral;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  autoAcknowledgeEssentialPositionModes(state);
  await router._essential._ensureMotorPositionMode("A", 2);
  assert.deepEqual(device.writes.filter(message => message[2] === 0x22 && message[4] === 2).at(-1),
    [6, 0, 0x22, 0, 2, 0x80], "read the POS data format before switching modes");
  assert.deepEqual(device.writes.filter(message => message[2] === 0x41 && message[4] === 2).at(-1),
    [10, 0, 0x41, 0, 2, 1, 0, 0, 0, 1]);
  assert.equal(router.portValues.A.inputFormatStatus, "acknowledged");
  assert.equal(router.portValues.A.inputMode, 2);
  assert.equal(router.portValues.A.inputDelta, 1);

  // 0x45 POS payload is an int32 little-endian value. It must not be reduced
  // modulo 360 into a fabricated APOS angle.
  device.emitLWP3([8, 0, 0x45, 0, 0x90, 0x01, 0, 0]); // +400 degrees
  await tick();
  assert.equal(router.portValues.A.relativePosition, 400);
  assert.equal(
    router.portValues.A.position,
    null,
    "POS is not an absolute angle"
  );
  assert.equal(router.portValues.A.degreesCounted, 400);
  assert.equal(router.portValues.A.absolutePosition ?? null, null);
  assert.equal(router.portValues.A.absolutePositionAvailable, false);
  assert.equal(ext.getPosition({ PORT: "A" }), "");
  assert.equal(ext.getRelativePosition({ PORT: "A" }), 400);
  assert.equal(ext.getAbsolutePosition({ PORT: "A" }), "");

  await new Promise((resolve) => setTimeout(resolve, 5));
  device.emitLWP3([8, 0, 0x45, 0, 0xe7, 0xff, 0xff, 0xff]); // -25 degrees
  await tick();
  assert.equal(router.portValues.A.relativePosition, -25);
  assert.equal(router.portValues.A.position, null);
  assert.ok(router.portValues.A.speed < 0, "reverse delta is negative speed");

  const readsBeforeReset = device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const reset = ext.resetMotorPosition({ PORT: "A", POSITION: 10 });
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x81 && message[5] === 0x51 && message[6] === 2
  ), "the POS reset command should be sent");
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length > readsBeforeReset, "POS reset waits for a fresh sample");
  device.emitLWP3([8, 0, 0x45, 0, 10, 0, 0, 0]);
  await tick();
  await reset;
  assert.deepEqual(
    device.writes
      .filter(
        (message) =>
          message[2] === 0x81 && message[5] === 0x51 && message[6] === 2
      )
      .at(-1),
    [11, 0, 0x81, 0, 0x11, 0x51, 2, 10, 0, 0, 0]
  );
  assert.equal(router.portValues.A.positionResetPending, false);
  assert.equal(router.portValues.A.relativePosition, null, "the POS sample is invalidated when APOS is restored");
  assert.equal(router.portValues.A.position, null);
  assert.equal(ext.getPosition({ PORT: "A" }), "");
  assert.equal(router._essential._portModes.A, 3, "APOS notifications are restored after reset");
});

test("Essential supports the Small and Large Angular Motor IDs through one table", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const router = ext._peripheral;

  for (const [portId, deviceType, expectedName] of [
    [0, 0x41, "Small Angular Motor"],
    [1, 0x31, "Large Angular Motor"],
  ]) {
    device.emitLWP3([7, 0, 0x04, portId, 0x01, deviceType, 0]);
    await tick();
    await acknowledgeEssentialMotorPositionMode(state, portId);
    const port = portId === 0 ? "A" : "B";
    assert.equal(router.portValues[port].connected, true);
    assert.equal(router.portValues[port].type, "motor");
    assert.equal(router.portValues[port].deviceId, deviceType);
    assert.equal(router.portValues[port].deviceName, expectedName);
    device.emitLWP3([6, 0, 0x45, portId, 0x88, 0xff]); // -120 degrees APOS
    await tick();
    assert.equal(router.portValues[port].absolutePosition, -120);
    assert.equal(router.portValues[port].position, 240);
    assert.equal(router.portValues[port].relativePosition, null);
    await router.sendCommand("scratch.motor_start", { port, speed: -10 });
    await router.sendCommand("scratch.motor_stop", {
      port,
      stop_mode: "coast",
    });
  }
  await router.stopAllMotors();
  assert.deepEqual(device.writes.at(-1), [8, 0, 0x81, 1, 0x11, 0x51, 0, 127]);
});

test("Essential rejects an unverified POS wire format without disturbing APOS", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xf6, 0xff]); // APOS -10 degrees
  await tick();
  const essential = ext._peripheral._essential;
  const switching = essential._ensureMotorPositionMode("A", 2);
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === 0 && message[4] === 2
  ), "POS format request");
  device.emitLWP3([10, 0, 0x44, 0, 2, 0x80, 1, 1, 3, 0]); // int16 is not POS int32
  await assert.rejects(switching, error => error.code === "ERR_POS_MODE_UNAVAILABLE");
  assert.equal(device.writes.some(message => message[2] === 0x41 && message[4] === 2), false);
  assert.equal(essential.portValues.A.absolutePosition, -10);
  assert.equal(essential.portValues.A.position, 350);
  assert.equal(essential.portValues.A.connected, true);
  assert.equal(JSON.parse(ext.getCommunicationDiagnostics()).lastCommunicationError, null);
});

test("Essential does not switch to POS when mode-2 format metadata never arrives", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  const essential = ext._peripheral._essential;
  const switching = essential._ensureMotorPositionMode("A", 2);
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[4] === 2
  ), "POS format request");
  state.clock.advance(901);
  await assert.rejects(switching, /timed out/);
  assert.equal(device.writes.some(message => message[2] === 0x41 && message[4] === 2), false);
  assert.equal(essential._portModes.A, 3, "the verified APOS stream remains selected");
  assert.equal(essential.portValues.A.position, null);
});
test("Essential motor reset waits for a fresh POS sample after the reset write", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0xc4, 0xff]);
  await tick();
  autoAcknowledgeEssentialPositionModes(state);

  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  let injected = false;
  let resetCommandSent = false;
  device.rx.writeValueWithoutResponse = async (packet) => {
    await originalWrite(packet);
    const message = device.writes.at(-1);
    if (message[2] === 0x81 && message[5] === 0x51 && message[6] === 2) {
      resetCommandSent = true;
    }
    if (resetCommandSent && !injected && message[2] === 0x21 && message[4] === 0) {
      injected = true;
      device.emitLWP3([8, 0, 0x45, 0, 0x55, 0, 0, 0]);
    }
  };

  await ext.resetMotorPosition({ PORT: "A", POSITION: 0 });
  assert.equal(injected, true);
  assert.equal(ext._peripheral.portValues.A.relativePosition, null);
  assert.equal(ext._peripheral.portValues.A.position, null);
  assert.equal(ext._peripheral.portValues.A.positionResetPending, false);
  assert.equal(ext._peripheral.portValues.A.receivedAt, null);
});

test("Essential motor reset does not overwrite a detach or replacement attachment", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  autoAcknowledgeEssentialPositionModes(state);

  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  let detached = false;
  device.rx.writeValueWithoutResponse = async (packet) => {
    await originalWrite(packet);
    const message = device.writes.at(-1);
    if (
      !detached &&
      message[2] === 0x81 &&
      message[5] === 0x51 &&
      message[6] === 2
    ) {
      detached = true;
      device.emitLWP3([5, 0, 0x04, 0, 0]);
      device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x41, 0]);
    }
  };

  await assert.rejects(ext.resetMotorPosition({ PORT: "A", POSITION: 0 }), error =>
    error.code === "ERR_MOTOR_ANGLE_CANCELLED"
  );
  assert.equal(detached, true);
  assert.equal(ext._peripheral.portValues.A.connected, true);
  assert.equal(ext._peripheral.portValues.A.deviceId, 0x41);
  assert.equal(ext._peripheral.portValues.A.receivedAt, null);
  assert.equal(Object.hasOwn(ext._peripheral.portValues.A, "position"), false);
});

test("Essential ignores duplicate metadata and rejects a mismatched mode-2 setup acknowledgement", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  const essential = ext._peripheral._essential;
  const modeRequestsBeforeDuplicate = device.writes.filter(message => message[2] === 0x41).length;
  device.emitLWP3([10, 0, 0x44, 0, 2, 0x80, 1, 2, 4, 0]); // unsolicited POS format
  device.emitLWP3([10, 0, 0x44, 0, 3, 0x80, 1, 1, 3, 0]); // duplicate APOS format
  await tick();
  assert.equal(device.writes.filter(message => message[2] === 0x41).length, modeRequestsBeforeDuplicate);

  const switching = essential._ensureMotorPositionMode("A", 2);
  await waitUntil(() => device.writes.some(message => message[2] === 0x22 && message[4] === 2), "POS format request");
  device.emitLWP3([10, 0, 0x44, 0, 2, 0x80, 1, 2, 4, 0]);
  await waitUntil(() => device.writes.some(message => message[2] === 0x41 && message[4] === 2), "POS input format request");
  const writesBeforeMismatchedAck = device.writes.length;
  device.emitLWP3([10, 0, 0x47, 0, 2, 2, 0, 0, 0, 0]);
  await assert.rejects(switching, /rejected mode 2/);
  const port = essential.portValues.A;
  assert.equal(port.inputFormatStatus, "rejected-or-mismatched");
  assert.equal(port.inputMode, 2);
  assert.equal(port.inputDelta, 1);
  assert.equal(port.notificationsEnabled, true);
  assert.equal(port.inputFormatResponse.mode, 2);
  assert.equal(port.inputFormatResponse.delta, 2);
  assert.equal(port.inputFormatResponse.notificationEnabled, false);
  assert.equal(typeof port.inputFormatResponse.receivedAt, "number");
  assert.equal(device.writes.slice(writesBeforeMismatchedAck).some(message => message[2] === 0x21), false,
    "mismatched setup acknowledgement does not issue a value request");
});
test("Essential separates unsupported commands and missing motors from link failures", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const router = state.ext._peripheral;

  await assert.rejects(
    router.sendCommand("scratch.motor_start", { port: "A", speed: 10 }),
    (error) =>
      error.code === "ERR_SPIKE_DEVICE_NOT_CONNECTED" &&
      error.kind === "device-not-connected"
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastCommunicationError,
    null
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastDeviceError.code,
    "ERR_SPIKE_DEVICE_NOT_CONNECTED"
  );

  state.device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x3d, 0]);
  await tick();
  const writesBeforeUnsupportedDevice = state.device.writes.length;
  await assert.rejects(
    router.sendCommand("scratch.motor_start", { port: "A", speed: 10 }),
    (error) =>
      error.code === "ERR_SPIKE_DEVICE_UNSUPPORTED" &&
      error.kind === "unsupported-device"
  );
  assert.equal(state.device.writes.length, writesBeforeUnsupportedDevice);
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastCommunicationError,
    null
  );
  assert.equal(
    JSON.parse(state.ext.getCommunicationDiagnostics()).lastDeviceError.kind,
    "unsupported-device"
  );

  await assert.rejects(
    router.sendPythonCommand("print('not supported')"),
    (error) =>
      error.code === "ERR_SPIKE_UNSUPPORTED_CAPABILITY" &&
      error.kind === "unsupported-capability"
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.lastCommunicationError, null);
  assert.equal(
    diagnostics.lastUnsupportedOperation.code,
    "ERR_SPIKE_UNSUPPORTED_CAPABILITY"
  );
});

test("Essential toolbox availability follows model selection without removing registered opcodes", async () => {
  const state = setup({ hubKind: "essential" });
  const api = state.runtime.brickwrightSpikePrimeControl;
  const emitted = [];
  state.runtime.on(api.modelChangeEvent, (event) => emitted.push(event));

  api.setHubModel("essential");
  assert.deepEqual(Array.from(state.ext.getPortMenu()), ["A", "B"]);
  assert.equal(state.ext.getInfo().menus.PORT.items, "getPortMenu");
  assert.ok(api.getSupportedBlockOpcodes("essential").includes("motorStart"));
  assert.ok(
    !api.getSupportedBlockOpcodes("essential").includes("installHubController")
  );
  const essentialOpcodes = api.getSupportedBlockOpcodes();
  assert.ok(essentialOpcodes.includes("motorStart"));
  assert.ok(essentialOpcodes.includes("setLightMatrixPixel"));
  assert.ok(!essentialOpcodes.includes("installHubController"));
  assert.ok(!essentialOpcodes.includes("displayText"));
  assert.ok(!essentialOpcodes.includes("setPixel"));
  assert.ok(
    state.ext
      .getInfo()
      .blocks.some((block) => block.opcode === "installHubController"),
    "the opcode remains registered for existing workspace blocks"
  );
  assert.ok(emitted.some((event) => event.reason === "hub-model-selected"));
  await connectEssential(state);
  assert.equal(api.getState().effectiveHubModel, "essential");
  assert.ok(
    emitted.some(
      (event) =>
        event.reason === "hub-model-detected" &&
        event.effectiveHubModel === "essential" &&
        event.supportedBlockOpcodes.includes("motorStart") &&
        !event.supportedBlockOpcodes.includes("installHubController")
    ),
    "the toolbox refresh event carries the detected Essential model and supported blocks"
  );

  const primeState = setup();
  const primeAPI = primeState.runtime.brickwrightSpikePrimeControl;
  primeAPI.setHubModel("prime");
  assert.deepEqual(Array.from(primeState.ext.getPortMenu()), [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ]);
  assert.ok(
    primeAPI.getSupportedBlockOpcodes().includes("installHubController")
  );
  assert.ok(primeAPI.getSupportedBlockOpcodes().includes("setPixel"));
});

test("Essential sensor feeds update color, distance, and force reporters and hats", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x3d, 0]);
  device.emitLWP3([7, 0, 0x04, 1, 0x01, 0x3e, 0]);
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === 0 && message[4] === 0
  ), "color sensor mode setup");
  device.emitLWP3([10, 0, 0x47, 0, 0, 1, 0, 0, 0, 1]);
  await tick();
  await acknowledgeEssentialDistance(state, 1);
  device.emitLWP3([5, 0, 0x45, 0, 9]);
  device.emitLWP3([6, 0, 0x45, 1, 0xd2, 0x04]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.color, 9);
  assert.equal(ext.getColor({ PORT: "A" }), "red");
  assert.equal(ext.whenColor({ PORT: "A", COLOR: "red" }), true);
  assert.equal(ext._peripheral.portValues.B.distanceMM, 1234);
  assert.equal(ext._peripheral.portValues.B.distance, 123.4);
  assert.equal(ext.getDistance({ PORT: "B" }), 123.4);
  device.emitLWP3([6, 0, 0x45, 1, 40, 0]);
  await tick();
  assert.equal(ext._peripheral.portValues.B.rawValue, 40);
  assert.equal(ext._peripheral.portValues.B.quality, "out-of-range");
  assert.equal(ext._peripheral.portValues.B.distanceMM, null);
  assert.equal(ext.getDistance({ PORT: "B" }), "");
  assert.equal(ext.isDistanceCompared({PORT: "B", DISTANCE: 10, UNIT: "cm", RELATION: "near"}), false);

  device.emitLWP3([5, 0, 0x04, 0, 0x00]);
  const forceSetupCount = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === 0 && message[4] === 0
  ).length;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x3f, 0]);
  await tick();
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === 0 && message[4] === 0
  ).length > forceSetupCount, "force sensor mode setup");
  device.emitLWP3([10, 0, 0x47, 0, 0, 1, 0, 0, 0, 1]);
  await tick();
  device.emitLWP3([5, 0, 0x45, 0, 24]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.force, 24);
  assert.equal(ext.getForce({ PORT: "A" }), 24);
  assert.equal(ext._peripheral.portValues.A.pressed, true);
  assert.equal(ext.whenForceSensor({ PORT: "A", STATE: "hard pressed" }), true);
  assert.equal(ext.whenForceSensor({ PORT: "A", STATE: "pressed" }), true);
});

test("Essential Port Information requests enforce rolling hub and per-port limits at GATT writes", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  const essential = ext._peripheral._essential;
  essential._devices.A = {type: "sensor", attachmentId: "rate-A"};
  essential._devices.B = {type: "sensor", attachmentId: "rate-B"};
  const writes = [];
  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  device.rx.writeValueWithoutResponse = async packet => {
    const message = Array.from(packet);
    if (message[2] === 0x21 && message[4] === 0) {
      writes.push({port: message[3] === 0 ? "A" : "B", at: clock._now});
    }
    await originalWrite(packet);
  };

  const requests = [
    ...Array.from({length: 31}, () => "A"),
    ...Array.from({length: 20}, () => "B"),
  ].map(port => essential._send(
    [5, 0, 0x21, port === "A" ? 0 : 1, 0],
    {expiresInMs: 10000}
  ));
  await settleWithFakeClock(requests, clock);

  const maximumWithinRollingWindow = (entries, port = null) => {
    const selected = port ? entries.filter(entry => entry.port === port) : entries;
    return Math.max(0, ...selected.map(start =>
      selected.filter(entry => entry.at >= start.at && entry.at - start.at < 1000).length
    ));
  };
  assert.equal(writes.length, 51, "all nonexpired demands eventually reach the transport");
  assert.ok(maximumWithinRollingWindow(writes) <= 40, "hub never exceeds 40 writes in a rolling second");
  assert.ok(maximumWithinRollingWindow(writes, "A") <= 30, "port A never exceeds 30 writes in a rolling second");
  assert.ok(maximumWithinRollingWindow(writes, "B") <= 30, "port B never exceeds 30 writes in a rolling second");
  assert.ok(writes.some(write => write.at >= 1000), "rate-limited requests are deferred until capacity returns");
});

test("Essential motor output bypasses a rate-limited sensor read without exceeding the read limit", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  const essential = ext._peripheral._essential;
  essential._devices.A = {type: "motor", attachmentId: "priority-A"};
  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  const writeOrder = [];
  let releaseFirstWrite;
  let signalFirstWrite;
  const firstWriteStarted = new Promise(resolve => { signalFirstWrite = resolve; });
  const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
  device.rx.writeValueWithoutResponse = async packet => {
    const message = Array.from(packet);
    writeOrder.push({message, at: clock._now});
    if (writeOrder.length === 1) {
      signalFirstWrite();
      await firstWriteGate;
    }
    await originalWrite(packet);
  };

  const firstRead = essential._send([5, 0, 0x21, 0, 0], {expiresInMs: 5000});
  await firstWriteStarted;
  const queuedReads = Array.from({length: 30}, () => essential._send(
    [5, 0, 0x21, 0, 0], {expiresInMs: 5000}
  ));
  const motorCommand = essential._output("A", 0x01, [0], false);
  releaseFirstWrite();
  await settleWithFakeClock([firstRead, ...queuedReads, motorCommand], clock);

  const motorIndex = writeOrder.findIndex(entry => entry.message[2] === 0x81);
  assert.ok(motorIndex >= 0, "motor output is present in the GATT write log");
  assert.ok(motorIndex < writeOrder.length - 1, "motor output is not queued behind deferred sensor reads");
  assert.equal(writeOrder[motorIndex].at, 1000, "first blocked read consumes the per-port window before remaining reads");
  const readWrites = writeOrder.filter(entry => entry.message[2] === 0x21 && entry.message[4] === 0);
  assert.ok(readWrites.length <= 31, "only the 30-per-second quota plus the initial write is emitted");
});

test("Essential recovery requires five uninterrupted seconds of valid frames", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0, 0]);
  await tick();

  const essential = ext._peripheral._essential;
  const poll = essential._sensorPollStates.A;
  poll.activeUntil = essential._monotonicNow() + 20000;
  poll.currentPollIntervalMs = 200;
  poll.communicationState = "RECOVERY";
  poll.consecutiveTimeouts = 4;
  poll.stableSince = essential._monotonicNow() - 6000;
  poll.lastValidFrameAt = essential._monotonicNow() - 1000;
  poll.nextDueAt = Infinity;
  device.emitLWP3([6, 0, 0x45, 0, 1, 0]);
  await tick();
  assert.equal(poll.stableSince, essential._monotonicNow(), "a frame after a one-second gap restarts stability");
  assert.equal(poll.currentPollIntervalMs, 200, "one recovered frame does not reduce backoff");

  clock.advance(5000);
  essential._runSensorPollScheduler();
  assert.equal(poll.stableSince, null, "the scheduler expires a stale recovery interval");
  device.emitLWP3([6, 0, 0x45, 0, 2, 0]);
  await tick();
  assert.equal(poll.currentPollIntervalMs, 200, "a single frame after stale expiry is insufficient");

  for (let sample = 1; sample <= 50; sample++) {
    clock.advance(100);
    device.emitLWP3([6, 0, 0x45, 0, sample & 0xff, 0]);
    await tick();
  }
  assert.equal(poll.currentPollIntervalMs, 100, "five seconds of continuous valid frames halves a 200 ms backoff");
  assert.equal(poll.communicationState, "RECOVERY", "a remaining backoff stage is not reported as fully normal");
});

test("Essential polling is demand-aware, fair, bounded, and reports recovery", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  const essential = ext._peripheral._essential;
  for (const [portId, type] of [[0, 0x30], [1, 0x31]]) {
    device.emitLWP3([7, 0, 0x04, portId, 0x01, type, 0]);
    await tick();
    await acknowledgeEssentialApos(state, portId);
    device.emitLWP3([6, 0, 0x45, portId, 0, 0]);
    await tick();
  }
  const pollA = essential._sensorPollStates.A;
  const pollB = essential._sensorPollStates.B;
  assert.equal(pollA.currentPollIntervalMs, 200, "idle interval is 200 ms");
  ext.getPosition({PORT: "A"});
  ext.getPosition({PORT: "B"});
  assert.equal(pollA.currentPollIntervalMs, 25, "an active reporter enters the 25 ms target");
  const now = essential._monotonicNow();
  for (const poll of [pollA, pollB]) {
    poll.lastSampleMonotonicAt = now - 60;
    poll.nextDueAt = now;
  }
  const readsBefore = device.writes.filter(message => message[2] === 0x21).length;
  essential._runSensorPollScheduler();
  await tick();
  if (!pollA.pending) {
    clock.advance(34);
    await tick();
  }
  assert.ok(pollA.pending, "round-robin begins with A");
  essential._runSensorPollScheduler();
  assert.equal(pollA.pollsSent, 1, "the same port never has two reads in flight");
  clock.advance(25);
  await tick();
  assert.ok(pollB.pending, "the second stale port gets the next global slot");
  assert.equal(device.writes.filter(message => message[2] === 0x21).length, readsBefore + 2);
  assert.ok(pollA.pollsSent <= 1 && pollB.pollsSent <= 1);

  for (const poll of [pollA, pollB]) {
    if (poll.pending?.timeout) clock.clearTimeout(poll.pending.timeout);
    poll.pending = null;
  }
  if (essential._sensorPollTimer) clock.clearTimeout(essential._sensorPollTimer);
  essential._sensorPollTimer = null;
  pollA.activeUntil = essential._monotonicNow() + 1000;
  for (const [expectedState, expectedInterval] of [
    ["NORMAL", 50], ["DEGRADED", 50], ["BACKOFF", 100], ["RECOVERY", 200]
  ]) {
    essential._sendSensorPoll(pollA);
    await tick();
    const pendingTimeoutId = pollA.pending?.timeout;
    assert.ok(Number.isInteger(pendingTimeoutId), "poll has a bounded response timeout");
    const timeout = clock._tasks.get(pendingTimeoutId);
    assert.ok(timeout, "poll timeout is registered with the fake clock");
    timeout.callback();
    clock.clearTimeout(pendingTimeoutId);
    assert.equal(pollA.communicationState, expectedState);
    assert.equal(pollA.currentPollIntervalMs, expectedInterval);
    pollA.nextDueAt = essential._monotonicNow();
  }
  for (const expectedInterval of [100, 50, 25]) {
    pollA.stableSince = essential._monotonicNow() - 5001;
    device.emitLWP3([6, 0, 0x45, 0, 1, 0]);
    await tick();
    assert.equal(pollA.currentPollIntervalMs, expectedInterval);
  }
  assert.equal(pollA.communicationState, "NORMAL");
  const telemetry = JSON.parse(ext.getCommunicationDiagnostics()).portSensors.A.sensorTelemetry;
  assert.equal(telemetry.communicationState, "NORMAL");
  assert.equal(telemetry.samplesReceived >= 2, true);
});

test("Essential queued sensor reads do not start the sample timeout before GATT write completion", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0, 0]);
  await tick();

  const essential = ext._peripheral._essential;
  const poll = essential._sensorPollStates.A;
  let signalBlockedWrite;
  let releaseBlockedWrite;
  const blockedWriteStarted = new Promise(resolve => {
    signalBlockedWrite = resolve;
  });
  const blockedWrite = new Promise(resolve => {
    releaseBlockedWrite = resolve;
  });
  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  let blockFirstWrite = true;
  device.rx.writeValueWithoutResponse = async packet => {
    if (blockFirstWrite) {
      blockFirstWrite = false;
      signalBlockedWrite();
      await blockedWrite;
    }
    await originalWrite(packet);
  };

  const blocker = essential._send([5, 0, 0x21, 1, 0], {priority: 100});
  await blockedWriteStarted;
  const queuedPoll = essential._sendSensorPoll(poll);
  await tick();
  assert.equal(poll.pending.state, "QUEUED");
  assert.equal(poll.pending.timeout, null, "queue wait has no sample timeout");
  assert.equal(poll.noSampleCount, 0);

  await new Promise(resolve => setTimeout(resolve, 275));
  releaseBlockedWrite();
  await Promise.all([blocker, queuedPoll]);
  assert.equal(poll.pending, null);
  assert.equal(poll.state, "EXPIRED");
  assert.equal(poll.queuedExpirations, 1);
  assert.equal(poll.noSampleCount, 0, "queue expiry is not a missing sample");
  assert.equal(poll.communicationState, "NORMAL");
});

test("Essential detachment cancels a queued sensor read before its GATT write", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialApos(state, 0);
  device.emitLWP3([6, 0, 0x45, 0, 0, 0]);
  await tick();
  const essential = ext._peripheral._essential;
  const poll = essential._sensorPollStates.A;
  if (essential._sensorPollTimer) state.clock.clearTimeout(essential._sensorPollTimer);
  essential._sensorPollTimer = null;
  poll.nextDueAt = Infinity;

  let releaseBlockedWrite;
  let signalBlockedWrite;
  const blockedWriteStarted = new Promise(resolve => { signalBlockedWrite = resolve; });
  const blockedWriteGate = new Promise(resolve => { releaseBlockedWrite = resolve; });
  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  const baselineWrites = device.writes.length;
  let blockNextWrite = true;
  device.rx.writeValueWithoutResponse = async packet => {
    if (blockNextWrite) {
      blockNextWrite = false;
      signalBlockedWrite();
      await blockedWriteGate;
    }
    await originalWrite(packet);
  };

  const blocker = essential._send([5, 0, 0x22, 1, 0x80], {priority: 100});
  await blockedWriteStarted;
  const queuedPoll = essential._sendSensorPoll(poll);
  await tick();
  const queuedRequest = poll.pending;
  assert.equal(queuedRequest.state, "QUEUED");
  device.emitLWP3([5, 0, 0x04, 0, 0x00]);
  await tick();
  assert.equal(queuedRequest.state, "CANCELLED");
  assert.equal(essential._sensorPollStates.A, undefined, "detached port state is removed");
  releaseBlockedWrite();
  await Promise.all([blocker, queuedPoll]);
  const staleReads = device.writes.slice(baselineWrites)
    .map(message => Uint8Array.from(message))
    .filter(message => message[2] === 0x21 && message[3] === 0);
  assert.equal(staleReads.length, 0, "the cancelled queued request never reaches the GATT characteristic");
});

test("Essential distance mode switches validate DISTL/DISTS and publish only fresh in-range samples", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  const portId = 1;
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3e, 0]);
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 0 && message[5] === 0x80
  ), "DISTL VALUE FORMAT query");
  emitEssentialModeMetadata(state, portId, 0, {
    name: "DISTL", dataSets: 1, dataType: 1, decimals: 1,
    symbol: "cm", min: 0, max: 250,
  });
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ), "DISTL input mode setup");
  const distlSetup = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 0, ...distlSetup.slice(5)]);
  await tick();

  device.emitLWP3([6, 0, 0x45, portId, 50, 0]);
  await tick();
  assert.equal(ext.getDistance({PORT: "B"}), 5, "50 mm is the inclusive lower limit");
  for (const [millimeters, expectedCm] of [[49, ""], [50, 5], [400, 40], [2000, 200], [2001, ""]]) {
    device.emitLWP3([6, 0, 0x45, portId, millimeters & 0xff, millimeters >> 8]);
    await tick();
    assert.equal(ext.getDistance({PORT: "B"}), expectedCm,
      `DISTL ${millimeters} mm uses the documented 50..2000 mm range`);
    assert.equal(ext._peripheral.portValues.B.distanceMM,
      millimeters >= 50 && millimeters <= 2000 ? millimeters : null);
  }

  const switchToDists = ext._peripheral.setDistanceSensorMode("B", 1);
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 1 && message[5] === 0x80
  ), "DISTS VALUE FORMAT query");
  emitEssentialModeMetadata(state, portId, 1, {
    name: "DISTS", dataSets: 1, dataType: 1, decimals: 1,
    symbol: "cm", min: 0, max: 32,
  });
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ), "DISTS input mode setup");
  assert.equal(ext.getDistance({PORT: "B"}), "", "old mode sample is invalidated on switch");
  const distsSetup = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 1, ...distsSetup.slice(5)]);
  await switchToDists;
  assert.equal(ext._peripheral._essential._devices.B.distanceMode, 1);
  assert.equal(ext._peripheral._essential._portModes.B, 1);
  device.emitLWP3([6, 0, 0x45, portId, 300 & 0xff, 300 >> 8]);
  await tick();
  assert.equal(ext.getDistance({PORT: "B"}), 30);
  device.emitLWP3([6, 0, 0x45, portId, 50, 0]);
  await tick();
  assert.equal(ext.getDistance({PORT: "B"}), 5, "DISTS 50 mm is the inclusive lower limit");
  device.emitLWP3([6, 0, 0x45, portId, 301 & 0xff, 301 >> 8]);
  await tick();
  assert.equal(ext.getDistance({PORT: "B"}), "", "DISTS values over 300 mm are out of range");
  assert.equal(ext._peripheral.portValues.B.distanceMM, null);
  assert.equal(ext._peripheral.portValues.B.rawValue, 301, "raw sample remains diagnostic");
  device.emitLWP3([6, 0, 0x45, portId, 49, 0]);
  await tick();
  assert.equal(ext.getDistance({PORT: "B"}), "", "DISTS 49 mm is below the documented range");
  assert.equal(ext._peripheral.portValues.B.distanceMM, null);

  // A second request arriving while the first mode's 0x47 is pending is
  // serialized and the last requested mode wins.
  const switchToDistl = ext._peripheral.setDistanceSensorMode("B", 0);
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).length > 1, "serialized DISTL input mode setup");
  const latestRequest = ext._peripheral.setDistanceSensorMode("B", 1);
  const distlSwitch = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 0, ...distlSwitch.slice(5)]);
  await tick();
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ).length > 1, `last requested DISTS mode setup (${JSON.stringify({
    writes: device.writes.filter(message => message[2] === 0x41 && message[3] === portId),
    deviceMode: ext._peripheral._essential._devices.B.distanceMode,
    requestedMode: ext._peripheral._essential._devices.B.requestedDistanceMode,
    switching: Boolean(ext._peripheral._essential._devices.B.distanceModeSwitchPromise),
  })})`);
  const finalDists = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 1, ...finalDists.slice(5)]);
  await Promise.all([switchToDistl, latestRequest]);
  assert.equal(ext._peripheral._essential._devices.B.distanceMode, 1);
});

test("Essential distance mode request cannot configure a replacement attachment", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  const portId = 1;
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3e, 0]);
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 0 && message[5] === 0x80
  ), "initial DISTL format query");
  emitEssentialModeMetadata(state, portId, 0, {
    name: "DISTL", dataSets: 1, dataType: 1, decimals: 1,
    symbol: "cm", min: 0, max: 250,
  });
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ), "initial DISTL mode setup");
  const initialSetup = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 0, ...initialSetup.slice(5)]);
  await tick();

  const writesBeforeSwitch = device.writes.length;
  const staleSwitch = ext._peripheral.setDistanceSensorMode("B", 1);
  const staleSwitchOutcome = staleSwitch.then(() => null, error => error);
  await waitUntil(() => device.writes.slice(writesBeforeSwitch).some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 1 && message[5] === 0x80
  ), "replacement-race DISTS metadata query");
  const oldAttachmentId = ext._peripheral._essential._devices.B.attachmentId;
  device.emitLWP3([5, 0, 0x04, portId, 0x00]);
  await tick();
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3e, 0]);
  await tick();
  const newDevice = ext._peripheral._essential._devices.B;
  assert.notEqual(newDevice.attachmentId, oldAttachmentId);
  const replacementAttachmentId = newDevice.attachmentId;
  const error = await staleSwitchOutcome;
  assert.match(error.message, /detached|changed/i);
  await tick();
  assert.equal(ext._peripheral._essential._devices.B.attachmentId, replacementAttachmentId);
  assert.equal(ext._peripheral._essential._devices.B.distanceMode, 0,
    "the old request does not apply its DISTS target to the replacement sensor");
  assert.equal(ext._peripheral._essential._devices.B.requestedDistanceMode, 0,
    "the old request does not replace the new attachment's requested mode");
  assert.equal(ext._peripheral._essential._devices.B.distanceModeStatus, "reading-mode-metadata");
});

test("Essential distance rollback stops when the original sensor is replaced", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  const portId = 1;
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3e, 0]);
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 0 && message[5] === 0x80
  ), "initial DISTL format query");
  emitEssentialModeMetadata(state, portId, 0, {
    name: "DISTL", dataSets: 1, dataType: 1, decimals: 1,
    symbol: "cm", min: 0, max: 250,
  });
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ), "initial DISTL mode setup");
  const initialSetup = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).at(-1);
  device.emitLWP3([10, 0, 0x47, portId, 0, ...initialSetup.slice(5)]);
  await tick();

  const modeOneWritesBefore = device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ).length;
  const oldModeSwitch = ext._peripheral.setDistanceSensorMode("B", 1);
  const oldModeOutcome = oldModeSwitch.then(() => null, error => error);
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 1 && message[5] === 0x80
  ), "DISTS format query");
  emitEssentialModeMetadata(state, portId, 1, {
    name: "DISTS", dataSets: 1, dataType: 1, decimals: 1,
    symbol: "cm", min: 0, max: 32,
  });
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 1
  ).length > modeOneWritesBefore, "DISTS mode setup awaiting its acknowledgement");

  clock.advance(1201);
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).length > 1, "rollback begins on the original sensor");
  const baselineWrites = device.writes.length;
  device.emitLWP3([5, 0, 0x04, portId, 0x00]);
  await tick();
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3e, 0]);
  await tick();
  const replacement = ext._peripheral._essential._devices.B;
  const replacementId = replacement.attachmentId;
  const error = await oldModeOutcome;
  assert.match(error.message, /acknowledgement timed out/i);
  const staleModeWrites = device.writes.slice(baselineWrites).filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] !== 0
  );
  assert.equal(staleModeWrites.length, 0, "the stale operation never configures a mode on the replacement");
  assert.equal(ext._peripheral._essential._devices.B.attachmentId, replacementId);
  assert.equal(ext._peripheral._essential._devices.B.distanceMode, 0);
  assert.equal(ext._peripheral._essential._devices.B.requestedDistanceMode, 0);
});

test("Essential RGB I mode decodes exact RAW values and normalizes getRawColor255", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  const portId = 0;
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3d, 0]);
  await tick();
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x22 && message[3] === portId && message[4] === 5 && message[5] === 0x80
  ).length === 1, "RGB I VALUE FORMAT query");
  emitEssentialModeMetadata(state, portId, 5, {
    name: "RGB I", dataSets: 4, dataType: 1, decimals: 0,
    symbol: "RAW", min: 0, max: 1024,
  });
  await tick();
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ), "COLOR mode default setup");
  await acknowledgeEssentialColorMode(state, portId, 0);
  await tick();

  assert.equal(ext.getColor({PORT: "A"}), "", "COLOR reporter starts the default mode");
  assert.equal(device.writes.some(message => message[2] === 0x41 && message[3] === portId && message[4] === 5), false,
    "COLOR-only demand remains in mode 0");
  device.emitLWP3([5, 0, 0x45, portId, 9]);
  await tick();
  assert.equal(ext.getColor({PORT: "A"}), "red");
  state.ext._peripheral._essential._sensorEdges.clear();

  ext.getRawColor255({PORT: "A", CHANNEL: "red"});
  clock.advance(200);
  await waitUntil(() => device.writes.some(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 5
  ), "RGB I mode setup");
  await acknowledgeEssentialColorMode(state, portId, 5);
  await tick();
  const essential = ext._peripheral._essential;
  const colorValueWrites = device.writes.filter(message => message[2] === 0x41 && message[3] === portId && message[4] === 0);
  const rgbValueWrites = device.writes.filter(message => message[2] === 0x41 && message[3] === portId && message[4] === 5);
  assert.equal(essential._devices.A.colorModes.activeMode, 5);
  assert.equal(essential._devices.A.colorModes.switching, false);
  assert.ok(rgbValueWrites.length >= 1);
  assert.ok(colorValueWrites.length >= 1);

  // Wrong-size 0x45 values must not be accepted as RGB I data.
  device.emitLWP3([11, 0, 0x45, portId, 0, 0, 0, 0, 0, 0, 0]);
  await tick();
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), "");
  const rawBytes = Buffer.alloc(8);
  [0, 512, 1023, 1024].forEach((value, index) => rawBytes.writeInt16LE(value, index * 2));
  device.emitLWP3([12, 0, 0x45, portId, ...rawBytes]);
  await tick();
  assert.equal(essential._portValues.A.red, 0);
  assert.equal(essential._portValues.A.green, 512);
  assert.equal(essential._portValues.A.blue, 1023);
  assert.equal(essential._portValues.A.intensity, 1024);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), 0);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "green"}), 128);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "blue"}), 255);
  assert.equal(ext.getColor({PORT: "A"}), "",
    "fresh RAW samples do not make the previous COLOR value look current");
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "green"}), 128,
    "a later RAW reporter does not start a concurrent mode request");
  assert.equal(rgbValueWrites.length, 1, "RAW demand holds mode 5 instead of resending setup");

  ext.getColor({PORT: "A"});
  clock.advance(200);
  await waitUntil(() => device.writes.filter(message =>
    message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).length > colorValueWrites.length, "COLOR mode restored after dual demand");
  await acknowledgeEssentialColorMode(state, portId, 0);
  await tick();
  device.emitLWP3([5, 0, 0x45, portId, 8]);
  await tick();
  assert.equal(essential._portValues.A.color, 8);
  assert.equal(ext.getRawColor255({PORT: "A", CHANNEL: "red"}), "",
    "fresh COLOR samples do not make the previous RAW value look current");
  assert.equal(essential._sensorEdges.has("color:A:orange"), false,
    "the first COLOR sample after returning from RGB I is only a new baseline");
});

test("Essential RAW color remains metadata-pending until all four mode-5 descriptors arrive", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  const portId = 0;
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3d, 0]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.rawColorStatus, "metadata-pending");

  device.emitLWP3([11, 0, 0x44, portId, 5, 0, ...Buffer.from("RGB I")]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.rawColorStatus, "metadata-pending",
    "NAME alone must not classify the format as unsupported");

  device.emitLWP3([10, 0, 0x44, portId, 5, 0x80, 4, 1, 0, 0]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.rawColorStatus, "metadata-pending",
    "NAME and VALUE FORMAT still wait for SI range and symbol metadata");

  const range = Buffer.alloc(8);
  range.writeFloatLE(0, 0);
  range.writeFloatLE(1024, 4);
  device.emitLWP3([14, 0, 0x44, portId, 5, 3, ...range]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.rawColorStatus, "metadata-pending",
    "the missing RAW symbol keeps metadata pending");
  device.emitLWP3([9, 0, 0x44, portId, 5, 4, ...Buffer.from("RAW")]);
  await tick();
  assert.equal(ext._peripheral.portValues.A.rawColorStatus, "available");
});

test("Essential output feedback records bounded motor-command response timing", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext, clock} = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  const essential = ext._peripheral._essential;
  const waiter = essential._waitForMotorOutputFeedback(
    "A", essential._devices.A.attachmentId,
    essential._motorAngleGenerations.A || 0, 1000
  );
  clock.advance(18);
  essential._handleOutputCommandFeedback(Uint8Array.from([5, 0, 0x82, 0, 0x01]));
  clock.advance(7);
  essential._handleOutputCommandFeedback(Uint8Array.from([5, 0, 0x82, 0, 0x02]));
  const feedback = await waiter;
  assert.equal(feedback.latencyMs, 25);
  const timing = JSON.parse(ext.getCommunicationDiagnostics()).motorCommandTelemetry.A;
  assert.equal(timing.lastLatencyMs, 25);
  assert.match(timing.timing, /includes BLE write queue/);
});

test("Essential BLE write queue prioritizes motor output and replaces queued sensor reads", async () => {
  const state = setup({hubKind: "essential"});
  await connectEssential(state);
  const {device, ext} = state;
  const essential = ext._peripheral._essential;
  essential._devices.A = {type: "motor", attachmentId: "queue-test"};

  const originalWrite = device.rx.writeValueWithoutResponse.bind(device.rx);
  const writeOrder = [];
  let releaseFirstWrite;
  let signalFirstWrite;
  const firstWriteStarted = new Promise(resolve => {
    signalFirstWrite = resolve;
  });
  const firstWriteGate = new Promise(resolve => {
    releaseFirstWrite = resolve;
  });
  device.rx.writeValueWithoutResponse = async packet => {
    const bytes = Array.from(packet);
    writeOrder.push(bytes);
    if (writeOrder.length === 1) {
      signalFirstWrite();
      await firstWriteGate;
    }
    await originalWrite(packet);
  };

  const activeRead = essential._send([5, 0, 0x21, 0, 0], {priority: 10});
  await firstWriteStarted;
  const oldQueuedRead = essential._send([5, 0, 0x21, 1, 0], {
    priority: 10,
    coalesceKey: "lwp3-value-read-B",
    expiresInMs: 1000,
  });
  const replacedReadError = oldQueuedRead.then(() => null, error => error);
  const currentQueuedRead = essential._send([5, 0, 0x21, 1, 0], {
    priority: 10,
    coalesceKey: "lwp3-value-read-B",
    expiresInMs: 1000,
  });
  const motorStop = essential._output("A", 0x01, [0], false);
  releaseFirstWrite();
  await Promise.all([activeRead, currentQueuedRead, motorStop]);

  assert.equal((await replacedReadError).code, "ERR_BLE_WRITE_SUPERSEDED");
  assert.deepEqual(writeOrder[0], [5, 0, 0x21, 0, 0]);
  assert.equal(writeOrder[1][2], 0x81, "motor output overtakes queued reads");
  assert.deepEqual(writeOrder[2], [5, 0, 0x21, 1, 0]);
  assert.equal(writeOrder.length, 3, "superseded read was never transmitted");
});

test("Essential matrix commands and value notifications use its 3x3 device", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const port = "B";
  device.emitLWP3([7, 0, 0x04, 1, 0x01, 0x40, 0]);
  await tick();
  const pixels = Array.from({ length: 9 }, (_, index) => [index + 1, 5]);
  await ext._peripheral.sendCommand("scratch.matrix3_show", { port, pixels });
  assert.deepEqual(
    device.writes.at(-1),
    [
      16, 0, 0x81, 1, 0x10, 0x51, 0, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57,
      0x58, 0x59,
    ]
  );
  device.emitLWP3([13, 0, 0x45, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await tick();
  assert.deepEqual(
    Array.from(ext._peripheral.portValues.B.pixels),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
  );
});

test("Essential detach and reconnect clear stale sensor data while Prime remains SPIKE 3", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  state.device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x41, 0]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  state.device.emitLWP3([8, 0, 0x45, 0, 10, 0, 0, 0]);
  await tick();
  state.device.emitLWP3([5, 0, 0x04, 0, 0x00]);
  await tick();
  assert.equal(state.ext._peripheral.portValues.A.connected, false);
  assert.equal(state.ext._peripheral.portValues.A.receivedAt, null);
  assert.equal(state.ext._peripheral.portValues.A.deviceId, null);
  assert.equal(
    Object.hasOwn(state.ext._peripheral.portValues.A, "relativePosition"),
    false,
    "a detached motor's old angle is not retained as a current measurement"
  );
  state.device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  assert.equal(state.ext._peripheral.portValues.A.connected, true);
  assert.equal(state.ext._peripheral.portValues.A.deviceId, 0x30);
  assert.equal(state.ext._peripheral.portValues.A.receivedAt, null);
  assert.equal(
    Object.hasOwn(state.ext._peripheral.portValues.A, "relativePosition"),
    false,
    "reattach waits for a fresh angle instead of reusing the previous motor's reading"
  );
  state.device.gatt.disconnect();
  assert.equal(state.ext.isConnected(), false);
  await state.ext._peripheral.scan();
  assert.equal(state.ext.isConnected(), true);
  assert.equal(state.ext._peripheral.detectedHubModel, "essential");
  assert.equal(state.ext._peripheral.portValues.A, undefined);

  const prime = setup();
  await connect(prime);
  assert.equal(prime.ext._peripheral.active, prime.ext._peripheral._spike3);
  assert.equal(prime.ext._peripheral.protocol, "spike3");
  assert.equal(
    JSON.parse(prime.ext.getCommunicationDiagnostics()).firmwareVersion,
    "1.6.62"
  );
});

test("REPL display text falls back after native rejection and escapes Python string syntax", async () => {
  const state = setup();
  Object.defineProperty(state.ext._peripheral, "protocol", {
    value: "repl",
  });
  const calls = [];
  state.ext._peripheral.sendCommand = () => Promise.resolve("native");
  state.ext._peripheral.sendPythonCommand = (code) => {
    calls.push(code);
    return Promise.resolve();
  };
  await state.ext.displayText({ TEXT: 'a "quote" and \\ slash\nline' });
  assert.deepEqual(
    calls,
    [],
    "successful native send does not also send Python"
  );

  state.ext._peripheral.sendCommand = () =>
    Promise.reject(new Error("not supported"));
  await state.ext.displayText({ TEXT: 'a "quote" and \\ slash\nline' });
  assert.equal(calls.length, 1);
  const pythonText = 'a "quote" and \\ slash\nline';
  assert.equal(
    calls[0],
    "import hub; hub.display.show(" + JSON.stringify(pythonText) + ")"
  );
});

test("an unregistered Prime auto-installs slot 0 once and queues Scratch blocks until hello", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.slots.set(19, Buffer.from("user program remains untouched"));
  state.device.tx.emit(packMessage(notification(motorRecord({ port: 0 }))));

  const firstPreparation =
    state.ext._controlCenterAPI.prepareInternalController("connection");
  const duplicatePreparation =
    state.ext._controlCenterAPI.prepareInternalController("scratch-command");
  assert.strictEqual(firstPreparation, duplicatePreparation);
  let laterBlockStarted = false;
  const motor = firstPreparation.then(() => {
    laterBlockStarted = true;
    return state.ext.motorStart({ PORT: "A", DIRECTION: 1 });
  });
  const parallelBlock = state.ext.displayClear();

  await Promise.all([motor, parallelBlock]);

  assert.equal(laterBlockStarted, true);
  assert.equal(fakeHub.startCount, 1);
  assert.equal(fakeHub.helloCount, 1);
  assert.equal(fakeHub.running, true);
  assert.equal(state.ext._controlCenterAPI.getState().controllerSlot, 0);
  assert.equal(state.ext._controlCenterAPI.getState().controllerReady, true);
  assert.ok(fakeHub.actions.some((action) => action.cmd === "motor.run"));
  assert.ok(fakeHub.actions.some((action) => action.cmd === "matrix.clear"));
  assert.equal(
    fakeHub.slots.get(19).toString(),
    "user program remains untouched"
  );
  const messages = unpackWrittenMessages(state.device.writes);
  assert.ok(messages.some(([type, slot]) => type === 0x46 && slot === 0));
  assert.equal(
    messages.some(([type, slot]) => type === 0x46 && slot !== 0),
    false,
    "only the authorized fixed internal slot is cleared"
  );
  const diagnostics = JSON.parse(state.ext.getCommunicationDiagnostics());
  assert.equal(diagnostics.controllerCommandPreparation.outcome, "ready");
});

test("the communication diagnostics block is localized for Japanese", () => {
  const state = setup({ locale: "ja-JP" });
  const block = state.ext
    .getInfo()
    .blocks.find(
      (entry) => entry && entry.opcode === "getCommunicationDiagnostics"
    );
  assert.equal(block.text, "通信診断（JSON）");
});

test("the angle-target block exposes the same three paths for both hub models", () => {
  const { ext } = setup();
  const definition = ext.getInfo().blocks.find((block) => block.opcode === "motorRunToPosition");
  assert.match(definition.text, /\[PATH\]/);
  assert.equal(definition.arguments.PATH.defaultValue, "shortest");
  assert.deepEqual(
    Array.from(ext.getInfo().menus.MOTOR_PATH.items, (item) => item.value),
    ["shortest", "clockwise", "counterclockwise"]
  );
});

test("Essential relative angle moves use fresh cumulative POS in both directions", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const {device, ext} = state;
  const essential = ext._peripheral._essential;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  autoAcknowledgeEssentialPositionModes(state);

  const rawPos = value => {
    const signed = value | 0;
    device.emitLWP3([
      8, 0, 0x45, 0,
      signed & 0xff,
      (signed >> 8) & 0xff,
      (signed >> 16) & 0xff,
      (signed >> 24) & 0xff,
    ]);
  };
  const positionReads = () => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const degreeCommands = () => device.writes.filter(message =>
    message[2] === 0x81 && message[5] === 0x0b
  );

  for (const [current, target, expectedDegrees, positive] of [
    [100, 250, 150, true],
    [250, 100, 150, false],
  ]) {
    const readsBefore = positionReads();
    const commandsBefore = degreeCommands().length;
    const move = ext._peripheral.sendCommand(
      "scratch.motor_run_relative_position",
      {port: "A", position: target, speed: 50, stop_mode: "brake"}
    );
    await waitUntil(() => essential._relativePositionWaiters.A, "fresh POS waiter before relative move");
    assert.ok(positionReads() > readsBefore, "relative move requests a current POS value");
    rawPos(current);
    await waitUntil(() => degreeCommands().length === commandsBefore + 1, "relative 0x0B motor command");
    const packet = degreeCommands().at(-1);
    const requestedDegrees = packet[6] | (packet[7] << 8) | (packet[8] << 16) | (packet[9] << 24);
    assert.equal(requestedDegrees, expectedDegrees);
    assert.equal(packet[10] < 128, positive, "POS delta controls direction");
    assert.equal(packet.at(-1), 0x11, "configured acceleration/deceleration profile is selected");

    device.emitLWP3([5, 0, 0x82, 0, 0x01]);
    device.emitLWP3([5, 0, 0x82, 0, 0x02]);
    const readsBeforeVerification = positionReads();
    await waitUntil(() => essential._relativePositionWaiters.A, "fresh POS waiter after movement");
    assert.ok(positionReads() > readsBeforeVerification, "target verification requests a fresh POS value");
    rawPos(target);
    await move;
  }

  const readsBeforeZero = positionReads();
  const commandsBeforeZero = degreeCommands().length;
  const zeroMove = ext._peripheral.sendCommand(
    "scratch.motor_run_relative_position",
    {port: "A", position: 100, speed: 50, stop_mode: "brake"}
  );
  await waitUntil(() => positionReads() > readsBeforeZero, "fresh POS poll for zero delta");
  rawPos(100);
  await zeroMove;
  assert.equal(degreeCommands().length, commandsBeforeZero, "zero delta sends no motor output");
});

test("Essential absolute angle moves read fresh APOS, await 0x82, and verify the target", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  const rawApos = angle => {
    const signed = angle > 180 ? angle - 360 : angle;
    device.emitLWP3([6, 0, 0x45, 0, signed & 0xff, (signed >> 8) & 0xff]);
  };
  const valueReads = () => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const degreeCommands = () => device.writes.filter(message =>
    message[2] === 0x81 && message[5] === 0x0b
  );
  // A deliberately stale cached APOS must not start this move.
  rawApos(90);
  await tick();
  for (const [start, target, path, expectedDegrees, positive] of [
    [350, 0, "shortest", 10, true],
    [10, 0, "shortest", 10, false],
    [0, 350, "shortest", 10, false],
    [90, 270, "shortest", 180, true],
    [90, 270, "clockwise", 180, true],
    [90, 270, "counterclockwise", 180, false],
  ]) {
    ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
    const readsBefore = valueReads();
    const commandsBefore = degreeCommands().length;
    let settled = false;
    const move = ext.motorRunToPosition({
      PORT: "A", POSITION: target, PATH: path, SPEED: 40
    }).then(value => {
      settled = true;
      return value;
    });
    await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "fresh APOS waiter before angle command");
    assert.ok(valueReads() > readsBefore, "angle move requests a current APOS value");
    await tick();
    assert.equal(degreeCommands().length, commandsBefore, "cached APOS is not used");
    rawApos(start);
    await waitUntil(() => degreeCommands().length === commandsBefore + 1, "one 0x0B angle command");
    const packet = degreeCommands().at(-1);
    const requestedDegrees = packet[6] | (packet[7] << 8) | (packet[8] << 16) | (packet[9] << 24);
    assert.equal(requestedDegrees, expectedDegrees);
    assert.equal(packet[10] < 128, positive, "speed sign encodes the chosen route");

    device.emitLWP3([5, 0, 0x82, 0, 0x01]);
    await tick();
    assert.equal(settled, false, "in-progress feedback does not resolve the block");
    device.emitLWP3([5, 0, 0x82, 0, 0x02]);
    await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "fresh APOS waiter after completion");
    assert.ok(valueReads() > readsBefore + 1, "angle move requests target verification");
    assert.equal(settled, false, "completion feedback still requires target verification");
    rawApos(target);
    await move;
    assert.equal(settled, true);
  }

  const readsBeforeZero = valueReads();
  const commandsBeforeZero = degreeCommands().length;
  ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
  const zeroMove = ext.motorRunToPosition({
    PORT: "A", POSITION: 0, PATH: "shortest", SPEED: 40
  });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "fresh APOS waiter for zero delta");
  assert.ok(valueReads() > readsBeforeZero);
  rawApos(0);
  await zeroMove;
  assert.equal(degreeCommands().length, commandsBeforeZero, "zero delta sends no motor output");
});

test("Essential serializes same-port angle moves and ignores stale completion feedback", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  const rawApos = angle => {
    const signed = angle > 180 ? angle - 360 : angle;
    device.emitLWP3([6, 0, 0x45, 0, signed & 0xff, (signed >> 8) & 0xff]);
  };
  const aposReads = () => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const degreeCommands = () => device.writes.filter(message =>
    message[2] === 0x81 && message[5] === 0x0b
  );
  const readsBeforeMoves = aposReads();

  const first = ext.motorRunToPosition({
    PORT: "A", POSITION: 20, PATH: "shortest", SPEED: 40
  });
  const second = ext.motorRunToPosition({
    PORT: "A", POSITION: 30, PATH: "shortest", SPEED: 40
  });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "first move requests a fresh APOS");
  assert.ok(aposReads() > readsBeforeMoves);
  rawApos(10);
  await waitUntil(() => degreeCommands().length === 1, "first output command");
  await tick();
  assert.equal(aposReads(), readsBeforeMoves + 1, "second move waits for the first to complete");

  device.emitLWP3([5, 0, 0x82, 0, 0x01]);
  device.emitLWP3([5, 0, 0x82, 0, 0x02]);
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "first move requests target verification");
  assert.ok(aposReads() > readsBeforeMoves + 1);
  rawApos(20);
  ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "second move requests its own fresh APOS");
  assert.ok(aposReads() > readsBeforeMoves + 2);
  rawApos(20);
  await waitUntil(() => degreeCommands().length === 2, "second output command");
  let secondSettled = false;
  second.then(() => { secondSettled = true; });

  // A late completion from the cancelled/previous command has no request ID.
  // It must not finish the second move before that move reports progress.
  device.emitLWP3([5, 0, 0x82, 0, 0x02]);
  await tick();
  assert.equal(secondSettled, false);

  // Include unrelated port B and combined completed+idle bits in one report.
  device.emitLWP3([7, 0, 0x82, 1, 0x0a, 0, 0x0b]);
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "second move requests target verification");
  assert.ok(aposReads() > readsBeforeMoves + 3);
  rawApos(30);
  await Promise.all([first, second]);
  assert.equal(degreeCommands().length, 2, "each requested position sends one output");
});

test("Essential angle move reports APOS/discard failures and cancels safely", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0x00]);
  await tick();
  await advertiseEssentialApos(state, 0);
  await acknowledgeEssentialApos(state, 0);
  const rawApos = angle => {
    const signed = angle > 180 ? angle - 360 : angle;
    device.emitLWP3([6, 0, 0x45, 0, signed & 0xff, (signed >> 8) & 0xff]);
  };
  const aposReads = () => device.writes.filter(message =>
    message[2] === 0x21 && message[3] === 0 && message[4] === 0
  ).length;
  const degreeCommands = () => device.writes.filter(message =>
    message[2] === 0x81 && message[5] === 0x0b
  );
  const readsBeforeDiscard = aposReads();

  const discarded = ext.motorRunToPosition({
    PORT: "A", POSITION: 90, PATH: "shortest", SPEED: 40
  });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "discard test reads APOS");
  assert.ok(aposReads() > readsBeforeDiscard);
  rawApos(0);
  await waitUntil(() => degreeCommands().length === 1, "discard test sends one output");
  device.emitLWP3([5, 0, 0x82, 0, 0x04]);
  await assert.rejects(
    discarded,
    error => error.code === "ERR_MOTOR_COMMAND_DISCARDED"
  );
  assert.equal(degreeCommands().length, 1, "discard does not trigger a retry");

  ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
  const noApos = ext.motorRunToPosition({
    PORT: "A", POSITION: 90, PATH: "shortest", SPEED: 40
  });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "missing APOS request");
  assert.ok(aposReads() > readsBeforeDiscard + 1);
  state.clock.advance(1000);
  await assert.rejects(noApos, error => error.code === "ERR_APOS_READ_TIMEOUT");
  assert.equal(degreeCommands().length, 1, "missing APOS sends no output");

  const cancelled = ext.motorRunToPosition({
    PORT: "A", POSITION: 90, PATH: "shortest", SPEED: 40
  });
  const cancellationResult = cancelled.then(
    () => ({error: null}),
    error => ({error})
  );
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "stop test APOS request");
  assert.ok(aposReads() > readsBeforeDiscard + 2);
  rawApos(0);
  await waitUntil(() => degreeCommands().length === 2, "stop test output command");
  device.emitLWP3([5, 0, 0x82, 0, 0x01]);
  await ext.motorStop({PORT: "A"});
  assert.equal(
    (await cancellationResult).error.code,
    "ERR_MOTOR_ANGLE_CANCELLED",
    "a stop block rejects the pending angle move"
  );

  ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
  const resumed = ext.motorRunToPosition({
    PORT: "A", POSITION: 90, PATH: "shortest", SPEED: 40
  });
  let resumedSettled = false;
  resumed.then(() => { resumedSettled = true; });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "new move APOS request");
  assert.ok(aposReads() > readsBeforeDiscard + 3);
  rawApos(0);
  await waitUntil(() => degreeCommands().length === 3, "new move output command");
  device.emitLWP3([5, 0, 0x82, 0, 0x02]);
  await tick();
  assert.equal(resumedSettled, false, "old completion cannot settle the new move");
  device.emitLWP3([5, 0, 0x82, 0, 0x01]);
  device.emitLWP3([5, 0, 0x82, 0, 0x0a]);
  await waitUntil(
    () => ext._peripheral._essential._absolutePositionWaiters.A,
    "resumed move verification APOS waiter"
  );
  assert.ok(aposReads() > readsBeforeDiscard + 4);
  rawApos(90);
  await resumed;

  ext._peripheral.portValues.A.absolutePositionReceivedAt = Date.now() - 1000;
  const disconnected = ext.motorRunToPosition({
    PORT: "A", POSITION: 180, PATH: "shortest", SPEED: 40
  });
  await waitUntil(() => ext._peripheral._essential._absolutePositionWaiters.A, "disconnect test waits for fresh APOS");
  assert.ok(aposReads() > readsBeforeDiscard + 5);
  device.gatt.disconnect();
  await assert.rejects(
    disconnected,
    error => error.code === "ERR_MOTOR_ANGLE_CANCELLED"
  );
  assert.equal(degreeCommands().length, 3, "disconnect sends no speculative motor output");
});

test("Prime absolute angle paths stay absolute, encode V2 direction, and omit the field for V1", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  const hub = state.ext._peripheral._spike3;
  hub._rateLimiter.reserve = () => 0;
  fakeHub.running = true;
  hub._controllerReady = true;
  hub._controllerVersion = "brickwright-spike-controller/2";
  hub._runningControllerSession = hub._connectionSession;
  hub._runningControllerSlot = 0;
  delete hub._portValues.C;

  for (const path of ["shortest", "clockwise", "counterclockwise"]) {
    await state.ext.motorRunToPosition({
      PORT: "C", POSITION: -361, PATH: path, SPEED: 40
    });
    const request = fakeHub.receivedRequests.at(-1);
    assert.equal(request.c, "a", "Prime still receives motor.run_to_position");
    assert.equal(request.g, 359, "target is normalized to 0..359 degrees");
    assert.equal(request.h, path, "V2 compact command includes the selected path");
    assert.equal(fakeHub.actions.at(-1).cmd, "motor.run_to_position");
    assert.equal(fakeHub.actions.at(-1).path, path);
  }
  assert.match(source, /"shortest":\s*motor\.SHORTEST_PATH/);
  assert.match(source, /"clockwise":\s*motor\.CLOCKWISE/);
  assert.match(source, /"counterclockwise":\s*motor\.COUNTERCLOCKWISE/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(hub._encodeControllerCommand(
      "motor.run_to_position", {position: 0, path: "clockwise"}, 99
    ))),
    {i: 99, c: "a", g: 0, h: "clockwise"}
  );

  hub._controllerVersion = "brickwright-spike-controller/1";
  assert.deepEqual(
    JSON.parse(JSON.stringify(hub._encodeControllerCommand(
      "motor.run_to_position", {position: 0, path: "shortest"}, 100
    ))),
    {i: 100, c: "a", g: 0},
    "V1 receives no V2-only path field"
  );
  assert.throws(
    () => hub._encodeControllerCommand(
      "motor.run_to_position", {position: 0, path: "clockwise"}, 101
    ),
    error => error.code === "ERR_CONTROLLER_UPDATE_REQUIRED"
  );
  await state.ext.motorRunToPosition({
    PORT: "C", POSITION: 10, PATH: "shortest", SPEED: 40
  });
  assert.equal("h" in fakeHub.receivedRequests.at(-1), false);
  const commandCount = fakeHub.receivedRequests.length;
  await assert.rejects(
    state.ext.motorRunToPosition({
      PORT: "C", POSITION: 10, PATH: "clockwise", SPEED: 40
    }),
    error => error.code === "ERR_CONTROLLER_UPDATE_REQUIRED"
  );
  assert.equal(fakeHub.receivedRequests.length, commandCount);
});

test("Prime connection state and telemetry are published atomically", async () => {
  const state = setup();
  await connect(state);
  const api = state.runtime.brickwrightSpikePrimeControl;

  // Synthetic DeviceNotification vector using the published 0x3c envelope
  // and DeviceMotor record layout. This is not a hub capture.
  state.device.tx.emit(
    packMessage(
      notification(motorRecord({ port: 0, absolute: 12, position: 120 }))
    )
  );
  const beforeMalformedFrame = api.getState();
  assert.equal(beforeMalformedFrame.connected, true);
  assert.equal(beforeMalformedFrame.diagnostics.connected, true);
  assert.equal(beforeMalformedFrame.portSensors.A.absolutePosition, 12);
  assert.equal(beforeMalformedFrame.motorPorts.A.relativePosition, 120);

  const validMotorThenTruncatedBattery = bytes(
    motorRecord({ port: 0, absolute: 99, position: 999 }),
    [0x01]
  );
  state.device.tx.emit(
    packMessage(notification(validMotorThenTruncatedBattery))
  );
  const afterMalformedFrame = api.getState();
  assert.equal(afterMalformedFrame.connected, true);
  assert.equal(afterMalformedFrame.diagnostics.connected, true);
  assert.deepEqual(
    afterMalformedFrame.portSensors.A,
    beforeMalformedFrame.portSensors.A,
    "a malformed frame must not publish only its valid prefix"
  );
  assert.deepEqual(
    afterMalformedFrame.motorPorts.A,
    beforeMalformedFrame.motorPorts.A
  );
  assert.equal(
    afterMalformedFrame.diagnostics.motorNotificationCount,
    beforeMalformedFrame.diagnostics.motorNotificationCount
  );
  assert.equal(
    afterMalformedFrame.diagnostics.notificationTelemetry.validNotificationCount,
    beforeMalformedFrame.diagnostics.notificationTelemetry.validNotificationCount
  );
  assert.equal(
    afterMalformedFrame.diagnostics.malformedNotificationCount,
    beforeMalformedFrame.diagnostics.malformedNotificationCount + 1
  );

  state.device.gatt.disconnect();
  const disconnected = api.getState();
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.diagnostics.connected, false);
  assert.equal(Object.keys(disconnected.portSensors).length, 0);
  assert.equal(Object.keys(disconnected.motorPorts).length, 0);
});

test("Prime maps ports A-F and rejects commands after a port is replaced or detached", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state, { motorPorts: [] });
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  // These six records are synthetic protocol-shaped values, not a real-hub
  // capture. DeviceMotor port IDs 0-5 map to A-F in the published layout.
  const motorRecords = Array.from({ length: 6 }, (_, port) =>
    motorRecord({
      port,
      motorType: port % 2 === 0 ? 0x30 : 0x31,
      absolute: port,
      position: port * 100,
    })
  );
  state.device.tx.emit(
    packMessage(notification(bytes(...motorRecords)))
  );

  const connected = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.deepEqual(Array.from(connected.availablePorts), [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ]);
  assert.deepEqual(Object.keys(connected.portSensors), [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ]);
  for (const port of ["A", "B", "C", "D", "E", "F"]) {
    assert.equal(
      connected.diagnostics.portObservations[port].status,
      "observed"
    );
    assert.equal(connected.diagnostics.portObservations[port].type, "motor");
  }
  for (const port of ["A", "B", "C", "D", "E", "F"]) {
    assert.equal(connected.portSensors[port].type, "motor");
    assert.equal(
      connected.motorPorts[port].motorType,
      connected.portSensors[port].motorType
    );
  }

  for (const port of ["A", "B", "C", "D", "E", "F"]) {
    await state.ext.motorStart({ PORT: port, DIRECTION: 1 });
  }
  assert.deepEqual(
    fakeHub.actions.filter((action) => action.cmd === "motor.run").map((action) => action.port),
    ["A", "B", "C", "D", "E", "F"]
  );

  // A force-sensor record replaces the synthetic motor record on D.
  state.device.tx.emit(
    packMessage(notification(Uint8Array.from([0x0b, 3, 62, 1])))
  );
  const writesBeforeRejectedCommand = state.device.writes.length;
  const actionsBeforeRejectedCommand = fakeHub.actions.length;
  await assert.rejects(
    state.ext.motorStart({ PORT: "D", DIRECTION: 1 }),
    (error) => error.code === "ERR_SPIKE_PORT_NOT_MOTOR"
  );
  assert.equal(state.device.writes.length, writesBeforeRejectedCommand);
  assert.equal(fakeHub.actions.length, actionsBeforeRejectedCommand);
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().portSensors.D.type,
    "force"
  );
  assert.equal(
    state.runtime.brickwrightSpikePrimeControl.getState().diagnostics
      .portObservations.D.type,
    "force"
  );

  // Age A's synthetic observation past the protocol's stale threshold. A
  // cached motor record alone must not authorize a command on stale hardware.
  const spike3 = state.ext._peripheral._spike3;
  spike3._portObservations.A.lastObservedAt = Date.now() - 2001;
  const staleSnapshot = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(staleSnapshot.diagnostics.portObservations.A.status, "stale");
  const writesBeforeStaleCommand = state.device.writes.length;
  const requestsBeforeStaleCommand = fakeHub.receivedRequests.length;
  const actionsBeforeStaleCommand = fakeHub.actions.length;
  const staleCommandOutcome = await Promise.resolve()
    .then(() => state.ext.motorStart({ PORT: "A", DIRECTION: 1 }))
    .then(
      () => "resolved",
      () => "rejected"
    );
  const writesAfterStaleCommand = state.device.writes.length;
  const requestsAfterStaleCommand = fakeHub.receivedRequests.length;
  const actionsAfterStaleCommand = fakeHub.actions.length;

  const hub = spike3;
  const oldReceiver = hub._link._characteristicDidChangeCallback;
  state.device.gatt.disconnect();
  const detached = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(detached.connected, false);
  assert.equal(Object.keys(detached.portSensors).length, 0);
  assert.equal(Object.keys(detached.motorPorts).length, 0);
  for (const port of ["A", "B", "C", "D", "E", "F"]) {
    assert.equal(detached.diagnostics.portObservations[port].status, "unknown");
  }

  await state.ext._peripheral.scan();
  await tick();
  state.device.tx.emit(packMessage(infoResponse()));
  await tick();
  const reconnected = state.runtime.brickwrightSpikePrimeControl.getState();
  assert.equal(reconnected.connected, true);
  assert.deepEqual(Array.from(reconnected.availablePorts), [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ]);
  assert.equal(Object.keys(reconnected.portSensors).length, 0);
  assert.equal(Object.keys(reconnected.motorPorts).length, 0);

  oldReceiver(
    Buffer.from(
      packMessage(notification(motorRecord({ port: 3, position: 777 })))
    ).toString("base64")
  );
  assert.equal(
    Object.keys(
      state.runtime.brickwrightSpikePrimeControl.getState().portSensors
    ).length,
    0,
    "a notification callback from the detached session cannot revive old port data"
  );
  assert.equal(
    staleCommandOutcome,
    "rejected",
    "a command must be rejected when its motor observation is stale"
  );
  assert.equal(
    writesAfterStaleCommand,
    writesBeforeStaleCommand,
    "a stale motor command must not write to the hub"
  );
  assert.equal(
    requestsAfterStaleCommand,
    requestsBeforeStaleCommand,
    "a stale motor command must not ask the controller to run a motor"
  );
  assert.equal(
    actionsAfterStaleCommand,
    actionsBeforeStaleCommand,
    "a stale motor command must not reach the controller"
  );
});

test("invalid Prime port strings do not silently select a real motor port", async () => {
  const state = setup();
  await connect(state);
  const fakeHub = attachFakeControllerHub(state);
  state.ext._peripheral._spike3._rateLimiter.reserve = () => 0;
  await state.ext.installHubController({ SLOT: 0 });

  const writesBefore = state.device.writes.length;
  const requestsBefore = fakeHub.receivedRequests.length;
  const actionsBefore = fakeHub.actions.length;
  // The multi-port validator may accept separators between A-F, but a label
  // containing other letters must not be filtered into the valid port A.
  await Promise.resolve(
    state.ext.motorStart({ PORT: "PORT A", DIRECTION: 1 })
  ).catch(() => {});

  assert.equal(state.device.writes.length, writesBefore);
  assert.equal(fakeHub.receivedRequests.length, requestsBefore);
  assert.equal(fakeHub.actions.length, actionsBefore);
});

test("Essential RAW mode rejection rolls back to the acknowledged COLOR mode", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;
  const portId = 0;

  // Synthetic LWP3 attach and mode metadata vectors following the published
  // HubAttachedIO, PortModeInformation, and PortInputFormat layouts.
  device.emitLWP3([7, 0, 0x04, portId, 0x01, 0x3d, 0]);
  await tick();
  await waitUntil(
    () =>
      device.writes.some(
        (message) =>
          message[2] === 0x22 &&
          message[3] === portId &&
          message[4] === 5 &&
          message[5] === 0x80
      ),
    "RGB I format metadata query"
  );
  emitEssentialModeMetadata(state, portId, 5, {
    name: "RGB I",
    dataSets: 4,
    dataType: 1,
    decimals: 0,
    symbol: "RAW",
    min: 0,
    max: 1024,
  });
  await tick();
  await waitUntil(
    () =>
      device.writes.some(
        (message) =>
          message[2] === 0x41 &&
          message[3] === portId &&
          message[4] === 0
      ),
    "default COLOR mode setup"
  );
  await acknowledgeEssentialColorMode(state, portId, 0);

  const essential = ext._peripheral._essential;
  const colorModes = essential._devices.A.colorModes;
  assert.equal(colorModes.activeMode, 0);
  const initialColorSetupCount = device.writes.filter(
    (message) =>
      message[2] === 0x41 && message[3] === portId && message[4] === 0
  ).length;
  const failedSwitch = essential._requestColorSensorMode("A", 5);
  const failedSwitchOutcome = failedSwitch.then(
    () => null,
    (error) => error
  );
  await waitUntil(
    () =>
      device.writes.some(
        (message) =>
          message[2] === 0x41 &&
          message[3] === portId &&
          message[4] === 5
      ),
    "RAW mode setup"
  );
  const rawSetup = device.writes
    .filter(
      (message) =>
        message[2] === 0x41 && message[3] === portId && message[4] === 5
    )
    .at(-1);
  // Mismatched delta is a synthetic negative acknowledgement.
  device.emitLWP3([
    10,
    0,
    0x47,
    portId,
    rawSetup[4],
    rawSetup[5] + 1,
    rawSetup[6],
    rawSetup[7],
    rawSetup[8],
    rawSetup[9],
  ]);
  await waitUntil(
    () =>
      device.writes.filter(
        (message) =>
          message[2] === 0x41 &&
          message[3] === portId &&
          message[4] === 0
      ).length > initialColorSetupCount,
    "rollback to the previously acknowledged COLOR mode"
  );
  await acknowledgeEssentialColorMode(state, portId, 0);
  const switchError = await failedSwitchOutcome;
  assert.match(switchError.message, /LWP3 rejected mode 5/);

  assert.equal(colorModes.activeMode, 0);
  assert.equal(colorModes.requestedMode, 0);
  assert.equal(essential._portModes.A, 0);
  assert.equal(essential._inputFormats.A.status, "acknowledged");
  assert.equal(essential.portValues.A.rawColorReceivedAt ?? null, null);
  assert.equal(essential.portValues.A.colorMode, 0);
});

test("Essential motor detach invalidates angle work before a replacement can run", async () => {
  const state = setup({ hubKind: "essential" });
  await connectEssential(state);
  const { device, ext } = state;

  // These are synthetic LWP3 attach/value/feedback vectors. They use the
  // published message layouts and are not presented as hardware captures.
  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x30, 0]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  const rawApos = (angle) => {
    const signed = angle > 180 ? angle - 360 : angle;
    device.emitLWP3([6, 0, 0x45, 0, signed & 0xff, (signed >> 8) & 0xff]);
  };
  const degreeCommands = () =>
    device.writes.filter(
      (message) => message[2] === 0x81 && message[5] === 0x0b
    );

  const oldAttachmentId = ext._peripheral._essential._devices.A.attachmentId;
  const oldMove = ext.motorRunToPosition({
    PORT: "A",
    POSITION: 90,
    PATH: "shortest",
    SPEED: 40,
  });
  await waitUntil(
    () => ext._peripheral._essential._absolutePositionWaiters.A,
    "old motor waits for a fresh APOS sample"
  );
  rawApos(0);
  await waitUntil(() => degreeCommands().length === 1, "old motor output");
  device.emitLWP3([5, 0, 0x82, 0, 0x01]);
  device.emitLWP3([5, 0, 0x04, 0, 0x00]);
  await assert.rejects(
    oldMove,
    (error) => error.code === "ERR_MOTOR_ANGLE_CANCELLED"
  );
  assert.equal(ext._peripheral.portValues.A.connected, false);
  assert.equal(ext._peripheral.portValues.A.receivedAt, null);
  assert.equal(
    Object.hasOwn(ext._peripheral.portValues.A, "absolutePosition"),
    false
  );

  // A detached device's late port value is ignored while the port is empty.
  rawApos(45);
  await tick();
  assert.equal(
    Object.hasOwn(ext._peripheral.portValues.A, "absolutePosition"),
    false
  );

  device.emitLWP3([7, 0, 0x04, 0, 0x01, 0x31, 0]);
  await tick();
  await acknowledgeEssentialMotorPositionMode(state, 0);
  const newAttachmentId = ext._peripheral._essential._devices.A.attachmentId;
  assert.notEqual(newAttachmentId, oldAttachmentId);
  assert.equal(ext._peripheral.portValues.A.deviceId, 0x31);
  assert.equal(ext._peripheral.portValues.A.receivedAt, null);

  let replacementMoveSettled = false;
  const replacementMove = ext
    .motorRunToPosition({
      PORT: "A",
      POSITION: 30,
      PATH: "shortest",
      SPEED: 40,
    })
    .then((value) => {
      replacementMoveSettled = true;
      return value;
    });
  await waitUntil(
    () => ext._peripheral._essential._absolutePositionWaiters.A,
    "replacement motor waits for its own fresh APOS sample"
  );
  rawApos(10);
  await waitUntil(
    () => degreeCommands().length === 2,
    "replacement motor output"
  );

  // The old motor's completion status has no command ID. A new request must
  // still observe its own progress before that status can finish the move.
  device.emitLWP3([5, 0, 0x82, 0, 0x02]);
  await tick();
  assert.equal(replacementMoveSettled, false);
  device.emitLWP3([5, 0, 0x82, 0, 0x01]);
  device.emitLWP3([5, 0, 0x82, 0, 0x02]);
  await waitUntil(
    () => ext._peripheral._essential._absolutePositionWaiters.A,
    "replacement move verifies its final APOS"
  );
  rawApos(30);
  await replacementMove;
  assert.equal(replacementMoveSettled, true);
  assert.equal(degreeCommands().length, 2);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.log(`not ok - ${name}\n  ${error.stack || error}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
