import path from 'path';
import {Command} from 'selenium-webdriver/lib/command';
import SeleniumHelper from '../helpers/selenium-helper';

const {
    clickText,
    clickBlocksCategory,
    clickXpath,
    findByText,
    findByXpath,
    getDriver,
    getLogs,
    loadUri,
    rightClickText,
    scope
} = new SeleniumHelper();

const uri = path.resolve(__dirname, '../../build/index.html');

let driver;

const resetLanguagePreference = async () => {
    if ((await driver.getCurrentUrl()).startsWith('data:')) {
        await loadUri(uri + '?locale=en');
        await getLogs();
    }
    await driver.executeScript('localStorage.removeItem("tw:language");');
};

const FILE_MENU_XPATH = '//div[contains(@class, "menu-bar_menu-bar-item")]' +
    '[*[contains(@class, "menu-bar_collapsible-label")]//*[text()="File"]]';
const SETTINGS_MENU_XPATH = '//div[contains(@class, "menu-bar_menu-bar-item")]' +
    '[*[contains(@class, "settings-menu_dropdown-label")]//*[text()="Settings"]]';
const SETTINGS_MENU_XPATH_JA = '//div[contains(@class, "menu-bar_menu-bar-item")]' +
    '[*[contains(@class, "settings-menu_dropdown-label")]//*[text()="設定"]]';

