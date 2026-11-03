import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import log from '../lib/log';

import extensionLibraryContent, {
    galleryError,
    galleryLoading,
    galleryMore
} from '../lib/libraries/extensions/index.jsx';
import extensionTags from '../lib/libraries/tw-extension-tags';
import {
    EXTENSION_GALLERY_SOURCE_STORAGE_KEY,
    getExtensionAssetURL,
    getExtensionGallerySource,
    getExtensionGallerySources,
    getExtensionResourceURL,
    identifyExtensionSource,
    NH_TOYO_DEV_EXTENSION_SOURCE_ID,
    ORIGINAL_EXTENSION_SOURCE_ID
} from '../lib/extension-gallery-sources';

import LibraryComponent from '../components/library/library.jsx';
import extensionIcon from '../components/action-menu/icon--sprite.svg';
import styles from './extension-library.css';

const messages = defineMessages({
    extensionTitle: {
        defaultMessage: 'Choose an Extension',
        description: 'Heading for the extension library',
        id: 'gui.extensionLibrary.chooseAnExtension'
    },
    source: {
        defaultMessage: 'Source',
        description: 'Label for the extension gallery source selector',
        id: 'gui.extensionLibrary.source'
    },
    sourceOriginal: {
        defaultMessage: 'CrispStrobe official',
        description: 'Official CrispStrobe extension gallery source',
        id: 'gui.extensionLibrary.source.original'
    },
    sourceNHtoyo: {
        defaultMessage: 'NHtoyo development (localhost:8000)',
        description: 'Local NHtoyo extension gallery source for development',
        id: 'gui.extensionLibrary.source.nhtoyo'
    },
    localExtensionMarker: {
        defaultMessage: '{name} · NHtoyo development',
        description:
            'Marks an extension provided by the NHtoyo development gallery',
        id: 'gui.extensionLibrary.source.localExtensionMarker'
    },
    buildId: {
        defaultMessage: 'Development build: {buildId}',
        description: 'Cache-busting development build identifier',
        id: 'gui.extensionLibrary.source.buildId'
    },
    loaded: {
        defaultMessage: 'Loaded implementations: {implementations}',
        description:
            'Identifies extension implementations currently loaded in the VM',
        id: 'gui.extensionLibrary.source.loaded'
    },
    noneLoaded: {
        defaultMessage: 'none',
        description: 'No external extensions have been loaded',
        id: 'gui.extensionLibrary.source.noneLoaded'
    },
    sourceConflict: {
        defaultMessage:
            '“{extensionId}” is loaded from {loaded}; selected source is {requested}. Reload to switch.',
        description:
            'Explains that an extension ID is already loaded from a different source',
        id: 'gui.extensionLibrary.source.conflict'
    },
    sourceConflictUnknown: {
        defaultMessage:
            'The source for loaded “{extensionId}” is unknown. Reload before choosing {requested}.',
        description:
            'Explains that the source of an already loaded extension is unknown',
        id: 'gui.extensionLibrary.source.conflictUnknown'
    }
});

