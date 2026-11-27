import SB3Creator from '../../../src/lib/sb3-creator';

describe('SB3 SPIKE extension references', () => {
    test('does not publish an external SPIKE implementation URL', () => {
        expect(SB3Creator.EXTENSION_URLS.spikeprime).toBeUndefined();
    });

    test('keeps the standard ID but removes external SPIKE implementation URLs', () => {
        const creator = new SB3Creator();
        const project = {
            targets: [{
                blocks: {
                    motor: {opcode: 'spikeprime_motorStart'},
                    motion: {opcode: 'motion_movesteps'}
                }
            }],
            extensionURLs: {
                spikeprime: 'https://old.example/spikeprime.js',
                microbit: 'https://extensions.turbowarp.org/microbit.js'
            }
        };

        creator.syncExtensions(project);

        expect(project.extensions).toContain('spikeprime');
        expect(project.extensionURLs).not.toHaveProperty('spikeprime');
        expect(project.extensionURLs.microbit).toBe(
            'https://extensions.turbowarp.org/microbit.js'
        );
    });
});
