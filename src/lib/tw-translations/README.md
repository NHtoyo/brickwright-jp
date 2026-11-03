generated-translations.json is managed by https://github.com/TurboWarp/scratch-l10n.
Do not hand-edit it: upstream catalog regeneration can replace the file.

Brickwright-owned React Intl message IDs are kept in brickwright-en.json and
brickwright-ja.json and merged by index.js after the generated catalog. This
keeps the English fallback and Japanese translations intact when the TurboWarp
catalog is refreshed. When changing React Intl source messages, regenerate the
message extraction files with npm run i18n:src, update both Brickwright-owned
catalogs, and run the Japanese translation unit and browser integration tests.

The Brickwright Code, debugger, and Circuit panels use the separately
maintained src/lib/brickwright-translations/ui.json catalog. Keep its English
and Japanese keys and placeholders in sync; the unit test checks both.

On first launch, the editor follows the browser language when that language is
supported (`ja-JP` selects `ja`). A language chosen in Settings is saved and
takes precedence on later visits, including when a URL contains a different
locale parameter. This keeps Japanese browsers in Japanese while preserving an
explicit English choice.
