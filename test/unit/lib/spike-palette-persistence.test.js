import fs from 'fs';
import path from 'path';
import VM from 'scratch-vm';
import JSZip from '@turbowarp/jszip';

const projectFixture = () => fs.readFileSync(path.resolve(__dirname, '../../fixtures/project1.sb3'));

const spriteTarget = vm => vm.runtime.targets.find(target => !target.isStage);

const savedProjectJSON = async vm => {
    const archive = await vm.saveProjectSb3('arraybuffer');
    const zip = await JSZip.loadAsync(archive);
    return JSON.parse(await zip.file('project.json').async('string'));
};

describe('per-sprite palette mode persistence', () => {
    beforeAll(() => {
        // jsdom's Performance object does not implement the User Timing API
        // used by scratch-vm while loading a project.
        global.performance.mark = jest.fn();
        global.performance.measure = jest.fn();
    });

    test('round trips through the SB3 archive without SPIKE blocks or extension list entries', async () => {
        const vm = new VM();
        await vm.loadProject(projectFixture());
        const target = spriteTarget(vm);

        expect(target).toBeDefined();
        expect(target.sprite.brickwrightPaletteMode).toBe('both');
        target.sprite.brickwrightPaletteMode = 'spike';

        const project = await savedProjectJSON(vm);
        const savedSprite = project.targets.find(item => item.name === target.getName());
        expect(savedSprite.brickwrightPaletteMode).toBe('spike');
        expect(project.extensions).not.toContain('spikeprime');

        const reloaded = new VM();
        await reloaded.loadProject(await vm.saveProjectSb3('arraybuffer'));
        expect(spriteTarget(reloaded).sprite.brickwrightPaletteMode).toBe('spike');
    });

    test('sprite3 export/addSprite preserves a non-default mode and loading an unrelated project resets it', async () => {
        const sourceVM = new VM();
        await sourceVM.loadProject(projectFixture());
        const source = spriteTarget(sourceVM);
        source.sprite.brickwrightPaletteMode = 'spike';

        const exported = await sourceVM.exportSprite(source.id, 'uint8array');
        const destination = new VM();
        await destination.loadProject(projectFixture());
        await destination.addSprite(exported);

        const added = destination.runtime.targets.find(target => target.getName() !== 'Stage' &&
            target.getName() !== source.getName());
        expect(added.sprite.brickwrightPaletteMode).toBe('spike');

        // Reuse the same VM for an unrelated legacy project: no per-target
        // mode from the prior project may leak into its newly loaded sprite.
        await destination.loadProject(projectFixture());
        expect(spriteTarget(destination).sprite.brickwrightPaletteMode).toBe('both');
    });

    test('sprite duplication copies its mode and deletion removes its saved state', async () => {
        const vm = new VM();
        await vm.loadProject(projectFixture());
        const source = spriteTarget(vm);
        source.sprite.brickwrightPaletteMode = 'scratch';
        // The shared VM fixture intentionally has no attached storage; remove
        // assets before duplication so this test exercises target metadata only.
        source.sprite.costumes = [];
        source.sprite.sounds = [];

        await vm.duplicateSprite(source.id);
        const duplicate = vm.runtime.targets.find(target => target.id !== source.id && !target.isStage);
        expect(duplicate.sprite.brickwrightPaletteMode).toBe('scratch');

        vm.deleteSprite(duplicate.id);
        const project = await savedProjectJSON(vm);
        expect(project.targets.some(target => target.name === duplicate.getName())).toBe(false);
    });
});
