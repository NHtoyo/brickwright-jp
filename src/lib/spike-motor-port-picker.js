const MOTOR_BLOCKS = new Set([
    'spikeprime_motorRunFor',
    'spikeprime_motorRunToPosition',
    'spikeprime_motorStart',
    'spikeprime_motorStop',
    'spikeprime_startMotor',
    'spikeprime_stopMotor',
    'spikeprime_motorSetSpeed',
    'spikeprime_motorStartPower',
    'spikeprime_motorSetStopAction',
    'spikeprime_resetMotorPosition',
    'spikeprime_getPosition',
    'spikeprime_getRelativePosition',
    'spikeprime_getAbsolutePosition',
    'spikeprime_getSpeed',
    'spikeprime_setMovementMotors'
]);
const PORT_FIELDS = new Set(['PORT', 'PORT_A', 'PORT_B', 'MULTIPLE_PORT']);
const PORT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
const PATCH_KEY = '__brickwrightSpikeMotorPickerInstalled';

const labels = {
    en: {
        title: 'Select motor port',
        connected: 'Connected',
        empty: 'No device',
        motor: 'Motor',
        force: 'Force sensor',
        distance: 'Distance sensor',
        color: 'Color sensor',
        matrix: 'Light matrix',
        unknown: 'Device',
        multiSelect: 'Select multiple ports',
        selectAll: 'All visible ports',
        apply: 'Apply',
        cancel: 'Cancel',
        savedUnavailable: 'Saved selection includes a port unavailable on this hub.'
    },
    ja: {
        title: 'モーターのポートを選択',
        connected: '接続済み',
        empty: '機器未接続',
        motor: 'モーター',
        force: 'フォースセンサー',
        distance: '距離センサー',
        color: 'カラーセンサー',
        matrix: 'ライトマトリクス',
        unknown: '機器',
        multiSelect: '複数ポートを選択',
        selectAll: '表示中のすべて',
        apply: '選択',
        cancel: 'キャンセル',
        savedUnavailable: '保存済みの選択には、このハブで使えないポートが含まれています。'
    }
};

const getLanguage = ScratchBlocks => {
    const provider = ScratchBlocks.brickwrightSpikePortLanguageProvider;
    if (typeof provider === 'function') {
        try {
            const locale = provider();
            if (locale) {
                const normalizedLocale = String(locale).toLowerCase();
                return normalizedLocale.startsWith('ja') ? 'ja' : 'en';
            }
        } catch (error) {
            // Fall back to the document language if a transient locale read fails.
        }
    }
    if (typeof document === 'undefined') return 'en';
    const documentLanguage = document.documentElement.lang.toLowerCase();
    return documentLanguage.startsWith('ja') ? 'ja' : 'en';
};

const getDeviceInfo = (state, port) => {
    const reading = state && state.portSensors && state.portSensors[port];
    const motor = state && state.motorPorts && state.motorPorts[port];
    if (reading && reading.connected === false) return {connected: false, type: null};
    const id = (reading && (reading.deviceType ?? reading.deviceId ?? reading.motorType)) ??
        (motor && (motor.motorType ?? motor.deviceType));
    const idTypes = {
        0x30: 'motor',
        0x31: 'motor',
        0x41: 'motor',
        61: 'color',
        62: 'distance',
        63: 'force',
        64: 'matrix'
    };
    const detectedType = idTypes[Number(id)];
    const type = reading && reading.type && reading.type !== 'unknown' ? reading.type :
        detectedType || (motor ? 'motor' : null);
    const connected = Boolean(
        (reading && reading.connected === true) ||
        (motor && motor.connected === true) ||
        (type && (
            Number.isFinite(reading && reading.receivedAt) ||
            Number.isFinite(motor && motor.receivedAt)
        ))
    );
    return {connected, type};
};

const getVisiblePorts = (ports, snapshot) => {
    if (snapshot && Array.isArray(snapshot.availablePorts)) {
        return PORT_ORDER.filter(port => snapshot.availablePorts.includes(port) && ports.includes(port));
    }
    const model = snapshot && (snapshot.effectiveHubModel || snapshot.detectedHubModel || snapshot.selectedHubModel);
    if (model === 'essential') return ['A', 'B'].filter(port => ports.includes(port));
    return PORT_ORDER.filter(port => ports.includes(port));
};

