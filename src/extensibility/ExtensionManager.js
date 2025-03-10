/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*jslint regexp: true */
/*global path, logger*/
/*unittests: ExtensionManager*/

/**
 * The ExtensionManager fetches/caches the extension registry and provides
 * information about the status of installed extensions. ExtensionManager raises the
 * following events:
 * - statusChange - indicates that an extension has been installed/uninstalled or
 *   its status has otherwise changed. Second parameter is the id of the
 *   extension.
 * - registryUpdate - indicates that an existing extension was synchronized
 *   with new data from the registry.
 */
define(function (require, exports, module) {


    const _                   = require("thirdparty/lodash"),
        EventDispatcher     = require("utils/EventDispatcher"),
        Package             = require("extensibility/Package"),
        AppInit             = require("utils/AppInit"),
        Async               = require("utils/Async"),
        ExtensionLoader     = require("utils/ExtensionLoader"),
        ExtensionUtils      = require("utils/ExtensionUtils"),
        FileSystem          = require("filesystem/FileSystem"),
        FileUtils           = require("file/FileUtils"),
        PreferencesManager  = require("preferences/PreferencesManager"),
        Strings             = require("strings"),
        StringUtils         = require("utils/StringUtils"),
        ThemeManager        = require("view/ThemeManager"),
        TaskManager    = require("features/TaskManager"),
        Metrics = require("utils/Metrics");

    const EXTENSION_REGISTRY_LOCAL_STORAGE_KEY = Phoenix.isTestWindow ?
            "test_extension_registry" : "extension_registry",
        EXTENSION_REGISTRY_LOCAL_STORAGE_VERSION_KEY = Phoenix.isTestWindow ?
            "test_extension_registry_version" : "extension_registry_version";

    // earlier, we used to cache the full uncompressed registry in ls which has a usual size limit of 5mb, and the
    // registry takes a few MB. So we moved this storage and this will clear local storage on any existing installs on
    // next update. This migration code can be removed after July 2025(6 Months).
    localStorage.removeItem(EXTENSION_REGISTRY_LOCAL_STORAGE_KEY);

    const REGISTRY_CACHE_FILE = Phoenix.isTestWindow ?
        "test_registry_cache.json" : "registry_cache.json";
    const REGISTRY_CACHE_PATH = path.normalize(
        Phoenix.app.getExtensionsDirectory() + "/" + REGISTRY_CACHE_FILE);
    function _getCachedRegistry() {
        // never rejects
        return new Promise((resolve) => {
            const registryFile = FileSystem.getFileForPath(REGISTRY_CACHE_PATH);
            FileUtils.readAsText(registryFile, true)
                .done(resolve)
                .fail(function (err) {
                    console.error(`Registry cache not found ${REGISTRY_CACHE_PATH}`, err);
                    resolve(null);
                });
        });
    }

    function _putCachedRegistry(registryFileText) {
        // never rejects
        return new Promise((resolve) => {
            const registryFile = FileSystem.getFileForPath(REGISTRY_CACHE_PATH);
            FileUtils.writeText(registryFile, registryFileText, true)
                .done(resolve)
                .fail(function (err) {
                    logger.reportError(err, `Registry cache write error ${REGISTRY_CACHE_PATH}`);
                    resolve();
                });
        });
    }

    function _removeCachedRegistry() {
        const registryFile = FileSystem.getFileForPath(REGISTRY_CACHE_PATH);
        return registryFile.unlinkAsync();
    }

    // semver.browser is an AMD-compatible module
    var semver = require("thirdparty/semver.browser");

    /**
     * @private
     * @type {$.Deferred} Keeps track of the current registry download so that if a request is already
     * in progress and another request to download the registry comes in, we don't send yet another request.
     * This is primarily used when multiple view models need to download the registry at the same time.
     */
    var pendingDownloadRegistry = null;

    /**
     * Extension status constants.
     */
    var ENABLED      = "enabled",
        DISABLED     = "disabled",
        START_FAILED = "startFailed";

    /**
     * Extension location constants.
     */
    var LOCATION_DEFAULT = "default",
        LOCATION_DEV     = "dev",
        LOCATION_USER    = "user",
        LOCATION_UNKNOWN = "unknown";

    /**
     * Extension auto-install folder. Also used for preferences key.
     */
    var FOLDER_AUTOINSTALL = "auto-install-extensions";

    /**
     * @private
     * @type {Object.<string, {metadata: Object, path: string, status: string}>}
     * The set of all known extensions, both from the registry and locally installed.
     * The keys are either "name" from package.json (for extensions that have package metadata)
     * or the last segment of local file paths (for installed legacy extensions
     * with no package metadata). The fields of each record are:
     *     registryInfo: object containing the info for this id from the main registry (containing metadata, owner,
     *         and versions). This will be null for legacy extensions.
     *     installInfo: object containing the info for a locally-installed extension:
     *         metadata: the package metadata loaded from the local package.json, or null if it's a legacy extension.
     *             This will be different from registryInfo.metadata if there's a newer version in the registry.
     *         path: the local path to the extension folder on disk
     *         locationType: general type of installation; one of the LOCATION_* constants above
     *         status: the current status, one of the status constants above
     */
    var extensions = {};

    /**
     * Requested changes to the installed extensions.
     */
    var _idsToRemove = {},
        _idsToUpdate = {},
        _idsToDisable = {};

    PreferencesManager.stateManager.definePreference(FOLDER_AUTOINSTALL, "object", undefined);
    PreferencesManager.definePreference("extensions.sort", "string", "totalDownloads", {
        description: Strings.SORT_EXTENSION_METHOD
    });

    /**
     * @private
     * Synchronizes the information between the public registry and the installed
     * extensions. Specifically, this makes the `owner` available in each and sets
     * an `updateAvailable` flag.
     *
     * @param {string} id of the extension to synchronize
     */
    function synchronizeEntry(id) {
        var entry = extensions[id];

        // Do nothing if we only have one set of data
        if (!entry || !entry.installInfo || !entry.registryInfo) {
            return;
        }

        entry.installInfo.owner = entry.registryInfo.owner;

        // Assume false
        entry.installInfo.updateAvailable   = false;
        entry.registryInfo.updateAvailable  = false;
        entry.installInfo.updateCompatible  = false;
        entry.registryInfo.updateCompatible = false;

        var currentVersion = entry.installInfo.metadata ? entry.installInfo.metadata.version : null;
        if (currentVersion && semver.lt(currentVersion, entry.registryInfo.metadata.version)) {
            // Note: available update may still be incompatible; we check for this when rendering the Update button in ExtensionManagerView._renderItem()
            entry.registryInfo.updateAvailable  = true;
            entry.installInfo.updateAvailable   = true;
            // Calculate updateCompatible to check if there's an update for current version of Brackets
            var lastCompatibleVersionInfo = _.findLast(entry.registryInfo.versions, function (versionInfo) {
                return !versionInfo.brackets || semver.satisfies(brackets.metadata.apiVersion, versionInfo.brackets);
            });
            if (lastCompatibleVersionInfo && lastCompatibleVersionInfo.version && semver.lt(currentVersion, lastCompatibleVersionInfo.version)) {
                entry.installInfo.updateCompatible        = true;
                entry.registryInfo.updateCompatible       = true;
                entry.installInfo.lastCompatibleVersion   = lastCompatibleVersionInfo.version;
                entry.registryInfo.lastCompatibleVersion  = lastCompatibleVersionInfo.version;
            }
        }

        exports.trigger("registryUpdate", id);
    }


    /**
     * @private
     * Verifies if an extension is a theme based on the presence of the field "theme"
     * in the package.json.  If it is a theme, then the theme file is just loaded by the
     * ThemeManager
     *
     * @param {string} id of the theme extension to load
     */
    function loadTheme(id) {
        var extension = extensions[id];
        if (extension.installInfo && extension.installInfo.metadata && extension.installInfo.metadata.theme) {
            ThemeManager.loadPackage(extension.installInfo);
        }
    }


    /**
     * @private
     * Sets our data. For unit testing only.
     */
    function _setExtensions(newExtensions) {
        exports.extensions = extensions = newExtensions;
        Object.keys(extensions).forEach(function (id) {
            synchronizeEntry(id);
        });
    }

    /**
     * @private
     * Clears out our existing data. For unit testing only.
     */
    function _reset() {
        exports.extensions = extensions = {};
        _idsToRemove = {};
        _idsToUpdate = {};
        _idsToDisable = {};
    }

    function _populateExtensions(registry) {
        Object.keys(registry).forEach(function (id) {
            if (!extensions[id]) {
                extensions[id] = {};
            }
            extensions[id].registryInfo = registry[id];
            synchronizeEntry(id);
        });
        exports.trigger("registryDownload");
    }

    function _shouldUpdateExtensionRegistry() {
        return new Promise((resolve, reject)=>{
            const currentRegistryVersion = localStorage.getItem(EXTENSION_REGISTRY_LOCAL_STORAGE_VERSION_KEY) || "1";
            Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "registryVersion",
                `${currentRegistryVersion}`);
            $.ajax({
                url: brackets.config.extension_registry_version,
                dataType: "json",
                cache: false
            })
                .done(function (registryVersion) {
                    if(registryVersion.version !== parseInt(currentRegistryVersion)){
                        resolve(registryVersion.version);
                    } else {
                        _getCachedRegistry() // never rejects
                            .then(registryJson => {
                                if(!registryJson) {
                                    resolve(registryVersion.version);
                                    // if we dont have anything, best to atlest try to fetch the registry now.
                                    return;
                                }
                                reject();
                            });
                    }
                })
                .fail(function (err) {
                    console.error("error Fetching Extension Registry version", err);
                    _getCachedRegistry() // never rejects
                        .then(registryJson => {
                            if(!registryJson) {
                                resolve(1); // if we dont have anything, best to atlest try to fetch the registry now.
                                return;
                            }
                            reject();
                        });
                });
        });
    }

    async function _patchDownloadCounts() {
        let registryJson = await _getCachedRegistry();
        if(!registryJson){
            return;
        }
        $.ajax({
            url: brackets.config.extension_registry_popularity,
            dataType: "json",
            cache: false
        }).done(async function (popularity) {
            registryJson = await _getCachedRegistry();
            let registry = JSON.parse(registryJson);
            for(let key of Object.keys(popularity)){
                if(registry[key]) {
                    registry[key].totalDownloads = popularity[key].totalDownloads || registry[key].totalDownloads
                        || null; // null to not show the section if the counts are 0 or not present
                    registry[key].gihubStars = popularity[key].gihubStars || registry[key].gihubStars
                        || null;
                }
            }
            _putCachedRegistry(JSON.stringify(registry));
        });
    }

    /**
     * Filters out extensions that needs node in the browser from being listed.
     *
     * @param {Object} registry - The registry object to filter
     * @return {Object} - The filtered registry object
     * @private
     */
    function _filterIncompatibleEntries(registry) {
        let filteredRegistry = {};
        for(let registryKey of Object.keys(registry)){
            const registryEntry = registry[registryKey];
            let nodeNeeded = false;
            if(registryEntry.metadata && registryEntry.metadata.nodeConfig &&
                registryEntry.metadata.nodeConfig.nodeIsRequired) {
                nodeNeeded = true;
            }
            if(nodeNeeded && !Phoenix.isNativeApp) {
                continue;
            }
            filteredRegistry[registryKey] = registryEntry;
        }
        return filteredRegistry;
    }

    function _getTaskManager() {
        if(Phoenix.isTestWindow){
            return {
                close: ()=>{}
            };
        }
        return TaskManager.addNewTask(Strings.EXTENSIONS_REGISTRY_TASK_TITLE,
            Strings.EXTENSIONS_REGISTRY_TASK_MESSAGE,
            `<i class="fa-solid fa-list"></i>`);
    }

    /**
     * Downloads the registry of Brackets extensions and stores the information in our
     * extension info.
     *
     * @param {boolean} [force] - true to fetch registry from server fresh every time
     * @return {$.Promise} a promise that's resolved with the registry JSON data
     * or rejected if the server can't be reached.
     */
    function downloadRegistry(force) {
        if (pendingDownloadRegistry) {
            return pendingDownloadRegistry.promise();
        }

        pendingDownloadRegistry = new $.Deferred();

        function _updateRegistry(newVersion) {
            console.log("downloading extension registry: ", newVersion, brackets.config.extension_registry);
            const downloadTask = _getTaskManager();
            $.ajax({
                url: brackets.config.extension_registry,
                dataType: "json",
                cache: false
            })
                .done(function (registry) {
                    registry = _filterIncompatibleEntries(registry);
                    localStorage.setItem(EXTENSION_REGISTRY_LOCAL_STORAGE_VERSION_KEY, newVersion);
                    _putCachedRegistry(JSON.stringify(registry)).then(()=>{
                        if(!pendingDownloadRegistry.alreadyResolvedFromCache){
                            _populateExtensions(registry);
                            pendingDownloadRegistry.resolve();
                            pendingDownloadRegistry.alreadyResolvedFromCache = true;
                        }
                    }).finally(()=>{
                        pendingDownloadRegistry = null;
                        downloadTask.close();
                    });
                })
                .fail(function (err) {
                    downloadTask.close();
                    console.error("error Fetching Extension Registry", err);
                    if(!pendingDownloadRegistry.alreadyResolvedFromCache){
                        pendingDownloadRegistry.reject();
                    }
                    pendingDownloadRegistry = null;
                });
        }

        if(force){
            _updateRegistry();
            return pendingDownloadRegistry.promise();
        }

        async function _getLocalRegistry() {
            // the extension registry is like 1.5MB. A local copy is packaged in the src/extensions/registry/ folder
            // so that on first launch, the user can see the extension manager instantly(though outdated).
            // The local registry is created at build time and will get outdated if the user uses an old installer.
            // but it will get updated when the user clicks on extension manager.
            try {
                const response = await fetch("extensions/registry/registry.json");
                if (response.ok) {
                    return await response.json();
                } else {
                    console.error(`Failed to fetch local registry: ${response.status} ${response.statusText}`);
                    return null;
                }
            } catch (error) {
                console.error(`Error fetching local registry: ${error.message}`);
                return null;
            }
        }

        _getCachedRegistry() // never rejects
            .then(registryJson => {
                if(registryJson) {
                    // we always immediately but after the promise chain is setup after function return (some bug sigh)
                    // resolve for ui responsiveness and then check for updates.
                    console.log("Using cached extension registry");
                    setTimeout(()=>{
                        Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "registry", "cachedUse");
                        let registry = JSON.parse(registryJson);
                        registry = _filterIncompatibleEntries(registry);
                        _populateExtensions(registry);
                        pendingDownloadRegistry.resolve();
                    }, 0);
                    pendingDownloadRegistry.alreadyResolvedFromCache = true;
                } else {
                    _getLocalRegistry().then(localRegistry => {
                        if(!localRegistry ||
                            !pendingDownloadRegistry || pendingDownloadRegistry.alreadyResolvedFromCache) {
                            return;
                        }
                        console.log("Using outdated local extension registry as no cached registry found.");
                        Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "registry", "outdatedUse");
                        localRegistry = _filterIncompatibleEntries(localRegistry);
                        _populateExtensions(localRegistry);
                        pendingDownloadRegistry.resolve();
                        pendingDownloadRegistry.alreadyResolvedFromCache = true;
                    });
                }
                // check for latest updates even if we have cache
                _shouldUpdateExtensionRegistry()
                    .then(_updateRegistry)
                    .catch(()=>{
                        console.log("Registry update skipped");
                    });
                _patchDownloadCounts();
            });

        return pendingDownloadRegistry.promise();
    }


    /**
     * @private
     * When an extension is loaded, fetches the package.json and stores the extension in our map.
     * @param {$.Event} e The event object
     * @param {string} baseURL The http base url from which the extension is loaded
     */
    function _handleExtensionLoad(e, baseURL) {
        function setData(metadata) {
            let locationType,
                id = metadata.name,
                userExtensionPath = ExtensionLoader.getUserExtensionPath(),
                path = baseURL;
            if(Phoenix.VFS.getPathForVirtualServingURL(baseURL)){
                path = Phoenix.VFS.getPathForVirtualServingURL(baseURL);
            }
            metadata.title = metadata.title || metadata.name;
            if (path.indexOf(userExtensionPath) === 0) {
                locationType = LOCATION_USER;
            } else {
                var segments = path.split("/"), parent;
                if (segments.length > 2) {
                    parent = segments[segments.length - 2];
                }
                if (parent === "dev") {
                    locationType = LOCATION_DEV;
                } else if (parent === "default") {
                    locationType = LOCATION_DEFAULT;
                } else if (parent === "user") {
                    locationType = LOCATION_USER;
                } else {
                    locationType = LOCATION_UNKNOWN;
                }
            }
            if (!extensions[id]) {
                extensions[id] = {};
            }
            extensions[id].installInfo = {
                metadata: metadata,
                path: baseURL,
                locationType: locationType,
                status: (e.type === "loadFailed" ? START_FAILED : (e.type === "disabled" ? DISABLED : ENABLED))
            };

            synchronizeEntry(id);
            loadTheme(id);
            exports.trigger("statusChange", id);
        }

        function deduceMetadata() {
            const match = baseURL.match(/\/([^\/]+)$/),
                name = (match && match[1]) || baseURL,
                metadata = { name: name, title: name };
            return metadata;
        }

        ExtensionUtils.loadMetadata(baseURL)
            .done(function (metadata) {
                setData(metadata);
            })
            .fail(function (disabled) {
                // If there's no package.json, this is a legacy extension. It was successfully loaded,
                // but we don't have an official ID or metadata for it, so we just create an id and
                // "title" for it (which is the last segment of its pathname)
                // and record that it's enabled.
                var metadata = deduceMetadata();
                metadata.disabled = disabled;
                setData(metadata);
            });
    }

    /**
     * Determines if the given versions[] entry is compatible with the given Brackets API version, and if not
     * specifies why.
     * @param {Object} extVersion
     * @param {string} apiVersion
     * @return {{isCompatible: boolean, requiresNewer: ?boolean, compatibleVersion: ?string}}
     */
    function getCompatibilityInfoForVersion(extVersion, apiVersion) {
        var requiredVersion = (extVersion.brackets || (extVersion.engines && extVersion.engines.brackets)),
            result = {};
        result.isCompatible = !requiredVersion || semver.satisfies(apiVersion, requiredVersion);
        if (result.isCompatible) {
            result.compatibleVersion = extVersion.version;
        } else {
            // Find out reason for incompatibility
            if (requiredVersion.charAt(0) === '<') {
                result.requiresNewer = false;
            } else if (requiredVersion.charAt(0) === '>') {
                result.requiresNewer = true;
            } else if (requiredVersion.charAt(0) === "~") {
                var compareVersion = requiredVersion.slice(1);
                // Need to add .0s to this style of range in order to compare (since valid version
                // numbers must have major/minor/patch).
                if (compareVersion.match(/^[0-9]+$/)) {
                    compareVersion += ".0.0";
                } else if (compareVersion.match(/^[0-9]+\.[0-9]+$/)) {
                    compareVersion += ".0";
                }
                result.requiresNewer = semver.lt(apiVersion, compareVersion);
            }
        }
        return result;
    }

    /**
     * Finds the newest version of the entry that is compatible with the given Brackets API version, if any.
     * @param {Object} entry The registry entry to check.
     * @param {string} apiVersion The Brackets API version to check against.
     * @return {{isCompatible: boolean, requiresNewer: ?boolean, compatibleVersion: ?string, isLatestVersion: boolean}}
     *      Result contains an "isCompatible" member saying whether it's compatible. If compatible, "compatibleVersion"
     *      specifies the newest version that is compatible and "isLatestVersion" indicates if this is the absolute
     *      latest version of the extension or not. If !isCompatible or !isLatestVersion, "requiresNewer" says whether
     *      the latest version is incompatible due to requiring a newer (vs. older) version of Brackets.
     */
    function getCompatibilityInfo(entry, apiVersion) {
        if (!entry.versions) {
            var fallback = getCompatibilityInfoForVersion(entry.metadata, apiVersion);
            if (fallback.isCompatible) {
                fallback.isLatestVersion = true;
            }
            return fallback;
        }

        var i = entry.versions.length - 1,
            latestInfo = getCompatibilityInfoForVersion(entry.versions[i], apiVersion);

        if (latestInfo.isCompatible) {
            latestInfo.isLatestVersion = true;
            return latestInfo;
        }
            // Look at earlier versions (skipping very latest version since we already checked it)
        for (i--; i >= 0; i--) {
            var compatInfo = getCompatibilityInfoForVersion(entry.versions[i], apiVersion);
            if (compatInfo.isCompatible) {
                compatInfo.isLatestVersion = false;
                compatInfo.requiresNewer = latestInfo.requiresNewer;
                return compatInfo;
            }
        }

            // No version is compatible, so just return info for the latest version
        return latestInfo;

    }

    /**
     * Given an extension id and version number, returns the URL for downloading that extension from
     * the repository. Does not guarantee that the extension exists at that URL.
     * @param {string} id The extension's name from the metadata.
     * @param {string} version The version to download.
     * @return {string} The URL to download the extension from.
     */
    function getExtensionURL(id, version) {
        return `${brackets.config.extension_url}${id}-${version}.zip`;
    }

    /**
     * Removes the installed extension with the given id.
     * @param {string} id The id of the extension to remove.
     * @return {$.Promise} A promise that's resolved when the extension is removed or
     *     rejected with an error if there's a problem with the removal.
     */
    function remove(id) {
        var result = new $.Deferred();
        if (extensions[id] && extensions[id].installInfo) {
            Package.remove(extensions[id].installInfo.path)
                .done(function () {
                    extensions[id].installInfo = null;
                    result.resolve();
                    exports.trigger("statusChange", id);
                })
                .fail(function (err) {
                    result.reject(err);
                });
        } else {
            result.reject(StringUtils.format(Strings.EXTENSION_NOT_INSTALLED, id));
        }
        return result.promise();
    }

    /**
     * @private
     *
     * Disables or enables the installed extensions.
     *
     * @param {string} id The id of the extension to disable or enable.
     * @param {boolean} enable A boolean indicating whether to enable or disable.
     * @return {$.Promise} A promise that's resolved when the extension action is
     *      completed or rejected with an error that prevents the action from completion.
     */
    function _enableOrDisable(id, enable) {
        var result = new $.Deferred(),
            extension = extensions[id];
        if (extension && extension.installInfo) {
            Package[(enable ? "enable" : "disable")](extension.installInfo.path)
                .done(function () {
                    extension.installInfo.status = enable ? ENABLED : DISABLED;
                    extension.installInfo.metadata.disabled = !enable;
                    result.resolve();
                    exports.trigger("statusChange", id);
                })
                .fail(function (err) {
                    result.reject(err);
                });
        } else {
            result.reject(StringUtils.format(Strings.EXTENSION_NOT_INSTALLED, id));
        }
        return result.promise();
    }

    /**
     * Disables the installed extension with the given id.
     *
     * @param {string} id The id of the extension to disable.
     * @return {$.Promise} A promise that's resolved when the extenion is disabled or
     *      rejected with an error that prevented the disabling.
     */
    function disable(id) {
        return _enableOrDisable(id, false);
    }

    /**
     * Enables the installed extension with the given id.
     *
     * @param {string} id The id of the extension to enable.
     * @return {$.Promise} A promise that's resolved when the extenion is enabled or
     *      rejected with an error that prevented the enabling.
     */
    function enable(id) {
        return _enableOrDisable(id, true);
    }

    /**
     * Updates an installed extension with the given package file.
     * @param {string} id of the extension
     * @param {string} packagePath path to the package file
     * @param {boolean=} keepFile Flag to keep extension package file, default=false
     * @return {$.Promise} A promise that's resolved when the extension is updated or
     *     rejected with an error if there's a problem with the update.
     */
    function update(id, packagePath, keepFile) {
        return Package.installUpdate(packagePath, id).done(function () {
            if (!keepFile) {
                FileSystem.getFileForPath(packagePath).unlink();
            }
        });
    }

    /**
     * Deletes any temporary files left behind by extensions that
     * were marked for update.
     */
    function cleanupUpdates() {
        Object.keys(_idsToUpdate).forEach(function (id) {
            var installResult = _idsToUpdate[id],
                keepFile = installResult.keepFile,
                filename = installResult.localPath;

            if (filename && !keepFile) {
                FileSystem.getFileForPath(filename).unlink();
            }
        });
        _idsToUpdate = {};
    }

    /**
     * Unmarks all extensions marked for removal.
     */
    function unmarkAllForRemoval() {
        _idsToRemove = {};
    }

    /**
     * Marks an extension for later removal, or unmarks an extension previously marked.
     * @param {string} id The id of the extension to mark for removal.
     * @param {boolean} mark Whether to mark or unmark it.
     */
    function markForRemoval(id, mark) {
        if (mark) {
            _idsToRemove[id] = true;
        } else {
            delete _idsToRemove[id];
        }
        exports.trigger("statusChange", id);
    }

    /**
     * Returns true if an extension is marked for removal.
     * @param {string} id The id of the extension to check.
     * @return {boolean} true if it's been marked for removal, false otherwise.
     */
    function isMarkedForRemoval(id) {
        return !!(_idsToRemove[id]);
    }

    /**
     * Returns true if there are any extensions marked for removal.
     * @return {boolean} true if there are extensions to remove
     */
    function hasExtensionsToRemove() {
        return Object.keys(_idsToRemove).length > 0;
    }

    /**
     * Marks an extension for disabling later, or unmarks an extension previously marked.
     *
     * @param {string} id The id of the extension
     * @param {boolean} mark Whether to mark or unmark the extension.
     */
    function markForDisabling(id, mark) {
        if (mark) {
            _idsToDisable[id] = true;
        } else {
            delete _idsToDisable[id];
        }
        exports.trigger("statusChange", id);
    }

    /**
     * Returns true if an extension is mark for disabling.
     *
     * @param {string} id The id of the extension to check.
     * @return {boolean} true if it's been mark for disabling, false otherwise.
     */
    function isMarkedForDisabling(id) {
        return !!(_idsToDisable[id]);
    }

    /**
     * Returns true if there are any extensions marked for disabling.
     * @return {boolean} true if there are extensions to disable
     */
    function hasExtensionsToDisable() {
        return Object.keys(_idsToDisable).length > 0;
    }

    /**
     * Unmarks all the extensions that have been marked for disabling.
     */
    function unmarkAllForDisabling() {
        _idsToDisable = {};
    }

    /**
     * If a downloaded package appears to be an update, mark the extension for update.
     * If an extension was previously marked for removal, marking for update will
     * turn off the removal mark.
     * @param {Object} installationResult info about the install provided by the Package.download function
     */
    function updateFromDownload(installationResult) {
        if (installationResult.keepFile === undefined) {
            installationResult.keepFile = false;
        }

        var installationStatus = installationResult.installationStatus;
        if (installationStatus === Package.InstallationStatuses.ALREADY_INSTALLED ||
                installationStatus === Package.InstallationStatuses.NEEDS_UPDATE ||
                installationStatus === Package.InstallationStatuses.SAME_VERSION ||
                installationStatus === Package.InstallationStatuses.OLDER_VERSION) {
            var id = installationResult.name;
            delete _idsToRemove[id];
            _idsToUpdate[id] = installationResult;
            exports.trigger("statusChange", id);
        }
    }

    /**
     * Removes the mark for an extension to be updated on restart. Also deletes the
     * downloaded package file.
     * @param {string} id The id of the extension for which the update is being removed
     */
    function removeUpdate(id) {
        var installationResult = _idsToUpdate[id];
        if (!installationResult) {
            return;
        }
        if (installationResult.localPath && !installationResult.keepFile) {
            FileSystem.getFileForPath(installationResult.localPath).unlink();
        }
        delete _idsToUpdate[id];
        exports.trigger("statusChange", id);
    }

    /**
     * Returns true if an extension is marked for update.
     * @param {string} id The id of the extension to check.
     * @return {boolean} true if it's been marked for update, false otherwise.
     */
    function isMarkedForUpdate(id) {
        return !!(_idsToUpdate[id]);
    }

    /**
     * Returns true if there are any extensions marked for update.
     * @return {boolean} true if there are extensions to update
     */
    function hasExtensionsToUpdate() {
        return Object.keys(_idsToUpdate).length > 0;
    }

    /**
     * Removes extensions previously marked for removal.
     * @return {$.Promise} A promise that's resolved when all extensions are removed, or rejected
     *     if one or more extensions can't be removed. When rejected, the argument will be an
     *     array of error objects, each of which contains an "item" property with the id of the
     *     failed extension and an "error" property with the actual error.
     */
    function removeMarkedExtensions() {
        return Async.doInParallel_aggregateErrors(
            Object.keys(_idsToRemove),
            function (id) {
                return remove(id);
            }
        );
    }

    /**
     * Disables extensions marked for disabling.
     *
     * If the return promise is rejected, the argument will contain an array of objects. Each
     * element is an object identifying the extension failed with "item" property set to the
     * extension id which has failed to be disabled and "error" property set to the error.
     *
     * @return {$.Promise} A promise that's resolved when all extensions marked for disabling are
     *      disabled or rejected if one or more extensions can't be disabled.
     */
    function disableMarkedExtensions() {
        return Async.doInParallel_aggregateErrors(
            Object.keys(_idsToDisable),
            function (id) {
                return disable(id);
            }
        );
    }

    /**
     * Updates extensions previously marked for update.
     * @return {$.Promise} A promise that's resolved when all extensions are updated, or rejected
     *     if one or more extensions can't be updated. When rejected, the argument will be an
     *     array of error objects, each of which contains an "item" property with the id of the
     *     failed extension and an "error" property with the actual error.
     */
    function updateExtensions() {
        return Async.doInParallel_aggregateErrors(
            Object.keys(_idsToUpdate),
            function (id) {
                var installationResult = _idsToUpdate[id];
                return update(installationResult.name, installationResult.localPath, installationResult.keepFile);
            }
        );
    }

    /**
     * Gets an array of extensions that are currently installed and can be updated to a new version
     * @return {Array.<{id: string, installVersion: string, registryVersion: string}>}
     *     where id = extensionId
     *     installVersion = currently installed version of extension
     *     registryVersion = latest version compatible with current Brackets
     */
    function getAvailableUpdates() {
        var result = [];
        Object.keys(extensions).forEach(function (extensionId) {
            var extensionInfo = extensions[extensionId];
            // skip extensions that are not installed or are not in the registry
            if (!extensionInfo.installInfo || !extensionInfo.registryInfo) {
                return;
            }
            if (extensionInfo.registryInfo.updateCompatible) {
                result.push({
                    id: extensionId,
                    installVersion: extensionInfo.installInfo.metadata.version,
                    registryVersion: extensionInfo.registryInfo.lastCompatibleVersion
                });
            }
        });
        return result;
    }

    /**
     * Takes the array returned from getAvailableUpdates() as an input and removes those entries
     * that are no longer current - when currently installed version of an extension
     * is equal or newer than registryVersion returned by getAvailableUpdates().
     * This function is designed to work without the necessity to download extension registry
     * @param {Array.<{id: string, installVersion: string, registryVersion: string}>} updates
     *     previous output of getAvailableUpdates()
     * @return {Array.<{id: string, installVersion: string, registryVersion: string}>}
     *     filtered input as function description
     */
    function cleanAvailableUpdates(updates) {
        return updates.reduce(function (arr, updateInfo) {
            var extDefinition = extensions[updateInfo.id];
            if (!extDefinition || !extDefinition.installInfo) {
                // extension has been uninstalled in the meantime
                return arr;
            }

            var installedVersion = extDefinition.installInfo.metadata.version;
            if (semver.lt(installedVersion, updateInfo.registryVersion)) {
                arr.push(updateInfo);
            }

            return arr;
        }, []);
    }

    AppInit.appReady(function () {
    });

    // Listen to extension load and loadFailed events
    ExtensionLoader
        .on(ExtensionLoader.EVENT_EXTENSION_LOADED, _handleExtensionLoad)
        .on(ExtensionLoader.EVENT_EXTENSION_LOAD_FAILED, _handleExtensionLoad)
        .on(ExtensionLoader.EVENT_EXTENSION_DISABLED, _handleExtensionLoad);


    EventDispatcher.makeEventDispatcher(exports);

    // Public exports
    exports.downloadRegistry        = downloadRegistry;
    exports.getCompatibilityInfo    = getCompatibilityInfo;
    exports.getExtensionURL         = getExtensionURL;
    exports.remove                  = remove;
    exports.update                  = update;
    exports.disable                 = disable;
    exports.enable                  = enable;
    exports.extensions              = extensions;
    exports.cleanupUpdates          = cleanupUpdates;
    exports.markForRemoval          = markForRemoval;
    exports.isMarkedForRemoval      = isMarkedForRemoval;
    exports.unmarkAllForRemoval     = unmarkAllForRemoval;
    exports.hasExtensionsToRemove   = hasExtensionsToRemove;
    exports.markForDisabling        = markForDisabling;
    exports.isMarkedForDisabling    = isMarkedForDisabling;
    exports.unmarkAllForDisabling   = unmarkAllForDisabling;
    exports.hasExtensionsToDisable  = hasExtensionsToDisable;
    exports.updateFromDownload      = updateFromDownload;
    exports.removeUpdate            = removeUpdate;
    exports.isMarkedForUpdate       = isMarkedForUpdate;
    exports.hasExtensionsToUpdate   = hasExtensionsToUpdate;
    exports.removeMarkedExtensions  = removeMarkedExtensions;
    exports.disableMarkedExtensions = disableMarkedExtensions;
    exports.updateExtensions        = updateExtensions;
    exports.getAvailableUpdates     = getAvailableUpdates;
    exports.cleanAvailableUpdates   = cleanAvailableUpdates;

    exports.ENABLED       = ENABLED;
    exports.DISABLED      = DISABLED;
    exports.START_FAILED  = START_FAILED;

    exports.LOCATION_DEFAULT  = LOCATION_DEFAULT;
    exports.LOCATION_DEV      = LOCATION_DEV;
    exports.LOCATION_USER     = LOCATION_USER;
    exports.LOCATION_UNKNOWN  = LOCATION_UNKNOWN;

    // For unit testing only
    exports._reset                  = _reset;
    exports._setExtensions          = _setExtensions;
    if(Phoenix.isTestWindow){
        exports._getCachedRegistry = _getCachedRegistry;
        exports._putCachedRegistry = _putCachedRegistry;
        exports._removeCachedRegistry = _removeCachedRegistry;
    }
});
