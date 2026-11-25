/*
 * Presentation-only SPIKE palette organization. These are Scratch opcodes;
 * changing this map only changes where a block appears in the toolbox.
 */
export const SPIKE_CATEGORY_ORDER = [
    'motor', 'movement', 'light', 'sound', 'events', 'control',
    'sensors', 'operators', 'variables', 'myBlocks', 'other'
];

// Snapshot of getInfo().blocks in the reviewed SPIKE extension. The coverage
// test compares every opcode against the presentation map; this list is not a
// second runtime implementation of the extension.
export const SPIKE_EXTENSION_OPCODE_CATALOG = [
    'connectHub', 'connectHubAt', 'disconnectHub', 'isConnected', 'getHubType',
    'getFirmwareVersion', 'getConnectionMode', 'getCommunicationDiagnostics',
    'getCommunicationDiagnosticsSummary', 'openCommunicationDiagnosticsLog', 'runStartupProbe',
    'installHubController', 'checkHubController', 'setConnectionMode', 'enableStreamingMode',
    'disableStreamingMode', 'transpileProject', 'showCode', 'downloadCode', 'getTranspiledCode',
    'uploadScriptToHub', 'runScriptOnHub', 'renameScriptOnHub', 'deleteScriptOnHub',
    'listScriptsOnHub', 'stopRunningScript', 'setMovementMotors', 'moveForward', 'steer',
    'motorPairMove', 'startTank', 'setMovementSpeed', 'stopMovement', 'motorRunFor',
    'motorRunToPosition', 'motorStart', 'motorStop', 'startMotor', 'stopMotor', 'motorSetSpeed',
    'motorStartPower', 'motorSetStopAction', 'getMotorPower', 'setMotorAcceleration',
    'motorRunToRelativePosition', 'setMovementStopAction', 'setMovementAcceleration',
    'isReflectionCompared', 'isDistanceCompared', 'isOrientation', 'getGesture', 'setYawFace',
    'getPosition', 'getRelativePosition',
    'getAbsolutePosition', 'getSpeed', 'resetMotorPosition', 'displayText', 'displayImage',
    'displayPattern', 'displayClear', 'displayShowImage', 'setPixel', 'rotateDisplay',
    'setCenterButtonColor', 'getAngle', 'getGyroRate', 'getFilteredGyroRate', 'getAcceleration',
    'getFilteredAcceleration', 'resetYaw', 'presetYaw', 'setMatrix3x3ColorGrid',
    'setMatrix3x3Custom', 'setMatrix3x3SolidColor', 'clearMatrix3x3', 'setLightMatrixPixel',
    'whenGesture', 'isGesture', 'getOrientation', 'getFaceUp', 'playHubSound', 'playBeep',
    'playNote', 'playWaveBeep', 'setVolume', 'stopSound', 'getBatteryLevel',
    'getBatteryTemperature', 'getHubTemperature', 'getHubCurrent', 'getHubVoltage', 'getTimer',
    'resetTimer', 'getDistance', 'getDistanceIn', 'setDistanceLights', 'getColor', 'getReflection',
    'getAmbientLight', 'getColorRGB', 'getRawColor255', 'getForce', 'isForceSensorPressed', 'whenColor', 'isColor',
    'whenForceSensor', 'isButtonPressed', 'whenButtonPressed', 'writeLogFile', 'readLogFile',
    'deleteLogFile', 'listFiles', 'runReplCommand', 'getReplOutput', 'clearReplOutput',
    'getReplHistory', 'runPythonCommand', 'runHubCommand', 'exitScript'
];

