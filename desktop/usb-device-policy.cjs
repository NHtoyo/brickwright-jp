const toPublicUsbDevice = device => {
    if (!device || typeof device.deviceId !== 'string' || !device.deviceId) return null;
    const name = [device.manufacturerName, device.productName].filter(value =>
        typeof value === 'string' && value.trim()
    ).join(' ');
    return {
        deviceId: device.deviceId,
        deviceName: name || `USB機器（VID ${Number(device.vendorId || 0).toString(16)
            .padStart(4, '0')} / PID ${Number(device.productId || 0).toString(16)
            .padStart(4, '0')}）`
    };
};

const handleUsbSelectionRequest = (queue, event, details, callback, {isTrustedFrame, approve}) => {
    event.preventDefault();
    const frame = details && details.frame;
    if (!frame || !isTrustedFrame(frame)) {
        callback();
        return null;
    }
    const requestId = queue.enqueue(deviceId => {
        if (deviceId) approve(deviceId, frame.url);
        callback(deviceId || '');
    });
    queue.updateDevices((details.deviceList || []).map(toPublicUsbDevice).filter(Boolean));
    return requestId;
};

const createUsbDevicePermissionPolicy = ({isTrustedOrigin}) => {
    const approvedDeviceIds = new Set();
    return {
        approve (deviceId, origin) {
            if (typeof deviceId !== 'string' || !deviceId || !isTrustedOrigin(origin)) return false;
            approvedDeviceIds.add(deviceId);
            return true;
        },
        revoke (deviceId) {
            return approvedDeviceIds.delete(deviceId);
        },
        allow ({deviceType, origin, device} = {}) {
            return deviceType === 'usb' && isTrustedOrigin(origin) &&
                Boolean(device && typeof device.deviceId === 'string' && approvedDeviceIds.has(device.deviceId));
        },
        hasApproval (deviceId) {
            return approvedDeviceIds.has(deviceId);
        }
    };
};

module.exports = {createUsbDevicePermissionPolicy, handleUsbSelectionRequest, toPublicUsbDevice};
