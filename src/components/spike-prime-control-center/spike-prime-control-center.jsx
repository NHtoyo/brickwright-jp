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
        connected: 'Connected',
        disconnected: 'Disconnected',
        unavailable: 'Add the SPIKE Prime extension from Add-ons to connect a hub.',
        firmware: 'Hub OS',
        controller: 'Controller',
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
        connected: '接続済み',
        disconnected: '未接続',
        unavailable: 'ハブを接続するには「アドオン」からSPIKE Prime拡張を追加してください。',
        firmware: 'Hub OS',
        controller: '制御プログラム',
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

class SpikePrimeControlCenter extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            open: false,
            snapshot: null,
            now: Date.now(),
            busy: false,
            error: '',
            controllerSlot: 19,
            controllerConfirmation: null,
            standaloneSlot: 1,
            standaloneConfirmation: null
        };
        this.mounted = false;
        this.poll = null;
        bindAll(this, [
            'refresh', 'handleTogglePanel', 'handleClosePanel', 'handleConnect', 'handleDisconnect',
            'handleStopHub', 'handleControllerSlotChanged', 'handleReviewControllerSlot',
            'handleConfirmControllerInstall', 'handleCancelControllerInstall',
            'handleStandaloneSlotChanged', 'handleReviewStandaloneSlot',
            'handleConfirmStandaloneRun', 'handleCancelStandaloneRun'
        ]);
    }

    componentDidMount () {
        this.mounted = true;
        this.refresh();
        this.poll = setInterval(this.refresh, 200);
    }

    componentWillUnmount () {
        this.mounted = false;
        if (this.poll) clearInterval(this.poll);
    }

    getAPI () {
        return this.props.vm.runtime.brickwrightSpikePrimeControl;
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
        this.updateIfMounted({snapshot, now: Date.now()});
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
        this.runAction('connect');
    }

    handleDisconnect () {
        this.runAction('disconnect');
    }

    handleStopHub () {
        this.runAction('stop');
    }

    handleControllerSlotChanged (event) {
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
        const slots = Array.from({length: 20}, (_, slot) => slot);
        const availableStandaloneSlots = slots.filter(slot => !snapshot || slot !== snapshot.controllerSlot);
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
                        {api ? null : <p className={styles.help}>{w.unavailable}</p>}
                        {connected ? (
                            <>
                                <div className={styles.metadata}>
                                    <span>{w.firmware}{': '}{snapshot.firmwareVersion || '—'}</span>
                                    <span>{w.controller}{': '}{controllerReady ? w.ready : w.unknown}</span>
                                </div>
                                {controllerReady ? null : (
                                    <div className={styles.installBox}>
                                        <label>{w.slot}
                                            <select
                                                onChange={this.handleControllerSlotChanged}
                                                value={this.state.controllerSlot}
                                            >
                                                {slots.map(slot => (<option
                                                    key={slot}
                                                    value={slot}
                                                >{slot}</option>))}
                                            </select>
                                        </label>
                                        {this.state.controllerConfirmation === null ? (
                                            <button
                                                disabled={busy || !api}
                                                onClick={this.handleReviewControllerSlot}
                                                type="button"
                                            >{w.install}</button>
                                        ) : (
                                            <div className={styles.confirmBox}>
                                                <p>{w.controllerWarning}</p>
                                                <button
                                                    disabled={busy}
                                                    onClick={this.handleConfirmControllerInstall}
                                                    type="button"
                                                >
                                                    {busy ?
                                                        w.installing :
                                                        `${w.installTo} ${this.state.controllerConfirmation}`}
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    onClick={this.handleCancelControllerInstall}
                                                    type="button"
                                                >{w.cancel}</button>
                                            </div>
                                        )}
                                    </div>
                                )}
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
                                <details className={styles.offline}>
                                    <summary>{w.offline}</summary>
                                    <p>{w.offlineHelp}</p>
                                    <label>{w.slot}
                                        <select
                                            onChange={this.handleStandaloneSlotChanged}
                                            value={this.state.standaloneSlot}
                                        >
                                            {availableStandaloneSlots.map(slot => (<option
                                                key={slot}
                                                value={slot}
                                            >{slot}</option>))}
                                        </select>
                                    </label>
                                    {this.state.standaloneConfirmation === null ? (
                                        <button
                                            disabled={busy || !api}
                                            onClick={this.handleReviewStandaloneSlot}
                                            type="button"
                                        >{w.review}</button>
                                    ) : (
                                        <div className={styles.confirmBox}>
                                            <p>{w.slotWarning}</p>
                                            <button
                                                disabled={busy}
                                                onClick={this.handleConfirmStandaloneRun}
                                                type="button"
                                            >
                                                {busy ?
                                                    w.working :
                                                    `${w.confirmUpload} ${this.state.standaloneConfirmation}`}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={this.handleCancelStandaloneRun}
                                                type="button"
                                            >{w.cancel}</button>
                                        </div>
                                    )}
                                </details>
                            </>
                        ) : null}
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
