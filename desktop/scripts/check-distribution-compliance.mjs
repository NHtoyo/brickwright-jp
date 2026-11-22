import {access, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
        path.join(desktopDir, 'compliance', 'assets-rights.json')
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
    const brandReviewStatus = assets.brandReview && assets.brandReview.status;
    const invalidAssets = (assets.assets || []).filter(asset => !['VERIFIED', 'UNVERIFIED', 'EXCLUDED'].includes(asset.rightsStatus));
    if (invalidAssets.length) errors.push(`${invalidAssets.length} media entries have an invalid rights status.`);
    if (unverifiedAssets.length) warnings.push(`${unverifiedAssets.length} media entries remain UNVERIFIED.`);

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
    if (releaseMode && (unverifiedAssets.length || unknownLicenses.length || missingLicenseTexts.length || missingElectronNotices.length || brandReviewStatus !== 'VERIFIED')) {
        errors.push(`Formal release blocked: ${unverifiedAssets.length} unverified media rights, ${unknownLicenses.length} unknown package licenses, ${missingLicenseTexts.length} missing package license texts, ${missingElectronNotices.length} missing Electron notices, and app-icon brand review is ${brandReviewStatus || 'missing'}.`);
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
