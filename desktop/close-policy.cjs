const CLOSE_ACTIVITY_MAX_AGE_MS = 5000;

const getClosePolicy = (activity, now = Date.now()) => {
    const statusKnown = Boolean(activity &&
        activity.rendererResponsive === true &&
        Number.isFinite(activity.lastActivityAt) &&
        now >= activity.lastActivityAt &&
        now - activity.lastActivityAt < CLOSE_ACTIVITY_MAX_AGE_MS);
    const projectChanged = Boolean(activity && activity.projectChanged);
    const active = Boolean(activity && (
        activity.bluetoothConnected ||
        activity.projectRunning ||
        activity.motorActive ||
        activity.controllerReady ||
        activity.controllerBusy
    ));
    return {
        statusKnown,
        projectChanged,
        active,
        requiresConfirmation: !statusKnown || projectChanged || active
    };
};

module.exports = {CLOSE_ACTIVITY_MAX_AGE_MS, getClosePolicy};
