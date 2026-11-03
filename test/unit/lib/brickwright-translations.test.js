import fs from 'fs';
import path from 'path';

import {translations, translate} from '../../../src/lib/brickwright-translations/ui';
import addAdditionalTranslations from '../../../src/lib/tw-translations';

const root = path.resolve(__dirname, '../../..');
const placeholderNames = message => (message.match(/\{[A-Za-z0-9_]+\}/g) || []).sort();

describe('Brickwright Japanese translations', () => {
    test('English and Japanese app-owned UI catalogs have the same keys and placeholders', () => {
        const englishKeys = Object.keys(translations.en).sort();
        const japaneseKeys = Object.keys(translations.ja).sort();
        expect(japaneseKeys).toEqual(englishKeys);
        for (const key of englishKeys) {
            expect(placeholderNames(translations.ja[key])).toEqual(placeholderNames(translations.en[key]));
        }
    });

    test('UI text switches immediately between Japanese and English', () => {
        expect(translate('ja', 'run')).toBe('実行');
        expect(translate('en', 'run')).toBe('Run');
        expect(translate('ja', 'runTimedOut', {seconds: 4})).toContain('4秒');
        expect(translate('en', 'runTimedOut', {seconds: 4})).toContain('4s');
    });

    test('Brickwright-owned editor message IDs stay outside generated catalogs', () => {
        const file = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
        const sourceMessages = [
            ...file('translations/messages/src/components/gui/gui.json'),
            ...file('translations/messages/src/containers/extension-library.json'),
            ...file('translations/messages/src/components/menu-bar/menu-bar.json')
        ].filter(message => message.id === 'gui.gui.blocksTab' ||
            message.id === 'gui.gui.pseudocodeTab' ||
            message.id === 'gui.gui.circuitTab' ||
            message.id.startsWith('gui.extensionLibrary.') ||
            message.id === 'tw.menuBar.addons');
        const english = file('src/lib/tw-translations/brickwright-en.json');
        const japanese = file('src/lib/tw-translations/brickwright-ja.json');

        expect(Object.keys(english).sort()).toEqual(sourceMessages.map(message => message.id).sort());
        expect(Object.keys(japanese).sort()).toEqual(sourceMessages.map(message => message.id).sort());
        for (const message of sourceMessages) {
            expect(placeholderNames(english[message.id])).toEqual(placeholderNames(message.defaultMessage));
            expect(placeholderNames(japanese[message.id])).toEqual(placeholderNames(message.defaultMessage));
        }
    });

    test('Untranslated app-owned message IDs use English in other locales', () => {
        const messages = {en: {}, de: {}, ja: {}, 'es-419': {}};
        addAdditionalTranslations(messages);

        expect(messages.de['gui.gui.blocksTab']).toBe('Blocks');
        expect(messages.de['tw.menuBar.addons']).toBe('Add-ons');
        expect(messages.ja['gui.gui.blocksTab']).toBe('ブロック');
        expect(messages.ja['tw.menuBar.addons']).toBe('アドオン');
    });
});
