import translations from './ui.json';

const translate = (locale, key, values = {}) => {
    const language = String(locale || 'en').toLowerCase()
        .split('-')[0];
    const message = (translations[language] && translations[language][key]) || translations.en[key] || key;
    return message.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
        if (Object.prototype.hasOwnProperty.call(values, name)) {
            return String(values[name]);
        }
        return match;
    });
};

export {translations, translate};
