export const getPaletteVisibility = mode => ({
    scratch: mode !== 'spike',
    spike: mode !== 'scratch'
});

export const updatePaletteMode = (mode, palette, checked) => {
    if (palette !== 'scratch' && palette !== 'spike') return mode;
    const visibility = getPaletteVisibility(mode);
    visibility[palette] = Boolean(checked);
    if (!visibility.scratch && !visibility.spike) return mode;
    if (visibility.scratch && visibility.spike) return 'both';
    return visibility.scratch ? 'scratch' : 'spike';
};
