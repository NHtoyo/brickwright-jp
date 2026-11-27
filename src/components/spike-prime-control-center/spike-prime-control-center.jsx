import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import bindAll from 'lodash.bindall';
import {
    getStandardSpikeExtensionSourceURL,
    loadStandardSpikeExtension
} from '../../lib/spike-prime-extension-loader';
import {STANDARD_SPIKE_EXTENSION_ID} from '../../lib/extension-gallery-sources';
import {getSpikeSensorFreshness, isSpikeSensorSampleUsable} from '../../lib/spike-sensor-freshness';

import styles from './spike-prime-control-center.css';

const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SPIKE_COLOR_NAMES = {
    en: ['black', 'magenta', 'purple', 'blue', 'azure', 'turquoise', 'green', 'yellow', 'orange', 'red', 'white'],
    ja: ['黒', 'マゼンタ', '紫', '青', '水色', 'ターコイズ', '緑', '黄', 'オレンジ', '赤', '白']
};

const words = {
    en: {
        title: 'LEGO hub',
        model: 'Hub model',
        modelAuto: 'Auto detect',
        modelPrime: 'SPIKE Prime',
        modelEssential: 'SPIKE Essential',
        detectedModel: 'Detected model',
        activeModel: 'Using model',
        modelMismatch: 'Selected and detected models differ. The detected hub protocol will be used.',
        portUnavailable: 'Unavailable on this hub',
        loadingExtension: 'Loading the standard SPIKE extension…',
        extensionLoadError: 'Could not load the standard SPIKE extension.',
        retryExtensionLoad: 'Retry loading',
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
        unavailable: 'The standard SPIKE extension is not available yet.',
        firmware: 'Hub OS',
        controller: 'Controller',
        controllerSlot: 'Controller slot',
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
        verifyController: 'Verify controller',
        verifyingController: 'Checking controller…',
        runSavedController: 'Run saved controller in slot {slot}',
        runSavedControllerWarning: 'This starts the program currently stored in slot {slot}. ' +
            'It will not upload or erase anything.',
        runSavedControllerConfirm: 'Start slot {slot}',
        startingController: 'Starting and verifying…',
        recoverControllerSlotReason: 'Select the existing Brickwright controller slot to start it without ' +
            'uploading or erasing.',
        recoverControllerSlotPrompt: 'Register controller slot',
        recoverControllerSlotAction: 'Register existing controller in slot {slot}',
        recoveryHubChanged: 'The connected hub changed. Check the connection before trying again.',
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
        outOfRange: 'Out of range',
        noDevice: 'No device',
        noConnection: 'Disconnected',
        motor: 'Motor',
        motorSmall: 'Small motor',
        motorMedium: 'Medium motor',
        motorLarge: 'Large motor',
        color: 'Color sensor',
        distance: 'Distance sensor',
        force: 'Force sensor',
        matrix: 'Light matrix',
        unknownDevice: 'Device',
        pressed: 'Pressed',
        released: 'Released',
        forceValue: 'Force',
        distanceValue: 'Distance',
        distanceMode: 'Measurement mode',
        distanceLongMode: 'Normal (50–2000 mm)',
        distanceShortMode: 'Short range (50–300 mm)',
        colorValue: 'Detected color',
        rgb: 'RGB',
        confirmUpload: 'Clear, upload, and start slot',
        slotWarning: 'Slot contents cannot be inspected. This operation clears the ' +
            'selected slot. The controller slot is reserved.',
        stopHub: 'Stop hub program',
        error: 'Action failed',
        connectionHelp: 'Could not connect. Check Bluetooth and try again.',
        operationFailure: 'That action did not work. Check the hub connection and try again.',
        stopFailure: 'Could not stop the hub. Check that the motors have stopped.',
        extensionLoadHelp: 'SPIKE controls could not be loaded. Reload Brickwright and try again.',
        close: 'Close',
        liveView: 'Live hub view',
        pcRunLabel: 'PC Scratch: use the green flag',
        standaloneLabel: 'Hub standalone',
        absoluteAngle: 'APOS (0–359°)',
        absolutePositionRaw: 'APOS raw (signed)',
        countedAngle: 'POS (cumulative)',
        measuredSpeed: 'Measured speed',
        derivedSpeed: 'Derived speed (from POS)',
        unknownSpeed: 'Speed (source unknown)',
        speedPercentUnit: '%',
        speedDegreesPerSecondUnit: '°/s',
        displayMode: 'Port display',
        valueMode: 'Value',
        stateMode: 'State / reflection',
        reflection: 'Reflection',
        noColor: 'No color detected',
        unsupportedOperation: 'This operation is not supported by the connected hub model.',
        unsupportedDevice: 'This device is not supported by the connected hub model.',
        positionLabel: 'POS',
        absoluteLabel: 'ABS',
        diagnostics: 'Communication diagnostics',
        diagnosticsLog: 'Open diagnostics log',
        controllerSettings: 'Controller setup'
    },
    ja: {
        title: 'LEGO ハブ',
        model: 'ハブのモデル',
        modelAuto: '自動判別',
        modelPrime: 'SPIKE Prime',
        modelEssential: 'SPIKE Essential',
        detectedModel: '検出したモデル',
        activeModel: '使用モデル',
        modelMismatch: '選択したモデルと検出したモデルが異なります。実際に検出したハブの通信方式を使います。',
        portUnavailable: 'このハブでは使用できません',
        loadingExtension: 'SPIKE標準拡張を読み込み中…',
        extensionLoadError: 'SPIKE標準拡張を読み込めませんでした。',
        retryExtensionLoad: '読み込みを再試行',
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
        unavailable: 'SPIKE標準拡張はまだ利用できません。',
        firmware: 'Hub OS',
        controller: '制御プログラム',
        controllerSlot: '制御プログラム用スロット',
        systemSlot: '制御プログラム用に予約',
        developmentSource: '読み込んだ拡張',
        sourceBranch: 'ブランチ',
        sourceCommit: 'コミット',
        sourceUnavailable: '読み込み元情報を取得できません',
        routerRegistered: 'Scratchブロックのルーター',
        apiReady: 'GUIと共有中',
        apiMissing: '登録されていません',
        ready: '起動確認済み',
        unknown: '応答未確認',
        verifyController: '制御プログラムを確認',
        verifyingController: '制御プログラムを確認中…',
        runSavedController: '保存済みスロット{slot}のプログラムを起動',
        runSavedControllerWarning: 'スロット{slot}に現在保存されているプログラムを起動します。転送・消去は行いません。',
        runSavedControllerConfirm: 'スロット{slot}を起動',
        startingController: '起動を確認中…',
        recoverControllerSlotReason: 'Brickwright制御プログラムが入っているスロットを選ぶと、転送・消去せずにそのプログラムを起動します。',
        recoverControllerSlotPrompt: '制御スロットを登録',
        recoverControllerSlotAction: 'スロット{slot}の既存制御プログラムを登録',
        recoveryHubChanged: '接続先のハブが変わりました。接続状態を確認してから、もう一度操作してください。',
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
        outOfRange: '範囲外',
        noDevice: '機器未接続',
        noConnection: '切断中',
        motor: 'モーター',
        motorSmall: '小型モーター',
        motorMedium: '中型モーター',
        motorLarge: '大型モーター',
        color: 'カラーセンサー',
        distance: '距離センサー',
        force: 'フォースセンサー',
        matrix: 'ライトマトリクス',
        unknownDevice: '機器',
        pressed: '押されています',
        released: '押されていません',
        forceValue: '力',
        distanceValue: '距離',
        distanceMode: '測定モード',
        distanceLongMode: '通常（50～2000 mm）',
        distanceShortMode: '短距離（50～300 mm）',
        colorValue: '検出色',
        rgb: 'RGB',
        confirmUpload: 'スロットを消去して転送・起動',
        slotWarning: 'スロットの内容は確認できません。実行すると選択したスロットを消去します。制御プログラムのスロットは選べません。',
        stopHub: 'ハブのプログラムを停止',
        error: '操作に失敗しました',
        connectionHelp: 'ハブに接続できませんでした。Bluetoothを確認して、もう一度試してください。',
        operationFailure: '操作できませんでした。ハブとの接続を確認して、もう一度試してください。',
        stopFailure: 'ハブを停止できませんでした。モーターが止まっていることを確認してください。',
        extensionLoadHelp: 'SPIKEの操作を読み込めませんでした。Brickwrightを再読み込みしてください。',
        close: '閉じる',
        liveView: 'ハブのライブ表示',
        pcRunLabel: 'PC上のScratch：緑の旗で実行',
        standaloneLabel: 'ハブで単独実行',
        absoluteAngle: 'APOS（0～359°）',
        absolutePositionRaw: 'APOS生値（符号付き）',
        countedAngle: 'POS（累積角度）',
        measuredSpeed: '実測速度',
        derivedSpeed: 'POS差分から算出した速度',
        unknownSpeed: '速度（取得元不明）',
        speedPercentUnit: '%',
        speedDegreesPerSecondUnit: '°/秒',
        displayMode: 'ポート表示',
        valueMode: '測定値',
        stateMode: '状態・反射光',
        reflection: '反射光',
        noColor: '色を検出していません',
        unsupportedOperation: '接続中のハブではこの操作を利用できません。',
        unsupportedDevice: 'この機器は接続中のハブでは利用できません。',
        positionLabel: 'POS',
        absoluteLabel: 'ABS',
        diagnostics: '通信診断',
        diagnosticsLog: '診断ログを開く',
        controllerSettings: '制御プログラムの設定'
    }
};

