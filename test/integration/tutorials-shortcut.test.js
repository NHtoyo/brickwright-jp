import path from 'path';
import SeleniumHelper from '../helpers/selenium-helper';

const {getDriver, loadUri} = new SeleniumHelper();

const uri = path.resolve(__dirname, '../../build/index.html?tutorial=all');

let driver;

describe('Retired Tutorials shortcuts', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('legacy tutorial shortcuts do not show removed tutorial content', async () => {
        await loadUri(uri);
        const videoSteps = await driver.executeScript(
            'return document.querySelectorAll(".step-video").length;'
        );
        expect(videoSteps).toBe(0);
    });
});
