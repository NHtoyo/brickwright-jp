import path from 'path';
import SeleniumHelper from '../helpers/selenium-helper';

const {getDriver, loadUri, Key} = new SeleniumHelper();
const uri = path.resolve(__dirname, '../../build/index.html');
const HANDLE = '[class*="palette-resize-handle"][role="separator"]';
let driver;

describe('SPIKE palette resize in the editor', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('keeps the resize handle on the rendered Blockly flyout edge and persists width', async () => {
        await loadUri(uri);
        await driver.executeScript('localStorage.removeItem("brickwright.spikePaletteWidth");');
        await driver.navigate().refresh();
        await driver.manage().window().setSize(1360, 900);
        await driver.wait(async () => await driver.executeScript(
            `return Boolean(document.querySelector('${HANDLE}') && document.querySelector('.blocklyFlyoutBackground'));`
        ), 20000);

        const getGeometry = async () => driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            const container = document.querySelector('[class*="blocks-container"]');
            const flyout = document.querySelector('.blocklyFlyoutBackground');
            if (!handle || !container || !flyout) return null;
            const handleRect = handle.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const flyoutRect = flyout.getBoundingClientRect();
            return {
                width: Number(handle.getAttribute('aria-valuenow')),
                center: handleRect.left + (handleRect.width / 2),
                flyoutEdge: flyoutRect.right,
                containerLeft: containerRect.left,
                stored: localStorage.getItem('brickwright.spikePaletteWidth')
            };
        `);

        const initial = await getGeometry();
        expect(initial).not.toBeNull();
        expect(initial.width).toBeGreaterThanOrEqual(210);
        expect(initial.width).toBeLessThanOrEqual(280);
        expect(Math.abs(initial.center - initial.flyoutEdge)).toBeLessThanOrEqual(2);

        const resizedWidth = initial.width - 10;
        await driver.findElement({css: HANDLE}).sendKeys(Key.ARROW_LEFT);
        await driver.wait(async () => {
            const geometry = await getGeometry();
            return geometry && geometry.width === resizedWidth;
        }, 5000);
        await driver.sleep(300);
        const afterResize = await getGeometry();
        const persistedWidth = Number(afterResize.stored);
        expect(Number.isFinite(persistedWidth)).toBe(true);
        expect(Math.abs(persistedWidth - resizedWidth)).toBeLessThanOrEqual(1);

        await driver.navigate().refresh();
        await driver.wait(async () => await driver.executeScript(
            `return Boolean(document.querySelector('${HANDLE}') && document.querySelector('.blocklyFlyoutBackground'));`
        ), 20000);
        const restored = await getGeometry();
        expect(restored.width).toBe(persistedWidth);
        expect(Math.abs(restored.center - restored.flyoutEdge)).toBeLessThanOrEqual(2);
    });
});