const hasNumber = value => value !== null && typeof value !== 'undefined' && Number.isFinite(Number(value));
const withUnit = (value, unit) => (hasNumber(value) ? `${value} ${unit}` : '—');
const HardwareIcon = ({type = 'device'}) => {
    const common = {
        'aria-hidden': true,
        'fill': 'none',
        'stroke': 'currentColor',
        'strokeLinecap': 'round',
        'strokeLinejoin': 'round',
        'strokeWidth': 1.7,
        'viewBox': '0 0 24 24'
    };
    if (type === 'hub') {
        return (<svg {...common}>
            <rect
                x="3"
                y="6"
                width="18"
                height="12"
                rx="3"
            />
            <circle
                cx="8"
                cy="12"
                r="1"
            /><circle
                cx="16"
                cy="12"
                r="1"
            />
            <path d="M10 15h4M12 3v3" />
        </svg>);
    }
    if (type === 'motor') {
        return (<svg {...common}>
            <path d="M5 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5zM17 10h3v4h-3M8 4v3m4-3v3m-4 10v3m4-3v3" />
        </svg>);
    }
    if (type === 'force') {
        return (<svg {...common}>
            <path d="M8 4h8v4l3 3v8H5v-8l3-3z" /><path d="M12 8v4m-2 0h4" />
        </svg>);
    }
    if (type === 'distance') {
        return (<svg {...common}>
            <rect
                x="4"
                y="7"
                width="5"
                height="10"
                rx="1"
            /><path d="M12 9a4 4 0 0 1 0 6m2-9a7 7 0 0 1 0 12m2-15a10 10 0 0 1 0 18" />
        </svg>);
    }
    if (type === 'color') {
        return (<svg {...common}>
            <path d="M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4 4 4 0 0 0-4-4z" />
            <circle
                cx="7.5"
                cy="10"
                r=".7"
            /><circle
                cx="11"
                cy="6.7"
                r=".7"
            /><circle
                cx="16"
                cy="8"
                r=".7"
            />
        </svg>);
    }
    if (type === 'matrix3' || type === 'matrix5') {
        return (<svg {...common}>
            {[0, 1, 2].map(row => [0, 1, 2].map(col => (
                <rect
                    key={`${row}-${col}`}
                    x={5 + (col * 5)}
                    y={5 + (row * 5)}
                    width="3"
                    height="3"
                    rx=".5"
                />
            )))}
        </svg>);
    }
    return (<svg {...common}>
        <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="4"
        /><path d="M8 12h8M12 8v8" />
    </svg>);
};