const categoryOpcodes = {
    motor: [
        'motorRunFor', 'motorRunToPosition', 'motorStart', 'motorStop', 'startMotor', 'stopMotor',
        'motorSetSpeed', 'getPosition', 'getAbsolutePosition', 'getRelativePosition', 'getSpeed',
        'resetMotorPosition', 'motorRunToRelativePosition', 'motorStartPower', 'getMotorPower',
        'motorSetStopAction', 'setMotorAcceleration'
    ],
    movement: [
        'setMovementMotors', 'moveForward', 'steer', 'motorPairMove',
        'setMovementSpeed', 'stopMovement', 'startTank', 'setMovementStopAction',
        'setMovementAcceleration'
    ],
    light: [
        'displayText', 'displayImage', 'displayPattern', 'displayClear', 'displayShowImage',
        'setPixel', 'rotateDisplay', 'setCenterButtonColor', 'setMatrix3x3ColorGrid',
        'setMatrix3x3Custom', 'setMatrix3x3SolidColor', 'clearMatrix3x3', 'setLightMatrixPixel'
    ],
    sound: [
        'playHubSound', 'playBeep', 'playNote', 'playWaveBeep', 'setVolume', 'stopSound'
    ],
    events: ['whenGesture', 'whenColor', 'whenForceSensor', 'whenButtonPressed'],
    control: [
        'connectHub', 'connectHubAt', 'disconnectHub', 'isConnected', 'setConnectionMode',
        'enableStreamingMode', 'disableStreamingMode', 'installHubController',
        'checkHubController', 'stopRunningScript', 'exitScript'
    ],
    sensors: [
        'getAngle', 'getFilteredGyroRate', 'getFilteredAcceleration', 'resetYaw', 'presetYaw', 'getFaceUp',
        'isGesture', 'isColor', 'isReflectionCompared', 'isDistanceCompared', 'isOrientation',
        'getBatteryLevel', 'getBatteryTemperature', 'getHubTemperature', 'getHubCurrent',
        'getHubVoltage', 'getTimer', 'resetTimer', 'getDistance', 'getDistanceIn',
        'setDistanceLights', 'getColor', 'getReflection', 'getAmbientLight',
        'getForce', 'isForceSensorPressed', 'isButtonPressed', 'getColorRGB',
        'getRawColor255', 'getAcceleration', 'getGyroRate', 'getOrientation',
        'isHubOrientation', 'getGesture', 'setYawFace'
    ],
    operators: [],
    variables: [],
    myBlocks: [],
    other: [
        'getHubType', 'getFirmwareVersion', 'getConnectionMode', 'getCommunicationDiagnostics',
        'getCommunicationDiagnosticsSummary', 'openCommunicationDiagnosticsLog', 'runStartupProbe',
        'transpileProject', 'showCode', 'downloadCode', 'getTranspiledCode', 'uploadScriptToHub',
        'runScriptOnHub', 'renameScriptOnHub', 'deleteScriptOnHub', 'listScriptsOnHub',
        'writeLogFile', 'readLogFile', 'deleteLogFile', 'listFiles', 'runReplCommand',
        'getReplOutput', 'clearReplOutput', 'getReplHistory', 'runPythonCommand', 'runHubCommand'
    ]
};

// Motor reporters stay with motor commands; sensor reporters stay in Sensors.

export const SPIKE_OPCODE_CATEGORIES = Object.freeze(Object.keys(categoryOpcodes).reduce((result, category) => {
    categoryOpcodes[category].forEach(opcode => {
        if (!result[opcode]) result[opcode] = [];
        result[opcode].push(category);
    });
    return result;
}, {}));

export const getSpikeOpcodeCategories = opcode => SPIKE_OPCODE_CATEGORIES[opcode] || ['other'];

export const getUncategorizedSpikeOpcodes = opcodes => opcodes.filter(opcode =>
    !Object.prototype.hasOwnProperty.call(SPIKE_OPCODE_CATEGORIES, opcode)
);

export const SPIKE_CATEGORY_COLORS = Object.freeze({
    motor: {primary: '#4C97FF', secondary: '#3373CC'},
    movement: {primary: '#D65CD6', secondary: '#A847A8'},
    light: {primary: '#9966FF', secondary: '#774DCB'},
    sound: {primary: '#CF63CF', secondary: '#A847A8'},
    events: {primary: '#FFD500', secondary: '#CC9900'},
    control: {primary: '#FFAB19', secondary: '#CF8B17'},
    sensors: {primary: '#4CBFE6', secondary: '#2E8EB8'},
    operators: {primary: '#40BF4A', secondary: '#389438'},
    variables: {primary: '#FF8C1A', secondary: '#DB6E00'},
    myBlocks: {primary: '#FF6680', secondary: '#FF4D6A'},
    other: {primary: '#7B8794', secondary: '#59636F'}
});

// The older raw reporter remains registered for saved-project compatibility,
// while getRawColor255 is the single user-facing raw colour block.
export const SPIKE_HIDDEN_PALETTE_OPCODES = Object.freeze(['getColorRGB']);

export const getSpikeBlockColors = opcode => {
    const category = getSpikeOpcodeCategories(opcode)[0];
    const colors = SPIKE_CATEGORY_COLORS[category] || SPIKE_CATEGORY_COLORS.other;
    return {
        colour: colors.primary,
        colourSecondary: colors.secondary,
        colourTertiary: colors.secondary,
        colourQuaternary: colors.secondary
    };
};
