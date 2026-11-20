import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {connect} from 'react-redux';

import ControlsComponent from '../components/controls/controls.jsx';

const getModel = snapshot => {
    if (!snapshot) return null;
    if (snapshot.connected) {
        if (snapshot.detectedHubModel) return snapshot.detectedHubModel;
        if (snapshot.effectiveHubModel) return snapshot.effectiveHubModel;
        if (snapshot.protocol === 'lwp3' || snapshot.protocol === 'essential' ||
            snapshot.protocol === 'lwp3-essential') return 'essential';
        if (snapshot.protocol === 'spike3' || snapshot.protocol === 'prime') return 'prime';
    }
    return snapshot.selectedHubModel || null;
};

class Controls extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            destination: 'pc',
            hubState: null,
            hubConfirmation: null,
            hubRunBusy: false,
            hubRunError: '',
            showSpikeDestination: props.showSpikeDestination
        };
        this.poll = null;
        bindAll(this, [
            'handleGreenFlagClick', 'handleStopAllClick', 'handleDestinationChange',
            'handleConfirmHubRun', 'handleCancelHubRun', 'refreshHubState'
        ]);
    }

    static getDerivedStateFromProps (props, state) {
        if (state.showSpikeDestination !== props.showSpikeDestination) {
            return {
                ...(state.showSpikeDestination && !props.showSpikeDestination ? {
                    destination: 'pc',
                    hubConfirmation: null,
                    hubRunError: ''
                } : {}),
                showSpikeDestination: props.showSpikeDestination
            };
        }
        return null;
    }

    componentDidMount () {
        this.refreshHubState();
        this.poll = setInterval(this.refreshHubState, 300);
    }

    componentWillUnmount () {
        if (this.poll) clearInterval(this.poll);
    }

    getRouter () {
        return this.props.vm.runtime.peripheralExtensions &&
            this.props.vm.runtime.peripheralExtensions.spikeprime;
    }

    getAPI () {
        const router = this.getRouter();
        if (!router || typeof router.getControlCenterAPI !== 'function') return null;
        const api = router.getControlCenterAPI();
        return api && api.hubRouterId === router.instanceId ? api : null;
    }

    getHubStatus () {
        const router = this.getRouter();
        const api = this.getAPI();
        if (!api || typeof api.getState !== 'function') return null;
        let snapshot;
        try {
            snapshot = api.getState();
        } catch (error) {
            return null;
        }
        if (!snapshot) return null;
        const model = getModel(snapshot);
        const identity = (router && router.active && router.active._link) ||
            snapshot.deviceId || snapshot.deviceName || null;
        return {
            connected: Boolean(snapshot.connected),
            model,
            standaloneCapable: snapshot.connected ? snapshot.standaloneCapable !== false : model === 'prime',
            controllerSlot: Number.isInteger(snapshot.controllerSlot) ? snapshot.controllerSlot : null,
            identity
        };
    }

    refreshHubState () {
        const hubState = this.getHubStatus();
        if (!hubState) {
            if (this.state.hubState || this.state.destination !== 'pc' || this.state.hubConfirmation) {
                this.setState({
                    hubState: null,
                    destination: 'pc',
                    hubConfirmation: null
                });
            }
            return;
        }
        const old = this.state.hubState;
        const changed = !old || old.connected !== hubState.connected || old.model !== hubState.model ||
            old.standaloneCapable !== hubState.standaloneCapable ||
            old.controllerSlot !== hubState.controllerSlot || old.identity !== hubState.identity;
        if (!changed) return;
        const destinationSlot = this.getDestinationSlot(this.state.destination);
        const destinationReserved = Number.isInteger(destinationSlot) &&
            destinationSlot === hubState.controllerSlot;
        const destinationUnavailable = hubState.model === 'essential' ||
            (hubState.connected && (!hubState.standaloneCapable || hubState.model !== 'prime'));
        this.setState({
            hubState,
            ...(destinationReserved || destinationUnavailable ? {
                destination: 'pc',
                hubConfirmation: null
            } : {}),
            ...(this.state.hubConfirmation && (!hubState.connected ||
                this.state.hubConfirmation.identity !== hubState.identity) ? {hubConfirmation: null} : {})
        });
    }

    getDestinationSlot (destination = this.state.destination) {
        if (typeof destination !== 'string' || !destination.startsWith('hub:')) return null;
        const slot = Number(destination.slice(4));
        return Number.isInteger(slot) && slot >= 0 && slot <= 19 ? slot : null;
    }

    handleGreenFlagClick (event) {
        const specialClick = event.shiftKey || event.altKey || event.type === 'contextmenu';
        const slot = this.getDestinationSlot();
        if (this.props.showSpikeDestination && Number.isInteger(slot) && !specialClick) {
            event.preventDefault();
            const hubState = this.getHubStatus();
            if (!hubState || !hubState.connected) {
                this.setState({hubConfirmation: null, hubRunError: 'connect'});
                return;
            }
            if (hubState.model !== 'prime' || !hubState.standaloneCapable ||
                slot === hubState.controllerSlot || !hubState.identity) {
                this.setState({hubConfirmation: null, hubRunError: 'unavailable'});
                return;
            }
            this.setState({
                hubConfirmation: {slot, identity: hubState.identity},
                hubRunError: ''
            });
            return;
        }
        event.preventDefault();
        // Preserve Scratch's native green-flag shortcuts and execution path for PC mode.
        if (event.shiftKey || event.altKey || event.type === 'contextmenu') {
            if (event.shiftKey) this.props.vm.setTurboMode(!this.props.turbo);
            if (event.altKey || event.type === 'contextmenu') {
                this.props.vm.setFramerate(this.props.framerate === 30 ? 60 : 30);
            }
        } else {
            if (!this.props.isStarted) this.props.vm.start();
            this.props.vm.greenFlag();
        }
    }

    handleStopAllClick (event) {
        event.preventDefault();
        this.setState({hubConfirmation: null, hubRunError: ''});
        this.props.vm.stopAll();
    }

    handleDestinationChange (event) {
        const destination = event.target.value;
        const slot = this.getDestinationSlot(destination);
        const hubState = this.getHubStatus();
        if (Number.isInteger(slot) && (!hubState || hubState.model === 'essential' ||
            (hubState.connected && (hubState.model !== 'prime' || !hubState.standaloneCapable)) ||
            slot === hubState.controllerSlot)) {
            this.setState({hubRunError: 'unavailable'});
            return;
        }
        this.setState({destination, hubConfirmation: null, hubRunError: ''});
    }

    async handleConfirmHubRun () {
        const confirmation = this.state.hubConfirmation;
        const hubState = this.getHubStatus();
        const api = this.getAPI();
        const currentSlot = this.getDestinationSlot();
        if (!confirmation || confirmation.slot !== currentSlot || !hubState || !hubState.connected ||
            hubState.model !== 'prime' || !hubState.standaloneCapable ||
            hubState.controllerSlot === confirmation.slot ||
            !confirmation.identity || confirmation.identity !== hubState.identity ||
            !api || typeof api.generatePython !== 'function' || typeof api.uploadAndRun !== 'function') {
            this.setState({hubConfirmation: null, hubRunError: 'unavailable'});
            return;
        }
        this.setState({hubRunBusy: true, hubRunError: ''});
        try {
            const source = api.generatePython();
            await api.uploadAndRun(confirmation.slot, source);
            this.setState({hubConfirmation: null});
        } catch (error) {
            this.setState({hubConfirmation: null, hubRunError: error.message || String(error)});
        } finally {
            this.setState({hubRunBusy: false});
            this.refreshHubState();
        }
    }

    handleCancelHubRun () {
        this.setState({hubConfirmation: null, hubRunError: ''});
    }

    render () {
        const hubState = this.state.hubState;
        const eligible = Boolean(this.props.showSpikeDestination && hubState && hubState.model !== 'essential' &&
            (!hubState.connected || (hubState.model === 'prime' && hubState.standaloneCapable)));
        const destinationOptions = eligible ? Array.from({length: 20}, (_, slot) => ({
            slot,
            reserved: slot === hubState.controllerSlot
        })) : [];
        const destination = eligible ? this.state.destination : 'pc';
        return (
            <ControlsComponent
                {...this.props}
                active={this.props.projectRunning && this.props.isStarted}
                destination={destination}
                destinationOptions={destinationOptions}
                hubConfirmation={eligible ? this.state.hubConfirmation : null}
                hubRunBusy={this.state.hubRunBusy}
                hubRunError={eligible ? this.state.hubRunError : ''}
                onCancelHubRun={this.handleCancelHubRun}
                onConfirmHubRun={this.handleConfirmHubRun}
                onDestinationChange={this.handleDestinationChange}
                onGreenFlagClick={this.handleGreenFlagClick}
                onStopAllClick={this.handleStopAllClick}
                showSpikeDestination={eligible}
                turbo={this.props.turbo}
            />
        );
    }
}

Controls.propTypes = {
    isStarted: PropTypes.bool.isRequired,
    projectRunning: PropTypes.bool.isRequired,
    turbo: PropTypes.bool.isRequired,
    framerate: PropTypes.number.isRequired,
    interpolation: PropTypes.bool.isRequired,
    isSmall: PropTypes.bool,
    showSpikeDestination: PropTypes.bool,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    isStarted: state.scratchGui.vmStatus.started,
    projectRunning: state.scratchGui.vmStatus.running,
    framerate: state.scratchGui.tw.framerate,
    interpolation: state.scratchGui.tw.interpolation,
    turbo: state.scratchGui.vmStatus.turbo
});
const mapDispatchToProps = () => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Controls);