HardwareIcon.propTypes = {
    type: PropTypes.string
};

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
            errorKind: null,
            connectionMode: 'web-ble',
            peripherals: [],
            buildInfo: null,
            controllerSlot: 0,
            controllerConfirmation: null,
            savedControllerConfirmation: null,
            selectedHubModel: 'auto',
            extensionLoadStatus: 'loading',
            extensionLoadError: null,
            extensionSourceConflict: null
        };
        this.mounted = false;
        this.poll = null;
        this.modelSelectionTouched = false;
        this.routerAdapters = new WeakMap();
        this.currentConnectionIdentity = null;
        this.lastDesktopActivitySignature = null;
        this.projectRunning = Boolean(props.vm.runtime && props.vm.runtime.running);
        this.handleProjectStarted = () => {
            this.projectRunning = true;
            this.lastDesktopActivitySignature = null;
            this.refresh();
        };
        this.handleProjectStopped = () => {
            this.projectRunning = false;
            this.lastDesktopActivitySignature = null;
            this.refresh();
        };
        bindAll(this, [
            'refresh', 'handleTogglePanel', 'handleClosePanel', 'handleConnect', 'handleDisconnect',
            'handleStopHub', 'handleControllerSlotChanged', 'handleReviewControllerSlot',
            'handleConfirmControllerInstall', 'handleCancelControllerInstall',
            'handleVerifyController',
            'handleRecoverControllerSlot',
            'handleOpenControllerRecovery',
            'handleReviewSavedController', 'handleConfirmSavedController',
            'handleCancelSavedController',
            'handleConnectionModeChanged', 'handlePeripheralListUpdate',
            'handlePeripheralRequestError', 'handleConnectPeripheral', 'handleDisplayModeChanged',
            'handleHubModelChanged', 'handleRetryExtensionLoad', 'handleOpenDiagnosticsLog',
            'handleDistanceModeChanged'
        ]);
    }

    componentDidMount () {
        this.mounted = true;
        this.props.vm.on('PERIPHERAL_LIST_UPDATE', this.handlePeripheralListUpdate);
        this.props.vm.on('PERIPHERAL_REQUEST_ERROR', this.handlePeripheralRequestError);
        this.props.vm.runtime.on('PROJECT_START', this.handleProjectStarted);
        this.props.vm.runtime.on('PROJECT_STOP_ALL', this.handleProjectStopped);
        this.loadStandardExtension();
        this.refresh();
        this.poll = setInterval(this.refresh, 33);
    }

    componentWillUnmount () {
        this.mounted = false;
        this.props.vm.removeListener('PERIPHERAL_LIST_UPDATE', this.handlePeripheralListUpdate);
        this.props.vm.removeListener('PERIPHERAL_REQUEST_ERROR', this.handlePeripheralRequestError);
        this.props.vm.runtime.removeListener('PROJECT_START', this.handleProjectStarted);
        this.props.vm.runtime.removeListener('PROJECT_STOP_ALL', this.handleProjectStopped);
        if (this.poll) clearInterval(this.poll);
    }

    async loadStandardExtension () {
        if (process.env.NODE_ENV === 'test' && this.getRouter()) {
            this.setState({extensionLoadStatus: 'loaded'});
            return;
        }
        try {
            const result = await loadStandardSpikeExtension(this.props.vm);
            if (!this.mounted) return;
            if (result.status === 'source-conflict') {
                this.setState({
                    extensionLoadStatus: 'conflict',
                    extensionSourceConflict: result.loadedURL
                });
            } else {
                this.setState({
                    extensionLoadStatus: 'loaded',
                    extensionLoadError: null,
                    extensionSourceConflict: null
                });
            }
            this.refresh();
        } catch (error) {
            if (this.mounted) {
                this.setState({
                    extensionLoadStatus: 'error',
                    extensionLoadError: error.message || String(error)
                });
            }
        }
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
                    setHubModel: () => {},
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
            this.updateIfMounted({error: error.message || String(error), errorKind: error.kind || null});
        }
        const nextConnectionIdentity = snapshot && snapshot.connected ?
            this.getConnectionIdentity(snapshot) : null;
        if (typeof window !== 'undefined' && window.brickwrightDesktop &&
            typeof window.brickwrightDesktop.updateActivity === 'function') {
            const motorPorts = (snapshot && snapshot.motorPorts) || {};
            const motorActive = Object.keys(motorPorts).some(port => {
                const speed = motorPorts[port] && motorPorts[port].speed;
                return Number.isFinite(speed) && Math.abs(speed) > 0;
            });
            const activity = {
                bluetoothConnected: Boolean(snapshot && snapshot.connected),
                projectRunning: this.projectRunning,
                motorActive,
                controllerReady: Boolean(snapshot && snapshot.controllerReady),
                controllerBusy: Boolean(snapshot && snapshot.controllerInstallAttempt &&
                    snapshot.controllerInstallAttempt.outcome === 'pending'),
                projectChanged: this.props.projectChanged === true
            };
            const signature = JSON.stringify(activity);
            if (signature !== this.lastDesktopActivitySignature) {
                this.lastDesktopActivitySignature = signature;
                window.brickwrightDesktop.updateActivity(activity);
            }
        }
        const wasConnected = Boolean(this.state.snapshot && this.state.snapshot.connected);
        if (wasConnected && (!snapshot || !snapshot.connected ||
            this.currentConnectionIdentity !== nextConnectionIdentity)) {
            this.setState({
                controllerConfirmation: null,
                savedControllerConfirmation: null
            });
        }
        this.currentConnectionIdentity = nextConnectionIdentity;
        const controllerSlot = snapshot && Number.isInteger(snapshot.controllerSlot) ?
            snapshot.controllerSlot : null;
        const savedControllerConfirmation = this.state.savedControllerConfirmation;
        if (savedControllerConfirmation && (!snapshot || !snapshot.connected ||
            savedControllerConfirmation.slot !== controllerSlot ||
            savedControllerConfirmation.connectionIdentity !== nextConnectionIdentity ||
            this.getEffectiveModel(snapshot) !== 'prime')) {
            this.setState({savedControllerConfirmation: null});
        }
        this.updateIfMounted({
            snapshot,
            now: Date.now(),
            selectedHubModel: !this.modelSelectionTouched && snapshot && snapshot.selectedHubModel ?
                snapshot.selectedHubModel : this.state.selectedHubModel
        });
        this.loadBuildInfo(snapshot);
    }

    getLoadedSourceURL (snapshot) {
        const manager = this.props.vm.extensionManager;
        const urls = manager && typeof manager.getExtensionURLs === 'function' ?
            manager.getExtensionURLs() : {};
        return urls[STANDARD_SPIKE_EXTENSION_ID] || (snapshot && snapshot.sourceURL) ||
            getStandardSpikeExtensionSourceURL(this.props.vm) || '';
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
        this.updateIfMounted({busy: true, error: '', errorKind: null});
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
            if (name === 'startSavedController') {
                this.updateIfMounted({savedControllerConfirmation: null});
            }
            this.refresh();
        } catch (error) {
            const unsupportedDevice = error && (error.kind === 'unsupported-device' ||
                error.code === 'ERR_SPIKE_DEVICE_UNSUPPORTED');
            const unsupported = error && (error.kind === 'unsupported-capability' ||
                error.code === 'ERR_SPIKE_UNSUPPORTED_CAPABILITY');
            this.updateIfMounted({
                ...(name === 'installController' ? {controllerConfirmation: null} : {}),
                ...(name === 'startSavedController' ? {savedControllerConfirmation: null} : {}),
                error: unsupportedDevice ? this.getWords().unsupportedDevice :
                    unsupported ? this.getWords().unsupportedOperation :
                        name === 'stop' ? this.getWords().stopFailure :
                            name === 'connect' ? this.getWords().connectionHelp :
                                this.getWords().operationFailure,
                errorKind: unsupportedDevice ? 'unsupported-device' :
                    unsupported ? 'unsupported-capability' :
                        name === 'stop' ? 'stop-failed' :
                            name === 'connect' ? 'connection-failed' : 'operation-failed'
            });
            this.refresh();
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

    handleOpenDiagnosticsLog () {
        this.runAction('openCommunicationDiagnosticsLog');
    }

    handleConnect () {
        this.runAction('connect', this.state.connectionMode, this.state.selectedHubModel);
    }

    handleHubModelChanged (event) {
        const selectedHubModel = event.target.value;
        // A poll can run between the user's selection and the extension API
        // applying it. Keep the explicit choice until the view is reloaded;
        // otherwise an older `getState()` snapshot snaps the select back to
        // Auto and, in particular, exposes slot controls for Essential.
        this.modelSelectionTouched = true;
        this.setState({selectedHubModel});
        const api = this.getAPI();
        if (api && typeof api.setHubModel === 'function') {
            try {
                const result = api.setHubModel(selectedHubModel);
                if (result && typeof result.catch === 'function') {
                    result.catch(error => this.updateIfMounted({error: error.message || String(error)}));
                }
            } catch (error) {
                this.updateIfMounted({error: error.message || String(error)});
            }
        }
    }

    handleRetryExtensionLoad () {
        this.setState({extensionLoadStatus: 'loading', extensionLoadError: null});
        loadStandardSpikeExtension(this.props.vm)
            .then(result => {
                if (!this.mounted) return;
                this.setState({
                    extensionLoadStatus: result.status,
                    extensionSourceConflict: result.loadedURL || null,
                    extensionLoadError: null
                });
                this.refresh();
            })
            .catch(error => this.updateIfMounted({
                extensionLoadStatus: 'error',
                extensionLoadError: error.message || String(error)
            }));
    }

    handleConnectionModeChanged (event) {
        const connectionMode = event.target.value;
        this.setState({connectionMode, peripherals: []});
        const api = this.getAPI();
        if (api && typeof api.setMode === 'function') api.setMode(connectionMode);
    }

    getEffectiveModel (snapshot = this.state.snapshot) {
        // A disconnected router can retain the last transport/protocol in its
        // diagnostics. Do not infer the offline model from that stale value;
        // only an explicit user selection or a live hub identification is
        // authoritative for hiding model-specific controls.
        if (snapshot && snapshot.connected) {
            if (snapshot.detectedHubModel) return snapshot.detectedHubModel;
            if (snapshot.effectiveHubModel) return snapshot.effectiveHubModel;
            if (snapshot.protocol === 'lwp3' || snapshot.protocol === 'essential') return 'essential';
            if (snapshot.protocol === 'lwp3-essential') return 'essential';
            if (snapshot.protocol === 'spike3' || snapshot.protocol === 'prime') return 'prime';
        }
        if (this.state.selectedHubModel !== 'auto') return this.state.selectedHubModel;
        return null;
    }

    isEssentialHub (snapshot = this.state.snapshot) {
        return this.getEffectiveModel(snapshot) === 'essential';
    }

    isStandaloneCapable (snapshot = this.state.snapshot) {
        // Keep offline download settings available before a hub is selected.
        // The extension may report false while disconnected because it has no
        // active protocol yet; the user's explicit Essential choice is the
        // only case where slot-based execution is known to be unsupported.
        if (!snapshot || !snapshot.connected) return !this.isEssentialHub(snapshot);
        if (snapshot && typeof snapshot.standaloneCapable === 'boolean') {
            return snapshot.standaloneCapable;
        }
        return !this.isEssentialHub(snapshot);
    }

    isPortAvailable (port, snapshot = this.state.snapshot) {
        if (snapshot && Array.isArray(snapshot.availablePorts)) {
            if (!snapshot.connected) {
                return !this.isEssentialHub(snapshot) || ['A', 'B'].includes(port);
            }
            return snapshot.availablePorts.includes(port);
        }
        return !this.isEssentialHub(snapshot) || ['A', 'B'].includes(port);
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

    handleVerifyController () {
        this.runAction('verifyController');
    }

    canRecoverControllerSlot (snapshot, api = this.getAPI()) {
        const diagnostics = snapshot && snapshot.diagnostics;
        const preparation = diagnostics && diagnostics.controllerCommandPreparation;
        const telemetrySessionId = diagnostics && diagnostics.notificationTelemetry &&
            diagnostics.notificationTelemetry.sessionId;
        return Boolean(snapshot && snapshot.connected &&
            this.getEffectiveModel(snapshot) === 'prime' &&
            !Number.isInteger(snapshot.controllerSlot) &&
            preparation && preparation.reason === 'no-controller-slot-registered-for-this-hub' &&
            preparation.outcome === 'rejected' &&
            Number.isInteger(preparation.sessionId) &&
            Number.isInteger(telemetrySessionId) &&
            preparation.sessionId === telemetrySessionId &&
            api && typeof api.recoverControllerSlot === 'function');
    }

    handleRecoverControllerSlot () {
        const snapshot = this.state.snapshot;
        const api = this.getAPI();
        const slot = this.state.controllerSlot;
        const expectedIdentity = this.currentConnectionIdentity;
        if (!Number.isInteger(slot) || !this.canRecoverControllerSlot(snapshot, api) || !expectedIdentity) return;

        let latestSnapshot;
        try {
            latestSnapshot = api.getState();
        } catch (error) {
            this.updateIfMounted({error: error.message || String(error)});
            return;
        }
        const latestIdentity = latestSnapshot && this.getConnectionIdentity(latestSnapshot);
        const preparation = snapshot.diagnostics.controllerCommandPreparation;
        if (latestIdentity !== expectedIdentity) {
            this.updateIfMounted({error: this.getWords().recoveryHubChanged});
            this.refresh();
            return;
        }
        const latestPreparation = latestSnapshot && latestSnapshot.diagnostics &&
            latestSnapshot.diagnostics.controllerCommandPreparation;
        if (!this.canRecoverControllerSlot(latestSnapshot, api) ||
            !latestPreparation || latestPreparation.reason !== preparation.reason ||
            latestPreparation.sessionId !== preparation.sessionId) {
            this.refresh();
            return;
        }
        this.runAction('recoverControllerSlot', slot);
    }

    handleOpenControllerRecovery () {
        this.setState({open: true}, () => {
            if (this.controllerDetailsRef) this.controllerDetailsRef.open = true;
        });
    }

    handleReviewSavedController () {
        const snapshot = this.state.snapshot;
        const slot = snapshot && snapshot.controllerSlot;
        const api = this.getAPI();
        if (!snapshot || !snapshot.connected || this.getEffectiveModel(snapshot) !== 'prime' ||
            !Number.isInteger(slot) || !this.currentConnectionIdentity ||
            !api || typeof api.startSavedController !== 'function') return;
        this.setState({
            savedControllerConfirmation: {
                slot,
                connectionIdentity: this.currentConnectionIdentity
            }
        });
    }

    handleConfirmSavedController () {
        const confirmation = this.state.savedControllerConfirmation;
        const snapshot = this.state.snapshot;
        const currentIdentity = this.getConnectionIdentity(snapshot);
        if (!confirmation || !snapshot || !snapshot.connected ||
            this.getEffectiveModel(snapshot) !== 'prime' ||
            confirmation.slot !== snapshot.controllerSlot ||
            !confirmation.connectionIdentity || confirmation.connectionIdentity !== currentIdentity) {
            this.setState({savedControllerConfirmation: null});
            return;
        }
        this.runAction('startSavedController', confirmation.slot);
    }

    handleCancelSavedController () {
        this.setState({savedControllerConfirmation: null});
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

    isReservedSlot (slot) {
        const snapshot = this.state.snapshot;
        return Boolean(snapshot && Number.isInteger(snapshot.controllerSlot) &&
            slot === snapshot.controllerSlot);
    }

    handleDisplayModeChanged (event) {
        this.setState({displayMode: event.target.value});
    }

    handleDistanceModeChanged (event) {
        const api = this.getAPI();
        if (!api || typeof api.setDistanceSensorMode !== 'function') return;
        const port = event.currentTarget.dataset.port;
        const mode = Number(event.target.value);
        api.setDistanceSensorMode(port, mode).then(() => this.refresh())
            .catch(error => {
                if (!this.mounted) return;
                this.setState({error: error && error.message ? error.message : String(error)});
                this.refresh();
            });
    }

    renderSensor (snapshot, value, receivedAt) {
        if (!snapshot || !snapshot.connected) return null;
        const active = Boolean(snapshot.diagnostics && snapshot.diagnostics.sensorDemand &&
            snapshot.diagnostics.sensorDemand.ports && snapshot.diagnostics.sensorDemand.ports.HUB &&
            snapshot.diagnostics.sensorDemand.ports.HUB.active);
        const freshness = getSpikeSensorFreshness(receivedAt, this.state.now, active);
        if (!isSpikeSensorSampleUsable(freshness) || !hasNumber(value)) return null;
        return <span>{withUnit(value, '°')}</span>;
    }

    getPortType (reading, motor) {
        if (!reading || reading.connected === false) return null;
        const deviceType = reading.deviceType ?? reading.motorType ?? reading.deviceId ??
            (motor && (motor.motorType ?? motor.deviceType));
        const deviceTypes = {
            48: 'motor', // SPIKE medium motor
            49: 'motor', // SPIKE large motor
            65: 'motor', // SPIKE Essential small motor
            61: 'color',
            62: 'distance',
            63: 'force',
            64: 'matrix3'
        };
        return (reading.type && reading.type !== 'unknown' ? reading.type : null) ||
            deviceTypes[Number(deviceType)] || (motor ? 'motor' : null);
    }

    getPortConnectionState (port, snapshot = this.state.snapshot) {
        if (!snapshot || !snapshot.connected || !this.isPortAvailable(port, snapshot)) return 'unknown';
        const reading = snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot.motorPorts && snapshot.motorPorts[port];
        const devices = snapshot.portDevices ||
            (snapshot.diagnostics && snapshot.diagnostics.portDevices);
        const device = devices && devices[port];

        if (reading && reading.connected === false) return 'detached';

        // Prime's 0x3c stream reports observed records, not a complete port
        // inventory. Only its per-port observation expiry can establish that
        // cached identity has gone stale; cached readings are never evidence.
        if (snapshot.protocol === 'spike3' || this.getEffectiveModel(snapshot) === 'prime') {
            const observation = this.getPortObservation(port, snapshot);
            if (observation && observation.status === 'observed') return 'attached';
            if (observation && observation.status === 'stale') return 'stale';
            return 'unknown';
        }

        // Essential's LWP3 attachment registry and explicit attach/detach
        // bits describe the current connection independently of sample age.
        if (device && device.connected === false) return 'detached';
        if (device && device.connected === true) {
            return Number.isFinite(reading && reading.receivedAt) ? 'attached' : 'waiting';
        }
        if ((reading && reading.connected === true) || (motor && motor.connected === true)) {
            return Number.isFinite(reading && reading.receivedAt) ||
                Number.isFinite(motor && motor.receivedAt) ? 'attached' : 'waiting';
        }

        if (this.isEssentialHub(snapshot) && devices && typeof devices === 'object') {
            return 'detached';
        }

        // A typed value without a connection bit is cached data, not proof of
        // a current attachment.
        return 'unknown';
    }

    getPortObservation (port, snapshot) {
        const observations = snapshot && (snapshot.portObservations ||
            (snapshot.diagnostics && snapshot.diagnostics.portObservations));
        return observations && observations[port];
    }

    shouldShowPort (port, snapshot = this.state.snapshot) {
        if (!snapshot || !snapshot.connected || !this.isPortAvailable(port, snapshot)) return false;
        const state = this.getPortConnectionState(port, snapshot);
        if (state !== 'attached' && state !== 'waiting') return false;
        const portSensor = snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot.motorPorts && snapshot.motorPorts[port];
        const devices = snapshot.portDevices || (snapshot.diagnostics && snapshot.diagnostics.portDevices);
        const device = devices && devices[port];
        const observation = this.getPortObservation(port, snapshot);
        const reading = {...(device || {}), ...(motor || {}), ...(portSensor || {}), ...(observation || {})};
        return Boolean(this.getPortType(reading, motor));
    }

    getDeviceLabel (type, reading, w) {
        if (type === 'motor') {
            const deviceType = Number(reading && (reading.motorType ?? reading.deviceType));
            if (deviceType === 0x30) return w.motorMedium;
            if (deviceType === 0x31) return w.motorLarge;
            if (deviceType === 0x41) return w.motorSmall;
            return w.motor;
        }
        return type === 'color' ? w.color : type === 'distance' ? w.distance :
            type === 'force' ? w.force : type === 'matrix3' ? w.matrix : w.unknownDevice;
    }

    getPortFreshness (port, reading, snapshot) {
        const schedulerPort = snapshot && snapshot.diagnostics && snapshot.diagnostics.sensorScheduler &&
            snapshot.diagnostics.sensorScheduler.ports && snapshot.diagnostics.sensorScheduler.ports[port];
        const demandPort = snapshot && snapshot.diagnostics && snapshot.diagnostics.sensorDemand &&
            snapshot.diagnostics.sensorDemand.ports && snapshot.diagnostics.sensorDemand.ports[port];
        const active = Boolean(reading && reading.sensorTelemetry && reading.sensorTelemetry.active) ||
            Boolean(schedulerPort && schedulerPort.active) || Boolean(demandPort && demandPort.active);
        return getSpikeSensorFreshness(reading && reading.receivedAt, this.state.now, active);
    }

    getMotorPositionValues (reading, motor) {
        const sources = [reading || {}, motor || {}];
        const absolutePositionAvailable = sources.map(source => source.absolutePositionAvailable)
            .find(value => typeof value === 'boolean');
        const absolutePositionRaw = absolutePositionAvailable === false ? null :
            sources.map(source => source.absolutePositionRaw).find(hasNumber);
        const absolutePosition = absolutePositionAvailable === false ? null :
            sources.map(source => source.absolutePosition).find(hasNumber);
        const signedSource = hasNumber(absolutePositionRaw) ? absolutePositionRaw : absolutePosition;
        const absoluteAngle = hasNumber(signedSource) ?
            ((Number(signedSource) % 360) + 360) % 360 : null;
        const rawPosition = absolutePositionAvailable === false ? null :
            (hasNumber(absolutePositionRaw) ? absolutePositionRaw : absolutePosition);
        const countedPosition = sources.map(source =>
            source.relativePosition ?? source.degreesCounted)
            .find(hasNumber);
        const speed = sources.map(source => source.speed).find(hasNumber);
        const speedDerived = sources.map(source => source.speedDerived)
            .find(value => typeof value === 'boolean');
        const speedSource = sources.map(source => source.speedSource)
            .find(value => typeof value === 'string');
        const speedUnit = sources.map(source => source.speedUnit)
            .find(value => typeof value === 'string');
        return {absoluteAngle, rawPosition, countedPosition, speed, speedDerived, speedSource, speedUnit};
    }

    renderPort (port, snapshot) {
        const w = this.getWords();
        if (!this.shouldShowPort(port, snapshot)) return null;
        const portSensor = snapshot && snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot && snapshot.motorPorts && snapshot.motorPorts[port];
        const observation = this.getPortObservation(port, snapshot);
        const portDevices = snapshot && (snapshot.portDevices ||
            (snapshot.diagnostics && snapshot.diagnostics.portDevices));
        const portDevice = portDevices && portDevices[port];
        const reading = {...(portDevice || {}), ...(motor || {}), ...(portSensor || {}), ...(observation || {})};
        const type = this.getPortType(reading, motor);
        const receivedAt = Number.isFinite(portSensor && portSensor.receivedAt) ?
            portSensor.receivedAt : Number.isFinite(motor && motor.receivedAt) ?
                motor.receivedAt : observation && observation.lastObservedAt;
        reading.receivedAt = receivedAt;
        const freshness = this.getPortFreshness(port, reading, snapshot);
        const usableSample = isSpikeSensorSampleUsable(freshness);
        if (!type) return null;
        const motorValues = type === 'motor' ? this.getMotorPositionValues(reading, motor) : null;
        const detected = usableSample && (Number.isFinite(receivedAt) || Boolean(motorValues && (
            hasNumber(motorValues.absoluteAngle) || hasNumber(motorValues.countedPosition) ||
            hasNumber(motorValues.speed)
        )));
        const deviceLabel = this.getDeviceLabel(type, reading, w);
        let value = null;
        if (detected && type === 'distance' && reading.quality === 'out-of-range') {
            value = w.outOfRange;
        } else if (detected && type === 'motor' && hasNumber(motorValues.absoluteAngle)) {
            value = `${motorValues.absoluteAngle}°`;
        } else if (detected && type === 'force' && this.state.displayMode === 'state' &&
            typeof reading.pressed === 'boolean') {
            value = reading.pressed ? w.pressed : w.released;
        } else if (detected && type === 'force' && hasNumber(reading.force)) value = String(reading.force);
        else if (detected && type === 'distance' && hasNumber(reading.distanceMM ?? reading.distance)) {
            value = `${reading.distanceMM ?? reading.distance} mm`;
        } else if (detected && type === 'color' && reading.color !== null && typeof reading.color !== 'undefined') {
            value = this.getColorName(reading.color);
        } else if (detected && (type === 'matrix3' || type === 'matrix5') && Array.isArray(reading.pixels)) {
            value = reading.pixels.some(pixel => Number(pixel) > 0) ? 'ON' : 'OFF';
        } else if (detected && reading.value !== null && typeof reading.value !== 'undefined') {
            value = String(reading.value);
        }
        const iconType = type === 'motor' || type === 'force' || type === 'distance' ||
            type === 'color' || type === 'matrix3' || type === 'matrix5' ? type : 'device';
        return (
            <button
                aria-label={[`${port}: ${deviceLabel}`, value].filter(Boolean).join(', ')}
                className={styles.livePort}
                key={port}
                onClick={this.handleTogglePanel}
                title={`${port}: ${deviceLabel}`}
                type="button"
            >
                <span className={styles.portIcon}><HardwareIcon type={iconType} /></span>
                <span className={styles.portIdentity}><strong>{port}</strong></span>
                <span className={styles.portName}>{deviceLabel}</span>
                {value === null ? null : <span className={styles.portValue}>{value}</span>}
            </button>
        );
    }

    isPortAttached (port, snapshot = this.state.snapshot) {
        const state = this.getPortConnectionState(port, snapshot);
        return state === 'attached' || state === 'waiting';
    }

    renderPortDetails (port, snapshot) {
        const w = this.getWords();
        if (!this.shouldShowPort(port, snapshot)) return null;
        const effectiveModel = this.getEffectiveModel(snapshot);
        const portSensor = snapshot && snapshot.portSensors && snapshot.portSensors[port];
        const motor = snapshot && snapshot.motorPorts && snapshot.motorPorts[port];
        const observation = this.getPortObservation(port, snapshot);
        const portDevices = snapshot && (snapshot.portDevices ||
            (snapshot.diagnostics && snapshot.diagnostics.portDevices));
        const portDevice = portDevices && portDevices[port];
        const reading = {...(portDevice || {}), ...(motor || {}), ...(portSensor || {}), ...(observation || {})};
        const type = this.getPortType(reading, motor);
        if (!type) return null;
        const receivedAt = Number.isFinite(portSensor && portSensor.receivedAt) ?
            portSensor.receivedAt : Number.isFinite(motor && motor.receivedAt) ?
                motor.receivedAt : observation && observation.lastObservedAt;
        reading.receivedAt = receivedAt;
        const freshness = this.getPortFreshness(port, reading, snapshot);
        const usableSample = isSpikeSensorSampleUsable(freshness);
        const motorValues = type === 'motor' ? this.getMotorPositionValues(reading, motor) : null;
        const detected = Boolean(usableSample && type && snapshot && snapshot.connected &&
            (Number.isFinite(receivedAt) || hasNumber(reading.position) ||
                hasNumber(reading.relativePosition) || hasNumber(reading.absolutePosition) ||
                (motorValues && (hasNumber(motorValues.absoluteAngle) ||
                    hasNumber(motorValues.countedPosition) || hasNumber(motorValues.speed))) ||
                hasNumber(reading.force) || hasNumber(reading.distanceMM) ||
                (reading.color !== null && typeof reading.color !== 'undefined')));
        const colorDescription = this.getColorName(reading.color);
        const speedUnit = motorValues && motorValues.speedUnit === 'percent-of-max' ?
            w.speedPercentUnit : motorValues && motorValues.speedUnit === 'degrees-per-second' ?
                w.speedDegreesPerSecondUnit : '';
        return (
            <div
                className={styles.portCard}
                key={port}
            >
                <div className={styles.portHeading}>
                    <strong>{port}</strong>
                    <span>{reading.deviceName || this.getDeviceLabel(type, reading, w)}</span>
                </div>
                {type === 'motor' && detected && hasNumber(motorValues.absoluteAngle) ? (
                    <div>{w.absoluteAngle}{': '}{withUnit(motorValues.absoluteAngle, '°')}</div>
                ) : null}
                {type === 'motor' && detected && hasNumber(motorValues.rawPosition) ? (
                    <div>{w.absolutePositionRaw}{': '}{motorValues.rawPosition}{'°'}</div>
                ) : null}
                {type === 'motor' && detected && hasNumber(motorValues.countedPosition) ? (
                    <div>{w.countedAngle}{': '}{withUnit(motorValues.countedPosition, '°')}</div>
                ) : null}
                {type === 'motor' && detected && hasNumber(motorValues.speed) ? (
                    <div>{motorValues.speedDerived === true || motorValues.speedSource === 'pos-delta' ?
                        w.derivedSpeed : motorValues.speedDerived === false ||
                            motorValues.speedSource === 'measured' ? w.measuredSpeed : w.unknownSpeed}{': '}{
                        motorValues.speed
                    }{speedUnit ? ` ${speedUnit}` : ''}</div>
                ) : null}
                {type === 'force' && detected ? (
                    (this.state.displayMode === 'state' && typeof reading.pressed === 'boolean' ?
                        <div>{reading.pressed ? w.pressed : w.released}</div> :
                        hasNumber(reading.force) ? <div>{w.forceValue}{': '}{reading.force}</div> : null)
                ) : null}
                {type === 'distance' && detected ? (
                    <div>
                        {reading.quality === 'out-of-range' ? w.outOfRange :
                            hasNumber(reading.distanceMM ?? reading.distance) ?
                                `${w.distanceValue}: ${withUnit(reading.distanceMM ?? reading.distance, 'mm')}` : null}
                    </div>
                ) : null}
                {type === 'distance' && effectiveModel === 'essential' ? (
                    <label className={styles.distanceModeControl}>
                        <span>{w.distanceMode}</span>
                        <select
                            aria-label={`${port} ${w.distanceMode}`}
                            disabled={!snapshot || !snapshot.connected || Boolean(reading.distanceModeSwitching)}
                            data-port={port}
                            onChange={this.handleDistanceModeChanged}
                            value={Number.isInteger(reading.distanceMode) ? reading.distanceMode : 0}
                        >
                            <option value={0}>{w.distanceLongMode}</option>
                            <option value={1}>{w.distanceShortMode}</option>
                        </select>
                    </label>
                ) : null}
                {type === 'color' && detected ? (
                    this.state.displayMode === 'state' ? (
                        hasNumber(reading.reflection) ?
                            <div>{w.reflection}{': '}{withUnit(reading.reflection, '%')}</div> : null
                    ) : (
                        <>
                            {reading.color !== null && typeof reading.color !== 'undefined' ?
                                <div>{w.colorValue}{': '}{colorDescription}</div> : null}
                            {[reading.red, reading.green, reading.blue].every(hasNumber) ?
                                <div>{w.rgb}{': '}{`${reading.red}, ${reading.green}, ${reading.blue}`}</div> : null}
                        </>
                    )
                ) : null}
                {type === 'matrix3' && detected && Array.isArray(reading.pixels) ?
                    <div>{w.matrix}{': '}{reading.pixels.length}</div> : null}
            </div>
        );
    }

    render () {
        const w = this.getWords();
        const {snapshot, open, busy, error} = this.state;
        const api = this.getAPI();
        const connected = Boolean(snapshot && snapshot.connected);
        const lastError = error || (snapshot && snapshot.lastCommunicationError);
        const unsupportedError = this.state.errorKind === 'unsupported-capability' ||
            this.state.errorKind === 'unsupported-device';
        const connectionError = !connected && Boolean(lastError) && !unsupportedError;
        const displayError = this.state.errorKind === 'stop-failed' ? w.stopFailure :
            unsupportedError ? error : error ? w.operationFailure : connectionError ? w.connectionHelp : null;
        const hubStatusLabel = connected ? w.connected :
            (connectionError ? w.connectionError : w.disconnected);
        const hubButtonClass = `${styles.hubButton} ${connected ? styles.hubConnected : ''} ` +
            `${connectionError ? styles.hubError : ''}`;
        const detectedModel = snapshot && snapshot.detectedHubModel;
        const modelMismatch = Boolean(snapshot && snapshot.modelMismatch) ||
            Boolean(detectedModel && this.state.selectedHubModel !== 'auto' &&
                detectedModel !== this.state.selectedHubModel);
        return (
            <div className={styles.root}>
                <div
                    aria-label={w.liveView}
                    className={styles.compactLine}
                >
                    <div
                        aria-label={w.ports}
                        className={styles.connectedPorts}
                    >
                        {PORTS.filter(port => this.shouldShowPort(port, snapshot))
                            .map(port => this.renderPort(port, snapshot))}
                    </div>
                    <button
                        aria-expanded={open}
                        aria-label={`${w.title}: ${hubStatusLabel}`}
                        className={hubButtonClass}
                        onClick={this.handleTogglePanel}
                        title={connected ? w.title : connectionError ? w.connectionError : w.title}
                        type="button"
                    >
                        <HardwareIcon type="hub" />
                        <span className={styles.connectionDot} />
                    </button>
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
                        <div className={styles.modelSettings}>
                            <label>{w.model}
                                <select
                                    aria-label={w.model}
                                    disabled={busy}
                                    onChange={this.handleHubModelChanged}
                                    value={this.state.selectedHubModel}
                                >
                                    <option value="auto">{w.modelAuto}</option>
                                    <option value="prime">{w.modelPrime}</option>
                                    <option value="essential">{w.modelEssential}</option>
                                </select>
                            </label>
                            {modelMismatch ? <div
                                className={styles.modelWarning}
                                role="status"
                            >
                                {w.modelMismatch}
                            </div> : null}
                            {snapshot && snapshot.modelStatus === 'unsupported' ? (
                                <div
                                    className={styles.modelWarning}
                                    role="status"
                                >
                                    {w.unsupportedOperation}
                                </div>
                            ) : null}
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
                                {connected && snapshot.connectionMode !== this.state.connectionMode ? <span>
                                    {w.activeMode}{': '}
                                    {connectionModeLabel(snapshot.connectionMode, w)}
                                </span> : null}
                            </div>
                        </div>
                        {this.state.extensionLoadStatus === 'loading' ? (
                            <p
                                className={styles.help}
                                role="status"
                            >{w.loadingExtension}</p>
                        ) : null}
                        {this.state.extensionLoadStatus === 'error' ? (
                            <div
                                className={styles.error}
                                role="status"
                            >
                                {w.extensionLoadHelp}{' '}
                                <button
                                    onClick={this.handleRetryExtensionLoad}
                                    type="button"
                                >
                                    {w.retryExtensionLoad}
                                </button>
                            </div>
                        ) : null}
                        {this.state.extensionLoadStatus === 'conflict' ? (
                            <div
                                className={styles.error}
                                role="status"
                            >
                                {w.extensionLoadHelp}
                            </div>
                        ) : null}
                        {!api && this.state.extensionLoadStatus === 'loaded' ?
                            <p className={styles.help}>{w.unavailable}</p> : null}
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
                        {connected ? (
                            <>
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
                                    {PORTS.filter(port => this.shouldShowPort(port, snapshot))
                                        .map(port => this.renderPortDetails(port, snapshot))}
                                </div>
                            </>
                        ) : null}
                        {displayError ? (
                            <div
                                className={styles.error}
                                role="status"
                            >
                                {displayError}
                            </div>
                        ) : null}
                        {connected && api && typeof api.openCommunicationDiagnosticsLog === 'function' ? (
                            <button
                                className={styles.diagnosticsButton}
                                disabled={busy}
                                onClick={this.handleOpenDiagnosticsLog}
                                type="button"
                            >{w.diagnosticsLog}</button>
                        ) : null}
                        <details className={styles.diagnosticsDetails}>
                            <summary>{w.diagnostics}</summary>
                            <pre className={styles.diagnosticJson}>{JSON.stringify(
                                snapshot && snapshot.diagnostics ? snapshot.diagnostics : snapshot,
                                null,
                                2
                            )}</pre>
                        </details>
                    </section>
                ) : null}
            </div>
        );
    }
}

SpikePrimeControlCenter.propTypes = {
    intl: PropTypes.shape({locale: PropTypes.string}),
    projectChanged: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default SpikePrimeControlCenter;
