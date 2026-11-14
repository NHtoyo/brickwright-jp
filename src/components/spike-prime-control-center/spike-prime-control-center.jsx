import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import bindAll from 'lodash.bindall';

import styles from './spike-prime-control-center.css';

const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STALE_AFTER_MS = 1500;

const words = {
    en: {
        title: 'SPIKE hub',
        connect: 'Connect',
        disconnect: 'Disconnect',
        connecting: 'Connecting…',
        connectionMode: 'Connection method',
        modeWebBluetooth: 'Web Bluetooth',
        modeAuto: 'Auto',
        modeScratchLink: 'ScratchLink BLE',
        selectedMode: 'Selected method',
        activeMode: 'Connected by',
        devices: 'Discovered hubs',
        chooseDevice: 'Connect',
        connected: 'Connected',
        disconnected: 'Disconnected',
        unavailable: 'Add the SPIKE Prime extension from Add-ons to connect a hub.',
        firmware: 'Hub OS',
        controller: 'Controller',
        controllerSlot: 'Controller slot',
        standaloneSlot: 'Standalone slot',
        systemSlot: 'Reserved for controller',
        developmentSource: 'Loaded extension',
        sourceBranch: 'Branch',
        sourceCommit: 'Commit',
        sourceUnavailable: 'Source details unavailable',
        routerRegistered: 'Scratch block router',
        apiReady: 'Shared with GUI',
        apiMissing: 'Not registered',
        ready: 'Ready',
        unknown: 'Not verified',
        install: 'Install controller',
        installTo: 'Install to slot',
        controllerWarning: 'The hub slot contents cannot be read here. Installing clears the selected slot.',
        cancel: 'Cancel',
        installing: 'Installing and verifying…',
        imu: 'Hub sensors',
        pitch: 'Pitch',
        roll: 'Roll',
        yaw: 'Yaw',
        ports: 'Ports',
        noReading: 'No reading yet',
        stale: 'Reading is stale',
        noConnection: 'Disconnected',
        motor: 'Motor',
        color: 'Color sensor',
        distance: 'Distance sensor',
        force: 'Force sensor',
        matrix: 'Light matrix',
        unknownDevice: 'Device',
        angle: 'Angle',
        relative: 'Accumulated angle',
        speed: 'Speed',
        pressed: 'Pressed',
        released: 'Released',
        forceValue: 'Force',
        distanceValue: 'Distance',
        colorValue: 'Detected color',
        rgb: 'RGB',
        offline: 'Standalone program',
        offlineHelp: 'Uploads and starts converted Python on the hub. Scratch real-time runs stay on this PC.',
        slot: 'Hub slot',
        review: 'Review upload',
        confirmUpload: 'Clear, upload, and start slot',
        slotWarning: 'Slot contents cannot be inspected. This operation clears the ' +
            'selected slot. The controller slot is reserved.',
        working: 'Working…',
        stopHub: 'Stop hub program',
        error: 'Action failed',
        close: 'Close'
    },
    ja: {
        title: 'SPIKE ハブ',
        connect: '接続',
        disconnect: '切断',
        connecting: '接続中…',
        connectionMode: '接続方式',
        modeWebBluetooth: 'Web Bluetooth',
        modeAuto: '自動',
        modeScratchLink: 'ScratchLink BLE',
        selectedMode: '選択中の方式',
        activeMode: '実際の接続方式',
        devices: '見つかったハブ',
        chooseDevice: '接続',
        connected: '接続済み',
        disconnected: '未接続',
        unavailable: 'ハブを接続するには「アドオン」からSPIKE Prime拡張を追加してください。',
        firmware: 'Hub OS',
        controller: '制御プログラム',
        controllerSlot: '制御プログラム用スロット',
        standaloneSlot: '単独実行の保存先',
        systemSlot: '制御プログラム用に予約',
        developmentSource: '読み込み中の拡張',
        sourceBranch: 'ブランチ',
        sourceCommit: 'コミット',
        sourceUnavailable: '読み込み元情報を取得できません',
        routerRegistered: 'Scratchブロックのルーター',
        apiReady: 'GUIと共有中',
        apiMissing: '登録されていません',
        ready: '起動確認済み',
        unknown: '応答未確認',
        install: '制御プログラムを導入',
        installTo: '次のスロットに導入',
        controllerWarning: 'ハブ内のスロット内容はここでは読み取れません。導入すると選択したスロットを消去します。',
        cancel: '戻る',
        installing: '転送・起動を確認中…',
        imu: 'ハブのセンサー',
        pitch: 'Pitch',
        roll: 'Roll',
        yaw: 'Yaw',
        ports: 'ポート',
        noReading: 'まだ受信していません',
        stale: '値の更新が止まっています',
        noConnection: '切断中',
        motor: 'モーター',
        color: 'カラーセンサー',
        distance: '距離センサー',
        force: 'フォースセンサー',
        matrix: 'ライトマトリクス',
        unknownDevice: '機器',
        angle: '角度',
        relative: '積算角度',
        speed: '速度',
        pressed: '押されています',
        released: '押されていません',
        forceValue: '力',
        distanceValue: '距離',
        colorValue: '検出色',
        rgb: 'RGB',
        offline: 'ハブ単独実行',
        offlineHelp: 'ScratchをPythonに変換してハブへ転送・起動します。通常のリアルタイム実行はこのPC上で動きます。',
        slot: 'ハブのスロット',
        review: '転送内容を確認',
        confirmUpload: 'スロットを消去して転送・起動',
        slotWarning: 'スロットの内容は確認できません。実行すると選択したスロットを消去します。制御プログラムのスロットは選べません。',
        working: '処理中…',
        stopHub: 'ハブのプログラムを停止',
        error: '操作に失敗しました',
        close: '閉じる'
    }
};

