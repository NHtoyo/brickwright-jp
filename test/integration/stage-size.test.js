import path from 'path';
import SeleniumHelper from '../helpers/selenium-helper';

const {
    clickText,
    clickXpath,
    rightClickText,
    getDriver,
    getLogs,
    loadUri,
    scope
} = new SeleniumHelper();

const uri = path.resolve(__dirname, '../../build/index.html');

let driver;

describe('Loading scratch gui', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('Switching small/full stage after highlighting and deleting sprite', async () => {
        await loadUri(uri, {width: 1200});

        // Highlight the sprite
        await clickText('Sprite1', scope.spriteTile);

        // Delete it
        await rightClickText('Sprite1', scope.spriteTile);
        await clickText('delete', scope.spriteTile);

        // Go to small stage mode
        await clickXpath('//button[@title="Switch to small stage"]');

        // Brickwright's default stage sizing exposes the small and full-stage modes.
        // Confirm the other available stage mode still works after deleting a sprite.
        await clickXpath('//button[@title="Switch to full stage"]');

        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });
});
