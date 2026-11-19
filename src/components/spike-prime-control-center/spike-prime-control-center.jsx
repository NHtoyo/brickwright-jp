import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import bindAll from 'lodash.bindall';

import styles from './spike-prime-control-center.css';

const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STALE_AFTER_MS = 1500;
const SPIKE_COLOR_NAMES = {
    en: ['black', 'magenta', 'purple', 'blue', 'azure', 'turquoise', 'green', 'yellow', 'orange', 'red', 'white'],
    ja: ['黒', 'マゼンタ', '紫', '青', '水色', 'ターコイズ', '緑', '黄', 'オレンジ', '赤', '白']
};

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
        connectionError: 'Connection error',
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
        oldControllerRemoval: 'After the new controller is fully transferred, the remembered controller in ' +
            'slot {slot} is cleared before the new program starts.',
        controllerNotReady: 'The new controller did not reach ready state. Previous slot {slot}: ' +
            '{slotStatus}. {reason}',
        controllerInstallNotReady: 'The controller did not reach ready state. {reason}',
        controllerCleanupUnconfirmed: 'The new controller is ready, but cleanup of previous slot {slot} ' +
            'was not confirmed: {slotStatus}. {reason}',
        previousSlotRemains: 'the previous controller is still present',
        previousSlotCleared: 'the previous controller was cleared after the new transfer',
        previousSlotUnknown: 'whether the previous controller remains is unknown',
        inspectDiagnostics: 'Check the communication diagnostics.',
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
        pressed: 'Pressed',
        released: 'Released',
        forceValue: 'Force',
        distanceValue: 'Distance',
        colorValue: 'Detected color',
        rgb: 'RGB',
        confirmUpload: 'Clear, upload, and start slot',
        slotWarning: 'Slot contents cannot be inspected. This operation clears the ' +
            'selected slot. The controller slot is reserved.',
        stopHub: 'Stop hub program',
        error: 'Action failed',
        close: 'Close',
        liveView: 'Live hub view',
        pcRunLabel: 'PC Scratch: use the green flag',
        standaloneLabel: 'Hub standalone',
        runStandalone: 'Review transfer',
        absoluteAngle: 'Absolute angle',
        countedAngle: 'Counted angle',
        rawSpeed: 'speed',
        displayMode: 'Port display',
        valueMode: 'Value',
        stateMode: 'State / reflection',
        reflection: 'Reflection',
        noColor: 'No color detected',
        noReflection: 'Reflection unavailable',
        lastValue: 'last value'
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
        connectionError: '接続エラー',
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
        oldControllerRemoval: '新しい制御プログラムの転送が完了すると、新しいプログラムの起動前に以前のスロット {slot} を消去します。',
        controllerNotReady: '新しい制御プログラムの起動を確認できません。以前のスロット {slot}：{slotStatus}。{reason}',
        controllerInstallNotReady: '制御プログラムの起動を確認できませんでした。{reason}',
        controllerCleanupUnconfirmed: '新しい制御プログラムは起動しましたが、以前のスロット {slot} の消去状態を確認できません：{slotStatus}。{reason}',
        previousSlotRemains: '以前の制御プログラムが残っています',
        previousSlotCleared: '新しいプログラムの転送後に以前の制御プログラムを消去しました',
        previousSlotUnknown: '以前の制御プログラムが残っているか確認できません',
        inspectDiagnostics: '通信診断を確認してください。',
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
        pressed: '押されています',
        released: '押されていません',
        forceValue: '力',
        distanceValue: '距離',
        colorValue: '検出色',
        rgb: 'RGB',
        confirmUpload: 'スロットを消去して転送・起動',
        slotWarning: 'スロットの内容は確認できません。実行すると選択したスロットを消去します。制御プログラムのスロットは選べません。',
        stopHub: 'ハブのプログラムを停止',
        error: '操作に失敗しました',
        close: '閉じる',
        liveView: 'ハブのライブ表示',
        pcRunLabel: 'PC上のScratch：緑の旗で実行',
        standaloneLabel: 'ハブで単独実行',
        runStandalone: '転送内容を確認',
        absoluteAngle: '絶対角度',
        countedAngle: 'カウント角度',
        rawSpeed: '速度値',
        displayMode: 'ポート表示',
        valueMode: '測定値',
        stateMode: '状態・反射光',
        reflection: '反射光',
        noColor: '色を検出していません',
        noReflection: '反射光の値は未受信です',
        lastValue: '最後の値'
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
            displayMode: 'value',
            snapshot: null,
            now: Date.now(),
            busy: false,
            error: '',
            connectionMode: 'web-ble',
            peripherals: [],
            buildInfo: null,
            controllerSlot: 0,
            controllerConfirmation: null,
            standaloneSlot: 0,
            standaloneConfirmation: null
        };
        this.mounted = false;
        this.poll = null;
        this.routerAdapters = new WeakMap();
        this.currentConnectionIdentity = null;
        bindAll(this, [
            'refresh', 'handleTogglePanel', 'handleClosePanel', 'handleConnect', 'handleDisconnect',
            'handleStopHub', 'handleControllerSlotChanged', 'handleReviewControllerSlot',
            'handleConfirmControllerInstall', 'handleCancelControllerInstall',
            'handleStandaloneSlotChanged', 'handleReviewStandaloneSlot',
            'handleConfirmStandaloneRun', 'handleCancelStandaloneRun',
            'handleConnectionModeChanged', 'handlePeripheralListUpdate',
            'handlePeripheralRequestError', 'handleConnectPeripheral', 'handleDisplayModeChanged'
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

    getConnectionIdentity (snapshot) {
        const router = this.getRouter();
        const link = router && router.active && router.active._link;
        return link || (snapshot && (snapshot.deviceId || snapshot.deviceName)) || null;
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
        const nextConnectionIdentity = snapshot && snapshot.connected ?
            this.getConnectionIdentity(snapshot) : null;
        const wasConnected = Boolean(this.state.snapshot && this.state.snapshot.connected);
        if (wasConnected && (!snapshot || !snapshot.connected ||
            this.currentConnectionIdentity !== nextConnectionIdentity)) {
            this.setState({controllerConfirmation: null, standaloneConfirmation: null});
        }
        this.currentConnectionIdentity = nextConnectionIdentity;
        const controllerSlot = snapshot && Number.isInteger(snapshot.controllerSlot) ?
            snapshot.controllerSlot : null;
        if (Number.isInteger(controllerSlot) && this.state.standaloneSlot === controllerSlot &&
            this.state.standaloneConfirmation !== null) {
            // Keep the chosen destination visible if it becomes reserved, but
            // clear an outdated confirmation. The UI blocks the write until a
            // different slot is explicitly selected.
            this.setState({standaloneConfirmation: null});
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
            const result = await api[name](...args);
            const expectedPreviousSlot = name === 'installController' && args[1] && args[1].previousSlot;
            if (name === 'installController') {
                const cleanup = result && result.cleanup;
                const rawReason = cleanup && (cleanup.error || cleanup.reason || cleanup.status);
                const reason = rawReason && typeof rawReason === 'object' ? rawReason.message : rawReason;
                const slotStatus = cleanup && cleanup.previousSlotRemains === true ?
                    this.getWords().previousSlotRemains :
                    cleanup && cleanup.previousSlotRemains === false ?
                        this.getWords().previousSlotCleared : this.getWords().previousSlotUnknown;
                if (cleanup && cleanup.newControllerReady === false) {
                    const message = Number.isInteger(expectedPreviousSlot) ?
                        this.getWords().controllerNotReady
                            .replace('{slot}', expectedPreviousSlot)
                            .replace('{slotStatus}', slotStatus)
                            .replace('{reason}', reason || this.getWords().inspectDiagnostics) :
                        this.getWords().controllerInstallNotReady
                            .replace('{reason}', reason || this.getWords().inspectDiagnostics);
                    this.updateIfMounted({controllerConfirmation: null, error: message});
                    this.refresh();
                    return;
                }
                if (Number.isInteger(expectedPreviousSlot) && cleanup && cleanup.status !== 'deleted') {
                    if (cleanup.newControllerReady === true) {
                        this.updateIfMounted({
                            controllerConfirmation: null,
                            error: this.getWords().controllerCleanupUnconfirmed
                                .replace('{slot}', expectedPreviousSlot)
                                .replace('{slotStatus}', slotStatus)
                                .replace('{reason}', reason || this.getWords().inspectDiagnostics)
                        });
                        this.refresh();
                        return;
                    }
                    const message = this.getWords().controllerNotReady
                        .replace('{slot}', expectedPreviousSlot)
                        .replace('{slotStatus}', slotStatus)
                        .replace('{reason}', reason || this.getWords().inspectDiagnostics);
                    this.updateIfMounted({controllerConfirmation: null, error: message});
                    this.refresh();
                    return;
                }
                this.updateIfMounted({controllerConfirmation: null});
            }
            this.refresh();
        } catch (error) {
            this.updateIfMounted({
                ...(name === 'installController' ? {controllerConfirmation: null} : {}),
                error: error.message || String(error)
            });
            this.refresh();
        } finally {
            this.updateIfMounted({busy: false});
        }
    }

    async runStandalone (slot) {
        const api = this.getAPI();
        if (!api || !Number.isInteger(slot) || this.isReservedSlot(slot)) return;
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

    getColorName (value) {
        if (!hasNumber(value) || value < 0) return this.getWords().noColor;
        const language = this.getWords() === words.ja ? 'ja' : 'en';
        return SPIKE_COLOR_NAMES[language][value] ||
            `${language === 'ja' ? '色番号' : 'Color code'} ${value}`;
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
        const controllerSlot = event.target.value === '' ? null : Number(event.target.value);
        this.setState({controllerSlot, controllerConfirmation: null});
    }

    handleReviewControllerSlot () {
        if (!Number.isInteger(this.state.controllerSlot)) return;
        const knownSlot = this.state.snapshot && this.state.snapshot.controllerMigrationSlot;
        const previousSlot = Number.isInteger(knownSlot) && knownSlot !== this.state.controllerSlot ?
            knownSlot : null;
        this.setState({
            controllerConfirmation: {
                slot: this.state.controllerSlot,
                previousSlot,
                connectionIdentity: this.currentConnectionIdentity
            }
        });
    }

    handleConfirmControllerInstall () {
        const confirmation = this.state.controllerConfirmation;
        if (!confirmation) return;
        const currentIdentity = this.getConnectionIdentity(this.state.snapshot);
        const currentPreviousSlot = this.state.snapshot && this.state.snapshot.controllerMigrationSlot;
        if (!this.state.snapshot || !this.state.snapshot.connected ||
            !confirmation.connectionIdentity || confirmation.connectionIdentity !== currentIdentity ||
            confirmation.previousSlot !== (Number.isInteger(currentPreviousSlot) ? currentPreviousSlot : null)) {
            this.setState({controllerConfirmation: null});
            return;
        }
        const options = Number.isInteger(confirmation.previousSlot) ?
            {previousSlot: confirmation.previousSlot} : null;
        if (options) this.runAction('installController', confirmation.slot, options);
        else this.runAction('installController', confirmation.slot);
    }

    handleCancelControllerInstall () {
        this.setState({controllerConfirmation: null});
    }

    handleStandaloneSlotChanged (event) {
        const standaloneSlot = event.target.value === '' ? null : Number(event.target.value);
        this.setState({standaloneSlot, standaloneConfirmation: null});
    }

    handleReviewStandaloneSlot () {
        if (!Number.isInteger(this.state.standaloneSlot) ||
            this.isReservedSlot(this.state.standaloneSlot)) return;
        this.setState({
            standaloneConfirmation: {
                slot: this.state.standaloneSlot,
                connectionIdentity: this.currentConnectionIdentity
            }
        });
    }

    handleConfirmStandaloneRun () {
        const confirmation = this.state.standaloneConfirmation;
        const currentIdentity = this.getConnectionIdentity(this.state.snapshot);
        if (!confirmation || confirmation.slot !== this.state.standaloneSlot ||
            !this.state.snapshot || !this.state.snapshot.connected ||
            !confirmation.connectionIdentity || confirmation.connectionIdentity !== currentIdentity ||
            this.isReservedSlot(this.state.standaloneSlot)) {
            this.setState({standaloneConfirmation: null});
            return;
        }
        this.runStandalone(confirmation.slot);
    }

    handleCancelStandaloneRun () {
        this.setState({standaloneConfirmation: null});
    }

    isReservedSlot (slot) {
        const snapshot = this.state.snapshot;
        return Boolean(snapshot && Number.isInteger(snapshot.controllerSlot) &&
            slot === snapshot.controllerSlot);
    }

    handleDisplayModeChanged (event) {
        this.setState({displayMode: event.target.value});
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
        const portSensor = snapshot && snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot && snapshot.motorPorts && snapshot.motorPorts[port];
        const reading = portSensor || motor || {};
        const type = reading.type || (motor ? 'motor' : null);
        const receivedAt = reading.receivedAt;
        const detected = Boolean(type && Number.isFinite(receivedAt));
        const stale = Boolean(snapshot && snapshot.connected && detected &&
            this.state.now - receivedAt > STALE_AFTER_MS);
        const deviceLabel = type === 'motor' ? w.motor : type === 'color' ? w.color :
            type === 'distance' ? w.distance : type === 'force' ? w.force :
                type === 'matrix3' ? w.matrix : w.unknownDevice;
        const icon = type === 'motor' ? '⚙' : type === 'force' ? '◉' :
            type === 'distance' ? '⌁' : type === 'color' ? '◐' : type === 'matrix3' ? '▦' : '·';
        let value = w.noReading;
        if (detected && type === 'motor') {
            const angle = this.state.displayMode === 'state' ?
                ((motor && motor.relativePosition) ?? reading.relativePosition ?? reading.degreesCounted) :
                ((motor && motor.absolutePosition) ?? reading.absolutePosition);
            value = hasNumber(angle) ? `${angle}°` : w.noReading;
        } else if (detected && type === 'force') {
            value = this.state.displayMode === 'state' ?
                (typeof reading.pressed === 'boolean' ? (reading.pressed ? w.pressed : w.released) : w.noReading) :
                (hasNumber(reading.force) ? `${reading.force}%` : w.noReading);
        } else if (detected && type === 'distance') {
            value = hasNumber(reading.distanceMM) ? `${reading.distanceMM} mm` : w.noReading;
        } else if (detected && type === 'color') {
            value = this.state.displayMode === 'state' ?
                (hasNumber(reading.reflection) ? `${w.reflection} ${reading.reflection}%` : w.noReflection) :
                this.getColorName(reading.color);
        } else if (detected) {
            value = deviceLabel;
        }
        const accessibleValue = stale ? `${w.stale}; ${w.lastValue}: ${value}` : value;
        const ariaLabel = `${port}: ${deviceLabel}, ${accessibleValue}`;
        const portClassName = `${styles.livePort} ${stale ? styles.portStale : ''}`;
        const speed = (motor && motor.speed) ?? reading.speed;
        return (
            <div
                aria-label={ariaLabel}
                className={portClassName}
                key={port}
            >
                <div className={styles.portIdentity}>
                    <span
                        aria-hidden="true"
                        className={styles.deviceIcon}
                    >{icon}</span>
                    <strong>{port}</strong>
                </div>
                <span
                    className={styles.portValue}
                    title={!snapshot || !snapshot.connected ? w.noConnection : value}
                >
                    {!snapshot || !snapshot.connected ? w.noConnection : value}
                </span>
                <span className={styles.portDevice}>{type && type !== 'motor' && !stale ? deviceLabel : ''}</span>
                {stale ? <span className={styles.stale}>{w.stale}</span> : null}
                {type === 'motor' && detected && !stale ? <span className={styles.portSpeed}>
                    {w.rawSpeed} {hasNumber(speed) ? speed : '—'}
                </span> : null}
            </div>
        );
    }

    renderPortDetails (port, snapshot) {
        const w = this.getWords();
        const portSensor = snapshot && snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot && snapshot.motorPorts && snapshot.motorPorts[port];
        const reading = portSensor || motor || {};
        const type = reading.type || (motor ? 'motor' : null);
        const receivedAt = reading.receivedAt;
        const detected = Boolean(type && Number.isFinite(receivedAt));
        const stale = Boolean(snapshot && snapshot.connected && detected &&
            this.state.now - receivedAt > STALE_AFTER_MS);
        const absolutePosition = (motor && motor.absolutePosition) ?? reading.absolutePosition;
        const countedPosition = (motor && motor.relativePosition) ??
            reading.relativePosition ?? reading.degreesCounted;
        const speed = (motor && motor.speed) ?? reading.speed;
        const colorDescription = this.getColorName(reading.color);
        return (
            <div
                className={`${styles.portCard} ${stale ? styles.portStale : ''}`}
                key={port}
            >
                <div className={styles.portHeading}>
                    <strong>{port}</strong>
                    <span>{type || w.noReading}</span>
                </div>
                {!snapshot || !snapshot.connected ? <div>{w.noConnection}</div> : null}
                {snapshot && snapshot.connected && !detected ? <div>{w.noReading}</div> : null}
                {type === 'motor' && detected ? (
                    <>
                        <div>{w.absoluteAngle}{': '}{withUnit(absolutePosition, '°')}</div>
                        <div>{w.countedAngle}{': '}{withUnit(countedPosition, '°')}</div>
                        <div>{w.rawSpeed}{': '}{hasNumber(speed) ? speed : '—'}</div>
                    </>
                ) : null}
                {type === 'force' && detected ? (
                    <div>
                        {this.state.displayMode === 'state' ?
                            (typeof reading.pressed === 'boolean' ?
                                (reading.pressed ? w.pressed : w.released) : w.noReading) :
                            `${w.forceValue}: ${withUnit(reading.force, '%')}`}
                    </div>
                ) : null}
                {type === 'distance' && detected ? (
                    <div>{w.distanceValue}{': '}{withUnit(reading.distanceMM, 'mm')}</div>
                ) : null}
                {type === 'color' && detected ? (
                    this.state.displayMode === 'state' ? (
                        <div>{w.reflection}{': '}{hasNumber(reading.reflection) ?
                            withUnit(reading.reflection, '%') : w.noReflection}</div>
                    ) : (
                        <>
                            <div>{w.colorValue}{': '}{colorDescription}</div>
                            <div>{w.rgb}{': '}{hasNumber(reading.red) ?
                                `${reading.red}, ${reading.green}, ${reading.blue}` : '—'}</div>
                        </>
                    )
                ) : null}
                {type === 'matrix3' && detected ? <div>
                    {w.matrix}{': '}{reading.pixels ? reading.pixels.length : '—'}
                </div> : null}
                {stale ? <div className={styles.stale}>{w.stale}</div> : null}
            </div>
        );
    }

    render () {
        const w = this.getWords();
        const {snapshot, open, busy, error} = this.state;
        const api = this.getAPI();
        const connected = Boolean(snapshot && snapshot.connected);
        const lastError = error || (snapshot && snapshot.lastCommunicationError);
        const connectionError = !connected && Boolean(lastError);
        const hubStatusLabel = connected ? w.connected :
            (connectionError ? w.connectionError : w.disconnected);
        const hubButtonClass = `${styles.hubButton} ${connected ? styles.hubConnected : ''} ` +
            `${connectionError ? styles.hubError : ''}`;
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
            snapshot.controllerSlot : null;
        const standaloneSlotReserved = this.isReservedSlot(this.state.standaloneSlot);
        const controllerInstallDisabled = busy || !connected || !api ||
            !Number.isInteger(this.state.controllerSlot);
        return (
            <div className={styles.root}>
                <div
                    aria-label={w.liveView}
                    className={styles.liveBar}
                >
                    <button
                        aria-expanded={open}
                        aria-label={`${w.title}: ${hubStatusLabel}`}
                        className={hubButtonClass}
                        onClick={this.handleTogglePanel}
                        title={lastError || w.title}
                        type="button"
                    >
                        <span aria-hidden="true">{'⬡'}</span>
                        <span className={styles.connectionDot} />
                    </button>
                    <span className={styles.hubStatus}>{hubStatusLabel}</span>
                    <div
                        aria-label={w.ports}
                        className={styles.livePorts}
                    >
                        {PORTS.map(port => this.renderPort(port, snapshot))}
                    </div>
                    <div className={styles.runControls}>
                        <span className={styles.pcRunLabel}>{w.pcRunLabel}</span>
                        <label className={styles.standaloneControls}>
                            <span>{w.standaloneLabel}</span>
                            <select
                                aria-label={w.standaloneSlot}
                                disabled={busy}
                                onChange={this.handleStandaloneSlotChanged}
                                value={this.state.standaloneSlot}
                            >
                                {slots.map(slot => (<option
                                    disabled={slot === reservedSlot}
                                    key={slot}
                                    value={slot}
                                >
                                    {slot}{slot === reservedSlot ? ` · ${w.systemSlot}` : ''}
                                </option>))}
                            </select>
                        </label>
                        {this.state.standaloneConfirmation === null ? <button
                            disabled={busy || !connected || !api ||
                                !Number.isInteger(this.state.standaloneSlot) || standaloneSlotReserved}
                            onClick={this.handleReviewStandaloneSlot}
                            type="button"
                        >{w.runStandalone}</button> : <div className={styles.inlineConfirm}>
                            <span>{w.slotWarning}</span>
                            <button
                                disabled={busy || !connected ||
                                    this.isReservedSlot(this.state.standaloneConfirmation.slot)}
                                onClick={this.handleConfirmStandaloneRun}
                                type="button"
                            >
                                {`${w.confirmUpload} ${this.state.standaloneConfirmation.slot}`}
                            </button>
                            <button
                                disabled={busy}
                                onClick={this.handleCancelStandaloneRun}
                                type="button"
                            >{w.cancel}</button>
                        </div>}
                    </div>
                </div>
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
                        <details className={styles.installBox}>
                            <summary>{w.controller}</summary>
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
                                        {slot}{slot === reservedSlot ? ` · ${w.systemSlot}` : ''}
                                    </option>))}
                                </select>
                            </label>
                            {controllerReady ? <p>
                                {w.controller}{': '}{w.ready}{' · '}
                                {w.controllerSlot}{' '}{snapshot.controllerSlot}
                            </p> : null}
                            {this.state.controllerConfirmation === null ? (
                                <button
                                    disabled={controllerInstallDisabled}
                                    onClick={this.handleReviewControllerSlot}
                                    type="button"
                                >{w.install}</button>
                            ) : (
                                <div className={styles.confirmBox}>
                                    <p>{w.controllerWarning}</p>
                                    {Number.isInteger(this.state.controllerConfirmation.previousSlot) ? (
                                        <p>{w.oldControllerRemoval.replace(
                                            '{slot}', this.state.controllerConfirmation.previousSlot
                                        )}</p>
                                    ) : null}
                                    <button
                                        disabled={busy || !connected}
                                        onClick={this.handleConfirmControllerInstall}
                                        type="button"
                                    >
                                        {busy ? w.installing :
                                            `${w.installTo} ${this.state.controllerConfirmation.slot}`}
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
                        </details>
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
                                <label className={styles.displayMode}>{w.displayMode}
                                    <select
                                        aria-label={w.displayMode}
                                        onChange={this.handleDisplayModeChanged}
                                        value={this.state.displayMode}
                                    >
                                        <option value="value">{w.valueMode}</option>
                                        <option value="state">{w.stateMode}</option>
                                    </select>
                                </label>
                                <div className={styles.portGrid}>
                                    {PORTS.map(port => this.renderPortDetails(port, snapshot))}
                                </div>
                            </>
                        ) : null}
                        {lastError ? (
                            <div
                                className={styles.error}
                                role="status"
                            >
                                <strong>{w.error}{': '}</strong>{lastError}
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
