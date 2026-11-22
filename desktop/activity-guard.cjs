'use strict';

const isSafeForUpdate = activity => !activity.bluetoothConnected && !activity.projectRunning &&
    !activity.motorActive && !activity.controllerReady;

module.exports = {isSafeForUpdate};
