import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import GreenFlag from '../green-flag/green-flag.jsx';
import StopAll from '../stop-all/stop-all.jsx';
import TurboMode from '../turbo-mode/turbo-mode.jsx';
import FramerateIndicator from '../tw-framerate-indicator/framerate-indicator.jsx';

import styles from './controls.css';

const messages = defineMessages({
    goTitle: {
        id: 'gui.controls.go',
        defaultMessage: 'Go',
        description: 'Green flag button title'
    },
    stopTitle: {
        id: 'gui.controls.stop',
        defaultMessage: 'Stop',
        description: 'Stop button title'
    },
    destination: {
        id: 'gui.controls.spikeDestination',
        defaultMessage: 'Destination',
        description: 'Destination for the existing green flag action'
    },
    pc: {
        id: 'gui.controls.destinationPC',
        defaultMessage: 'PC',
        description: 'Run a Scratch project on the computer'
    },
    hubSlot: {
        id: 'gui.controls.destinationHubSlot',
        defaultMessage: 'Hub {slot}',
        description: 'Run a standalone program on a SPIKE hub slot'
    },
    reservedHubSlot: {
        id: 'gui.controls.destinationHubSlotReserved',
        defaultMessage: 'Hub {slot} (reserved)',
        description: 'Hub slot reserved for the controller program'
    },
    slotWillClear: {
        id: 'gui.controls.destinationSlotWillClear',
        defaultMessage: 'Slot {slot} will be cleared before upload.',
        description: 'Explicit warning before uploading to a hub slot'
    },
    confirmHubRun: {
        id: 'gui.controls.confirmHubRun',
        defaultMessage: 'Clear, upload, and run slot {slot}',
        description: 'Confirm upload to the selected hub slot'
    },
    cancelHubRun: {
        id: 'gui.controls.cancelHubRun',
        defaultMessage: 'Cancel',
        description: 'Cancel the pending hub upload'
    },
    connectBeforeHubRun: {
        id: 'gui.controls.connectBeforeHubRun',
        defaultMessage: 'Connect a SPIKE Prime hub before selecting a hub destination.',
        description: 'Error shown when a hub slot was selected but the hub disconnected'
    },
    hubRunUnavailable: {
        id: 'gui.controls.hubRunUnavailable',
        defaultMessage: 'Hub execution is unavailable for this model or slot.',
        description: 'Error shown when the selected hub destination cannot be used'
    }
});

const japaneseLabels = {
    destination: '保存先',
    pc: 'PC',
    hubSlot: 'ハブ {slot}',
    reservedHubSlot: 'ハブ {slot}（予約済み）',
    slotWillClear: '転送前にスロット{slot}を消去します。',
    confirmHubRun: 'スロット{slot}を消去して転送・実行',
    cancelHubRun: 'キャンセル',
    connectBeforeHubRun: 'ハブで実行するにはSPIKE Primeを接続してください。',
    hubRunUnavailable: 'このハブまたはスロットでは実行できません。'
};

const formatLabel = (intl, id, values = {}) => {
    if (!(intl.locale || '').toLowerCase().startsWith('ja')) return intl.formatMessage(messages[id], values);
    return japaneseLabels[id].replace(/\{(\w+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    ));
};

const Controls = function (props) {
    const {
        active,
        className,
        intl,
        onGreenFlagClick,
        onStopAllClick,
        turbo,
        framerate,
        interpolation,
        isSmall,
        showSpikeDestination,
        destination,
        destinationOptions,
        onDestinationChange,
        hubConfirmation,
        hubRunBusy,
        hubRunError,
        onConfirmHubRun,
        onCancelHubRun,
        ...componentProps
    } = props;
    return (
        <div
            className={classNames(styles.controlsContainer, className)}
            {...componentProps}
        >
            {showSpikeDestination ? (
                <label className={styles.spikeDestination}>
                    <span>{formatLabel(intl, 'destination')}</span>
                    <select
                        aria-label={formatLabel(intl, 'destination')}
                        disabled={hubRunBusy}
                        onChange={onDestinationChange}
                        value={destination}
                    >
                        <option value="pc">{formatLabel(intl, 'pc')}</option>
                        {destinationOptions.map(({slot, reserved}) => (
                            <option
                                disabled={reserved}
                                key={slot}
                                value={`hub:${slot}`}
                            >
                                {reserved ?
                                    formatLabel(intl, 'reservedHubSlot', {slot}) :
                                    formatLabel(intl, 'hubSlot', {slot})}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}
            <GreenFlag
                active={active}
                title={intl.formatMessage(messages.goTitle)}
                onClick={onGreenFlagClick}
            />
            <StopAll
                active={active}
                title={intl.formatMessage(messages.stopTitle)}
                onClick={onStopAllClick}
            />
            {turbo ? (
                <TurboMode isSmall={isSmall} />
            ) : null}
            {!isSmall && (
                <FramerateIndicator
                    framerate={framerate}
                    interpolation={interpolation}
                />
            )}
            {showSpikeDestination && hubConfirmation ? (
                <div
                    className={styles.spikeHubConfirmation}
                    role="group"
                >
                    <span>{formatLabel(intl, 'slotWillClear', {slot: hubConfirmation.slot})}</span>
                    <button
                        disabled={hubRunBusy}
                        onClick={onConfirmHubRun}
                        type="button"
                    >{formatLabel(intl, 'confirmHubRun', {slot: hubConfirmation.slot})}</button>
                    <button
                        disabled={hubRunBusy}
                        onClick={onCancelHubRun}
                        type="button"
                    >{formatLabel(intl, 'cancelHubRun')}</button>
                </div>
            ) : null}
            {showSpikeDestination && hubRunError ? (
                <span
                    className={styles.spikeHubRunError}
                    role="status"
                >
                    {hubRunError === 'connect' ? formatLabel(intl, 'connectBeforeHubRun') :
                        hubRunError === 'unavailable' ? formatLabel(intl, 'hubRunUnavailable') : hubRunError}
                </span>
            ) : null}
        </div>
    );
};

Controls.propTypes = {
    active: PropTypes.bool,
    className: PropTypes.string,
    intl: intlShape.isRequired,
    onGreenFlagClick: PropTypes.func.isRequired,
    onStopAllClick: PropTypes.func.isRequired,
    framerate: PropTypes.number,
    interpolation: PropTypes.bool,
    isSmall: PropTypes.bool,
    turbo: PropTypes.bool,
    showSpikeDestination: PropTypes.bool,
    destination: PropTypes.string,
    destinationOptions: PropTypes.arrayOf(PropTypes.shape({
        slot: PropTypes.number.isRequired,
        reserved: PropTypes.bool.isRequired
    })),
    onDestinationChange: PropTypes.func,
    hubConfirmation: PropTypes.shape({slot: PropTypes.number}),
    hubRunBusy: PropTypes.bool,
    hubRunError: PropTypes.string,
    onConfirmHubRun: PropTypes.func,
    onCancelHubRun: PropTypes.func
};

Controls.defaultProps = {
    active: false,
    turbo: false,
    isSmall: false,
    showSpikeDestination: false,
    destination: 'pc',
    destinationOptions: [],
    hubConfirmation: null,
    hubRunBusy: false,
    hubRunError: ''
};

export default injectIntl(Controls);
