import {getSpikeSensorFreshness, isSpikeSensorSampleUsable} from '../../../src/lib/spike-sensor-freshness';

describe('SPIKE sensor freshness', () => {
    test('distinguishes missing, active, and idle samples at the specified thresholds', () => {
        expect(getSpikeSensorFreshness(null, 1000, true)).toBe('waiting');
        expect(getSpikeSensorFreshness(900, 1000, true)).toBe('healthy');
        expect(getSpikeSensorFreshness(849, 1000, true)).toBe('delayed');
        expect(getSpikeSensorFreshness(699, 1000, true)).toBe('stopped');
        expect(getSpikeSensorFreshness(500, 1000, false)).toBe('healthy');
        expect(getSpikeSensorFreshness(499, 1000, false)).toBe('stale');
        expect(isSpikeSensorSampleUsable('healthy')).toBe(true);
        expect(isSpikeSensorSampleUsable('delayed')).toBe(true);
        expect(isSpikeSensorSampleUsable('stopped')).toBe(false);
        expect(isSpikeSensorSampleUsable('stale')).toBe(false);
    });
});
