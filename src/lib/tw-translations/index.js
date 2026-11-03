import twTranslations from './generated-translations.json';
import brickwrightEn from './brickwright-en.json';
import brickwrightJa from './brickwright-ja.json';

const addAdditionalTranslations = editorMessages => {
    for (const locale of Object.keys(editorMessages)) {
        // Seed app-owned messages so locales that do not have a translation
        // yet use the English default without React Intl missing-message errors.
        Object.assign(editorMessages[locale], brickwrightEn);
        const toMixIn = twTranslations[locale.toLowerCase()];
        if (toMixIn) {
            Object.assign(editorMessages[locale], toMixIn);
        }
    }

    // Keep Brickwright's own Japanese strings outside the generated TurboWarp
    // catalog. That catalog is refreshed from upstream and is not an app-owned
    // translation source.
    const japaneseLocale = Object.keys(editorMessages).find(locale => locale.toLowerCase() === 'ja');
    if (japaneseLocale) Object.assign(editorMessages[japaneseLocale], brickwrightJa);

    // We reuse our `es` translations for `es-419` instead of maintaining separate translations.
    Object.assign(editorMessages['es-419'], twTranslations.es);
};

export default addAdditionalTranslations;
