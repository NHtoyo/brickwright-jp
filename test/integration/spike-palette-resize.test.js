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

    test('keeps pointer resize, cancellation, category rebuilds, tabs, and workspace blocks aligned', async () => {
        await loadUri(uri, {width: 1920, height: 1080});
        await driver.executeScript(`
            localStorage.removeItem('brickwright.spikePaletteWidth');
            localStorage.removeItem('brickwright.spikePaletteModel');
        `);
        await driver.navigate().refresh();
        await driver.wait(async () => await driver.executeScript(
            `return Boolean(document.querySelector('${HANDLE}') && document.querySelector('.blocklyFlyoutBackground'));`
        ), 20000);

        const geometry = () => driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            const container = document.querySelector('[class*="blocks-container"]');
            const flyout = document.querySelector('.blocklyFlyoutBackground');
            if (!handle || !container || !flyout) return null;
            const handleRect = handle.getBoundingClientRect();
            const hit = handle.querySelector('[aria-hidden="true"]');
            const hitRect = hit && hit.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const flyoutRect = flyout.getBoundingClientRect();
            const rtl = getComputedStyle(container).direction === 'rtl';
            return {
                width: Number(handle.getAttribute('aria-valuenow')),
                centerX: (handleRect.left + handleRect.right) / 2,
                boundaryX: rtl ? flyoutRect.left : flyoutRect.right,
                hitClear: Boolean(hitRect && (rtl ? hitRect.right <= flyoutRect.left + 0.5 :
                    hitRect.left >= flyoutRect.right - 0.5)),
                containerWidth: containerRect.width,
                stored: localStorage.getItem('brickwright.spikePaletteWidth'),
                rtl
            };
        `);
        await driver.wait(async () => {
            const value = await geometry();
            return value && value.width === 280 && Math.abs(value.centerX - value.boundaryX) <= 2;
        }, 5000);

        const moveHandle = async deltaX => {
            const resizeHitArea = driver.findElement({css: `${HANDLE} [aria-hidden="true"]`});
            await driver.actions().mouseMove(resizeHitArea).mouseDown()
                .mouseMove({x: deltaX, y: 0}).mouseUp().perform();
        };
        await moveHandle(-10);
        await driver.wait(async () => {
            const current = await geometry();
            return current.width === 270 && current.stored === '270';
        }, 5000);
        await moveHandle(10);
        await driver.wait(async () => (await geometry()).width === 280, 5000);
        await driver.wait(async () => (await geometry()).stored === '280', 5000);

        await driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            handle.addEventListener('pointerdown', event => { window.__palettePointerId = event.pointerId; }, {once: true});
        `);
        const resizeHitArea = driver.findElement({css: `${HANDLE} [aria-hidden="true"]`});
        await driver.actions().mouseMove(resizeHitArea).mouseDown().mouseMove({x: -35, y: 0}).perform();
        await driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            handle.dispatchEvent(new PointerEvent('pointercancel', {
                bubbles: true,
                pointerId: window.__palettePointerId
            }));
        `);
        await driver.actions().mouseUp().perform();
        await driver.wait(async () => (await geometry()).width === 280, 5000);
        expect((await geometry()).stored).toBe('280');

        const setPalette = async (name, checked) => {
            const found = await driver.executeScript(`
                const input = [...document.querySelectorAll('input[type="checkbox"]')]
                    .find(element => element.value === ${JSON.stringify(name)});
                if (!input) return false;
                if (input.checked !== ${JSON.stringify(checked)}) input.click();
                return true;
            `);
            if (!found) return null;
            await driver.wait(async () => await driver.executeScript(`
                const input = [...document.querySelectorAll('input[type="checkbox"]')]
                    .find(element => element.value === ${JSON.stringify(name)});
                return Boolean(input && input.checked === ${JSON.stringify(checked)});
            `), 5000);
            return driver.executeScript(`
                return [...document.querySelectorAll('input[type="checkbox"]')]
                    .find(element => element.value === ${JSON.stringify(name)}).checked;
            `);
        };
        expect(await setPalette('spike', false)).toBe(false);
        expect(await setPalette('scratch', true)).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return Boolean(document.querySelector(".scratchCategoryId-motion"));'
        ), 5000);
        await driver.executeScript('document.querySelector(".scratchCategoryId-motion").click();');

        for (const model of ['essential', 'all', 'prime', 'auto']) {
            await driver.executeScript(`
                const select = [...document.querySelectorAll('select')].find(element =>
                    element.querySelector('option[value="essential"]') && element.querySelector('option[value="prime"]'));
                if (!select) throw new Error('SPIKE model selection is unavailable.');
                select.value = ${JSON.stringify(model)};
                select.dispatchEvent(new Event('change', {bubbles: true}));
            `);
            await driver.wait(async () => await driver.executeScript(
                `return [...document.querySelectorAll('select')].some(element =>
                    element.querySelector('option[value="essential"]') && element.value === ${JSON.stringify(model)});`
            ), 5000);
            const current = await geometry();
            expect(current.width).toBe(280);
            expect(Math.abs(current.centerX - current.boundaryX)).toBeLessThanOrEqual(2);
            expect(current.hitClear).toBe(true);
        }
        expect(await setPalette('spike', true)).toBe(true);
        expect(await setPalette('scratch', true)).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return Boolean(document.querySelector(".scratchCategoryId-motion"));'
        ), 5000);

        const selectTab = async pattern => driver.executeScript(`
            const tab = [...document.querySelectorAll('[role="tab"]')]
                .find(element => new RegExp(${JSON.stringify(pattern)}, 'i').test(element.textContent.trim()));
            if (!tab) return false;
            tab.click();
            return true;
        `);
        expect(await selectTab('costumes|コスチューム|衣装')).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return /costumes|コスチューム|衣装/i.test(document.querySelector("[role=tab][aria-selected=true]")?.textContent || "");'
        ), 5000);
        expect(await selectTab('code|コード')).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return /code|コード/i.test(document.querySelector("[role=tab][aria-selected=true]")?.textContent || "");'
        ), 5000);
        expect(await selectTab('blocks|ブロック')).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return /blocks|ブロック/i.test(document.querySelector("[role=tab][aria-selected=true]")?.textContent || "");'
        ), 5000);

        const beforeBlockIds = await driver.executeScript(`
            const targets = window.vm.runtime.targets;
            return targets.flatMap(target => target.blocks ? Object.values(target.blocks._blocks)
                .filter(block => block.topLevel).map(block => block.id) : []);
        `);
        await driver.executeScript(`
            const category = document.querySelector('.scratchCategoryId-motion');
            if (!category) throw new Error('Scratch motion category is unavailable.');
            category.click();
        `);
        await driver.wait(async () => await driver.executeScript(
            'return Boolean(document.querySelector(".blocklyFlyout .blocklyDraggable"));'
        ), 5000);
        const dragPoints = await driver.executeScript(`
            const block = [...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')]
                .find(candidate => candidate.getBoundingClientRect().width > 0 &&
                    candidate.getBoundingClientRect().height > 0);
            const workspace = document.querySelector('.blocklyMainBackground');
            if (!block || !workspace) return null;
            const blockRect = block.getBoundingClientRect();
            const workspaceRect = workspace.getBoundingClientRect();
            return {
                start: {x: Math.round(blockRect.left + blockRect.width / 2), y: Math.round(blockRect.top + blockRect.height / 2)},
                end: {x: Math.round(workspaceRect.left + Math.max(220, workspaceRect.width * 0.35)),
                    y: Math.round(workspaceRect.top + Math.max(120, workspaceRect.height * 0.35))}
            };
        `);
        expect(dragPoints).not.toBeNull();
        const paletteBlock = await driver.executeScript(`
            return [...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')]
                .find(candidate => candidate.getBoundingClientRect().width > 0 &&
                    candidate.getBoundingClientRect().height > 0);
        `);
        expect(paletteBlock).not.toBeNull();
        const dragActions = driver.actions().mouseMove(paletteBlock).mouseDown();
        const dragDeltaX = dragPoints.end.x - dragPoints.start.x;
        const dragDeltaY = dragPoints.end.y - dragPoints.start.y;
        for (let step = 1; step <= 8; step++) {
            const previousStep = step - 1;
            dragActions.mouseMove({
                x: Math.round(dragDeltaX * step / 8) - Math.round(dragDeltaX * previousStep / 8),
                y: Math.round(dragDeltaY * step / 8) - Math.round(dragDeltaY * previousStep / 8)
            });
        }
        await dragActions.mouseUp().perform();
        await driver.wait(async () => await driver.executeScript(`
            const before = ${JSON.stringify(beforeBlockIds)};
            return window.vm.runtime.targets.some(target => target.blocks && Object.values(target.blocks._blocks)
                .some(block => block.topLevel && !before.includes(block.id)));
        `), 5000);
        const workspacePositions = await driver.executeScript(`
            const before = ${JSON.stringify(beforeBlockIds)};
            return window.vm.runtime.targets.flatMap(target => target.blocks ? Object.values(target.blocks._blocks)
                .filter(block => block.topLevel && !before.includes(block.id))
                .map(block => ({id: block.id, x: block.x, y: block.y})) : []);
        `);
        expect(workspacePositions.length).toBeGreaterThan(0);
        const workspaceBlockIds = workspacePositions.map(block => block.id);
        const getVisibleBlockPositions = () => driver.executeScript(`
            const ids = ${JSON.stringify(workspaceBlockIds)};
            const flyout = document.querySelector('.blocklyFlyoutBackground').getBoundingClientRect();
            const nodes = [...document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable')];
            return ids.map(id => {
                const node = nodes.find(element => element.getAttribute('data-id') === id ||
                    element.id === id || element.id.endsWith(id));
                if (!node) return {id, missing: true};
                const rect = node.getBoundingClientRect();
                return {id, x: Math.round(rect.left - flyout.right), y: Math.round(rect.top - flyout.top)};
            });
        `);
        const visibleBlockPositionsBeforeResize = await getVisibleBlockPositions();
        expect(visibleBlockPositionsBeforeResize.every(block => !block.missing)).toBe(true);

        await moveHandle(15);
        await driver.wait(async () => (await geometry()).width === 295, 5000);
        const resized = await geometry();
        expect(resized.hitClear).toBe(true);
        expect(Math.abs(resized.centerX - resized.boundaryX)).toBeLessThanOrEqual(2);
        const visibleBlockPositionsAfterResize = await getVisibleBlockPositions();
        expect(visibleBlockPositionsAfterResize).toEqual(visibleBlockPositionsBeforeResize);

        const clickSettingsEntry = async selector => driver.executeScript(`
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return false;
            element.click();
            return true;
        `);
        const chooseLocale = async localeName => {
            const clicked = await driver.executeScript(`
                const item = [...document.querySelectorAll('[class*="language-menu-item"]')]
                    .find(element => element.textContent.trim() === ${JSON.stringify(localeName)});
                if (!item) return false;
                item.click();
                return true;
            `);
            expect(clicked).toBe(true);
        };
        expect(await clickSettingsEntry('[class*="settings-menu_dropdown-label"]')).toBe(true);
        expect(await clickSettingsEntry('[class*="settings-menu_option"]')).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return Boolean(document.querySelector("[class*=language-menu-item]"));'
        ), 5000);
        await chooseLocale('العربية');
        await driver.wait(async () => (await geometry()).rtl, 5000);
        const rtlGeometry = await geometry();
        expect(Math.abs(rtlGeometry.centerX - rtlGeometry.boundaryX)).toBeLessThanOrEqual(2);
        expect(rtlGeometry.hitClear).toBe(true);
        await moveHandle(10);
        await driver.wait(async () => (await geometry()).width === 285, 5000);
        await moveHandle(-10);
        await driver.wait(async () => (await geometry()).width === 295, 5000);
        expect(await clickSettingsEntry('[class*="settings-menu_dropdown-label"]')).toBe(true);
        expect(await clickSettingsEntry('[class*="settings-menu_option"]')).toBe(true);
        await driver.wait(async () => await driver.executeScript(
            'return Boolean(document.querySelector("[class*=language-menu-item]"));'
        ), 5000);
        await chooseLocale('English');
        await driver.wait(async () => !(await geometry()).rtl, 5000);

        await driver.manage().window().setSize(500, 800);
        await driver.sleep(300);
        const narrowViewport = await driver.executeScript(`
            const handle = document.querySelector('${HANDLE}');
            const container = document.querySelector('[class*="blocks-container"]');
            return {
                innerWidth: window.innerWidth,
                documentWidth: document.documentElement.clientWidth,
                containerWidth: container && container.clientWidth,
                handlePresent: Boolean(handle),
                handleDisabled: handle && handle.getAttribute('aria-disabled'),
                handleStyle: handle && getComputedStyle(handle).display
            };
        `);
        if (narrowViewport.handlePresent && narrowViewport.handleDisabled !== 'true') {
            throw new Error(JSON.stringify(narrowViewport));
        }
        await driver.manage().window().setSize(1920, 1080);
        await driver.wait(async () => Boolean(await geometry()), 5000);
        expect((await geometry()).hitClear).toBe(true);
    });
});
