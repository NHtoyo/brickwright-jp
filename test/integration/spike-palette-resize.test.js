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

    test('centers the resize handle on the flyout boundary without intercepting blocks', async () => {
        await loadUri(uri, {width: 1920, height: 1080});
        await driver.executeScript('localStorage.removeItem("brickwright.spikePaletteWidth");');
        await driver.navigate().refresh();
        await driver.wait(async () => await driver.executeScript(
            `return Boolean(document.querySelector('${HANDLE}') && document.querySelector('.blocklyFlyoutBackground'));`
        ), 20000);

        const getGeometry = async () => driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            const container = document.querySelector('[class*="blocks-container"]');
            const flyout = document.querySelector('.blocklyFlyoutBackground');
            if (!handle || !container || !flyout) return null;
            const handleRect = handle.getBoundingClientRect();
            const hitArea = handle.querySelector('[aria-hidden="true"]');
            const hitRect = hitArea && hitArea.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const flyoutRect = flyout.getBoundingClientRect();
            const isRtl = getComputedStyle(container).direction === 'rtl';
            return {
                width: Number(handle.getAttribute('aria-valuenow')),
                handleCenterX: (handleRect.left + handleRect.right) / 2,
                boundaryX: isRtl ? flyoutRect.left : flyoutRect.right,
                hitAreaOverlapsFlyout: hitRect ? (isRtl ? hitRect.right > flyoutRect.left + 0.5 :
                    hitRect.left < flyoutRect.right - 0.5) : true,
                stored: localStorage.getItem('brickwright.spikePaletteWidth')
            };
        `);

        await driver.wait(async () => {
            const geometry = await getGeometry();
            return geometry && Math.abs(geometry.handleCenterX - geometry.boundaryX) <= 2 &&
                !geometry.hitAreaOverlapsFlyout;
        }, 5000);

        const initial = await getGeometry();
        expect(initial).not.toBeNull();
        expect(initial.width).toBe(280);
        expect(Math.abs(initial.handleCenterX - initial.boundaryX)).toBeLessThanOrEqual(2);
        expect(initial.hitAreaOverlapsFlyout).toBe(false);

        const dragBy = async deltaX => {
            const start = await driver.executeScript(`
                const rect = document.querySelector('${HANDLE} [aria-hidden="true"]').getBoundingClientRect();
                return {x: Math.round(rect.left + 2), y: Math.round(rect.top + 20)};
            `);
            await driver.actions()
                .mouseMove(start)
                .mouseDown()
                .mouseMove({x: deltaX, y: 0})
                .mouseUp()
                .perform();
        };
        await dragBy(10);
        await driver.wait(async () => (await getGeometry()).width === 290, 5000);
        await driver.wait(async () => (await getGeometry()).stored === '290', 5000);
        await driver.findElement({css: HANDLE}).sendKeys(Key.ARROW_LEFT);
        await driver.wait(async () => (await getGeometry()).width === 280, 5000);

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
        expect(Math.abs(afterResize.handleCenterX - afterResize.boundaryX)).toBeLessThanOrEqual(2);
        expect(afterResize.hitAreaOverlapsFlyout).toBe(false);

        const handle = driver.findElement({css: HANDLE});
        await handle.sendKeys(...Array(13).fill(Key.ARROW_RIGHT));
        await driver.wait(async () => (await getGeometry()).width === 400, 5000);
        await handle.sendKeys(...Array(8).fill(Key.ARROW_RIGHT));
        await driver.wait(async () => (await getGeometry()).width === 480, 5000);
        await driver.sleep(300);
        expect(Number((await getGeometry()).stored)).toBe(480);

        await handle.sendKeys(...Array(27).fill(Key.ARROW_LEFT));
        await driver.wait(async () => (await getGeometry()).width === 210, 5000);
        await handle.sendKeys(...Array(27).fill(Key.ARROW_RIGHT));
        await driver.wait(async () => (await getGeometry()).width === 480, 5000);
        await driver.sleep(300);

        await driver.manage().window().setSize(900, 900);
        await driver.sleep(300);
        expect(await driver.executeScript('return localStorage.getItem("brickwright.spikePaletteWidth");')).toBe('480');
        await driver.manage().window().setSize(1920, 1080);
        await driver.wait(async () => (await getGeometry()).width === 480, 5000);
        const expanded = await getGeometry();
        expect(Math.abs(expanded.handleCenterX - expanded.boundaryX)).toBeLessThanOrEqual(2);

        await driver.navigate().refresh();
        await driver.wait(async () => await driver.executeScript(
            `return Boolean(document.querySelector('${HANDLE}') && document.querySelector('.blocklyFlyoutBackground'));`
        ), 20000);
        const restored = await getGeometry();
        expect(restored.width).toBe(480);
        expect(Math.abs(restored.handleCenterX - restored.boundaryX)).toBeLessThanOrEqual(2);
    });
});
