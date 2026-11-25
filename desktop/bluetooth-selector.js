/* global document, window */

(() => {
    const devicesRoot = document.getElementById('devices');
    const status = document.getElementById('status');
    const connect = document.getElementById('connect');
    const cancel = document.getElementById('cancel');
    const kind = new URLSearchParams(window.location.search).get('kind') === 'usb' ? 'usb' : 'bluetooth';
    const heading = kind === 'usb' ? 'USBデバイスを選択' : 'Bluetoothデバイスを選択';
    document.title = heading;
    document.getElementById('heading').textContent = heading;
    document.getElementById('description').textContent = kind === 'usb' ?
        'ファームウェア更新などに使用するUSB機器を選択してください。' :
        '接続するデバイスを選択してください。デバイス名は機種判定に使用されません。';
    connect.textContent = kind === 'usb' ? '選択' : '接続';
    let requestId = null;
    let devices = [];
    let selectedId = null;
    let settled = false;

    const render = () => {
        devicesRoot.replaceChildren();
        devices.forEach((device, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'device';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-pressed', String(device.deviceId === selectedId));
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = device.deviceName || `デバイス ${index + 1}`;
            const id = document.createElement('span');
            id.className = 'id';
            id.textContent = device.deviceId;
            button.append(name, id);
            button.addEventListener('click', () => {
                selectedId = device.deviceId;
                connect.disabled = false;
                render();
            });
            devicesRoot.append(button);
        });
        status.textContent = devices.length ?
            (kind === 'usb' ? '使用するUSB機器を選択してください。' : '接続するデバイスを選択してください。') :
            'デバイスを検索しています…';
    };

    window.bluetoothSelector.onDevices(payload => {
        if (!payload || typeof payload.requestId !== 'number') return;
        if ((payload.kind || 'bluetooth') !== kind) return;
        requestId = payload.requestId;
        devices = Array.isArray(payload.devices) ? payload.devices : [];
        if (!devices.some(device => device.deviceId === selectedId)) selectedId = null;
        connect.disabled = !selectedId;
        render();
    });

    connect.addEventListener('click', () => {
        if (settled || requestId === null || !devices.some(device => device.deviceId === selectedId)) return;
        settled = true;
        window.bluetoothSelector.select(requestId, selectedId, kind);
        status.textContent = '選択をBrickwrightへ返しています…';
    });

    cancel.addEventListener('click', () => {
        if (settled || requestId === null) return;
        settled = true;
        window.bluetoothSelector.cancel(requestId, kind);
        window.close();
    });

    window.addEventListener('beforeunload', () => {
        if (!settled && requestId !== null) window.bluetoothSelector.cancel(requestId, kind);
    });
})();