const getMotorBlockAndMenu = field => {
    const menuBlock = field.sourceBlock_;
    if (!menuBlock || !menuBlock.isShadow || !menuBlock.isShadow()) return null;
    const menuName = field.name;
    if (!PORT_FIELDS.has(menuName)) return null;
    const parent = menuBlock.parentBlock_;
    if (!parent || !MOTOR_BLOCKS.has(parent.type)) return null;
    return {block: parent, menuName};
};

const selectedPorts = value => String(value || '').toUpperCase()
    .match(/[A-F]/g) || [];
const selectionSignature = ports => Array.from(new Set(ports)).sort()
    .join('');

const openPicker = (ScratchBlocks, field, menuName) => {
    const options = field.getOptions();
    const values = options.map(([, value]) => String(value).toUpperCase());
    const allowed = new Map();
    values.forEach(value => {
        const signature = selectionSignature(selectedPorts(value));
        if (signature) allowed.set(signature, value);
    });
    const singlePorts = Array.from(allowed.keys()).filter(signature => signature.length === 1);
    const stateProvider = ScratchBlocks.brickwrightSpikePortStateProvider;
    let snapshot = null;
    try {
        snapshot = typeof stateProvider === 'function' ? stateProvider() : null;
    } catch (error) {
        // A transient GUI state read should not prevent normal block editing.
        snapshot = null;
    }
    const ports = getVisiblePorts(singlePorts, snapshot);
    if (!ports.length) return false;

    const language = getLanguage(ScratchBlocks);
    const words = labels[language];
    const dropdown = ScratchBlocks.DropDownDiv;
    dropdown.hideWithoutAnimation();
    dropdown.clearContent();
    const content = dropdown.getContentDiv();
    const root = document.createElement('div');
    root.className = 'bw-spike-port-picker';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', words.title);
    content.appendChild(root);

    const heading = document.createElement('div');
    heading.className = 'bw-spike-port-picker__heading';
    heading.textContent = words.title;
    root.appendChild(heading);

    const currentPorts = selectedPorts(field.getValue());
    const selected = new Set(currentPorts.filter(port => ports.includes(port)));
    const buttons = new Map();
    let multiMode = false;
    let applyButton = null;
    let hint = null;
    let savedSelectionUnavailable = currentPorts.some(port => !ports.includes(port));
    let commit = () => {};

    const getSelectionValue = () => allowed.get(selectionSignature(selected));
    const syncButtons = () => {
        buttons.forEach((button, port) => {
            const isSelected = selected.has(port);
            button.setAttribute('aria-pressed', String(isSelected));
            button.classList.toggle('is-selected', isSelected);
        });
        const value = getSelectionValue();
        if (applyButton) applyButton.disabled = !value;
        if (hint) hint.hidden = Boolean(value) && !savedSelectionUnavailable;
    };

    commit = value => {
        const validated = typeof field.callValidator === 'function' ? field.callValidator(value) : value;
        if (validated === null) return;
        const previousGroup = ScratchBlocks.Events.getGroup();
        if (!previousGroup) ScratchBlocks.Events.setGroup(true);
        try {
            field.setValue(validated);
        } finally {
            if (!previousGroup) ScratchBlocks.Events.setGroup(false);
            dropdown.hide();
        }
    };

    const diagram = document.createElement('div');
    diagram.className = 'bw-spike-port-picker__diagram';
    root.appendChild(diagram);
    const left = document.createElement('div');
    left.className = 'bw-spike-port-picker__column';
    left.setAttribute('aria-label', language === 'ja' ? '左側のポート' : 'Left ports');
    const hub = document.createElement('div');
    hub.className = 'bw-spike-port-picker__hub';
    hub.setAttribute('aria-hidden', 'true');
    hub.innerHTML = [
        '<svg viewBox="0 0 36 42" focusable="false">',
        '<rect x="3" y="8" width="30" height="27" rx="6"></rect>',
        '<circle cx="12" cy="19" r="2"></circle><circle cx="24" cy="19" r="2"></circle>',
        '<path d="M13 26h10M18 3v5"></path></svg>'
    ].join('');
    const right = document.createElement('div');
    right.className = 'bw-spike-port-picker__column';
    right.setAttribute('aria-label', language === 'ja' ? '右側のポート' : 'Right ports');
    diagram.append(left, hub, right);

    const typeNames = {
        motor: words.motor,
        force: words.force,
        distance: words.distance,
        color: words.color,
        matrix: words.matrix
    };
    const addPort = (parent, port) => {
        if (!ports.includes(port)) return;
        const info = getDeviceInfo(snapshot, port);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bw-spike-port-picker__port';
        button.dataset.port = port;
        const status = info.connected ? (typeNames[info.type] || words.connected) : words.empty;
        button.setAttribute('aria-label', `${port}: ${status}`);
        button.title = button.getAttribute('aria-label');
        const letter = document.createElement('strong');
        letter.textContent = port;
        const statusLabel = document.createElement('span');
        statusLabel.className = 'bw-spike-port-picker__status';
        statusLabel.textContent = status;
        button.append(letter, statusLabel);
        button.classList.toggle('is-connected', info.connected);
        button.classList.toggle('is-selected', selected.has(port));
        button.addEventListener('click', () => {
            if (multiMode) {
                if (selected.has(port)) selected.delete(port);
                else selected.add(port);
                savedSelectionUnavailable = false;
                syncButtons();
                return;
            }
            const value = allowed.get(port);
            if (value) commit(value);
        });
        buttons.set(port, button);
        parent.appendChild(button);
    };
    ['A', 'C', 'E'].forEach(port => addPort(left, port));
    ['B', 'D', 'F'].forEach(port => addPort(right, port));

    const actions = document.createElement('div');
    actions.className = 'bw-spike-port-picker__actions';
    if (menuName === 'MULTIPLE_PORT') {
        const multiToggle = document.createElement('label');
        multiToggle.className = 'bw-spike-port-picker__multi-toggle';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('click', () => {
            multiMode = checkbox.checked;
            selected.clear();
            currentPorts.filter(port => ports.includes(port)).forEach(port => selected.add(port));
            savedSelectionUnavailable = currentPorts.some(port => !ports.includes(port));
            syncButtons();
        });
        const toggleText = document.createElement('span');
        toggleText.textContent = words.multiSelect;
        multiToggle.append(checkbox, toggleText);
        actions.appendChild(multiToggle);

        const allPortsValue = allowed.get(selectionSignature(ports));
        if (allPortsValue && ports.length > 1) {
            const allButton = document.createElement('button');
            allButton.type = 'button';
            allButton.textContent = words.selectAll;
            allButton.addEventListener('click', () => commit(allPortsValue));
            actions.appendChild(allButton);
        }

        hint = document.createElement('span');
        hint.className = 'bw-spike-port-picker__hint';
        hint.textContent = words.savedUnavailable;
        hint.hidden = true;
        hint.hidden = !savedSelectionUnavailable;
        actions.appendChild(hint);

        applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.textContent = words.apply;
        applyButton.addEventListener('click', () => {
            const value = getSelectionValue();
            if (value) commit(value);
        });
        actions.appendChild(applyButton);
    }
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = words.cancel;
    cancelButton.addEventListener('click', () => dropdown.hide());
    actions.appendChild(cancelButton);
    root.appendChild(actions);
    syncButtons();

    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') dropdown.hide();
    });
    const block = field.sourceBlock_;
    const colourBlock = block.isShadow() ? block.parentBlock_ : block;
    dropdown.setColour(colourBlock.getColour(), colourBlock.getColourTertiary());
    dropdown.setCategory(colourBlock.getCategory());
    dropdown.setBoundsElement(block.workspace.getParentSvg().parentNode);
    const size = field.getSize();
    const scale = block.workspace.scale;
    const position = field.fieldGroup_.getBoundingClientRect();
    const primaryX = position.left + ((size.width * scale) / 2);
    const primaryY = position.top + (size.height * scale);
    dropdown.show(field, primaryX, primaryY, primaryX, position.top, field.onHide.bind(field));
    field.dropDownOpen_ = true;
    const selectedButton = buttons.get(Array.from(selected)[0]);
    (selectedButton || buttons.values().next().value || cancelButton).focus();
    return true;
};

export const installSpikeMotorPortPicker = ScratchBlocks => {
    const prototype = ScratchBlocks && ScratchBlocks.FieldDropdown && ScratchBlocks.FieldDropdown.prototype;
    if (!prototype || prototype[PATCH_KEY]) return;
    const original = prototype.showEditor_;
    prototype.showEditor_ = function (...args) {
        const motorField = getMotorBlockAndMenu(this);
        if (motorField && openPicker(ScratchBlocks, this, motorField.menuName)) return;
        return original.apply(this, args);
    };
    prototype[PATCH_KEY] = original;
};

export const setSpikePortStateProvider = (ScratchBlocks, provider) => {
    if (ScratchBlocks) ScratchBlocks.brickwrightSpikePortStateProvider = provider;
};

export const setSpikePortLanguageProvider = (ScratchBlocks, provider) => {
    if (ScratchBlocks) ScratchBlocks.brickwrightSpikePortLanguageProvider = provider;
};
