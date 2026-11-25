const isSafeForUpdate = (activity, now = Date.now()) => Boolean(activity &&
    activity.rendererResponsive === true &&
    Number.isFinite(activity.lastActivityAt) &&
    now - activity.lastActivityAt < 5000 &&
    !activity.bluetoothConnected &&
    !activity.projectRunning &&
    !activity.motorActive &&
    !activity.controllerReady &&
    !activity.controllerBusy &&
    !activity.projectChanged);

module.exports = {isSafeForUpdate};
