import fs from 'fs';
import os from 'os';
import path from 'path';
import webdriver from 'selenium-webdriver';
import {Command} from 'selenium-webdriver/lib/command';
import SeleniumHelper from '../helpers/selenium-helper';

jest.setTimeout(120000);

const RUN_E2E = process.env.BW_EXTENSION_GALLERY_E2E === '1';
const describeIfEnabled = RUN_E2E ? describe : describe.skip;
// Opt-in because this suite requires the core and extension development servers.
const editorUri =
    process.env.BW_EDITOR_URL || 'http://localhost:8601/editor.html';
const extensionId = 'spikeprime';
const projectFixture = path.resolve(__dirname, '../fixtures/project1.sb3');

const {getDriver, loadUri} = new SeleniumHelper();
const {By} = webdriver;

const FILE_MENU_XPATH =
    '//div[contains(@class, "menu-bar_menu-bar-item")]' +
    '[*[contains(@class, "menu-bar_collapsible-label") or contains(@class, "settings-menu_dropdown-label")]' +
    '//*[text()="File" or text()="ファイル"]]';

describeIfEnabled('Extension gallery browser integration', () => {
    let driver;
    let downloadDirectory;
    let previousDownloadDirectory;

    const waitFor = (condition, timeout = 20000) =>
        driver.wait(condition, timeout);

    const openGallery = async () => {
        await driver
            .findElement(By.css('button[class*="gui_extension-button"]'))
            .click();
        await waitFor(() =>
            driver.executeScript(
                'return Boolean(document.querySelector("#extension-gallery-source"));'
            )
        );
    };

    const chooseSource = async (label, expectedId) => {
        const select = await driver.findElement(
            By.css('#extension-gallery-source')
        );
        await select.sendKeys(label);
        await waitFor(() =>
            driver.executeScript(
                'return document.querySelector("#extension-gallery-source").value === arguments[0];',
                expectedId
            )
        );
    };

    const waitForExtensionCard = name =>
        waitFor(() =>
            driver.executeScript(
                'return [...document.querySelectorAll("[class*=library-item-name]")]' +
                    '.some(element => element.innerText.includes(arguments[0]));',
                name
            )
        );

    const clickExtensionCard = async name => {
        const card = await driver.findElement(
            By.xpath(
                `//span[contains(@class, "library-item-name") and contains(., "${name}")]`
            )
        );
        await card.click();
    };

    const waitForExtensionLoaded = () =>
        waitFor(() =>
            driver.executeScript(
                'return window.vm.extensionManager.isExtensionLoaded(arguments[0]);',
                extensionId
            )
        );

    const openEnglishEditor = async () => {
        await loadUri(`${editorUri}?locale=en`);
        await waitFor(() =>
            driver.executeScript(
                'return Boolean(window.vm) && window.vm.getLocale() === "en";'
            )
        );
    };

    beforeAll(async () => {
        previousDownloadDirectory = process.env.SELENIUM_DOWNLOAD_DIR;
        downloadDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'brickwright-e2e-')
        );
        process.env.SELENIUM_DOWNLOAD_DIR = downloadDirectory;
        driver = getDriver();

        const fixtureBase64 = fs
            .readFileSync(projectFixture)
            .toString('base64');
        const source = `Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: async () => {
                window.__brickwrightFilePickerUsed = true;
                const bytes = Uint8Array.from(
                    atob(${JSON.stringify(fixtureBase64)}),
                    character => character.charCodeAt(0)
                );
                return [{
                    getFile: async () => new File(
                        [bytes],
                        "project1.sb3",
                        {type: "application/octet-stream"}
                    )
                }];
            }
        });`;
        const executor = driver.getExecutor();
        executor.defineCommand(
            'sendChromeCommand',
            'POST',
            '/session/:sessionId/chromium/send_command'
        );
        await driver.schedule(
            new Command('sendChromeCommand')
                .setParameter('cmd', 'Page.addScriptToEvaluateOnNewDocument')
                .setParameter('params', {source}),
            'install automated local project picker'
        );
    });

    afterAll(async () => {
        if (driver) await driver.quit();
        if (typeof previousDownloadDirectory === 'undefined') {
            delete process.env.SELENIUM_DOWNLOAD_DIR;
        } else {
            process.env.SELENIUM_DOWNLOAD_DIR = previousDownloadDirectory;
        }
        if (downloadDirectory) {
            fs.rmSync(downloadDirectory, {recursive: true, force: true});
        }
    });

    test(
        'loads the bundled SPIKE extension once, keeps the gallery available, and saves projects',
        async () => {
            await loadUri(`${editorUri}?locale=ja`);
            await waitFor(() =>
                driver.executeScript(
                    'return Boolean(window.vm) && window.vm.getLocale() === "ja";'
                )
            );
            expect(
                await driver.executeScript('return window.vm.initialized;')
            ).toBe(true);
            await waitForExtensionLoaded();
            const initialSpikeState = await driver.executeScript(
                'const url = window.vm.extensionManager.getExtensionURLs().spikeprime;' +
                'const router = window.vm.runtime.peripheralExtensions.spikeprime;' +
                'const api = window.vm.runtime.brickwrightSpikePrimeControl;' +
                'const parsed = new URL(url);' +
                'return {url, origin: parsed.origin, pathname: parsed.pathname,' +
                    'build: parsed.searchParams.get("bwSpikeBuild"),' +
                    'routerRegistered: Boolean(router), sharedRouter: Boolean(router && api &&' +
                    'api.getState().hubRouterId === router.instanceId && api.getState().runtimeRegistered),' +
                    'resources: performance.getEntriesByType("resource").map(entry => entry.name)};'
            );
            expect(initialSpikeState.origin).toBe(
                await driver.executeScript('return window.location.origin;')
            );
            expect(initialSpikeState.pathname).toBe(
                '/extensions/CrispStrobe/legospike_turbowarp_transpile.js'
            );
            expect(initialSpikeState.build).toBeTruthy();
            expect(initialSpikeState.sharedRouter).toBe(true);
            expect(initialSpikeState.resources).toContain(initialSpikeState.url);
            expect(initialSpikeState.url).not.toContain('cdn.jsdelivr.net');
            expect(initialSpikeState.url).not.toContain('localhost:8000');

            const japaneseReporters = await driver.executeScript(
                'const primitives = window.vm.runtime._primitives;' +
                'const json = primitives.spikeprime_getCommunicationDiagnostics();' +
                'const summary = primitives.spikeprime_getCommunicationDiagnosticsSummary();' +
                'return {json, summary, parsed: JSON.parse(json)};'
            );
            expect(japaneseReporters.parsed.connected).toBe(false);
            expect(japaneseReporters.summary).toContain('Bluetooth 接続: 未接続');
            expect(japaneseReporters.summary).toContain('角度: 未受信');
            expect(japaneseReporters.summary).not.toContain('0°');

            await openGallery();
            await waitFor(() =>
                driver.executeScript(
                    'return document.querySelectorAll("#extension-gallery-source option").length === 2;'
                )
            );
            await chooseSource('CrispStrobe公式', 'crispstrobe');
            await waitForExtensionCard('Pen');
            const gallerySources = await driver.executeScript(
                'return [...document.querySelectorAll("#extension-gallery-source option")].map(option => option.value);'
            );
            expect(gallerySources).toEqual(['crispstrobe', 'nhtoyo-development']);
            expect(
                await driver.executeScript(
                    'return [...document.querySelectorAll("[class*=library-item-name]")]' +
                    '.some(element => element.innerText.includes("LEGO SPIKE Prime"));'
                )
            ).toBe(false);
            const galleryBounds = await driver.executeScript(
                'const modal = document.querySelector(".ReactModal__Content");' +
                'const rect = modal.getBoundingClientRect();' +
                'return {width: window.innerWidth, left: rect.left, right: rect.right};'
            );
            expect(galleryBounds.left).toBeGreaterThanOrEqual(0);
            expect(galleryBounds.right).toBeLessThanOrEqual(galleryBounds.width + 1);

            await driver.navigate().refresh();
            await waitForExtensionLoaded();
            const reloadedSpikeState = await driver.executeScript(
                'const url = window.vm.extensionManager.getExtensionURLs().spikeprime;' +
                'const parsed = new URL(url);' +
                'return {origin: parsed.origin, pathname: parsed.pathname,' +
                    'build: parsed.searchParams.get("bwSpikeBuild")};'
            );
            expect(reloadedSpikeState.origin).toBe(initialSpikeState.origin);
            expect(reloadedSpikeState.pathname).toBe(initialSpikeState.pathname);
            expect(reloadedSpikeState.build).toBe(initialSpikeState.build);

            await openEnglishEditor();
            await waitForExtensionLoaded();
            const englishReporters = await driver.executeScript(
                'const p = window.vm.runtime._primitives;' +
                'return {summary: p.spikeprime_getCommunicationDiagnosticsSummary(),' +
                    'diagnostics: JSON.parse(p.spikeprime_getCommunicationDiagnostics())};'
            );
            expect(englishReporters.summary).toContain(
                'Bluetooth connection: not connected'
            );
            expect(englishReporters.summary).toContain('Angles: not received');
            expect(englishReporters.diagnostics.protocol).toBe('spike3');

            await openGallery();
            await waitForExtensionCard('Pen');
            await clickExtensionCard('Pen');
            await waitFor(() =>
                driver.executeScript(
                    'return window.vm.extensionManager.isExtensionLoaded("pen");'
                )
            );
            expect(
                await driver.executeScript(
                    'return window.vm.runtime._blockInfo.some(info => info.id === "pen");'
                )
            ).toBe(true);

            await driver.findElement(By.xpath(FILE_MENU_XPATH)).click();
            await driver
                .findElement(By.xpath("//*[text()='Load from your computer']"))
                .click();
            await waitFor(() =>
                driver.executeScript(
                    'return window.__brickwrightFilePickerUsed === true;'
                )
            );
            await waitFor(() =>
                driver.executeScript(
                    'return window.vm.runtime.targets.some(target => target.sprite?.name === "project1-sprite");'
                )
            );

            await driver.findElement(By.xpath(FILE_MENU_XPATH)).click();
            const saveAsSeparateFile = await driver.findElements(
                By.xpath("//*[text()='Save to separate file...']")
            );
            if (saveAsSeparateFile.length) {
                await saveAsSeparateFile[0].click();
            } else {
                await driver
                    .findElement(By.xpath("//*[text()='Save to your computer']"))
                    .click();
            }
            await waitFor(() =>
                fs
                    .readdirSync(downloadDirectory)
                    .some(file => file.endsWith('.sb3'))
            );
            const savedFile = fs
                .readdirSync(downloadDirectory)
                .find(file => file.endsWith('.sb3'));
            expect(
                fs.statSync(path.join(downloadDirectory, savedFile)).size
            ).toBeGreaterThan(100);

            const browserErrors = (await driver.manage().logs()
                .get('browser'))
                .filter(entry => entry.level.name === 'SEVERE')
                .filter(entry => !entry.message.includes('Warning:'))
                .filter(
                    entry =>
                        !entry.message.includes('[React Intl] Missing message:')
                );
            expect(browserErrors).toEqual([]);
        }
    );
});