const hasNumber = value => value !== null && typeof value !== 'undefined' && Number.isFinite(Number(value));
const withUnit = (value, unit) => (hasNumber(value) ? `${value} ${unit}` : '—');
const connectionModeLabel = (mode, translations) => {
    if (mode === 'web-ble') return translations.modeWebBluetooth;
    if (mode === 'scratchlink-ble') return translations.modeScratchLink;
    if (mode === 'auto') return translations.modeAuto;
    return mode || '—';
};

class SpikePrimeControlCenter extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            open: false,
            snapshot: null,
            now: Date.now(),
            busy: false,
            error: '',
            connectionMode: 'web-ble',
            peripherals: [],
            buildInfo: null,
            controllerSlot: 19,
            controllerConfirmation: null,
            standaloneSlot: 1,
            standaloneConfirmation: null
        };
        this.mounted = false;
        this.poll = null;
        this.routerAdapters = new WeakMap();
        this.controllerSlotTouched = false;
        bindAll(this, [
            'refresh', 'handleTogglePanel', 'handleClosePanel', 'handleConnect', 'handleDisconnect',
            'handleStopHub', 'handleControllerSlotChanged', 'handleReviewControllerSlot',
            'handleConfirmControllerInstall', 'handleCancelControllerInstall',
            'handleStandaloneSlotChanged', 'handleReviewStandaloneSlot',
            'handleConfirmStandaloneRun', 'handleCancelStandaloneRun',
            'handleConnectionModeChanged', 'handlePeripheralListUpdate',
            'handlePeripheralRequestError', 'handleConnectPeripheral'
        ]);
    }

    componentDidMount () {
        this.mounted = true;
        this.props.vm.on('PERIPHERAL_LIST_UPDATE', this.handlePeripheralListUpdate);
        this.props.vm.on('PERIPHERAL_REQUEST_ERROR', this.handlePeripheralRequestError);
        this.refresh();
        this.poll = setInterval(this.refresh, 200);
    }

    componentWillUnmount () {
        this.mounted = false;
        this.props.vm.removeListener('PERIPHERAL_LIST_UPDATE', this.handlePeripheralListUpdate);
        this.props.vm.removeListener('PERIPHERAL_REQUEST_ERROR', this.handlePeripheralRequestError);
        if (this.poll) clearInterval(this.poll);
    }

    getRouter () {
        return this.props.vm.runtime.peripheralExtensions &&
            this.props.vm.runtime.peripheralExtensions.spikeprime;
    }

    getAPI () {
        const router = this.getRouter();
        if (router && typeof router.getControlCenterAPI === 'function') {
            const api = router.getControlCenterAPI();
            return api && api.hubRouterId === router.instanceId ? api : null;
        }
        if (router) {
            if (!this.routerAdapters.has(router)) {
                this.routerAdapters.set(router, {
                    extensionId: 'spikeprime',
                    hubRouterId: router.instanceId || 'Scratch VM spikeprime router',
                    getState: () => {
                        const diagnostics = router.getCommunicationDiagnostics ?
                            router.getCommunicationDiagnostics() : {};
                        const active = router.active || {};
                        const connected = Boolean(router.isConnected && router.isConnected());
                        return {
                            extensionId: 'spikeprime',
                            hubRouterId: router.instanceId || 'Scratch VM spikeprime router',
                            runtimeRegistered: this.props.vm.runtime.peripheralExtensions.spikeprime === router,
                            sourceURL: this.getLoadedSourceURL(null),
                            connected,
                            protocol: router.protocol,
                            connectionMode: router.resolvedMode || router.mode,
                            selectedConnectionMode: router.mode,
                            deviceName: active._link && active._link._device && active._link._device.name,
                            firmwareVersion: router.firmwareVersion,
                            controllerSlot: null,
                            controllerReady: Boolean(diagnostics.controllerReady),
                            controllerStatus: diagnostics.controllerStatus,
                            angles: active._sensors && active._sensors.angle,
                            imuReceivedAt: diagnostics.lastImuReceivedAt,
                            motorPorts: diagnostics.motorPorts || {},
                            portSensors: diagnostics.portSensors || active.portValues || {},
                            lastCommunicationError: diagnostics.lastCommunicationError,
                            diagnostics
                        };
                    },
                    connect: async mode => {
                        router.setMode(mode);
                        await router.scan();
                        if (!router.isConnected() && mode !== 'scratchlink-ble' && mode !== 'auto') {
                            throw new Error('The selected connection route did not connect to a SPIKE hub.');
                        }
                    },
                    connectPeripheral: peripheralId => router.connect(peripheralId),
                    setMode: mode => router.setMode(mode),
                    disconnect: () => router.disconnect(),
                    stop: () => router.stopAll()
                });
            }
            return this.routerAdapters.get(router);
        }
        const bridge = this.props.vm.runtime.brickwrightSpikePrimeControl;
        return bridge || null;
    }

    updateIfMounted (nextState) {
        if (this.mounted) this.setState(nextState);
    }

    refresh () {
        const api = this.getAPI();
        let snapshot = null;
        try {
            if (api && typeof api.getState === 'function') snapshot = api.getState();
        } catch (error) {
            this.updateIfMounted({error: error.message || String(error)});
        }
        if (snapshot && Number.isInteger(snapshot.controllerSlot) && !this.controllerSlotTouched) {
            this.setState({controllerSlot: snapshot.controllerSlot});
        }
        this.updateIfMounted({snapshot, now: Date.now()});
        this.loadBuildInfo(snapshot);
    }

    getLoadedSourceURL (snapshot) {
        const manager = this.props.vm.extensionManager;
        const urls = manager && typeof manager.getExtensionURLs === 'function' ?
            manager.getExtensionURLs() : {};
        return urls.spikeprime || (snapshot && snapshot.sourceURL) || '';
    }

    loadBuildInfo (snapshot) {
        const sourceURL = this.getLoadedSourceURL(snapshot);
        if (!sourceURL || this.requestedBuildInfoURL) return;
        let parsed;
        try {
            parsed = new URL(sourceURL);
        } catch (error) {
            return;
        }
        if (parsed.hostname !== 'localhost' || parsed.port !== '8000') return;
        const infoURL = `${parsed.origin}/__brickwright/build-info.json`;
        this.requestedBuildInfoURL = infoURL;
        fetch(infoURL, {cache: 'no-store'}).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
            .then(buildInfo => {
                this.updateIfMounted({buildInfo});
            })
            .catch(() => {
                this.requestedBuildInfoURL = null;
            });
    }

    async runAction (name, ...args) {
        const api = this.getAPI();
        if (!api || typeof api[name] !== 'function') return;
        this.updateIfMounted({busy: true, error: ''});
        try {
            await api[name](...args);
            if (name === 'installController') {
                this.updateIfMounted({controllerConfirmation: null});
            }
            this.refresh();
        } catch (error) {
            this.updateIfMounted({error: error.message || String(error)});
            this.refresh();
        } finally {
            this.updateIfMounted({busy: false});
        }
    }

    async runStandalone (slot) {
        const api = this.getAPI();
        if (!api) return;
        this.updateIfMounted({busy: true, error: ''});
        try {
            const source = api.generatePython();
            await api.uploadAndRun(slot, source);
            this.updateIfMounted({standaloneConfirmation: null});
            this.refresh();
        } catch (error) {
            this.updateIfMounted({error: error.message || String(error)});
        } finally {
            this.updateIfMounted({busy: false});
        }
    }

    getWords () {
        const locale = this.props.intl && this.props.intl.locale;
        const pageLanguage = typeof document === 'undefined' ? '' : document.documentElement.lang;
        const language = locale || pageLanguage;
        return language.toLowerCase().startsWith('ja') ? words.ja : words.en;
    }

    handleTogglePanel () {
        this.setState(state => ({open: !state.open}));
    }

    handleClosePanel () {
        this.setState({open: false});
    }

    handleConnect () {
        this.runAction('connect', this.state.connectionMode);
    }

    handleConnectionModeChanged (event) {
        const connectionMode = event.target.value;
        this.setState({connectionMode, peripherals: []});
        const api = this.getAPI();
        if (api && typeof api.setMode === 'function') api.setMode(connectionMode);
    }

    handlePeripheralListUpdate (peripheralList) {
        this.updateIfMounted({peripherals: Object.values(peripheralList || {})});
    }

    handlePeripheralRequestError () {
        const snapshot = this.state.snapshot;
        if (!snapshot || !snapshot.connected) {
            this.updateIfMounted({error: 'Hub discovery or connection failed.'});
        }
    }

    handleConnectPeripheral (event) {
        const api = this.getAPI();
        const peripheralId = event.currentTarget.dataset.peripheralId;
        if (api && typeof api.connectPeripheral === 'function') {
            this.runAction('connectPeripheral', peripheralId);
        }
    }

    handleDisconnect () {
        this.runAction('disconnect');
    }

    handleStopHub () {
        this.runAction('stop');
    }

    handleControllerSlotChanged (event) {
        this.controllerSlotTouched = true;
        this.setState({controllerSlot: Number(event.target.value), controllerConfirmation: null});
    }

    handleReviewControllerSlot () {
        this.setState({controllerConfirmation: this.state.controllerSlot});
    }

    handleConfirmControllerInstall () {
        this.runAction('installController', this.state.controllerConfirmation);
    }

    handleCancelControllerInstall () {
        this.setState({controllerConfirmation: null});
    }

    handleStandaloneSlotChanged (event) {
        this.setState({standaloneSlot: Number(event.target.value), standaloneConfirmation: null});
    }

    handleReviewStandaloneSlot () {
        this.setState({standaloneConfirmation: this.state.standaloneSlot});
    }

    handleConfirmStandaloneRun () {
        this.runStandalone(this.state.standaloneConfirmation);
    }

    handleCancelStandaloneRun () {
        this.setState({standaloneConfirmation: null});
    }

    renderSensor (snapshot, value, receivedAt) {
        const w = this.getWords();
        if (!snapshot || !snapshot.connected) return <span className={styles.muted}>{w.noConnection}</span>;
        if (!hasNumber(value)) return <span className={styles.muted}>{w.noReading}</span>;
        const stale = Number.isFinite(receivedAt) && this.state.now - receivedAt > STALE_AFTER_MS;
        return <span className={stale ? styles.stale : ''}>{withUnit(value, '°')}{stale ? ` · ${w.stale}` : ''}</span>;
    }

    renderPort (port, snapshot) {
        const w = this.getWords();
        const portSensor = snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot.motorPorts && snapshot.motorPorts[port];
        const reading = portSensor || motor || {};
        const type = reading.type || (motor ? 'motor' : null);
        const receivedAt = reading.receivedAt;
        const detected = Boolean(type && Number.isFinite(receivedAt));
        const stale = detected && this.state.now - receivedAt > STALE_AFTER_MS;
        const deviceLabel = type === 'motor' ? w.motor : type === 'color' ? w.color :
            type === 'distance' ? w.distance : type === 'force' ? w.force :
                type === 'matrix3' ? w.matrix : w.unknownDevice;
        return (
            <div
                className={`${styles.portCard} ${stale ? styles.portStale : ''}`}
                key={port}
            >
                <div className={styles.portHeading}>
                    <strong>{port}</strong>
                    <span>{snapshot.connected ? (detected ? deviceLabel : w.noReading) : w.noConnection}</span>
                </div>
                {type === 'motor' && detected ? (
                    <>
                        <div>{w.angle}{': '}{withUnit(motor.absolutePosition ?? reading.absolutePosition, '°')}</div>
                        <div>
                            {w.relative}{': '}
                            {withUnit(
                                motor.relativePosition ?? reading.relativePosition ?? reading.degreesCounted,
                                '°'
                            )}
                        </div>
                        <div>{w.speed}{': '}{withUnit(motor.speed ?? reading.speed, '°/s')}</div>
                    </>
                ) : null}
                {type === 'force' && detected ? (
                    <>
                        <div>{w.forceValue}{': '}{withUnit(reading.force, '%')}</div>
                        <div>{reading.pressed ? w.pressed : w.released}</div>
                    </>
                ) : null}
                {type === 'distance' && detected ? (
                    <div>
                        {w.distanceValue}{': '}{withUnit(reading.distanceMM, 'mm')}
                    </div>
                ) : null}
                {type === 'color' && detected ? (
                    <>
                        <div>{w.colorValue}{': '}{hasNumber(reading.color) ? reading.color : '—'}</div>
                        <div>
                            {w.rgb}{': '}
                            {hasNumber(reading.red) ?
                                `${reading.red}, ${reading.green}, ${reading.blue}` :
                                '—'}
                        </div>
                    </>
                ) : null}
                {type === 'matrix3' && detected ? (
                    <div>
                        {w.matrix}{': '}{reading.pixels ? reading.pixels.length : '—'}
                    </div>
                ) : null}
                {stale ? <div className={styles.stale}>{w.stale}</div> : null}
            </div>
        );
    }

    render () {
        const w = this.getWords();
        const {snapshot, open, busy, error} = this.state;
        const api = this.getAPI();
        const connected = Boolean(snapshot && snapshot.connected);
        const controllerReady = Boolean(snapshot && snapshot.controllerReady);
        const router = this.getRouter();
        const sourceURL = this.getLoadedSourceURL(snapshot);
        const routerRegistered = Boolean(
            snapshot && snapshot.runtimeRegistered && router &&
            snapshot.hubRouterId === router.instanceId
        );
        const extensionId = (snapshot && snapshot.extensionId) || 'spikeprime';
        const routerId = (snapshot && snapshot.hubRouterId) || (router && router.instanceId) || '—';
        const slots = Array.from({length: 20}, (_, slot) => slot);
        const reservedSlot = snapshot && Number.isInteger(snapshot.controllerSlot) ?
            snapshot.controllerSlot : this.state.controllerSlot;
        const availableStandaloneSlots = slots.filter(slot => slot !== reservedSlot);
        return (
            <div className={styles.root}>
                <button
                    aria-expanded={open}
                    aria-label={w.title}
                    className={`${styles.hubButton} ${connected ? styles.hubConnected : ''}`}
                    onClick={this.handleTogglePanel}
                    title={w.title}
                    type="button"
                >
                    <span aria-hidden="true">{'◉'}</span>
                    <span className={styles.connectionDot} />
                </button>
                {open ? (
                    <section
                        aria-label={w.title}
                        className={styles.panel}
                    >
                        <header className={styles.panelHeader}>
                            <div>
                                <strong>{w.title}</strong>
                                <div className={connected ? styles.statusConnected : styles.statusDisconnected}>
                                    {connected ?
                                        `${w.connected}${snapshot.deviceName ? ` · ${snapshot.deviceName}` : ''}` :
                                        w.disconnected}
                                </div>
                            </div>
                            <button
                                aria-label={w.close}
                                className={styles.closeButton}
                                onClick={this.handleClosePanel}
                                type="button"
                            >{'×'}</button>
                        </header>
                        <div className={styles.actions}>
                            {connected ? (
                                <button
                                    disabled={busy}
                                    onClick={this.handleDisconnect}
                                    type="button"
                                >{w.disconnect}</button>
                            ) : (
                                <button
                                    disabled={busy || !api}
                                    onClick={this.handleConnect}
                                    type="button"
                                >{busy ? w.connecting : w.connect}</button>
                            )}
                            {connected ? <button
                                disabled={busy}
                                onClick={this.handleStopHub}
                                type="button"
                            >{w.stopHub}</button> : null}
                        </div>
                        <div className={styles.connectionSettings}>
                            <label>{w.connectionMode}
                                <select
                                    aria-label={w.connectionMode}
                                    disabled={busy || connected}
                                    onChange={this.handleConnectionModeChanged}
                                    value={this.state.connectionMode}
                                >
                                    <option value="web-ble">{w.modeWebBluetooth}</option>
                                    <option value="auto">{w.modeAuto}</option>
                                    <option value="scratchlink-ble">{w.modeScratchLink}</option>
                                </select>
                            </label>
                            <div className={styles.modeStatus}>
                                <span>{w.selectedMode}{': '}{connectionModeLabel(this.state.connectionMode, w)}</span>
                                <span>
                                    {w.activeMode}{': '}
                                    {connected ? connectionModeLabel(snapshot.connectionMode, w) : '—'}
                                </span>
                            </div>
                        </div>
                        {api ? null : <p className={styles.help}>{w.unavailable}</p>}
                        {this.state.peripherals.length > 0 && !connected ? (
                            <div className={styles.deviceList}>
                                <strong>{w.devices}</strong>
                                {this.state.peripherals.map((peripheral, index) => {
                                    const peripheralId = peripheral.peripheralId || peripheral.id;
                                    return (
                                        <button
                                            data-peripheral-id={peripheralId}
                                            disabled={busy || !api || !peripheralId}
                                            key={peripheralId || index}
                                            onClick={this.handleConnectPeripheral}
                                            type="button"
                                        >
                                            {peripheral.name || peripheralId || w.chooseDevice}{' — '}{w.chooseDevice}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        <details className={styles.sourceDetails}>
                            <summary>{w.developmentSource}</summary>
                            <div>{w.routerRegistered}{': '}{routerRegistered ? w.apiReady : w.apiMissing}</div>
                            <div>{'Extension ID: '}{extensionId}</div>
                            <div>{'Router: '}{routerId}</div>
                            <div className={styles.sourceUrl}>{sourceURL || w.sourceUnavailable}</div>
                            {this.state.buildInfo ? (
                                <>
                                    <div>{w.sourceBranch}{': '}{this.state.buildInfo.branch || '—'}</div>
                                    <div>{w.sourceCommit}{': '}{this.state.buildInfo.commit || '—'}</div>
                                </>
                            ) : null}
                        </details>
                        <div className={styles.installBox}>
                            <label>{w.controllerSlot}
                                <select
                                    aria-label={w.controllerSlot}
                                    disabled={busy}
                                    onChange={this.handleControllerSlotChanged}
                                    value={this.state.controllerSlot}
                                >
                                    {slots.map(slot => (<option
                                        key={slot}
                                        value={slot}
                                    >
                                        {slot}{slot === 19 ? ` · ${w.systemSlot}` : ''}
                                    </option>))}
                                </select>
                            </label>
                            {controllerReady ? (
                                <p>
                                    {w.controller}{': '}{w.ready}{' · '}
                                    {w.controllerSlot}{' '}{snapshot.controllerSlot}
                                </p>
                            ) : this.state.controllerConfirmation === null ? (
                                <button
                                    disabled={busy || !connected || !api}
                                    onClick={this.handleReviewControllerSlot}
                                    type="button"
                                >{w.install}</button>
                            ) : (
                                <div className={styles.confirmBox}>
                                    <p>{w.controllerWarning}</p>
                                    <button
                                        disabled={busy || !connected}
                                        onClick={this.handleConfirmControllerInstall}
                                        type="button"
                                    >
                                        {busy ? w.installing :
                                            `${w.installTo} ${this.state.controllerConfirmation}`}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={this.handleCancelControllerInstall}
                                        type="button"
                                    >
                                        {w.cancel}
                                    </button>
                                </div>
                            )}
                        </div>
                        {connected ? (
                            <>
                                <div className={styles.metadata}>
                                    <span>{w.firmware}{': '}{snapshot.firmwareVersion || '—'}</span>
                                    <span>{w.controller}{': '}{controllerReady ? w.ready : w.unknown}</span>
                                </div>
                                <h3 className={styles.sectionTitle}>{w.imu}</h3>
                                <div className={styles.imuGrid}>
                                    {['pitch', 'roll', 'yaw'].map(axis => (
                                        <div key={axis}>
                                            <span>{w[axis]}</span>
                                            {this.renderSensor(
                                                snapshot,
                                                snapshot.angles && snapshot.angles[axis],
                                                snapshot.imuReceivedAt
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <h3 className={styles.sectionTitle}>{w.ports}</h3>
                                <div className={styles.portGrid}>
                                    {PORTS.map(port => this.renderPort(port, snapshot))}
                                </div>
                            </>
                        ) : null}
                        <details className={styles.offline}>
                            <summary>{w.offline}</summary>
                            <p>{w.offlineHelp}</p>
                            <label>{w.standaloneSlot}
                                <select
                                    aria-label={w.standaloneSlot}
                                    disabled={busy}
                                    onChange={this.handleStandaloneSlotChanged}
                                    value={this.state.standaloneSlot}
                                >
                                    {availableStandaloneSlots.map(slot => (<option
                                        key={slot}
                                        value={slot}
                                    >
                                        {slot}{slot === 19 ? ` · ${w.systemSlot}` : ''}
                                    </option>))}
                                </select>
                            </label>
                            {this.state.standaloneConfirmation === null ? (
                                <button
                                    disabled={busy || !connected || !api}
                                    onClick={this.handleReviewStandaloneSlot}
                                    type="button"
                                >{w.review}</button>
                            ) : (
                                <div className={styles.confirmBox}>
                                    <p>{w.slotWarning}</p>
                                    <button
                                        disabled={busy || !connected}
                                        onClick={this.handleConfirmStandaloneRun}
                                        type="button"
                                    >
                                        {busy ? w.working : `${w.confirmUpload} ${this.state.standaloneConfirmation}`}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={this.handleCancelStandaloneRun}
                                        type="button"
                                    >
                                        {w.cancel}
                                    </button>
                                </div>
                            )}
                        </details>
                        {error || (snapshot && snapshot.lastCommunicationError) ? (
                            <div
                                className={styles.error}
                                role="status"
                            >
                                <strong>{w.error}{': '}</strong>{error || snapshot.lastCommunicationError}
                            </div>
                        ) : null}
                    </section>
                ) : null}
            </div>
        );
    }
}

SpikePrimeControlCenter.propTypes = {
    intl: PropTypes.shape({locale: PropTypes.string}),
    vm: PropTypes.instanceOf(VM).isRequired
};

export default SpikePrimeControlCenter;
