import path from 'path';
import SeleniumHelper from '../helpers/selenium-helper';

const {getDriver, loadUri} = new SeleniumHelper();

const uri = path.resolve(__dirname, '../../build/index.html');

let driver;

describe('Backpack availability', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('the editor does not show the disabled backpack panel', async () => {
        await loadUri(uri);
        expect(await driver.executeScript(
            'return document.querySelector("[data-for=\\"backpack-tooltip\\"]") !== null;'
        )).toBe(false);
    });

    test('a backpack host query does not expose an unsupported panel', async () => {
        await loadUri(`${uri}?backpack_host=https://backpack.scratch.mit.edu`);
        expect(await driver.executeScript(
            'return document.querySelector("[data-for=\\"backpack-tooltip\\"]") !== null;'
        )).toBe(false);
    });
});
