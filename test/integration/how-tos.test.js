import path from 'path';
import SeleniumHelper from '../helpers/selenium-helper';

const {
    getDriver,
    getLogs,
    loadUri,
    textExists
} = new SeleniumHelper();

const uri = path.resolve(__dirname, '../../build/index.html');

let driver;

describe('Removed how-to library', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('does not expose the retired Tutorials menu or bundled tutorial cards', async () => {
        await loadUri(uri);
        expect(await textExists('Tutorials')).toBe(false);
        expect(await textExists('Choose a Tutorial')).toBe(false);
        expect(await textExists('Getting Started')).toBe(false);
        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });
});
