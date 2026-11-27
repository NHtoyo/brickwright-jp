import {access, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectReleaseRights} from './check-asset-rights-for-release.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const releaseMode = process.argv.includes('--release');
const errors = [];
const warnings = [];

const main = async () => {
    for (const file of [
        path.join(repoRoot, 'LICENSE'),
        path.join(desktopDir, 'licenses', 'MPL-2.0.txt'),
        path.join(desktopDir, 'about.html'),
        path.join(desktopDir, 'compliance', 'assets-rights.json'),
        path.join(desktopDir, 'compliance', 'asset-distribution-review.md'),
        path.join(desktopDir, 'compliance', 'brand-review.md'),
        path.join(desktopDir, 'licenses', 'Scratch-GUI-BSD-3-Clause.txt'),
        path.join(desktopDir, 'licenses', 'source-assets', 'seti-ui-custom-icon-MIT.txt'),
        path.join(desktopDir, 'licenses', 'source-assets', 'turbowarp-extension-icons-attribution.txt'),
        path.join(desktopDir, 'licenses', 'source-assets', 'Londrina-OFL-1.1.txt'),
        path.join(desktopDir, 'licenses', 'package-supplemental', 'color-convert-0.5.3-LICENSE.txt'),
        path.join(desktopDir, 'licenses', 'package-supplemental', 'omggif-1.0.9-LICENSE.txt'),
        path.join(desktopDir, 'licenses', 'electron', 'LICENSE'),
        path.join(desktopDir, 'licenses', 'electron', 'LICENSES.chromium.html')
    ]) {
        try { await access(file); } catch (error) { errors.push(`Missing required file: ${path.relative(repoRoot, file)}`); }
    }
    const packageRoot = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    if (!String(packageRoot.license).includes('GPL')) errors.push('Root package does not declare GPL licensing.');
    const trademark = await readFile(path.join(repoRoot, 'TRADEMARK'), 'utf8').catch(() => '');
    if (!trademark.includes('Scratch Foundation')) errors.push('TRADEMARK is missing the current Scratch Foundation attribution.');
    const about = await readFile(path.join(desktopDir, 'about.html'), 'utf8').catch(() => '');
    const independentNoticePresent = about.includes('not affiliated') ||
        (about.includes('独立したオープンソースプロジェクト') && about.includes('製品ではありません'));
    if (!independentNoticePresent || !about.includes('LEGO Group') || !about.includes('Scratch Foundation')) {
        errors.push('About screen is missing the independent-project and trademark notice.');
    }
    const builder = await readFile(path.join(desktopDir, 'electron-builder.yml'), 'utf8');
    if (!builder.includes('brickwright.ico') || !builder.includes('brickwright.icns')) errors.push('Desktop app icon is not configured from the Brickwright robot artwork.');
    if (/scratch-cat|lego-logo/i.test(builder)) errors.push('A protected Scratch or LEGO brand image appears in the app icon configuration.');

    const assets = JSON.parse(await readFile(path.join(desktopDir, 'compliance', 'assets-rights.json'), 'utf8'));
    const unverifiedAssets = (assets.assets || []).filter(asset => asset.rightsStatus === 'UNVERIFIED');
    const invalidAssets = (assets.assets || []).filter(asset => !['VERIFIED', 'UNVERIFIED', 'EXCLUDED'].includes(asset.rightsStatus));
    if (invalidAssets.length) errors.push(`${invalidAssets.length} media entries have an invalid rights status.`);
    if (unverifiedAssets.length) warnings.push(`${unverifiedAssets.length} media entries remain UNVERIFIED.`);
    const rightsReview = inspectReleaseRights(assets);
    if (!rightsReview.allowed) errors.push(`Release asset distribution review is incomplete: ${JSON.stringify(rightsReview)}`);
    if (assets.brandReview?.assetHash?.value) {
        const iconBytes = await readFile(path.join(repoRoot, assets.brandReview.appIcon));
        const iconHash = createHash('sha256').update(iconBytes).digest('hex');
        if (iconHash !== assets.brandReview.assetHash.value) errors.push('Brand review hash does not match the app icon bytes.');
    } else errors.push('Brand review does not identify the reviewed app icon hash.');

    const licenseManifestPath = path.join(desktopDir, 'build', 'desktop', 'licenses', 'THIRD_PARTY_LICENSES.json');
    let licenseManifest = null;
    try { licenseManifest = JSON.parse(await readFile(licenseManifestPath, 'utf8')); } catch (error) {
        errors.push('Third-party license manifest has not been generated for the staged app.');
    }
    const unknownLicenses = licenseManifest ? licenseManifest.unknownLicenses || [] : [];
    if (unknownLicenses.length) warnings.push(`${unknownLicenses.length} package licenses are UNKNOWN: ${unknownLicenses.join(', ')}`);
    const missingLicenseTexts = licenseManifest ? licenseManifest.missingLicenseTexts || [] : [];
    if (missingLicenseTexts.length) warnings.push(`${missingLicenseTexts.length} packages have no bundled license text: ${missingLicenseTexts.join(', ')}`);
    const missingElectronNotices = licenseManifest ? licenseManifest.missingElectronNotices || [] : [];
    if (missingElectronNotices.length) warnings.push(`Electron notices are missing: ${missingElectronNotices.join(', ')}`);

    if (releaseMode) {
        try {
            const buildInfo = JSON.parse(await readFile(path.join(desktopDir, 'build', 'build-info.json'), 'utf8'));
            const sourceManifest = JSON.parse(await readFile(path.join(desktopDir, 'dist', 'source-manifest.json'), 'utf8'));
            const archive = await readFile(path.join(desktopDir, 'dist', sourceManifest.archive));
            if (sourceManifest.commit !== buildInfo.commit || sourceManifest.version !== buildInfo.version) {
                errors.push('Source archive version or commit does not match the staged application build.');
            }
            if (createHash('sha256').update(archive).digest('hex') !== sourceManifest.sha256) {
                errors.push('Source archive SHA-256 does not match its manifest.');
            }
        } catch (error) {
            errors.push(`Matching release source archive is missing or invalid: ${error.message}`);
        }
    }

    for (const message of warnings) console.warn(`::warning::Distribution compliance: ${message}`);
    for (const message of errors) console.error(`::error::Distribution compliance: ${message}`);
    if (releaseMode && (unknownLicenses.length || missingLicenseTexts.length || missingElectronNotices.length)) {
        errors.push(`Release blocked: ${unknownLicenses.length} unknown package licenses, ${missingLicenseTexts.length} missing package license texts, and ${missingElectronNotices.length} missing Electron notices.`);
    }
    if (!releaseMode) {
        console.log(`Development package audit: ${errors.length ? 'FAILED' : 'WARNINGS/READY'}; formal release gate remains strict.`);
    }
    if (errors.length) process.exitCode = 1;
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
