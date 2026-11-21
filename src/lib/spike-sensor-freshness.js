export const getSpikeSensorFreshness = (receivedAt, now, active) => {
    if (!Number.isFinite(receivedAt) || !Number.isFinite(now) || receivedAt > now) return 'waiting';
    const age = now - receivedAt;
    if (active) {
        if (age <= 150) return 'healthy';
        if (age <= 300) return 'delayed';
        return 'stopped';
    }
    return age <= 500 ? 'healthy' : 'stale';
};

export const isSpikeSensorSampleUsable = freshness =>
    freshness === 'healthy' || freshness === 'delayed';
