import {SPIKE_CATEGORY_COLORS} from './spike-toolbox-categories';

const path = {
    motor: '<rect x="4" y="7" width="13" height="10" rx="2"/><path d="M17 10h3v4h-3M8 4v3m5-3v3M8 17v3m5-3v3"/>',
    movement: '<path d="M4 7h13l-3-3m3 3-3 3M20 17H7l3 3m-3-3 3-3"/>',
    light: [
        '<path d="M9 17h6m-5 3h4m-2-18a6 6 0 0 0-3.5 10.9',
        'c.8.6 1.3 1.3 1.5 2.1h4c.2-.8.7-1.5 1.5-2.1A6',
        '6 0 0 0 12 2Z"/>'
    ].join(''),
    sound: '<path d="M4 10v4h4l5 4V6l-5 4H4Zm12-1a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>',
    events: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3m0-14-3 3m-8 8-3 3"/>',
    control: [
        '<path d="M4 6h16M4 12h16M4 18h16"/>',
        '<circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/>',
        '<circle cx="11" cy="18" r="2"/>'
    ].join(''),
    sensors: '<path d="M3 12h4l2-5 4 10 2-5h6"/><circle cx="12" cy="12" r="10"/>',
    operators: '<path d="M5 8h8m-4-4v8m3 4h7m-4-4 4 4-4 4"/>',
    variables: '<path d="M6 5h12v14H6zM9 9h6m-6 4h6m-6 4h3"/>',
    myBlocks: '<path d="M4 5h16v4h-5v10H9V9H4z"/><path d="M7 5V3m10 2V3"/>',
    other: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/>' +
        '<circle cx="19" cy="12" r="1.3"/>'
};

export const spikeToolboxIconURI = category => {
    const shape = path[category] || path.other;
    const color = (SPIKE_CATEGORY_COLORS[category] || SPIKE_CATEGORY_COLORS.other).primary;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