describe('Localization', () => {
    beforeAll(() => {
        driver = getDriver();
    });

    afterAll(async () => {
        await driver.quit();
    });

    test('Switching languages', async () => {
        await loadUri(uri + '?locale=en');

        // Add a sprite to make sure it stays when switching languages
        await clickXpath('//button[@aria-label="Choose a Sprite"]');
        await clickText('Apple', scope.modal); // Closes modal

        await clickXpath(SETTINGS_MENU_XPATH);
        await clickText('Language', scope.menuBar);
        await clickText('Deutsch');
        await new Promise(resolve => setTimeout(resolve, 1000)); // wait for blocks refresh

        // Make sure the blocks are translating
        await clickText('Fühlen'); // Sensing category in German
        await new Promise(resolve => setTimeout(resolve, 1000)); // wait for blocks to scroll
        await clickText('Antwort'); // Find the "answer" block in German

        // Change to the costumes tab to confirm other parts of the GUI are translating
        await clickText('Kostüme');

        // After switching languages, make sure Apple sprite still exists
        await rightClickText('Apple', scope.spriteTile); // Make sure it is there

        // Remounting re-attaches the beforeunload callback. Make sure to remove it
        driver.executeScript('window.onbeforeunload = undefined;');

        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });

    // Regression test for #4476, blocks in wrong language when loaded with locale
    test('Loading with locale shows correct blocks', async () => {
        await loadUri(`${uri}?locale=de`);
        await clickText('Fühlen'); // Sensing category in German
        await new Promise(resolve => setTimeout(resolve, 1000)); // wait for blocks to scroll
        await clickText('Antwort'); // Find the "answer" block in German
        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });

    test('Japanese locale selects the operators category and preserves string length evaluation', async () => {
        await resetLanguagePreference();
        await loadUri(`${uri}?locale=ja`);
        await clickBlocksCategory('演算');
        const toolbox = await findByXpath('//div[contains(@class, "blocks_blocks")]');
        expect(await toolbox.getAttribute('locale')).toBe('ja');
        const selectedOperators = await findByXpath(
            '//*[contains(@class, "scratchCategoryId-operators") and contains(@class, "categorySelected")]'
        );
        expect(await selectedOperators.isDisplayed()).toBe(true);
        const stringLength = await driver.executeScript(
            'return window.vm.runtime._primitives.operator_length({STRING: "りんご"});'
        );
        expect(stringLength).toBe(3);
        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });

    // Regression test for ENA-142, monitor can lag behind language selection
    test('Monitor labels update on locale change', async () => {
        await resetLanguagePreference();
        const executor = driver.getExecutor();
        executor.defineCommand(
            'sendChromeCommand',
            'POST',
            '/session/:sessionId/chromium/send_command'
        );
        await driver.schedule(
            new Command('sendChromeCommand')
                .setParameter('cmd', 'Page.addScriptToEvaluateOnNewDocument')
                .setParameter('params', {
                    source: 'Object.defineProperty(window, "showOpenFilePicker", {configurable: true, value: undefined});'
                }),
            'disable native file picker for this browser test'
        );
        await loadUri(uri + '?locale=en');
        await clickXpath(FILE_MENU_XPATH);
        await clickText('Load from your computer');
        const input = await findByXpath('//input[@accept=".sb,.sb2,.sb3"]');
        await input.sendKeys(path.resolve(__dirname, '../fixtures/monitor-variable.sb3'));

        // Monitors are present
        await findByText('username', scope.monitors);
        await findByText('language', scope.monitors);

        // Change locale to ja
        await clickXpath(SETTINGS_MENU_XPATH);
        await clickText('Language', scope.menuBar);
        await clickText('日本語');

        // Monitor labels updated
        await findByText('ユーザー名', scope.monitors);
        await findByText('言語', scope.monitors);

        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });

    test('Brickwright Code tab switches languages without reloading', async () => {
        await loadUri(uri);
        await driver.executeScript('localStorage.removeItem("tw:language");');
        await loadUri(`${uri}?locale=en`);

        await clickXpath(SETTINGS_MENU_XPATH);
        await clickText('Language', scope.menuBar);
        await clickText('日本語');
        await driver.wait(
            async () => await driver.executeScript('return window.ReduxStore.getState().locales.locale;') === 'ja',
            10000
        );

        await clickText('コード');
        await findByText('サンプルを読み込む');
        await findByText('ブロックへ');

        await clickXpath(SETTINGS_MENU_XPATH_JA);
        await clickText('言語', scope.menuBar);
        await clickText('English');
        await driver.wait(
            async () => await driver.executeScript('return window.ReduxStore.getState().locales.locale;') === 'en',
            10000
        );

        await clickText('Code');
        await findByText('Load example');
        await findByText('To blocks');

        // A saved English choice survives a reload and takes precedence over
        // the original URL's locale parameter.
        await driver.executeScript('history.replaceState({}, "", location.pathname);');
        await driver.navigate().refresh();
        await driver.wait(
            async () => await driver.executeScript('return Boolean(window.ReduxStore) && window.ReduxStore.getState().locales.locale === "en";'),
            10000
        );

        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });

    test('Japanese pseudocode still converts to blocks, Python, and JavaScript', async () => {
        await resetLanguagePreference();
        await loadUri(`${uri}?locale=ja`);
        await clickText('コード');

        const editor = await findByXpath('//textarea');
        await editor.sendKeys('SPRITE Cat:\n  WHEN flag clicked:\n    move 10 steps');
        await driver.wait(
            async () => await driver.executeScript(() => Array.from(
                document.querySelectorAll('button[aria-pressed]')
            ).some(button => button.textContent.includes('Python'))),
            10000,
            'Python language tab did not appear'
        );
        await driver.executeScript(() => Array.from(
            document.querySelectorAll('button[aria-pressed]')
        ).find(button => button.textContent.includes('Python')).click());
        await driver.wait(
            async () => await driver.executeScript('return document.querySelector("textarea").value.includes("def s0_when_flag_clicked");'),
            10000,
            'Pseudocode did not convert to Python'
        );
        await driver.executeScript(() => Array.from(
            document.querySelectorAll('button[aria-pressed]')
        ).find(button => button.textContent.includes('JavaScript')).click());
        await driver.wait(
            async () => await driver.executeScript('return document.querySelector("textarea").value.includes("function s0_when_flag_clicked");'),
            10000,
            'Python did not convert to JavaScript'
        );
        await clickText('ブロックへ');
        await driver.wait(
            async () => await driver.executeScript('return document.body.innerText.includes("ブロックに変換して読み込みました");'),
            15000,
            'JavaScript did not compile back into Scratch blocks'
        );

        const logs = await getLogs();
        await expect(logs).toEqual([]);
    });
});
