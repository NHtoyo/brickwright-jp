/* global WebAudioTestAPI */
import 'web-audio-test-api';
WebAudioTestAPI.setState({
    'AudioContext#resume': 'enabled'
});

const loadSharedAudioContext = () => {
    jest.resetModules();
    // Re-import after resetting modules so each gesture-listener setup is isolated.
    // eslint-disable-next-line global-require
    return require('../../../src/lib/audio/shared-audio-context').default;
};

describe('Shared Audio Context', () => {
    test('returns no audio context without user gesture', () => {
        Object.defineProperty(document, 'ontouchstart', {configurable: true});
        const SharedAudioContext = loadSharedAudioContext();
        expect(SharedAudioContext()).toBeFalsy();
    });

    test('returns AudioContext when mousedown is triggered', () => {
        Object.defineProperty(document, 'ontouchstart', {configurable: true});
        const SharedAudioContext = loadSharedAudioContext();
        const event = new Event('mousedown');
        document.dispatchEvent(event);
        expect(SharedAudioContext()).toBeInstanceOf(AudioContext);
    });

    test('returns AudioContext when touchstart is triggered', () => {
        Object.defineProperty(document, 'ontouchstart', {
            value: () => {},
            configurable: true
        });
        const SharedAudioContext = loadSharedAudioContext();
        const event = new Event('touchstart');
        document.dispatchEvent(event);
        expect(SharedAudioContext()).toBeInstanceOf(AudioContext);
    });
});