const DEVELOPMENT_MODE = process.env.NODE_ENV === 'development';
const DEVELOPMENT_BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36)
    .slice(2, 8)}`;

const getStoredSourceId = sources => {
    try {
        const stored = localStorage.getItem(
            EXTENSION_GALLERY_SOURCE_STORAGE_KEY
        );
        return sources.some(source => source.id === stored) ?
            stored :
            sources[0].id;
    } catch (error) {
        return sources[0].id;
    }
};

const getLoadedExtensionURLs = vm => {
    const getExtensionURLs = vm.extensionManager.getExtensionURLs;
    return typeof getExtensionURLs === 'function' ?
        getExtensionURLs.call(vm.extensionManager) :
        {};
};

const fetchLibrary = async source => {
    const res = source.isDevelopment ?
        await fetch(source.metadataURL, {cache: 'no-store'}) :
        await fetch(source.metadataURL);
    if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
    }
    const data = await res.json();
    return data.extensions.map(extension => ({
        name: extension.name,
        nameTranslations: extension.nameTranslations || {},
        description: extension.description,
        descriptionTranslations: extension.descriptionTranslations || {},
        extensionId: extension.id,
        extensionURL: getExtensionAssetURL(source, `${extension.slug}.js`),
        extensionSourceId: source.id,
        iconURL: getExtensionResourceURL(
            source,
            extension.image || 'images/unknown.svg'
        ),
        tags: ['tw'],
        credits: [...(extension.original || []), ...(extension.by || [])].map(
            credit => {
                if (credit.link) {
                    return (
                        <a
                            href={credit.link}
                            target="_blank"
                            rel="noreferrer"
                            key={credit.name}
                        >
                            {credit.name}
                        </a>
                    );
                }
                return credit.name;
            }
        ),
        docsURI: extension.docs ?
            getExtensionResourceURL(source, extension.slug) :
            null,
        samples: extension.samples ?
            extension.samples.map(sample => {
                const sampleURL = getExtensionResourceURL(
                    source,
                    `samples/${sample}.sb3`
                );
                return {
                    href: `${process.env.ROOT}editor?project_url=${encodeURIComponent(sampleURL)}`,
                    text: sample
                };
            }) :
            null,
        incompatibleWithScratch: !extension.scratchCompatible,
        featured: true
    }));
};

const toLibraryItem = extension => {
    if (typeof extension === 'object') {
        return {
            rawURL: extension.iconURL || extensionIcon,
            ...extension
        };
    }
    return extension;
};

const translateGalleryItem = (extension, locale, intl) => {
    const name = extension.nameTranslations[locale] || extension.name;
    const description =
        extension.descriptionTranslations[locale] || extension.description;
    return {
        ...extension,
        name:
            extension.extensionSourceId === NH_TOYO_DEV_EXTENSION_SOURCE_ID ?
                intl.formatMessage(messages.localExtensionMarker, {name}) :
                name,
        description
    };
};

class ExtensionLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect',
            'handleSourceChange',
            'fetchSelectedGallery'
        ]);
        const sources = getExtensionGallerySources(
            DEVELOPMENT_MODE,
            DEVELOPMENT_BUILD_ID
        );
        this.sources = sources;
        this.state = {
            gallery: null,
            gallerySourceId: null,
            galleryError: null,
            galleryTimedOut: false,
            sourceId: getStoredSourceId(sources)
        };
        this.galleryRequestId = 0;
    }
    componentDidMount () {
        this.fetchSelectedGallery();
    }
    componentWillUnmount () {
        this.galleryRequestId++;
    }
    getSourceLabel (sourceId) {
        if (sourceId === ORIGINAL_EXTENSION_SOURCE_ID) {
            return this.props.intl.formatMessage(messages.sourceOriginal);
        }
        if (sourceId === NH_TOYO_DEV_EXTENSION_SOURCE_ID) {
            return this.props.intl.formatMessage(messages.sourceNHtoyo);
        }
        return sourceId;
    }
    getImplementationLabel (implementation) {
        if (implementation.id === 'unknown') return implementation.label;
        const sourceLabel = this.getSourceLabel(implementation.id);
        const buildId = implementation.id === NH_TOYO_DEV_EXTENSION_SOURCE_ID ?
            `${implementation.buildId || 'build ID unavailable'}; ` :
            '';
        return `${sourceLabel} (${buildId}${implementation.assetPath})`;
    }
    fetchSelectedGallery () {
        const requestId = ++this.galleryRequestId;
        const source = getExtensionGallerySource(
            this.sources,
            this.state.sourceId
        );
        this.setState({
            gallery: null,
            gallerySourceId: null,
            galleryError: null,
            galleryTimedOut: false
        });

        const timeout = setTimeout(() => {
            if (requestId === this.galleryRequestId) {
                this.setState({galleryTimedOut: true});
            }
        }, 750);

        fetchLibrary(source)
            .then(gallery => {
                if (requestId !== this.galleryRequestId) return;
                this.setState({gallery, gallerySourceId: source.id});
                clearTimeout(timeout);
            })
            .catch(error => {
                if (requestId !== this.galleryRequestId) return;
                log.error(error);
                this.setState({galleryError: error});
                clearTimeout(timeout);
            });
    }
    handleSourceChange (event) {
        const sourceId = event.target.value;
        this.setState({sourceId}, () => {
            try {
                localStorage.setItem(
                    EXTENSION_GALLERY_SOURCE_STORAGE_KEY,
                    sourceId
                );
            } catch (error) {
                log.warn(
                    'Could not persist extension gallery source selection',
                    error
                );
            }
            this.fetchSelectedGallery();
        });
    }
    handleItemSelect (item) {
        if (item.href) {
            return;
        }

        const extensionId = item.extensionId;

        if (extensionId === 'custom_extension') {
            this.props.onOpenCustomExtensionModal();
            return;
        }

        if (extensionId === 'procedures_enable_return') {
            this.props.onEnableProcedureReturns();
            this.props.onCategorySelected('myBlocks');
            return;
        }

        const url = item.extensionURL ? item.extensionURL : extensionId;
        if (item.disabled) return;

        if (this.props.vm.extensionManager.isExtensionLoaded(extensionId)) {
            if (item.extensionURL) {
                const loadedURL = getLoadedExtensionURLs(this.props.vm)[extensionId];
                if (!loadedURL) {
                    // eslint-disable-next-line no-alert
                    alert(
                        this.props.intl.formatMessage(
                            messages.sourceConflictUnknown,
                            {
                                extensionId,
                                requested: this.getSourceLabel(
                                    item.extensionSourceId
                                )
                            }
                        )
                    );
                    return;
                }
                if (loadedURL !== url) {
                    const loaded = identifyExtensionSource(loadedURL);
                    const loadedLabel = this.getImplementationLabel(loaded);
                    // eslint-disable-next-line no-alert
                    alert(
                        this.props.intl.formatMessage(messages.sourceConflict, {
                            extensionId,
                            loaded: loadedLabel,
                            requested: this.getSourceLabel(
                                item.extensionSourceId
                            )
                        })
                    );
                    return;
                }
            }
            this.props.onCategorySelected(extensionId);
        } else {
            this.props.vm.extensionManager
                .loadExtensionURL(url)
                .then(() => {
                    this.props.onCategorySelected(extensionId);
                })
                .catch(err => {
                    log.error(err);
                    // eslint-disable-next-line no-alert
                    alert(err);
                });
        }
    }
    render () {
        let library = null;
        if (
            this.state.gallery ||
            this.state.galleryError ||
            this.state.galleryTimedOut
        ) {
            library = extensionLibraryContent.map(toLibraryItem);
            library.push('---');
            if (
                this.state.gallery &&
                this.state.gallerySourceId === this.state.sourceId
            ) {
                library.push(toLibraryItem(galleryMore));
                const locale = this.props.intl.locale;
                library.push(
                    ...this.state.gallery
                        .filter(i => i.extensionId !== 'faceSensing')
                        .map(i =>
                            translateGalleryItem(i, locale, this.props.intl)
                        )
                        .map(toLibraryItem)
                );
            } else if (this.state.galleryError) {
                library.push(toLibraryItem(galleryError));
            } else {
                library.push(toLibraryItem(galleryLoading));
            }
        }

        const selectedSource = getExtensionGallerySource(
            this.sources,
            this.state.sourceId
        );
        const implementationList = Object.entries(
            getLoadedExtensionURLs(this.props.vm)
        ).map(([id, url]) => {
            const implementation = identifyExtensionSource(url);
            const label = this.getImplementationLabel(implementation);
            return `${id}: ${label}`;
        });
        const filterBarContent = (
            <div className={styles.extensionGallerySource}>
                <label htmlFor="extension-gallery-source">
                    {this.props.intl.formatMessage(messages.source)}
                </label>
                <select
                    id="extension-gallery-source"
                    value={this.state.sourceId}
                    onChange={this.handleSourceChange}
                >
                    {this.sources.map(source => (
                        <option
                            key={source.id}
                            value={source.id}
                        >
                            {this.getSourceLabel(source.id)}
                        </option>
                    ))}
                </select>
                {selectedSource.isDevelopment && (
                    <span className={styles.extensionGalleryBuildId}>
                        {this.props.intl.formatMessage(messages.buildId, {
                            buildId: DEVELOPMENT_BUILD_ID
                        })}
                    </span>
                )}
                <span
                    className={styles.extensionGalleryLoaded}
                    title={implementationList.join('\n')}
                >
                    {this.props.intl.formatMessage(messages.loaded, {
                        implementations: implementationList.length ?
                            implementationList.join('; ') :
                            this.props.intl.formatMessage(
                                messages.noneLoaded
                            )
                    })}
                </span>
            </div>
        );

        return (
            <LibraryComponent
                data={library}
                filterable
                filterBarContent={DEVELOPMENT_MODE ? filterBarContent : null}
                persistableKey="extensionId"
                id="extensionLibrary"
                tags={extensionTags}
                title={this.props.intl.formatMessage(messages.extensionTitle)}
                visible={this.props.visible}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

ExtensionLibrary.propTypes = {
    intl: intlShape.isRequired,
    onCategorySelected: PropTypes.func,
    onEnableProcedureReturns: PropTypes.func,
    onOpenCustomExtensionModal: PropTypes.func,
    onRequestClose: PropTypes.func,
    visible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired // eslint-disable-line react/no-unused-prop-types
};

export default injectIntl(ExtensionLibrary);
