/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.15 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.15',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite an existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; i < ary.length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i == 1 && ary[2] === '..') || ary[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI, normalizedBaseParts,
                baseParts = (baseName && baseName.split('/')),
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // If wanting node ID compatibility, strip .js from end
                // of IDs. Have to do this here, and not in nameToUrl
                // because node allows either .js or non .js to map
                // to same file.
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                // Starts with a '.' so need the baseName
                if (name[0].charAt(0) === '.' && baseParts) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = normalizedBaseParts.concat(name);
                }

                trimDots(name);
                name = name.join('/');
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);

                //Custom require that does not do map translation, since
                //ID is "absolute", already mapped/resolved.
                context.makeRequire(null, {
                    skipMap: true
                })([id]);

                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        // If nested plugin references, then do not try to
                        // normalize, as it will not normalize correctly. This
                        // places a restriction on resourceIds, and the longer
                        // term solution is not to normalize until plugins are
                        // loaded and all normalizations to allow for async
                        // loading of a loader plugin. But for now, fixes the
                        // common uses. Details in #1131
                        normalizedName = name.indexOf('!') === -1 ?
                                         normalize(name, parentName, applyMap) :
                                         name;
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return  getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if(args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

/*
 AngularJS v1.3.9
 (c) 2010-2014 Google, Inc. http://angularjs.org
 License: MIT
*/
(function(M,Y,t){function T(b){return function(){var a=arguments[0],c;c="["+(b?b+":":"")+a+"] http://errors.angularjs.org/1.3.9/"+(b?b+"/":"")+a;for(a=1;a<arguments.length;a++){c=c+(1==a?"?":"&")+"p"+(a-1)+"=";var d=encodeURIComponent,e;e=arguments[a];e="function"==typeof e?e.toString().replace(/ \{[\s\S]*$/,""):"undefined"==typeof e?"undefined":"string"!=typeof e?JSON.stringify(e):e;c+=d(e)}return Error(c)}}function Ta(b){if(null==b||Ua(b))return!1;var a=b.length;return b.nodeType===
oa&&a?!0:F(b)||D(b)||0===a||"number"===typeof a&&0<a&&a-1 in b}function s(b,a,c){var d,e;if(b)if(G(b))for(d in b)"prototype"==d||"length"==d||"name"==d||b.hasOwnProperty&&!b.hasOwnProperty(d)||a.call(c,b[d],d,b);else if(D(b)||Ta(b)){var f="object"!==typeof b;d=0;for(e=b.length;d<e;d++)(f||d in b)&&a.call(c,b[d],d,b)}else if(b.forEach&&b.forEach!==s)b.forEach(a,c,b);else for(d in b)b.hasOwnProperty(d)&&a.call(c,b[d],d,b);return b}function Ed(b,a,c){for(var d=Object.keys(b).sort(),e=0;e<d.length;e++)a.call(c,
b[d[e]],d[e]);return d}function kc(b){return function(a,c){b(c,a)}}function Fd(){return++nb}function lc(b,a){a?b.$$hashKey=a:delete b.$$hashKey}function z(b){for(var a=b.$$hashKey,c=1,d=arguments.length;c<d;c++){var e=arguments[c];if(e)for(var f=Object.keys(e),g=0,h=f.length;g<h;g++){var l=f[g];b[l]=e[l]}}lc(b,a);return b}function ba(b){return parseInt(b,10)}function H(){}function pa(b){return b}function da(b){return function(){return b}}function A(b){return"undefined"===typeof b}function y(b){return"undefined"!==
typeof b}function I(b){return null!==b&&"object"===typeof b}function F(b){return"string"===typeof b}function V(b){return"number"===typeof b}function qa(b){return"[object Date]"===Da.call(b)}function G(b){return"function"===typeof b}function ob(b){return"[object RegExp]"===Da.call(b)}function Ua(b){return b&&b.window===b}function Va(b){return b&&b.$evalAsync&&b.$watch}function Wa(b){return"boolean"===typeof b}function mc(b){return!(!b||!(b.nodeName||b.prop&&b.attr&&b.find))}function Gd(b){var a={};
b=b.split(",");var c;for(c=0;c<b.length;c++)a[b[c]]=!0;return a}function ua(b){return Q(b.nodeName||b[0]&&b[0].nodeName)}function Xa(b,a){var c=b.indexOf(a);0<=c&&b.splice(c,1);return a}function Ea(b,a,c,d){if(Ua(b)||Va(b))throw Ka("cpws");if(a){if(b===a)throw Ka("cpi");c=c||[];d=d||[];if(I(b)){var e=c.indexOf(b);if(-1!==e)return d[e];c.push(b);d.push(a)}if(D(b))for(var f=a.length=0;f<b.length;f++)e=Ea(b[f],null,c,d),I(b[f])&&(c.push(b[f]),d.push(e)),a.push(e);else{var g=a.$$hashKey;D(a)?a.length=
0:s(a,function(b,c){delete a[c]});for(f in b)b.hasOwnProperty(f)&&(e=Ea(b[f],null,c,d),I(b[f])&&(c.push(b[f]),d.push(e)),a[f]=e);lc(a,g)}}else if(a=b)D(b)?a=Ea(b,[],c,d):qa(b)?a=new Date(b.getTime()):ob(b)?(a=new RegExp(b.source,b.toString().match(/[^\/]*$/)[0]),a.lastIndex=b.lastIndex):I(b)&&(e=Object.create(Object.getPrototypeOf(b)),a=Ea(b,e,c,d));return a}function ra(b,a){if(D(b)){a=a||[];for(var c=0,d=b.length;c<d;c++)a[c]=b[c]}else if(I(b))for(c in a=a||{},b)if("$"!==c.charAt(0)||"$"!==c.charAt(1))a[c]=
b[c];return a||b}function fa(b,a){if(b===a)return!0;if(null===b||null===a)return!1;if(b!==b&&a!==a)return!0;var c=typeof b,d;if(c==typeof a&&"object"==c)if(D(b)){if(!D(a))return!1;if((c=b.length)==a.length){for(d=0;d<c;d++)if(!fa(b[d],a[d]))return!1;return!0}}else{if(qa(b))return qa(a)?fa(b.getTime(),a.getTime()):!1;if(ob(b)&&ob(a))return b.toString()==a.toString();if(Va(b)||Va(a)||Ua(b)||Ua(a)||D(a))return!1;c={};for(d in b)if("$"!==d.charAt(0)&&!G(b[d])){if(!fa(b[d],a[d]))return!1;c[d]=!0}for(d in a)if(!c.hasOwnProperty(d)&&
"$"!==d.charAt(0)&&a[d]!==t&&!G(a[d]))return!1;return!0}return!1}function Ya(b,a,c){return b.concat(Za.call(a,c))}function nc(b,a){var c=2<arguments.length?Za.call(arguments,2):[];return!G(a)||a instanceof RegExp?a:c.length?function(){return arguments.length?a.apply(b,Ya(c,arguments,0)):a.apply(b,c)}:function(){return arguments.length?a.apply(b,arguments):a.call(b)}}function Hd(b,a){var c=a;"string"===typeof b&&"$"===b.charAt(0)&&"$"===b.charAt(1)?c=t:Ua(a)?c="$WINDOW":a&&Y===a?c="$DOCUMENT":Va(a)&&
(c="$SCOPE");return c}function $a(b,a){if("undefined"===typeof b)return t;V(a)||(a=a?2:null);return JSON.stringify(b,Hd,a)}function oc(b){return F(b)?JSON.parse(b):b}function va(b){b=B(b).clone();try{b.empty()}catch(a){}var c=B("<div>").append(b).html();try{return b[0].nodeType===pb?Q(c):c.match(/^(<[^>]+>)/)[1].replace(/^<([\w\-]+)/,function(a,b){return"<"+Q(b)})}catch(d){return Q(c)}}function pc(b){try{return decodeURIComponent(b)}catch(a){}}function qc(b){var a={},c,d;s((b||"").split("&"),function(b){b&&
(c=b.replace(/\+/g,"%20").split("="),d=pc(c[0]),y(d)&&(b=y(c[1])?pc(c[1]):!0,rc.call(a,d)?D(a[d])?a[d].push(b):a[d]=[a[d],b]:a[d]=b))});return a}function Nb(b){var a=[];s(b,function(b,d){D(b)?s(b,function(b){a.push(Fa(d,!0)+(!0===b?"":"="+Fa(b,!0)))}):a.push(Fa(d,!0)+(!0===b?"":"="+Fa(b,!0)))});return a.length?a.join("&"):""}function qb(b){return Fa(b,!0).replace(/%26/gi,"&").replace(/%3D/gi,"=").replace(/%2B/gi,"+")}function Fa(b,a){return encodeURIComponent(b).replace(/%40/gi,"@").replace(/%3A/gi,
":").replace(/%24/g,"$").replace(/%2C/gi,",").replace(/%3B/gi,";").replace(/%20/g,a?"%20":"+")}function Id(b,a){var c,d,e=rb.length;b=B(b);for(d=0;d<e;++d)if(c=rb[d]+a,F(c=b.attr(c)))return c;return null}function Jd(b,a){var c,d,e={};s(rb,function(a){a+="app";!c&&b.hasAttribute&&b.hasAttribute(a)&&(c=b,d=b.getAttribute(a))});s(rb,function(a){a+="app";var e;!c&&(e=b.querySelector("["+a.replace(":","\\:")+"]"))&&(c=e,d=e.getAttribute(a))});c&&(e.strictDi=null!==Id(c,"strict-di"),a(c,d?[d]:[],e))}function sc(b,
a,c){I(c)||(c={});c=z({strictDi:!1},c);var d=function(){b=B(b);if(b.injector()){var d=b[0]===Y?"document":va(b);throw Ka("btstrpd",d.replace(/</,"&lt;").replace(/>/,"&gt;"));}a=a||[];a.unshift(["$provide",function(a){a.value("$rootElement",b)}]);c.debugInfoEnabled&&a.push(["$compileProvider",function(a){a.debugInfoEnabled(!0)}]);a.unshift("ng");d=Ob(a,c.strictDi);d.invoke(["$rootScope","$rootElement","$compile","$injector",function(a,b,c,d){a.$apply(function(){b.data("$injector",d);c(b)(a)})}]);return d},
e=/^NG_ENABLE_DEBUG_INFO!/,f=/^NG_DEFER_BOOTSTRAP!/;M&&e.test(M.name)&&(c.debugInfoEnabled=!0,M.name=M.name.replace(e,""));if(M&&!f.test(M.name))return d();M.name=M.name.replace(f,"");ga.resumeBootstrap=function(b){s(b,function(b){a.push(b)});d()}}function Kd(){M.name="NG_ENABLE_DEBUG_INFO!"+M.name;M.location.reload()}function Ld(b){b=ga.element(b).injector();if(!b)throw Ka("test");return b.get("$$testability")}function tc(b,a){a=a||"_";return b.replace(Md,function(b,d){return(d?a:"")+b.toLowerCase()})}
function Nd(){var b;uc||((sa=M.jQuery)&&sa.fn.on?(B=sa,z(sa.fn,{scope:La.scope,isolateScope:La.isolateScope,controller:La.controller,injector:La.injector,inheritedData:La.inheritedData}),b=sa.cleanData,sa.cleanData=function(a){var c;if(Pb)Pb=!1;else for(var d=0,e;null!=(e=a[d]);d++)(c=sa._data(e,"events"))&&c.$destroy&&sa(e).triggerHandler("$destroy");b(a)}):B=R,ga.element=B,uc=!0)}function Qb(b,a,c){if(!b)throw Ka("areq",a||"?",c||"required");return b}function sb(b,a,c){c&&D(b)&&(b=b[b.length-1]);
Qb(G(b),a,"not a function, got "+(b&&"object"===typeof b?b.constructor.name||"Object":typeof b));return b}function Ma(b,a){if("hasOwnProperty"===b)throw Ka("badname",a);}function vc(b,a,c){if(!a)return b;a=a.split(".");for(var d,e=b,f=a.length,g=0;g<f;g++)d=a[g],b&&(b=(e=b)[d]);return!c&&G(b)?nc(e,b):b}function tb(b){var a=b[0];b=b[b.length-1];var c=[a];do{a=a.nextSibling;if(!a)break;c.push(a)}while(a!==b);return B(c)}function ha(){return Object.create(null)}function Od(b){function a(a,b,c){return a[b]||
(a[b]=c())}var c=T("$injector"),d=T("ng");b=a(b,"angular",Object);b.$$minErr=b.$$minErr||T;return a(b,"module",function(){var b={};return function(f,g,h){if("hasOwnProperty"===f)throw d("badname","module");g&&b.hasOwnProperty(f)&&(b[f]=null);return a(b,f,function(){function a(c,d,e,f){f||(f=b);return function(){f[e||"push"]([c,d,arguments]);return u}}if(!g)throw c("nomod",f);var b=[],d=[],e=[],q=a("$injector","invoke","push",d),u={_invokeQueue:b,_configBlocks:d,_runBlocks:e,requires:g,name:f,provider:a("$provide",
"provider"),factory:a("$provide","factory"),service:a("$provide","service"),value:a("$provide","value"),constant:a("$provide","constant","unshift"),animation:a("$animateProvider","register"),filter:a("$filterProvider","register"),controller:a("$controllerProvider","register"),directive:a("$compileProvider","directive"),config:q,run:function(a){e.push(a);return this}};h&&q(h);return u})}})}function Pd(b){z(b,{bootstrap:sc,copy:Ea,extend:z,equals:fa,element:B,forEach:s,injector:Ob,noop:H,bind:nc,toJson:$a,
fromJson:oc,identity:pa,isUndefined:A,isDefined:y,isString:F,isFunction:G,isObject:I,isNumber:V,isElement:mc,isArray:D,version:Qd,isDate:qa,lowercase:Q,uppercase:ub,callbacks:{counter:0},getTestability:Ld,$$minErr:T,$$csp:ab,reloadWithDebugInfo:Kd});bb=Od(M);try{bb("ngLocale")}catch(a){bb("ngLocale",[]).provider("$locale",Rd)}bb("ng",["ngLocale"],["$provide",function(a){a.provider({$$sanitizeUri:Sd});a.provider("$compile",wc).directive({a:Td,input:xc,textarea:xc,form:Ud,script:Vd,select:Wd,style:Xd,
option:Yd,ngBind:Zd,ngBindHtml:$d,ngBindTemplate:ae,ngClass:be,ngClassEven:ce,ngClassOdd:de,ngCloak:ee,ngController:fe,ngForm:ge,ngHide:he,ngIf:ie,ngInclude:je,ngInit:ke,ngNonBindable:le,ngPluralize:me,ngRepeat:ne,ngShow:oe,ngStyle:pe,ngSwitch:qe,ngSwitchWhen:re,ngSwitchDefault:se,ngOptions:te,ngTransclude:ue,ngModel:ve,ngList:we,ngChange:xe,pattern:yc,ngPattern:yc,required:zc,ngRequired:zc,minlength:Ac,ngMinlength:Ac,maxlength:Bc,ngMaxlength:Bc,ngValue:ye,ngModelOptions:ze}).directive({ngInclude:Ae}).directive(vb).directive(Cc);
a.provider({$anchorScroll:Be,$animate:Ce,$browser:De,$cacheFactory:Ee,$controller:Fe,$document:Ge,$exceptionHandler:He,$filter:Dc,$interpolate:Ie,$interval:Je,$http:Ke,$httpBackend:Le,$location:Me,$log:Ne,$parse:Oe,$rootScope:Pe,$q:Qe,$$q:Re,$sce:Se,$sceDelegate:Te,$sniffer:Ue,$templateCache:Ve,$templateRequest:We,$$testability:Xe,$timeout:Ye,$window:Ze,$$rAF:$e,$$asyncCallback:af,$$jqLite:bf})}])}function cb(b){return b.replace(cf,function(a,b,d,e){return e?d.toUpperCase():d}).replace(df,"Moz$1")}
function Ec(b){b=b.nodeType;return b===oa||!b||9===b}function Fc(b,a){var c,d,e=a.createDocumentFragment(),f=[];if(Rb.test(b)){c=c||e.appendChild(a.createElement("div"));d=(ef.exec(b)||["",""])[1].toLowerCase();d=ia[d]||ia._default;c.innerHTML=d[1]+b.replace(ff,"<$1></$2>")+d[2];for(d=d[0];d--;)c=c.lastChild;f=Ya(f,c.childNodes);c=e.firstChild;c.textContent=""}else f.push(a.createTextNode(b));e.textContent="";e.innerHTML="";s(f,function(a){e.appendChild(a)});return e}function R(b){if(b instanceof
R)return b;var a;F(b)&&(b=U(b),a=!0);if(!(this instanceof R)){if(a&&"<"!=b.charAt(0))throw Sb("nosel");return new R(b)}if(a){a=Y;var c;b=(c=gf.exec(b))?[a.createElement(c[1])]:(c=Fc(b,a))?c.childNodes:[]}Gc(this,b)}function Tb(b){return b.cloneNode(!0)}function wb(b,a){a||xb(b);if(b.querySelectorAll)for(var c=b.querySelectorAll("*"),d=0,e=c.length;d<e;d++)xb(c[d])}function Hc(b,a,c,d){if(y(d))throw Sb("offargs");var e=(d=yb(b))&&d.events,f=d&&d.handle;if(f)if(a)s(a.split(" "),function(a){if(y(c)){var d=
e[a];Xa(d||[],c);if(d&&0<d.length)return}b.removeEventListener(a,f,!1);delete e[a]});else for(a in e)"$destroy"!==a&&b.removeEventListener(a,f,!1),delete e[a]}function xb(b,a){var c=b.ng339,d=c&&zb[c];d&&(a?delete d.data[a]:(d.handle&&(d.events.$destroy&&d.handle({},"$destroy"),Hc(b)),delete zb[c],b.ng339=t))}function yb(b,a){var c=b.ng339,c=c&&zb[c];a&&!c&&(b.ng339=c=++hf,c=zb[c]={events:{},data:{},handle:t});return c}function Ub(b,a,c){if(Ec(b)){var d=y(c),e=!d&&a&&!I(a),f=!a;b=(b=yb(b,!e))&&b.data;
if(d)b[a]=c;else{if(f)return b;if(e)return b&&b[a];z(b,a)}}}function Ab(b,a){return b.getAttribute?-1<(" "+(b.getAttribute("class")||"")+" ").replace(/[\n\t]/g," ").indexOf(" "+a+" "):!1}function Bb(b,a){a&&b.setAttribute&&s(a.split(" "),function(a){b.setAttribute("class",U((" "+(b.getAttribute("class")||"")+" ").replace(/[\n\t]/g," ").replace(" "+U(a)+" "," ")))})}function Cb(b,a){if(a&&b.setAttribute){var c=(" "+(b.getAttribute("class")||"")+" ").replace(/[\n\t]/g," ");s(a.split(" "),function(a){a=
U(a);-1===c.indexOf(" "+a+" ")&&(c+=a+" ")});b.setAttribute("class",U(c))}}function Gc(b,a){if(a)if(a.nodeType)b[b.length++]=a;else{var c=a.length;if("number"===typeof c&&a.window!==a){if(c)for(var d=0;d<c;d++)b[b.length++]=a[d]}else b[b.length++]=a}}function Ic(b,a){return Db(b,"$"+(a||"ngController")+"Controller")}function Db(b,a,c){9==b.nodeType&&(b=b.documentElement);for(a=D(a)?a:[a];b;){for(var d=0,e=a.length;d<e;d++)if((c=B.data(b,a[d]))!==t)return c;b=b.parentNode||11===b.nodeType&&b.host}}
function Jc(b){for(wb(b,!0);b.firstChild;)b.removeChild(b.firstChild)}function Kc(b,a){a||wb(b);var c=b.parentNode;c&&c.removeChild(b)}function jf(b,a){a=a||M;if("complete"===a.document.readyState)a.setTimeout(b);else B(a).on("load",b)}function Lc(b,a){var c=Eb[a.toLowerCase()];return c&&Mc[ua(b)]&&c}function kf(b,a){var c=b.nodeName;return("INPUT"===c||"TEXTAREA"===c)&&Nc[a]}function lf(b,a){var c=function(c,e){c.isDefaultPrevented=function(){return c.defaultPrevented};var f=a[e||c.type],g=f?f.length:
0;if(g){if(A(c.immediatePropagationStopped)){var h=c.stopImmediatePropagation;c.stopImmediatePropagation=function(){c.immediatePropagationStopped=!0;c.stopPropagation&&c.stopPropagation();h&&h.call(c)}}c.isImmediatePropagationStopped=function(){return!0===c.immediatePropagationStopped};1<g&&(f=ra(f));for(var l=0;l<g;l++)c.isImmediatePropagationStopped()||f[l].call(b,c)}};c.elem=b;return c}function bf(){this.$get=function(){return z(R,{hasClass:function(b,a){b.attr&&(b=b[0]);return Ab(b,a)},addClass:function(b,
a){b.attr&&(b=b[0]);return Cb(b,a)},removeClass:function(b,a){b.attr&&(b=b[0]);return Bb(b,a)}})}}function Na(b,a){var c=b&&b.$$hashKey;if(c)return"function"===typeof c&&(c=b.$$hashKey()),c;c=typeof b;return c="function"==c||"object"==c&&null!==b?b.$$hashKey=c+":"+(a||Fd)():c+":"+b}function db(b,a){if(a){var c=0;this.nextUid=function(){return++c}}s(b,this.put,this)}function mf(b){return(b=b.toString().replace(Oc,"").match(Pc))?"function("+(b[1]||"").replace(/[\s\r\n]+/," ")+")":"fn"}function Vb(b,
a,c){var d;if("function"===typeof b){if(!(d=b.$inject)){d=[];if(b.length){if(a)throw F(c)&&c||(c=b.name||mf(b)),Ga("strictdi",c);a=b.toString().replace(Oc,"");a=a.match(Pc);s(a[1].split(nf),function(a){a.replace(of,function(a,b,c){d.push(c)})})}b.$inject=d}}else D(b)?(a=b.length-1,sb(b[a],"fn"),d=b.slice(0,a)):sb(b,"fn",!0);return d}function Ob(b,a){function c(a){return function(b,c){if(I(b))s(b,kc(a));else return a(b,c)}}function d(a,b){Ma(a,"service");if(G(b)||D(b))b=q.instantiate(b);if(!b.$get)throw Ga("pget",
a);return p[a+"Provider"]=b}function e(a,b){return function(){var c=r.invoke(b,this);if(A(c))throw Ga("undef",a);return c}}function f(a,b,c){return d(a,{$get:!1!==c?e(a,b):b})}function g(a){var b=[],c;s(a,function(a){function d(a){var b,c;b=0;for(c=a.length;b<c;b++){var e=a[b],f=q.get(e[0]);f[e[1]].apply(f,e[2])}}if(!m.get(a)){m.put(a,!0);try{F(a)?(c=bb(a),b=b.concat(g(c.requires)).concat(c._runBlocks),d(c._invokeQueue),d(c._configBlocks)):G(a)?b.push(q.invoke(a)):D(a)?b.push(q.invoke(a)):sb(a,"module")}catch(e){throw D(a)&&
(a=a[a.length-1]),e.message&&e.stack&&-1==e.stack.indexOf(e.message)&&(e=e.message+"\n"+e.stack),Ga("modulerr",a,e.stack||e.message||e);}}});return b}function h(b,c){function d(a,e){if(b.hasOwnProperty(a)){if(b[a]===l)throw Ga("cdep",a+" <- "+k.join(" <- "));return b[a]}try{return k.unshift(a),b[a]=l,b[a]=c(a,e)}catch(f){throw b[a]===l&&delete b[a],f;}finally{k.shift()}}function e(b,c,f,g){"string"===typeof f&&(g=f,f=null);var h=[],k=Vb(b,a,g),l,q,p;q=0;for(l=k.length;q<l;q++){p=k[q];if("string"!==
typeof p)throw Ga("itkn",p);h.push(f&&f.hasOwnProperty(p)?f[p]:d(p,g))}D(b)&&(b=b[l]);return b.apply(c,h)}return{invoke:e,instantiate:function(a,b,c){var d=Object.create((D(a)?a[a.length-1]:a).prototype);a=e(a,d,b,c);return I(a)||G(a)?a:d},get:d,annotate:Vb,has:function(a){return p.hasOwnProperty(a+"Provider")||b.hasOwnProperty(a)}}}a=!0===a;var l={},k=[],m=new db([],!0),p={$provide:{provider:c(d),factory:c(f),service:c(function(a,b){return f(a,["$injector",function(a){return a.instantiate(b)}])}),
value:c(function(a,b){return f(a,da(b),!1)}),constant:c(function(a,b){Ma(a,"constant");p[a]=b;u[a]=b}),decorator:function(a,b){var c=q.get(a+"Provider"),d=c.$get;c.$get=function(){var a=r.invoke(d,c);return r.invoke(b,null,{$delegate:a})}}}},q=p.$injector=h(p,function(a,b){ga.isString(b)&&k.push(b);throw Ga("unpr",k.join(" <- "));}),u={},r=u.$injector=h(u,function(a,b){var c=q.get(a+"Provider",b);return r.invoke(c.$get,c,t,a)});s(g(b),function(a){r.invoke(a||H)});return r}function Be(){var b=!0;this.disableAutoScrolling=
function(){b=!1};this.$get=["$window","$location","$rootScope",function(a,c,d){function e(a){var b=null;Array.prototype.some.call(a,function(a){if("a"===ua(a))return b=a,!0});return b}function f(b){if(b){b.scrollIntoView();var c;c=g.yOffset;G(c)?c=c():mc(c)?(c=c[0],c="fixed"!==a.getComputedStyle(c).position?0:c.getBoundingClientRect().bottom):V(c)||(c=0);c&&(b=b.getBoundingClientRect().top,a.scrollBy(0,b-c))}else a.scrollTo(0,0)}function g(){var a=c.hash(),b;a?(b=h.getElementById(a))?f(b):(b=e(h.getElementsByName(a)))?
f(b):"top"===a&&f(null):f(null)}var h=a.document;b&&d.$watch(function(){return c.hash()},function(a,b){a===b&&""===a||jf(function(){d.$evalAsync(g)})});return g}]}function af(){this.$get=["$$rAF","$timeout",function(b,a){return b.supported?function(a){return b(a)}:function(b){return a(b,0,!1)}}]}function pf(b,a,c,d){function e(a){try{a.apply(null,Za.call(arguments,1))}finally{if(v--,0===v)for(;w.length;)try{w.pop()()}catch(b){c.error(b)}}}function f(a,b){(function N(){s(L,function(a){a()});C=b(N,
a)})()}function g(){h();l()}function h(){x=b.history.state;x=A(x)?null:x;fa(x,J)&&(x=J);J=x}function l(){if(E!==m.url()||P!==x)E=m.url(),P=x,s(W,function(a){a(m.url(),x)})}function k(a){try{return decodeURIComponent(a)}catch(b){return a}}var m=this,p=a[0],q=b.location,u=b.history,r=b.setTimeout,O=b.clearTimeout,n={};m.isMock=!1;var v=0,w=[];m.$$completeOutstandingRequest=e;m.$$incOutstandingRequestCount=function(){v++};m.notifyWhenNoOutstandingRequests=function(a){s(L,function(a){a()});0===v?a():
w.push(a)};var L=[],C;m.addPollFn=function(a){A(C)&&f(100,r);L.push(a);return a};var x,P,E=q.href,S=a.find("base"),X=null;h();P=x;m.url=function(a,c,e){A(e)&&(e=null);q!==b.location&&(q=b.location);u!==b.history&&(u=b.history);if(a){var f=P===e;if(E===a&&(!d.history||f))return m;var g=E&&Ha(E)===Ha(a);E=a;P=e;!d.history||g&&f?(g||(X=a),c?q.replace(a):g?(c=q,e=a.indexOf("#"),a=-1===e?"":a.substr(e+1),c.hash=a):q.href=a):(u[c?"replaceState":"pushState"](e,"",a),h(),P=x);return m}return X||q.href.replace(/%27/g,
"'")};m.state=function(){return x};var W=[],wa=!1,J=null;m.onUrlChange=function(a){if(!wa){if(d.history)B(b).on("popstate",g);B(b).on("hashchange",g);wa=!0}W.push(a);return a};m.$$checkUrlChange=l;m.baseHref=function(){var a=S.attr("href");return a?a.replace(/^(https?\:)?\/\/[^\/]*/,""):""};var ea={},y="",ca=m.baseHref();m.cookies=function(a,b){var d,e,f,g;if(a)b===t?p.cookie=encodeURIComponent(a)+"=;path="+ca+";expires=Thu, 01 Jan 1970 00:00:00 GMT":F(b)&&(d=(p.cookie=encodeURIComponent(a)+"="+encodeURIComponent(b)+
";path="+ca).length+1,4096<d&&c.warn("Cookie '"+a+"' possibly not set or overflowed because it was too large ("+d+" > 4096 bytes)!"));else{if(p.cookie!==y)for(y=p.cookie,d=y.split("; "),ea={},f=0;f<d.length;f++)e=d[f],g=e.indexOf("="),0<g&&(a=k(e.substring(0,g)),ea[a]===t&&(ea[a]=k(e.substring(g+1))));return ea}};m.defer=function(a,b){var c;v++;c=r(function(){delete n[c];e(a)},b||0);n[c]=!0;return c};m.defer.cancel=function(a){return n[a]?(delete n[a],O(a),e(H),!0):!1}}function De(){this.$get=["$window",
"$log","$sniffer","$document",function(b,a,c,d){return new pf(b,d,a,c)}]}function Ee(){this.$get=function(){function b(b,d){function e(a){a!=p&&(q?q==a&&(q=a.n):q=a,f(a.n,a.p),f(a,p),p=a,p.n=null)}function f(a,b){a!=b&&(a&&(a.p=b),b&&(b.n=a))}if(b in a)throw T("$cacheFactory")("iid",b);var g=0,h=z({},d,{id:b}),l={},k=d&&d.capacity||Number.MAX_VALUE,m={},p=null,q=null;return a[b]={put:function(a,b){if(k<Number.MAX_VALUE){var c=m[a]||(m[a]={key:a});e(c)}if(!A(b))return a in l||g++,l[a]=b,g>k&&this.remove(q.key),
b},get:function(a){if(k<Number.MAX_VALUE){var b=m[a];if(!b)return;e(b)}return l[a]},remove:function(a){if(k<Number.MAX_VALUE){var b=m[a];if(!b)return;b==p&&(p=b.p);b==q&&(q=b.n);f(b.n,b.p);delete m[a]}delete l[a];g--},removeAll:function(){l={};g=0;m={};p=q=null},destroy:function(){m=h=l=null;delete a[b]},info:function(){return z({},h,{size:g})}}}var a={};b.info=function(){var b={};s(a,function(a,e){b[e]=a.info()});return b};b.get=function(b){return a[b]};return b}}function Ve(){this.$get=["$cacheFactory",
function(b){return b("templates")}]}function wc(b,a){function c(a,b){var c=/^\s*([@&]|=(\*?))(\??)\s*(\w*)\s*$/,d={};s(a,function(a,e){var f=a.match(c);if(!f)throw ja("iscp",b,e,a);d[e]={mode:f[1][0],collection:"*"===f[2],optional:"?"===f[3],attrName:f[4]||e}});return d}var d={},e=/^\s*directive\:\s*([\w\-]+)\s+(.*)$/,f=/(([\w\-]+)(?:\:([^;]+))?;?)/,g=Gd("ngSrc,ngSrcset,src,srcset"),h=/^(?:(\^\^?)?(\?)?(\^\^?)?)?/,l=/^(on[a-z]+|formaction)$/;this.directive=function p(a,e){Ma(a,"directive");F(a)?(Qb(e,
"directiveFactory"),d.hasOwnProperty(a)||(d[a]=[],b.factory(a+"Directive",["$injector","$exceptionHandler",function(b,e){var f=[];s(d[a],function(d,g){try{var h=b.invoke(d);G(h)?h={compile:da(h)}:!h.compile&&h.link&&(h.compile=da(h.link));h.priority=h.priority||0;h.index=g;h.name=h.name||a;h.require=h.require||h.controller&&h.name;h.restrict=h.restrict||"EA";I(h.scope)&&(h.$$isolateBindings=c(h.scope,h.name));f.push(h)}catch(l){e(l)}});return f}])),d[a].push(e)):s(a,kc(p));return this};this.aHrefSanitizationWhitelist=
function(b){return y(b)?(a.aHrefSanitizationWhitelist(b),this):a.aHrefSanitizationWhitelist()};this.imgSrcSanitizationWhitelist=function(b){return y(b)?(a.imgSrcSanitizationWhitelist(b),this):a.imgSrcSanitizationWhitelist()};var k=!0;this.debugInfoEnabled=function(a){return y(a)?(k=a,this):k};this.$get=["$injector","$interpolate","$exceptionHandler","$templateRequest","$parse","$controller","$rootScope","$document","$sce","$animate","$$sanitizeUri",function(a,b,c,r,O,n,v,w,L,C,x){function P(a,b){try{a.addClass(b)}catch(c){}}
function E(a,b,c,d,e){a instanceof B||(a=B(a));s(a,function(b,c){b.nodeType==pb&&b.nodeValue.match(/\S+/)&&(a[c]=B(b).wrap("<span></span>").parent()[0])});var f=S(a,b,a,c,d,e);E.$$addScopeClass(a);var g=null;return function(b,c,d){Qb(b,"scope");d=d||{};var e=d.parentBoundTranscludeFn,h=d.transcludeControllers;d=d.futureParentElement;e&&e.$$boundTransclude&&(e=e.$$boundTransclude);g||(g=(d=d&&d[0])?"foreignobject"!==ua(d)&&d.toString().match(/SVG/)?"svg":"html":"html");d="html"!==g?B(Wb(g,B("<div>").append(a).html())):
c?La.clone.call(a):a;if(h)for(var l in h)d.data("$"+l+"Controller",h[l].instance);E.$$addScopeInfo(d,b);c&&c(d,b);f&&f(b,d,d,e);return d}}function S(a,b,c,d,e,f){function g(a,c,d,e){var f,l,k,q,p,n,w;if(r)for(w=Array(c.length),q=0;q<h.length;q+=3)f=h[q],w[f]=c[f];else w=c;q=0;for(p=h.length;q<p;)l=w[h[q++]],c=h[q++],f=h[q++],c?(c.scope?(k=a.$new(),E.$$addScopeInfo(B(l),k)):k=a,n=c.transcludeOnThisElement?X(a,c.transclude,e,c.elementTranscludeOnThisElement):!c.templateOnThisElement&&e?e:!e&&b?X(a,
b):null,c(f,k,l,d,n)):f&&f(a,l.childNodes,t,e)}for(var h=[],l,k,q,p,r,n=0;n<a.length;n++){l=new Xb;k=W(a[n],[],l,0===n?d:t,e);(f=k.length?ea(k,a[n],l,b,c,null,[],[],f):null)&&f.scope&&E.$$addScopeClass(l.$$element);l=f&&f.terminal||!(q=a[n].childNodes)||!q.length?null:S(q,f?(f.transcludeOnThisElement||!f.templateOnThisElement)&&f.transclude:b);if(f||l)h.push(n,f,l),p=!0,r=r||f;f=null}return p?g:null}function X(a,b,c,d){return function(d,e,f,g,h){d||(d=a.$new(!1,h),d.$$transcluded=!0);return b(d,e,
{parentBoundTranscludeFn:c,transcludeControllers:f,futureParentElement:g})}}function W(a,b,c,d,g){var h=c.$attr,l;switch(a.nodeType){case oa:ca(b,ya(ua(a)),"E",d,g);for(var k,q,p,r=a.attributes,n=0,w=r&&r.length;n<w;n++){var O=!1,L=!1;k=r[n];l=k.name;q=U(k.value);k=ya(l);if(p=fb.test(k))l=l.replace(Rc,"").substr(8).replace(/_(.)/g,function(a,b){return b.toUpperCase()});var u=k.replace(/(Start|End)$/,"");A(u)&&k===u+"Start"&&(O=l,L=l.substr(0,l.length-5)+"end",l=l.substr(0,l.length-6));k=ya(l.toLowerCase());
h[k]=l;if(p||!c.hasOwnProperty(k))c[k]=q,Lc(a,k)&&(c[k]=!0);Pa(a,b,q,k,p);ca(b,k,"A",d,g,O,L)}a=a.className;if(F(a)&&""!==a)for(;l=f.exec(a);)k=ya(l[2]),ca(b,k,"C",d,g)&&(c[k]=U(l[3])),a=a.substr(l.index+l[0].length);break;case pb:M(b,a.nodeValue);break;case 8:try{if(l=e.exec(a.nodeValue))k=ya(l[1]),ca(b,k,"M",d,g)&&(c[k]=U(l[2]))}catch(v){}}b.sort(N);return b}function wa(a,b,c){var d=[],e=0;if(b&&a.hasAttribute&&a.hasAttribute(b)){do{if(!a)throw ja("uterdir",b,c);a.nodeType==oa&&(a.hasAttribute(b)&&
e++,a.hasAttribute(c)&&e--);d.push(a);a=a.nextSibling}while(0<e)}else d.push(a);return B(d)}function J(a,b,c){return function(d,e,f,g,h){e=wa(e[0],b,c);return a(d,e,f,g,h)}}function ea(a,d,e,f,g,l,k,p,r){function w(a,b,c,d){if(a){c&&(a=J(a,c,d));a.require=K.require;a.directiveName=z;if(S===K||K.$$isolateScope)a=Z(a,{isolateScope:!0});k.push(a)}if(b){c&&(b=J(b,c,d));b.require=K.require;b.directiveName=z;if(S===K||K.$$isolateScope)b=Z(b,{isolateScope:!0});p.push(b)}}function L(a,b,c,d){var e,f="data",
g=!1,l=c,k;if(F(b)){k=b.match(h);b=b.substring(k[0].length);k[3]&&(k[1]?k[3]=null:k[1]=k[3]);"^"===k[1]?f="inheritedData":"^^"===k[1]&&(f="inheritedData",l=c.parent());"?"===k[2]&&(g=!0);e=null;d&&"data"===f&&(e=d[b])&&(e=e.instance);e=e||l[f]("$"+b+"Controller");if(!e&&!g)throw ja("ctreq",b,a);return e||null}D(b)&&(e=[],s(b,function(b){e.push(L(a,b,c,d))}));return e}function v(a,c,f,g,h){function l(a,b,c){var d;Va(a)||(c=b,b=a,a=t);H&&(d=P);c||(c=H?W.parent():W);return h(a,b,d,c,wa)}var r,w,u,x,
P,eb,W,J;d===f?(J=e,W=e.$$element):(W=B(f),J=new Xb(W,e));S&&(x=c.$new(!0));h&&(eb=l,eb.$$boundTransclude=h);C&&(X={},P={},s(C,function(a){var b={$scope:a===S||a.$$isolateScope?x:c,$element:W,$attrs:J,$transclude:eb};u=a.controller;"@"==u&&(u=J[a.name]);b=n(u,b,!0,a.controllerAs);P[a.name]=b;H||W.data("$"+a.name+"Controller",b.instance);X[a.name]=b}));if(S){E.$$addScopeInfo(W,x,!0,!(ka&&(ka===S||ka===S.$$originalDirective)));E.$$addScopeClass(W,!0);g=X&&X[S.name];var xa=x;g&&g.identifier&&!0===S.bindToController&&
(xa=g.instance);s(x.$$isolateBindings=S.$$isolateBindings,function(a,d){var e=a.attrName,f=a.optional,g,h,l,k;switch(a.mode){case "@":J.$observe(e,function(a){xa[d]=a});J.$$observers[e].$$scope=c;J[e]&&(xa[d]=b(J[e])(c));break;case "=":if(f&&!J[e])break;h=O(J[e]);k=h.literal?fa:function(a,b){return a===b||a!==a&&b!==b};l=h.assign||function(){g=xa[d]=h(c);throw ja("nonassign",J[e],S.name);};g=xa[d]=h(c);f=function(a){k(a,xa[d])||(k(a,g)?l(c,a=xa[d]):xa[d]=a);return g=a};f.$stateful=!0;f=a.collection?
c.$watchCollection(J[e],f):c.$watch(O(J[e],f),null,h.literal);x.$on("$destroy",f);break;case "&":h=O(J[e]),xa[d]=function(a){return h(c,a)}}})}X&&(s(X,function(a){a()}),X=null);g=0;for(r=k.length;g<r;g++)w=k[g],$(w,w.isolateScope?x:c,W,J,w.require&&L(w.directiveName,w.require,W,P),eb);var wa=c;S&&(S.template||null===S.templateUrl)&&(wa=x);a&&a(wa,f.childNodes,t,h);for(g=p.length-1;0<=g;g--)w=p[g],$(w,w.isolateScope?x:c,W,J,w.require&&L(w.directiveName,w.require,W,P),eb)}r=r||{};for(var x=-Number.MAX_VALUE,
P,C=r.controllerDirectives,X,S=r.newIsolateScopeDirective,ka=r.templateDirective,ea=r.nonTlbTranscludeDirective,ca=!1,A=!1,H=r.hasElementTranscludeDirective,aa=e.$$element=B(d),K,z,N,Aa=f,Q,M=0,R=a.length;M<R;M++){K=a[M];var Pa=K.$$start,fb=K.$$end;Pa&&(aa=wa(d,Pa,fb));N=t;if(x>K.priority)break;if(N=K.scope)K.templateUrl||(I(N)?(Oa("new/isolated scope",S||P,K,aa),S=K):Oa("new/isolated scope",S,K,aa)),P=P||K;z=K.name;!K.templateUrl&&K.controller&&(N=K.controller,C=C||{},Oa("'"+z+"' controller",C[z],
K,aa),C[z]=K);if(N=K.transclude)ca=!0,K.$$tlb||(Oa("transclusion",ea,K,aa),ea=K),"element"==N?(H=!0,x=K.priority,N=aa,aa=e.$$element=B(Y.createComment(" "+z+": "+e[z]+" ")),d=aa[0],V(g,Za.call(N,0),d),Aa=E(N,f,x,l&&l.name,{nonTlbTranscludeDirective:ea})):(N=B(Tb(d)).contents(),aa.empty(),Aa=E(N,f));if(K.template)if(A=!0,Oa("template",ka,K,aa),ka=K,N=G(K.template)?K.template(aa,e):K.template,N=Sc(N),K.replace){l=K;N=Rb.test(N)?Tc(Wb(K.templateNamespace,U(N))):[];d=N[0];if(1!=N.length||d.nodeType!==
oa)throw ja("tplrt",z,"");V(g,aa,d);R={$attr:{}};N=W(d,[],R);var ba=a.splice(M+1,a.length-(M+1));S&&y(N);a=a.concat(N).concat(ba);Qc(e,R);R=a.length}else aa.html(N);if(K.templateUrl)A=!0,Oa("template",ka,K,aa),ka=K,K.replace&&(l=K),v=T(a.splice(M,a.length-M),aa,e,g,ca&&Aa,k,p,{controllerDirectives:C,newIsolateScopeDirective:S,templateDirective:ka,nonTlbTranscludeDirective:ea}),R=a.length;else if(K.compile)try{Q=K.compile(aa,e,Aa),G(Q)?w(null,Q,Pa,fb):Q&&w(Q.pre,Q.post,Pa,fb)}catch(qf){c(qf,va(aa))}K.terminal&&
(v.terminal=!0,x=Math.max(x,K.priority))}v.scope=P&&!0===P.scope;v.transcludeOnThisElement=ca;v.elementTranscludeOnThisElement=H;v.templateOnThisElement=A;v.transclude=Aa;r.hasElementTranscludeDirective=H;return v}function y(a){for(var b=0,c=a.length;b<c;b++){var d=b,e;e=z(Object.create(a[b]),{$$isolateScope:!0});a[d]=e}}function ca(b,e,f,g,h,l,k){if(e===h)return null;h=null;if(d.hasOwnProperty(e)){var q;e=a.get(e+"Directive");for(var r=0,n=e.length;r<n;r++)try{if(q=e[r],(g===t||g>q.priority)&&-1!=
q.restrict.indexOf(f)){if(l){var w={$$start:l,$$end:k};q=z(Object.create(q),w)}b.push(q);h=q}}catch(O){c(O)}}return h}function A(b){if(d.hasOwnProperty(b))for(var c=a.get(b+"Directive"),e=0,f=c.length;e<f;e++)if(b=c[e],b.multiElement)return!0;return!1}function Qc(a,b){var c=b.$attr,d=a.$attr,e=a.$$element;s(a,function(d,e){"$"!=e.charAt(0)&&(b[e]&&b[e]!==d&&(d+=("style"===e?";":" ")+b[e]),a.$set(e,d,!0,c[e]))});s(b,function(b,f){"class"==f?(P(e,b),a["class"]=(a["class"]?a["class"]+" ":"")+b):"style"==
f?(e.attr("style",e.attr("style")+";"+b),a.style=(a.style?a.style+";":"")+b):"$"==f.charAt(0)||a.hasOwnProperty(f)||(a[f]=b,d[f]=c[f])})}function T(a,b,c,d,e,f,g,h){var l=[],k,q,p=b[0],n=a.shift(),w=z({},n,{templateUrl:null,transclude:null,replace:null,$$originalDirective:n}),O=G(n.templateUrl)?n.templateUrl(b,c):n.templateUrl,u=n.templateNamespace;b.empty();r(L.getTrustedResourceUrl(O)).then(function(r){var L,v;r=Sc(r);if(n.replace){r=Rb.test(r)?Tc(Wb(u,U(r))):[];L=r[0];if(1!=r.length||L.nodeType!==
oa)throw ja("tplrt",n.name,O);r={$attr:{}};V(d,b,L);var x=W(L,[],r);I(n.scope)&&y(x);a=x.concat(a);Qc(c,r)}else L=p,b.html(r);a.unshift(w);k=ea(a,L,c,e,b,n,f,g,h);s(d,function(a,c){a==L&&(d[c]=b[0])});for(q=S(b[0].childNodes,e);l.length;){r=l.shift();v=l.shift();var C=l.shift(),E=l.shift(),x=b[0];if(!r.$$destroyed){if(v!==p){var J=v.className;h.hasElementTranscludeDirective&&n.replace||(x=Tb(L));V(C,B(v),x);P(B(x),J)}v=k.transcludeOnThisElement?X(r,k.transclude,E):E;k(q,r,x,d,v)}}l=null});return function(a,
b,c,d,e){a=e;b.$$destroyed||(l?l.push(b,c,d,a):(k.transcludeOnThisElement&&(a=X(b,k.transclude,e)),k(q,b,c,d,a)))}}function N(a,b){var c=b.priority-a.priority;return 0!==c?c:a.name!==b.name?a.name<b.name?-1:1:a.index-b.index}function Oa(a,b,c,d){if(b)throw ja("multidir",b.name,c.name,a,va(d));}function M(a,c){var d=b(c,!0);d&&a.push({priority:0,compile:function(a){a=a.parent();var b=!!a.length;b&&E.$$addBindingClass(a);return function(a,c){var e=c.parent();b||E.$$addBindingClass(e);E.$$addBindingInfo(e,
d.expressions);a.$watch(d,function(a){c[0].nodeValue=a})}}})}function Wb(a,b){a=Q(a||"html");switch(a){case "svg":case "math":var c=Y.createElement("div");c.innerHTML="<"+a+">"+b+"</"+a+">";return c.childNodes[0].childNodes;default:return b}}function R(a,b){if("srcdoc"==b)return L.HTML;var c=ua(a);if("xlinkHref"==b||"form"==c&&"action"==b||"img"!=c&&("src"==b||"ngSrc"==b))return L.RESOURCE_URL}function Pa(a,c,d,e,f){var h=R(a,e);f=g[e]||f;var k=b(d,!0,h,f);if(k){if("multiple"===e&&"select"===ua(a))throw ja("selmulti",
va(a));c.push({priority:100,compile:function(){return{pre:function(a,c,g){c=g.$$observers||(g.$$observers={});if(l.test(e))throw ja("nodomevents");var p=g[e];p!==d&&(k=p&&b(p,!0,h,f),d=p);k&&(g[e]=k(a),(c[e]||(c[e]=[])).$$inter=!0,(g.$$observers&&g.$$observers[e].$$scope||a).$watch(k,function(a,b){"class"===e&&a!=b?g.$updateClass(a,b):g.$set(e,a)}))}}}})}}function V(a,b,c){var d=b[0],e=b.length,f=d.parentNode,g,h;if(a)for(g=0,h=a.length;g<h;g++)if(a[g]==d){a[g++]=c;h=g+e-1;for(var l=a.length;g<l;g++,
h++)h<l?a[g]=a[h]:delete a[g];a.length-=e-1;a.context===d&&(a.context=c);break}f&&f.replaceChild(c,d);a=Y.createDocumentFragment();a.appendChild(d);B(c).data(B(d).data());sa?(Pb=!0,sa.cleanData([d])):delete B.cache[d[B.expando]];d=1;for(e=b.length;d<e;d++)f=b[d],B(f).remove(),a.appendChild(f),delete b[d];b[0]=c;b.length=1}function Z(a,b){return z(function(){return a.apply(null,arguments)},a,b)}function $(a,b,d,e,f,g){try{a(b,d,e,f,g)}catch(h){c(h,va(d))}}var Xb=function(a,b){if(b){var c=Object.keys(b),
d,e,f;d=0;for(e=c.length;d<e;d++)f=c[d],this[f]=b[f]}else this.$attr={};this.$$element=a};Xb.prototype={$normalize:ya,$addClass:function(a){a&&0<a.length&&C.addClass(this.$$element,a)},$removeClass:function(a){a&&0<a.length&&C.removeClass(this.$$element,a)},$updateClass:function(a,b){var c=Uc(a,b);c&&c.length&&C.addClass(this.$$element,c);(c=Uc(b,a))&&c.length&&C.removeClass(this.$$element,c)},$set:function(a,b,d,e){var f=this.$$element[0],g=Lc(f,a),h=kf(f,a),f=a;g?(this.$$element.prop(a,b),e=g):
h&&(this[h]=b,f=h);this[a]=b;e?this.$attr[a]=e:(e=this.$attr[a])||(this.$attr[a]=e=tc(a,"-"));g=ua(this.$$element);if("a"===g&&"href"===a||"img"===g&&"src"===a)this[a]=b=x(b,"src"===a);else if("img"===g&&"srcset"===a){for(var g="",h=U(b),l=/(\s+\d+x\s*,|\s+\d+w\s*,|\s+,|,\s+)/,l=/\s/.test(h)?l:/(,)/,h=h.split(l),l=Math.floor(h.length/2),k=0;k<l;k++)var q=2*k,g=g+x(U(h[q]),!0),g=g+(" "+U(h[q+1]));h=U(h[2*k]).split(/\s/);g+=x(U(h[0]),!0);2===h.length&&(g+=" "+U(h[1]));this[a]=b=g}!1!==d&&(null===b||
b===t?this.$$element.removeAttr(e):this.$$element.attr(e,b));(a=this.$$observers)&&s(a[f],function(a){try{a(b)}catch(d){c(d)}})},$observe:function(a,b){var c=this,d=c.$$observers||(c.$$observers=ha()),e=d[a]||(d[a]=[]);e.push(b);v.$evalAsync(function(){!e.$$inter&&c.hasOwnProperty(a)&&b(c[a])});return function(){Xa(e,b)}}};var Aa=b.startSymbol(),ka=b.endSymbol(),Sc="{{"==Aa||"}}"==ka?pa:function(a){return a.replace(/\{\{/g,Aa).replace(/}}/g,ka)},fb=/^ngAttr[A-Z]/;E.$$addBindingInfo=k?function(a,b){var c=
a.data("$binding")||[];D(b)?c=c.concat(b):c.push(b);a.data("$binding",c)}:H;E.$$addBindingClass=k?function(a){P(a,"ng-binding")}:H;E.$$addScopeInfo=k?function(a,b,c,d){a.data(c?d?"$isolateScopeNoTemplate":"$isolateScope":"$scope",b)}:H;E.$$addScopeClass=k?function(a,b){P(a,b?"ng-isolate-scope":"ng-scope")}:H;return E}]}function ya(b){return cb(b.replace(Rc,""))}function Uc(b,a){var c="",d=b.split(/\s+/),e=a.split(/\s+/),f=0;a:for(;f<d.length;f++){for(var g=d[f],h=0;h<e.length;h++)if(g==e[h])continue a;
c+=(0<c.length?" ":"")+g}return c}function Tc(b){b=B(b);var a=b.length;if(1>=a)return b;for(;a--;)8===b[a].nodeType&&rf.call(b,a,1);return b}function Fe(){var b={},a=!1,c=/^(\S+)(\s+as\s+(\w+))?$/;this.register=function(a,c){Ma(a,"controller");I(a)?z(b,a):b[a]=c};this.allowGlobals=function(){a=!0};this.$get=["$injector","$window",function(d,e){function f(a,b,c,d){if(!a||!I(a.$scope))throw T("$controller")("noscp",d,b);a.$scope[b]=c}return function(g,h,l,k){var m,p,q;l=!0===l;k&&F(k)&&(q=k);F(g)&&
(k=g.match(c),p=k[1],q=q||k[3],g=b.hasOwnProperty(p)?b[p]:vc(h.$scope,p,!0)||(a?vc(e,p,!0):t),sb(g,p,!0));if(l)return l=(D(g)?g[g.length-1]:g).prototype,m=Object.create(l),q&&f(h,q,m,p||g.name),z(function(){d.invoke(g,m,h,p);return m},{instance:m,identifier:q});m=d.instantiate(g,h,p);q&&f(h,q,m,p||g.name);return m}}]}function Ge(){this.$get=["$window",function(b){return B(b.document)}]}function He(){this.$get=["$log",function(b){return function(a,c){b.error.apply(b,arguments)}}]}function Yb(b,a){if(F(b)){var c=
b.replace(sf,"").trim();if(c){var d=a("Content-Type");(d=d&&0===d.indexOf(Vc))||(d=(d=c.match(tf))&&uf[d[0]].test(c));d&&(b=oc(c))}}return b}function Wc(b){var a=ha(),c,d,e;if(!b)return a;s(b.split("\n"),function(b){e=b.indexOf(":");c=Q(U(b.substr(0,e)));d=U(b.substr(e+1));c&&(a[c]=a[c]?a[c]+", "+d:d)});return a}function Xc(b){var a=I(b)?b:t;return function(c){a||(a=Wc(b));return c?(c=a[Q(c)],void 0===c&&(c=null),c):a}}function Yc(b,a,c,d){if(G(d))return d(b,a,c);s(d,function(d){b=d(b,a,c)});return b}
function Ke(){var b=this.defaults={transformResponse:[Yb],transformRequest:[function(a){return I(a)&&"[object File]"!==Da.call(a)&&"[object Blob]"!==Da.call(a)&&"[object FormData]"!==Da.call(a)?$a(a):a}],headers:{common:{Accept:"application/json, text/plain, */*"},post:ra(Zb),put:ra(Zb),patch:ra(Zb)},xsrfCookieName:"XSRF-TOKEN",xsrfHeaderName:"X-XSRF-TOKEN"},a=!1;this.useApplyAsync=function(b){return y(b)?(a=!!b,this):a};var c=this.interceptors=[];this.$get=["$httpBackend","$browser","$cacheFactory",
"$rootScope","$q","$injector",function(d,e,f,g,h,l){function k(a){function c(a){var b=z({},a);b.data=a.data?Yc(a.data,a.headers,a.status,e.transformResponse):a.data;a=a.status;return 200<=a&&300>a?b:h.reject(b)}function d(a){var b,c={};s(a,function(a,d){G(a)?(b=a(),null!=b&&(c[d]=b)):c[d]=a});return c}if(!ga.isObject(a))throw T("$http")("badreq",a);var e=z({method:"get",transformRequest:b.transformRequest,transformResponse:b.transformResponse},a);e.headers=function(a){var c=b.headers,e=z({},a.headers),
f,g,c=z({},c.common,c[Q(a.method)]);a:for(f in c){a=Q(f);for(g in e)if(Q(g)===a)continue a;e[f]=c[f]}return d(e)}(a);e.method=ub(e.method);var f=[function(a){var d=a.headers,e=Yc(a.data,Xc(d),t,a.transformRequest);A(e)&&s(d,function(a,b){"content-type"===Q(b)&&delete d[b]});A(a.withCredentials)&&!A(b.withCredentials)&&(a.withCredentials=b.withCredentials);return m(a,e).then(c,c)},t],g=h.when(e);for(s(u,function(a){(a.request||a.requestError)&&f.unshift(a.request,a.requestError);(a.response||a.responseError)&&
f.push(a.response,a.responseError)});f.length;){a=f.shift();var l=f.shift(),g=g.then(a,l)}g.success=function(a){g.then(function(b){a(b.data,b.status,b.headers,e)});return g};g.error=function(a){g.then(null,function(b){a(b.data,b.status,b.headers,e)});return g};return g}function m(c,f){function l(b,c,d,e){function f(){m(c,b,d,e)}P&&(200<=b&&300>b?P.put(X,[b,c,Wc(d),e]):P.remove(X));a?g.$applyAsync(f):(f(),g.$$phase||g.$apply())}function m(a,b,d,e){b=Math.max(b,0);(200<=b&&300>b?C.resolve:C.reject)({data:a,
status:b,headers:Xc(d),config:c,statusText:e})}function w(a){m(a.data,a.status,ra(a.headers()),a.statusText)}function u(){var a=k.pendingRequests.indexOf(c);-1!==a&&k.pendingRequests.splice(a,1)}var C=h.defer(),x=C.promise,P,E,s=c.headers,X=p(c.url,c.params);k.pendingRequests.push(c);x.then(u,u);!c.cache&&!b.cache||!1===c.cache||"GET"!==c.method&&"JSONP"!==c.method||(P=I(c.cache)?c.cache:I(b.cache)?b.cache:q);P&&(E=P.get(X),y(E)?E&&G(E.then)?E.then(w,w):D(E)?m(E[1],E[0],ra(E[2]),E[3]):m(E,200,{},
"OK"):P.put(X,x));A(E)&&((E=Zc(c.url)?e.cookies()[c.xsrfCookieName||b.xsrfCookieName]:t)&&(s[c.xsrfHeaderName||b.xsrfHeaderName]=E),d(c.method,X,f,l,s,c.timeout,c.withCredentials,c.responseType));return x}function p(a,b){if(!b)return a;var c=[];Ed(b,function(a,b){null===a||A(a)||(D(a)||(a=[a]),s(a,function(a){I(a)&&(a=qa(a)?a.toISOString():$a(a));c.push(Fa(b)+"="+Fa(a))}))});0<c.length&&(a+=(-1==a.indexOf("?")?"?":"&")+c.join("&"));return a}var q=f("$http"),u=[];s(c,function(a){u.unshift(F(a)?l.get(a):
l.invoke(a))});k.pendingRequests=[];(function(a){s(arguments,function(a){k[a]=function(b,c){return k(z(c||{},{method:a,url:b}))}})})("get","delete","head","jsonp");(function(a){s(arguments,function(a){k[a]=function(b,c,d){return k(z(d||{},{method:a,url:b,data:c}))}})})("post","put","patch");k.defaults=b;return k}]}function vf(){return new M.XMLHttpRequest}function Le(){this.$get=["$browser","$window","$document",function(b,a,c){return wf(b,vf,b.defer,a.angular.callbacks,c[0])}]}function wf(b,a,c,
d,e){function f(a,b,c){var f=e.createElement("script"),m=null;f.type="text/javascript";f.src=a;f.async=!0;m=function(a){f.removeEventListener("load",m,!1);f.removeEventListener("error",m,!1);e.body.removeChild(f);f=null;var g=-1,u="unknown";a&&("load"!==a.type||d[b].called||(a={type:"error"}),u=a.type,g="error"===a.type?404:200);c&&c(g,u)};f.addEventListener("load",m,!1);f.addEventListener("error",m,!1);e.body.appendChild(f);return m}return function(e,h,l,k,m,p,q,u){function r(){v&&v();w&&w.abort()}
function O(a,d,e,f,g){C!==t&&c.cancel(C);v=w=null;a(d,e,f,g);b.$$completeOutstandingRequest(H)}b.$$incOutstandingRequestCount();h=h||b.url();if("jsonp"==Q(e)){var n="_"+(d.counter++).toString(36);d[n]=function(a){d[n].data=a;d[n].called=!0};var v=f(h.replace("JSON_CALLBACK","angular.callbacks."+n),n,function(a,b){O(k,a,d[n].data,"",b);d[n]=H})}else{var w=a();w.open(e,h,!0);s(m,function(a,b){y(a)&&w.setRequestHeader(b,a)});w.onload=function(){var a=w.statusText||"",b="response"in w?w.response:w.responseText,
c=1223===w.status?204:w.status;0===c&&(c=b?200:"file"==Ba(h).protocol?404:0);O(k,c,b,w.getAllResponseHeaders(),a)};e=function(){O(k,-1,null,null,"")};w.onerror=e;w.onabort=e;q&&(w.withCredentials=!0);if(u)try{w.responseType=u}catch(L){if("json"!==u)throw L;}w.send(l||null)}if(0<p)var C=c(r,p);else p&&G(p.then)&&p.then(r)}}function Ie(){var b="{{",a="}}";this.startSymbol=function(a){return a?(b=a,this):b};this.endSymbol=function(b){return b?(a=b,this):a};this.$get=["$parse","$exceptionHandler","$sce",
function(c,d,e){function f(a){return"\\\\\\"+a}function g(f,g,u,r){function O(c){return c.replace(k,b).replace(m,a)}function n(a){try{var b=a;a=u?e.getTrusted(u,b):e.valueOf(b);var c;if(r&&!y(a))c=a;else if(null==a)c="";else{switch(typeof a){case "string":break;case "number":a=""+a;break;default:a=$a(a)}c=a}return c}catch(g){c=$b("interr",f,g.toString()),d(c)}}r=!!r;for(var v,w,L=0,C=[],x=[],P=f.length,E=[],s=[];L<P;)if(-1!=(v=f.indexOf(b,L))&&-1!=(w=f.indexOf(a,v+h)))L!==v&&E.push(O(f.substring(L,
v))),L=f.substring(v+h,w),C.push(L),x.push(c(L,n)),L=w+l,s.push(E.length),E.push("");else{L!==P&&E.push(O(f.substring(L)));break}if(u&&1<E.length)throw $b("noconcat",f);if(!g||C.length){var X=function(a){for(var b=0,c=C.length;b<c;b++){if(r&&A(a[b]))return;E[s[b]]=a[b]}return E.join("")};return z(function(a){var b=0,c=C.length,e=Array(c);try{for(;b<c;b++)e[b]=x[b](a);return X(e)}catch(g){a=$b("interr",f,g.toString()),d(a)}},{exp:f,expressions:C,$$watchDelegate:function(a,b,c){var d;return a.$watchGroup(x,
function(c,e){var f=X(c);G(b)&&b.call(this,f,c!==e?d:f,a);d=f},c)}})}}var h=b.length,l=a.length,k=new RegExp(b.replace(/./g,f),"g"),m=new RegExp(a.replace(/./g,f),"g");g.startSymbol=function(){return b};g.endSymbol=function(){return a};return g}]}function Je(){this.$get=["$rootScope","$window","$q","$$q",function(b,a,c,d){function e(e,h,l,k){var m=a.setInterval,p=a.clearInterval,q=0,u=y(k)&&!k,r=(u?d:c).defer(),O=r.promise;l=y(l)?l:0;O.then(null,null,e);O.$$intervalId=m(function(){r.notify(q++);0<
l&&q>=l&&(r.resolve(q),p(O.$$intervalId),delete f[O.$$intervalId]);u||b.$apply()},h);f[O.$$intervalId]=r;return O}var f={};e.cancel=function(b){return b&&b.$$intervalId in f?(f[b.$$intervalId].reject("canceled"),a.clearInterval(b.$$intervalId),delete f[b.$$intervalId],!0):!1};return e}]}function Rd(){this.$get=function(){return{id:"en-us",NUMBER_FORMATS:{DECIMAL_SEP:".",GROUP_SEP:",",PATTERNS:[{minInt:1,minFrac:0,maxFrac:3,posPre:"",posSuf:"",negPre:"-",negSuf:"",gSize:3,lgSize:3},{minInt:1,minFrac:2,
maxFrac:2,posPre:"\u00a4",posSuf:"",negPre:"(\u00a4",negSuf:")",gSize:3,lgSize:3}],CURRENCY_SYM:"$"},DATETIME_FORMATS:{MONTH:"January February March April May June July August September October November December".split(" "),SHORTMONTH:"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" "),DAY:"Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),SHORTDAY:"Sun Mon Tue Wed Thu Fri Sat".split(" "),AMPMS:["AM","PM"],medium:"MMM d, y h:mm:ss a","short":"M/d/yy h:mm a",fullDate:"EEEE, MMMM d, y",
longDate:"MMMM d, y",mediumDate:"MMM d, y",shortDate:"M/d/yy",mediumTime:"h:mm:ss a",shortTime:"h:mm a"},pluralCat:function(b){return 1===b?"one":"other"}}}}function ac(b){b=b.split("/");for(var a=b.length;a--;)b[a]=qb(b[a]);return b.join("/")}function $c(b,a){var c=Ba(b);a.$$protocol=c.protocol;a.$$host=c.hostname;a.$$port=ba(c.port)||xf[c.protocol]||null}function ad(b,a){var c="/"!==b.charAt(0);c&&(b="/"+b);var d=Ba(b);a.$$path=decodeURIComponent(c&&"/"===d.pathname.charAt(0)?d.pathname.substring(1):
d.pathname);a.$$search=qc(d.search);a.$$hash=decodeURIComponent(d.hash);a.$$path&&"/"!=a.$$path.charAt(0)&&(a.$$path="/"+a.$$path)}function za(b,a){if(0===a.indexOf(b))return a.substr(b.length)}function Ha(b){var a=b.indexOf("#");return-1==a?b:b.substr(0,a)}function bd(b){return b.replace(/(#.+)|#$/,"$1")}function bc(b){return b.substr(0,Ha(b).lastIndexOf("/")+1)}function cc(b,a){this.$$html5=!0;a=a||"";var c=bc(b);$c(b,this);this.$$parse=function(a){var b=za(c,a);if(!F(b))throw Fb("ipthprfx",a,c);
ad(b,this);this.$$path||(this.$$path="/");this.$$compose()};this.$$compose=function(){var a=Nb(this.$$search),b=this.$$hash?"#"+qb(this.$$hash):"";this.$$url=ac(this.$$path)+(a?"?"+a:"")+b;this.$$absUrl=c+this.$$url.substr(1)};this.$$parseLinkUrl=function(d,e){if(e&&"#"===e[0])return this.hash(e.slice(1)),!0;var f,g;(f=za(b,d))!==t?(g=f,g=(f=za(a,f))!==t?c+(za("/",f)||f):b+g):(f=za(c,d))!==t?g=c+f:c==d+"/"&&(g=c);g&&this.$$parse(g);return!!g}}function dc(b,a){var c=bc(b);$c(b,this);this.$$parse=function(d){d=
za(b,d)||za(c,d);var e;"#"===d.charAt(0)?(e=za(a,d),A(e)&&(e=d)):e=this.$$html5?d:"";ad(e,this);d=this.$$path;var f=/^\/[A-Z]:(\/.*)/;0===e.indexOf(b)&&(e=e.replace(b,""));f.exec(e)||(d=(e=f.exec(d))?e[1]:d);this.$$path=d;this.$$compose()};this.$$compose=function(){var c=Nb(this.$$search),e=this.$$hash?"#"+qb(this.$$hash):"";this.$$url=ac(this.$$path)+(c?"?"+c:"")+e;this.$$absUrl=b+(this.$$url?a+this.$$url:"")};this.$$parseLinkUrl=function(a,c){return Ha(b)==Ha(a)?(this.$$parse(a),!0):!1}}function cd(b,
a){this.$$html5=!0;dc.apply(this,arguments);var c=bc(b);this.$$parseLinkUrl=function(d,e){if(e&&"#"===e[0])return this.hash(e.slice(1)),!0;var f,g;b==Ha(d)?f=d:(g=za(c,d))?f=b+a+g:c===d+"/"&&(f=c);f&&this.$$parse(f);return!!f};this.$$compose=function(){var c=Nb(this.$$search),e=this.$$hash?"#"+qb(this.$$hash):"";this.$$url=ac(this.$$path)+(c?"?"+c:"")+e;this.$$absUrl=b+a+this.$$url}}function Gb(b){return function(){return this[b]}}function dd(b,a){return function(c){if(A(c))return this[b];this[b]=
a(c);this.$$compose();return this}}function Me(){var b="",a={enabled:!1,requireBase:!0,rewriteLinks:!0};this.hashPrefix=function(a){return y(a)?(b=a,this):b};this.html5Mode=function(b){return Wa(b)?(a.enabled=b,this):I(b)?(Wa(b.enabled)&&(a.enabled=b.enabled),Wa(b.requireBase)&&(a.requireBase=b.requireBase),Wa(b.rewriteLinks)&&(a.rewriteLinks=b.rewriteLinks),this):a};this.$get=["$rootScope","$browser","$sniffer","$rootElement","$window",function(c,d,e,f,g){function h(a,b,c){var e=k.url(),f=k.$$state;
try{d.url(a,b,c),k.$$state=d.state()}catch(g){throw k.url(e),k.$$state=f,g;}}function l(a,b){c.$broadcast("$locationChangeSuccess",k.absUrl(),a,k.$$state,b)}var k,m;m=d.baseHref();var p=d.url(),q;if(a.enabled){if(!m&&a.requireBase)throw Fb("nobase");q=p.substring(0,p.indexOf("/",p.indexOf("//")+2))+(m||"/");m=e.history?cc:cd}else q=Ha(p),m=dc;k=new m(q,"#"+b);k.$$parseLinkUrl(p,p);k.$$state=d.state();var u=/^\s*(javascript|mailto):/i;f.on("click",function(b){if(a.rewriteLinks&&!b.ctrlKey&&!b.metaKey&&
2!=b.which){for(var e=B(b.target);"a"!==ua(e[0]);)if(e[0]===f[0]||!(e=e.parent())[0])return;var h=e.prop("href"),l=e.attr("href")||e.attr("xlink:href");I(h)&&"[object SVGAnimatedString]"===h.toString()&&(h=Ba(h.animVal).href);u.test(h)||!h||e.attr("target")||b.isDefaultPrevented()||!k.$$parseLinkUrl(h,l)||(b.preventDefault(),k.absUrl()!=d.url()&&(c.$apply(),g.angular["ff-684208-preventDefault"]=!0))}});k.absUrl()!=p&&d.url(k.absUrl(),!0);var r=!0;d.onUrlChange(function(a,b){c.$evalAsync(function(){var d=
k.absUrl(),e=k.$$state,f;k.$$parse(a);k.$$state=b;f=c.$broadcast("$locationChangeStart",a,d,b,e).defaultPrevented;k.absUrl()===a&&(f?(k.$$parse(d),k.$$state=e,h(d,!1,e)):(r=!1,l(d,e)))});c.$$phase||c.$digest()});c.$watch(function(){var a=bd(d.url()),b=bd(k.absUrl()),f=d.state(),g=k.$$replace,q=a!==b||k.$$html5&&e.history&&f!==k.$$state;if(r||q)r=!1,c.$evalAsync(function(){var b=k.absUrl(),d=c.$broadcast("$locationChangeStart",b,a,k.$$state,f).defaultPrevented;k.absUrl()===b&&(d?(k.$$parse(a),k.$$state=
f):(q&&h(b,g,f===k.$$state?null:k.$$state),l(a,f)))});k.$$replace=!1});return k}]}function Ne(){var b=!0,a=this;this.debugEnabled=function(a){return y(a)?(b=a,this):b};this.$get=["$window",function(c){function d(a){a instanceof Error&&(a.stack?a=a.message&&-1===a.stack.indexOf(a.message)?"Error: "+a.message+"\n"+a.stack:a.stack:a.sourceURL&&(a=a.message+"\n"+a.sourceURL+":"+a.line));return a}function e(a){var b=c.console||{},e=b[a]||b.log||H;a=!1;try{a=!!e.apply}catch(l){}return a?function(){var a=
[];s(arguments,function(b){a.push(d(b))});return e.apply(b,a)}:function(a,b){e(a,null==b?"":b)}}return{log:e("log"),info:e("info"),warn:e("warn"),error:e("error"),debug:function(){var c=e("debug");return function(){b&&c.apply(a,arguments)}}()}}]}function ta(b,a){if("__defineGetter__"===b||"__defineSetter__"===b||"__lookupGetter__"===b||"__lookupSetter__"===b||"__proto__"===b)throw la("isecfld",a);return b}function ma(b,a){if(b){if(b.constructor===b)throw la("isecfn",a);if(b.window===b)throw la("isecwindow",
a);if(b.children&&(b.nodeName||b.prop&&b.attr&&b.find))throw la("isecdom",a);if(b===Object)throw la("isecobj",a);}return b}function ec(b){return b.constant}function gb(b,a,c,d,e){ma(b,e);ma(a,e);c=c.split(".");for(var f,g=0;1<c.length;g++){f=ta(c.shift(),e);var h=0===g&&a&&a[f]||b[f];h||(h={},b[f]=h);b=ma(h,e)}f=ta(c.shift(),e);ma(b[f],e);return b[f]=d}function Qa(b){return"constructor"==b}function ed(b,a,c,d,e,f,g){ta(b,f);ta(a,f);ta(c,f);ta(d,f);ta(e,f);var h=function(a){return ma(a,f)},l=g||Qa(b)?
h:pa,k=g||Qa(a)?h:pa,m=g||Qa(c)?h:pa,p=g||Qa(d)?h:pa,q=g||Qa(e)?h:pa;return function(f,g){var h=g&&g.hasOwnProperty(b)?g:f;if(null==h)return h;h=l(h[b]);if(!a)return h;if(null==h)return t;h=k(h[a]);if(!c)return h;if(null==h)return t;h=m(h[c]);if(!d)return h;if(null==h)return t;h=p(h[d]);return e?null==h?t:h=q(h[e]):h}}function yf(b,a){return function(c,d){return b(c,d,ma,a)}}function zf(b,a,c){var d=a.expensiveChecks,e=d?Af:Bf,f=e[b];if(f)return f;var g=b.split("."),h=g.length;if(a.csp)f=6>h?ed(g[0],
g[1],g[2],g[3],g[4],c,d):function(a,b){var e=0,f;do f=ed(g[e++],g[e++],g[e++],g[e++],g[e++],c,d)(a,b),b=t,a=f;while(e<h);return f};else{var l="";d&&(l+="s = eso(s, fe);\nl = eso(l, fe);\n");var k=d;s(g,function(a,b){ta(a,c);var e=(b?"s":'((l&&l.hasOwnProperty("'+a+'"))?l:s)')+"."+a;if(d||Qa(a))e="eso("+e+", fe)",k=!0;l+="if(s == null) return undefined;\ns="+e+";\n"});l+="return s;";a=new Function("s","l","eso","fe",l);a.toString=da(l);k&&(a=yf(a,c));f=a}f.sharedGetter=!0;f.assign=function(a,c,d){return gb(a,
d,b,c,b)};return e[b]=f}function fc(b){return G(b.valueOf)?b.valueOf():Cf.call(b)}function Oe(){var b=ha(),a=ha();this.$get=["$filter","$sniffer",function(c,d){function e(a){var b=a;a.sharedGetter&&(b=function(b,c){return a(b,c)},b.literal=a.literal,b.constant=a.constant,b.assign=a.assign);return b}function f(a,b){for(var c=0,d=a.length;c<d;c++){var e=a[c];e.constant||(e.inputs?f(e.inputs,b):-1===b.indexOf(e)&&b.push(e))}return b}function g(a,b){return null==a||null==b?a===b:"object"===typeof a&&
(a=fc(a),"object"===typeof a)?!1:a===b||a!==a&&b!==b}function h(a,b,c,d){var e=d.$$inputs||(d.$$inputs=f(d.inputs,[])),h;if(1===e.length){var l=g,e=e[0];return a.$watch(function(a){var b=e(a);g(b,l)||(h=d(a),l=b&&fc(b));return h},b,c)}for(var k=[],q=0,p=e.length;q<p;q++)k[q]=g;return a.$watch(function(a){for(var b=!1,c=0,f=e.length;c<f;c++){var l=e[c](a);if(b||(b=!g(l,k[c])))k[c]=l&&fc(l)}b&&(h=d(a));return h},b,c)}function l(a,b,c,d){var e,f;return e=a.$watch(function(a){return d(a)},function(a,
c,d){f=a;G(b)&&b.apply(this,arguments);y(a)&&d.$$postDigest(function(){y(f)&&e()})},c)}function k(a,b,c,d){function e(a){var b=!0;s(a,function(a){y(a)||(b=!1)});return b}var f,g;return f=a.$watch(function(a){return d(a)},function(a,c,d){g=a;G(b)&&b.call(this,a,c,d);e(a)&&d.$$postDigest(function(){e(g)&&f()})},c)}function m(a,b,c,d){var e;return e=a.$watch(function(a){return d(a)},function(a,c,d){G(b)&&b.apply(this,arguments);e()},c)}function p(a,b){if(!b)return a;var c=a.$$watchDelegate,c=c!==k&&
c!==l?function(c,d){var e=a(c,d);return b(e,c,d)}:function(c,d){var e=a(c,d),f=b(e,c,d);return y(e)?f:e};a.$$watchDelegate&&a.$$watchDelegate!==h?c.$$watchDelegate=a.$$watchDelegate:b.$stateful||(c.$$watchDelegate=h,c.inputs=[a]);return c}var q={csp:d.csp,expensiveChecks:!1},u={csp:d.csp,expensiveChecks:!0};return function(d,f,g){var v,w,L;switch(typeof d){case "string":L=d=d.trim();var C=g?a:b;v=C[L];v||(":"===d.charAt(0)&&":"===d.charAt(1)&&(w=!0,d=d.substring(2)),g=g?u:q,v=new gc(g),v=(new hb(v,
c,g)).parse(d),v.constant?v.$$watchDelegate=m:w?(v=e(v),v.$$watchDelegate=v.literal?k:l):v.inputs&&(v.$$watchDelegate=h),C[L]=v);return p(v,f);case "function":return p(d,f);default:return p(H,f)}}}]}function Qe(){this.$get=["$rootScope","$exceptionHandler",function(b,a){return fd(function(a){b.$evalAsync(a)},a)}]}function Re(){this.$get=["$browser","$exceptionHandler",function(b,a){return fd(function(a){b.defer(a)},a)}]}function fd(b,a){function c(a,b,c){function d(b){return function(c){e||(e=!0,
b.call(a,c))}}var e=!1;return[d(b),d(c)]}function d(){this.$$state={status:0}}function e(a,b){return function(c){b.call(a,c)}}function f(c){!c.processScheduled&&c.pending&&(c.processScheduled=!0,b(function(){var b,d,e;e=c.pending;c.processScheduled=!1;c.pending=t;for(var f=0,g=e.length;f<g;++f){d=e[f][0];b=e[f][c.status];try{G(b)?d.resolve(b(c.value)):1===c.status?d.resolve(c.value):d.reject(c.value)}catch(h){d.reject(h),a(h)}}}))}function g(){this.promise=new d;this.resolve=e(this,this.resolve);
this.reject=e(this,this.reject);this.notify=e(this,this.notify)}var h=T("$q",TypeError);d.prototype={then:function(a,b,c){var d=new g;this.$$state.pending=this.$$state.pending||[];this.$$state.pending.push([d,a,b,c]);0<this.$$state.status&&f(this.$$state);return d.promise},"catch":function(a){return this.then(null,a)},"finally":function(a,b){return this.then(function(b){return k(b,!0,a)},function(b){return k(b,!1,a)},b)}};g.prototype={resolve:function(a){this.promise.$$state.status||(a===this.promise?
this.$$reject(h("qcycle",a)):this.$$resolve(a))},$$resolve:function(b){var d,e;e=c(this,this.$$resolve,this.$$reject);try{if(I(b)||G(b))d=b&&b.then;G(d)?(this.promise.$$state.status=-1,d.call(b,e[0],e[1],this.notify)):(this.promise.$$state.value=b,this.promise.$$state.status=1,f(this.promise.$$state))}catch(g){e[1](g),a(g)}},reject:function(a){this.promise.$$state.status||this.$$reject(a)},$$reject:function(a){this.promise.$$state.value=a;this.promise.$$state.status=2;f(this.promise.$$state)},notify:function(c){var d=
this.promise.$$state.pending;0>=this.promise.$$state.status&&d&&d.length&&b(function(){for(var b,e,f=0,g=d.length;f<g;f++){e=d[f][0];b=d[f][3];try{e.notify(G(b)?b(c):c)}catch(h){a(h)}}})}};var l=function(a,b){var c=new g;b?c.resolve(a):c.reject(a);return c.promise},k=function(a,b,c){var d=null;try{G(c)&&(d=c())}catch(e){return l(e,!1)}return d&&G(d.then)?d.then(function(){return l(a,b)},function(a){return l(a,!1)}):l(a,b)},m=function(a,b,c,d){var e=new g;e.resolve(a);return e.promise.then(b,c,d)},
p=function u(a){if(!G(a))throw h("norslvr",a);if(!(this instanceof u))return new u(a);var b=new g;a(function(a){b.resolve(a)},function(a){b.reject(a)});return b.promise};p.defer=function(){return new g};p.reject=function(a){var b=new g;b.reject(a);return b.promise};p.when=m;p.all=function(a){var b=new g,c=0,d=D(a)?[]:{};s(a,function(a,e){c++;m(a).then(function(a){d.hasOwnProperty(e)||(d[e]=a,--c||b.resolve(d))},function(a){d.hasOwnProperty(e)||b.reject(a)})});0===c&&b.resolve(d);return b.promise};
return p}function $e(){this.$get=["$window","$timeout",function(b,a){var c=b.requestAnimationFrame||b.webkitRequestAnimationFrame,d=b.cancelAnimationFrame||b.webkitCancelAnimationFrame||b.webkitCancelRequestAnimationFrame,e=!!c,f=e?function(a){var b=c(a);return function(){d(b)}}:function(b){var c=a(b,16.66,!1);return function(){a.cancel(c)}};f.supported=e;return f}]}function Pe(){var b=10,a=T("$rootScope"),c=null,d=null;this.digestTtl=function(a){arguments.length&&(b=a);return b};this.$get=["$injector",
"$exceptionHandler","$parse","$browser",function(e,f,g,h){function l(){this.$id=++nb;this.$$phase=this.$parent=this.$$watchers=this.$$nextSibling=this.$$prevSibling=this.$$childHead=this.$$childTail=null;this.$root=this;this.$$destroyed=!1;this.$$listeners={};this.$$listenerCount={};this.$$isolateBindings=null}function k(b){if(r.$$phase)throw a("inprog",r.$$phase);r.$$phase=b}function m(a,b,c){do a.$$listenerCount[c]-=b,0===a.$$listenerCount[c]&&delete a.$$listenerCount[c];while(a=a.$parent)}function p(){}
function q(){for(;v.length;)try{v.shift()()}catch(a){f(a)}d=null}function u(){null===d&&(d=h.defer(function(){r.$apply(q)}))}l.prototype={constructor:l,$new:function(a,b){function c(){d.$$destroyed=!0}var d;b=b||this;a?(d=new l,d.$root=this.$root):(this.$$ChildScope||(this.$$ChildScope=function(){this.$$watchers=this.$$nextSibling=this.$$childHead=this.$$childTail=null;this.$$listeners={};this.$$listenerCount={};this.$id=++nb;this.$$ChildScope=null},this.$$ChildScope.prototype=this),d=new this.$$ChildScope);
d.$parent=b;d.$$prevSibling=b.$$childTail;b.$$childHead?(b.$$childTail.$$nextSibling=d,b.$$childTail=d):b.$$childHead=b.$$childTail=d;(a||b!=this)&&d.$on("$destroy",c);return d},$watch:function(a,b,d){var e=g(a);if(e.$$watchDelegate)return e.$$watchDelegate(this,b,d,e);var f=this.$$watchers,h={fn:b,last:p,get:e,exp:a,eq:!!d};c=null;G(b)||(h.fn=H);f||(f=this.$$watchers=[]);f.unshift(h);return function(){Xa(f,h);c=null}},$watchGroup:function(a,b){function c(){h=!1;l?(l=!1,b(e,e,g)):b(e,d,g)}var d=Array(a.length),
e=Array(a.length),f=[],g=this,h=!1,l=!0;if(!a.length){var k=!0;g.$evalAsync(function(){k&&b(e,e,g)});return function(){k=!1}}if(1===a.length)return this.$watch(a[0],function(a,c,f){e[0]=a;d[0]=c;b(e,a===c?e:d,f)});s(a,function(a,b){var l=g.$watch(a,function(a,f){e[b]=a;d[b]=f;h||(h=!0,g.$evalAsync(c))});f.push(l)});return function(){for(;f.length;)f.shift()()}},$watchCollection:function(a,b){function c(a){e=a;var b,d,g,h;if(!A(e)){if(I(e))if(Ta(e))for(f!==q&&(f=q,u=f.length=0,k++),a=e.length,u!==
a&&(k++,f.length=u=a),b=0;b<a;b++)h=f[b],g=e[b],d=h!==h&&g!==g,d||h===g||(k++,f[b]=g);else{f!==m&&(f=m={},u=0,k++);a=0;for(b in e)e.hasOwnProperty(b)&&(a++,g=e[b],h=f[b],b in f?(d=h!==h&&g!==g,d||h===g||(k++,f[b]=g)):(u++,f[b]=g,k++));if(u>a)for(b in k++,f)e.hasOwnProperty(b)||(u--,delete f[b])}else f!==e&&(f=e,k++);return k}}c.$stateful=!0;var d=this,e,f,h,l=1<b.length,k=0,p=g(a,c),q=[],m={},n=!0,u=0;return this.$watch(p,function(){n?(n=!1,b(e,e,d)):b(e,h,d);if(l)if(I(e))if(Ta(e)){h=Array(e.length);
for(var a=0;a<e.length;a++)h[a]=e[a]}else for(a in h={},e)rc.call(e,a)&&(h[a]=e[a]);else h=e})},$digest:function(){var e,g,l,m,u,v,s=b,t,W=[],y,J;k("$digest");h.$$checkUrlChange();this===r&&null!==d&&(h.defer.cancel(d),q());c=null;do{v=!1;for(t=this;O.length;){try{J=O.shift(),J.scope.$eval(J.expression,J.locals)}catch(B){f(B)}c=null}a:do{if(m=t.$$watchers)for(u=m.length;u--;)try{if(e=m[u])if((g=e.get(t))!==(l=e.last)&&!(e.eq?fa(g,l):"number"===typeof g&&"number"===typeof l&&isNaN(g)&&isNaN(l)))v=
!0,c=e,e.last=e.eq?Ea(g,null):g,e.fn(g,l===p?g:l,t),5>s&&(y=4-s,W[y]||(W[y]=[]),W[y].push({msg:G(e.exp)?"fn: "+(e.exp.name||e.exp.toString()):e.exp,newVal:g,oldVal:l}));else if(e===c){v=!1;break a}}catch(A){f(A)}if(!(m=t.$$childHead||t!==this&&t.$$nextSibling))for(;t!==this&&!(m=t.$$nextSibling);)t=t.$parent}while(t=m);if((v||O.length)&&!s--)throw r.$$phase=null,a("infdig",b,W);}while(v||O.length);for(r.$$phase=null;n.length;)try{n.shift()()}catch(ca){f(ca)}},$destroy:function(){if(!this.$$destroyed){var a=
this.$parent;this.$broadcast("$destroy");this.$$destroyed=!0;if(this!==r){for(var b in this.$$listenerCount)m(this,this.$$listenerCount[b],b);a.$$childHead==this&&(a.$$childHead=this.$$nextSibling);a.$$childTail==this&&(a.$$childTail=this.$$prevSibling);this.$$prevSibling&&(this.$$prevSibling.$$nextSibling=this.$$nextSibling);this.$$nextSibling&&(this.$$nextSibling.$$prevSibling=this.$$prevSibling);this.$destroy=this.$digest=this.$apply=this.$evalAsync=this.$applyAsync=H;this.$on=this.$watch=this.$watchGroup=
function(){return H};this.$$listeners={};this.$parent=this.$$nextSibling=this.$$prevSibling=this.$$childHead=this.$$childTail=this.$root=this.$$watchers=null}}},$eval:function(a,b){return g(a)(this,b)},$evalAsync:function(a,b){r.$$phase||O.length||h.defer(function(){O.length&&r.$digest()});O.push({scope:this,expression:a,locals:b})},$$postDigest:function(a){n.push(a)},$apply:function(a){try{return k("$apply"),this.$eval(a)}catch(b){f(b)}finally{r.$$phase=null;try{r.$digest()}catch(c){throw f(c),c;
}}},$applyAsync:function(a){function b(){c.$eval(a)}var c=this;a&&v.push(b);u()},$on:function(a,b){var c=this.$$listeners[a];c||(this.$$listeners[a]=c=[]);c.push(b);var d=this;do d.$$listenerCount[a]||(d.$$listenerCount[a]=0),d.$$listenerCount[a]++;while(d=d.$parent);var e=this;return function(){var d=c.indexOf(b);-1!==d&&(c[d]=null,m(e,1,a))}},$emit:function(a,b){var c=[],d,e=this,g=!1,h={name:a,targetScope:e,stopPropagation:function(){g=!0},preventDefault:function(){h.defaultPrevented=!0},defaultPrevented:!1},
l=Ya([h],arguments,1),k,p;do{d=e.$$listeners[a]||c;h.currentScope=e;k=0;for(p=d.length;k<p;k++)if(d[k])try{d[k].apply(null,l)}catch(m){f(m)}else d.splice(k,1),k--,p--;if(g)return h.currentScope=null,h;e=e.$parent}while(e);h.currentScope=null;return h},$broadcast:function(a,b){var c=this,d=this,e={name:a,targetScope:this,preventDefault:function(){e.defaultPrevented=!0},defaultPrevented:!1};if(!this.$$listenerCount[a])return e;for(var g=Ya([e],arguments,1),h,l;c=d;){e.currentScope=c;d=c.$$listeners[a]||
[];h=0;for(l=d.length;h<l;h++)if(d[h])try{d[h].apply(null,g)}catch(k){f(k)}else d.splice(h,1),h--,l--;if(!(d=c.$$listenerCount[a]&&c.$$childHead||c!==this&&c.$$nextSibling))for(;c!==this&&!(d=c.$$nextSibling);)c=c.$parent}e.currentScope=null;return e}};var r=new l,O=r.$$asyncQueue=[],n=r.$$postDigestQueue=[],v=r.$$applyAsyncQueue=[];return r}]}function Sd(){var b=/^\s*(https?|ftp|mailto|tel|file):/,a=/^\s*((https?|ftp|file|blob):|data:image\/)/;this.aHrefSanitizationWhitelist=function(a){return y(a)?
(b=a,this):b};this.imgSrcSanitizationWhitelist=function(b){return y(b)?(a=b,this):a};this.$get=function(){return function(c,d){var e=d?a:b,f;f=Ba(c).href;return""===f||f.match(e)?c:"unsafe:"+f}}}function Df(b){if("self"===b)return b;if(F(b)){if(-1<b.indexOf("***"))throw Ca("iwcard",b);b=gd(b).replace("\\*\\*",".*").replace("\\*","[^:/.?&;]*");return new RegExp("^"+b+"$")}if(ob(b))return new RegExp("^"+b.source+"$");throw Ca("imatcher");}function hd(b){var a=[];y(b)&&s(b,function(b){a.push(Df(b))});
return a}function Te(){this.SCE_CONTEXTS=na;var b=["self"],a=[];this.resourceUrlWhitelist=function(a){arguments.length&&(b=hd(a));return b};this.resourceUrlBlacklist=function(b){arguments.length&&(a=hd(b));return a};this.$get=["$injector",function(c){function d(a,b){return"self"===a?Zc(b):!!a.exec(b.href)}function e(a){var b=function(a){this.$$unwrapTrustedValue=function(){return a}};a&&(b.prototype=new a);b.prototype.valueOf=function(){return this.$$unwrapTrustedValue()};b.prototype.toString=function(){return this.$$unwrapTrustedValue().toString()};
return b}var f=function(a){throw Ca("unsafe");};c.has("$sanitize")&&(f=c.get("$sanitize"));var g=e(),h={};h[na.HTML]=e(g);h[na.CSS]=e(g);h[na.URL]=e(g);h[na.JS]=e(g);h[na.RESOURCE_URL]=e(h[na.URL]);return{trustAs:function(a,b){var c=h.hasOwnProperty(a)?h[a]:null;if(!c)throw Ca("icontext",a,b);if(null===b||b===t||""===b)return b;if("string"!==typeof b)throw Ca("itype",a);return new c(b)},getTrusted:function(c,e){if(null===e||e===t||""===e)return e;var g=h.hasOwnProperty(c)?h[c]:null;if(g&&e instanceof
g)return e.$$unwrapTrustedValue();if(c===na.RESOURCE_URL){var g=Ba(e.toString()),p,q,u=!1;p=0;for(q=b.length;p<q;p++)if(d(b[p],g)){u=!0;break}if(u)for(p=0,q=a.length;p<q;p++)if(d(a[p],g)){u=!1;break}if(u)return e;throw Ca("insecurl",e.toString());}if(c===na.HTML)return f(e);throw Ca("unsafe");},valueOf:function(a){return a instanceof g?a.$$unwrapTrustedValue():a}}}]}function Se(){var b=!0;this.enabled=function(a){arguments.length&&(b=!!a);return b};this.$get=["$parse","$sceDelegate",function(a,c){if(b&&
8>Ra)throw Ca("iequirks");var d=ra(na);d.isEnabled=function(){return b};d.trustAs=c.trustAs;d.getTrusted=c.getTrusted;d.valueOf=c.valueOf;b||(d.trustAs=d.getTrusted=function(a,b){return b},d.valueOf=pa);d.parseAs=function(b,c){var e=a(c);return e.literal&&e.constant?e:a(c,function(a){return d.getTrusted(b,a)})};var e=d.parseAs,f=d.getTrusted,g=d.trustAs;s(na,function(a,b){var c=Q(b);d[cb("parse_as_"+c)]=function(b){return e(a,b)};d[cb("get_trusted_"+c)]=function(b){return f(a,b)};d[cb("trust_as_"+
c)]=function(b){return g(a,b)}});return d}]}function Ue(){this.$get=["$window","$document",function(b,a){var c={},d=ba((/android (\d+)/.exec(Q((b.navigator||{}).userAgent))||[])[1]),e=/Boxee/i.test((b.navigator||{}).userAgent),f=a[0]||{},g,h=/^(Moz|webkit|ms)(?=[A-Z])/,l=f.body&&f.body.style,k=!1,m=!1;if(l){for(var p in l)if(k=h.exec(p)){g=k[0];g=g.substr(0,1).toUpperCase()+g.substr(1);break}g||(g="WebkitOpacity"in l&&"webkit");k=!!("transition"in l||g+"Transition"in l);m=!!("animation"in l||g+"Animation"in
l);!d||k&&m||(k=F(f.body.style.webkitTransition),m=F(f.body.style.webkitAnimation))}return{history:!(!b.history||!b.history.pushState||4>d||e),hasEvent:function(a){if("input"===a&&11>=Ra)return!1;if(A(c[a])){var b=f.createElement("div");c[a]="on"+a in b}return c[a]},csp:ab(),vendorPrefix:g,transitions:k,animations:m,android:d}}]}function We(){this.$get=["$templateCache","$http","$q",function(b,a,c){function d(e,f){d.totalPendingRequests++;var g=a.defaults&&a.defaults.transformResponse;D(g)?g=g.filter(function(a){return a!==
Yb}):g===Yb&&(g=null);return a.get(e,{cache:b,transformResponse:g}).then(function(a){d.totalPendingRequests--;return a.data},function(a){d.totalPendingRequests--;if(!f)throw ja("tpload",e);return c.reject(a)})}d.totalPendingRequests=0;return d}]}function Xe(){this.$get=["$rootScope","$browser","$location",function(b,a,c){return{findBindings:function(a,b,c){a=a.getElementsByClassName("ng-binding");var g=[];s(a,function(a){var d=ga.element(a).data("$binding");d&&s(d,function(d){c?(new RegExp("(^|\\s)"+
gd(b)+"(\\s|\\||$)")).test(d)&&g.push(a):-1!=d.indexOf(b)&&g.push(a)})});return g},findModels:function(a,b,c){for(var g=["ng-","data-ng-","ng\\:"],h=0;h<g.length;++h){var l=a.querySelectorAll("["+g[h]+"model"+(c?"=":"*=")+'"'+b+'"]');if(l.length)return l}},getLocation:function(){return c.url()},setLocation:function(a){a!==c.url()&&(c.url(a),b.$digest())},whenStable:function(b){a.notifyWhenNoOutstandingRequests(b)}}}]}function Ye(){this.$get=["$rootScope","$browser","$q","$$q","$exceptionHandler",
function(b,a,c,d,e){function f(f,l,k){var m=y(k)&&!k,p=(m?d:c).defer(),q=p.promise;l=a.defer(function(){try{p.resolve(f())}catch(a){p.reject(a),e(a)}finally{delete g[q.$$timeoutId]}m||b.$apply()},l);q.$$timeoutId=l;g[l]=p;return q}var g={};f.cancel=function(b){return b&&b.$$timeoutId in g?(g[b.$$timeoutId].reject("canceled"),delete g[b.$$timeoutId],a.defer.cancel(b.$$timeoutId)):!1};return f}]}function Ba(b){Ra&&(Z.setAttribute("href",b),b=Z.href);Z.setAttribute("href",b);return{href:Z.href,protocol:Z.protocol?
Z.protocol.replace(/:$/,""):"",host:Z.host,search:Z.search?Z.search.replace(/^\?/,""):"",hash:Z.hash?Z.hash.replace(/^#/,""):"",hostname:Z.hostname,port:Z.port,pathname:"/"===Z.pathname.charAt(0)?Z.pathname:"/"+Z.pathname}}function Zc(b){b=F(b)?Ba(b):b;return b.protocol===id.protocol&&b.host===id.host}function Ze(){this.$get=da(M)}function Dc(b){function a(c,d){if(I(c)){var e={};s(c,function(b,c){e[c]=a(c,b)});return e}return b.factory(c+"Filter",d)}this.register=a;this.$get=["$injector",function(a){return function(b){return a.get(b+
"Filter")}}];a("currency",jd);a("date",kd);a("filter",Ef);a("json",Ff);a("limitTo",Gf);a("lowercase",Hf);a("number",ld);a("orderBy",md);a("uppercase",If)}function Ef(){return function(b,a,c){if(!D(b))return b;var d;switch(typeof a){case "function":break;case "boolean":case "number":case "string":d=!0;case "object":a=Jf(a,c,d);break;default:return b}return b.filter(a)}}function Jf(b,a,c){var d=I(b)&&"$"in b;!0===a?a=fa:G(a)||(a=function(a,b){if(I(a)||I(b))return!1;a=Q(""+a);b=Q(""+b);return-1!==a.indexOf(b)});
return function(e){return d&&!I(e)?Ia(e,b.$,a,!1):Ia(e,b,a,c)}}function Ia(b,a,c,d,e){var f=typeof b,g=typeof a;if("string"===g&&"!"===a.charAt(0))return!Ia(b,a.substring(1),c,d);if(D(b))return b.some(function(b){return Ia(b,a,c,d)});switch(f){case "object":var h;if(d){for(h in b)if("$"!==h.charAt(0)&&Ia(b[h],a,c,!0))return!0;return e?!1:Ia(b,a,c,!1)}if("object"===g){for(h in a)if(e=a[h],!G(e)&&(f="$"===h,!Ia(f?b:b[h],e,c,f,f)))return!1;return!0}return c(b,a);case "function":return!1;default:return c(b,
a)}}function jd(b){var a=b.NUMBER_FORMATS;return function(b,d,e){A(d)&&(d=a.CURRENCY_SYM);A(e)&&(e=a.PATTERNS[1].maxFrac);return null==b?b:nd(b,a.PATTERNS[1],a.GROUP_SEP,a.DECIMAL_SEP,e).replace(/\u00A4/g,d)}}function ld(b){var a=b.NUMBER_FORMATS;return function(b,d){return null==b?b:nd(b,a.PATTERNS[0],a.GROUP_SEP,a.DECIMAL_SEP,d)}}function nd(b,a,c,d,e){if(!isFinite(b)||I(b))return"";var f=0>b;b=Math.abs(b);var g=b+"",h="",l=[],k=!1;if(-1!==g.indexOf("e")){var m=g.match(/([\d\.]+)e(-?)(\d+)/);m&&
"-"==m[2]&&m[3]>e+1?b=0:(h=g,k=!0)}if(k)0<e&&1>b&&(h=b.toFixed(e),b=parseFloat(h));else{g=(g.split(od)[1]||"").length;A(e)&&(e=Math.min(Math.max(a.minFrac,g),a.maxFrac));b=+(Math.round(+(b.toString()+"e"+e)).toString()+"e"+-e);var g=(""+b).split(od),k=g[0],g=g[1]||"",p=0,q=a.lgSize,u=a.gSize;if(k.length>=q+u)for(p=k.length-q,m=0;m<p;m++)0===(p-m)%u&&0!==m&&(h+=c),h+=k.charAt(m);for(m=p;m<k.length;m++)0===(k.length-m)%q&&0!==m&&(h+=c),h+=k.charAt(m);for(;g.length<e;)g+="0";e&&"0"!==e&&(h+=d+g.substr(0,
e))}0===b&&(f=!1);l.push(f?a.negPre:a.posPre,h,f?a.negSuf:a.posSuf);return l.join("")}function Hb(b,a,c){var d="";0>b&&(d="-",b=-b);for(b=""+b;b.length<a;)b="0"+b;c&&(b=b.substr(b.length-a));return d+b}function $(b,a,c,d){c=c||0;return function(e){e=e["get"+b]();if(0<c||e>-c)e+=c;0===e&&-12==c&&(e=12);return Hb(e,a,d)}}function Ib(b,a){return function(c,d){var e=c["get"+b](),f=ub(a?"SHORT"+b:b);return d[f][e]}}function pd(b){var a=(new Date(b,0,1)).getDay();return new Date(b,0,(4>=a?5:12)-a)}function qd(b){return function(a){var c=
pd(a.getFullYear());a=+new Date(a.getFullYear(),a.getMonth(),a.getDate()+(4-a.getDay()))-+c;a=1+Math.round(a/6048E5);return Hb(a,b)}}function kd(b){function a(a){var b;if(b=a.match(c)){a=new Date(0);var f=0,g=0,h=b[8]?a.setUTCFullYear:a.setFullYear,l=b[8]?a.setUTCHours:a.setHours;b[9]&&(f=ba(b[9]+b[10]),g=ba(b[9]+b[11]));h.call(a,ba(b[1]),ba(b[2])-1,ba(b[3]));f=ba(b[4]||0)-f;g=ba(b[5]||0)-g;h=ba(b[6]||0);b=Math.round(1E3*parseFloat("0."+(b[7]||0)));l.call(a,f,g,h,b)}return a}var c=/^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;
return function(c,e,f){var g="",h=[],l,k;e=e||"mediumDate";e=b.DATETIME_FORMATS[e]||e;F(c)&&(c=Kf.test(c)?ba(c):a(c));V(c)&&(c=new Date(c));if(!qa(c))return c;for(;e;)(k=Lf.exec(e))?(h=Ya(h,k,1),e=h.pop()):(h.push(e),e=null);f&&"UTC"===f&&(c=new Date(c.getTime()),c.setMinutes(c.getMinutes()+c.getTimezoneOffset()));s(h,function(a){l=Mf[a];g+=l?l(c,b.DATETIME_FORMATS):a.replace(/(^'|'$)/g,"").replace(/''/g,"'")});return g}}function Ff(){return function(b,a){A(a)&&(a=2);return $a(b,a)}}function Gf(){return function(b,
a){V(b)&&(b=b.toString());return D(b)||F(b)?(a=Infinity===Math.abs(Number(a))?Number(a):ba(a))?0<a?b.slice(0,a):b.slice(a):F(b)?"":[]:b}}function md(b){return function(a,c,d){function e(a,b){return b?function(b,c){return a(c,b)}:a}function f(a){switch(typeof a){case "number":case "boolean":case "string":return!0;default:return!1}}function g(a){return null===a?"null":"function"===typeof a.valueOf&&(a=a.valueOf(),f(a))||"function"===typeof a.toString&&(a=a.toString(),f(a))?a:""}function h(a,b){var c=
typeof a,d=typeof b;c===d&&"object"===c&&(a=g(a),b=g(b));return c===d?("string"===c&&(a=a.toLowerCase(),b=b.toLowerCase()),a===b?0:a<b?-1:1):c<d?-1:1}if(!Ta(a))return a;c=D(c)?c:[c];0===c.length&&(c=["+"]);c=c.map(function(a){var c=!1,d=a||pa;if(F(a)){if("+"==a.charAt(0)||"-"==a.charAt(0))c="-"==a.charAt(0),a=a.substring(1);if(""===a)return e(h,c);d=b(a);if(d.constant){var f=d();return e(function(a,b){return h(a[f],b[f])},c)}}return e(function(a,b){return h(d(a),d(b))},c)});return Za.call(a).sort(e(function(a,
b){for(var d=0;d<c.length;d++){var e=c[d](a,b);if(0!==e)return e}return 0},d))}}function Ja(b){G(b)&&(b={link:b});b.restrict=b.restrict||"AC";return da(b)}function rd(b,a,c,d,e){var f=this,g=[],h=f.$$parentForm=b.parent().controller("form")||Jb;f.$error={};f.$$success={};f.$pending=t;f.$name=e(a.name||a.ngForm||"")(c);f.$dirty=!1;f.$pristine=!0;f.$valid=!0;f.$invalid=!1;f.$submitted=!1;h.$addControl(f);f.$rollbackViewValue=function(){s(g,function(a){a.$rollbackViewValue()})};f.$commitViewValue=function(){s(g,
function(a){a.$commitViewValue()})};f.$addControl=function(a){Ma(a.$name,"input");g.push(a);a.$name&&(f[a.$name]=a)};f.$$renameControl=function(a,b){var c=a.$name;f[c]===a&&delete f[c];f[b]=a;a.$name=b};f.$removeControl=function(a){a.$name&&f[a.$name]===a&&delete f[a.$name];s(f.$pending,function(b,c){f.$setValidity(c,null,a)});s(f.$error,function(b,c){f.$setValidity(c,null,a)});Xa(g,a)};sd({ctrl:this,$element:b,set:function(a,b,c){var d=a[b];d?-1===d.indexOf(c)&&d.push(c):a[b]=[c]},unset:function(a,
b,c){var d=a[b];d&&(Xa(d,c),0===d.length&&delete a[b])},parentForm:h,$animate:d});f.$setDirty=function(){d.removeClass(b,Sa);d.addClass(b,Kb);f.$dirty=!0;f.$pristine=!1;h.$setDirty()};f.$setPristine=function(){d.setClass(b,Sa,Kb+" ng-submitted");f.$dirty=!1;f.$pristine=!0;f.$submitted=!1;s(g,function(a){a.$setPristine()})};f.$setUntouched=function(){s(g,function(a){a.$setUntouched()})};f.$setSubmitted=function(){d.addClass(b,"ng-submitted");f.$submitted=!0;h.$setSubmitted()}}function hc(b){b.$formatters.push(function(a){return b.$isEmpty(a)?
a:a.toString()})}function ib(b,a,c,d,e,f){var g=Q(a[0].type);if(!e.android){var h=!1;a.on("compositionstart",function(a){h=!0});a.on("compositionend",function(){h=!1;l()})}var l=function(b){k&&(f.defer.cancel(k),k=null);if(!h){var e=a.val();b=b&&b.type;"password"===g||c.ngTrim&&"false"===c.ngTrim||(e=U(e));(d.$viewValue!==e||""===e&&d.$$hasNativeValidators)&&d.$setViewValue(e,b)}};if(e.hasEvent("input"))a.on("input",l);else{var k,m=function(a,b,c){k||(k=f.defer(function(){k=null;b&&b.value===c||l(a)}))};
a.on("keydown",function(a){var b=a.keyCode;91===b||15<b&&19>b||37<=b&&40>=b||m(a,this,this.value)});if(e.hasEvent("paste"))a.on("paste cut",m)}a.on("change",l);d.$render=function(){a.val(d.$isEmpty(d.$viewValue)?"":d.$viewValue)}}function Lb(b,a){return function(c,d){var e,f;if(qa(c))return c;if(F(c)){'"'==c.charAt(0)&&'"'==c.charAt(c.length-1)&&(c=c.substring(1,c.length-1));if(Nf.test(c))return new Date(c);b.lastIndex=0;if(e=b.exec(c))return e.shift(),f=d?{yyyy:d.getFullYear(),MM:d.getMonth()+1,
dd:d.getDate(),HH:d.getHours(),mm:d.getMinutes(),ss:d.getSeconds(),sss:d.getMilliseconds()/1E3}:{yyyy:1970,MM:1,dd:1,HH:0,mm:0,ss:0,sss:0},s(e,function(b,c){c<a.length&&(f[a[c]]=+b)}),new Date(f.yyyy,f.MM-1,f.dd,f.HH,f.mm,f.ss||0,1E3*f.sss||0)}return NaN}}function jb(b,a,c,d){return function(e,f,g,h,l,k,m){function p(a){return a&&!(a.getTime&&a.getTime()!==a.getTime())}function q(a){return y(a)?qa(a)?a:c(a):t}td(e,f,g,h);ib(e,f,g,h,l,k);var u=h&&h.$options&&h.$options.timezone,r;h.$$parserName=b;
h.$parsers.push(function(b){return h.$isEmpty(b)?null:a.test(b)?(b=c(b,r),"UTC"===u&&b.setMinutes(b.getMinutes()-b.getTimezoneOffset()),b):t});h.$formatters.push(function(a){if(a&&!qa(a))throw Mb("datefmt",a);if(p(a)){if((r=a)&&"UTC"===u){var b=6E4*r.getTimezoneOffset();r=new Date(r.getTime()+b)}return m("date")(a,d,u)}r=null;return""});if(y(g.min)||g.ngMin){var s;h.$validators.min=function(a){return!p(a)||A(s)||c(a)>=s};g.$observe("min",function(a){s=q(a);h.$validate()})}if(y(g.max)||g.ngMax){var n;
h.$validators.max=function(a){return!p(a)||A(n)||c(a)<=n};g.$observe("max",function(a){n=q(a);h.$validate()})}}}function td(b,a,c,d){(d.$$hasNativeValidators=I(a[0].validity))&&d.$parsers.push(function(b){var c=a.prop("validity")||{};return c.badInput&&!c.typeMismatch?t:b})}function ud(b,a,c,d,e){if(y(d)){b=b(d);if(!b.constant)throw T("ngModel")("constexpr",c,d);return b(a)}return e}function ic(b,a){b="ngClass"+b;return["$animate",function(c){function d(a,b){var c=[],d=0;a:for(;d<a.length;d++){for(var e=
a[d],m=0;m<b.length;m++)if(e==b[m])continue a;c.push(e)}return c}function e(a){if(!D(a)){if(F(a))return a.split(" ");if(I(a)){var b=[];s(a,function(a,c){a&&(b=b.concat(c.split(" ")))});return b}}return a}return{restrict:"AC",link:function(f,g,h){function l(a,b){var c=g.data("$classCounts")||{},d=[];s(a,function(a){if(0<b||c[a])c[a]=(c[a]||0)+b,c[a]===+(0<b)&&d.push(a)});g.data("$classCounts",c);return d.join(" ")}function k(b){if(!0===a||f.$index%2===a){var k=e(b||[]);if(!m){var u=l(k,1);h.$addClass(u)}else if(!fa(b,
m)){var r=e(m),u=d(k,r),k=d(r,k),u=l(u,1),k=l(k,-1);u&&u.length&&c.addClass(g,u);k&&k.length&&c.removeClass(g,k)}}m=ra(b)}var m;f.$watch(h[b],k,!0);h.$observe("class",function(a){k(f.$eval(h[b]))});"ngClass"!==b&&f.$watch("$index",function(c,d){var g=c&1;if(g!==(d&1)){var k=e(f.$eval(h[b]));g===a?(g=l(k,1),h.$addClass(g)):(g=l(k,-1),h.$removeClass(g))}})}}}]}function sd(b){function a(a,b){b&&!f[a]?(k.addClass(e,a),f[a]=!0):!b&&f[a]&&(k.removeClass(e,a),f[a]=!1)}function c(b,c){b=b?"-"+tc(b,"-"):"";
a(kb+b,!0===c);a(vd+b,!1===c)}var d=b.ctrl,e=b.$element,f={},g=b.set,h=b.unset,l=b.parentForm,k=b.$animate;f[vd]=!(f[kb]=e.hasClass(kb));d.$setValidity=function(b,e,f){e===t?(d.$pending||(d.$pending={}),g(d.$pending,b,f)):(d.$pending&&h(d.$pending,b,f),wd(d.$pending)&&(d.$pending=t));Wa(e)?e?(h(d.$error,b,f),g(d.$$success,b,f)):(g(d.$error,b,f),h(d.$$success,b,f)):(h(d.$error,b,f),h(d.$$success,b,f));d.$pending?(a(xd,!0),d.$valid=d.$invalid=t,c("",null)):(a(xd,!1),d.$valid=wd(d.$error),d.$invalid=
!d.$valid,c("",d.$valid));e=d.$pending&&d.$pending[b]?t:d.$error[b]?!1:d.$$success[b]?!0:null;c(b,e);l.$setValidity(b,e,d)}}function wd(b){if(b)for(var a in b)return!1;return!0}var Of=/^\/(.+)\/([a-z]*)$/,Q=function(b){return F(b)?b.toLowerCase():b},rc=Object.prototype.hasOwnProperty,ub=function(b){return F(b)?b.toUpperCase():b},Ra,B,sa,Za=[].slice,rf=[].splice,Pf=[].push,Da=Object.prototype.toString,Ka=T("ng"),ga=M.angular||(M.angular={}),bb,nb=0;Ra=Y.documentMode;H.$inject=[];pa.$inject=[];var D=
Array.isArray,U=function(b){return F(b)?b.trim():b},gd=function(b){return b.replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g,"\\$1").replace(/\x08/g,"\\x08")},ab=function(){if(y(ab.isActive_))return ab.isActive_;var b=!(!Y.querySelector("[ng-csp]")&&!Y.querySelector("[data-ng-csp]"));if(!b)try{new Function("")}catch(a){b=!0}return ab.isActive_=b},rb=["ng-","data-ng-","ng:","x-ng-"],Md=/[A-Z]/g,uc=!1,Pb,oa=1,pb=3,Qd={full:"1.3.9",major:1,minor:3,dot:9,codeName:"multidimensional-awareness"};R.expando="ng339";
var zb=R.cache={},hf=1;R._data=function(b){return this.cache[b[this.expando]]||{}};var cf=/([\:\-\_]+(.))/g,df=/^moz([A-Z])/,Qf={mouseleave:"mouseout",mouseenter:"mouseover"},Sb=T("jqLite"),gf=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,Rb=/<|&#?\w+;/,ef=/<([\w:]+)/,ff=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,ia={option:[1,'<select multiple="multiple">',"</select>"],thead:[1,"<table>","</table>"],col:[2,"<table><colgroup>","</colgroup></table>"],tr:[2,"<table><tbody>","</tbody></table>"],
td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:[0,"",""]};ia.optgroup=ia.option;ia.tbody=ia.tfoot=ia.colgroup=ia.caption=ia.thead;ia.th=ia.td;var La=R.prototype={ready:function(b){function a(){c||(c=!0,b())}var c=!1;"complete"===Y.readyState?setTimeout(a):(this.on("DOMContentLoaded",a),R(M).on("load",a))},toString:function(){var b=[];s(this,function(a){b.push(""+a)});return"["+b.join(", ")+"]"},eq:function(b){return 0<=b?B(this[b]):B(this[this.length+b])},length:0,push:Pf,sort:[].sort,
splice:[].splice},Eb={};s("multiple selected checked disabled readOnly required open".split(" "),function(b){Eb[Q(b)]=b});var Mc={};s("input select option textarea button form details".split(" "),function(b){Mc[b]=!0});var Nc={ngMinlength:"minlength",ngMaxlength:"maxlength",ngMin:"min",ngMax:"max",ngPattern:"pattern"};s({data:Ub,removeData:xb},function(b,a){R[a]=b});s({data:Ub,inheritedData:Db,scope:function(b){return B.data(b,"$scope")||Db(b.parentNode||b,["$isolateScope","$scope"])},isolateScope:function(b){return B.data(b,
"$isolateScope")||B.data(b,"$isolateScopeNoTemplate")},controller:Ic,injector:function(b){return Db(b,"$injector")},removeAttr:function(b,a){b.removeAttribute(a)},hasClass:Ab,css:function(b,a,c){a=cb(a);if(y(c))b.style[a]=c;else return b.style[a]},attr:function(b,a,c){var d=Q(a);if(Eb[d])if(y(c))c?(b[a]=!0,b.setAttribute(a,d)):(b[a]=!1,b.removeAttribute(d));else return b[a]||(b.attributes.getNamedItem(a)||H).specified?d:t;else if(y(c))b.setAttribute(a,c);else if(b.getAttribute)return b=b.getAttribute(a,
2),null===b?t:b},prop:function(b,a,c){if(y(c))b[a]=c;else return b[a]},text:function(){function b(a,b){if(A(b)){var d=a.nodeType;return d===oa||d===pb?a.textContent:""}a.textContent=b}b.$dv="";return b}(),val:function(b,a){if(A(a)){if(b.multiple&&"select"===ua(b)){var c=[];s(b.options,function(a){a.selected&&c.push(a.value||a.text)});return 0===c.length?null:c}return b.value}b.value=a},html:function(b,a){if(A(a))return b.innerHTML;wb(b,!0);b.innerHTML=a},empty:Jc},function(b,a){R.prototype[a]=function(a,
d){var e,f,g=this.length;if(b!==Jc&&(2==b.length&&b!==Ab&&b!==Ic?a:d)===t){if(I(a)){for(e=0;e<g;e++)if(b===Ub)b(this[e],a);else for(f in a)b(this[e],f,a[f]);return this}e=b.$dv;g=e===t?Math.min(g,1):g;for(f=0;f<g;f++){var h=b(this[f],a,d);e=e?e+h:h}return e}for(e=0;e<g;e++)b(this[e],a,d);return this}});s({removeData:xb,on:function a(c,d,e,f){if(y(f))throw Sb("onargs");if(Ec(c)){var g=yb(c,!0);f=g.events;var h=g.handle;h||(h=g.handle=lf(c,f));for(var g=0<=d.indexOf(" ")?d.split(" "):[d],l=g.length;l--;){d=
g[l];var k=f[d];k||(f[d]=[],"mouseenter"===d||"mouseleave"===d?a(c,Qf[d],function(a){var c=a.relatedTarget;c&&(c===this||this.contains(c))||h(a,d)}):"$destroy"!==d&&c.addEventListener(d,h,!1),k=f[d]);k.push(e)}}},off:Hc,one:function(a,c,d){a=B(a);a.on(c,function f(){a.off(c,d);a.off(c,f)});a.on(c,d)},replaceWith:function(a,c){var d,e=a.parentNode;wb(a);s(new R(c),function(c){d?e.insertBefore(c,d.nextSibling):e.replaceChild(c,a);d=c})},children:function(a){var c=[];s(a.childNodes,function(a){a.nodeType===
oa&&c.push(a)});return c},contents:function(a){return a.contentDocument||a.childNodes||[]},append:function(a,c){var d=a.nodeType;if(d===oa||11===d){c=new R(c);for(var d=0,e=c.length;d<e;d++)a.appendChild(c[d])}},prepend:function(a,c){if(a.nodeType===oa){var d=a.firstChild;s(new R(c),function(c){a.insertBefore(c,d)})}},wrap:function(a,c){c=B(c).eq(0).clone()[0];var d=a.parentNode;d&&d.replaceChild(c,a);c.appendChild(a)},remove:Kc,detach:function(a){Kc(a,!0)},after:function(a,c){var d=a,e=a.parentNode;
c=new R(c);for(var f=0,g=c.length;f<g;f++){var h=c[f];e.insertBefore(h,d.nextSibling);d=h}},addClass:Cb,removeClass:Bb,toggleClass:function(a,c,d){c&&s(c.split(" "),function(c){var f=d;A(f)&&(f=!Ab(a,c));(f?Cb:Bb)(a,c)})},parent:function(a){return(a=a.parentNode)&&11!==a.nodeType?a:null},next:function(a){return a.nextElementSibling},find:function(a,c){return a.getElementsByTagName?a.getElementsByTagName(c):[]},clone:Tb,triggerHandler:function(a,c,d){var e,f,g=c.type||c,h=yb(a);if(h=(h=h&&h.events)&&
h[g])e={preventDefault:function(){this.defaultPrevented=!0},isDefaultPrevented:function(){return!0===this.defaultPrevented},stopImmediatePropagation:function(){this.immediatePropagationStopped=!0},isImmediatePropagationStopped:function(){return!0===this.immediatePropagationStopped},stopPropagation:H,type:g,target:a},c.type&&(e=z(e,c)),c=ra(h),f=d?[e].concat(d):[e],s(c,function(c){e.isImmediatePropagationStopped()||c.apply(a,f)})}},function(a,c){R.prototype[c]=function(c,e,f){for(var g,h=0,l=this.length;h<
l;h++)A(g)?(g=a(this[h],c,e,f),y(g)&&(g=B(g))):Gc(g,a(this[h],c,e,f));return y(g)?g:this};R.prototype.bind=R.prototype.on;R.prototype.unbind=R.prototype.off});db.prototype={put:function(a,c){this[Na(a,this.nextUid)]=c},get:function(a){return this[Na(a,this.nextUid)]},remove:function(a){var c=this[a=Na(a,this.nextUid)];delete this[a];return c}};var Pc=/^function\s*[^\(]*\(\s*([^\)]*)\)/m,nf=/,/,of=/^\s*(_?)(\S+?)\1\s*$/,Oc=/((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg,Ga=T("$injector");Ob.$$annotate=Vb;var Rf=
T("$animate"),Ce=["$provide",function(a){this.$$selectors={};this.register=function(c,d){var e=c+"-animation";if(c&&"."!=c.charAt(0))throw Rf("notcsel",c);this.$$selectors[c.substr(1)]=e;a.factory(e,d)};this.classNameFilter=function(a){1===arguments.length&&(this.$$classNameFilter=a instanceof RegExp?a:null);return this.$$classNameFilter};this.$get=["$$q","$$asyncCallback","$rootScope",function(a,d,e){function f(d){var f,g=a.defer();g.promise.$$cancelFn=function(){f&&f()};e.$$postDigest(function(){f=
d(function(){g.resolve()})});return g.promise}function g(a,c){var d=[],e=[],f=ha();s((a.attr("class")||"").split(/\s+/),function(a){f[a]=!0});s(c,function(a,c){var g=f[c];!1===a&&g?e.push(c):!0!==a||g||d.push(c)});return 0<d.length+e.length&&[d.length?d:null,e.length?e:null]}function h(a,c,d){for(var e=0,f=c.length;e<f;++e)a[c[e]]=d}function l(){m||(m=a.defer(),d(function(){m.resolve();m=null}));return m.promise}function k(a,c){if(ga.isObject(c)){var d=z(c.from||{},c.to||{});a.css(d)}}var m;return{animate:function(a,
c,d){k(a,{from:c,to:d});return l()},enter:function(a,c,d,e){k(a,e);d?d.after(a):c.prepend(a);return l()},leave:function(a,c){a.remove();return l()},move:function(a,c,d,e){return this.enter(a,c,d,e)},addClass:function(a,c,d){return this.setClass(a,c,[],d)},$$addClassImmediately:function(a,c,d){a=B(a);c=F(c)?c:D(c)?c.join(" "):"";s(a,function(a){Cb(a,c)});k(a,d);return l()},removeClass:function(a,c,d){return this.setClass(a,[],c,d)},$$removeClassImmediately:function(a,c,d){a=B(a);c=F(c)?c:D(c)?c.join(" "):
"";s(a,function(a){Bb(a,c)});k(a,d);return l()},setClass:function(a,c,d,e){var k=this,l=!1;a=B(a);var m=a.data("$$animateClasses");m?e&&m.options&&(m.options=ga.extend(m.options||{},e)):(m={classes:{},options:e},l=!0);e=m.classes;c=D(c)?c:c.split(" ");d=D(d)?d:d.split(" ");h(e,c,!0);h(e,d,!1);l&&(m.promise=f(function(c){var d=a.data("$$animateClasses");a.removeData("$$animateClasses");if(d){var e=g(a,d.classes);e&&k.$$setClassImmediately(a,e[0],e[1],d.options)}c()}),a.data("$$animateClasses",m));
return m.promise},$$setClassImmediately:function(a,c,d,e){c&&this.$$addClassImmediately(a,c);d&&this.$$removeClassImmediately(a,d);k(a,e);return l()},enabled:H,cancel:H}}]}],ja=T("$compile");wc.$inject=["$provide","$$sanitizeUriProvider"];var Rc=/^((?:x|data)[\:\-_])/i,Vc="application/json",Zb={"Content-Type":Vc+";charset=utf-8"},tf=/^\[|^\{(?!\{)/,uf={"[":/]$/,"{":/}$/},sf=/^\)\]\}',?\n/,$b=T("$interpolate"),Sf=/^([^\?#]*)(\?([^#]*))?(#(.*))?$/,xf={http:80,https:443,ftp:21},Fb=T("$location"),Tf=
{$$html5:!1,$$replace:!1,absUrl:Gb("$$absUrl"),url:function(a){if(A(a))return this.$$url;var c=Sf.exec(a);(c[1]||""===a)&&this.path(decodeURIComponent(c[1]));(c[2]||c[1]||""===a)&&this.search(c[3]||"");this.hash(c[5]||"");return this},protocol:Gb("$$protocol"),host:Gb("$$host"),port:Gb("$$port"),path:dd("$$path",function(a){a=null!==a?a.toString():"";return"/"==a.charAt(0)?a:"/"+a}),search:function(a,c){switch(arguments.length){case 0:return this.$$search;case 1:if(F(a)||V(a))a=a.toString(),this.$$search=
qc(a);else if(I(a))a=Ea(a,{}),s(a,function(c,e){null==c&&delete a[e]}),this.$$search=a;else throw Fb("isrcharg");break;default:A(c)||null===c?delete this.$$search[a]:this.$$search[a]=c}this.$$compose();return this},hash:dd("$$hash",function(a){return null!==a?a.toString():""}),replace:function(){this.$$replace=!0;return this}};s([cd,dc,cc],function(a){a.prototype=Object.create(Tf);a.prototype.state=function(c){if(!arguments.length)return this.$$state;if(a!==cc||!this.$$html5)throw Fb("nostate");this.$$state=
A(c)?null:c;return this}});var la=T("$parse"),Uf=Function.prototype.call,Vf=Function.prototype.apply,Wf=Function.prototype.bind,lb=ha();s({"null":function(){return null},"true":function(){return!0},"false":function(){return!1},undefined:function(){}},function(a,c){a.constant=a.literal=a.sharedGetter=!0;lb[c]=a});lb["this"]=function(a){return a};lb["this"].sharedGetter=!0;var mb=z(ha(),{"+":function(a,c,d,e){d=d(a,c);e=e(a,c);return y(d)?y(e)?d+e:d:y(e)?e:t},"-":function(a,c,d,e){d=d(a,c);e=e(a,c);
return(y(d)?d:0)-(y(e)?e:0)},"*":function(a,c,d,e){return d(a,c)*e(a,c)},"/":function(a,c,d,e){return d(a,c)/e(a,c)},"%":function(a,c,d,e){return d(a,c)%e(a,c)},"===":function(a,c,d,e){return d(a,c)===e(a,c)},"!==":function(a,c,d,e){return d(a,c)!==e(a,c)},"==":function(a,c,d,e){return d(a,c)==e(a,c)},"!=":function(a,c,d,e){return d(a,c)!=e(a,c)},"<":function(a,c,d,e){return d(a,c)<e(a,c)},">":function(a,c,d,e){return d(a,c)>e(a,c)},"<=":function(a,c,d,e){return d(a,c)<=e(a,c)},">=":function(a,c,
d,e){return d(a,c)>=e(a,c)},"&&":function(a,c,d,e){return d(a,c)&&e(a,c)},"||":function(a,c,d,e){return d(a,c)||e(a,c)},"!":function(a,c,d){return!d(a,c)},"=":!0,"|":!0}),Xf={n:"\n",f:"\f",r:"\r",t:"\t",v:"\v","'":"'",'"':'"'},gc=function(a){this.options=a};gc.prototype={constructor:gc,lex:function(a){this.text=a;this.index=0;for(this.tokens=[];this.index<this.text.length;)if(a=this.text.charAt(this.index),'"'===a||"'"===a)this.readString(a);else if(this.isNumber(a)||"."===a&&this.isNumber(this.peek()))this.readNumber();
else if(this.isIdent(a))this.readIdent();else if(this.is(a,"(){}[].,;:?"))this.tokens.push({index:this.index,text:a}),this.index++;else if(this.isWhitespace(a))this.index++;else{var c=a+this.peek(),d=c+this.peek(2),e=mb[c],f=mb[d];mb[a]||e||f?(a=f?d:e?c:a,this.tokens.push({index:this.index,text:a,operator:!0}),this.index+=a.length):this.throwError("Unexpected next character ",this.index,this.index+1)}return this.tokens},is:function(a,c){return-1!==c.indexOf(a)},peek:function(a){a=a||1;return this.index+
a<this.text.length?this.text.charAt(this.index+a):!1},isNumber:function(a){return"0"<=a&&"9">=a&&"string"===typeof a},isWhitespace:function(a){return" "===a||"\r"===a||"\t"===a||"\n"===a||"\v"===a||"\u00a0"===a},isIdent:function(a){return"a"<=a&&"z">=a||"A"<=a&&"Z">=a||"_"===a||"$"===a},isExpOperator:function(a){return"-"===a||"+"===a||this.isNumber(a)},throwError:function(a,c,d){d=d||this.index;c=y(c)?"s "+c+"-"+this.index+" ["+this.text.substring(c,d)+"]":" "+d;throw la("lexerr",a,c,this.text);
},readNumber:function(){for(var a="",c=this.index;this.index<this.text.length;){var d=Q(this.text.charAt(this.index));if("."==d||this.isNumber(d))a+=d;else{var e=this.peek();if("e"==d&&this.isExpOperator(e))a+=d;else if(this.isExpOperator(d)&&e&&this.isNumber(e)&&"e"==a.charAt(a.length-1))a+=d;else if(!this.isExpOperator(d)||e&&this.isNumber(e)||"e"!=a.charAt(a.length-1))break;else this.throwError("Invalid exponent")}this.index++}this.tokens.push({index:c,text:a,constant:!0,value:Number(a)})},readIdent:function(){for(var a=
this.index;this.index<this.text.length;){var c=this.text.charAt(this.index);if(!this.isIdent(c)&&!this.isNumber(c))break;this.index++}this.tokens.push({index:a,text:this.text.slice(a,this.index),identifier:!0})},readString:function(a){var c=this.index;this.index++;for(var d="",e=a,f=!1;this.index<this.text.length;){var g=this.text.charAt(this.index),e=e+g;if(f)"u"===g?(f=this.text.substring(this.index+1,this.index+5),f.match(/[\da-f]{4}/i)||this.throwError("Invalid unicode escape [\\u"+f+"]"),this.index+=
4,d+=String.fromCharCode(parseInt(f,16))):d+=Xf[g]||g,f=!1;else if("\\"===g)f=!0;else{if(g===a){this.index++;this.tokens.push({index:c,text:e,constant:!0,value:d});return}d+=g}this.index++}this.throwError("Unterminated quote",c)}};var hb=function(a,c,d){this.lexer=a;this.$filter=c;this.options=d};hb.ZERO=z(function(){return 0},{sharedGetter:!0,constant:!0});hb.prototype={constructor:hb,parse:function(a){this.text=a;this.tokens=this.lexer.lex(a);a=this.statements();0!==this.tokens.length&&this.throwError("is an unexpected token",
this.tokens[0]);a.literal=!!a.literal;a.constant=!!a.constant;return a},primary:function(){var a;this.expect("(")?(a=this.filterChain(),this.consume(")")):this.expect("[")?a=this.arrayDeclaration():this.expect("{")?a=this.object():this.peek().identifier&&this.peek().text in lb?a=lb[this.consume().text]:this.peek().identifier?a=this.identifier():this.peek().constant?a=this.constant():this.throwError("not a primary expression",this.peek());for(var c,d;c=this.expect("(","[",".");)"("===c.text?(a=this.functionCall(a,
d),d=null):"["===c.text?(d=a,a=this.objectIndex(a)):"."===c.text?(d=a,a=this.fieldAccess(a)):this.throwError("IMPOSSIBLE");return a},throwError:function(a,c){throw la("syntax",c.text,a,c.index+1,this.text,this.text.substring(c.index));},peekToken:function(){if(0===this.tokens.length)throw la("ueoe",this.text);return this.tokens[0]},peek:function(a,c,d,e){return this.peekAhead(0,a,c,d,e)},peekAhead:function(a,c,d,e,f){if(this.tokens.length>a){a=this.tokens[a];var g=a.text;if(g===c||g===d||g===e||g===
f||!(c||d||e||f))return a}return!1},expect:function(a,c,d,e){return(a=this.peek(a,c,d,e))?(this.tokens.shift(),a):!1},consume:function(a){if(0===this.tokens.length)throw la("ueoe",this.text);var c=this.expect(a);c||this.throwError("is unexpected, expecting ["+a+"]",this.peek());return c},unaryFn:function(a,c){var d=mb[a];return z(function(a,f){return d(a,f,c)},{constant:c.constant,inputs:[c]})},binaryFn:function(a,c,d,e){var f=mb[c];return z(function(c,e){return f(c,e,a,d)},{constant:a.constant&&
d.constant,inputs:!e&&[a,d]})},identifier:function(){for(var a=this.consume().text;this.peek(".")&&this.peekAhead(1).identifier&&!this.peekAhead(2,"(");)a+=this.consume().text+this.consume().text;return zf(a,this.options,this.text)},constant:function(){var a=this.consume().value;return z(function(){return a},{constant:!0,literal:!0})},statements:function(){for(var a=[];;)if(0<this.tokens.length&&!this.peek("}",")",";","]")&&a.push(this.filterChain()),!this.expect(";"))return 1===a.length?a[0]:function(c,
d){for(var e,f=0,g=a.length;f<g;f++)e=a[f](c,d);return e}},filterChain:function(){for(var a=this.expression();this.expect("|");)a=this.filter(a);return a},filter:function(a){var c=this.$filter(this.consume().text),d,e;if(this.peek(":"))for(d=[],e=[];this.expect(":");)d.push(this.expression());var f=[a].concat(d||[]);return z(function(f,h){var l=a(f,h);if(e){e[0]=l;for(l=d.length;l--;)e[l+1]=d[l](f,h);return c.apply(t,e)}return c(l)},{constant:!c.$stateful&&f.every(ec),inputs:!c.$stateful&&f})},expression:function(){return this.assignment()},
assignment:function(){var a=this.ternary(),c,d;return(d=this.expect("="))?(a.assign||this.throwError("implies assignment but ["+this.text.substring(0,d.index)+"] can not be assigned to",d),c=this.ternary(),z(function(d,f){return a.assign(d,c(d,f),f)},{inputs:[a,c]})):a},ternary:function(){var a=this.logicalOR(),c;if(this.expect("?")&&(c=this.assignment(),this.consume(":"))){var d=this.assignment();return z(function(e,f){return a(e,f)?c(e,f):d(e,f)},{constant:a.constant&&c.constant&&d.constant})}return a},
logicalOR:function(){for(var a=this.logicalAND(),c;c=this.expect("||");)a=this.binaryFn(a,c.text,this.logicalAND(),!0);return a},logicalAND:function(){for(var a=this.equality(),c;c=this.expect("&&");)a=this.binaryFn(a,c.text,this.equality(),!0);return a},equality:function(){for(var a=this.relational(),c;c=this.expect("==","!=","===","!==");)a=this.binaryFn(a,c.text,this.relational());return a},relational:function(){for(var a=this.additive(),c;c=this.expect("<",">","<=",">=");)a=this.binaryFn(a,c.text,
this.additive());return a},additive:function(){for(var a=this.multiplicative(),c;c=this.expect("+","-");)a=this.binaryFn(a,c.text,this.multiplicative());return a},multiplicative:function(){for(var a=this.unary(),c;c=this.expect("*","/","%");)a=this.binaryFn(a,c.text,this.unary());return a},unary:function(){var a;return this.expect("+")?this.primary():(a=this.expect("-"))?this.binaryFn(hb.ZERO,a.text,this.unary()):(a=this.expect("!"))?this.unaryFn(a.text,this.unary()):this.primary()},fieldAccess:function(a){var c=
this.identifier();return z(function(d,e,f){d=f||a(d,e);return null==d?t:c(d)},{assign:function(d,e,f){var g=a(d,f);g||a.assign(d,g={},f);return c.assign(g,e)}})},objectIndex:function(a){var c=this.text,d=this.expression();this.consume("]");return z(function(e,f){var g=a(e,f),h=d(e,f);ta(h,c);return g?ma(g[h],c):t},{assign:function(e,f,g){var h=ta(d(e,g),c),l=ma(a(e,g),c);l||a.assign(e,l={},g);return l[h]=f}})},functionCall:function(a,c){var d=[];if(")"!==this.peekToken().text){do d.push(this.expression());
while(this.expect(","))}this.consume(")");var e=this.text,f=d.length?[]:null;return function(g,h){var l=c?c(g,h):y(c)?t:g,k=a(g,h,l)||H;if(f)for(var m=d.length;m--;)f[m]=ma(d[m](g,h),e);ma(l,e);if(k){if(k.constructor===k)throw la("isecfn",e);if(k===Uf||k===Vf||k===Wf)throw la("isecff",e);}l=k.apply?k.apply(l,f):k(f[0],f[1],f[2],f[3],f[4]);return ma(l,e)}},arrayDeclaration:function(){var a=[];if("]"!==this.peekToken().text){do{if(this.peek("]"))break;a.push(this.expression())}while(this.expect(","))
}this.consume("]");return z(function(c,d){for(var e=[],f=0,g=a.length;f<g;f++)e.push(a[f](c,d));return e},{literal:!0,constant:a.every(ec),inputs:a})},object:function(){var a=[],c=[];if("}"!==this.peekToken().text){do{if(this.peek("}"))break;var d=this.consume();d.constant?a.push(d.value):d.identifier?a.push(d.text):this.throwError("invalid key",d);this.consume(":");c.push(this.expression())}while(this.expect(","))}this.consume("}");return z(function(d,f){for(var g={},h=0,l=c.length;h<l;h++)g[a[h]]=
c[h](d,f);return g},{literal:!0,constant:c.every(ec),inputs:c})}};var Bf=ha(),Af=ha(),Cf=Object.prototype.valueOf,Ca=T("$sce"),na={HTML:"html",CSS:"css",URL:"url",RESOURCE_URL:"resourceUrl",JS:"js"},ja=T("$compile"),Z=Y.createElement("a"),id=Ba(M.location.href);Dc.$inject=["$provide"];jd.$inject=["$locale"];ld.$inject=["$locale"];var od=".",Mf={yyyy:$("FullYear",4),yy:$("FullYear",2,0,!0),y:$("FullYear",1),MMMM:Ib("Month"),MMM:Ib("Month",!0),MM:$("Month",2,1),M:$("Month",1,1),dd:$("Date",2),d:$("Date",
1),HH:$("Hours",2),H:$("Hours",1),hh:$("Hours",2,-12),h:$("Hours",1,-12),mm:$("Minutes",2),m:$("Minutes",1),ss:$("Seconds",2),s:$("Seconds",1),sss:$("Milliseconds",3),EEEE:Ib("Day"),EEE:Ib("Day",!0),a:function(a,c){return 12>a.getHours()?c.AMPMS[0]:c.AMPMS[1]},Z:function(a){a=-1*a.getTimezoneOffset();return a=(0<=a?"+":"")+(Hb(Math[0<a?"floor":"ceil"](a/60),2)+Hb(Math.abs(a%60),2))},ww:qd(2),w:qd(1)},Lf=/((?:[^yMdHhmsaZEw']+)|(?:'(?:[^']|'')*')|(?:E+|y+|M+|d+|H+|h+|m+|s+|a|Z|w+))(.*)/,Kf=/^\-?\d+$/;
kd.$inject=["$locale"];var Hf=da(Q),If=da(ub);md.$inject=["$parse"];var Td=da({restrict:"E",compile:function(a,c){if(!c.href&&!c.xlinkHref&&!c.name)return function(a,c){var f="[object SVGAnimatedString]"===Da.call(c.prop("href"))?"xlink:href":"href";c.on("click",function(a){c.attr(f)||a.preventDefault()})}}}),vb={};s(Eb,function(a,c){if("multiple"!=a){var d=ya("ng-"+c);vb[d]=function(){return{restrict:"A",priority:100,link:function(a,f,g){a.$watch(g[d],function(a){g.$set(c,!!a)})}}}}});s(Nc,function(a,
c){vb[c]=function(){return{priority:100,link:function(a,e,f){if("ngPattern"===c&&"/"==f.ngPattern.charAt(0)&&(e=f.ngPattern.match(Of))){f.$set("ngPattern",new RegExp(e[1],e[2]));return}a.$watch(f[c],function(a){f.$set(c,a)})}}}});s(["src","srcset","href"],function(a){var c=ya("ng-"+a);vb[c]=function(){return{priority:99,link:function(d,e,f){var g=a,h=a;"href"===a&&"[object SVGAnimatedString]"===Da.call(e.prop("href"))&&(h="xlinkHref",f.$attr[h]="xlink:href",g=null);f.$observe(c,function(c){c?(f.$set(h,
c),Ra&&g&&e.prop(g,f[h])):"href"===a&&f.$set(h,null)})}}}});var Jb={$addControl:H,$$renameControl:function(a,c){a.$name=c},$removeControl:H,$setValidity:H,$setDirty:H,$setPristine:H,$setSubmitted:H};rd.$inject=["$element","$attrs","$scope","$animate","$interpolate"];var yd=function(a){return["$timeout",function(c){return{name:"form",restrict:a?"EAC":"E",controller:rd,compile:function(a){a.addClass(Sa).addClass(kb);return{pre:function(a,d,g,h){if(!("action"in g)){var l=function(c){a.$apply(function(){h.$commitViewValue();
h.$setSubmitted()});c.preventDefault()};d[0].addEventListener("submit",l,!1);d.on("$destroy",function(){c(function(){d[0].removeEventListener("submit",l,!1)},0,!1)})}var k=h.$$parentForm,m=h.$name;m&&(gb(a,null,m,h,m),g.$observe(g.name?"name":"ngForm",function(c){m!==c&&(gb(a,null,m,t,m),m=c,gb(a,null,m,h,m),k.$$renameControl(h,m))}));d.on("$destroy",function(){k.$removeControl(h);m&&gb(a,null,m,t,m);z(h,Jb)})}}}}}]},Ud=yd(),ge=yd(!0),Nf=/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/,
Yf=/^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/,Zf=/^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i,$f=/^\s*(\-|\+)?(\d+|(\d*(\.\d*)))\s*$/,zd=/^(\d{4})-(\d{2})-(\d{2})$/,Ad=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/,jc=/^(\d{4})-W(\d\d)$/,Bd=/^(\d{4})-(\d\d)$/,Cd=/^(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/,Dd={text:function(a,c,d,e,f,g){ib(a,c,d,e,f,g);hc(e)},date:jb("date",zd,Lb(zd,["yyyy",
"MM","dd"]),"yyyy-MM-dd"),"datetime-local":jb("datetimelocal",Ad,Lb(Ad,"yyyy MM dd HH mm ss sss".split(" ")),"yyyy-MM-ddTHH:mm:ss.sss"),time:jb("time",Cd,Lb(Cd,["HH","mm","ss","sss"]),"HH:mm:ss.sss"),week:jb("week",jc,function(a,c){if(qa(a))return a;if(F(a)){jc.lastIndex=0;var d=jc.exec(a);if(d){var e=+d[1],f=+d[2],g=d=0,h=0,l=0,k=pd(e),f=7*(f-1);c&&(d=c.getHours(),g=c.getMinutes(),h=c.getSeconds(),l=c.getMilliseconds());return new Date(e,0,k.getDate()+f,d,g,h,l)}}return NaN},"yyyy-Www"),month:jb("month",
Bd,Lb(Bd,["yyyy","MM"]),"yyyy-MM"),number:function(a,c,d,e,f,g){td(a,c,d,e);ib(a,c,d,e,f,g);e.$$parserName="number";e.$parsers.push(function(a){return e.$isEmpty(a)?null:$f.test(a)?parseFloat(a):t});e.$formatters.push(function(a){if(!e.$isEmpty(a)){if(!V(a))throw Mb("numfmt",a);a=a.toString()}return a});if(d.min||d.ngMin){var h;e.$validators.min=function(a){return e.$isEmpty(a)||A(h)||a>=h};d.$observe("min",function(a){y(a)&&!V(a)&&(a=parseFloat(a,10));h=V(a)&&!isNaN(a)?a:t;e.$validate()})}if(d.max||
d.ngMax){var l;e.$validators.max=function(a){return e.$isEmpty(a)||A(l)||a<=l};d.$observe("max",function(a){y(a)&&!V(a)&&(a=parseFloat(a,10));l=V(a)&&!isNaN(a)?a:t;e.$validate()})}},url:function(a,c,d,e,f,g){ib(a,c,d,e,f,g);hc(e);e.$$parserName="url";e.$validators.url=function(a,c){var d=a||c;return e.$isEmpty(d)||Yf.test(d)}},email:function(a,c,d,e,f,g){ib(a,c,d,e,f,g);hc(e);e.$$parserName="email";e.$validators.email=function(a,c){var d=a||c;return e.$isEmpty(d)||Zf.test(d)}},radio:function(a,c,
d,e){A(d.name)&&c.attr("name",++nb);c.on("click",function(a){c[0].checked&&e.$setViewValue(d.value,a&&a.type)});e.$render=function(){c[0].checked=d.value==e.$viewValue};d.$observe("value",e.$render)},checkbox:function(a,c,d,e,f,g,h,l){var k=ud(l,a,"ngTrueValue",d.ngTrueValue,!0),m=ud(l,a,"ngFalseValue",d.ngFalseValue,!1);c.on("click",function(a){e.$setViewValue(c[0].checked,a&&a.type)});e.$render=function(){c[0].checked=e.$viewValue};e.$isEmpty=function(a){return!1===a};e.$formatters.push(function(a){return fa(a,
k)});e.$parsers.push(function(a){return a?k:m})},hidden:H,button:H,submit:H,reset:H,file:H},xc=["$browser","$sniffer","$filter","$parse",function(a,c,d,e){return{restrict:"E",require:["?ngModel"],link:{pre:function(f,g,h,l){l[0]&&(Dd[Q(h.type)]||Dd.text)(f,g,h,l[0],c,a,d,e)}}}}],ag=/^(true|false|\d+)$/,ye=function(){return{restrict:"A",priority:100,compile:function(a,c){return ag.test(c.ngValue)?function(a,c,f){f.$set("value",a.$eval(f.ngValue))}:function(a,c,f){a.$watch(f.ngValue,function(a){f.$set("value",
a)})}}}},Zd=["$compile",function(a){return{restrict:"AC",compile:function(c){a.$$addBindingClass(c);return function(c,e,f){a.$$addBindingInfo(e,f.ngBind);e=e[0];c.$watch(f.ngBind,function(a){e.textContent=a===t?"":a})}}}}],ae=["$interpolate","$compile",function(a,c){return{compile:function(d){c.$$addBindingClass(d);return function(d,f,g){d=a(f.attr(g.$attr.ngBindTemplate));c.$$addBindingInfo(f,d.expressions);f=f[0];g.$observe("ngBindTemplate",function(a){f.textContent=a===t?"":a})}}}}],$d=["$sce",
"$parse","$compile",function(a,c,d){return{restrict:"A",compile:function(e,f){var g=c(f.ngBindHtml),h=c(f.ngBindHtml,function(a){return(a||"").toString()});d.$$addBindingClass(e);return function(c,e,f){d.$$addBindingInfo(e,f.ngBindHtml);c.$watch(h,function(){e.html(a.getTrustedHtml(g(c))||"")})}}}}],xe=da({restrict:"A",require:"ngModel",link:function(a,c,d,e){e.$viewChangeListeners.push(function(){a.$eval(d.ngChange)})}}),be=ic("",!0),de=ic("Odd",0),ce=ic("Even",1),ee=Ja({compile:function(a,c){c.$set("ngCloak",
t);a.removeClass("ng-cloak")}}),fe=[function(){return{restrict:"A",scope:!0,controller:"@",priority:500}}],Cc={},bg={blur:!0,focus:!0};s("click dblclick mousedown mouseup mouseover mouseout mousemove mouseenter mouseleave keydown keyup keypress submit focus blur copy cut paste".split(" "),function(a){var c=ya("ng-"+a);Cc[c]=["$parse","$rootScope",function(d,e){return{restrict:"A",compile:function(f,g){var h=d(g[c],null,!0);return function(c,d){d.on(a,function(d){var f=function(){h(c,{$event:d})};
bg[a]&&e.$$phase?c.$evalAsync(f):c.$apply(f)})}}}}]});var ie=["$animate",function(a){return{multiElement:!0,transclude:"element",priority:600,terminal:!0,restrict:"A",$$tlb:!0,link:function(c,d,e,f,g){var h,l,k;c.$watch(e.ngIf,function(c){c?l||g(function(c,f){l=f;c[c.length++]=Y.createComment(" end ngIf: "+e.ngIf+" ");h={clone:c};a.enter(c,d.parent(),d)}):(k&&(k.remove(),k=null),l&&(l.$destroy(),l=null),h&&(k=tb(h.clone),a.leave(k).then(function(){k=null}),h=null))})}}}],je=["$templateRequest","$anchorScroll",
"$animate","$sce",function(a,c,d,e){return{restrict:"ECA",priority:400,terminal:!0,transclude:"element",controller:ga.noop,compile:function(f,g){var h=g.ngInclude||g.src,l=g.onload||"",k=g.autoscroll;return function(f,g,q,s,r){var t=0,n,v,w,L=function(){v&&(v.remove(),v=null);n&&(n.$destroy(),n=null);w&&(d.leave(w).then(function(){v=null}),v=w,w=null)};f.$watch(e.parseAsResourceUrl(h),function(e){var h=function(){!y(k)||k&&!f.$eval(k)||c()},q=++t;e?(a(e,!0).then(function(a){if(q===t){var c=f.$new();
s.template=a;a=r(c,function(a){L();d.enter(a,null,g).then(h)});n=c;w=a;n.$emit("$includeContentLoaded",e);f.$eval(l)}},function(){q===t&&(L(),f.$emit("$includeContentError",e))}),f.$emit("$includeContentRequested",e)):(L(),s.template=null)})}}}}],Ae=["$compile",function(a){return{restrict:"ECA",priority:-400,require:"ngInclude",link:function(c,d,e,f){/SVG/.test(d[0].toString())?(d.empty(),a(Fc(f.template,Y).childNodes)(c,function(a){d.append(a)},{futureParentElement:d})):(d.html(f.template),a(d.contents())(c))}}}],
ke=Ja({priority:450,compile:function(){return{pre:function(a,c,d){a.$eval(d.ngInit)}}}}),we=function(){return{restrict:"A",priority:100,require:"ngModel",link:function(a,c,d,e){var f=c.attr(d.$attr.ngList)||", ",g="false"!==d.ngTrim,h=g?U(f):f;e.$parsers.push(function(a){if(!A(a)){var c=[];a&&s(a.split(h),function(a){a&&c.push(g?U(a):a)});return c}});e.$formatters.push(function(a){return D(a)?a.join(f):t});e.$isEmpty=function(a){return!a||!a.length}}}},kb="ng-valid",vd="ng-invalid",Sa="ng-pristine",
Kb="ng-dirty",xd="ng-pending",Mb=new T("ngModel"),cg=["$scope","$exceptionHandler","$attrs","$element","$parse","$animate","$timeout","$rootScope","$q","$interpolate",function(a,c,d,e,f,g,h,l,k,m){this.$modelValue=this.$viewValue=Number.NaN;this.$$rawModelValue=t;this.$validators={};this.$asyncValidators={};this.$parsers=[];this.$formatters=[];this.$viewChangeListeners=[];this.$untouched=!0;this.$touched=!1;this.$pristine=!0;this.$dirty=!1;this.$valid=!0;this.$invalid=!1;this.$error={};this.$$success=
{};this.$pending=t;this.$name=m(d.name||"",!1)(a);var p=f(d.ngModel),q=p.assign,u=p,r=q,O=null,n=this;this.$$setOptions=function(a){if((n.$options=a)&&a.getterSetter){var c=f(d.ngModel+"()"),g=f(d.ngModel+"($$$p)");u=function(a){var d=p(a);G(d)&&(d=c(a));return d};r=function(a,c){G(p(a))?g(a,{$$$p:n.$modelValue}):q(a,n.$modelValue)}}else if(!p.assign)throw Mb("nonassign",d.ngModel,va(e));};this.$render=H;this.$isEmpty=function(a){return A(a)||""===a||null===a||a!==a};var v=e.inheritedData("$formController")||
Jb,w=0;sd({ctrl:this,$element:e,set:function(a,c){a[c]=!0},unset:function(a,c){delete a[c]},parentForm:v,$animate:g});this.$setPristine=function(){n.$dirty=!1;n.$pristine=!0;g.removeClass(e,Kb);g.addClass(e,Sa)};this.$setDirty=function(){n.$dirty=!0;n.$pristine=!1;g.removeClass(e,Sa);g.addClass(e,Kb);v.$setDirty()};this.$setUntouched=function(){n.$touched=!1;n.$untouched=!0;g.setClass(e,"ng-untouched","ng-touched")};this.$setTouched=function(){n.$touched=!0;n.$untouched=!1;g.setClass(e,"ng-touched",
"ng-untouched")};this.$rollbackViewValue=function(){h.cancel(O);n.$viewValue=n.$$lastCommittedViewValue;n.$render()};this.$validate=function(){if(!V(n.$modelValue)||!isNaN(n.$modelValue)){var a=n.$$rawModelValue,c=n.$valid,d=n.$modelValue,e=n.$options&&n.$options.allowInvalid;n.$$runValidators(n.$error[n.$$parserName||"parse"]?!1:t,a,n.$$lastCommittedViewValue,function(f){e||c===f||(n.$modelValue=f?a:t,n.$modelValue!==d&&n.$$writeModelToScope())})}};this.$$runValidators=function(a,c,d,e){function f(){var a=
!0;s(n.$validators,function(e,f){var g=e(c,d);a=a&&g;h(f,g)});return a?!0:(s(n.$asyncValidators,function(a,c){h(c,null)}),!1)}function g(){var a=[],e=!0;s(n.$asyncValidators,function(f,g){var l=f(c,d);if(!l||!G(l.then))throw Mb("$asyncValidators",l);h(g,t);a.push(l.then(function(){h(g,!0)},function(a){e=!1;h(g,!1)}))});a.length?k.all(a).then(function(){l(e)},H):l(!0)}function h(a,c){m===w&&n.$setValidity(a,c)}function l(a){m===w&&e(a)}w++;var m=w;(function(a){var c=n.$$parserName||"parse";if(a===
t)h(c,null);else if(h(c,a),!a)return s(n.$validators,function(a,c){h(c,null)}),s(n.$asyncValidators,function(a,c){h(c,null)}),!1;return!0})(a)?f()?g():l(!1):l(!1)};this.$commitViewValue=function(){var a=n.$viewValue;h.cancel(O);if(n.$$lastCommittedViewValue!==a||""===a&&n.$$hasNativeValidators)n.$$lastCommittedViewValue=a,n.$pristine&&this.$setDirty(),this.$$parseAndValidate()};this.$$parseAndValidate=function(){var c=n.$$lastCommittedViewValue,d=A(c)?t:!0;if(d)for(var e=0;e<n.$parsers.length;e++)if(c=
n.$parsers[e](c),A(c)){d=!1;break}V(n.$modelValue)&&isNaN(n.$modelValue)&&(n.$modelValue=u(a));var f=n.$modelValue,g=n.$options&&n.$options.allowInvalid;n.$$rawModelValue=c;g&&(n.$modelValue=c,n.$modelValue!==f&&n.$$writeModelToScope());n.$$runValidators(d,c,n.$$lastCommittedViewValue,function(a){g||(n.$modelValue=a?c:t,n.$modelValue!==f&&n.$$writeModelToScope())})};this.$$writeModelToScope=function(){r(a,n.$modelValue);s(n.$viewChangeListeners,function(a){try{a()}catch(d){c(d)}})};this.$setViewValue=
function(a,c){n.$viewValue=a;n.$options&&!n.$options.updateOnDefault||n.$$debounceViewValueCommit(c)};this.$$debounceViewValueCommit=function(c){var d=0,e=n.$options;e&&y(e.debounce)&&(e=e.debounce,V(e)?d=e:V(e[c])?d=e[c]:V(e["default"])&&(d=e["default"]));h.cancel(O);d?O=h(function(){n.$commitViewValue()},d):l.$$phase?n.$commitViewValue():a.$apply(function(){n.$commitViewValue()})};a.$watch(function(){var c=u(a);if(c!==n.$modelValue){n.$modelValue=n.$$rawModelValue=c;for(var d=n.$formatters,e=d.length,
f=c;e--;)f=d[e](f);n.$viewValue!==f&&(n.$viewValue=n.$$lastCommittedViewValue=f,n.$render(),n.$$runValidators(t,c,f,H))}return c})}],ve=["$rootScope",function(a){return{restrict:"A",require:["ngModel","^?form","^?ngModelOptions"],controller:cg,priority:1,compile:function(c){c.addClass(Sa).addClass("ng-untouched").addClass(kb);return{pre:function(a,c,f,g){var h=g[0],l=g[1]||Jb;h.$$setOptions(g[2]&&g[2].$options);l.$addControl(h);f.$observe("name",function(a){h.$name!==a&&l.$$renameControl(h,a)});a.$on("$destroy",
function(){l.$removeControl(h)})},post:function(c,e,f,g){var h=g[0];if(h.$options&&h.$options.updateOn)e.on(h.$options.updateOn,function(a){h.$$debounceViewValueCommit(a&&a.type)});e.on("blur",function(e){h.$touched||(a.$$phase?c.$evalAsync(h.$setTouched):c.$apply(h.$setTouched))})}}}}}],dg=/(\s+|^)default(\s+|$)/,ze=function(){return{restrict:"A",controller:["$scope","$attrs",function(a,c){var d=this;this.$options=a.$eval(c.ngModelOptions);this.$options.updateOn!==t?(this.$options.updateOnDefault=
!1,this.$options.updateOn=U(this.$options.updateOn.replace(dg,function(){d.$options.updateOnDefault=!0;return" "}))):this.$options.updateOnDefault=!0}]}},le=Ja({terminal:!0,priority:1E3}),me=["$locale","$interpolate",function(a,c){var d=/{}/g,e=/^when(Minus)?(.+)$/;return{restrict:"EA",link:function(f,g,h){function l(a){g.text(a||"")}var k=h.count,m=h.$attr.when&&g.attr(h.$attr.when),p=h.offset||0,q=f.$eval(m)||{},u={},m=c.startSymbol(),r=c.endSymbol(),t=m+k+"-"+p+r,n=ga.noop,v;s(h,function(a,c){var d=
e.exec(c);d&&(d=(d[1]?"-":"")+Q(d[2]),q[d]=g.attr(h.$attr[c]))});s(q,function(a,e){u[e]=c(a.replace(d,t))});f.$watch(k,function(c){c=parseFloat(c);var d=isNaN(c);d||c in q||(c=a.pluralCat(c-p));c===v||d&&isNaN(v)||(n(),n=f.$watch(u[c],l),v=c)})}}}],ne=["$parse","$animate",function(a,c){var d=T("ngRepeat"),e=function(a,c,d,e,k,m,p){a[d]=e;k&&(a[k]=m);a.$index=c;a.$first=0===c;a.$last=c===p-1;a.$middle=!(a.$first||a.$last);a.$odd=!(a.$even=0===(c&1))};return{restrict:"A",multiElement:!0,transclude:"element",
priority:1E3,terminal:!0,$$tlb:!0,compile:function(f,g){var h=g.ngRepeat,l=Y.createComment(" end ngRepeat: "+h+" "),k=h.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);if(!k)throw d("iexp",h);var m=k[1],p=k[2],q=k[3],u=k[4],k=m.match(/^(?:(\s*[\$\w]+)|\(\s*([\$\w]+)\s*,\s*([\$\w]+)\s*\))$/);if(!k)throw d("iidexp",m);var r=k[3]||k[1],y=k[2];if(q&&(!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(q)||/^(null|undefined|this|\$index|\$first|\$middle|\$last|\$even|\$odd|\$parent)$/.test(q)))throw d("badident",
q);var n,v,w,A,z={$id:Na};u?n=a(u):(w=function(a,c){return Na(c)},A=function(a){return a});return function(a,f,g,k,m){n&&(v=function(c,d,e){y&&(z[y]=c);z[r]=d;z.$index=e;return n(a,z)});var u=ha();a.$watchCollection(p,function(g){var k,p,n=f[0],E,z=ha(),H,S,N,D,G,C,I;q&&(a[q]=g);if(Ta(g))G=g,p=v||w;else{p=v||A;G=[];for(I in g)g.hasOwnProperty(I)&&"$"!=I.charAt(0)&&G.push(I);G.sort()}H=G.length;I=Array(H);for(k=0;k<H;k++)if(S=g===G?k:G[k],N=g[S],D=p(S,N,k),u[D])C=u[D],delete u[D],z[D]=C,I[k]=C;else{if(z[D])throw s(I,
function(a){a&&a.scope&&(u[a.id]=a)}),d("dupes",h,D,N);I[k]={id:D,scope:t,clone:t};z[D]=!0}for(E in u){C=u[E];D=tb(C.clone);c.leave(D);if(D[0].parentNode)for(k=0,p=D.length;k<p;k++)D[k].$$NG_REMOVED=!0;C.scope.$destroy()}for(k=0;k<H;k++)if(S=g===G?k:G[k],N=g[S],C=I[k],C.scope){E=n;do E=E.nextSibling;while(E&&E.$$NG_REMOVED);C.clone[0]!=E&&c.move(tb(C.clone),null,B(n));n=C.clone[C.clone.length-1];e(C.scope,k,r,N,y,S,H)}else m(function(a,d){C.scope=d;var f=l.cloneNode(!1);a[a.length++]=f;c.enter(a,
null,B(n));n=f;C.clone=a;z[C.id]=C;e(C.scope,k,r,N,y,S,H)});u=z})}}}}],oe=["$animate",function(a){return{restrict:"A",multiElement:!0,link:function(c,d,e){c.$watch(e.ngShow,function(c){a[c?"removeClass":"addClass"](d,"ng-hide",{tempClasses:"ng-hide-animate"})})}}}],he=["$animate",function(a){return{restrict:"A",multiElement:!0,link:function(c,d,e){c.$watch(e.ngHide,function(c){a[c?"addClass":"removeClass"](d,"ng-hide",{tempClasses:"ng-hide-animate"})})}}}],pe=Ja(function(a,c,d){a.$watchCollection(d.ngStyle,
function(a,d){d&&a!==d&&s(d,function(a,d){c.css(d,"")});a&&c.css(a)})}),qe=["$animate",function(a){return{restrict:"EA",require:"ngSwitch",controller:["$scope",function(){this.cases={}}],link:function(c,d,e,f){var g=[],h=[],l=[],k=[],m=function(a,c){return function(){a.splice(c,1)}};c.$watch(e.ngSwitch||e.on,function(c){var d,e;d=0;for(e=l.length;d<e;++d)a.cancel(l[d]);d=l.length=0;for(e=k.length;d<e;++d){var r=tb(h[d].clone);k[d].$destroy();(l[d]=a.leave(r)).then(m(l,d))}h.length=0;k.length=0;(g=
f.cases["!"+c]||f.cases["?"])&&s(g,function(c){c.transclude(function(d,e){k.push(e);var f=c.element;d[d.length++]=Y.createComment(" end ngSwitchWhen: ");h.push({clone:d});a.enter(d,f.parent(),f)})})})}}}],re=Ja({transclude:"element",priority:1200,require:"^ngSwitch",multiElement:!0,link:function(a,c,d,e,f){e.cases["!"+d.ngSwitchWhen]=e.cases["!"+d.ngSwitchWhen]||[];e.cases["!"+d.ngSwitchWhen].push({transclude:f,element:c})}}),se=Ja({transclude:"element",priority:1200,require:"^ngSwitch",multiElement:!0,
link:function(a,c,d,e,f){e.cases["?"]=e.cases["?"]||[];e.cases["?"].push({transclude:f,element:c})}}),ue=Ja({restrict:"EAC",link:function(a,c,d,e,f){if(!f)throw T("ngTransclude")("orphan",va(c));f(function(a){c.empty();c.append(a)})}}),Vd=["$templateCache",function(a){return{restrict:"E",terminal:!0,compile:function(c,d){"text/ng-template"==d.type&&a.put(d.id,c[0].text)}}}],eg=T("ngOptions"),te=da({restrict:"A",terminal:!0}),Wd=["$compile","$parse",function(a,c){var d=/^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/,
e={$setViewValue:H};return{restrict:"E",require:["select","?ngModel"],controller:["$element","$scope","$attrs",function(a,c,d){var l=this,k={},m=e,p;l.databound=d.ngModel;l.init=function(a,c,d){m=a;p=d};l.addOption=function(c,d){Ma(c,'"option value"');k[c]=!0;m.$viewValue==c&&(a.val(c),p.parent()&&p.remove());d&&d[0].hasAttribute("selected")&&(d[0].selected=!0)};l.removeOption=function(a){this.hasOption(a)&&(delete k[a],m.$viewValue===a&&this.renderUnknownOption(a))};l.renderUnknownOption=function(c){c=
"? "+Na(c)+" ?";p.val(c);a.prepend(p);a.val(c);p.prop("selected",!0)};l.hasOption=function(a){return k.hasOwnProperty(a)};c.$on("$destroy",function(){l.renderUnknownOption=H})}],link:function(e,g,h,l){function k(a,c,d,e){d.$render=function(){var a=d.$viewValue;e.hasOption(a)?(C.parent()&&C.remove(),c.val(a),""===a&&n.prop("selected",!0)):A(a)&&n?c.val(""):e.renderUnknownOption(a)};c.on("change",function(){a.$apply(function(){C.parent()&&C.remove();d.$setViewValue(c.val())})})}function m(a,c,d){var e;
d.$render=function(){var a=new db(d.$viewValue);s(c.find("option"),function(c){c.selected=y(a.get(c.value))})};a.$watch(function(){fa(e,d.$viewValue)||(e=ra(d.$viewValue),d.$render())});c.on("change",function(){a.$apply(function(){var a=[];s(c.find("option"),function(c){c.selected&&a.push(c.value)});d.$setViewValue(a)})})}function p(e,f,g){function h(a,c,d){T[x]=d;G&&(T[G]=c);return a(e,T)}function k(a){var c;if(u)if(M&&D(a)){c=new db([]);for(var d=0;d<a.length;d++)c.put(h(M,null,a[d]),!0)}else c=
new db(a);else M&&(a=h(M,null,a));return function(d,e){var f;f=M?M:B?B:F;return u?y(c.remove(h(f,d,e))):a===h(f,d,e)}}function l(){v||(e.$$postDigest(p),v=!0)}function m(a,c,d){a[c]=a[c]||0;a[c]+=d?1:-1}function p(){v=!1;var a={"":[]},c=[""],d,l,n,r,t;n=g.$viewValue;r=P(e)||[];var B=G?Object.keys(r).sort():r,x,A,D,F,N={};t=k(n);var J=!1,U,V;Q={};for(F=0;D=B.length,F<D;F++){x=F;if(G&&(x=B[F],"$"===x.charAt(0)))continue;A=r[x];d=h(I,x,A)||"";(l=a[d])||(l=a[d]=[],c.push(d));d=t(x,A);J=J||d;A=h(C,x,A);
A=y(A)?A:"";V=M?M(e,T):G?B[F]:F;M&&(Q[V]=x);l.push({id:V,label:A,selected:d})}u||(z||null===n?a[""].unshift({id:"",label:"",selected:!J}):J||a[""].unshift({id:"?",label:"",selected:!0}));x=0;for(B=c.length;x<B;x++){d=c[x];l=a[d];R.length<=x?(n={element:H.clone().attr("label",d),label:l.label},r=[n],R.push(r),f.append(n.element)):(r=R[x],n=r[0],n.label!=d&&n.element.attr("label",n.label=d));J=null;F=0;for(D=l.length;F<D;F++)d=l[F],(t=r[F+1])?(J=t.element,t.label!==d.label&&(m(N,t.label,!1),m(N,d.label,
!0),J.text(t.label=d.label),J.prop("label",t.label)),t.id!==d.id&&J.val(t.id=d.id),J[0].selected!==d.selected&&(J.prop("selected",t.selected=d.selected),Ra&&J.prop("selected",t.selected))):(""===d.id&&z?U=z:(U=w.clone()).val(d.id).prop("selected",d.selected).attr("selected",d.selected).prop("label",d.label).text(d.label),r.push(t={element:U,label:d.label,id:d.id,selected:d.selected}),m(N,d.label,!0),J?J.after(U):n.element.append(U),J=U);for(F++;r.length>F;)d=r.pop(),m(N,d.label,!1),d.element.remove()}for(;R.length>
x;){l=R.pop();for(F=1;F<l.length;++F)m(N,l[F].label,!1);l[0].element.remove()}s(N,function(a,c){0<a?q.addOption(c):0>a&&q.removeOption(c)})}var n;if(!(n=r.match(d)))throw eg("iexp",r,va(f));var C=c(n[2]||n[1]),x=n[4]||n[6],A=/ as /.test(n[0])&&n[1],B=A?c(A):null,G=n[5],I=c(n[3]||""),F=c(n[2]?n[1]:x),P=c(n[7]),M=n[8]?c(n[8]):null,Q={},R=[[{element:f,label:""}]],T={};z&&(a(z)(e),z.removeClass("ng-scope"),z.remove());f.empty();f.on("change",function(){e.$apply(function(){var a=P(e)||[],c;if(u)c=[],s(f.val(),
function(d){d=M?Q[d]:d;c.push("?"===d?t:""===d?null:h(B?B:F,d,a[d]))});else{var d=M?Q[f.val()]:f.val();c="?"===d?t:""===d?null:h(B?B:F,d,a[d])}g.$setViewValue(c);p()})});g.$render=p;e.$watchCollection(P,l);e.$watchCollection(function(){var a=P(e),c;if(a&&D(a)){c=Array(a.length);for(var d=0,f=a.length;d<f;d++)c[d]=h(C,d,a[d])}else if(a)for(d in c={},a)a.hasOwnProperty(d)&&(c[d]=h(C,d,a[d]));return c},l);u&&e.$watchCollection(function(){return g.$modelValue},l)}if(l[1]){var q=l[0];l=l[1];var u=h.multiple,
r=h.ngOptions,z=!1,n,v=!1,w=B(Y.createElement("option")),H=B(Y.createElement("optgroup")),C=w.clone();h=0;for(var x=g.children(),G=x.length;h<G;h++)if(""===x[h].value){n=z=x.eq(h);break}q.init(l,z,C);u&&(l.$isEmpty=function(a){return!a||0===a.length});r?p(e,g,l):u?m(e,g,l):k(e,g,l,q)}}}}],Yd=["$interpolate",function(a){var c={addOption:H,removeOption:H};return{restrict:"E",priority:100,compile:function(d,e){if(A(e.value)){var f=a(d.text(),!0);f||e.$set("value",d.text())}return function(a,d,e){var k=
d.parent(),m=k.data("$selectController")||k.parent().data("$selectController");m&&m.databound||(m=c);f?a.$watch(f,function(a,c){e.$set("value",a);c!==a&&m.removeOption(c);m.addOption(a,d)}):m.addOption(e.value,d);d.on("$destroy",function(){m.removeOption(e.value)})}}}}],Xd=da({restrict:"E",terminal:!1}),zc=function(){return{restrict:"A",require:"?ngModel",link:function(a,c,d,e){e&&(d.required=!0,e.$validators.required=function(a,c){return!d.required||!e.$isEmpty(c)},d.$observe("required",function(){e.$validate()}))}}},
yc=function(){return{restrict:"A",require:"?ngModel",link:function(a,c,d,e){if(e){var f,g=d.ngPattern||d.pattern;d.$observe("pattern",function(a){F(a)&&0<a.length&&(a=new RegExp("^"+a+"$"));if(a&&!a.test)throw T("ngPattern")("noregexp",g,a,va(c));f=a||t;e.$validate()});e.$validators.pattern=function(a){return e.$isEmpty(a)||A(f)||f.test(a)}}}}},Bc=function(){return{restrict:"A",require:"?ngModel",link:function(a,c,d,e){if(e){var f=-1;d.$observe("maxlength",function(a){a=ba(a);f=isNaN(a)?-1:a;e.$validate()});
e.$validators.maxlength=function(a,c){return 0>f||e.$isEmpty(a)||c.length<=f}}}}},Ac=function(){return{restrict:"A",require:"?ngModel",link:function(a,c,d,e){if(e){var f=0;d.$observe("minlength",function(a){f=ba(a)||0;e.$validate()});e.$validators.minlength=function(a,c){return e.$isEmpty(c)||c.length>=f}}}}};M.angular.bootstrap?console.log("WARNING: Tried to load angular more than once."):(Nd(),Pd(ga),B(Y).ready(function(){Jd(Y,sc)}))})(window,document);!window.angular.$$csp()&&window.angular.element(document).find("head").prepend('<style type="text/css">@charset "UTF-8";[ng\\:cloak],[ng-cloak],[data-ng-cloak],[x-ng-cloak],.ng-cloak,.x-ng-cloak,.ng-hide:not(.ng-hide-animate){display:none !important;}ng\\:form{display:block;}</style>');
//# sourceMappingURL=angular.min.js.map
;
define("angular", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.angular;
    };
}(this)));

/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    
    define('home/home-ctrl',[], function () {
        var HomeController = function ($scope, loginService) {
            $scope.welcome = "You are not authorized.";
        };

        return ["$scope", "LoginService", HomeController];
    });
}());
/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    
    define('login/login-ctrl',[], function () {
        var LoginCtrl = function ($scope, loginService) {
            $scope.welcome = "You are not authorized.";
            loginService.registerForm(function (command) {
                $scope.showLogin = command;
            });
            $scope.$on('$locationChangeStart', function (event, next, current) {
                loginService.hideForm();
            });

        };

        return ["$scope", "LoginService", LoginCtrl];
    });
}());
/**
 * State-based routing for AngularJS
 * @version v0.2.13
 * @link http://angular-ui.github.com/
 * @license MIT License, http://www.opensource.org/licenses/MIT
 */
"undefined"!=typeof module&&"undefined"!=typeof exports&&module.exports===exports&&(module.exports="ui.router"),function(a,b,c){function d(a,b){return M(new(M(function(){},{prototype:a})),b)}function e(a){return L(arguments,function(b){b!==a&&L(b,function(b,c){a.hasOwnProperty(c)||(a[c]=b)})}),a}function f(a,b){var c=[];for(var d in a.path){if(a.path[d]!==b.path[d])break;c.push(a.path[d])}return c}function g(a){if(Object.keys)return Object.keys(a);var c=[];return b.forEach(a,function(a,b){c.push(b)}),c}function h(a,b){if(Array.prototype.indexOf)return a.indexOf(b,Number(arguments[2])||0);var c=a.length>>>0,d=Number(arguments[2])||0;for(d=0>d?Math.ceil(d):Math.floor(d),0>d&&(d+=c);c>d;d++)if(d in a&&a[d]===b)return d;return-1}function i(a,b,c,d){var e,i=f(c,d),j={},k=[];for(var l in i)if(i[l].params&&(e=g(i[l].params),e.length))for(var m in e)h(k,e[m])>=0||(k.push(e[m]),j[e[m]]=a[e[m]]);return M({},j,b)}function j(a,b,c){if(!c){c=[];for(var d in a)c.push(d)}for(var e=0;e<c.length;e++){var f=c[e];if(a[f]!=b[f])return!1}return!0}function k(a,b){var c={};return L(a,function(a){c[a]=b[a]}),c}function l(a){var b={},c=Array.prototype.concat.apply(Array.prototype,Array.prototype.slice.call(arguments,1));for(var d in a)-1==h(c,d)&&(b[d]=a[d]);return b}function m(a,b){var c=K(a),d=c?[]:{};return L(a,function(a,e){b(a,e)&&(d[c?d.length:e]=a)}),d}function n(a,b){var c=K(a)?[]:{};return L(a,function(a,d){c[d]=b(a,d)}),c}function o(a,b){var d=1,f=2,i={},j=[],k=i,m=M(a.when(i),{$$promises:i,$$values:i});this.study=function(i){function n(a,c){if(s[c]!==f){if(r.push(c),s[c]===d)throw r.splice(0,h(r,c)),new Error("Cyclic dependency: "+r.join(" -> "));if(s[c]=d,I(a))q.push(c,[function(){return b.get(a)}],j);else{var e=b.annotate(a);L(e,function(a){a!==c&&i.hasOwnProperty(a)&&n(i[a],a)}),q.push(c,a,e)}r.pop(),s[c]=f}}function o(a){return J(a)&&a.then&&a.$$promises}if(!J(i))throw new Error("'invocables' must be an object");var p=g(i||{}),q=[],r=[],s={};return L(i,n),i=r=s=null,function(d,f,g){function h(){--u||(v||e(t,f.$$values),r.$$values=t,r.$$promises=r.$$promises||!0,delete r.$$inheritedValues,n.resolve(t))}function i(a){r.$$failure=a,n.reject(a)}function j(c,e,f){function j(a){l.reject(a),i(a)}function k(){if(!G(r.$$failure))try{l.resolve(b.invoke(e,g,t)),l.promise.then(function(a){t[c]=a,h()},j)}catch(a){j(a)}}var l=a.defer(),m=0;L(f,function(a){s.hasOwnProperty(a)&&!d.hasOwnProperty(a)&&(m++,s[a].then(function(b){t[a]=b,--m||k()},j))}),m||k(),s[c]=l.promise}if(o(d)&&g===c&&(g=f,f=d,d=null),d){if(!J(d))throw new Error("'locals' must be an object")}else d=k;if(f){if(!o(f))throw new Error("'parent' must be a promise returned by $resolve.resolve()")}else f=m;var n=a.defer(),r=n.promise,s=r.$$promises={},t=M({},d),u=1+q.length/3,v=!1;if(G(f.$$failure))return i(f.$$failure),r;f.$$inheritedValues&&e(t,l(f.$$inheritedValues,p)),M(s,f.$$promises),f.$$values?(v=e(t,l(f.$$values,p)),r.$$inheritedValues=l(f.$$values,p),h()):(f.$$inheritedValues&&(r.$$inheritedValues=l(f.$$inheritedValues,p)),f.then(h,i));for(var w=0,x=q.length;x>w;w+=3)d.hasOwnProperty(q[w])?h():j(q[w],q[w+1],q[w+2]);return r}},this.resolve=function(a,b,c,d){return this.study(a)(b,c,d)}}function p(a,b,c){this.fromConfig=function(a,b,c){return G(a.template)?this.fromString(a.template,b):G(a.templateUrl)?this.fromUrl(a.templateUrl,b):G(a.templateProvider)?this.fromProvider(a.templateProvider,b,c):null},this.fromString=function(a,b){return H(a)?a(b):a},this.fromUrl=function(c,d){return H(c)&&(c=c(d)),null==c?null:a.get(c,{cache:b,headers:{Accept:"text/html"}}).then(function(a){return a.data})},this.fromProvider=function(a,b,d){return c.invoke(a,null,d||{params:b})}}function q(a,b,e){function f(b,c,d,e){if(q.push(b),o[b])return o[b];if(!/^\w+(-+\w+)*(?:\[\])?$/.test(b))throw new Error("Invalid parameter name '"+b+"' in pattern '"+a+"'");if(p[b])throw new Error("Duplicate parameter name '"+b+"' in pattern '"+a+"'");return p[b]=new O.Param(b,c,d,e),p[b]}function g(a,b,c){var d=["",""],e=a.replace(/[\\\[\]\^$*+?.()|{}]/g,"\\$&");if(!b)return e;switch(c){case!1:d=["(",")"];break;case!0:d=["?(",")?"];break;default:d=["("+c+"|",")?"]}return e+d[0]+b+d[1]}function h(c,e){var f,g,h,i,j;return f=c[2]||c[3],j=b.params[f],h=a.substring(m,c.index),g=e?c[4]:c[4]||("*"==c[1]?".*":null),i=O.type(g||"string")||d(O.type("string"),{pattern:new RegExp(g)}),{id:f,regexp:g,segment:h,type:i,cfg:j}}b=M({params:{}},J(b)?b:{});var i,j=/([:*])([\w\[\]]+)|\{([\w\[\]]+)(?:\:((?:[^{}\\]+|\\.|\{(?:[^{}\\]+|\\.)*\})+))?\}/g,k=/([:]?)([\w\[\]-]+)|\{([\w\[\]-]+)(?:\:((?:[^{}\\]+|\\.|\{(?:[^{}\\]+|\\.)*\})+))?\}/g,l="^",m=0,n=this.segments=[],o=e?e.params:{},p=this.params=e?e.params.$$new():new O.ParamSet,q=[];this.source=a;for(var r,s,t;(i=j.exec(a))&&(r=h(i,!1),!(r.segment.indexOf("?")>=0));)s=f(r.id,r.type,r.cfg,"path"),l+=g(r.segment,s.type.pattern.source,s.squash),n.push(r.segment),m=j.lastIndex;t=a.substring(m);var u=t.indexOf("?");if(u>=0){var v=this.sourceSearch=t.substring(u);if(t=t.substring(0,u),this.sourcePath=a.substring(0,m+u),v.length>0)for(m=0;i=k.exec(v);)r=h(i,!0),s=f(r.id,r.type,r.cfg,"search"),m=j.lastIndex}else this.sourcePath=a,this.sourceSearch="";l+=g(t)+(b.strict===!1?"/?":"")+"$",n.push(t),this.regexp=new RegExp(l,b.caseInsensitive?"i":c),this.prefix=n[0],this.$$paramNames=q}function r(a){M(this,a)}function s(){function a(a){return null!=a?a.toString().replace(/\//g,"%2F"):a}function e(a){return null!=a?a.toString().replace(/%2F/g,"/"):a}function f(a){return this.pattern.test(a)}function i(){return{strict:t,caseInsensitive:p}}function j(a){return H(a)||K(a)&&H(a[a.length-1])}function k(){for(;x.length;){var a=x.shift();if(a.pattern)throw new Error("You cannot override a type's .pattern at runtime.");b.extend(v[a.name],o.invoke(a.def))}}function l(a){M(this,a||{})}O=this;var o,p=!1,t=!0,u=!1,v={},w=!0,x=[],y={string:{encode:a,decode:e,is:f,pattern:/[^/]*/},"int":{encode:a,decode:function(a){return parseInt(a,10)},is:function(a){return G(a)&&this.decode(a.toString())===a},pattern:/\d+/},bool:{encode:function(a){return a?1:0},decode:function(a){return 0!==parseInt(a,10)},is:function(a){return a===!0||a===!1},pattern:/0|1/},date:{encode:function(a){return this.is(a)?[a.getFullYear(),("0"+(a.getMonth()+1)).slice(-2),("0"+a.getDate()).slice(-2)].join("-"):c},decode:function(a){if(this.is(a))return a;var b=this.capture.exec(a);return b?new Date(b[1],b[2]-1,b[3]):c},is:function(a){return a instanceof Date&&!isNaN(a.valueOf())},equals:function(a,b){return this.is(a)&&this.is(b)&&a.toISOString()===b.toISOString()},pattern:/[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[1-2][0-9]|3[0-1])/,capture:/([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])/},json:{encode:b.toJson,decode:b.fromJson,is:b.isObject,equals:b.equals,pattern:/[^/]*/},any:{encode:b.identity,decode:b.identity,is:b.identity,equals:b.equals,pattern:/.*/}};s.$$getDefaultValue=function(a){if(!j(a.value))return a.value;if(!o)throw new Error("Injectable functions cannot be called at configuration time");return o.invoke(a.value)},this.caseInsensitive=function(a){return G(a)&&(p=a),p},this.strictMode=function(a){return G(a)&&(t=a),t},this.defaultSquashPolicy=function(a){if(!G(a))return u;if(a!==!0&&a!==!1&&!I(a))throw new Error("Invalid squash policy: "+a+". Valid policies: false, true, arbitrary-string");return u=a,a},this.compile=function(a,b){return new q(a,M(i(),b))},this.isMatcher=function(a){if(!J(a))return!1;var b=!0;return L(q.prototype,function(c,d){H(c)&&(b=b&&G(a[d])&&H(a[d]))}),b},this.type=function(a,b,c){if(!G(b))return v[a];if(v.hasOwnProperty(a))throw new Error("A type named '"+a+"' has already been defined.");return v[a]=new r(M({name:a},b)),c&&(x.push({name:a,def:c}),w||k()),this},L(y,function(a,b){v[b]=new r(M({name:b},a))}),v=d(v,{}),this.$get=["$injector",function(a){return o=a,w=!1,k(),L(y,function(a,b){v[b]||(v[b]=new r(a))}),this}],this.Param=function(a,b,d,e){function f(a){var b=J(a)?g(a):[],c=-1===h(b,"value")&&-1===h(b,"type")&&-1===h(b,"squash")&&-1===h(b,"array");return c&&(a={value:a}),a.$$fn=j(a.value)?a.value:function(){return a.value},a}function i(b,c,d){if(b.type&&c)throw new Error("Param '"+a+"' has two type configurations.");return c?c:b.type?b.type instanceof r?b.type:new r(b.type):"config"===d?v.any:v.string}function k(){var b={array:"search"===e?"auto":!1},c=a.match(/\[\]$/)?{array:!0}:{};return M(b,c,d).array}function l(a,b){var c=a.squash;if(!b||c===!1)return!1;if(!G(c)||null==c)return u;if(c===!0||I(c))return c;throw new Error("Invalid squash policy: '"+c+"'. Valid policies: false, true, or arbitrary string")}function p(a,b,d,e){var f,g,i=[{from:"",to:d||b?c:""},{from:null,to:d||b?c:""}];return f=K(a.replace)?a.replace:[],I(e)&&f.push({from:e,to:c}),g=n(f,function(a){return a.from}),m(i,function(a){return-1===h(g,a.from)}).concat(f)}function q(){if(!o)throw new Error("Injectable functions cannot be called at configuration time");return o.invoke(d.$$fn)}function s(a){function b(a){return function(b){return b.from===a}}function c(a){var c=n(m(w.replace,b(a)),function(a){return a.to});return c.length?c[0]:a}return a=c(a),G(a)?w.type.decode(a):q()}function t(){return"{Param:"+a+" "+b+" squash: '"+z+"' optional: "+y+"}"}var w=this;d=f(d),b=i(d,b,e);var x=k();b=x?b.$asArray(x,"search"===e):b,"string"!==b.name||x||"path"!==e||d.value!==c||(d.value="");var y=d.value!==c,z=l(d,y),A=p(d,x,y,z);M(this,{id:a,type:b,location:e,array:x,squash:z,replace:A,isOptional:y,value:s,dynamic:c,config:d,toString:t})},l.prototype={$$new:function(){return d(this,M(new l,{$$parent:this}))},$$keys:function(){for(var a=[],b=[],c=this,d=g(l.prototype);c;)b.push(c),c=c.$$parent;return b.reverse(),L(b,function(b){L(g(b),function(b){-1===h(a,b)&&-1===h(d,b)&&a.push(b)})}),a},$$values:function(a){var b={},c=this;return L(c.$$keys(),function(d){b[d]=c[d].value(a&&a[d])}),b},$$equals:function(a,b){var c=!0,d=this;return L(d.$$keys(),function(e){var f=a&&a[e],g=b&&b[e];d[e].type.equals(f,g)||(c=!1)}),c},$$validates:function(a){var b,c,d,e=!0,f=this;return L(this.$$keys(),function(g){d=f[g],c=a[g],b=!c&&d.isOptional,e=e&&(b||!!d.type.is(c))}),e},$$parent:c},this.ParamSet=l}function t(a,d){function e(a){var b=/^\^((?:\\[^a-zA-Z0-9]|[^\\\[\]\^$*+?.()|{}]+)*)/.exec(a.source);return null!=b?b[1].replace(/\\(.)/g,"$1"):""}function f(a,b){return a.replace(/\$(\$|\d{1,2})/,function(a,c){return b["$"===c?0:Number(c)]})}function g(a,b,c){if(!c)return!1;var d=a.invoke(b,b,{$match:c});return G(d)?d:!0}function h(d,e,f,g){function h(a,b,c){return"/"===p?a:b?p.slice(0,-1)+a:c?p.slice(1)+a:a}function m(a){function b(a){var b=a(f,d);return b?(I(b)&&d.replace().url(b),!0):!1}if(!a||!a.defaultPrevented){var e=o&&d.url()===o;if(o=c,e)return!0;var g,h=j.length;for(g=0;h>g;g++)if(b(j[g]))return;k&&b(k)}}function n(){return i=i||e.$on("$locationChangeSuccess",m)}var o,p=g.baseHref(),q=d.url();return l||n(),{sync:function(){m()},listen:function(){return n()},update:function(a){return a?void(q=d.url()):void(d.url()!==q&&(d.url(q),d.replace()))},push:function(a,b,e){d.url(a.format(b||{})),o=e&&e.$$avoidResync?d.url():c,e&&e.replace&&d.replace()},href:function(c,e,f){if(!c.validates(e))return null;var g=a.html5Mode();b.isObject(g)&&(g=g.enabled);var i=c.format(e);if(f=f||{},g||null===i||(i="#"+a.hashPrefix()+i),i=h(i,g,f.absolute),!f.absolute||!i)return i;var j=!g&&i?"/":"",k=d.port();return k=80===k||443===k?"":":"+k,[d.protocol(),"://",d.host(),k,j,i].join("")}}}var i,j=[],k=null,l=!1;this.rule=function(a){if(!H(a))throw new Error("'rule' must be a function");return j.push(a),this},this.otherwise=function(a){if(I(a)){var b=a;a=function(){return b}}else if(!H(a))throw new Error("'rule' must be a function");return k=a,this},this.when=function(a,b){var c,h=I(b);if(I(a)&&(a=d.compile(a)),!h&&!H(b)&&!K(b))throw new Error("invalid 'handler' in when()");var i={matcher:function(a,b){return h&&(c=d.compile(b),b=["$match",function(a){return c.format(a)}]),M(function(c,d){return g(c,b,a.exec(d.path(),d.search()))},{prefix:I(a.prefix)?a.prefix:""})},regex:function(a,b){if(a.global||a.sticky)throw new Error("when() RegExp must not be global or sticky");return h&&(c=b,b=["$match",function(a){return f(c,a)}]),M(function(c,d){return g(c,b,a.exec(d.path()))},{prefix:e(a)})}},j={matcher:d.isMatcher(a),regex:a instanceof RegExp};for(var k in j)if(j[k])return this.rule(i[k](a,b));throw new Error("invalid 'what' in when()")},this.deferIntercept=function(a){a===c&&(a=!0),l=a},this.$get=h,h.$inject=["$location","$rootScope","$injector","$browser"]}function u(a,e){function f(a){return 0===a.indexOf(".")||0===a.indexOf("^")}function l(a,b){if(!a)return c;var d=I(a),e=d?a:a.name,g=f(e);if(g){if(!b)throw new Error("No reference point given for path '"+e+"'");b=l(b);for(var h=e.split("."),i=0,j=h.length,k=b;j>i;i++)if(""!==h[i]||0!==i){if("^"!==h[i])break;if(!k.parent)throw new Error("Path '"+e+"' not valid for state '"+b.name+"'");k=k.parent}else k=b;h=h.slice(i).join("."),e=k.name+(k.name&&h?".":"")+h}var m=y[e];return!m||!d&&(d||m!==a&&m.self!==a)?c:m}function m(a,b){z[a]||(z[a]=[]),z[a].push(b)}function o(a){for(var b=z[a]||[];b.length;)p(b.shift())}function p(b){b=d(b,{self:b,resolve:b.resolve||{},toString:function(){return this.name}});var c=b.name;if(!I(c)||c.indexOf("@")>=0)throw new Error("State must have a valid name");if(y.hasOwnProperty(c))throw new Error("State '"+c+"'' is already defined");var e=-1!==c.indexOf(".")?c.substring(0,c.lastIndexOf(".")):I(b.parent)?b.parent:J(b.parent)&&I(b.parent.name)?b.parent.name:"";if(e&&!y[e])return m(e,b.self);for(var f in B)H(B[f])&&(b[f]=B[f](b,B.$delegates[f]));return y[c]=b,!b[A]&&b.url&&a.when(b.url,["$match","$stateParams",function(a,c){x.$current.navigable==b&&j(a,c)||x.transitionTo(b,a,{inherit:!0,location:!1})}]),o(c),b}function q(a){return a.indexOf("*")>-1}function r(a){var b=a.split("."),c=x.$current.name.split(".");if("**"===b[0]&&(c=c.slice(h(c,b[1])),c.unshift("**")),"**"===b[b.length-1]&&(c.splice(h(c,b[b.length-2])+1,Number.MAX_VALUE),c.push("**")),b.length!=c.length)return!1;for(var d=0,e=b.length;e>d;d++)"*"===b[d]&&(c[d]="*");return c.join("")===b.join("")}function s(a,b){return I(a)&&!G(b)?B[a]:H(b)&&I(a)?(B[a]&&!B.$delegates[a]&&(B.$delegates[a]=B[a]),B[a]=b,this):this}function t(a,b){return J(a)?b=a:b.name=a,p(b),this}function u(a,e,f,h,m,o,p){function s(b,c,d,f){var g=a.$broadcast("$stateNotFound",b,c,d);if(g.defaultPrevented)return p.update(),B;if(!g.retry)return null;if(f.$retry)return p.update(),C;var h=x.transition=e.when(g.retry);return h.then(function(){return h!==x.transition?u:(b.options.$retry=!0,x.transitionTo(b.to,b.toParams,b.options))},function(){return B}),p.update(),h}function t(a,c,d,g,i,j){var l=d?c:k(a.params.$$keys(),c),n={$stateParams:l};i.resolve=m.resolve(a.resolve,n,i.resolve,a);var o=[i.resolve.then(function(a){i.globals=a})];return g&&o.push(g),L(a.views,function(c,d){var e=c.resolve&&c.resolve!==a.resolve?c.resolve:{};e.$template=[function(){return f.load(d,{view:c,locals:n,params:l,notify:j.notify})||""}],o.push(m.resolve(e,n,i.resolve,a).then(function(f){if(H(c.controllerProvider)||K(c.controllerProvider)){var g=b.extend({},e,n);f.$$controller=h.invoke(c.controllerProvider,null,g)}else f.$$controller=c.controller;f.$$state=a,f.$$controllerAs=c.controllerAs,i[d]=f}))}),e.all(o).then(function(){return i})}var u=e.reject(new Error("transition superseded")),z=e.reject(new Error("transition prevented")),B=e.reject(new Error("transition aborted")),C=e.reject(new Error("transition failed"));return w.locals={resolve:null,globals:{$stateParams:{}}},x={params:{},current:w.self,$current:w,transition:null},x.reload=function(){return x.transitionTo(x.current,o,{reload:!0,inherit:!1,notify:!0})},x.go=function(a,b,c){return x.transitionTo(a,b,M({inherit:!0,relative:x.$current},c))},x.transitionTo=function(b,c,f){c=c||{},f=M({location:!0,inherit:!1,relative:null,notify:!0,reload:!1,$retry:!1},f||{});var g,j=x.$current,m=x.params,n=j.path,q=l(b,f.relative);if(!G(q)){var r={to:b,toParams:c,options:f},y=s(r,j.self,m,f);if(y)return y;if(b=r.to,c=r.toParams,f=r.options,q=l(b,f.relative),!G(q)){if(!f.relative)throw new Error("No such state '"+b+"'");throw new Error("Could not resolve '"+b+"' from state '"+f.relative+"'")}}if(q[A])throw new Error("Cannot transition to abstract state '"+b+"'");if(f.inherit&&(c=i(o,c||{},x.$current,q)),!q.params.$$validates(c))return C;c=q.params.$$values(c),b=q;var B=b.path,D=0,E=B[D],F=w.locals,H=[];if(!f.reload)for(;E&&E===n[D]&&E.ownParams.$$equals(c,m);)F=H[D]=E.locals,D++,E=B[D];if(v(b,j,F,f))return b.self.reloadOnSearch!==!1&&p.update(),x.transition=null,e.when(x.current);if(c=k(b.params.$$keys(),c||{}),f.notify&&a.$broadcast("$stateChangeStart",b.self,c,j.self,m).defaultPrevented)return p.update(),z;for(var I=e.when(F),J=D;J<B.length;J++,E=B[J])F=H[J]=d(F),I=t(E,c,E===b,I,F,f);var K=x.transition=I.then(function(){var d,e,g;if(x.transition!==K)return u;for(d=n.length-1;d>=D;d--)g=n[d],g.self.onExit&&h.invoke(g.self.onExit,g.self,g.locals.globals),g.locals=null;for(d=D;d<B.length;d++)e=B[d],e.locals=H[d],e.self.onEnter&&h.invoke(e.self.onEnter,e.self,e.locals.globals);return x.transition!==K?u:(x.$current=b,x.current=b.self,x.params=c,N(x.params,o),x.transition=null,f.location&&b.navigable&&p.push(b.navigable.url,b.navigable.locals.globals.$stateParams,{$$avoidResync:!0,replace:"replace"===f.location}),f.notify&&a.$broadcast("$stateChangeSuccess",b.self,c,j.self,m),p.update(!0),x.current)},function(d){return x.transition!==K?u:(x.transition=null,g=a.$broadcast("$stateChangeError",b.self,c,j.self,m,d),g.defaultPrevented||p.update(),e.reject(d))});return K},x.is=function(a,b,d){d=M({relative:x.$current},d||{});var e=l(a,d.relative);return G(e)?x.$current!==e?!1:b?j(e.params.$$values(b),o):!0:c},x.includes=function(a,b,d){if(d=M({relative:x.$current},d||{}),I(a)&&q(a)){if(!r(a))return!1;a=x.$current.name}var e=l(a,d.relative);return G(e)?G(x.$current.includes[e.name])?b?j(e.params.$$values(b),o,g(b)):!0:!1:c},x.href=function(a,b,d){d=M({lossy:!0,inherit:!0,absolute:!1,relative:x.$current},d||{});var e=l(a,d.relative);if(!G(e))return null;d.inherit&&(b=i(o,b||{},x.$current,e));var f=e&&d.lossy?e.navigable:e;return f&&f.url!==c&&null!==f.url?p.href(f.url,k(e.params.$$keys(),b||{}),{absolute:d.absolute}):null},x.get=function(a,b){if(0===arguments.length)return n(g(y),function(a){return y[a].self});var c=l(a,b||x.$current);return c&&c.self?c.self:null},x}function v(a,b,c,d){return a!==b||(c!==b.locals||d.reload)&&a.self.reloadOnSearch!==!1?void 0:!0}var w,x,y={},z={},A="abstract",B={parent:function(a){if(G(a.parent)&&a.parent)return l(a.parent);var b=/^(.+)\.[^.]+$/.exec(a.name);return b?l(b[1]):w},data:function(a){return a.parent&&a.parent.data&&(a.data=a.self.data=M({},a.parent.data,a.data)),a.data},url:function(a){var b=a.url,c={params:a.params||{}};if(I(b))return"^"==b.charAt(0)?e.compile(b.substring(1),c):(a.parent.navigable||w).url.concat(b,c);if(!b||e.isMatcher(b))return b;throw new Error("Invalid url '"+b+"' in state '"+a+"'")},navigable:function(a){return a.url?a:a.parent?a.parent.navigable:null},ownParams:function(a){var b=a.url&&a.url.params||new O.ParamSet;return L(a.params||{},function(a,c){b[c]||(b[c]=new O.Param(c,null,a,"config"))}),b},params:function(a){return a.parent&&a.parent.params?M(a.parent.params.$$new(),a.ownParams):new O.ParamSet},views:function(a){var b={};return L(G(a.views)?a.views:{"":a},function(c,d){d.indexOf("@")<0&&(d+="@"+a.parent.name),b[d]=c}),b},path:function(a){return a.parent?a.parent.path.concat(a):[]},includes:function(a){var b=a.parent?M({},a.parent.includes):{};return b[a.name]=!0,b},$delegates:{}};w=p({name:"",url:"^",views:null,"abstract":!0}),w.navigable=null,this.decorator=s,this.state=t,this.$get=u,u.$inject=["$rootScope","$q","$view","$injector","$resolve","$stateParams","$urlRouter","$location","$urlMatcherFactory"]}function v(){function a(a,b){return{load:function(c,d){var e,f={template:null,controller:null,view:null,locals:null,notify:!0,async:!0,params:{}};return d=M(f,d),d.view&&(e=b.fromConfig(d.view,d.params,d.locals)),e&&d.notify&&a.$broadcast("$viewContentLoading",d),e}}}this.$get=a,a.$inject=["$rootScope","$templateFactory"]}function w(){var a=!1;this.useAnchorScroll=function(){a=!0},this.$get=["$anchorScroll","$timeout",function(b,c){return a?b:function(a){c(function(){a[0].scrollIntoView()},0,!1)}}]}function x(a,c,d,e){function f(){return c.has?function(a){return c.has(a)?c.get(a):null}:function(a){try{return c.get(a)}catch(b){return null}}}function g(a,b){var c=function(){return{enter:function(a,b,c){b.after(a),c()},leave:function(a,b){a.remove(),b()}}};if(j)return{enter:function(a,b,c){var d=j.enter(a,null,b,c);d&&d.then&&d.then(c)},leave:function(a,b){var c=j.leave(a,b);c&&c.then&&c.then(b)}};if(i){var d=i&&i(b,a);return{enter:function(a,b,c){d.enter(a,null,b),c()},leave:function(a,b){d.leave(a),b()}}}return c()}var h=f(),i=h("$animator"),j=h("$animate"),k={restrict:"ECA",terminal:!0,priority:400,transclude:"element",compile:function(c,f,h){return function(c,f,i){function j(){l&&(l.remove(),l=null),n&&(n.$destroy(),n=null),m&&(r.leave(m,function(){l=null}),l=m,m=null)}function k(g){var k,l=z(c,i,f,e),s=l&&a.$current&&a.$current.locals[l];if(g||s!==o){k=c.$new(),o=a.$current.locals[l];var t=h(k,function(a){r.enter(a,f,function(){n&&n.$emit("$viewContentAnimationEnded"),(b.isDefined(q)&&!q||c.$eval(q))&&d(a)}),j()});m=t,n=k,n.$emit("$viewContentLoaded"),n.$eval(p)}}var l,m,n,o,p=i.onload||"",q=i.autoscroll,r=g(i,c);c.$on("$stateChangeSuccess",function(){k(!1)}),c.$on("$viewContentLoading",function(){k(!1)}),k(!0)}}};return k}function y(a,b,c,d){return{restrict:"ECA",priority:-400,compile:function(e){var f=e.html();return function(e,g,h){var i=c.$current,j=z(e,h,g,d),k=i&&i.locals[j];if(k){g.data("$uiView",{name:j,state:k.$$state}),g.html(k.$template?k.$template:f);var l=a(g.contents());if(k.$$controller){k.$scope=e;var m=b(k.$$controller,k);k.$$controllerAs&&(e[k.$$controllerAs]=m),g.data("$ngControllerController",m),g.children().data("$ngControllerController",m)}l(e)}}}}}function z(a,b,c,d){var e=d(b.uiView||b.name||"")(a),f=c.inheritedData("$uiView");return e.indexOf("@")>=0?e:e+"@"+(f?f.state.name:"")}function A(a,b){var c,d=a.match(/^\s*({[^}]*})\s*$/);if(d&&(a=b+"("+d[1]+")"),c=a.replace(/\n/g," ").match(/^([^(]+?)\s*(\((.*)\))?$/),!c||4!==c.length)throw new Error("Invalid state ref '"+a+"'");return{state:c[1],paramExpr:c[3]||null}}function B(a){var b=a.parent().inheritedData("$uiView");return b&&b.state&&b.state.name?b.state:void 0}function C(a,c){var d=["location","inherit","reload"];return{restrict:"A",require:["?^uiSrefActive","?^uiSrefActiveEq"],link:function(e,f,g,h){var i=A(g.uiSref,a.current.name),j=null,k=B(f)||a.$current,l=null,m="A"===f.prop("tagName"),n="FORM"===f[0].nodeName,o=n?"action":"href",p=!0,q={relative:k,inherit:!0},r=e.$eval(g.uiSrefOpts)||{};b.forEach(d,function(a){a in r&&(q[a]=r[a])});var s=function(c){if(c&&(j=b.copy(c)),p){l=a.href(i.state,j,q);var d=h[1]||h[0];return d&&d.$$setStateInfo(i.state,j),null===l?(p=!1,!1):void g.$set(o,l)}};i.paramExpr&&(e.$watch(i.paramExpr,function(a){a!==j&&s(a)},!0),j=b.copy(e.$eval(i.paramExpr))),s(),n||f.bind("click",function(b){var d=b.which||b.button;if(!(d>1||b.ctrlKey||b.metaKey||b.shiftKey||f.attr("target"))){var e=c(function(){a.go(i.state,j,q)});b.preventDefault();var g=m&&!l?1:0;b.preventDefault=function(){g--<=0&&c.cancel(e)}}})}}}function D(a,b,c){return{restrict:"A",controller:["$scope","$element","$attrs",function(b,d,e){function f(){g()?d.addClass(j):d.removeClass(j)}function g(){return"undefined"!=typeof e.uiSrefActiveEq?h&&a.is(h.name,i):h&&a.includes(h.name,i)}var h,i,j;j=c(e.uiSrefActiveEq||e.uiSrefActive||"",!1)(b),this.$$setStateInfo=function(b,c){h=a.get(b,B(d)),i=c,f()},b.$on("$stateChangeSuccess",f)}]}}function E(a){var b=function(b){return a.is(b)};return b.$stateful=!0,b}function F(a){var b=function(b){return a.includes(b)};return b.$stateful=!0,b}var G=b.isDefined,H=b.isFunction,I=b.isString,J=b.isObject,K=b.isArray,L=b.forEach,M=b.extend,N=b.copy;b.module("ui.router.util",["ng"]),b.module("ui.router.router",["ui.router.util"]),b.module("ui.router.state",["ui.router.router","ui.router.util"]),b.module("ui.router",["ui.router.state"]),b.module("ui.router.compat",["ui.router"]),o.$inject=["$q","$injector"],b.module("ui.router.util").service("$resolve",o),p.$inject=["$http","$templateCache","$injector"],b.module("ui.router.util").service("$templateFactory",p);var O;q.prototype.concat=function(a,b){var c={caseInsensitive:O.caseInsensitive(),strict:O.strictMode(),squash:O.defaultSquashPolicy()};return new q(this.sourcePath+a+this.sourceSearch,M(c,b),this)},q.prototype.toString=function(){return this.source},q.prototype.exec=function(a,b){function c(a){function b(a){return a.split("").reverse().join("")}function c(a){return a.replace(/\\-/,"-")}var d=b(a).split(/-(?!\\)/),e=n(d,b);return n(e,c).reverse()}var d=this.regexp.exec(a);if(!d)return null;b=b||{};var e,f,g,h=this.parameters(),i=h.length,j=this.segments.length-1,k={};if(j!==d.length-1)throw new Error("Unbalanced capture group in route '"+this.source+"'");for(e=0;j>e;e++){g=h[e];var l=this.params[g],m=d[e+1];for(f=0;f<l.replace;f++)l.replace[f].from===m&&(m=l.replace[f].to);m&&l.array===!0&&(m=c(m)),k[g]=l.value(m)}for(;i>e;e++)g=h[e],k[g]=this.params[g].value(b[g]);return k},q.prototype.parameters=function(a){return G(a)?this.params[a]||null:this.$$paramNames},q.prototype.validates=function(a){return this.params.$$validates(a)},q.prototype.format=function(a){function b(a){return encodeURIComponent(a).replace(/-/g,function(a){return"%5C%"+a.charCodeAt(0).toString(16).toUpperCase()})}a=a||{};var c=this.segments,d=this.parameters(),e=this.params;if(!this.validates(a))return null;var f,g=!1,h=c.length-1,i=d.length,j=c[0];for(f=0;i>f;f++){var k=h>f,l=d[f],m=e[l],o=m.value(a[l]),p=m.isOptional&&m.type.equals(m.value(),o),q=p?m.squash:!1,r=m.type.encode(o);if(k){var s=c[f+1];if(q===!1)null!=r&&(j+=K(r)?n(r,b).join("-"):encodeURIComponent(r)),j+=s;else if(q===!0){var t=j.match(/\/$/)?/\/?(.*)/:/(.*)/;j+=s.match(t)[1]}else I(q)&&(j+=q+s)}else{if(null==r||p&&q!==!1)continue;K(r)||(r=[r]),r=n(r,encodeURIComponent).join("&"+l+"="),j+=(g?"&":"?")+(l+"="+r),g=!0}}return j},r.prototype.is=function(){return!0},r.prototype.encode=function(a){return a},r.prototype.decode=function(a){return a},r.prototype.equals=function(a,b){return a==b},r.prototype.$subPattern=function(){var a=this.pattern.toString();return a.substr(1,a.length-2)},r.prototype.pattern=/.*/,r.prototype.toString=function(){return"{Type:"+this.name+"}"},r.prototype.$asArray=function(a,b){function d(a,b){function d(a,b){return function(){return a[b].apply(a,arguments)}}function e(a){return K(a)?a:G(a)?[a]:[]}function f(a){switch(a.length){case 0:return c;case 1:return"auto"===b?a[0]:a;default:return a}}function g(a){return!a}function h(a,b){return function(c){c=e(c);var d=n(c,a);return b===!0?0===m(d,g).length:f(d)}}function i(a){return function(b,c){var d=e(b),f=e(c);if(d.length!==f.length)return!1;for(var g=0;g<d.length;g++)if(!a(d[g],f[g]))return!1;return!0}}this.encode=h(d(a,"encode")),this.decode=h(d(a,"decode")),this.is=h(d(a,"is"),!0),this.equals=i(d(a,"equals")),this.pattern=a.pattern,this.$arrayMode=b}if(!a)return this;if("auto"===a&&!b)throw new Error("'auto' array mode is for query parameters only");return new d(this,a)},b.module("ui.router.util").provider("$urlMatcherFactory",s),b.module("ui.router.util").run(["$urlMatcherFactory",function(){}]),t.$inject=["$locationProvider","$urlMatcherFactoryProvider"],b.module("ui.router.router").provider("$urlRouter",t),u.$inject=["$urlRouterProvider","$urlMatcherFactoryProvider"],b.module("ui.router.state").value("$stateParams",{}).provider("$state",u),v.$inject=[],b.module("ui.router.state").provider("$view",v),b.module("ui.router.state").provider("$uiViewScroll",w),x.$inject=["$state","$injector","$uiViewScroll","$interpolate"],y.$inject=["$compile","$controller","$state","$interpolate"],b.module("ui.router.state").directive("uiView",x),b.module("ui.router.state").directive("uiView",y),C.$inject=["$state","$timeout"],D.$inject=["$state","$stateParams","$interpolate"],b.module("ui.router.state").directive("uiSref",C).directive("uiSrefActive",D).directive("uiSrefActiveEq",D),E.$inject=["$state"],F.$inject=["$state"],b.module("ui.router.state").filter("isState",E).filter("includedByState",F)}(window,window.angular);
define("angular-ui-router", ["angular"], function(){});

/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    
    define('about/about-ctrl',[], function () {
        var AboutCtrl = function ($scope, $http) {

            $scope.innerBoxImage = "static/img/software-dev.jpg";

        };


        return ["$scope", "$http", AboutCtrl];
    });
}());
(function () {
    

    define('about/about-module',[
        'angular',
        'angular-ui-router',
        'about/about-ctrl'
    ], function (angular, angularUi, aboutCtrl) {
        var module = { moduleName: 'ui-about'};
        var about = angular.module(module.moduleName, []);


        about.controller("AboutCtrl", aboutCtrl);
        about.config(function ($stateProvider, $urlRouterProvider) {
            $stateProvider
                .state('about', {
                    url: "/about",
                    templateUrl: "app/about/about.html",
                    controller: "AboutCtrl"
                });
        });


        return module;
    });

}());
/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    
    define('services/login-service',[], function () {
        var Login = function ($timeout, $location) {
            var currentObject = this;
            this.observingForms = [];

            this.showForm = function () {
                this.changeState(true, 1000, $location.path());
            };
            this.hideForm = function () {
                this.changeState(false, 100, $location.path());
            };

            this.changeState = function (state, timeout, path) {
                $timeout(function () {
                    if ($location.path() === path) {//if location has changed we don't do it
                        angular.forEach(currentObject.observingForms, function (callback) {
                            callback(state);
                        });
                    }
                }, timeout);
            };
            this.registerForm = function (callback) {
                this.observingForms.push(callback);
            };



        };
        return  Login;
    });
}());
/**
 * vis.js
 * https://github.com/almende/vis
 *
 * A dynamic, browser-based visualization library.
 *
 * @version 3.9.1
 * @date    2015-01-22
 *
 * @license
 * Copyright (C) 2011-2014 Almende B.V, http://almende.com
 *
 * Vis.js is dual licensed under both
 *
 * * The Apache 2.0 License
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * and
 *
 * * The MIT License
 *   http://opensource.org/licenses/MIT
 *
 * Vis.js may be distributed under either license.
 */
!function(t,e){"object"==typeof exports&&"object"==typeof module?module.exports=e():"function"==typeof define&&define.amd?define('vis',e):"object"==typeof exports?exports.vis=e():t.vis=e()}(this,function(){return function(t){function e(s){if(i[s])return i[s].exports;var o=i[s]={exports:{},id:s,loaded:!1};return t[s].call(o.exports,o,o.exports,e),o.loaded=!0,o.exports}var i={};return e.m=t,e.c=i,e.p="",e(0)}([function(t,e,i){e.util=i(1),e.DOMutil=i(2),e.DataSet=i(3),e.DataView=i(4),e.Queue=i(5),e.Graph3d=i(6),e.graph3d={Camera:i(7),Filter:i(8),Point2d:i(9),Point3d:i(10),Slider:i(11),StepNumber:i(12)},e.Timeline=i(13),e.Graph2d=i(14),e.timeline={DateUtil:i(15),DataStep:i(16),Range:i(17),stack:i(18),TimeStep:i(19),components:{items:{Item:i(20),BackgroundItem:i(21),BoxItem:i(22),PointItem:i(23),RangeItem:i(24)},Component:i(25),CurrentTime:i(26),CustomTime:i(27),DataAxis:i(28),GraphGroup:i(29),Group:i(30),BackgroundGroup:i(31),ItemSet:i(32),Legend:i(33),LineGraph:i(34),TimeAxis:i(35)}},e.Network=i(36),e.network={Edge:i(37),Groups:i(38),Images:i(39),Node:i(40),Popup:i(41),dotparser:i(42),gephiParser:i(43)},e.Graph=function(){throw new Error("Graph is renamed to Network. Please create a graph as new vis.Network(...)")},e.moment=i(44),e.hammer=i(45)},function(t,e,i){var s=i(44);e.isNumber=function(t){return t instanceof Number||"number"==typeof t},e.isString=function(t){return t instanceof String||"string"==typeof t},e.isDate=function(t){if(t instanceof Date)return!0;if(e.isString(t)){var i=o.exec(t);if(i)return!0;if(!isNaN(Date.parse(t)))return!0}return!1},e.isDataTable=function(t){return"undefined"!=typeof google&&google.visualization&&google.visualization.DataTable&&t instanceof google.visualization.DataTable},e.randomUUID=function(){var t=function(){return Math.floor(65536*Math.random()).toString(16)};return t()+t()+"-"+t()+"-"+t()+"-"+t()+"-"+t()+t()+t()},e.extend=function(t){for(var e=1,i=arguments.length;i>e;e++){var s=arguments[e];for(var o in s)s.hasOwnProperty(o)&&(t[o]=s[o])}return t},e.selectiveExtend=function(t,e){if(!Array.isArray(t))throw new Error("Array with property names expected as first argument");for(var i=2;i<arguments.length;i++)for(var s=arguments[i],o=0;o<t.length;o++){var n=t[o];s.hasOwnProperty(n)&&(e[n]=s[n])}return e},e.selectiveDeepExtend=function(t,i,s){if(Array.isArray(s))throw new TypeError("Arrays are not supported by deepExtend");for(var o=2;o<arguments.length;o++)for(var n=arguments[o],r=0;r<t.length;r++){var a=t[r];if(n.hasOwnProperty(a))if(s[a]&&s[a].constructor===Object)void 0===i[a]&&(i[a]={}),i[a].constructor===Object?e.deepExtend(i[a],s[a]):i[a]=s[a];else{if(Array.isArray(s[a]))throw new TypeError("Arrays are not supported by deepExtend");i[a]=s[a]}}return i},e.selectiveNotDeepExtend=function(t,i,s){if(Array.isArray(s))throw new TypeError("Arrays are not supported by deepExtend");for(var o in s)if(s.hasOwnProperty(o)&&-1==t.indexOf(o))if(s[o]&&s[o].constructor===Object)void 0===i[o]&&(i[o]={}),i[o].constructor===Object?e.deepExtend(i[o],s[o]):i[o]=s[o];else{if(Array.isArray(s[o]))throw new TypeError("Arrays are not supported by deepExtend");i[o]=s[o]}return i},e.deepExtend=function(t,i){if(Array.isArray(i))throw new TypeError("Arrays are not supported by deepExtend");for(var s in i)if(i.hasOwnProperty(s))if(i[s]&&i[s].constructor===Object)void 0===t[s]&&(t[s]={}),t[s].constructor===Object?e.deepExtend(t[s],i[s]):t[s]=i[s];else{if(Array.isArray(i[s]))throw new TypeError("Arrays are not supported by deepExtend");t[s]=i[s]}return t},e.equalArray=function(t,e){if(t.length!=e.length)return!1;for(var i=0,s=t.length;s>i;i++)if(t[i]!=e[i])return!1;return!0},e.convert=function(t,i){var n;if(void 0===t)return void 0;if(null===t)return null;if(!i)return t;if("string"!=typeof i&&!(i instanceof String))throw new Error("Type must be a string");switch(i){case"boolean":case"Boolean":return Boolean(t);case"number":case"Number":return Number(t.valueOf());case"string":case"String":return String(t);case"Date":if(e.isNumber(t))return new Date(t);if(t instanceof Date)return new Date(t.valueOf());if(s.isMoment(t))return new Date(t.valueOf());if(e.isString(t))return n=o.exec(t),n?new Date(Number(n[1])):s(t).toDate();throw new Error("Cannot convert object of type "+e.getType(t)+" to type Date");case"Moment":if(e.isNumber(t))return s(t);if(t instanceof Date)return s(t.valueOf());if(s.isMoment(t))return s(t);if(e.isString(t))return n=o.exec(t),s(n?Number(n[1]):t);throw new Error("Cannot convert object of type "+e.getType(t)+" to type Date");case"ISODate":if(e.isNumber(t))return new Date(t);if(t instanceof Date)return t.toISOString();if(s.isMoment(t))return t.toDate().toISOString();if(e.isString(t))return n=o.exec(t),n?new Date(Number(n[1])).toISOString():new Date(t).toISOString();throw new Error("Cannot convert object of type "+e.getType(t)+" to type ISODate");case"ASPDate":if(e.isNumber(t))return"/Date("+t+")/";if(t instanceof Date)return"/Date("+t.valueOf()+")/";if(e.isString(t)){n=o.exec(t);var r;return r=n?new Date(Number(n[1])).valueOf():new Date(t).valueOf(),"/Date("+r+")/"}throw new Error("Cannot convert object of type "+e.getType(t)+" to type ASPDate");default:throw new Error('Unknown type "'+i+'"')}};var o=/^\/?Date\((\-?\d+)/i;e.getType=function(t){var e=typeof t;return"object"==e?null==t?"null":t instanceof Boolean?"Boolean":t instanceof Number?"Number":t instanceof String?"String":Array.isArray(t)?"Array":t instanceof Date?"Date":"Object":"number"==e?"Number":"boolean"==e?"Boolean":"string"==e?"String":e},e.getAbsoluteLeft=function(t){return t.getBoundingClientRect().left+window.pageXOffset},e.getAbsoluteTop=function(t){return t.getBoundingClientRect().top+window.pageYOffset},e.addClassName=function(t,e){var i=t.className.split(" ");-1==i.indexOf(e)&&(i.push(e),t.className=i.join(" "))},e.removeClassName=function(t,e){var i=t.className.split(" "),s=i.indexOf(e);-1!=s&&(i.splice(s,1),t.className=i.join(" "))},e.forEach=function(t,e){var i,s;if(Array.isArray(t))for(i=0,s=t.length;s>i;i++)e(t[i],i,t);else for(i in t)t.hasOwnProperty(i)&&e(t[i],i,t)},e.toArray=function(t){var e=[];for(var i in t)t.hasOwnProperty(i)&&e.push(t[i]);return e},e.updateProperty=function(t,e,i){return t[e]!==i?(t[e]=i,!0):!1},e.addEventListener=function(t,e,i,s){t.addEventListener?(void 0===s&&(s=!1),"mousewheel"===e&&navigator.userAgent.indexOf("Firefox")>=0&&(e="DOMMouseScroll"),t.addEventListener(e,i,s)):t.attachEvent("on"+e,i)},e.removeEventListener=function(t,e,i,s){t.removeEventListener?(void 0===s&&(s=!1),"mousewheel"===e&&navigator.userAgent.indexOf("Firefox")>=0&&(e="DOMMouseScroll"),t.removeEventListener(e,i,s)):t.detachEvent("on"+e,i)},e.preventDefault=function(t){t||(t=window.event),t.preventDefault?t.preventDefault():t.returnValue=!1},e.getTarget=function(t){t||(t=window.event);var e;return t.target?e=t.target:t.srcElement&&(e=t.srcElement),void 0!=e.nodeType&&3==e.nodeType&&(e=e.parentNode),e},e.option={},e.option.asBoolean=function(t,e){return"function"==typeof t&&(t=t()),null!=t?0!=t:e||null},e.option.asNumber=function(t,e){return"function"==typeof t&&(t=t()),null!=t?Number(t)||e||null:e||null},e.option.asString=function(t,e){return"function"==typeof t&&(t=t()),null!=t?String(t):e||null},e.option.asSize=function(t,i){return"function"==typeof t&&(t=t()),e.isString(t)?t:e.isNumber(t)?t+"px":i||null},e.option.asElement=function(t,e){return"function"==typeof t&&(t=t()),t||e||null},e.hexToRGB=function(t){var e=/^#?([a-f\d])([a-f\d])([a-f\d])$/i;t=t.replace(e,function(t,e,i,s){return e+e+i+i+s+s});var i=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(t);return i?{r:parseInt(i[1],16),g:parseInt(i[2],16),b:parseInt(i[3],16)}:null},e.RGBToHex=function(t,e,i){return"#"+((1<<24)+(t<<16)+(e<<8)+i).toString(16).slice(1)},e.parseColor=function(t){var i;if(e.isString(t)){if(e.isValidRGB(t)){var s=t.substr(4).substr(0,t.length-5).split(",");t=e.RGBToHex(s[0],s[1],s[2])}if(e.isValidHex(t)){var o=e.hexToHSV(t),n={h:o.h,s:.45*o.s,v:Math.min(1,1.05*o.v)},r={h:o.h,s:Math.min(1,1.25*o.v),v:.6*o.v},a=e.HSVToHex(r.h,r.h,r.v),h=e.HSVToHex(n.h,n.s,n.v);i={background:t,border:a,highlight:{background:h,border:a},hover:{background:h,border:a}}}else i={background:t,border:t,highlight:{background:t,border:t},hover:{background:t,border:t}}}else i={},i.background=t.background||"white",i.border=t.border||i.background,e.isString(t.highlight)?i.highlight={border:t.highlight,background:t.highlight}:(i.highlight={},i.highlight.background=t.highlight&&t.highlight.background||i.background,i.highlight.border=t.highlight&&t.highlight.border||i.border),e.isString(t.hover)?i.hover={border:t.hover,background:t.hover}:(i.hover={},i.hover.background=t.hover&&t.hover.background||i.background,i.hover.border=t.hover&&t.hover.border||i.border);return i},e.RGBToHSV=function(t,e,i){t/=255,e/=255,i/=255;var s=Math.min(t,Math.min(e,i)),o=Math.max(t,Math.max(e,i));if(s==o)return{h:0,s:0,v:s};var n=t==s?e-i:i==s?t-e:i-t,r=t==s?3:i==s?1:5,a=60*(r-n/(o-s))/360,h=(o-s)/o,d=o;return{h:a,s:h,v:d}};var n={split:function(t){var e={};return t.split(";").forEach(function(t){if(""!=t.trim()){var i=t.split(":"),s=i[0].trim(),o=i[1].trim();e[s]=o}}),e},join:function(t){return Object.keys(t).map(function(e){return e+": "+t[e]}).join("; ")}};e.addCssText=function(t,i){var s=n.split(t.style.cssText),o=n.split(i),r=e.extend(s,o);t.style.cssText=n.join(r)},e.removeCssText=function(t,e){var i=n.split(t.style.cssText),s=n.split(e);for(var o in s)s.hasOwnProperty(o)&&delete i[o];t.style.cssText=n.join(i)},e.HSVToRGB=function(t,e,i){var s,o,n,r=Math.floor(6*t),a=6*t-r,h=i*(1-e),d=i*(1-a*e),l=i*(1-(1-a)*e);switch(r%6){case 0:s=i,o=l,n=h;break;case 1:s=d,o=i,n=h;break;case 2:s=h,o=i,n=l;break;case 3:s=h,o=d,n=i;break;case 4:s=l,o=h,n=i;break;case 5:s=i,o=h,n=d}return{r:Math.floor(255*s),g:Math.floor(255*o),b:Math.floor(255*n)}},e.HSVToHex=function(t,i,s){var o=e.HSVToRGB(t,i,s);return e.RGBToHex(o.r,o.g,o.b)},e.hexToHSV=function(t){var i=e.hexToRGB(t);return e.RGBToHSV(i.r,i.g,i.b)},e.isValidHex=function(t){var e=/(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(t);return e},e.isValidRGB=function(t){t=t.replace(" ","");var e=/rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)/i.test(t);return e},e.selectiveBridgeObject=function(t,i){if("object"==typeof i){for(var s=Object.create(i),o=0;o<t.length;o++)i.hasOwnProperty(t[o])&&"object"==typeof i[t[o]]&&(s[t[o]]=e.bridgeObject(i[t[o]]));return s}return null},e.bridgeObject=function(t){if("object"==typeof t){var i=Object.create(t);for(var s in t)t.hasOwnProperty(s)&&"object"==typeof t[s]&&(i[s]=e.bridgeObject(t[s]));return i}return null},e.mergeOptions=function(t,e,i){if(void 0!==e[i])if("boolean"==typeof e[i])t[i].enabled=e[i];else{t[i].enabled=!0;for(var s in e[i])e[i].hasOwnProperty(s)&&(t[i][s]=e[i][s])}},e.binarySearchCustom=function(t,e,i,s){for(var o=1e4,n=0,r=0,a=t.length-1;a>=r&&o>n;){var h=Math.floor((r+a)/2),d=t[h],l=void 0===s?d[i]:d[i][s],c=e(l);if(0==c)return h;-1==c?r=h+1:a=h-1,n++}return-1},e.binarySearchValue=function(t,e,i,s){for(var o,n,r,a,h=1e4,d=0,l=0,c=t.length-1;c>=l&&h>d;){if(a=Math.floor(.5*(c+l)),o=t[Math.max(0,a-1)][i],n=t[a][i],r=t[Math.min(t.length-1,a+1)][i],n==e)return a;if(e>o&&n>e)return"before"==s?Math.max(0,a-1):a;if(e>n&&r>e)return"before"==s?a:Math.min(t.length-1,a+1);e>n?l=a+1:c=a-1,d++}return-1},e.easeInOutQuad=function(t,e,i,s){var o=i-e;return t/=s/2,1>t?o/2*t*t+e:(t--,-o/2*(t*(t-2)-1)+e)},e.easingFunctions={linear:function(t){return t},easeInQuad:function(t){return t*t},easeOutQuad:function(t){return t*(2-t)},easeInOutQuad:function(t){return.5>t?2*t*t:-1+(4-2*t)*t},easeInCubic:function(t){return t*t*t},easeOutCubic:function(t){return--t*t*t+1},easeInOutCubic:function(t){return.5>t?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1},easeInQuart:function(t){return t*t*t*t},easeOutQuart:function(t){return 1- --t*t*t*t},easeInOutQuart:function(t){return.5>t?8*t*t*t*t:1-8*--t*t*t*t},easeInQuint:function(t){return t*t*t*t*t},easeOutQuint:function(t){return 1+--t*t*t*t*t},easeInOutQuint:function(t){return.5>t?16*t*t*t*t*t:1+16*--t*t*t*t*t}}},function(t,e){e.prepareElements=function(t){for(var e in t)t.hasOwnProperty(e)&&(t[e].redundant=t[e].used,t[e].used=[])},e.cleanupElements=function(t){for(var e in t)if(t.hasOwnProperty(e)&&t[e].redundant){for(var i=0;i<t[e].redundant.length;i++)t[e].redundant[i].parentNode.removeChild(t[e].redundant[i]);t[e].redundant=[]}},e.getSVGElement=function(t,e,i){var s;return e.hasOwnProperty(t)?e[t].redundant.length>0?(s=e[t].redundant[0],e[t].redundant.shift()):(s=document.createElementNS("http://www.w3.org/2000/svg",t),i.appendChild(s)):(s=document.createElementNS("http://www.w3.org/2000/svg",t),e[t]={used:[],redundant:[]},i.appendChild(s)),e[t].used.push(s),s},e.getDOMElement=function(t,e,i,s){var o;return e.hasOwnProperty(t)?e[t].redundant.length>0?(o=e[t].redundant[0],e[t].redundant.shift()):(o=document.createElement(t),void 0!==s?i.insertBefore(o,s):i.appendChild(o)):(o=document.createElement(t),e[t]={used:[],redundant:[]},void 0!==s?i.insertBefore(o,s):i.appendChild(o)),e[t].used.push(o),o},e.drawPoint=function(t,i,s,o,n){var r;return"circle"==s.options.drawPoints.style?(r=e.getSVGElement("circle",o,n),r.setAttributeNS(null,"cx",t),r.setAttributeNS(null,"cy",i),r.setAttributeNS(null,"r",.5*s.options.drawPoints.size)):(r=e.getSVGElement("rect",o,n),r.setAttributeNS(null,"x",t-.5*s.options.drawPoints.size),r.setAttributeNS(null,"y",i-.5*s.options.drawPoints.size),r.setAttributeNS(null,"width",s.options.drawPoints.size),r.setAttributeNS(null,"height",s.options.drawPoints.size)),void 0!==s.options.drawPoints.styles&&r.setAttributeNS(null,"style",s.group.options.drawPoints.styles),r.setAttributeNS(null,"class",s.className+" point"),r},e.drawBar=function(t,i,s,o,n,r,a){if(0!=o){0>o&&(o*=-1,i-=o);var h=e.getSVGElement("rect",r,a);h.setAttributeNS(null,"x",t-.5*s),h.setAttributeNS(null,"y",i),h.setAttributeNS(null,"width",s),h.setAttributeNS(null,"height",o),h.setAttributeNS(null,"class",n)}}},function(t,e,i){function s(t,e){if(!t||Array.isArray(t)||o.isDataTable(t)||(e=t,t=null),this._options=e||{},this._data={},this._fieldId=this._options.fieldId||"id",this._type={},this._options.type)for(var i in this._options.type)if(this._options.type.hasOwnProperty(i)){var s=this._options.type[i];this._type[i]="Date"==s||"ISODate"==s||"ASPDate"==s?"Date":s}if(this._options.convert)throw new Error('Option "convert" is deprecated. Use "type" instead.');this._subscribers={},t&&this.add(t),this.setOptions(e)}var o=i(1),n=i(5);s.prototype.setOptions=function(t){t&&void 0!==t.queue&&(t.queue===!1?this._queue&&(this._queue.destroy(),delete this._queue):(this._queue||(this._queue=n.extend(this,{replace:["add","update","remove"]})),"object"==typeof t.queue&&this._queue.setOptions(t.queue)))},s.prototype.on=function(t,e){var i=this._subscribers[t];i||(i=[],this._subscribers[t]=i),i.push({callback:e})},s.prototype.subscribe=s.prototype.on,s.prototype.off=function(t,e){var i=this._subscribers[t];i&&(this._subscribers[t]=i.filter(function(t){return t.callback!=e}))},s.prototype.unsubscribe=s.prototype.off,s.prototype._trigger=function(t,e,i){if("*"==t)throw new Error("Cannot trigger event *");var s=[];t in this._subscribers&&(s=s.concat(this._subscribers[t])),"*"in this._subscribers&&(s=s.concat(this._subscribers["*"]));for(var o=0;o<s.length;o++){var n=s[o];n.callback&&n.callback(t,e,i||null)}},s.prototype.add=function(t,e){var i,s=[],n=this;if(Array.isArray(t))for(var r=0,a=t.length;a>r;r++)i=n._addItem(t[r]),s.push(i);else if(o.isDataTable(t))for(var h=this._getColumnNames(t),d=0,l=t.getNumberOfRows();l>d;d++){for(var c={},p=0,u=h.length;u>p;p++){var m=h[p];c[m]=t.getValue(d,p)}i=n._addItem(c),s.push(i)}else{if(!(t instanceof Object))throw new Error("Unknown dataType");i=n._addItem(t),s.push(i)}return s.length&&this._trigger("add",{items:s},e),s},s.prototype.update=function(t,e){var i=[],s=[],n=[],r=this,a=r._fieldId,h=function(t){var e=t[a];r._data[e]?(e=r._updateItem(t),s.push(e),n.push(t)):(e=r._addItem(t),i.push(e))};if(Array.isArray(t))for(var d=0,l=t.length;l>d;d++)h(t[d]);else if(o.isDataTable(t))for(var c=this._getColumnNames(t),p=0,u=t.getNumberOfRows();u>p;p++){for(var m={},f=0,g=c.length;g>f;f++){var v=c[f];m[v]=t.getValue(p,f)}h(m)}else{if(!(t instanceof Object))throw new Error("Unknown dataType");h(t)}return i.length&&this._trigger("add",{items:i},e),s.length&&this._trigger("update",{items:s,data:n},e),i.concat(s)},s.prototype.get=function(){var t,e,i,s,n=this,r=o.getType(arguments[0]);"String"==r||"Number"==r?(t=arguments[0],i=arguments[1],s=arguments[2]):"Array"==r?(e=arguments[0],i=arguments[1],s=arguments[2]):(i=arguments[0],s=arguments[1]);var a;if(i&&i.returnType){var h=["DataTable","Array","Object"];if(a=-1==h.indexOf(i.returnType)?"Array":i.returnType,s&&a!=o.getType(s))throw new Error('Type of parameter "data" ('+o.getType(s)+") does not correspond with specified options.type ("+i.type+")");if("DataTable"==a&&!o.isDataTable(s))throw new Error('Parameter "data" must be a DataTable when options.type is "DataTable"')}else a=s&&"DataTable"==o.getType(s)?"DataTable":"Array";var d,l,c,p,u=i&&i.type||this._options.type,m=i&&i.filter,f=[];if(void 0!=t)d=n._getItem(t,u),m&&!m(d)&&(d=null);else if(void 0!=e)for(c=0,p=e.length;p>c;c++)d=n._getItem(e[c],u),(!m||m(d))&&f.push(d);else for(l in this._data)this._data.hasOwnProperty(l)&&(d=n._getItem(l,u),(!m||m(d))&&f.push(d));if(i&&i.order&&void 0==t&&this._sort(f,i.order),i&&i.fields){var g=i.fields;if(void 0!=t)d=this._filterFields(d,g);else for(c=0,p=f.length;p>c;c++)f[c]=this._filterFields(f[c],g)}if("DataTable"==a){var v=this._getColumnNames(s);if(void 0!=t)n._appendRow(s,v,d);else for(c=0;c<f.length;c++)n._appendRow(s,v,f[c]);return s}if("Object"==a){var y={};for(c=0;c<f.length;c++)y[f[c].id]=f[c];return y}if(void 0!=t)return d;if(s){for(c=0,p=f.length;p>c;c++)s.push(f[c]);return s}return f},s.prototype.getIds=function(t){var e,i,s,o,n,r=this._data,a=t&&t.filter,h=t&&t.order,d=t&&t.type||this._options.type,l=[];if(a)if(h){n=[];for(s in r)r.hasOwnProperty(s)&&(o=this._getItem(s,d),a(o)&&n.push(o));for(this._sort(n,h),e=0,i=n.length;i>e;e++)l[e]=n[e][this._fieldId]}else for(s in r)r.hasOwnProperty(s)&&(o=this._getItem(s,d),a(o)&&l.push(o[this._fieldId]));else if(h){n=[];for(s in r)r.hasOwnProperty(s)&&n.push(r[s]);for(this._sort(n,h),e=0,i=n.length;i>e;e++)l[e]=n[e][this._fieldId]}else for(s in r)r.hasOwnProperty(s)&&(o=r[s],l.push(o[this._fieldId]));return l},s.prototype.getDataSet=function(){return this},s.prototype.forEach=function(t,e){var i,s,o=e&&e.filter,n=e&&e.type||this._options.type,r=this._data;if(e&&e.order)for(var a=this.get(e),h=0,d=a.length;d>h;h++)i=a[h],s=i[this._fieldId],t(i,s);else for(s in r)r.hasOwnProperty(s)&&(i=this._getItem(s,n),(!o||o(i))&&t(i,s))},s.prototype.map=function(t,e){var i,s=e&&e.filter,o=e&&e.type||this._options.type,n=[],r=this._data;for(var a in r)r.hasOwnProperty(a)&&(i=this._getItem(a,o),(!s||s(i))&&n.push(t(i,a)));return e&&e.order&&this._sort(n,e.order),n},s.prototype._filterFields=function(t,e){var i={};for(var s in t)t.hasOwnProperty(s)&&-1!=e.indexOf(s)&&(i[s]=t[s]);return i},s.prototype._sort=function(t,e){if(o.isString(e)){var i=e;t.sort(function(t,e){var s=t[i],o=e[i];return s>o?1:o>s?-1:0})}else{if("function"!=typeof e)throw new TypeError("Order must be a function or a string");t.sort(e)}},s.prototype.remove=function(t,e){var i,s,o,n=[];if(Array.isArray(t))for(i=0,s=t.length;s>i;i++)o=this._remove(t[i]),null!=o&&n.push(o);else o=this._remove(t),null!=o&&n.push(o);return n.length&&this._trigger("remove",{items:n},e),n},s.prototype._remove=function(t){if(o.isNumber(t)||o.isString(t)){if(this._data[t])return delete this._data[t],t}else if(t instanceof Object){var e=t[this._fieldId];if(e&&this._data[e])return delete this._data[e],e}return null},s.prototype.clear=function(t){var e=Object.keys(this._data);return this._data={},this._trigger("remove",{items:e},t),e},s.prototype.max=function(t){var e=this._data,i=null,s=null;for(var o in e)if(e.hasOwnProperty(o)){var n=e[o],r=n[t];null!=r&&(!i||r>s)&&(i=n,s=r)}return i},s.prototype.min=function(t){var e=this._data,i=null,s=null;for(var o in e)if(e.hasOwnProperty(o)){var n=e[o],r=n[t];null!=r&&(!i||s>r)&&(i=n,s=r)}return i},s.prototype.distinct=function(t){var e,i=this._data,s=[],n=this._options.type&&this._options.type[t]||null,r=0;for(var a in i)if(i.hasOwnProperty(a)){var h=i[a],d=h[t],l=!1;for(e=0;r>e;e++)if(s[e]==d){l=!0;break}l||void 0===d||(s[r]=d,r++)}if(n)for(e=0;e<s.length;e++)s[e]=o.convert(s[e],n);return s},s.prototype._addItem=function(t){var e=t[this._fieldId];if(void 0!=e){if(this._data[e])throw new Error("Cannot add item: item with id "+e+" already exists")}else e=o.randomUUID(),t[this._fieldId]=e;var i={};for(var s in t)if(t.hasOwnProperty(s)){var n=this._type[s];i[s]=o.convert(t[s],n)}return this._data[e]=i,e},s.prototype._getItem=function(t,e){var i,s,n=this._data[t];if(!n)return null;var r={};if(e)for(i in n)n.hasOwnProperty(i)&&(s=n[i],r[i]=o.convert(s,e[i]));else for(i in n)n.hasOwnProperty(i)&&(s=n[i],r[i]=s);return r},s.prototype._updateItem=function(t){var e=t[this._fieldId];if(void 0==e)throw new Error("Cannot update item: item has no id (item: "+JSON.stringify(t)+")");var i=this._data[e];if(!i)throw new Error("Cannot update item: no item with id "+e+" found");for(var s in t)if(t.hasOwnProperty(s)){var n=this._type[s];i[s]=o.convert(t[s],n)}return e},s.prototype._getColumnNames=function(t){for(var e=[],i=0,s=t.getNumberOfColumns();s>i;i++)e[i]=t.getColumnId(i)||t.getColumnLabel(i);return e},s.prototype._appendRow=function(t,e,i){for(var s=t.addRow(),o=0,n=e.length;n>o;o++){var r=e[o];t.setValue(s,o,i[r])}},t.exports=s},function(t,e,i){function s(t,e){this._data=null,this._ids={},this._options=e||{},this._fieldId="id",this._subscribers={};var i=this;this.listener=function(){i._onEvent.apply(i,arguments)},this.setData(t)}var o=i(1),n=i(3);s.prototype.setData=function(t){var e,i,s;if(this._data){this._data.unsubscribe&&this._data.unsubscribe("*",this.listener),e=[];for(var o in this._ids)this._ids.hasOwnProperty(o)&&e.push(o);this._ids={},this._trigger("remove",{items:e})}if(this._data=t,this._data){for(this._fieldId=this._options.fieldId||this._data&&this._data.options&&this._data.options.fieldId||"id",e=this._data.getIds({filter:this._options&&this._options.filter}),i=0,s=e.length;s>i;i++)o=e[i],this._ids[o]=!0;this._trigger("add",{items:e}),this._data.on&&this._data.on("*",this.listener)}},s.prototype.get=function(){var t,e,i,s=this,n=o.getType(arguments[0]);"String"==n||"Number"==n||"Array"==n?(t=arguments[0],e=arguments[1],i=arguments[2]):(e=arguments[0],i=arguments[1]);var r=o.extend({},this._options,e);this._options.filter&&e&&e.filter&&(r.filter=function(t){return s._options.filter(t)&&e.filter(t)});var a=[];return void 0!=t&&a.push(t),a.push(r),a.push(i),this._data&&this._data.get.apply(this._data,a)},s.prototype.getIds=function(t){var e;if(this._data){var i,s=this._options.filter;i=t&&t.filter?s?function(e){return s(e)&&t.filter(e)}:t.filter:s,e=this._data.getIds({filter:i,order:t&&t.order})}else e=[];return e},s.prototype.getDataSet=function(){for(var t=this;t instanceof s;)t=t._data;return t||null},s.prototype._onEvent=function(t,e,i){var s,o,n,r,a=e&&e.items,h=this._data,d=[],l=[],c=[];if(a&&h){switch(t){case"add":for(s=0,o=a.length;o>s;s++)n=a[s],r=this.get(n),r&&(this._ids[n]=!0,d.push(n));break;case"update":for(s=0,o=a.length;o>s;s++)n=a[s],r=this.get(n),r?this._ids[n]?l.push(n):(this._ids[n]=!0,d.push(n)):this._ids[n]&&(delete this._ids[n],c.push(n));break;case"remove":for(s=0,o=a.length;o>s;s++)n=a[s],this._ids[n]&&(delete this._ids[n],c.push(n))}d.length&&this._trigger("add",{items:d},i),l.length&&this._trigger("update",{items:l},i),c.length&&this._trigger("remove",{items:c},i)}},s.prototype.on=n.prototype.on,s.prototype.off=n.prototype.off,s.prototype._trigger=n.prototype._trigger,s.prototype.subscribe=s.prototype.on,s.prototype.unsubscribe=s.prototype.off,t.exports=s},function(t){function e(t){this.delay=null,this.max=1/0,this._queue=[],this._timeout=null,this._extended=null,this.setOptions(t)}e.prototype.setOptions=function(t){t&&"undefined"!=typeof t.delay&&(this.delay=t.delay),t&&"undefined"!=typeof t.max&&(this.max=t.max),this._flushIfNeeded()},e.extend=function(t,i){var s=new e(i);if(void 0!==t.flush)throw new Error("Target object already has a property flush");t.flush=function(){s.flush()};var o=[{name:"flush",original:void 0}];if(i&&i.replace)for(var n=0;n<i.replace.length;n++){var r=i.replace[n];o.push({name:r,original:t[r]}),s.replace(t,r)}return s._extended={object:t,methods:o},s},e.prototype.destroy=function(){if(this.flush(),this._extended){for(var t=this._extended.object,e=this._extended.methods,i=0;i<e.length;i++){var s=e[i];s.original?t[s.name]=s.original:delete t[s.name]}this._extended=null}},e.prototype.replace=function(t,e){var i=this,s=t[e];if(!s)throw new Error("Method "+e+" undefined");t[e]=function(){for(var t=[],e=0;e<arguments.length;e++)t[e]=arguments[e];i.queue({args:t,fn:s,context:this})}},e.prototype.queue=function(t){this._queue.push("function"==typeof t?{fn:t}:t),this._flushIfNeeded()},e.prototype._flushIfNeeded=function(){if(this._queue.length>this.max&&this.flush(),clearTimeout(this._timeout),this.queue.length>0&&"number"==typeof this.delay){var t=this;this._timeout=setTimeout(function(){t.flush()},this.delay)}},e.prototype.flush=function(){for(;this._queue.length>0;){var t=this._queue.shift();t.fn.apply(t.context||t.fn,t.args||[])}},t.exports=e},function(t,e,i){function s(t,e,i){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");this.containerElement=t,this.width="400px",this.height="400px",this.margin=10,this.defaultXCenter="55%",this.defaultYCenter="50%",this.xLabel="x",this.yLabel="y",this.zLabel="z";var o=function(t){return t};this.xValueLabel=o,this.yValueLabel=o,this.zValueLabel=o,this.filterLabel="time",this.legendLabel="value",this.style=s.STYLE.DOT,this.showPerspective=!0,this.showGrid=!0,this.keepAspectRatio=!0,this.showShadow=!1,this.showGrayBottom=!1,this.showTooltip=!1,this.verticalRatio=.5,this.animationInterval=1e3,this.animationPreload=!1,this.camera=new p,this.eye=new l(0,0,-1),this.dataTable=null,this.dataPoints=null,this.colX=void 0,this.colY=void 0,this.colZ=void 0,this.colValue=void 0,this.colFilter=void 0,this.xMin=0,this.xStep=void 0,this.xMax=1,this.yMin=0,this.yStep=void 0,this.yMax=1,this.zMin=0,this.zStep=void 0,this.zMax=1,this.valueMin=0,this.valueMax=1,this.xBarWidth=1,this.yBarWidth=1,this.colorAxis="#4D4D4D",this.colorGrid="#D3D3D3",this.colorDot="#7DC1FF",this.colorDotBorder="#3267D2",this.create(),this.setOptions(i),e&&this.setData(e)}function o(t){return"clientX"in t?t.clientX:t.targetTouches[0]&&t.targetTouches[0].clientX||0}function n(t){return"clientY"in t?t.clientY:t.targetTouches[0]&&t.targetTouches[0].clientY||0}var r=i(56),a=i(3),h=i(4),d=i(1),l=i(10),c=i(9),p=i(7),u=i(8),m=i(11),f=i(12);r(s.prototype),s.prototype._setScale=function(){this.scale=new l(1/(this.xMax-this.xMin),1/(this.yMax-this.yMin),1/(this.zMax-this.zMin)),this.keepAspectRatio&&(this.scale.x<this.scale.y?this.scale.y=this.scale.x:this.scale.x=this.scale.y),this.scale.z*=this.verticalRatio,this.scale.value=1/(this.valueMax-this.valueMin);var t=(this.xMax+this.xMin)/2*this.scale.x,e=(this.yMax+this.yMin)/2*this.scale.y,i=(this.zMax+this.zMin)/2*this.scale.z;this.camera.setArmLocation(t,e,i)},s.prototype._convert3Dto2D=function(t){var e=this._convertPointToTranslation(t);return this._convertTranslationToScreen(e)},s.prototype._convertPointToTranslation=function(t){var e=t.x*this.scale.x,i=t.y*this.scale.y,s=t.z*this.scale.z,o=this.camera.getCameraLocation().x,n=this.camera.getCameraLocation().y,r=this.camera.getCameraLocation().z,a=Math.sin(this.camera.getCameraRotation().x),h=Math.cos(this.camera.getCameraRotation().x),d=Math.sin(this.camera.getCameraRotation().y),c=Math.cos(this.camera.getCameraRotation().y),p=Math.sin(this.camera.getCameraRotation().z),u=Math.cos(this.camera.getCameraRotation().z),m=c*(p*(i-n)+u*(e-o))-d*(s-r),f=a*(c*(s-r)+d*(p*(i-n)+u*(e-o)))+h*(u*(i-n)-p*(e-o)),g=h*(c*(s-r)+d*(p*(i-n)+u*(e-o)))-a*(u*(i-n)-p*(e-o));return new l(m,f,g)},s.prototype._convertTranslationToScreen=function(t){var e,i,s=this.eye.x,o=this.eye.y,n=this.eye.z,r=t.x,a=t.y,h=t.z;return this.showPerspective?(e=(r-s)*(n/h),i=(a-o)*(n/h)):(e=r*-(n/this.camera.getArmLength()),i=a*-(n/this.camera.getArmLength())),new c(this.xcenter+e*this.frame.canvas.clientWidth,this.ycenter-i*this.frame.canvas.clientWidth)},s.prototype._setBackgroundColor=function(t){var e="white",i="gray",s=1;if("string"==typeof t)e=t,i="none",s=0;else if("object"==typeof t)void 0!==t.fill&&(e=t.fill),void 0!==t.stroke&&(i=t.stroke),void 0!==t.strokeWidth&&(s=t.strokeWidth);else if(void 0!==t)throw"Unsupported type of backgroundColor";this.frame.style.backgroundColor=e,this.frame.style.borderColor=i,this.frame.style.borderWidth=s+"px",this.frame.style.borderStyle="solid"},s.STYLE={BAR:0,BARCOLOR:1,BARSIZE:2,DOT:3,DOTLINE:4,DOTCOLOR:5,DOTSIZE:6,GRID:7,LINE:8,SURFACE:9},s.prototype._getStyleNumber=function(t){switch(t){case"dot":return s.STYLE.DOT;case"dot-line":return s.STYLE.DOTLINE;case"dot-color":return s.STYLE.DOTCOLOR;case"dot-size":return s.STYLE.DOTSIZE;case"line":return s.STYLE.LINE;case"grid":return s.STYLE.GRID;case"surface":return s.STYLE.SURFACE;case"bar":return s.STYLE.BAR;case"bar-color":return s.STYLE.BARCOLOR;case"bar-size":return s.STYLE.BARSIZE}return-1},s.prototype._determineColumnIndexes=function(t){if(this.style===s.STYLE.DOT||this.style===s.STYLE.DOTLINE||this.style===s.STYLE.LINE||this.style===s.STYLE.GRID||this.style===s.STYLE.SURFACE||this.style===s.STYLE.BAR)this.colX=0,this.colY=1,this.colZ=2,this.colValue=void 0,t.getNumberOfColumns()>3&&(this.colFilter=3);else{if(this.style!==s.STYLE.DOTCOLOR&&this.style!==s.STYLE.DOTSIZE&&this.style!==s.STYLE.BARCOLOR&&this.style!==s.STYLE.BARSIZE)throw'Unknown style "'+this.style+'"';this.colX=0,this.colY=1,this.colZ=2,this.colValue=3,t.getNumberOfColumns()>4&&(this.colFilter=4)}},s.prototype.getNumberOfRows=function(t){return t.length},s.prototype.getNumberOfColumns=function(t){var e=0;for(var i in t[0])t[0].hasOwnProperty(i)&&e++;return e},s.prototype.getDistinctValues=function(t,e){for(var i=[],s=0;s<t.length;s++)-1==i.indexOf(t[s][e])&&i.push(t[s][e]);return i},s.prototype.getColumnRange=function(t,e){for(var i={min:t[0][e],max:t[0][e]},s=0;s<t.length;s++)i.min>t[s][e]&&(i.min=t[s][e]),i.max<t[s][e]&&(i.max=t[s][e]);return i},s.prototype._dataInitialize=function(t){var e=this;if(this.dataSet&&this.dataSet.off("*",this._onChange),void 0!==t){Array.isArray(t)&&(t=new a(t));var i;if(!(t instanceof a||t instanceof h))throw new Error("Array, DataSet, or DataView expected");if(i=t.get(),0!=i.length){this.dataSet=t,this.dataTable=i,this._onChange=function(){e.setData(e.dataSet)},this.dataSet.on("*",this._onChange),this.colX="x",this.colY="y",this.colZ="z",this.colValue="style",this.colFilter="filter",i[0].hasOwnProperty("filter")&&void 0===this.dataFilter&&(this.dataFilter=new u(t,this.colFilter,this),this.dataFilter.setOnLoadCallback(function(){e.redraw()}));var o=this.style==s.STYLE.BAR||this.style==s.STYLE.BARCOLOR||this.style==s.STYLE.BARSIZE;if(o){if(void 0!==this.defaultXBarWidth)this.xBarWidth=this.defaultXBarWidth;else{var n=this.getDistinctValues(i,this.colX);this.xBarWidth=n[1]-n[0]||1}if(void 0!==this.defaultYBarWidth)this.yBarWidth=this.defaultYBarWidth;else{var r=this.getDistinctValues(i,this.colY);this.yBarWidth=r[1]-r[0]||1}}var d=this.getColumnRange(i,this.colX);o&&(d.min-=this.xBarWidth/2,d.max+=this.xBarWidth/2),this.xMin=void 0!==this.defaultXMin?this.defaultXMin:d.min,this.xMax=void 0!==this.defaultXMax?this.defaultXMax:d.max,this.xMax<=this.xMin&&(this.xMax=this.xMin+1),this.xStep=void 0!==this.defaultXStep?this.defaultXStep:(this.xMax-this.xMin)/5;var l=this.getColumnRange(i,this.colY);
o&&(l.min-=this.yBarWidth/2,l.max+=this.yBarWidth/2),this.yMin=void 0!==this.defaultYMin?this.defaultYMin:l.min,this.yMax=void 0!==this.defaultYMax?this.defaultYMax:l.max,this.yMax<=this.yMin&&(this.yMax=this.yMin+1),this.yStep=void 0!==this.defaultYStep?this.defaultYStep:(this.yMax-this.yMin)/5;var c=this.getColumnRange(i,this.colZ);if(this.zMin=void 0!==this.defaultZMin?this.defaultZMin:c.min,this.zMax=void 0!==this.defaultZMax?this.defaultZMax:c.max,this.zMax<=this.zMin&&(this.zMax=this.zMin+1),this.zStep=void 0!==this.defaultZStep?this.defaultZStep:(this.zMax-this.zMin)/5,void 0!==this.colValue){var p=this.getColumnRange(i,this.colValue);this.valueMin=void 0!==this.defaultValueMin?this.defaultValueMin:p.min,this.valueMax=void 0!==this.defaultValueMax?this.defaultValueMax:p.max,this.valueMax<=this.valueMin&&(this.valueMax=this.valueMin+1)}this._setScale()}}},s.prototype._getDataPoints=function(t){var e,i,o,n,r,a,h=[];if(this.style===s.STYLE.GRID||this.style===s.STYLE.SURFACE){var d=[],c=[];for(o=0;o<this.getNumberOfRows(t);o++)e=t[o][this.colX]||0,i=t[o][this.colY]||0,-1===d.indexOf(e)&&d.push(e),-1===c.indexOf(i)&&c.push(i);var p=function(t,e){return t-e};d.sort(p),c.sort(p);var u=[];for(o=0;o<t.length;o++){e=t[o][this.colX]||0,i=t[o][this.colY]||0,n=t[o][this.colZ]||0;var m=d.indexOf(e),f=c.indexOf(i);void 0===u[m]&&(u[m]=[]);var g=new l;g.x=e,g.y=i,g.z=n,r={},r.point=g,r.trans=void 0,r.screen=void 0,r.bottom=new l(e,i,this.zMin),u[m][f]=r,h.push(r)}for(e=0;e<u.length;e++)for(i=0;i<u[e].length;i++)u[e][i]&&(u[e][i].pointRight=e<u.length-1?u[e+1][i]:void 0,u[e][i].pointTop=i<u[e].length-1?u[e][i+1]:void 0,u[e][i].pointCross=e<u.length-1&&i<u[e].length-1?u[e+1][i+1]:void 0)}else for(o=0;o<t.length;o++)a=new l,a.x=t[o][this.colX]||0,a.y=t[o][this.colY]||0,a.z=t[o][this.colZ]||0,void 0!==this.colValue&&(a.value=t[o][this.colValue]||0),r={},r.point=a,r.bottom=new l(a.x,a.y,this.zMin),r.trans=void 0,r.screen=void 0,h.push(r);return h},s.prototype.create=function(){for(;this.containerElement.hasChildNodes();)this.containerElement.removeChild(this.containerElement.firstChild);this.frame=document.createElement("div"),this.frame.style.position="relative",this.frame.style.overflow="hidden",this.frame.canvas=document.createElement("canvas"),this.frame.canvas.style.position="relative",this.frame.appendChild(this.frame.canvas);var t=document.createElement("DIV");t.style.color="red",t.style.fontWeight="bold",t.style.padding="10px",t.innerHTML="Error: your browser does not support HTML canvas",this.frame.canvas.appendChild(t),this.frame.filter=document.createElement("div"),this.frame.filter.style.position="absolute",this.frame.filter.style.bottom="0px",this.frame.filter.style.left="0px",this.frame.filter.style.width="100%",this.frame.appendChild(this.frame.filter);var e=this,i=function(t){e._onMouseDown(t)},s=function(t){e._onTouchStart(t)},o=function(t){e._onWheel(t)},n=function(t){e._onTooltip(t)};d.addEventListener(this.frame.canvas,"keydown",onkeydown),d.addEventListener(this.frame.canvas,"mousedown",i),d.addEventListener(this.frame.canvas,"touchstart",s),d.addEventListener(this.frame.canvas,"mousewheel",o),d.addEventListener(this.frame.canvas,"mousemove",n),this.containerElement.appendChild(this.frame)},s.prototype.setSize=function(t,e){this.frame.style.width=t,this.frame.style.height=e,this._resizeCanvas()},s.prototype._resizeCanvas=function(){this.frame.canvas.style.width="100%",this.frame.canvas.style.height="100%",this.frame.canvas.width=this.frame.canvas.clientWidth,this.frame.canvas.height=this.frame.canvas.clientHeight,this.frame.filter.style.width=this.frame.canvas.clientWidth-20+"px"},s.prototype.animationStart=function(){if(!this.frame.filter||!this.frame.filter.slider)throw"No animation available";this.frame.filter.slider.play()},s.prototype.animationStop=function(){this.frame.filter&&this.frame.filter.slider&&this.frame.filter.slider.stop()},s.prototype._resizeCenter=function(){this.xcenter="%"===this.defaultXCenter.charAt(this.defaultXCenter.length-1)?parseFloat(this.defaultXCenter)/100*this.frame.canvas.clientWidth:parseFloat(this.defaultXCenter),this.ycenter="%"===this.defaultYCenter.charAt(this.defaultYCenter.length-1)?parseFloat(this.defaultYCenter)/100*(this.frame.canvas.clientHeight-this.frame.filter.clientHeight):parseFloat(this.defaultYCenter)},s.prototype.setCameraPosition=function(t){void 0!==t&&(void 0!==t.horizontal&&void 0!==t.vertical&&this.camera.setArmRotation(t.horizontal,t.vertical),void 0!==t.distance&&this.camera.setArmLength(t.distance),this.redraw())},s.prototype.getCameraPosition=function(){var t=this.camera.getArmRotation();return t.distance=this.camera.getArmLength(),t},s.prototype._readData=function(t){this._dataInitialize(t,this.style),this.dataPoints=this.dataFilter?this.dataFilter._getDataPoints():this._getDataPoints(this.dataTable),this._redrawFilter()},s.prototype.setData=function(t){this._readData(t),this.redraw(),this.animationAutoStart&&this.dataFilter&&this.animationStart()},s.prototype.setOptions=function(t){var e=void 0;if(this.animationStop(),void 0!==t){if(void 0!==t.width&&(this.width=t.width),void 0!==t.height&&(this.height=t.height),void 0!==t.xCenter&&(this.defaultXCenter=t.xCenter),void 0!==t.yCenter&&(this.defaultYCenter=t.yCenter),void 0!==t.filterLabel&&(this.filterLabel=t.filterLabel),void 0!==t.legendLabel&&(this.legendLabel=t.legendLabel),void 0!==t.xLabel&&(this.xLabel=t.xLabel),void 0!==t.yLabel&&(this.yLabel=t.yLabel),void 0!==t.zLabel&&(this.zLabel=t.zLabel),void 0!==t.xValueLabel&&(this.xValueLabel=t.xValueLabel),void 0!==t.yValueLabel&&(this.yValueLabel=t.yValueLabel),void 0!==t.zValueLabel&&(this.zValueLabel=t.zValueLabel),void 0!==t.style){var i=this._getStyleNumber(t.style);-1!==i&&(this.style=i)}void 0!==t.showGrid&&(this.showGrid=t.showGrid),void 0!==t.showPerspective&&(this.showPerspective=t.showPerspective),void 0!==t.showShadow&&(this.showShadow=t.showShadow),void 0!==t.tooltip&&(this.showTooltip=t.tooltip),void 0!==t.showAnimationControls&&(this.showAnimationControls=t.showAnimationControls),void 0!==t.keepAspectRatio&&(this.keepAspectRatio=t.keepAspectRatio),void 0!==t.verticalRatio&&(this.verticalRatio=t.verticalRatio),void 0!==t.animationInterval&&(this.animationInterval=t.animationInterval),void 0!==t.animationPreload&&(this.animationPreload=t.animationPreload),void 0!==t.animationAutoStart&&(this.animationAutoStart=t.animationAutoStart),void 0!==t.xBarWidth&&(this.defaultXBarWidth=t.xBarWidth),void 0!==t.yBarWidth&&(this.defaultYBarWidth=t.yBarWidth),void 0!==t.xMin&&(this.defaultXMin=t.xMin),void 0!==t.xStep&&(this.defaultXStep=t.xStep),void 0!==t.xMax&&(this.defaultXMax=t.xMax),void 0!==t.yMin&&(this.defaultYMin=t.yMin),void 0!==t.yStep&&(this.defaultYStep=t.yStep),void 0!==t.yMax&&(this.defaultYMax=t.yMax),void 0!==t.zMin&&(this.defaultZMin=t.zMin),void 0!==t.zStep&&(this.defaultZStep=t.zStep),void 0!==t.zMax&&(this.defaultZMax=t.zMax),void 0!==t.valueMin&&(this.defaultValueMin=t.valueMin),void 0!==t.valueMax&&(this.defaultValueMax=t.valueMax),void 0!==t.cameraPosition&&(e=t.cameraPosition),void 0!==e?(this.camera.setArmRotation(e.horizontal,e.vertical),this.camera.setArmLength(e.distance)):(this.camera.setArmRotation(1,.5),this.camera.setArmLength(1.7))}this._setBackgroundColor(t&&t.backgroundColor),this.setSize(this.width,this.height),this.dataTable&&this.setData(this.dataTable),this.animationAutoStart&&this.dataFilter&&this.animationStart()},s.prototype.redraw=function(){if(void 0===this.dataPoints)throw"Error: graph data not initialized";this._resizeCanvas(),this._resizeCenter(),this._redrawSlider(),this._redrawClear(),this._redrawAxis(),this.style===s.STYLE.GRID||this.style===s.STYLE.SURFACE?this._redrawDataGrid():this.style===s.STYLE.LINE?this._redrawDataLine():this.style===s.STYLE.BAR||this.style===s.STYLE.BARCOLOR||this.style===s.STYLE.BARSIZE?this._redrawDataBar():this._redrawDataDot(),this._redrawInfo(),this._redrawLegend()},s.prototype._redrawClear=function(){var t=this.frame.canvas,e=t.getContext("2d");e.clearRect(0,0,t.width,t.height)},s.prototype._redrawLegend=function(){var t;if(this.style===s.STYLE.DOTCOLOR||this.style===s.STYLE.DOTSIZE){var e,i,o=.02*this.frame.clientWidth;this.style===s.STYLE.DOTSIZE?(e=o/2,i=o/2+2*o):(e=20,i=20);var n=Math.max(.25*this.frame.clientHeight,100),r=this.margin,a=this.frame.clientWidth-this.margin,h=a-i,d=r+n}var l=this.frame.canvas,c=l.getContext("2d");if(c.lineWidth=1,c.font="14px arial",this.style===s.STYLE.DOTCOLOR){var p=0,u=n;for(t=p;u>t;t++){var m=(t-p)/(u-p),g=240*m,v=this._hsv2rgb(g,1,1);c.strokeStyle=v,c.beginPath(),c.moveTo(h,r+t),c.lineTo(a,r+t),c.stroke()}c.strokeStyle=this.colorAxis,c.strokeRect(h,r,i,n)}if(this.style===s.STYLE.DOTSIZE&&(c.strokeStyle=this.colorAxis,c.fillStyle=this.colorDot,c.beginPath(),c.moveTo(h,r),c.lineTo(a,r),c.lineTo(a-i+e,d),c.lineTo(h,d),c.closePath(),c.fill(),c.stroke()),this.style===s.STYLE.DOTCOLOR||this.style===s.STYLE.DOTSIZE){var y=5,b=new f(this.valueMin,this.valueMax,(this.valueMax-this.valueMin)/5,!0);for(b.start(),b.getCurrent()<this.valueMin&&b.next();!b.end();)t=d-(b.getCurrent()-this.valueMin)/(this.valueMax-this.valueMin)*n,c.beginPath(),c.moveTo(h-y,t),c.lineTo(h,t),c.stroke(),c.textAlign="right",c.textBaseline="middle",c.fillStyle=this.colorAxis,c.fillText(b.getCurrent(),h-2*y,t),b.next();c.textAlign="right",c.textBaseline="top";var _=this.legendLabel;c.fillText(_,a,d+this.margin)}},s.prototype._redrawFilter=function(){if(this.frame.filter.innerHTML="",this.dataFilter){var t={visible:this.showAnimationControls},e=new m(this.frame.filter,t);this.frame.filter.slider=e,this.frame.filter.style.padding="10px",e.setValues(this.dataFilter.values),e.setPlayInterval(this.animationInterval);var i=this,s=function(){var t=e.getIndex();i.dataFilter.selectValue(t),i.dataPoints=i.dataFilter._getDataPoints(),i.redraw()};e.setOnChangeCallback(s)}else this.frame.filter.slider=void 0},s.prototype._redrawSlider=function(){void 0!==this.frame.filter.slider&&this.frame.filter.slider.redraw()},s.prototype._redrawInfo=function(){if(this.dataFilter){var t=this.frame.canvas,e=t.getContext("2d");e.font="14px arial",e.lineStyle="gray",e.fillStyle="gray",e.textAlign="left",e.textBaseline="top";var i=this.margin,s=this.margin;e.fillText(this.dataFilter.getLabel()+": "+this.dataFilter.getSelectedValue(),i,s)}},s.prototype._redrawAxis=function(){var t,e,i,s,o,n,r,a,h,d,c,p,u,m=this.frame.canvas,g=m.getContext("2d");g.font=24/this.camera.getArmLength()+"px arial";var v=.025/this.scale.x,y=.025/this.scale.y,b=5/this.camera.getArmLength(),_=this.camera.getArmRotation().horizontal;for(g.lineWidth=1,s=void 0===this.defaultXStep,i=new f(this.xMin,this.xMax,this.xStep,s),i.start(),i.getCurrent()<this.xMin&&i.next();!i.end();){var x=i.getCurrent();this.showGrid?(t=this._convert3Dto2D(new l(x,this.yMin,this.zMin)),e=this._convert3Dto2D(new l(x,this.yMax,this.zMin)),g.strokeStyle=this.colorGrid,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke()):(t=this._convert3Dto2D(new l(x,this.yMin,this.zMin)),e=this._convert3Dto2D(new l(x,this.yMin+v,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke(),t=this._convert3Dto2D(new l(x,this.yMax,this.zMin)),e=this._convert3Dto2D(new l(x,this.yMax-v,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke()),r=Math.cos(_)>0?this.yMin:this.yMax,o=this._convert3Dto2D(new l(x,r,this.zMin)),Math.cos(2*_)>0?(g.textAlign="center",g.textBaseline="top",o.y+=b):Math.sin(2*_)<0?(g.textAlign="right",g.textBaseline="middle"):(g.textAlign="left",g.textBaseline="middle"),g.fillStyle=this.colorAxis,g.fillText("  "+this.xValueLabel(i.getCurrent())+"  ",o.x,o.y),i.next()}for(g.lineWidth=1,s=void 0===this.defaultYStep,i=new f(this.yMin,this.yMax,this.yStep,s),i.start(),i.getCurrent()<this.yMin&&i.next();!i.end();)this.showGrid?(t=this._convert3Dto2D(new l(this.xMin,i.getCurrent(),this.zMin)),e=this._convert3Dto2D(new l(this.xMax,i.getCurrent(),this.zMin)),g.strokeStyle=this.colorGrid,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke()):(t=this._convert3Dto2D(new l(this.xMin,i.getCurrent(),this.zMin)),e=this._convert3Dto2D(new l(this.xMin+y,i.getCurrent(),this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke(),t=this._convert3Dto2D(new l(this.xMax,i.getCurrent(),this.zMin)),e=this._convert3Dto2D(new l(this.xMax-y,i.getCurrent(),this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke()),n=Math.sin(_)>0?this.xMin:this.xMax,o=this._convert3Dto2D(new l(n,i.getCurrent(),this.zMin)),Math.cos(2*_)<0?(g.textAlign="center",g.textBaseline="top",o.y+=b):Math.sin(2*_)>0?(g.textAlign="right",g.textBaseline="middle"):(g.textAlign="left",g.textBaseline="middle"),g.fillStyle=this.colorAxis,g.fillText("  "+this.yValueLabel(i.getCurrent())+"  ",o.x,o.y),i.next();for(g.lineWidth=1,s=void 0===this.defaultZStep,i=new f(this.zMin,this.zMax,this.zStep,s),i.start(),i.getCurrent()<this.zMin&&i.next(),n=Math.cos(_)>0?this.xMin:this.xMax,r=Math.sin(_)<0?this.yMin:this.yMax;!i.end();)t=this._convert3Dto2D(new l(n,r,i.getCurrent())),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(t.x-b,t.y),g.stroke(),g.textAlign="right",g.textBaseline="middle",g.fillStyle=this.colorAxis,g.fillText(this.zValueLabel(i.getCurrent())+" ",t.x-5,t.y),i.next();g.lineWidth=1,t=this._convert3Dto2D(new l(n,r,this.zMin)),e=this._convert3Dto2D(new l(n,r,this.zMax)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke(),g.lineWidth=1,p=this._convert3Dto2D(new l(this.xMin,this.yMin,this.zMin)),u=this._convert3Dto2D(new l(this.xMax,this.yMin,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(p.x,p.y),g.lineTo(u.x,u.y),g.stroke(),p=this._convert3Dto2D(new l(this.xMin,this.yMax,this.zMin)),u=this._convert3Dto2D(new l(this.xMax,this.yMax,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(p.x,p.y),g.lineTo(u.x,u.y),g.stroke(),g.lineWidth=1,t=this._convert3Dto2D(new l(this.xMin,this.yMin,this.zMin)),e=this._convert3Dto2D(new l(this.xMin,this.yMax,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke(),t=this._convert3Dto2D(new l(this.xMax,this.yMin,this.zMin)),e=this._convert3Dto2D(new l(this.xMax,this.yMax,this.zMin)),g.strokeStyle=this.colorAxis,g.beginPath(),g.moveTo(t.x,t.y),g.lineTo(e.x,e.y),g.stroke();var w=this.xLabel;w.length>0&&(c=.1/this.scale.y,n=(this.xMin+this.xMax)/2,r=Math.cos(_)>0?this.yMin-c:this.yMax+c,o=this._convert3Dto2D(new l(n,r,this.zMin)),Math.cos(2*_)>0?(g.textAlign="center",g.textBaseline="top"):Math.sin(2*_)<0?(g.textAlign="right",g.textBaseline="middle"):(g.textAlign="left",g.textBaseline="middle"),g.fillStyle=this.colorAxis,g.fillText(w,o.x,o.y));var M=this.yLabel;M.length>0&&(d=.1/this.scale.x,n=Math.sin(_)>0?this.xMin-d:this.xMax+d,r=(this.yMin+this.yMax)/2,o=this._convert3Dto2D(new l(n,r,this.zMin)),Math.cos(2*_)<0?(g.textAlign="center",g.textBaseline="top"):Math.sin(2*_)>0?(g.textAlign="right",g.textBaseline="middle"):(g.textAlign="left",g.textBaseline="middle"),g.fillStyle=this.colorAxis,g.fillText(M,o.x,o.y));var S=this.zLabel;S.length>0&&(h=30,n=Math.cos(_)>0?this.xMin:this.xMax,r=Math.sin(_)<0?this.yMin:this.yMax,a=(this.zMin+this.zMax)/2,o=this._convert3Dto2D(new l(n,r,a)),g.textAlign="right",g.textBaseline="middle",g.fillStyle=this.colorAxis,g.fillText(S,o.x-h,o.y))},s.prototype._hsv2rgb=function(t,e,i){var s,o,n,r,a,h;switch(r=i*e,a=Math.floor(t/60),h=r*(1-Math.abs(t/60%2-1)),a){case 0:s=r,o=h,n=0;break;case 1:s=h,o=r,n=0;break;case 2:s=0,o=r,n=h;break;case 3:s=0,o=h,n=r;break;case 4:s=h,o=0,n=r;break;case 5:s=r,o=0,n=h;break;default:s=0,o=0,n=0}return"RGB("+parseInt(255*s)+","+parseInt(255*o)+","+parseInt(255*n)+")"},s.prototype._redrawDataGrid=function(){var t,e,i,o,n,r,a,h,d,c,p,u,m,f=this.frame.canvas,g=f.getContext("2d");if(!(void 0===this.dataPoints||this.dataPoints.length<=0)){for(n=0;n<this.dataPoints.length;n++){var v=this._convertPointToTranslation(this.dataPoints[n].point),y=this._convertTranslationToScreen(v);this.dataPoints[n].trans=v,this.dataPoints[n].screen=y;var b=this._convertPointToTranslation(this.dataPoints[n].bottom);this.dataPoints[n].dist=this.showPerspective?b.length():-b.z}var _=function(t,e){return e.dist-t.dist};if(this.dataPoints.sort(_),this.style===s.STYLE.SURFACE){for(n=0;n<this.dataPoints.length;n++)if(t=this.dataPoints[n],e=this.dataPoints[n].pointRight,i=this.dataPoints[n].pointTop,o=this.dataPoints[n].pointCross,void 0!==t&&void 0!==e&&void 0!==i&&void 0!==o){if(this.showGrayBottom||this.showShadow){var x=l.subtract(o.trans,t.trans),w=l.subtract(i.trans,e.trans),M=l.crossProduct(x,w),S=M.length();r=M.z>0}else r=!0;r?(m=(t.point.z+e.point.z+i.point.z+o.point.z)/4,c=240*(1-(m-this.zMin)*this.scale.z/this.verticalRatio),p=1,this.showShadow?(u=Math.min(1+M.x/S/2,1),a=this._hsv2rgb(c,p,u),h=a):(u=1,a=this._hsv2rgb(c,p,u),h=this.colorAxis)):(a="gray",h=this.colorAxis),d=.5,g.lineWidth=d,g.fillStyle=a,g.strokeStyle=h,g.beginPath(),g.moveTo(t.screen.x,t.screen.y),g.lineTo(e.screen.x,e.screen.y),g.lineTo(o.screen.x,o.screen.y),g.lineTo(i.screen.x,i.screen.y),g.closePath(),g.fill(),g.stroke()}}else for(n=0;n<this.dataPoints.length;n++)t=this.dataPoints[n],e=this.dataPoints[n].pointRight,i=this.dataPoints[n].pointTop,void 0!==t&&(d=this.showPerspective?2/-t.trans.z:2*-(this.eye.z/this.camera.getArmLength())),void 0!==t&&void 0!==e&&(m=(t.point.z+e.point.z)/2,c=240*(1-(m-this.zMin)*this.scale.z/this.verticalRatio),g.lineWidth=d,g.strokeStyle=this._hsv2rgb(c,1,1),g.beginPath(),g.moveTo(t.screen.x,t.screen.y),g.lineTo(e.screen.x,e.screen.y),g.stroke()),void 0!==t&&void 0!==i&&(m=(t.point.z+i.point.z)/2,c=240*(1-(m-this.zMin)*this.scale.z/this.verticalRatio),g.lineWidth=d,g.strokeStyle=this._hsv2rgb(c,1,1),g.beginPath(),g.moveTo(t.screen.x,t.screen.y),g.lineTo(i.screen.x,i.screen.y),g.stroke())}},s.prototype._redrawDataDot=function(){var t,e=this.frame.canvas,i=e.getContext("2d");if(!(void 0===this.dataPoints||this.dataPoints.length<=0)){for(t=0;t<this.dataPoints.length;t++){var o=this._convertPointToTranslation(this.dataPoints[t].point),n=this._convertTranslationToScreen(o);this.dataPoints[t].trans=o,this.dataPoints[t].screen=n;var r=this._convertPointToTranslation(this.dataPoints[t].bottom);this.dataPoints[t].dist=this.showPerspective?r.length():-r.z}var a=function(t,e){return e.dist-t.dist};this.dataPoints.sort(a);var h=.02*this.frame.clientWidth;for(t=0;t<this.dataPoints.length;t++){var d=this.dataPoints[t];if(this.style===s.STYLE.DOTLINE){var l=this._convert3Dto2D(d.bottom);i.lineWidth=1,i.strokeStyle=this.colorGrid,i.beginPath(),i.moveTo(l.x,l.y),i.lineTo(d.screen.x,d.screen.y),i.stroke()}var c;c=this.style===s.STYLE.DOTSIZE?h/2+2*h*(d.point.value-this.valueMin)/(this.valueMax-this.valueMin):h;var p;p=this.showPerspective?c/-d.trans.z:c*-(this.eye.z/this.camera.getArmLength()),0>p&&(p=0);var u,m,f;this.style===s.STYLE.DOTCOLOR?(u=240*(1-(d.point.value-this.valueMin)*this.scale.value),m=this._hsv2rgb(u,1,1),f=this._hsv2rgb(u,1,.8)):this.style===s.STYLE.DOTSIZE?(m=this.colorDot,f=this.colorDotBorder):(u=240*(1-(d.point.z-this.zMin)*this.scale.z/this.verticalRatio),m=this._hsv2rgb(u,1,1),f=this._hsv2rgb(u,1,.8)),i.lineWidth=1,i.strokeStyle=f,i.fillStyle=m,i.beginPath(),i.arc(d.screen.x,d.screen.y,p,0,2*Math.PI,!0),i.fill(),i.stroke()}}},s.prototype._redrawDataBar=function(){var t,e,i,o,n=this.frame.canvas,r=n.getContext("2d");if(!(void 0===this.dataPoints||this.dataPoints.length<=0)){for(t=0;t<this.dataPoints.length;t++){var a=this._convertPointToTranslation(this.dataPoints[t].point),h=this._convertTranslationToScreen(a);this.dataPoints[t].trans=a,this.dataPoints[t].screen=h;var d=this._convertPointToTranslation(this.dataPoints[t].bottom);this.dataPoints[t].dist=this.showPerspective?d.length():-d.z}var c=function(t,e){return e.dist-t.dist};this.dataPoints.sort(c);var p=this.xBarWidth/2,u=this.yBarWidth/2;for(t=0;t<this.dataPoints.length;t++){var m,f,g,v=this.dataPoints[t];this.style===s.STYLE.BARCOLOR?(m=240*(1-(v.point.value-this.valueMin)*this.scale.value),f=this._hsv2rgb(m,1,1),g=this._hsv2rgb(m,1,.8)):this.style===s.STYLE.BARSIZE?(f=this.colorDot,g=this.colorDotBorder):(m=240*(1-(v.point.z-this.zMin)*this.scale.z/this.verticalRatio),f=this._hsv2rgb(m,1,1),g=this._hsv2rgb(m,1,.8)),this.style===s.STYLE.BARSIZE&&(p=this.xBarWidth/2*((v.point.value-this.valueMin)/(this.valueMax-this.valueMin)*.8+.2),u=this.yBarWidth/2*((v.point.value-this.valueMin)/(this.valueMax-this.valueMin)*.8+.2));var y=this,b=v.point,_=[{point:new l(b.x-p,b.y-u,b.z)},{point:new l(b.x+p,b.y-u,b.z)},{point:new l(b.x+p,b.y+u,b.z)},{point:new l(b.x-p,b.y+u,b.z)}],x=[{point:new l(b.x-p,b.y-u,this.zMin)},{point:new l(b.x+p,b.y-u,this.zMin)},{point:new l(b.x+p,b.y+u,this.zMin)},{point:new l(b.x-p,b.y+u,this.zMin)}];_.forEach(function(t){t.screen=y._convert3Dto2D(t.point)}),x.forEach(function(t){t.screen=y._convert3Dto2D(t.point)});var w=[{corners:_,center:l.avg(x[0].point,x[2].point)},{corners:[_[0],_[1],x[1],x[0]],center:l.avg(x[1].point,x[0].point)},{corners:[_[1],_[2],x[2],x[1]],center:l.avg(x[2].point,x[1].point)},{corners:[_[2],_[3],x[3],x[2]],center:l.avg(x[3].point,x[2].point)},{corners:[_[3],_[0],x[0],x[3]],center:l.avg(x[0].point,x[3].point)}];for(v.surfaces=w,e=0;e<w.length;e++){i=w[e];var M=this._convertPointToTranslation(i.center);i.dist=this.showPerspective?M.length():-M.z}for(w.sort(function(t,e){var i=e.dist-t.dist;return i?i:t.corners===_?1:e.corners===_?-1:0}),r.lineWidth=1,r.strokeStyle=g,r.fillStyle=f,e=2;e<w.length;e++)i=w[e],o=i.corners,r.beginPath(),r.moveTo(o[3].screen.x,o[3].screen.y),r.lineTo(o[0].screen.x,o[0].screen.y),r.lineTo(o[1].screen.x,o[1].screen.y),r.lineTo(o[2].screen.x,o[2].screen.y),r.lineTo(o[3].screen.x,o[3].screen.y),r.fill(),r.stroke()}}},s.prototype._redrawDataLine=function(){var t,e,i=this.frame.canvas,s=i.getContext("2d");if(!(void 0===this.dataPoints||this.dataPoints.length<=0)){for(e=0;e<this.dataPoints.length;e++){var o=this._convertPointToTranslation(this.dataPoints[e].point),n=this._convertTranslationToScreen(o);this.dataPoints[e].trans=o,this.dataPoints[e].screen=n}for(this.dataPoints.length>0&&(t=this.dataPoints[0],s.lineWidth=1,s.strokeStyle="blue",s.beginPath(),s.moveTo(t.screen.x,t.screen.y)),e=1;e<this.dataPoints.length;e++)t=this.dataPoints[e],s.lineTo(t.screen.x,t.screen.y);this.dataPoints.length>0&&s.stroke()}},s.prototype._onMouseDown=function(t){if(t=t||window.event,this.leftButtonDown&&this._onMouseUp(t),this.leftButtonDown=t.which?1===t.which:1===t.button,this.leftButtonDown||this.touchDown){this.startMouseX=o(t),this.startMouseY=n(t),this.startStart=new Date(this.start),this.startEnd=new Date(this.end),this.startArmRotation=this.camera.getArmRotation(),this.frame.style.cursor="move";var e=this;this.onmousemove=function(t){e._onMouseMove(t)},this.onmouseup=function(t){e._onMouseUp(t)},d.addEventListener(document,"mousemove",e.onmousemove),d.addEventListener(document,"mouseup",e.onmouseup),d.preventDefault(t)}},s.prototype._onMouseMove=function(t){t=t||window.event;var e=parseFloat(o(t))-this.startMouseX,i=parseFloat(n(t))-this.startMouseY,s=this.startArmRotation.horizontal+e/200,r=this.startArmRotation.vertical+i/200,a=4,h=Math.sin(a/360*2*Math.PI);Math.abs(Math.sin(s))<h&&(s=Math.round(s/Math.PI)*Math.PI-.001),Math.abs(Math.cos(s))<h&&(s=(Math.round(s/Math.PI-.5)+.5)*Math.PI-.001),Math.abs(Math.sin(r))<h&&(r=Math.round(r/Math.PI)*Math.PI),Math.abs(Math.cos(r))<h&&(r=(Math.round(r/Math.PI-.5)+.5)*Math.PI),this.camera.setArmRotation(s,r),this.redraw();var l=this.getCameraPosition();this.emit("cameraPositionChange",l),d.preventDefault(t)},s.prototype._onMouseUp=function(t){this.frame.style.cursor="auto",this.leftButtonDown=!1,d.removeEventListener(document,"mousemove",this.onmousemove),d.removeEventListener(document,"mouseup",this.onmouseup),d.preventDefault(t)},s.prototype._onTooltip=function(t){var e=300,i=this.frame.getBoundingClientRect(),s=o(t)-i.left,r=n(t)-i.top;if(this.showTooltip){if(this.tooltipTimeout&&clearTimeout(this.tooltipTimeout),this.leftButtonDown)return void this._hideTooltip();if(this.tooltip&&this.tooltip.dataPoint){var a=this._dataPointFromXY(s,r);a!==this.tooltip.dataPoint&&(a?this._showTooltip(a):this._hideTooltip())}else{var h=this;this.tooltipTimeout=setTimeout(function(){h.tooltipTimeout=null;var t=h._dataPointFromXY(s,r);t&&h._showTooltip(t)},e)}}},s.prototype._onTouchStart=function(t){this.touchDown=!0;var e=this;this.ontouchmove=function(t){e._onTouchMove(t)},this.ontouchend=function(t){e._onTouchEnd(t)},d.addEventListener(document,"touchmove",e.ontouchmove),d.addEventListener(document,"touchend",e.ontouchend),this._onMouseDown(t)},s.prototype._onTouchMove=function(t){this._onMouseMove(t)},s.prototype._onTouchEnd=function(t){this.touchDown=!1,d.removeEventListener(document,"touchmove",this.ontouchmove),d.removeEventListener(document,"touchend",this.ontouchend),this._onMouseUp(t)},s.prototype._onWheel=function(t){t||(t=window.event);var e=0;if(t.wheelDelta?e=t.wheelDelta/120:t.detail&&(e=-t.detail/3),e){var i=this.camera.getArmLength(),s=i*(1-e/10);this.camera.setArmLength(s),this.redraw(),this._hideTooltip()}var o=this.getCameraPosition();this.emit("cameraPositionChange",o),d.preventDefault(t)},s.prototype._insideTriangle=function(t,e){function i(t){return t>0?1:0>t?-1:0}var s=e[0],o=e[1],n=e[2],r=i((o.x-s.x)*(t.y-s.y)-(o.y-s.y)*(t.x-s.x)),a=i((n.x-o.x)*(t.y-o.y)-(n.y-o.y)*(t.x-o.x)),h=i((s.x-n.x)*(t.y-n.y)-(s.y-n.y)*(t.x-n.x));return!(0!=r&&0!=a&&r!=a||0!=a&&0!=h&&a!=h||0!=r&&0!=h&&r!=h)},s.prototype._dataPointFromXY=function(t,e){var i,o=100,n=null,r=null,a=null,h=new c(t,e);if(this.style===s.STYLE.BAR||this.style===s.STYLE.BARCOLOR||this.style===s.STYLE.BARSIZE)for(i=this.dataPoints.length-1;i>=0;i--){n=this.dataPoints[i];var d=n.surfaces;if(d)for(var l=d.length-1;l>=0;l--){var p=d[l],u=p.corners,m=[u[0].screen,u[1].screen,u[2].screen],f=[u[2].screen,u[3].screen,u[0].screen];if(this._insideTriangle(h,m)||this._insideTriangle(h,f))return n}}else for(i=0;i<this.dataPoints.length;i++){n=this.dataPoints[i];var g=n.screen;if(g){var v=Math.abs(t-g.x),y=Math.abs(e-g.y),b=Math.sqrt(v*v+y*y);(null===a||a>b)&&o>b&&(a=b,r=n)}}return r},s.prototype._showTooltip=function(t){var e,i,s;this.tooltip?(e=this.tooltip.dom.content,i=this.tooltip.dom.line,s=this.tooltip.dom.dot):(e=document.createElement("div"),e.style.position="absolute",e.style.padding="10px",e.style.border="1px solid #4d4d4d",e.style.color="#1a1a1a",e.style.background="rgba(255,255,255,0.7)",e.style.borderRadius="2px",e.style.boxShadow="5px 5px 10px rgba(128,128,128,0.5)",i=document.createElement("div"),i.style.position="absolute",i.style.height="40px",i.style.width="0",i.style.borderLeft="1px solid #4d4d4d",s=document.createElement("div"),s.style.position="absolute",s.style.height="0",s.style.width="0",s.style.border="5px solid #4d4d4d",s.style.borderRadius="5px",this.tooltip={dataPoint:null,dom:{content:e,line:i,dot:s}}),this._hideTooltip(),this.tooltip.dataPoint=t,e.innerHTML="function"==typeof this.showTooltip?this.showTooltip(t.point):"<table><tr><td>x:</td><td>"+t.point.x+"</td></tr><tr><td>y:</td><td>"+t.point.y+"</td></tr><tr><td>z:</td><td>"+t.point.z+"</td></tr></table>",e.style.left="0",e.style.top="0",this.frame.appendChild(e),this.frame.appendChild(i),this.frame.appendChild(s);var o=e.offsetWidth,n=e.offsetHeight,r=i.offsetHeight,a=s.offsetWidth,h=s.offsetHeight,d=t.screen.x-o/2;d=Math.min(Math.max(d,10),this.frame.clientWidth-10-o),i.style.left=t.screen.x+"px",i.style.top=t.screen.y-r+"px",e.style.left=d+"px",e.style.top=t.screen.y-r-n+"px",s.style.left=t.screen.x-a/2+"px",s.style.top=t.screen.y-h/2+"px"},s.prototype._hideTooltip=function(){if(this.tooltip){this.tooltip.dataPoint=null;for(var t in this.tooltip.dom)if(this.tooltip.dom.hasOwnProperty(t)){var e=this.tooltip.dom[t];e&&e.parentNode&&e.parentNode.removeChild(e)}}},t.exports=s},function(t,e,i){function s(){this.armLocation=new o,this.armRotation={},this.armRotation.horizontal=0,this.armRotation.vertical=0,this.armLength=1.7,this.cameraLocation=new o,this.cameraRotation=new o(.5*Math.PI,0,0),this.calculateCameraOrientation()}var o=i(10);s.prototype.setArmLocation=function(t,e,i){this.armLocation.x=t,this.armLocation.y=e,this.armLocation.z=i,this.calculateCameraOrientation()},s.prototype.setArmRotation=function(t,e){void 0!==t&&(this.armRotation.horizontal=t),void 0!==e&&(this.armRotation.vertical=e,this.armRotation.vertical<0&&(this.armRotation.vertical=0),this.armRotation.vertical>.5*Math.PI&&(this.armRotation.vertical=.5*Math.PI)),(void 0!==t||void 0!==e)&&this.calculateCameraOrientation()},s.prototype.getArmRotation=function(){var t={};return t.horizontal=this.armRotation.horizontal,t.vertical=this.armRotation.vertical,t},s.prototype.setArmLength=function(t){void 0!==t&&(this.armLength=t,this.armLength<.71&&(this.armLength=.71),this.armLength>5&&(this.armLength=5),this.calculateCameraOrientation())},s.prototype.getArmLength=function(){return this.armLength},s.prototype.getCameraLocation=function(){return this.cameraLocation},s.prototype.getCameraRotation=function(){return this.cameraRotation},s.prototype.calculateCameraOrientation=function(){this.cameraLocation.x=this.armLocation.x-this.armLength*Math.sin(this.armRotation.horizontal)*Math.cos(this.armRotation.vertical),this.cameraLocation.y=this.armLocation.y-this.armLength*Math.cos(this.armRotation.horizontal)*Math.cos(this.armRotation.vertical),this.cameraLocation.z=this.armLocation.z+this.armLength*Math.sin(this.armRotation.vertical),this.cameraRotation.x=Math.PI/2-this.armRotation.vertical,this.cameraRotation.y=0,this.cameraRotation.z=-this.armRotation.horizontal},t.exports=s},function(t,e,i){function s(t,e,i){this.data=t,this.column=e,this.graph=i,this.index=void 0,this.value=void 0,this.values=i.getDistinctValues(t.get(),this.column),this.values.sort(function(t,e){return t>e?1:e>t?-1:0}),this.values.length>0&&this.selectValue(0),this.dataPoints=[],this.loaded=!1,this.onLoadCallback=void 0,i.animationPreload?(this.loaded=!1,this.loadInBackground()):this.loaded=!0}var o=i(4);s.prototype.isLoaded=function(){return this.loaded},s.prototype.getLoadedProgress=function(){for(var t=this.values.length,e=0;this.dataPoints[e];)e++;return Math.round(e/t*100)},s.prototype.getLabel=function(){return this.graph.filterLabel},s.prototype.getColumn=function(){return this.column},s.prototype.getSelectedValue=function(){return void 0===this.index?void 0:this.values[this.index]},s.prototype.getValues=function(){return this.values},s.prototype.getValue=function(t){if(t>=this.values.length)throw"Error: index out of range";return this.values[t]},s.prototype._getDataPoints=function(t){if(void 0===t&&(t=this.index),void 0===t)return[];var e;if(this.dataPoints[t])e=this.dataPoints[t];else{var i={};i.column=this.column,i.value=this.values[t];var s=new o(this.data,{filter:function(t){return t[i.column]==i.value}}).get();e=this.graph._getDataPoints(s),this.dataPoints[t]=e}return e},s.prototype.setOnLoadCallback=function(t){this.onLoadCallback=t},s.prototype.selectValue=function(t){if(t>=this.values.length)throw"Error: index out of range";this.index=t,this.value=this.values[t]},s.prototype.loadInBackground=function(t){void 0===t&&(t=0);var e=this.graph.frame;if(t<this.values.length){{this._getDataPoints(t)}void 0===e.progress&&(e.progress=document.createElement("DIV"),e.progress.style.position="absolute",e.progress.style.color="gray",e.appendChild(e.progress));var i=this.getLoadedProgress();e.progress.innerHTML="Loading animation... "+i+"%",e.progress.style.bottom="60px",e.progress.style.left="10px";var s=this;setTimeout(function(){s.loadInBackground(t+1)},10),this.loaded=!1}else this.loaded=!0,void 0!==e.progress&&(e.removeChild(e.progress),e.progress=void 0),this.onLoadCallback&&this.onLoadCallback()
},t.exports=s},function(t){function e(t,e){this.x=void 0!==t?t:0,this.y=void 0!==e?e:0}t.exports=e},function(t){function e(t,e,i){this.x=void 0!==t?t:0,this.y=void 0!==e?e:0,this.z=void 0!==i?i:0}e.subtract=function(t,i){var s=new e;return s.x=t.x-i.x,s.y=t.y-i.y,s.z=t.z-i.z,s},e.add=function(t,i){var s=new e;return s.x=t.x+i.x,s.y=t.y+i.y,s.z=t.z+i.z,s},e.avg=function(t,i){return new e((t.x+i.x)/2,(t.y+i.y)/2,(t.z+i.z)/2)},e.crossProduct=function(t,i){var s=new e;return s.x=t.y*i.z-t.z*i.y,s.y=t.z*i.x-t.x*i.z,s.z=t.x*i.y-t.y*i.x,s},e.prototype.length=function(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)},t.exports=e},function(t,e,i){function s(t,e){if(void 0===t)throw"Error: No container element defined";if(this.container=t,this.visible=e&&void 0!=e.visible?e.visible:!0,this.visible){this.frame=document.createElement("DIV"),this.frame.style.width="100%",this.frame.style.position="relative",this.container.appendChild(this.frame),this.frame.prev=document.createElement("INPUT"),this.frame.prev.type="BUTTON",this.frame.prev.value="Prev",this.frame.appendChild(this.frame.prev),this.frame.play=document.createElement("INPUT"),this.frame.play.type="BUTTON",this.frame.play.value="Play",this.frame.appendChild(this.frame.play),this.frame.next=document.createElement("INPUT"),this.frame.next.type="BUTTON",this.frame.next.value="Next",this.frame.appendChild(this.frame.next),this.frame.bar=document.createElement("INPUT"),this.frame.bar.type="BUTTON",this.frame.bar.style.position="absolute",this.frame.bar.style.border="1px solid red",this.frame.bar.style.width="100px",this.frame.bar.style.height="6px",this.frame.bar.style.borderRadius="2px",this.frame.bar.style.MozBorderRadius="2px",this.frame.bar.style.border="1px solid #7F7F7F",this.frame.bar.style.backgroundColor="#E5E5E5",this.frame.appendChild(this.frame.bar),this.frame.slide=document.createElement("INPUT"),this.frame.slide.type="BUTTON",this.frame.slide.style.margin="0px",this.frame.slide.value=" ",this.frame.slide.style.position="relative",this.frame.slide.style.left="-100px",this.frame.appendChild(this.frame.slide);var i=this;this.frame.slide.onmousedown=function(t){i._onMouseDown(t)},this.frame.prev.onclick=function(t){i.prev(t)},this.frame.play.onclick=function(t){i.togglePlay(t)},this.frame.next.onclick=function(t){i.next(t)}}this.onChangeCallback=void 0,this.values=[],this.index=void 0,this.playTimeout=void 0,this.playInterval=1e3,this.playLoop=!0}var o=i(1);s.prototype.prev=function(){var t=this.getIndex();t>0&&(t--,this.setIndex(t))},s.prototype.next=function(){var t=this.getIndex();t<this.values.length-1&&(t++,this.setIndex(t))},s.prototype.playNext=function(){var t=new Date,e=this.getIndex();e<this.values.length-1?(e++,this.setIndex(e)):this.playLoop&&(e=0,this.setIndex(e));var i=new Date,s=i-t,o=Math.max(this.playInterval-s,0),n=this;this.playTimeout=setTimeout(function(){n.playNext()},o)},s.prototype.togglePlay=function(){void 0===this.playTimeout?this.play():this.stop()},s.prototype.play=function(){this.playTimeout||(this.playNext(),this.frame&&(this.frame.play.value="Stop"))},s.prototype.stop=function(){clearInterval(this.playTimeout),this.playTimeout=void 0,this.frame&&(this.frame.play.value="Play")},s.prototype.setOnChangeCallback=function(t){this.onChangeCallback=t},s.prototype.setPlayInterval=function(t){this.playInterval=t},s.prototype.getPlayInterval=function(){return this.playInterval},s.prototype.setPlayLoop=function(t){this.playLoop=t},s.prototype.onChange=function(){void 0!==this.onChangeCallback&&this.onChangeCallback()},s.prototype.redraw=function(){if(this.frame){this.frame.bar.style.top=this.frame.clientHeight/2-this.frame.bar.offsetHeight/2+"px",this.frame.bar.style.width=this.frame.clientWidth-this.frame.prev.clientWidth-this.frame.play.clientWidth-this.frame.next.clientWidth-30+"px";var t=this.indexToLeft(this.index);this.frame.slide.style.left=t+"px"}},s.prototype.setValues=function(t){this.values=t,this.values.length>0?this.setIndex(0):this.index=void 0},s.prototype.setIndex=function(t){if(!(t<this.values.length))throw"Error: index out of range";this.index=t,this.redraw(),this.onChange()},s.prototype.getIndex=function(){return this.index},s.prototype.get=function(){return this.values[this.index]},s.prototype._onMouseDown=function(t){var e=t.which?1===t.which:1===t.button;if(e){this.startClientX=t.clientX,this.startSlideX=parseFloat(this.frame.slide.style.left),this.frame.style.cursor="move";var i=this;this.onmousemove=function(t){i._onMouseMove(t)},this.onmouseup=function(t){i._onMouseUp(t)},o.addEventListener(document,"mousemove",this.onmousemove),o.addEventListener(document,"mouseup",this.onmouseup),o.preventDefault(t)}},s.prototype.leftToIndex=function(t){var e=parseFloat(this.frame.bar.style.width)-this.frame.slide.clientWidth-10,i=t-3,s=Math.round(i/e*(this.values.length-1));return 0>s&&(s=0),s>this.values.length-1&&(s=this.values.length-1),s},s.prototype.indexToLeft=function(t){var e=parseFloat(this.frame.bar.style.width)-this.frame.slide.clientWidth-10,i=t/(this.values.length-1)*e,s=i+3;return s},s.prototype._onMouseMove=function(t){var e=t.clientX-this.startClientX,i=this.startSlideX+e,s=this.leftToIndex(i);this.setIndex(s),o.preventDefault()},s.prototype._onMouseUp=function(){this.frame.style.cursor="auto",o.removeEventListener(document,"mousemove",this.onmousemove),o.removeEventListener(document,"mouseup",this.onmouseup),o.preventDefault()},t.exports=s},function(t){function e(t,e,i,s){this._start=0,this._end=0,this._step=1,this.prettyStep=!0,this.precision=5,this._current=0,this.setRange(t,e,i,s)}e.prototype.setRange=function(t,e,i,s){this._start=t?t:0,this._end=e?e:0,this.setStep(i,s)},e.prototype.setStep=function(t,i){void 0===t||0>=t||(void 0!==i&&(this.prettyStep=i),this._step=this.prettyStep===!0?e.calculatePrettyStep(t):t)},e.calculatePrettyStep=function(t){var e=function(t){return Math.log(t)/Math.LN10},i=Math.pow(10,Math.round(e(t))),s=2*Math.pow(10,Math.round(e(t/2))),o=5*Math.pow(10,Math.round(e(t/5))),n=i;return Math.abs(s-t)<=Math.abs(n-t)&&(n=s),Math.abs(o-t)<=Math.abs(n-t)&&(n=o),0>=n&&(n=1),n},e.prototype.getCurrent=function(){return parseFloat(this._current.toPrecision(this.precision))},e.prototype.getStep=function(){return this._step},e.prototype.start=function(){this._current=this._start-this._start%this._step},e.prototype.next=function(){this._current+=this._step},e.prototype.end=function(){return this._current>this._end},t.exports=e},function(t,e,i){function s(t,e,i,r){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");if(!(Array.isArray(i)||i instanceof n)&&i instanceof Object){var h=r;r=i,i=h}var u=this;this.defaultOptions={start:null,end:null,autoResize:!0,orientation:"bottom",width:null,height:null,maxHeight:null,minHeight:null},this.options=o.deepExtend({},this.defaultOptions),this._create(t),this.components=[],this.body={dom:this.dom,domProps:this.props,emitter:{on:this.on.bind(this),off:this.off.bind(this),emit:this.emit.bind(this)},hiddenDates:[],util:{snap:null,toScreen:u._toScreen.bind(u),toGlobalScreen:u._toGlobalScreen.bind(u),toTime:u._toTime.bind(u),toGlobalTime:u._toGlobalTime.bind(u)}},this.range=new a(this.body),this.components.push(this.range),this.body.range=this.range,this.timeAxis=new d(this.body),this.components.push(this.timeAxis),this.body.util.snap=this.timeAxis.snap.bind(this.timeAxis),this.currentTime=new l(this.body),this.components.push(this.currentTime),this.customTime=new c(this.body),this.components.push(this.customTime),this.itemSet=new p(this.body),this.components.push(this.itemSet),this.itemsData=null,this.groupsData=null,r&&this.setOptions(r),i&&this.setGroups(i),e?this.setItems(e):this.redraw()}var o=(i(56),i(45),i(1)),n=i(3),r=i(4),a=i(17),h=i(46),d=i(35),l=i(26),c=i(27),p=i(32);s.prototype=new h,s.prototype.setItems=function(t){var e,i=null==this.itemsData;if(e=t?t instanceof n||t instanceof r?t:new n(t,{type:{start:"Date",end:"Date"}}):null,this.itemsData=e,this.itemSet&&this.itemSet.setItems(e),i)if(void 0!=this.options.start||void 0!=this.options.end){if(void 0==this.options.start||void 0==this.options.end)var s=this._getDataRange();var o=void 0!=this.options.start?this.options.start:s.start,a=void 0!=this.options.end?this.options.end:s.end;this.setWindow(o,a,{animate:!1})}else this.fit({animate:!1})},s.prototype.setGroups=function(t){var e;e=t?t instanceof n||t instanceof r?t:new n(t):null,this.groupsData=e,this.itemSet.setGroups(e)},s.prototype.setSelection=function(t,e){this.itemSet&&this.itemSet.setSelection(t),e&&e.focus&&this.focus(t,e)},s.prototype.getSelection=function(){return this.itemSet&&this.itemSet.getSelection()||[]},s.prototype.focus=function(t,e){if(this.itemsData&&void 0!=t){var i=Array.isArray(t)?t:[t],s=this.itemsData.getDataSet().get(i,{type:{start:"Date",end:"Date"}}),o=null,n=null;if(s.forEach(function(t){var e=t.start.valueOf(),i="end"in t?t.end.valueOf():t.start.valueOf();(null===o||o>e)&&(o=e),(null===n||i>n)&&(n=i)}),null!==o&&null!==n){var r=(o+n)/2,a=Math.max(this.range.end-this.range.start,1.1*(n-o)),h=e&&void 0!==e.animate?e.animate:!0;this.range.setRange(r-a/2,r+a/2,h)}}},s.prototype.getItemRange=function(){var t=this.itemsData.getDataSet(),e=null,i=null;if(t){var s=t.min("start");e=s?o.convert(s.start,"Date").valueOf():null;var n=t.max("start");n&&(i=o.convert(n.start,"Date").valueOf());var r=t.max("end");r&&(i=null==i?o.convert(r.end,"Date").valueOf():Math.max(i,o.convert(r.end,"Date").valueOf()))}return{min:null!=e?new Date(e):null,max:null!=i?new Date(i):null}},t.exports=s},function(t,e,i){function s(t,e,i,s){if(!(Array.isArray(i)||i instanceof n)&&i instanceof Object){var r=s;s=i,i=r}var h=this;this.defaultOptions={start:null,end:null,autoResize:!0,orientation:"bottom",width:null,height:null,maxHeight:null,minHeight:null},this.options=o.deepExtend({},this.defaultOptions),this._create(t),this.components=[],this.body={dom:this.dom,domProps:this.props,emitter:{on:this.on.bind(this),off:this.off.bind(this),emit:this.emit.bind(this)},hiddenDates:[],util:{snap:null,toScreen:h._toScreen.bind(h),toGlobalScreen:h._toGlobalScreen.bind(h),toTime:h._toTime.bind(h),toGlobalTime:h._toGlobalTime.bind(h)}},this.range=new a(this.body),this.components.push(this.range),this.body.range=this.range,this.timeAxis=new d(this.body),this.components.push(this.timeAxis),this.body.util.snap=this.timeAxis.snap.bind(this.timeAxis),this.currentTime=new l(this.body),this.components.push(this.currentTime),this.customTime=new c(this.body),this.components.push(this.customTime),this.linegraph=new p(this.body),this.components.push(this.linegraph),this.itemsData=null,this.groupsData=null,s&&this.setOptions(s),i&&this.setGroups(i),e?this.setItems(e):this.redraw()}var o=(i(56),i(45),i(1)),n=i(3),r=i(4),a=i(17),h=i(46),d=i(35),l=i(26),c=i(27),p=i(34);s.prototype=new h,s.prototype.setItems=function(t){var e,i=null==this.itemsData;if(e=t?t instanceof n||t instanceof r?t:new n(t,{type:{start:"Date",end:"Date"}}):null,this.itemsData=e,this.linegraph&&this.linegraph.setItems(e),i)if(void 0!=this.options.start||void 0!=this.options.end){var s=void 0!=this.options.start?this.options.start:null,o=void 0!=this.options.end?this.options.end:null;this.setWindow(s,o,{animate:!1})}else this.fit({animate:!1})},s.prototype.setGroups=function(t){var e;e=t?t instanceof n||t instanceof r?t:new n(t):null,this.groupsData=e,this.linegraph.setGroups(e)},s.prototype.getLegend=function(t,e,i){return void 0===e&&(e=15),void 0===i&&(i=15),void 0!==this.linegraph.groups[t]?this.linegraph.groups[t].getLegend(e,i):"cannot find group:"+t},s.prototype.isGroupVisible=function(t){return void 0!==this.linegraph.groups[t]?this.linegraph.groups[t].visible&&(void 0===this.linegraph.options.groups.visibility[t]||1==this.linegraph.options.groups.visibility[t]):!1},s.prototype.getItemRange=function(){var t=null,e=null;for(var i in this.linegraph.groups)if(this.linegraph.groups.hasOwnProperty(i)&&1==this.linegraph.groups[i].visible)for(var s=0;s<this.linegraph.groups[i].itemsData.length;s++){var n=this.linegraph.groups[i].itemsData[s],r=o.convert(n.x,"Date").valueOf();t=null==t?r:t>r?r:t,e=null==e?r:r>e?r:e}return{min:null!=t?new Date(t):null,max:null!=e?new Date(e):null}},t.exports=s},function(t,e,i){var s=i(44);e.convertHiddenOptions=function(t,e){if(t.hiddenDates=[],e&&1==Array.isArray(e)){for(var i=0;i<e.length;i++)if(void 0===e[i].repeat){var o={};o.start=s(e[i].start).toDate().valueOf(),o.end=s(e[i].end).toDate().valueOf(),t.hiddenDates.push(o)}t.hiddenDates.sort(function(t,e){return t.start-e.start})}},e.updateHiddenDates=function(t,i){if(i&&void 0!==t.domProps.centerContainer.width){e.convertHiddenOptions(t,i);for(var o=s(t.range.start),n=s(t.range.end),r=t.range.end-t.range.start,a=r/t.domProps.centerContainer.width,h=0;h<i.length;h++)if(void 0!==i[h].repeat){var d=s(i[h].start),l=s(i[h].end);if("Invalid Date"==d._d)throw new Error("Supplied start date is not valid: "+i[h].start);if("Invalid Date"==l._d)throw new Error("Supplied end date is not valid: "+i[h].end);var c=l-d;if(c>=4*a){var p=0,u=n.clone();switch(i[h].repeat){case"daily":d.day()!=l.day()&&(p=1),d.dayOfYear(o.dayOfYear()),d.year(o.year()),d.subtract(7,"days"),l.dayOfYear(o.dayOfYear()),l.year(o.year()),l.subtract(7-p,"days"),u.add(1,"weeks");break;case"weekly":var m=l.diff(d,"days"),f=d.day();d.date(o.date()),d.month(o.month()),d.year(o.year()),l=d.clone(),d.day(f),l.day(f),l.add(m,"days"),d.subtract(1,"weeks"),l.subtract(1,"weeks"),u.add(1,"weeks");break;case"monthly":d.month()!=l.month()&&(p=1),d.month(o.month()),d.year(o.year()),d.subtract(1,"months"),l.month(o.month()),l.year(o.year()),l.subtract(1,"months"),l.add(p,"months"),u.add(1,"months");break;case"yearly":d.year()!=l.year()&&(p=1),d.year(o.year()),d.subtract(1,"years"),l.year(o.year()),l.subtract(1,"years"),l.add(p,"years"),u.add(1,"years");break;default:return void console.log("Wrong repeat format, allowed are: daily, weekly, monthly, yearly. Given:",i[h].repeat)}for(;u>d;)switch(t.hiddenDates.push({start:d.valueOf(),end:l.valueOf()}),i[h].repeat){case"daily":d.add(1,"days"),l.add(1,"days");break;case"weekly":d.add(1,"weeks"),l.add(1,"weeks");break;case"monthly":d.add(1,"months"),l.add(1,"months");break;case"yearly":d.add(1,"y"),l.add(1,"y");break;default:return void console.log("Wrong repeat format, allowed are: daily, weekly, monthly, yearly. Given:",i[h].repeat)}t.hiddenDates.push({start:d.valueOf(),end:l.valueOf()})}}e.removeDuplicates(t);var g=e.isHidden(t.range.start,t.hiddenDates),v=e.isHidden(t.range.end,t.hiddenDates),y=t.range.start,b=t.range.end;1==g.hidden&&(y=1==t.range.startToFront?g.startDate-1:g.endDate+1),1==v.hidden&&(b=1==t.range.endToFront?v.startDate-1:v.endDate+1),(1==g.hidden||1==v.hidden)&&t.range._applyRange(y,b)}},e.removeDuplicates=function(t){for(var e=t.hiddenDates,i=[],s=0;s<e.length;s++)for(var o=0;o<e.length;o++)s!=o&&1!=e[o].remove&&1!=e[s].remove&&(e[o].start>=e[s].start&&e[o].end<=e[s].end?e[o].remove=!0:e[o].start>=e[s].start&&e[o].start<=e[s].end?(e[s].end=e[o].end,e[o].remove=!0):e[o].end>=e[s].start&&e[o].end<=e[s].end&&(e[s].start=e[o].start,e[o].remove=!0));for(var s=0;s<e.length;s++)e[s].remove!==!0&&i.push(e[s]);t.hiddenDates=i,t.hiddenDates.sort(function(t,e){return t.start-e.start})},e.printDates=function(t){for(var e=0;e<t.length;e++)console.log(e,new Date(t[e].start),new Date(t[e].end),t[e].start,t[e].end,t[e].remove)},e.stepOverHiddenDates=function(t,e){for(var i=!1,o=t.current.valueOf(),n=0;n<t.hiddenDates.length;n++){var r=t.hiddenDates[n].start,a=t.hiddenDates[n].end;if(o>=r&&a>o){i=!0;break}}if(1==i&&o<t._end.valueOf()&&o!=e){var h=s(e),d=s(a);h.year()!=d.year()?t.switchedYear=!0:h.month()!=d.month()?t.switchedMonth=!0:h.dayOfYear()!=d.dayOfYear()&&(t.switchedDay=!0),t.current=d.toDate()}},e.toScreen=function(t,i,s){if(0==t.body.hiddenDates.length){var o=t.range.conversion(s);return(i.valueOf()-o.offset)*o.scale}var n=e.isHidden(i,t.body.hiddenDates);1==n.hidden&&(i=n.startDate);var r=e.getHiddenDurationBetween(t.body.hiddenDates,t.range.start,t.range.end);i=e.correctTimeForHidden(t.body.hiddenDates,t.range,i);var o=t.range.conversion(s,r);return(i.valueOf()-o.offset)*o.scale},e.toTime=function(t,i,s){if(0==t.body.hiddenDates.length){var o=t.range.conversion(s);return new Date(i/o.scale+o.offset)}var n=e.getHiddenDurationBetween(t.body.hiddenDates,t.range.start,t.range.end),r=t.range.end-t.range.start-n,a=r*i/s,h=e.getAccumulatedHiddenDuration(t.body.hiddenDates,t.range,a),d=new Date(h+a+t.range.start);return d},e.getHiddenDurationBetween=function(t,e,i){for(var s=0,o=0;o<t.length;o++){var n=t[o].start,r=t[o].end;n>=e&&i>r&&(s+=r-n)}return s},e.correctTimeForHidden=function(t,i,o){return o=s(o).toDate().valueOf(),o-=e.getHiddenDurationBefore(t,i,o)},e.getHiddenDurationBefore=function(t,e,i){var o=0;i=s(i).toDate().valueOf();for(var n=0;n<t.length;n++){var r=t[n].start,a=t[n].end;r>=e.start&&a<e.end&&i>=a&&(o+=a-r)}return o},e.getAccumulatedHiddenDuration=function(t,e,i){for(var s=0,o=0,n=e.start,r=0;r<t.length;r++){var a=t[r].start,h=t[r].end;if(a>=e.start&&h<e.end){if(o+=a-n,n=h,o>=i)break;s+=h-a}}return s},e.snapAwayFromHidden=function(t,i,s,o){var n=e.isHidden(i,t);return 1==n.hidden?0>s?1==o?n.startDate-(n.endDate-i)-1:n.startDate-1:1==o?n.endDate+(i-n.startDate)+1:n.endDate+1:i},e.isHidden=function(t,e){for(var i=0;i<e.length;i++){var s=e[i].start,o=e[i].end;if(t>=s&&o>t)return{hidden:!0,startDate:s,endDate:o}}return{hidden:!1,startDate:s,endDate:o}}},function(t){function e(t,e,i,s,o,n){this.current=0,this.autoScale=!0,this.stepIndex=0,this.step=1,this.scale=1,this.marginStart,this.marginEnd,this.deadSpace=0,this.majorSteps=[1,2,5,10],this.minorSteps=[.25,.5,1,2],this.alignZeros=n,this.setRange(t,e,i,s,o)}e.prototype.setRange=function(t,e,i,s,o){this._start=void 0===o.min?t:o.min,this._end=void 0===o.max?e:o.max,this._start==this._end&&(this._start-=.75,this._end+=1),1==this.autoScale&&this.setMinimumStep(i,s),this.setFirst(o)},e.prototype.setMinimumStep=function(t,e){var i=this._end-this._start,s=1.2*i,o=t*(s/e),n=Math.round(Math.log(s)/Math.LN10),r=-1,a=Math.pow(10,n),h=0;0>n&&(h=n);for(var d=!1,l=h;Math.abs(l)<=Math.abs(n);l++){a=Math.pow(10,l);for(var c=0;c<this.minorSteps.length;c++){var p=a*this.minorSteps[c];if(p>=o){d=!0,r=c;break}}if(1==d)break}this.stepIndex=r,this.scale=a,this.step=a*this.minorSteps[r]},e.prototype.setFirst=function(t){void 0===t&&(t={});var e=void 0===t.min?this._start-2*this.scale*this.minorSteps[this.stepIndex]:t.min,i=void 0===t.max?this._end+this.scale*this.minorSteps[this.stepIndex]:t.max;this.marginEnd=void 0===t.max?this.roundToMinor(i):t.max,this.marginStart=void 0===t.min?this.roundToMinor(e):t.min,1==this.alignZeros&&(this.marginEnd-this.marginStart)%this.step!=0&&(this.marginEnd+=this.marginEnd%this.step),this.deadSpace=this.roundToMinor(i)-i+this.roundToMinor(e)-e,this.marginRange=this.marginEnd-this.marginStart,this.current=this.marginEnd},e.prototype.roundToMinor=function(t){var e=t-t%(this.scale*this.minorSteps[this.stepIndex]);return t%(this.scale*this.minorSteps[this.stepIndex])>.5*this.scale*this.minorSteps[this.stepIndex]?e+this.scale*this.minorSteps[this.stepIndex]:e},e.prototype.hasNext=function(){return this.current>=this.marginStart},e.prototype.next=function(){var t=this.current;this.current-=this.step,this.current==t&&(this.current=this._end)},e.prototype.previous=function(){this.current+=this.step,this.marginEnd+=this.step,this.marginRange=this.marginEnd-this.marginStart},e.prototype.getCurrent=function(t){var e=Math.abs(this.current)<this.step/2?0:this.current,i=""+Number(e).toPrecision(5);if(void 0===t||isNaN(Number(t))){if(-1!=i.indexOf(",")||-1!=i.indexOf("."))for(var s=i.length-1;s>0;s--){if("0"!=i[s]){if("."==i[s]||","==i[s]){i=i.slice(0,s);break}break}i=i.slice(0,s)}}else{var o="",n=i.indexOf("e");if(-1!=n&&(o=i.slice(n),i=i.slice(0,n)),n=Math.max(i.indexOf(","),i.indexOf(".")),-1===n?(0!==t&&(i+="."),n=i.length+t):0!==t&&(n+=t+1),n>i.length)for(var r=n-i.length;r>0;r--)i+="0";else i=i.slice(0,n);i+=o}return i},e.prototype.snap=function(){},e.prototype.isMajor=function(){return this.current%(this.scale*this.majorSteps[this.stepIndex])==0},t.exports=e},function(t,e,i){function s(t,e){var i=h().hours(0).minutes(0).seconds(0).milliseconds(0);this.start=i.clone().add(-3,"days").valueOf(),this.end=i.clone().add(4,"days").valueOf(),this.body=t,this.deltaDifference=0,this.scaleOffset=0,this.startToFront=!1,this.endToFront=!0,this.defaultOptions={start:null,end:null,direction:"horizontal",moveable:!0,zoomable:!0,min:null,max:null,zoomMin:10,zoomMax:31536e10},this.options=r.extend({},this.defaultOptions),this.props={touch:{}},this.animateTimer=null,this.body.emitter.on("dragstart",this._onDragStart.bind(this)),this.body.emitter.on("drag",this._onDrag.bind(this)),this.body.emitter.on("dragend",this._onDragEnd.bind(this)),this.body.emitter.on("hold",this._onHold.bind(this)),this.body.emitter.on("mousewheel",this._onMouseWheel.bind(this)),this.body.emitter.on("DOMMouseScroll",this._onMouseWheel.bind(this)),this.body.emitter.on("touch",this._onTouch.bind(this)),this.body.emitter.on("pinch",this._onPinch.bind(this)),this.setOptions(e)}function o(t){if("horizontal"!=t&&"vertical"!=t)throw new TypeError('Unknown direction "'+t+'". Choose "horizontal" or "vertical".')}function n(t,e){return{x:t.pageX-r.getAbsoluteLeft(e),y:t.pageY-r.getAbsoluteTop(e)}}var r=i(1),a=i(47),h=i(44),d=i(25),l=i(15);s.prototype=new d,s.prototype.setOptions=function(t){if(t){var e=["direction","min","max","zoomMin","zoomMax","moveable","zoomable","activate","hiddenDates"];r.selectiveExtend(e,this.options,t),("start"in t||"end"in t)&&this.setRange(t.start,t.end)}},s.prototype.setRange=function(t,e,i,s){s!==!0&&(s=!1);var o=void 0!=t?r.convert(t,"Date").valueOf():null,n=void 0!=e?r.convert(e,"Date").valueOf():null;if(this._cancelAnimation(),i){var a=this,h=this.start,d=this.end,c="number"==typeof i?i:500,p=(new Date).valueOf(),u=!1,m=function(){if(!a.props.touch.dragging){var t=(new Date).valueOf(),e=t-p,i=e>c,g=i||null===o?o:r.easeInOutQuad(e,h,o,c),v=i||null===n?n:r.easeInOutQuad(e,d,n,c);f=a._applyRange(g,v),l.updateHiddenDates(a.body,a.options.hiddenDates),u=u||f,f&&a.body.emitter.emit("rangechange",{start:new Date(a.start),end:new Date(a.end),byUser:s}),i?u&&a.body.emitter.emit("rangechanged",{start:new Date(a.start),end:new Date(a.end),byUser:s}):a.animateTimer=setTimeout(m,20)}};return m()}var f=this._applyRange(o,n);if(l.updateHiddenDates(this.body,this.options.hiddenDates),f){var g={start:new Date(this.start),end:new Date(this.end),byUser:s};this.body.emitter.emit("rangechange",g),this.body.emitter.emit("rangechanged",g)}},s.prototype._cancelAnimation=function(){this.animateTimer&&(clearTimeout(this.animateTimer),this.animateTimer=null)},s.prototype._applyRange=function(t,e){var i,s=null!=t?r.convert(t,"Date").valueOf():this.start,o=null!=e?r.convert(e,"Date").valueOf():this.end,n=null!=this.options.max?r.convert(this.options.max,"Date").valueOf():null,a=null!=this.options.min?r.convert(this.options.min,"Date").valueOf():null;if(isNaN(s)||null===s)throw new Error('Invalid start "'+t+'"');if(isNaN(o)||null===o)throw new Error('Invalid end "'+e+'"');if(s>o&&(o=s),null!==a&&a>s&&(i=a-s,s+=i,o+=i,null!=n&&o>n&&(o=n)),null!==n&&o>n&&(i=o-n,s-=i,o-=i,null!=a&&a>s&&(s=a)),null!==this.options.zoomMin){var h=parseFloat(this.options.zoomMin);0>h&&(h=0),h>o-s&&(this.end-this.start===h?(s=this.start,o=this.end):(i=h-(o-s),s-=i/2,o+=i/2))}if(null!==this.options.zoomMax){var d=parseFloat(this.options.zoomMax);0>d&&(d=0),o-s>d&&(this.end-this.start===d?(s=this.start,o=this.end):(i=o-s-d,s+=i/2,o-=i/2))}var l=this.start!=s||this.end!=o;return s>=this.start&&s<=this.end||o>=this.start&&o<=this.end||this.start>=s&&this.start<=o||this.end>=s&&this.end<=o||this.body.emitter.emit("checkRangedItems"),this.start=s,this.end=o,l},s.prototype.getRange=function(){return{start:this.start,end:this.end}},s.prototype.conversion=function(t,e){return s.conversion(this.start,this.end,t,e)},s.conversion=function(t,e,i,s){return void 0===s&&(s=0),0!=i&&e-t!=0?{offset:t,scale:i/(e-t-s)}:{offset:0,scale:1}},s.prototype._onDragStart=function(){this.deltaDifference=0,this.previousDelta=0,this.options.moveable&&this.props.touch.allowDragging&&(this.props.touch.start=this.start,this.props.touch.end=this.end,this.props.touch.dragging=!0,this.body.dom.root&&(this.body.dom.root.style.cursor="move"))},s.prototype._onDrag=function(t){if(this.options.moveable&&this.props.touch.allowDragging){var e=this.options.direction;o(e);var i="horizontal"==e?t.gesture.deltaX:t.gesture.deltaY;i-=this.deltaDifference;var s=this.props.touch.end-this.props.touch.start,n=l.getHiddenDurationBetween(this.body.hiddenDates,this.start,this.end);s-=n;var r="horizontal"==e?this.body.domProps.center.width:this.body.domProps.center.height,a=-i/r*s,h=this.props.touch.start+a,d=this.props.touch.end+a,c=l.snapAwayFromHidden(this.body.hiddenDates,h,this.previousDelta-i,!0),p=l.snapAwayFromHidden(this.body.hiddenDates,d,this.previousDelta-i,!0);if(c!=h||p!=d)return this.deltaDifference+=i,this.props.touch.start=c,this.props.touch.end=p,void this._onDrag(t);this.previousDelta=i,this._applyRange(h,d),this.body.emitter.emit("rangechange",{start:new Date(this.start),end:new Date(this.end),byUser:!0})}},s.prototype._onDragEnd=function(){this.options.moveable&&this.props.touch.allowDragging&&(this.props.touch.dragging=!1,this.body.dom.root&&(this.body.dom.root.style.cursor="auto"),this.body.emitter.emit("rangechanged",{start:new Date(this.start),end:new Date(this.end),byUser:!0}))},s.prototype._onMouseWheel=function(t){if(this.options.zoomable&&this.options.moveable){var e=0;if(t.wheelDelta?e=t.wheelDelta/120:t.detail&&(e=-t.detail/3),e){var i;i=0>e?1-e/5:1/(1+e/5);var s=a.fakeGesture(this,t),o=n(s.center,this.body.dom.center),r=this._pointerToDate(o);this.zoom(i,r,e)}t.preventDefault()}},s.prototype._onTouch=function(){this.props.touch.start=this.start,this.props.touch.end=this.end,this.props.touch.allowDragging=!0,this.props.touch.center=null,this.scaleOffset=0,this.deltaDifference=0},s.prototype._onHold=function(){this.props.touch.allowDragging=!1},s.prototype._onPinch=function(t){if(this.options.zoomable&&this.options.moveable&&(this.props.touch.allowDragging=!1,t.gesture.touches.length>1)){this.props.touch.center||(this.props.touch.center=n(t.gesture.center,this.body.dom.center));var e=1/(t.gesture.scale+this.scaleOffset),i=this._pointerToDate(this.props.touch.center),s=l.getHiddenDurationBetween(this.body.hiddenDates,this.start,this.end),o=l.getHiddenDurationBefore(this.body.hiddenDates,this,i),r=s-o,a=i-o+(this.props.touch.start-(i-o))*e,h=i+r+(this.props.touch.end-(i+r))*e;this.startToFront=1-e>0?!1:!0,this.endToFront=e-1>0?!1:!0;var d=l.snapAwayFromHidden(this.body.hiddenDates,a,1-e,!0),c=l.snapAwayFromHidden(this.body.hiddenDates,h,e-1,!0);(d!=a||c!=h)&&(this.props.touch.start=d,this.props.touch.end=c,this.scaleOffset=1-t.gesture.scale,a=d,h=c),this.setRange(a,h,!1,!0),this.startToFront=!1,this.endToFront=!0}},s.prototype._pointerToDate=function(t){var e,i=this.options.direction;if(o(i),"horizontal"==i)return this.body.util.toTime(t.x).valueOf();var s=this.body.domProps.center.height;return e=this.conversion(s),t.y/e.scale+e.offset},s.prototype.zoom=function(t,e,i){null==e&&(e=(this.start+this.end)/2);var s=l.getHiddenDurationBetween(this.body.hiddenDates,this.start,this.end),o=l.getHiddenDurationBefore(this.body.hiddenDates,this,e),n=s-o,r=e-o+(this.start-(e-o))*t,a=e+n+(this.end-(e+n))*t;this.startToFront=i>0?!1:!0,this.endToFront=-i>0?!1:!0;var h=l.snapAwayFromHidden(this.body.hiddenDates,r,i,!0),d=l.snapAwayFromHidden(this.body.hiddenDates,a,-i,!0);(h!=r||d!=a)&&(r=h,a=d),this.setRange(r,a,!1,!0),this.startToFront=!1,this.endToFront=!0},s.prototype.move=function(t){var e=this.end-this.start,i=this.start+e*t,s=this.end+e*t;this.start=i,this.end=s},s.prototype.moveTo=function(t){var e=(this.start+this.end)/2,i=e-t,s=this.start-i,o=this.end-i;this.setRange(s,o)},t.exports=s},function(t,e){var i=.001;e.orderByStart=function(t){t.sort(function(t,e){return t.data.start-e.data.start})},e.orderByEnd=function(t){t.sort(function(t,e){var i="end"in t.data?t.data.end:t.data.start,s="end"in e.data?e.data.end:e.data.start;return i-s})},e.stack=function(t,i,s){var o,n;if(s)for(o=0,n=t.length;n>o;o++)t[o].top=null;for(o=0,n=t.length;n>o;o++){var r=t[o];if(r.stack&&null===r.top){r.top=i.axis;do{for(var a=null,h=0,d=t.length;d>h;h++){var l=t[h];if(null!==l.top&&l!==r&&l.stack&&e.collision(r,l,i.item)){a=l;break}}null!=a&&(r.top=a.top+a.height+i.item.vertical)}while(a)}}},e.nostack=function(t,e,i){var s,o,n;for(s=0,o=t.length;o>s;s++)if(void 0!==t[s].data.subgroup){n=e.axis;for(var r in i)i.hasOwnProperty(r)&&1==i[r].visible&&i[r].index<i[t[s].data.subgroup].index&&(n+=i[r].height+e.item.vertical);t[s].top=n}else t[s].top=e.axis},e.collision=function(t,e,s){return t.left-s.horizontal+i<e.left+e.width&&t.left+t.width+s.horizontal-i>e.left&&t.top-s.vertical+i<e.top+e.height&&t.top+t.height+s.vertical-i>e.top}},function(t,e,i){function s(t,e,i,o){this.current=new Date,this._start=new Date,this._end=new Date,this.autoScale=!0,this.scale="day",this.step=1,this.setRange(t,e,i),this.switchedDay=!1,this.switchedMonth=!1,this.switchedYear=!1,this.hiddenDates=o,void 0===o&&(this.hiddenDates=[]),this.format=s.FORMAT}var o=i(44),n=i(15),r=i(1);s.FORMAT={minorLabels:{millisecond:"SSS",second:"s",minute:"HH:mm",hour:"HH:mm",weekday:"ddd D",day:"D",month:"MMM",year:"YYYY"},majorLabels:{millisecond:"HH:mm:ss",second:"D MMMM HH:mm",minute:"ddd D MMMM",hour:"ddd D MMMM",weekday:"MMMM YYYY",day:"MMMM YYYY",month:"YYYY",year:""}},s.prototype.setFormat=function(t){var e=r.deepExtend({},s.FORMAT);this.format=r.deepExtend(e,t)},s.prototype.setRange=function(t,e,i){if(!(t instanceof Date&&e instanceof Date))throw"No legal start or end date in method setRange";this._start=void 0!=t?new Date(t.valueOf()):new Date,this._end=void 0!=e?new Date(e.valueOf()):new Date,this.autoScale&&this.setMinimumStep(i)},s.prototype.first=function(){this.current=new Date(this._start.valueOf()),this.roundToMinor()},s.prototype.roundToMinor=function(){switch(this.scale){case"year":this.current.setFullYear(this.step*Math.floor(this.current.getFullYear()/this.step)),this.current.setMonth(0);case"month":this.current.setDate(1);case"day":case"weekday":this.current.setHours(0);case"hour":this.current.setMinutes(0);case"minute":this.current.setSeconds(0);case"second":this.current.setMilliseconds(0)}if(1!=this.step)switch(this.scale){case"millisecond":this.current.setMilliseconds(this.current.getMilliseconds()-this.current.getMilliseconds()%this.step);break;case"second":this.current.setSeconds(this.current.getSeconds()-this.current.getSeconds()%this.step);break;case"minute":this.current.setMinutes(this.current.getMinutes()-this.current.getMinutes()%this.step);break;case"hour":this.current.setHours(this.current.getHours()-this.current.getHours()%this.step);break;case"weekday":case"day":this.current.setDate(this.current.getDate()-1-(this.current.getDate()-1)%this.step+1);break;case"month":this.current.setMonth(this.current.getMonth()-this.current.getMonth()%this.step);break;case"year":this.current.setFullYear(this.current.getFullYear()-this.current.getFullYear()%this.step)}},s.prototype.hasNext=function(){return this.current.valueOf()<=this._end.valueOf()},s.prototype.next=function(){var t=this.current.valueOf();if(this.current.getMonth()<6)switch(this.scale){case"millisecond":this.current=new Date(this.current.valueOf()+this.step);break;case"second":this.current=new Date(this.current.valueOf()+1e3*this.step);break;case"minute":this.current=new Date(this.current.valueOf()+1e3*this.step*60);break;case"hour":this.current=new Date(this.current.valueOf()+1e3*this.step*60*60);var e=this.current.getHours();this.current.setHours(e-e%this.step);break;case"weekday":case"day":this.current.setDate(this.current.getDate()+this.step);
break;case"month":this.current.setMonth(this.current.getMonth()+this.step);break;case"year":this.current.setFullYear(this.current.getFullYear()+this.step)}else switch(this.scale){case"millisecond":this.current=new Date(this.current.valueOf()+this.step);break;case"second":this.current.setSeconds(this.current.getSeconds()+this.step);break;case"minute":this.current.setMinutes(this.current.getMinutes()+this.step);break;case"hour":this.current.setHours(this.current.getHours()+this.step);break;case"weekday":case"day":this.current.setDate(this.current.getDate()+this.step);break;case"month":this.current.setMonth(this.current.getMonth()+this.step);break;case"year":this.current.setFullYear(this.current.getFullYear()+this.step)}if(1!=this.step)switch(this.scale){case"millisecond":this.current.getMilliseconds()<this.step&&this.current.setMilliseconds(0);break;case"second":this.current.getSeconds()<this.step&&this.current.setSeconds(0);break;case"minute":this.current.getMinutes()<this.step&&this.current.setMinutes(0);break;case"hour":this.current.getHours()<this.step&&this.current.setHours(0);break;case"weekday":case"day":this.current.getDate()<this.step+1&&this.current.setDate(1);break;case"month":this.current.getMonth()<this.step&&this.current.setMonth(0);break;case"year":}this.current.valueOf()==t&&(this.current=new Date(this._end.valueOf())),n.stepOverHiddenDates(this,t)},s.prototype.getCurrent=function(){return this.current},s.prototype.setScale=function(t,e){this.scale=t,e>0&&(this.step=e),this.autoScale=!1},s.prototype.setAutoScale=function(t){this.autoScale=t},s.prototype.setMinimumStep=function(t){if(void 0!=t){var e=31104e6,i=2592e6,s=864e5,o=36e5,n=6e4,r=1e3,a=1;1e3*e>t&&(this.scale="year",this.step=1e3),500*e>t&&(this.scale="year",this.step=500),100*e>t&&(this.scale="year",this.step=100),50*e>t&&(this.scale="year",this.step=50),10*e>t&&(this.scale="year",this.step=10),5*e>t&&(this.scale="year",this.step=5),e>t&&(this.scale="year",this.step=1),3*i>t&&(this.scale="month",this.step=3),i>t&&(this.scale="month",this.step=1),5*s>t&&(this.scale="day",this.step=5),2*s>t&&(this.scale="day",this.step=2),s>t&&(this.scale="day",this.step=1),s/2>t&&(this.scale="weekday",this.step=1),4*o>t&&(this.scale="hour",this.step=4),o>t&&(this.scale="hour",this.step=1),15*n>t&&(this.scale="minute",this.step=15),10*n>t&&(this.scale="minute",this.step=10),5*n>t&&(this.scale="minute",this.step=5),n>t&&(this.scale="minute",this.step=1),15*r>t&&(this.scale="second",this.step=15),10*r>t&&(this.scale="second",this.step=10),5*r>t&&(this.scale="second",this.step=5),r>t&&(this.scale="second",this.step=1),200*a>t&&(this.scale="millisecond",this.step=200),100*a>t&&(this.scale="millisecond",this.step=100),50*a>t&&(this.scale="millisecond",this.step=50),10*a>t&&(this.scale="millisecond",this.step=10),5*a>t&&(this.scale="millisecond",this.step=5),a>t&&(this.scale="millisecond",this.step=1)}},s.prototype.snap=function(t){var e=new Date(t.valueOf());if("year"==this.scale){var i=e.getFullYear()+Math.round(e.getMonth()/12);e.setFullYear(Math.round(i/this.step)*this.step),e.setMonth(0),e.setDate(0),e.setHours(0),e.setMinutes(0),e.setSeconds(0),e.setMilliseconds(0)}else if("month"==this.scale)e.getDate()>15?(e.setDate(1),e.setMonth(e.getMonth()+1)):e.setDate(1),e.setHours(0),e.setMinutes(0),e.setSeconds(0),e.setMilliseconds(0);else if("day"==this.scale){switch(this.step){case 5:case 2:e.setHours(24*Math.round(e.getHours()/24));break;default:e.setHours(12*Math.round(e.getHours()/12))}e.setMinutes(0),e.setSeconds(0),e.setMilliseconds(0)}else if("weekday"==this.scale){switch(this.step){case 5:case 2:e.setHours(12*Math.round(e.getHours()/12));break;default:e.setHours(6*Math.round(e.getHours()/6))}e.setMinutes(0),e.setSeconds(0),e.setMilliseconds(0)}else if("hour"==this.scale){switch(this.step){case 4:e.setMinutes(60*Math.round(e.getMinutes()/60));break;default:e.setMinutes(30*Math.round(e.getMinutes()/30))}e.setSeconds(0),e.setMilliseconds(0)}else if("minute"==this.scale){switch(this.step){case 15:case 10:e.setMinutes(5*Math.round(e.getMinutes()/5)),e.setSeconds(0);break;case 5:e.setSeconds(60*Math.round(e.getSeconds()/60));break;default:e.setSeconds(30*Math.round(e.getSeconds()/30))}e.setMilliseconds(0)}else if("second"==this.scale)switch(this.step){case 15:case 10:e.setSeconds(5*Math.round(e.getSeconds()/5)),e.setMilliseconds(0);break;case 5:e.setMilliseconds(1e3*Math.round(e.getMilliseconds()/1e3));break;default:e.setMilliseconds(500*Math.round(e.getMilliseconds()/500))}else if("millisecond"==this.scale){var s=this.step>5?this.step/2:1;e.setMilliseconds(Math.round(e.getMilliseconds()/s)*s)}return e},s.prototype.isMajor=function(){if(1==this.switchedYear)switch(this.switchedYear=!1,this.scale){case"year":case"month":case"weekday":case"day":case"hour":case"minute":case"second":case"millisecond":return!0;default:return!1}else if(1==this.switchedMonth)switch(this.switchedMonth=!1,this.scale){case"weekday":case"day":case"hour":case"minute":case"second":case"millisecond":return!0;default:return!1}else if(1==this.switchedDay)switch(this.switchedDay=!1,this.scale){case"millisecond":case"second":case"minute":case"hour":return!0;default:return!1}switch(this.scale){case"millisecond":return 0==this.current.getMilliseconds();case"second":return 0==this.current.getSeconds();case"minute":return 0==this.current.getHours()&&0==this.current.getMinutes();case"hour":return 0==this.current.getHours();case"weekday":case"day":return 1==this.current.getDate();case"month":return 0==this.current.getMonth();case"year":return!1;default:return!1}},s.prototype.getLabelMinor=function(t){void 0==t&&(t=this.current);var e=this.format.minorLabels[this.scale];return e&&e.length>0?o(t).format(e):""},s.prototype.getLabelMajor=function(t){void 0==t&&(t=this.current);var e=this.format.majorLabels[this.scale];return e&&e.length>0?o(t).format(e):""},s.prototype.getClassName=function(){function t(t){return t/h%2==0?" even":" odd"}function e(t){return t.isSame(new Date,"day")?" today":t.isSame(o().add(1,"day"),"day")?" tomorrow":t.isSame(o().add(-1,"day"),"day")?" yesterday":""}function i(t){return t.isSame(new Date,"week")?" current-week":""}function s(t){return t.isSame(new Date,"month")?" current-month":""}function n(t){return t.isSame(new Date,"year")?" current-year":""}var r=o(this.current),a=r.locale?r.locale("en"):r.lang("en"),h=this.step;switch(this.scale){case"millisecond":return t(a.milliseconds()).trim();case"second":return t(a.seconds()).trim();case"minute":return t(a.minutes()).trim();case"hour":var d=a.hours();return 4==this.step&&(d=d+"-"+(d+4)),d+"h"+e(a)+t(a.hours());case"weekday":return a.format("dddd").toLowerCase()+e(a)+i(a)+t(a.date());case"day":var l=a.date(),c=a.format("MMMM").toLowerCase();return"day"+l+" "+c+s(a)+t(l-1);case"month":return a.format("MMMM").toLowerCase()+s(a)+t(a.month());case"year":var p=a.year();return"year"+p+n(a)+t(p);default:return""}},t.exports=s},function(t,e,i){function s(t,e,i){this.id=null,this.parent=null,this.data=t,this.dom=null,this.conversion=e||{},this.options=i||{},this.selected=!1,this.displayed=!1,this.dirty=!0,this.top=null,this.left=null,this.width=null,this.height=null}var o=i(45),n=i(1);s.prototype.stack=!0,s.prototype.select=function(){this.selected=!0,this.dirty=!0,this.displayed&&this.redraw()},s.prototype.unselect=function(){this.selected=!1,this.dirty=!0,this.displayed&&this.redraw()},s.prototype.setData=function(t){this.data=t,this.dirty=!0,this.displayed&&this.redraw()},s.prototype.setParent=function(t){this.displayed?(this.hide(),this.parent=t,this.parent&&this.show()):this.parent=t},s.prototype.isVisible=function(){return!1},s.prototype.show=function(){return!1},s.prototype.hide=function(){return!1},s.prototype.redraw=function(){},s.prototype.repositionX=function(){},s.prototype.repositionY=function(){},s.prototype._repaintDeleteButton=function(t){if(this.selected&&this.options.editable.remove&&!this.dom.deleteButton){var e=this,i=document.createElement("div");i.className="delete",i.title="Delete this item",o(i,{preventDefault:!0}).on("tap",function(t){e.parent.removeFromDataSet(e),t.stopPropagation()}),t.appendChild(i),this.dom.deleteButton=i}else!this.selected&&this.dom.deleteButton&&(this.dom.deleteButton.parentNode&&this.dom.deleteButton.parentNode.removeChild(this.dom.deleteButton),this.dom.deleteButton=null)},s.prototype._updateContents=function(t){var e;if(this.options.template){var i=this.parent.itemSet.itemsData.get(this.id);e=this.options.template(i)}else e=this.data.content;if(e!==this.content){if(e instanceof Element)t.innerHTML="",t.appendChild(e);else if(void 0!=e)t.innerHTML=e;else if("background"!=this.data.type||void 0!==this.data.content)throw new Error('Property "content" missing in item '+this.id);this.content=e}},s.prototype._updateTitle=function(t){null!=this.data.title?t.title=this.data.title||"":t.removeAttribute("title")},s.prototype._updateDataAttributes=function(t){if(this.options.dataAttributes&&this.options.dataAttributes.length>0){var e=[];if(Array.isArray(this.options.dataAttributes))e=this.options.dataAttributes;else{if("all"!=this.options.dataAttributes)return;e=Object.keys(this.data)}for(var i=0;i<e.length;i++){var s=e[i],o=this.data[s];null!=o?t.setAttribute("data-"+s,o):t.removeAttribute("data-"+s)}}},s.prototype._updateStyle=function(t){this.style&&(n.removeCssText(t,this.style),this.style=null),this.data.style&&(n.addCssText(t,this.data.style),this.style=this.data.style)},t.exports=s},function(t,e,i){function s(t,e,i){if(this.props={content:{width:0}},this.overflow=!1,t){if(void 0==t.start)throw new Error('Property "start" missing in item '+t.id);if(void 0==t.end)throw new Error('Property "end" missing in item '+t.id)}o.call(this,t,e,i),this.emptyContent=!1}var o=(i(45),i(20)),n=i(31),r=i(24);s.prototype=new o(null,null,null),s.prototype.baseClassName="item background",s.prototype.stack=!1,s.prototype.isVisible=function(t){return this.data.start<t.end&&this.data.end>t.start},s.prototype.redraw=function(){var t=this.dom;if(t||(this.dom={},t=this.dom,t.box=document.createElement("div"),t.content=document.createElement("div"),t.content.className="content",t.box.appendChild(t.content),this.dirty=!0),!this.parent)throw new Error("Cannot redraw item: no parent attached");if(!t.box.parentNode){var e=this.parent.dom.background;if(!e)throw new Error("Cannot redraw item: parent has no background container element");e.appendChild(t.box)}if(this.displayed=!0,this.dirty){this._updateContents(this.dom.content),this._updateTitle(this.dom.content),this._updateDataAttributes(this.dom.content),this._updateStyle(this.dom.box);var i=(this.data.className?" "+this.data.className:"")+(this.selected?" selected":"");t.box.className=this.baseClassName+i,this.overflow="hidden"!==window.getComputedStyle(t.content).overflow,this.props.content.width=this.dom.content.offsetWidth,this.height=0,this.dirty=!1}},s.prototype.show=r.prototype.show,s.prototype.hide=r.prototype.hide,s.prototype.repositionX=r.prototype.repositionX,s.prototype.repositionY=function(t){var e="top"===this.options.orientation;this.dom.content.style.top=e?"":"0",this.dom.content.style.bottom=e?"0":"";var i;if(void 0!==this.data.subgroup){var s=this.data.subgroup,o=this.parent.subgroups,r=o[s].index;if(1==e){i=this.parent.subgroups[s].height+t.item.vertical,i+=0==r?t.axis-.5*t.item.vertical:0;var a=this.parent.top;for(var h in o)o.hasOwnProperty(h)&&1==o[h].visible&&o[h].index<r&&(a+=o[h].height+t.item.vertical);a+=0!=r?t.axis-.5*t.item.vertical:0,this.dom.box.style.top=a+"px",this.dom.box.style.bottom=""}else{var a=this.parent.top;for(var h in o)o.hasOwnProperty(h)&&1==o[h].visible&&o[h].index>r&&(a+=o[h].height+t.item.vertical);i=this.parent.subgroups[s].height+t.item.vertical,this.dom.box.style.top=a+"px",this.dom.box.style.bottom=""}}else this.parent instanceof n?(i=Math.max(this.parent.height,this.parent.itemSet.body.domProps.center.height,this.parent.itemSet.body.domProps.centerContainer.height),this.dom.box.style.top=e?"0":"",this.dom.box.style.bottom=e?"":"0"):(i=this.parent.height,this.dom.box.style.top=this.parent.top+"px",this.dom.box.style.bottom="");this.dom.box.style.height=i+"px"},t.exports=s},function(t,e,i){function s(t,e,i){if(this.props={dot:{width:0,height:0},line:{width:0,height:0}},t&&void 0==t.start)throw new Error('Property "start" missing in item '+t);o.call(this,t,e,i)}{var o=i(20);i(1)}s.prototype=new o(null,null,null),s.prototype.isVisible=function(t){var e=(t.end-t.start)/4;return this.data.start>t.start-e&&this.data.start<t.end+e},s.prototype.redraw=function(){var t=this.dom;if(t||(this.dom={},t=this.dom,t.box=document.createElement("DIV"),t.content=document.createElement("DIV"),t.content.className="content",t.box.appendChild(t.content),t.line=document.createElement("DIV"),t.line.className="line",t.dot=document.createElement("DIV"),t.dot.className="dot",t.box["timeline-item"]=this,this.dirty=!0),!this.parent)throw new Error("Cannot redraw item: no parent attached");if(!t.box.parentNode){var e=this.parent.dom.foreground;if(!e)throw new Error("Cannot redraw item: parent has no foreground container element");e.appendChild(t.box)}if(!t.line.parentNode){var i=this.parent.dom.background;if(!i)throw new Error("Cannot redraw item: parent has no background container element");i.appendChild(t.line)}if(!t.dot.parentNode){var s=this.parent.dom.axis;if(!i)throw new Error("Cannot redraw item: parent has no axis container element");s.appendChild(t.dot)}if(this.displayed=!0,this.dirty){this._updateContents(this.dom.content),this._updateTitle(this.dom.box),this._updateDataAttributes(this.dom.box),this._updateStyle(this.dom.box);var o=(this.data.className?" "+this.data.className:"")+(this.selected?" selected":"");t.box.className="item box"+o,t.line.className="item line"+o,t.dot.className="item dot"+o,this.props.dot.height=t.dot.offsetHeight,this.props.dot.width=t.dot.offsetWidth,this.props.line.width=t.line.offsetWidth,this.width=t.box.offsetWidth,this.height=t.box.offsetHeight,this.dirty=!1}this._repaintDeleteButton(t.box)},s.prototype.show=function(){this.displayed||this.redraw()},s.prototype.hide=function(){if(this.displayed){var t=this.dom;t.box.parentNode&&t.box.parentNode.removeChild(t.box),t.line.parentNode&&t.line.parentNode.removeChild(t.line),t.dot.parentNode&&t.dot.parentNode.removeChild(t.dot),this.top=null,this.left=null,this.displayed=!1}},s.prototype.repositionX=function(){var t=this.conversion.toScreen(this.data.start),e=this.options.align,i=this.dom.box,s=this.dom.line,o=this.dom.dot;this.left="right"==e?t-this.width:"left"==e?t:t-this.width/2,i.style.left=this.left+"px",s.style.left=t-this.props.line.width/2+"px",o.style.left=t-this.props.dot.width/2+"px"},s.prototype.repositionY=function(){var t=this.options.orientation,e=this.dom.box,i=this.dom.line,s=this.dom.dot;if("top"==t)e.style.top=(this.top||0)+"px",i.style.top="0",i.style.height=this.parent.top+this.top+1+"px",i.style.bottom="";else{var o=this.parent.itemSet.props.height,n=o-this.parent.top-this.parent.height+this.top;e.style.top=(this.parent.height-this.top-this.height||0)+"px",i.style.top=o-n+"px",i.style.bottom="0"}s.style.top=-this.props.dot.height/2+"px"},t.exports=s},function(t,e,i){function s(t,e,i){if(this.props={dot:{top:0,width:0,height:0},content:{height:0,marginLeft:0}},t&&void 0==t.start)throw new Error('Property "start" missing in item '+t);o.call(this,t,e,i)}var o=i(20);s.prototype=new o(null,null,null),s.prototype.isVisible=function(t){var e=(t.end-t.start)/4;return this.data.start>t.start-e&&this.data.start<t.end+e},s.prototype.redraw=function(){var t=this.dom;if(t||(this.dom={},t=this.dom,t.point=document.createElement("div"),t.content=document.createElement("div"),t.content.className="content",t.point.appendChild(t.content),t.dot=document.createElement("div"),t.point.appendChild(t.dot),t.point["timeline-item"]=this,this.dirty=!0),!this.parent)throw new Error("Cannot redraw item: no parent attached");if(!t.point.parentNode){var e=this.parent.dom.foreground;if(!e)throw new Error("Cannot redraw item: parent has no foreground container element");e.appendChild(t.point)}if(this.displayed=!0,this.dirty){this._updateContents(this.dom.content),this._updateTitle(this.dom.point),this._updateDataAttributes(this.dom.point),this._updateStyle(this.dom.point);var i=(this.data.className?" "+this.data.className:"")+(this.selected?" selected":"");t.point.className="item point"+i,t.dot.className="item dot"+i,this.width=t.point.offsetWidth,this.height=t.point.offsetHeight,this.props.dot.width=t.dot.offsetWidth,this.props.dot.height=t.dot.offsetHeight,this.props.content.height=t.content.offsetHeight,t.content.style.marginLeft=2*this.props.dot.width+"px",t.dot.style.top=(this.height-this.props.dot.height)/2+"px",t.dot.style.left=this.props.dot.width/2+"px",this.dirty=!1}this._repaintDeleteButton(t.point)},s.prototype.show=function(){this.displayed||this.redraw()},s.prototype.hide=function(){this.displayed&&(this.dom.point.parentNode&&this.dom.point.parentNode.removeChild(this.dom.point),this.top=null,this.left=null,this.displayed=!1)},s.prototype.repositionX=function(){var t=this.conversion.toScreen(this.data.start);this.left=t-this.props.dot.width,this.dom.point.style.left=this.left+"px"},s.prototype.repositionY=function(){var t=this.options.orientation,e=this.dom.point;e.style.top="top"==t?this.top+"px":this.parent.height-this.top-this.height+"px"},t.exports=s},function(t,e,i){function s(t,e,i){if(this.props={content:{width:0}},this.overflow=!1,t){if(void 0==t.start)throw new Error('Property "start" missing in item '+t.id);if(void 0==t.end)throw new Error('Property "end" missing in item '+t.id)}n.call(this,t,e,i)}var o=i(45),n=i(20);s.prototype=new n(null,null,null),s.prototype.baseClassName="item range",s.prototype.isVisible=function(t){return this.data.start<t.end&&this.data.end>t.start},s.prototype.redraw=function(){var t=this.dom;if(t||(this.dom={},t=this.dom,t.box=document.createElement("div"),t.content=document.createElement("div"),t.content.className="content",t.box.appendChild(t.content),t.box["timeline-item"]=this,this.dirty=!0),!this.parent)throw new Error("Cannot redraw item: no parent attached");if(!t.box.parentNode){var e=this.parent.dom.foreground;if(!e)throw new Error("Cannot redraw item: parent has no foreground container element");e.appendChild(t.box)}if(this.displayed=!0,this.dirty){this._updateContents(this.dom.content),this._updateTitle(this.dom.box),this._updateDataAttributes(this.dom.box),this._updateStyle(this.dom.box);var i=(this.data.className?" "+this.data.className:"")+(this.selected?" selected":"");t.box.className=this.baseClassName+i,this.overflow="hidden"!==window.getComputedStyle(t.content).overflow,this.dom.content.style.maxWidth="none",this.props.content.width=this.dom.content.offsetWidth,this.height=this.dom.box.offsetHeight,this.dom.content.style.maxWidth="",this.dirty=!1}this._repaintDeleteButton(t.box),this._repaintDragLeft(),this._repaintDragRight()},s.prototype.show=function(){this.displayed||this.redraw()},s.prototype.hide=function(){if(this.displayed){var t=this.dom.box;t.parentNode&&t.parentNode.removeChild(t),this.top=null,this.left=null,this.displayed=!1}},s.prototype.repositionX=function(){var t,e,i=this.parent.width,s=this.conversion.toScreen(this.data.start),o=this.conversion.toScreen(this.data.end);-i>s&&(s=-i),o>2*i&&(o=2*i);var n=Math.max(o-s,1);switch(this.overflow?(this.left=s,this.width=n+this.props.content.width,e=this.props.content.width):(this.left=s,this.width=n,e=Math.min(o-s-2*this.options.padding,this.props.content.width)),this.dom.box.style.left=this.left+"px",this.dom.box.style.width=n+"px",this.options.align){case"left":this.dom.content.style.left="0";break;case"right":this.dom.content.style.left=Math.max(n-e-2*this.options.padding,0)+"px";break;case"center":this.dom.content.style.left=Math.max((n-e-2*this.options.padding)/2,0)+"px";break;default:t=this.overflow?o>0?Math.max(-s,0):-e:0>s?Math.min(-s,o-s-e-2*this.options.padding):0,this.dom.content.style.left=t+"px"}},s.prototype.repositionY=function(){var t=this.options.orientation,e=this.dom.box;e.style.top="top"==t?this.top+"px":this.parent.height-this.top-this.height+"px"},s.prototype._repaintDragLeft=function(){if(this.selected&&this.options.editable.updateTime&&!this.dom.dragLeft){var t=document.createElement("div");t.className="drag-left",t.dragLeftItem=this,o(t,{preventDefault:!0}).on("drag",function(){}),this.dom.box.appendChild(t),this.dom.dragLeft=t}else!this.selected&&this.dom.dragLeft&&(this.dom.dragLeft.parentNode&&this.dom.dragLeft.parentNode.removeChild(this.dom.dragLeft),this.dom.dragLeft=null)},s.prototype._repaintDragRight=function(){if(this.selected&&this.options.editable.updateTime&&!this.dom.dragRight){var t=document.createElement("div");t.className="drag-right",t.dragRightItem=this,o(t,{preventDefault:!0}).on("drag",function(){}),this.dom.box.appendChild(t),this.dom.dragRight=t}else!this.selected&&this.dom.dragRight&&(this.dom.dragRight.parentNode&&this.dom.dragRight.parentNode.removeChild(this.dom.dragRight),this.dom.dragRight=null)},t.exports=s},function(t){function e(){this.options=null,this.props=null}e.prototype.setOptions=function(t){t&&util.extend(this.options,t)},e.prototype.redraw=function(){return!1},e.prototype.destroy=function(){},e.prototype._isResized=function(){var t=this.props._previousWidth!==this.props.width||this.props._previousHeight!==this.props.height;return this.props._previousWidth=this.props.width,this.props._previousHeight=this.props.height,t},t.exports=e},function(t,e,i){function s(t,e){this.body=t,this.defaultOptions={showCurrentTime:!0,locales:a,locale:"en"},this.options=o.extend({},this.defaultOptions),this.offset=0,this._create(),this.setOptions(e)}var o=i(1),n=i(25),r=i(44),a=i(48);s.prototype=new n,s.prototype._create=function(){var t=document.createElement("div");t.className="currenttime",t.style.position="absolute",t.style.top="0px",t.style.height="100%",this.bar=t},s.prototype.destroy=function(){this.options.showCurrentTime=!1,this.redraw(),this.body=null},s.prototype.setOptions=function(t){t&&o.selectiveExtend(["showCurrentTime","locale","locales"],this.options,t)},s.prototype.redraw=function(){if(this.options.showCurrentTime){var t=this.body.dom.backgroundVertical;this.bar.parentNode!=t&&(this.bar.parentNode&&this.bar.parentNode.removeChild(this.bar),t.appendChild(this.bar),this.start());var e=new Date((new Date).valueOf()+this.offset),i=this.body.util.toScreen(e),s=this.options.locales[this.options.locale],o=s.current+" "+s.time+": "+r(e).format("dddd, MMMM Do YYYY, H:mm:ss");o=o.charAt(0).toUpperCase()+o.substring(1),this.bar.style.left=i+"px",this.bar.title=o}else this.bar.parentNode&&this.bar.parentNode.removeChild(this.bar),this.stop();return!1},s.prototype.start=function(){function t(){e.stop();var i=e.body.range.conversion(e.body.domProps.center.width).scale,s=1/i/10;30>s&&(s=30),s>1e3&&(s=1e3),e.redraw(),e.currentTimeTimer=setTimeout(t,s)}var e=this;t()},s.prototype.stop=function(){void 0!==this.currentTimeTimer&&(clearTimeout(this.currentTimeTimer),delete this.currentTimeTimer)},s.prototype.setCurrentTime=function(t){var e=o.convert(t,"Date").valueOf(),i=(new Date).valueOf();this.offset=e-i,this.redraw()},s.prototype.getCurrentTime=function(){return new Date((new Date).valueOf()+this.offset)},t.exports=s},function(t,e,i){function s(t,e){this.body=t,this.defaultOptions={showCustomTime:!1,locales:h,locale:"en"},this.options=n.extend({},this.defaultOptions),this.customTime=new Date,this.eventParams={},this._create(),this.setOptions(e)}var o=i(45),n=i(1),r=i(25),a=i(44),h=i(48);s.prototype=new r,s.prototype.setOptions=function(t){t&&n.selectiveExtend(["showCustomTime","locale","locales"],this.options,t)},s.prototype._create=function(){var t=document.createElement("div");t.className="customtime",t.style.position="absolute",t.style.top="0px",t.style.height="100%",this.bar=t;var e=document.createElement("div");e.style.position="relative",e.style.top="0px",e.style.left="-10px",e.style.height="100%",e.style.width="20px",t.appendChild(e),this.hammer=o(t,{prevent_default:!0}),this.hammer.on("dragstart",this._onDragStart.bind(this)),this.hammer.on("drag",this._onDrag.bind(this)),this.hammer.on("dragend",this._onDragEnd.bind(this))},s.prototype.destroy=function(){this.options.showCustomTime=!1,this.redraw(),this.hammer.enable(!1),this.hammer=null,this.body=null},s.prototype.redraw=function(){if(this.options.showCustomTime){var t=this.body.dom.backgroundVertical;this.bar.parentNode!=t&&(this.bar.parentNode&&this.bar.parentNode.removeChild(this.bar),t.appendChild(this.bar));var e=this.body.util.toScreen(this.customTime),i=this.options.locales[this.options.locale],s=i.time+": "+a(this.customTime).format("dddd, MMMM Do YYYY, H:mm:ss");s=s.charAt(0).toUpperCase()+s.substring(1),this.bar.style.left=e+"px",this.bar.title=s}else this.bar.parentNode&&this.bar.parentNode.removeChild(this.bar);return!1},s.prototype.setCustomTime=function(t){this.customTime=n.convert(t,"Date"),this.redraw()},s.prototype.getCustomTime=function(){return new Date(this.customTime.valueOf())},s.prototype._onDragStart=function(t){this.eventParams.dragging=!0,this.eventParams.customTime=this.customTime,t.stopPropagation(),t.preventDefault()},s.prototype._onDrag=function(t){if(this.eventParams.dragging){var e=t.gesture.deltaX,i=this.body.util.toScreen(this.eventParams.customTime)+e,s=this.body.util.toTime(i);this.setCustomTime(s),this.body.emitter.emit("timechange",{time:new Date(this.customTime.valueOf())}),t.stopPropagation(),t.preventDefault()}},s.prototype._onDragEnd=function(t){this.eventParams.dragging&&(this.body.emitter.emit("timechanged",{time:new Date(this.customTime.valueOf())}),t.stopPropagation(),t.preventDefault())},t.exports=s},function(t,e,i){function s(t,e,i,s){this.id=o.randomUUID(),this.body=t,this.defaultOptions={orientation:"left",showMinorLabels:!0,showMajorLabels:!0,icons:!0,majorLinesOffset:7,minorLinesOffset:4,labelOffsetX:10,labelOffsetY:2,iconWidth:20,width:"40px",visible:!0,alignZeros:!0,customRange:{left:{min:void 0,max:void 0},right:{min:void 0,max:void 0}},title:{left:{text:void 0},right:{text:void 0}},format:{left:{decimals:void 0},right:{decimals:void 0}}},this.linegraphOptions=s,this.linegraphSVG=i,this.props={},this.DOMelements={lines:{},labels:{},title:{}},this.dom={},this.range={start:0,end:0},this.options=o.extend({},this.defaultOptions),this.conversionFactor=1,this.setOptions(e),this.width=Number((""+this.options.width).replace("px","")),this.minWidth=this.width,this.height=this.linegraphSVG.offsetHeight,this.hidden=!1,this.stepPixels=25,this.stepPixelsForced=25,this.zeroCrossing=-1,this.lineOffset=0,this.master=!0,this.svgElements={},this.iconsRemoved=!1,this.groups={},this.amountOfGroups=0,this._create();var n=this;this.body.emitter.on("verticalDrag",function(){n.dom.lineContainer.style.top=n.body.domProps.scrollTop+"px"})}var o=i(1),n=i(2),r=i(25),a=i(16);s.prototype=new r,s.prototype.addGroup=function(t,e){this.groups.hasOwnProperty(t)||(this.groups[t]=e),this.amountOfGroups+=1},s.prototype.updateGroup=function(t,e){this.groups[t]=e},s.prototype.removeGroup=function(t){this.groups.hasOwnProperty(t)&&(delete this.groups[t],this.amountOfGroups-=1)},s.prototype.setOptions=function(t){if(t){var e=!1;this.options.orientation!=t.orientation&&void 0!==t.orientation&&(e=!0);var i=["orientation","showMinorLabels","showMajorLabels","icons","majorLinesOffset","minorLinesOffset","labelOffsetX","labelOffsetY","iconWidth","width","visible","customRange","title","format","alignZeros"];o.selectiveExtend(i,this.options,t),this.minWidth=Number((""+this.options.width).replace("px","")),1==e&&this.dom.frame&&(this.hide(),this.show())}},s.prototype._create=function(){this.dom.frame=document.createElement("div"),this.dom.frame.style.width=this.options.width,this.dom.frame.style.height=this.height,this.dom.lineContainer=document.createElement("div"),this.dom.lineContainer.style.width="100%",this.dom.lineContainer.style.height=this.height,this.dom.lineContainer.style.position="relative",this.svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),this.svg.style.position="absolute",this.svg.style.top="0px",this.svg.style.height="100%",this.svg.style.width="100%",this.svg.style.display="block",this.dom.frame.appendChild(this.svg)},s.prototype._redrawGroupIcons=function(){n.prepareElements(this.svgElements);var t,e=this.options.iconWidth,i=15,s=4,o=s+.5*i;t="left"==this.options.orientation?s:this.width-e-s;for(var r in this.groups)this.groups.hasOwnProperty(r)&&(1!=this.groups[r].visible||void 0!==this.linegraphOptions.visibility[r]&&1!=this.linegraphOptions.visibility[r]||(this.groups[r].drawIcon(t,o,this.svgElements,this.svg,e,i),o+=i+s));n.cleanupElements(this.svgElements),this.iconsRemoved=!1},s.prototype._cleanupIcons=function(){0==this.iconsRemoved&&(n.prepareElements(this.svgElements),n.cleanupElements(this.svgElements),this.iconsRemoved=!0)},s.prototype.show=function(){this.hidden=!1,this.dom.frame.parentNode||("left"==this.options.orientation?this.body.dom.left.appendChild(this.dom.frame):this.body.dom.right.appendChild(this.dom.frame)),this.dom.lineContainer.parentNode||this.body.dom.backgroundHorizontal.appendChild(this.dom.lineContainer)},s.prototype.hide=function(){this.hidden=!0,this.dom.frame.parentNode&&this.dom.frame.parentNode.removeChild(this.dom.frame),this.dom.lineContainer.parentNode&&this.dom.lineContainer.parentNode.removeChild(this.dom.lineContainer)},s.prototype.setRange=function(t,e){0==this.master&&1==this.options.alignZeros&&-1!=this.zeroCrossing&&t>0&&(t=0),this.range.start=t,this.range.end=e},s.prototype.redraw=function(){var t=!1,e=0;this.dom.lineContainer.style.top=this.body.domProps.scrollTop+"px";for(var i in this.groups)this.groups.hasOwnProperty(i)&&(1!=this.groups[i].visible||void 0!==this.linegraphOptions.visibility[i]&&1!=this.linegraphOptions.visibility[i]||e++);if(0==this.amountOfGroups||0==e)this.hide();else{this.show(),this.height=Number(this.linegraphSVG.style.height.replace("px","")),this.dom.lineContainer.style.height=this.height+"px",this.width=1==this.options.visible?Number((""+this.options.width).replace("px","")):0;var s=this.props,o=this.dom.frame;o.className="dataaxis",this._calculateCharSize();var n=this.options.orientation,r=this.options.showMinorLabels,a=this.options.showMajorLabels;s.minorLabelHeight=r?s.minorCharHeight:0,s.majorLabelHeight=a?s.majorCharHeight:0,s.minorLineWidth=this.body.dom.backgroundHorizontal.offsetWidth-this.lineOffset-this.width+2*this.options.minorLinesOffset,s.minorLineHeight=1,s.majorLineWidth=this.body.dom.backgroundHorizontal.offsetWidth-this.lineOffset-this.width+2*this.options.majorLinesOffset,s.majorLineHeight=1,"left"==n?(o.style.top="0",o.style.left="0",o.style.bottom="",o.style.width=this.width+"px",o.style.height=this.height+"px",this.props.width=this.body.domProps.left.width,this.props.height=this.body.domProps.left.height):(o.style.top="",o.style.bottom="0",o.style.left="0",o.style.width=this.width+"px",o.style.height=this.height+"px",this.props.width=this.body.domProps.right.width,this.props.height=this.body.domProps.right.height),t=this._redrawLabels(),t=this._isResized()||t,1==this.options.icons?this._redrawGroupIcons():this._cleanupIcons(),this._redrawTitle(n)}return t},s.prototype._redrawLabels=function(){var t=!1;n.prepareElements(this.DOMelements.lines),n.prepareElements(this.DOMelements.labels);var e=this.options.orientation,i=this.master?this.props.majorCharHeight||10:this.stepPixelsForced,s=new a(this.range.start,this.range.end,i,this.dom.frame.offsetHeight,this.options.customRange[this.options.orientation],0==this.master&&this.options.alignZeros);this.step=s;var o=(this.dom.frame.offsetHeight-s.deadSpace*(this.dom.frame.offsetHeight/s.marginRange))/((s.marginRange-s.deadSpace)/s.step);this.stepPixels=o;var r=this.height/o,h=0;if(0==this.master){o=this.stepPixelsForced,h=Math.round(this.dom.frame.offsetHeight/o-r);
for(var d=0;.5*h>d;d++)s.previous();if(r=this.height/o,-1!=this.zeroCrossing&&1==this.options.alignZeros){var l=s.marginEnd/s.step-this.zeroCrossing;if(l>0)for(var d=0;l>d;d++)s.next();else if(0>l)for(var d=0;-l>d;d++)s.previous()}}else r+=.25;this.valueAtZero=s.marginEnd;var c,p=0,u=1;void 0!==this.options.format[e]&&(c=this.options.format[e].decimals),this.maxLabelSize=0;for(var m=0;u<Math.round(r);){s.next(),m=Math.round(u*o),p=u*o;var f=s.isMajor();(this.options.showMinorLabels&&0==f||0==this.master&&1==this.options.showMinorLabels)&&this._redrawLabel(m-2,s.getCurrent(c),e,"yAxis minor",this.props.minorCharHeight),f&&this.options.showMajorLabels&&1==this.master||0==this.options.showMinorLabels&&0==this.master&&1==f?(m>=0&&this._redrawLabel(m-2,s.getCurrent(c),e,"yAxis major",this.props.majorCharHeight),this._redrawLine(m,e,"grid horizontal major",this.options.majorLinesOffset,this.props.majorLineWidth)):this._redrawLine(m,e,"grid horizontal minor",this.options.minorLinesOffset,this.props.minorLineWidth),1==this.master&&0==s.current&&(this.zeroCrossing=u),u++}this.conversionFactor=0==this.master?m/(this.valueAtZero-s.current):this.dom.frame.offsetHeight/s.marginRange;var g=0;void 0!==this.options.title[e]&&void 0!==this.options.title[e].text&&(g=this.props.titleCharHeight);var v=1==this.options.icons?Math.max(this.options.iconWidth,g)+this.options.labelOffsetX+15:g+this.options.labelOffsetX+15;return this.maxLabelSize>this.width-v&&1==this.options.visible?(this.width=this.maxLabelSize+v,this.options.width=this.width+"px",n.cleanupElements(this.DOMelements.lines),n.cleanupElements(this.DOMelements.labels),this.redraw(),t=!0):this.maxLabelSize<this.width-v&&1==this.options.visible&&this.width>this.minWidth?(this.width=Math.max(this.minWidth,this.maxLabelSize+v),this.options.width=this.width+"px",n.cleanupElements(this.DOMelements.lines),n.cleanupElements(this.DOMelements.labels),this.redraw(),t=!0):(n.cleanupElements(this.DOMelements.lines),n.cleanupElements(this.DOMelements.labels),t=!1),t},s.prototype.convertValue=function(t){var e=this.valueAtZero-t,i=e*this.conversionFactor;return i},s.prototype._redrawLabel=function(t,e,i,s,o){var r=n.getDOMElement("div",this.DOMelements.labels,this.dom.frame);r.className=s,r.innerHTML=e,"left"==i?(r.style.left="-"+this.options.labelOffsetX+"px",r.style.textAlign="right"):(r.style.right="-"+this.options.labelOffsetX+"px",r.style.textAlign="left"),r.style.top=t-.5*o+this.options.labelOffsetY+"px",e+="";var a=Math.max(this.props.majorCharWidth,this.props.minorCharWidth);this.maxLabelSize<e.length*a&&(this.maxLabelSize=e.length*a)},s.prototype._redrawLine=function(t,e,i,s,o){if(1==this.master){var r=n.getDOMElement("div",this.DOMelements.lines,this.dom.lineContainer);r.className=i,r.innerHTML="","left"==e?r.style.left=this.width-s+"px":r.style.right=this.width-s+"px",r.style.width=o+"px",r.style.top=t+"px"}},s.prototype._redrawTitle=function(t){if(n.prepareElements(this.DOMelements.title),void 0!==this.options.title[t]&&void 0!==this.options.title[t].text){var e=n.getDOMElement("div",this.DOMelements.title,this.dom.frame);e.className="yAxis title "+t,e.innerHTML=this.options.title[t].text,void 0!==this.options.title[t].style&&o.addCssText(e,this.options.title[t].style),"left"==t?e.style.left=this.props.titleCharHeight+"px":e.style.right=this.props.titleCharHeight+"px",e.style.width=this.height+"px"}n.cleanupElements(this.DOMelements.title)},s.prototype._calculateCharSize=function(){if(!("minorCharHeight"in this.props)){var t=document.createTextNode("0"),e=document.createElement("div");e.className="yAxis minor measure",e.appendChild(t),this.dom.frame.appendChild(e),this.props.minorCharHeight=e.clientHeight,this.props.minorCharWidth=e.clientWidth,this.dom.frame.removeChild(e)}if(!("majorCharHeight"in this.props)){var i=document.createTextNode("0"),s=document.createElement("div");s.className="yAxis major measure",s.appendChild(i),this.dom.frame.appendChild(s),this.props.majorCharHeight=s.clientHeight,this.props.majorCharWidth=s.clientWidth,this.dom.frame.removeChild(s)}if(!("titleCharHeight"in this.props)){var o=document.createTextNode("0"),n=document.createElement("div");n.className="yAxis title measure",n.appendChild(o),this.dom.frame.appendChild(n),this.props.titleCharHeight=n.clientHeight,this.props.titleCharWidth=n.clientWidth,this.dom.frame.removeChild(n)}},s.prototype.snap=function(t){return this.step.snap(t)},t.exports=s},function(t,e,i){function s(t,e,i,s){this.id=e;var n=["sampling","style","sort","yAxisOrientation","barChart","drawPoints","shaded","catmullRom"];this.options=o.selectiveBridgeObject(n,i),this.usingDefaultStyle=void 0===t.className,this.groupsUsingDefaultStyles=s,this.zeroPosition=0,this.update(t),1==this.usingDefaultStyle&&(this.groupsUsingDefaultStyles[0]+=1),this.itemsData=[],this.visible=void 0===t.visible?!0:t.visible}var o=i(1),n=i(2),r=i(49),a=i(50),h=i(51);s.prototype.setItems=function(t){null!=t?(this.itemsData=t,1==this.options.sort&&this.itemsData.sort(function(t,e){return t.x-e.x})):this.itemsData=[]},s.prototype.setZeroPosition=function(t){this.zeroPosition=t},s.prototype.setOptions=function(t){if(void 0!==t){var e=["sampling","style","sort","yAxisOrientation","barChart"];o.selectiveDeepExtend(e,this.options,t),o.mergeOptions(this.options,t,"catmullRom"),o.mergeOptions(this.options,t,"drawPoints"),o.mergeOptions(this.options,t,"shaded"),t.catmullRom&&"object"==typeof t.catmullRom&&t.catmullRom.parametrization&&("uniform"==t.catmullRom.parametrization?this.options.catmullRom.alpha=0:"chordal"==t.catmullRom.parametrization?this.options.catmullRom.alpha=1:(this.options.catmullRom.parametrization="centripetal",this.options.catmullRom.alpha=.5))}"line"==this.options.style?this.type=new r(this.id,this.options):"bar"==this.options.style?this.type=new a(this.id,this.options):"points"==this.options.style&&(this.type=new h(this.id,this.options))},s.prototype.update=function(t){this.group=t,this.content=t.content||"graph",this.className=t.className||this.className||"graphGroup"+this.groupsUsingDefaultStyles[0]%10,this.visible=void 0===t.visible?!0:t.visible,this.style=t.style,this.setOptions(t.options)},s.prototype.drawIcon=function(t,e,i,s,o,r){var a,h,d=.5*r,l=n.getSVGElement("rect",i,s);if(l.setAttributeNS(null,"x",t),l.setAttributeNS(null,"y",e-d),l.setAttributeNS(null,"width",o),l.setAttributeNS(null,"height",2*d),l.setAttributeNS(null,"class","outline"),"line"==this.options.style)a=n.getSVGElement("path",i,s),a.setAttributeNS(null,"class",this.className),void 0!==this.style&&a.setAttributeNS(null,"style",this.style),a.setAttributeNS(null,"d","M"+t+","+e+" L"+(t+o)+","+e),1==this.options.shaded.enabled&&(h=n.getSVGElement("path",i,s),"top"==this.options.shaded.orientation?h.setAttributeNS(null,"d","M"+t+", "+(e-d)+"L"+t+","+e+" L"+(t+o)+","+e+" L"+(t+o)+","+(e-d)):h.setAttributeNS(null,"d","M"+t+","+e+" L"+t+","+(e+d)+" L"+(t+o)+","+(e+d)+"L"+(t+o)+","+e),h.setAttributeNS(null,"class",this.className+" iconFill")),1==this.options.drawPoints.enabled&&n.drawPoint(t+.5*o,e,this,i,s);else{var c=Math.round(.3*o),p=Math.round(.4*r),u=Math.round(.75*r),m=Math.round((o-2*c)/3);n.drawBar(t+.5*c+m,e+d-p-1,c,p,this.className+" bar",i,s),n.drawBar(t+1.5*c+m+2,e+d-u-1,c,u,this.className+" bar",i,s)}},s.prototype.getLegend=function(t,e){var i=document.createElementNS("http://www.w3.org/2000/svg","svg");return this.drawIcon(0,.5*e,[],i,t,e),{icon:i,label:this.content,orientation:this.options.yAxisOrientation}},s.prototype.getYRange=function(t){return this.type.getYRange(t)},s.prototype.draw=function(t,e,i){this.type.draw(t,e,i)},t.exports=s},function(t,e,i){function s(t,e,i){this.groupId=t,this.subgroups={},this.subgroupIndex=0,this.subgroupOrderer=e&&e.subgroupOrder,this.itemSet=i,this.dom={},this.props={label:{width:0,height:0}},this.className=null,this.items={},this.visibleItems=[],this.orderedItems={byStart:[],byEnd:[]},this.checkRangedItems=!1;var s=this;this.itemSet.body.emitter.on("checkRangedItems",function(){s.checkRangedItems=!0}),this._create(),this.setData(e)}{var o=i(1),n=i(18);i(24)}s.prototype._create=function(){var t=document.createElement("div");t.className="vlabel",this.dom.label=t;var e=document.createElement("div");e.className="inner",t.appendChild(e),this.dom.inner=e;var i=document.createElement("div");i.className="group",i["timeline-group"]=this,this.dom.foreground=i,this.dom.background=document.createElement("div"),this.dom.background.className="group",this.dom.axis=document.createElement("div"),this.dom.axis.className="group",this.dom.marker=document.createElement("div"),this.dom.marker.style.visibility="hidden",this.dom.marker.innerHTML="?",this.dom.background.appendChild(this.dom.marker)},s.prototype.setData=function(t){var e=t&&t.content;e instanceof Element?this.dom.inner.appendChild(e):this.dom.inner.innerHTML=void 0!==e&&null!==e?e:this.groupId||"",this.dom.label.title=t&&t.title||"",this.dom.inner.firstChild?o.removeClassName(this.dom.inner,"hidden"):o.addClassName(this.dom.inner,"hidden");var i=t&&t.className||null;i!=this.className&&(this.className&&(o.removeClassName(this.dom.label,this.className),o.removeClassName(this.dom.foreground,this.className),o.removeClassName(this.dom.background,this.className),o.removeClassName(this.dom.axis,this.className)),o.addClassName(this.dom.label,i),o.addClassName(this.dom.foreground,i),o.addClassName(this.dom.background,i),o.addClassName(this.dom.axis,i),this.className=i),this.style&&(o.removeCssText(this.dom.label,this.style),this.style=null),t&&t.style&&(o.addCssText(this.dom.label,t.style),this.style=t.style)},s.prototype.getLabelWidth=function(){return this.props.label.width},s.prototype.redraw=function(t,e,i){var s=!1;this.visibleItems=this._updateVisibleItems(this.orderedItems,this.visibleItems,t);var r=this.dom.marker.clientHeight;r!=this.lastMarkerHeight&&(this.lastMarkerHeight=r,o.forEach(this.items,function(t){t.dirty=!0,t.displayed&&t.redraw()}),i=!0),this.itemSet.options.stack?n.stack(this.visibleItems,e,i):n.nostack(this.visibleItems,e,this.subgroups);var a=this._calculateHeight(e),h=this.dom.foreground;this.top=h.offsetTop,this.left=h.offsetLeft,this.width=h.offsetWidth,s=o.updateProperty(this,"height",a)||s,s=o.updateProperty(this.props.label,"width",this.dom.inner.clientWidth)||s,s=o.updateProperty(this.props.label,"height",this.dom.inner.clientHeight)||s,this.dom.background.style.height=a+"px",this.dom.foreground.style.height=a+"px",this.dom.label.style.height=a+"px";for(var d=0,l=this.visibleItems.length;l>d;d++){var c=this.visibleItems[d];c.repositionY(e)}return s},s.prototype._calculateHeight=function(t){var e,i=this.visibleItems;this.resetSubgroups();var s=this;if(i.length){var n=i[0].top,r=i[0].top+i[0].height;if(o.forEach(i,function(t){n=Math.min(n,t.top),r=Math.max(r,t.top+t.height),void 0!==t.data.subgroup&&(s.subgroups[t.data.subgroup].height=Math.max(s.subgroups[t.data.subgroup].height,t.height),s.subgroups[t.data.subgroup].visible=!0)}),n>t.axis){var a=n-t.axis;r-=a,o.forEach(i,function(t){t.top-=a})}e=r+t.item.vertical/2}else e=t.axis+t.item.vertical;return e=Math.max(e,this.props.label.height)},s.prototype.show=function(){this.dom.label.parentNode||this.itemSet.dom.labelSet.appendChild(this.dom.label),this.dom.foreground.parentNode||this.itemSet.dom.foreground.appendChild(this.dom.foreground),this.dom.background.parentNode||this.itemSet.dom.background.appendChild(this.dom.background),this.dom.axis.parentNode||this.itemSet.dom.axis.appendChild(this.dom.axis)},s.prototype.hide=function(){var t=this.dom.label;t.parentNode&&t.parentNode.removeChild(t);var e=this.dom.foreground;e.parentNode&&e.parentNode.removeChild(e);var i=this.dom.background;i.parentNode&&i.parentNode.removeChild(i);var s=this.dom.axis;s.parentNode&&s.parentNode.removeChild(s)},s.prototype.add=function(t){if(this.items[t.id]=t,t.setParent(this),void 0!==t.data.subgroup&&(void 0===this.subgroups[t.data.subgroup]&&(this.subgroups[t.data.subgroup]={height:0,visible:!1,index:this.subgroupIndex,items:[]},this.subgroupIndex++),this.subgroups[t.data.subgroup].items.push(t)),this.orderSubgroups(),-1==this.visibleItems.indexOf(t)){var e=this.itemSet.body.range;this._checkIfVisible(t,this.visibleItems,e)}},s.prototype.orderSubgroups=function(){if(void 0!==this.subgroupOrderer){var t=[];if("string"==typeof this.subgroupOrderer){for(var e in this.subgroups)t.push({subgroup:e,sortField:this.subgroups[e].items[0].data[this.subgroupOrderer]});t.sort(function(t,e){return t.sortField-e.sortField})}else if("function"==typeof this.subgroupOrderer){for(var e in this.subgroups)t.push(this.subgroups[e].items[0].data);t.sort(this.subgroupOrderer)}if(t.length>0)for(var i=0;i<t.length;i++)this.subgroups[t[i].subgroup].index=i}},s.prototype.resetSubgroups=function(){for(var t in this.subgroups)this.subgroups.hasOwnProperty(t)&&(this.subgroups[t].visible=!1)},s.prototype.remove=function(t){delete this.items[t.id],t.setParent(null);var e=this.visibleItems.indexOf(t);-1!=e&&this.visibleItems.splice(e,1)},s.prototype.removeFromDataSet=function(t){this.itemSet.removeItem(t.id)},s.prototype.order=function(){for(var t=o.toArray(this.items),e=[],i=[],s=0;s<t.length;s++)void 0!==t[s].data.end&&i.push(t[s]),e.push(t[s]);this.orderedItems={byStart:e,byEnd:i},n.orderByStart(this.orderedItems.byStart),n.orderByEnd(this.orderedItems.byEnd)},s.prototype._updateVisibleItems=function(t,e,i){var s,n,r=[],a={},h=(i.end-i.start)/4,d=i.start-h,l=i.end+h,c=function(t){return d>t?-1:l>=t?0:1};if(e.length>0)for(n=0;n<e.length;n++)this._checkIfVisibleWithReference(e[n],r,a,i);var p=o.binarySearchCustom(t.byStart,c,"data","start");if(this._traceVisible(p,t.byStart,r,a,function(t){return t.data.start<d||t.data.start>l}),1==this.checkRangedItems)for(this.checkRangedItems=!1,n=0;n<t.byEnd.length;n++)this._checkIfVisibleWithReference(t.byEnd[n],r,a,i);else{var u=o.binarySearchCustom(t.byEnd,c,"data","end");this._traceVisible(u,t.byEnd,r,a,function(t){return t.data.end<d||t.data.end>l})}for(n=0;n<r.length;n++)s=r[n],s.displayed||s.show(),s.repositionX();return r},s.prototype._traceVisible=function(t,e,i,s,o){var n,r;if(-1!=t){for(r=t;r>=0&&(n=e[r],!o(n));r--)void 0===s[n.id]&&(s[n.id]=!0,i.push(n));for(r=t+1;r<e.length&&(n=e[r],!o(n));r++)void 0===s[n.id]&&(s[n.id]=!0,i.push(n))}},s.prototype._checkIfVisible=function(t,e,i){t.isVisible(i)?(t.displayed||t.show(),t.repositionX(),e.push(t)):t.displayed&&t.hide()},s.prototype._checkIfVisibleWithReference=function(t,e,i,s){t.isVisible(s)?void 0===i[t.id]&&(i[t.id]=!0,e.push(t)):t.displayed&&t.hide()},t.exports=s},function(t,e,i){function s(t,e,i){o.call(this,t,e,i),this.width=0,this.height=0,this.top=0,this.left=0}var o=(i(1),i(30));s.prototype=Object.create(o.prototype),s.prototype.redraw=function(t,e){var i=!1;this.visibleItems=this._updateVisibleItems(this.orderedItems,this.visibleItems,t),this.width=this.dom.background.offsetWidth,this.dom.background.style.height="0";for(var s=0,o=this.visibleItems.length;o>s;s++){var n=this.visibleItems[s];n.repositionY(e)}return i},s.prototype.show=function(){this.dom.background.parentNode||this.itemSet.dom.background.appendChild(this.dom.background)},t.exports=s},function(t,e,i){function s(t,e){this.body=t,this.defaultOptions={type:null,orientation:"bottom",align:"auto",stack:!0,groupOrder:null,selectable:!0,editable:{updateTime:!1,updateGroup:!1,add:!1,remove:!1},onAdd:function(t,e){e(t)},onUpdate:function(t,e){e(t)},onMove:function(t,e){e(t)},onRemove:function(t,e){e(t)},onMoving:function(t,e){e(t)},margin:{item:{horizontal:10,vertical:10},axis:20},padding:5},this.options=n.extend({},this.defaultOptions),this.itemOptions={type:{start:"Date",end:"Date"}},this.conversion={toScreen:t.util.toScreen,toTime:t.util.toTime},this.dom={},this.props={},this.hammer=null;var i=this;this.itemsData=null,this.groupsData=null,this.itemListeners={add:function(t,e){i._onAdd(e.items)},update:function(t,e){i._onUpdate(e.items)},remove:function(t,e){i._onRemove(e.items)}},this.groupListeners={add:function(t,e){i._onAddGroups(e.items)},update:function(t,e){i._onUpdateGroups(e.items)},remove:function(t,e){i._onRemoveGroups(e.items)}},this.items={},this.groups={},this.groupIds=[],this.selection=[],this.stackDirty=!0,this.touchParams={},this._create(),this.setOptions(e)}var o=i(45),n=i(1),r=i(3),a=i(4),h=i(25),d=i(30),l=i(31),c=i(22),p=i(23),u=i(24),m=i(21),f="__ungrouped__",g="__background__";s.prototype=new h,s.types={background:m,box:c,range:u,point:p},s.prototype._create=function(){var t=document.createElement("div");t.className="itemset",t["timeline-itemset"]=this,this.dom.frame=t;var e=document.createElement("div");e.className="background",t.appendChild(e),this.dom.background=e;var i=document.createElement("div");i.className="foreground",t.appendChild(i),this.dom.foreground=i;var s=document.createElement("div");s.className="axis",this.dom.axis=s;var n=document.createElement("div");n.className="labelset",this.dom.labelSet=n,this._updateUngrouped();var r=new l(g,null,this);r.show(),this.groups[g]=r,this.hammer=o(this.body.dom.centerContainer,{preventDefault:!0}),this.hammer.on("touch",this._onTouch.bind(this)),this.hammer.on("dragstart",this._onDragStart.bind(this)),this.hammer.on("drag",this._onDrag.bind(this)),this.hammer.on("dragend",this._onDragEnd.bind(this)),this.hammer.on("tap",this._onSelectItem.bind(this)),this.hammer.on("hold",this._onMultiSelectItem.bind(this)),this.hammer.on("doubletap",this._onAddItem.bind(this)),this.show()},s.prototype.setOptions=function(t){if(t){var e=["type","align","orientation","padding","stack","selectable","groupOrder","dataAttributes","template","hide"];n.selectiveExtend(e,this.options,t),"margin"in t&&("number"==typeof t.margin?(this.options.margin.axis=t.margin,this.options.margin.item.horizontal=t.margin,this.options.margin.item.vertical=t.margin):"object"==typeof t.margin&&(n.selectiveExtend(["axis"],this.options.margin,t.margin),"item"in t.margin&&("number"==typeof t.margin.item?(this.options.margin.item.horizontal=t.margin.item,this.options.margin.item.vertical=t.margin.item):"object"==typeof t.margin.item&&n.selectiveExtend(["horizontal","vertical"],this.options.margin.item,t.margin.item)))),"editable"in t&&("boolean"==typeof t.editable?(this.options.editable.updateTime=t.editable,this.options.editable.updateGroup=t.editable,this.options.editable.add=t.editable,this.options.editable.remove=t.editable):"object"==typeof t.editable&&n.selectiveExtend(["updateTime","updateGroup","add","remove"],this.options.editable,t.editable));var i=function(e){var i=t[e];if(i){if(!(i instanceof Function))throw new Error("option "+e+" must be a function "+e+"(item, callback)");this.options[e]=i}}.bind(this);["onAdd","onUpdate","onRemove","onMove","onMoving"].forEach(i),this.markDirty()}},s.prototype.markDirty=function(){this.groupIds=[],this.stackDirty=!0},s.prototype.destroy=function(){this.hide(),this.setItems(null),this.setGroups(null),this.hammer=null,this.body=null,this.conversion=null},s.prototype.hide=function(){this.dom.frame.parentNode&&this.dom.frame.parentNode.removeChild(this.dom.frame),this.dom.axis.parentNode&&this.dom.axis.parentNode.removeChild(this.dom.axis),this.dom.labelSet.parentNode&&this.dom.labelSet.parentNode.removeChild(this.dom.labelSet)},s.prototype.show=function(){this.dom.frame.parentNode||this.body.dom.center.appendChild(this.dom.frame),this.dom.axis.parentNode||this.body.dom.backgroundVertical.appendChild(this.dom.axis),this.dom.labelSet.parentNode||this.body.dom.left.appendChild(this.dom.labelSet)},s.prototype.setSelection=function(t){var e,i,s,o;for(void 0==t&&(t=[]),Array.isArray(t)||(t=[t]),e=0,i=this.selection.length;i>e;e++)s=this.selection[e],o=this.items[s],o&&o.unselect();for(this.selection=[],e=0,i=t.length;i>e;e++)s=t[e],o=this.items[s],o&&(this.selection.push(s),o.select())},s.prototype.getSelection=function(){return this.selection.concat([])},s.prototype.getVisibleItems=function(){var t=this.body.range.getRange(),e=this.body.util.toScreen(t.start),i=this.body.util.toScreen(t.end),s=[];for(var o in this.groups)if(this.groups.hasOwnProperty(o))for(var n=this.groups[o],r=n.visibleItems,a=0;a<r.length;a++){var h=r[a];h.left<i&&h.left+h.width>e&&s.push(h.id)}return s},s.prototype._deselect=function(t){for(var e=this.selection,i=0,s=e.length;s>i;i++)if(e[i]==t){e.splice(i,1);break}},s.prototype.redraw=function(){var t=this.options.margin,e=this.body.range,i=n.option.asSize,s=this.options,o=s.orientation,r=!1,a=this.dom.frame,h=s.editable.updateTime||s.editable.updateGroup;this.props.top=this.body.domProps.top.height+this.body.domProps.border.top,this.props.left=this.body.domProps.left.width+this.body.domProps.border.left,a.className="itemset"+(h?" editable":""),r=this._orderGroups()||r;var d=e.end-e.start,l=d!=this.lastVisibleInterval||this.props.width!=this.props.lastWidth;l&&(this.stackDirty=!0),this.lastVisibleInterval=d,this.props.lastWidth=this.props.width;var c=this.stackDirty,p=this._firstGroup(),u={item:t.item,axis:t.axis},m={item:t.item,axis:t.item.vertical/2},f=0,v=t.axis+t.item.vertical;return this.groups[g].redraw(e,m,c),n.forEach(this.groups,function(t){var i=t==p?u:m,s=t.redraw(e,i,c);r=s||r,f+=t.height}),f=Math.max(f,v),this.stackDirty=!1,a.style.height=i(f),this.props.width=a.offsetWidth,this.props.height=f,this.dom.axis.style.top=i("top"==o?this.body.domProps.top.height+this.body.domProps.border.top:this.body.domProps.top.height+this.body.domProps.centerContainer.height),this.dom.axis.style.left="0",r=this._isResized()||r},s.prototype._firstGroup=function(){var t="top"==this.options.orientation?0:this.groupIds.length-1,e=this.groupIds[t],i=this.groups[e]||this.groups[f];return i||null},s.prototype._updateUngrouped=function(){{var t,e,i=this.groups[f];this.groups[g]}if(this.groupsData){if(i){i.hide(),delete this.groups[f];for(e in this.items)if(this.items.hasOwnProperty(e)){t=this.items[e],t.parent&&t.parent.remove(t);var s=this._getGroupId(t.data),o=this.groups[s];o&&o.add(t)||t.hide()}}}else if(!i){var n=null,r=null;i=new d(n,r,this),this.groups[f]=i;for(e in this.items)this.items.hasOwnProperty(e)&&(t=this.items[e],i.add(t));i.show()}},s.prototype.getLabelSet=function(){return this.dom.labelSet},s.prototype.setItems=function(t){var e,i=this,s=this.itemsData;if(t){if(!(t instanceof r||t instanceof a))throw new TypeError("Data must be an instance of DataSet or DataView");this.itemsData=t}else this.itemsData=null;if(s&&(n.forEach(this.itemListeners,function(t,e){s.off(e,t)}),e=s.getIds(),this._onRemove(e)),this.itemsData){var o=this.id;n.forEach(this.itemListeners,function(t,e){i.itemsData.on(e,t,o)}),e=this.itemsData.getIds(),this._onAdd(e),this._updateUngrouped()}},s.prototype.getItems=function(){return this.itemsData},s.prototype.setGroups=function(t){var e,i=this;if(this.groupsData&&(n.forEach(this.groupListeners,function(t,e){i.groupsData.unsubscribe(e,t)}),e=this.groupsData.getIds(),this.groupsData=null,this._onRemoveGroups(e)),t){if(!(t instanceof r||t instanceof a))throw new TypeError("Data must be an instance of DataSet or DataView");this.groupsData=t}else this.groupsData=null;if(this.groupsData){var s=this.id;n.forEach(this.groupListeners,function(t,e){i.groupsData.on(e,t,s)}),e=this.groupsData.getIds(),this._onAddGroups(e)}this._updateUngrouped(),this._order(),this.body.emitter.emit("change",{queue:!0})},s.prototype.getGroups=function(){return this.groupsData},s.prototype.removeItem=function(t){var e=this.itemsData.get(t),i=this.itemsData.getDataSet();e&&this.options.onRemove(e,function(e){e&&i.remove(t)})},s.prototype._getType=function(t){return t.type||this.options.type||(t.end?"range":"box")},s.prototype._getGroupId=function(t){var e=this._getType(t);return"background"==e&&void 0==t.group?g:this.groupsData?t.group:f},s.prototype._onUpdate=function(t){var e=this;t.forEach(function(t){var i=e.itemsData.get(t,e.itemOptions),o=e.items[t],n=e._getType(i),r=s.types[n];if(o&&(r&&o instanceof r?e._updateItem(o,i):(e._removeItem(o),o=null)),!o){if(!r)throw new TypeError("rangeoverflow"==n?'Item type "rangeoverflow" is deprecated. Use css styling instead: .vis.timeline .item.range .content {overflow: visible;}':'Unknown item type "'+n+'"');o=new r(i,e.conversion,e.options),o.id=t,e._addItem(o)}}),this._order(),this.stackDirty=!0,this.body.emitter.emit("change",{queue:!0})},s.prototype._onAdd=s.prototype._onUpdate,s.prototype._onRemove=function(t){var e=0,i=this;t.forEach(function(t){var s=i.items[t];s&&(e++,i._removeItem(s))}),e&&(this._order(),this.stackDirty=!0,this.body.emitter.emit("change",{queue:!0}))},s.prototype._order=function(){n.forEach(this.groups,function(t){t.order()})},s.prototype._onUpdateGroups=function(t){this._onAddGroups(t)},s.prototype._onAddGroups=function(t){var e=this;t.forEach(function(t){var i=e.groupsData.get(t),s=e.groups[t];if(s)s.setData(i);else{if(t==f||t==g)throw new Error("Illegal group id. "+t+" is a reserved id.");var o=Object.create(e.options);n.extend(o,{height:null}),s=new d(t,i,e),e.groups[t]=s;for(var r in e.items)if(e.items.hasOwnProperty(r)){var a=e.items[r];a.data.group==t&&s.add(a)}s.order(),s.show()}}),this.body.emitter.emit("change",{queue:!0})},s.prototype._onRemoveGroups=function(t){var e=this.groups;t.forEach(function(t){var i=e[t];i&&(i.hide(),delete e[t])}),this.markDirty(),this.body.emitter.emit("change",{queue:!0})},s.prototype._orderGroups=function(){if(this.groupsData){var t=this.groupsData.getIds({order:this.options.groupOrder}),e=!n.equalArray(t,this.groupIds);if(e){var i=this.groups;t.forEach(function(t){i[t].hide()}),t.forEach(function(t){i[t].show()}),this.groupIds=t}return e}return!1},s.prototype._addItem=function(t){this.items[t.id]=t;var e=this._getGroupId(t.data),i=this.groups[e];i&&i.add(t)},s.prototype._updateItem=function(t,e){var i=t.data.group;if(t.setData(e),i!=t.data.group){var s=this.groups[i];s&&s.remove(t);var o=this._getGroupId(t.data),n=this.groups[o];n&&n.add(t)}},s.prototype._removeItem=function(t){t.hide(),delete this.items[t.id];var e=this.selection.indexOf(t.id);-1!=e&&this.selection.splice(e,1),t.parent&&t.parent.remove(t)},s.prototype._constructByEndArray=function(t){for(var e=[],i=0;i<t.length;i++)t[i]instanceof u&&e.push(t[i]);return e},s.prototype._onTouch=function(t){this.touchParams.item=s.itemFromTarget(t)},s.prototype._onDragStart=function(t){if(this.options.editable.updateTime||this.options.editable.updateGroup){var e,i=this.touchParams.item||null,s=this;if(i&&i.selected){var o=t.target.dragLeftItem,n=t.target.dragRightItem;o?(e={item:o,initialX:t.gesture.center.clientX},s.options.editable.updateTime&&(e.start=i.data.start.valueOf()),s.options.editable.updateGroup&&"group"in i.data&&(e.group=i.data.group),this.touchParams.itemProps=[e]):n?(e={item:n,initialX:t.gesture.center.clientX},s.options.editable.updateTime&&(e.end=i.data.end.valueOf()),s.options.editable.updateGroup&&"group"in i.data&&(e.group=i.data.group),this.touchParams.itemProps=[e]):this.touchParams.itemProps=this.getSelection().map(function(e){var i=s.items[e],o={item:i,initialX:t.gesture.center.clientX};return s.options.editable.updateTime&&("start"in i.data&&(o.start=i.data.start.valueOf()),"end"in i.data&&(o.end=i.data.end.valueOf())),s.options.editable.updateGroup&&"group"in i.data&&(o.group=i.data.group),o}),t.stopPropagation()}}},s.prototype._onDrag=function(t){if(t.preventDefault(),this.touchParams.itemProps){var e=this,i=this.body.util.snap||null,o=this.body.dom.root.offsetLeft+this.body.domProps.left.width;this.touchParams.itemProps.forEach(function(r){var a={},h=e.body.util.toTime(t.gesture.center.clientX-o),d=e.body.util.toTime(r.initialX-o),l=h-d;if("start"in r){var c=new Date(r.start+l);a.start=i?i(c):c}if("end"in r){var p=new Date(r.end+l);a.end=i?i(p):p}if("group"in r){var u=s.groupFromTarget(t);a.group=u&&u.groupId}var m=n.extend({},r.item.data,a);e.options.onMoving(m,function(t){t&&e._updateItemProps(r.item,t)})}),this.stackDirty=!0,this.body.emitter.emit("change"),t.stopPropagation()}},s.prototype._updateItemProps=function(t,e){"start"in e&&(t.data.start=e.start),"end"in e&&(t.data.end=e.end),"group"in e&&t.data.group!=e.group&&this._moveToGroup(t,e.group)},s.prototype._moveToGroup=function(t,e){var i=this.groups[e];if(i&&i.groupId!=t.data.group){var s=t.parent;s.remove(t),s.order(),i.add(t),i.order(),t.data.group=i.groupId}},s.prototype._onDragEnd=function(t){if(t.preventDefault(),this.touchParams.itemProps){var e=[],i=this,s=this.itemsData.getDataSet(),o=this.touchParams.itemProps;this.touchParams.itemProps=null,o.forEach(function(t){var o=t.item.id,r=i.itemsData.get(o,i.itemOptions),a=!1;"start"in t.item.data&&(a=t.start!=t.item.data.start.valueOf(),r.start=n.convert(t.item.data.start,s._options.type&&s._options.type.start||"Date")),"end"in t.item.data&&(a=a||t.end!=t.item.data.end.valueOf(),r.end=n.convert(t.item.data.end,s._options.type&&s._options.type.end||"Date")),"group"in t.item.data&&(a=a||t.group!=t.item.data.group,r.group=t.item.data.group),a&&i.options.onMove(r,function(n){n?(n[s._fieldId]=o,e.push(n)):(i._updateItemProps(t.item,t),i.stackDirty=!0,i.body.emitter.emit("change"))})}),e.length&&s.update(e),t.stopPropagation()}},s.prototype._onSelectItem=function(t){if(this.options.selectable){var e=t.gesture.srcEvent&&t.gesture.srcEvent.ctrlKey,i=t.gesture.srcEvent&&t.gesture.srcEvent.shiftKey;if(e||i)return void this._onMultiSelectItem(t);var o=this.getSelection(),n=s.itemFromTarget(t),r=n?[n.id]:[];this.setSelection(r);var a=this.getSelection();(a.length>0||o.length>0)&&this.body.emitter.emit("select",{items:a})}},s.prototype._onAddItem=function(t){if(this.options.selectable&&this.options.editable.add){var e=this,i=this.body.util.snap||null,o=s.itemFromTarget(t);if(o){var r=e.itemsData.get(o.id);this.options.onUpdate(r,function(t){t&&e.itemsData.getDataSet().update(t)})}else{var a=n.getAbsoluteLeft(this.dom.frame),h=t.gesture.center.pageX-a,d=this.body.util.toTime(h),l={start:i?i(d):d,content:"new item"};if("range"===this.options.type){var c=this.body.util.toTime(h+this.props.width/5);l.end=i?i(c):c}l[this.itemsData._fieldId]=n.randomUUID();var p=s.groupFromTarget(t);p&&(l.group=p.groupId),this.options.onAdd(l,function(t){t&&e.itemsData.getDataSet().add(t)})}}},s.prototype._onMultiSelectItem=function(t){if(this.options.selectable){var e,i=s.itemFromTarget(t);if(i){e=this.getSelection();var o=t.gesture.touches[0]&&t.gesture.touches[0].shiftKey||!1;if(o){e.push(i.id);var n=s._getItemRange(this.itemsData.get(e,this.itemOptions));e=[];for(var r in this.items)if(this.items.hasOwnProperty(r)){var a=this.items[r],h=a.data.start,d=void 0!==a.data.end?a.data.end:h;h>=n.min&&d<=n.max&&e.push(a.id)}}else{var l=e.indexOf(i.id);-1==l?e.push(i.id):e.splice(l,1)}this.setSelection(e),this.body.emitter.emit("select",{items:this.getSelection()})}}},s._getItemRange=function(t){var e=null,i=null;return t.forEach(function(t){(null==i||t.start<i)&&(i=t.start),void 0!=t.end?(null==e||t.end>e)&&(e=t.end):(null==e||t.start>e)&&(e=t.start)}),{min:i,max:e}},s.itemFromTarget=function(t){for(var e=t.target;e;){if(e.hasOwnProperty("timeline-item"))return e["timeline-item"];e=e.parentNode}return null},s.groupFromTarget=function(t){for(var e=t.target;e;){if(e.hasOwnProperty("timeline-group"))return e["timeline-group"];e=e.parentNode}return null},s.itemSetFromTarget=function(t){for(var e=t.target;e;){if(e.hasOwnProperty("timeline-itemset"))return e["timeline-itemset"];e=e.parentNode}return null},t.exports=s},function(t,e,i){function s(t,e,i,s){this.body=t,this.defaultOptions={enabled:!0,icons:!0,iconSize:20,iconSpacing:6,left:{visible:!0,position:"top-left"},right:{visible:!0,position:"top-left"}},this.side=i,this.options=o.extend({},this.defaultOptions),this.linegraphOptions=s,this.svgElements={},this.dom={},this.groups={},this.amountOfGroups=0,this._create(),this.setOptions(e)}var o=i(1),n=i(2),r=i(25);s.prototype=new r,s.prototype.clear=function(){this.groups={},this.amountOfGroups=0},s.prototype.addGroup=function(t,e){this.groups.hasOwnProperty(t)||(this.groups[t]=e),this.amountOfGroups+=1
},s.prototype.updateGroup=function(t,e){this.groups[t]=e},s.prototype.removeGroup=function(t){this.groups.hasOwnProperty(t)&&(delete this.groups[t],this.amountOfGroups-=1)},s.prototype._create=function(){this.dom.frame=document.createElement("div"),this.dom.frame.className="legend",this.dom.frame.style.position="absolute",this.dom.frame.style.top="10px",this.dom.frame.style.display="block",this.dom.textArea=document.createElement("div"),this.dom.textArea.className="legendText",this.dom.textArea.style.position="relative",this.dom.textArea.style.top="0px",this.svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),this.svg.style.position="absolute",this.svg.style.top="0px",this.svg.style.width=this.options.iconSize+5+"px",this.svg.style.height="100%",this.dom.frame.appendChild(this.svg),this.dom.frame.appendChild(this.dom.textArea)},s.prototype.hide=function(){this.dom.frame.parentNode&&this.dom.frame.parentNode.removeChild(this.dom.frame)},s.prototype.show=function(){this.dom.frame.parentNode||this.body.dom.center.appendChild(this.dom.frame)},s.prototype.setOptions=function(t){var e=["enabled","orientation","icons","left","right"];o.selectiveDeepExtend(e,this.options,t)},s.prototype.redraw=function(){var t=0;for(var e in this.groups)this.groups.hasOwnProperty(e)&&(1!=this.groups[e].visible||void 0!==this.linegraphOptions.visibility[e]&&1!=this.linegraphOptions.visibility[e]||t++);if(0==this.options[this.side].visible||0==this.amountOfGroups||0==this.options.enabled||0==t)this.hide();else{if(this.show(),"top-left"==this.options[this.side].position||"bottom-left"==this.options[this.side].position?(this.dom.frame.style.left="4px",this.dom.frame.style.textAlign="left",this.dom.textArea.style.textAlign="left",this.dom.textArea.style.left=this.options.iconSize+15+"px",this.dom.textArea.style.right="",this.svg.style.left="0px",this.svg.style.right=""):(this.dom.frame.style.right="4px",this.dom.frame.style.textAlign="right",this.dom.textArea.style.textAlign="right",this.dom.textArea.style.right=this.options.iconSize+15+"px",this.dom.textArea.style.left="",this.svg.style.right="0px",this.svg.style.left=""),"top-left"==this.options[this.side].position||"top-right"==this.options[this.side].position)this.dom.frame.style.top=4-Number(this.body.dom.center.style.top.replace("px",""))+"px",this.dom.frame.style.bottom="";else{var i=this.body.domProps.center.height-this.body.domProps.centerContainer.height;this.dom.frame.style.bottom=4+i+Number(this.body.dom.center.style.top.replace("px",""))+"px",this.dom.frame.style.top=""}0==this.options.icons?(this.dom.frame.style.width=this.dom.textArea.offsetWidth+10+"px",this.dom.textArea.style.right="",this.dom.textArea.style.left="",this.svg.style.width="0px"):(this.dom.frame.style.width=this.options.iconSize+15+this.dom.textArea.offsetWidth+10+"px",this.drawLegendIcons());var s="";for(var e in this.groups)this.groups.hasOwnProperty(e)&&(1!=this.groups[e].visible||void 0!==this.linegraphOptions.visibility[e]&&1!=this.linegraphOptions.visibility[e]||(s+=this.groups[e].content+"<br />"));this.dom.textArea.innerHTML=s,this.dom.textArea.style.lineHeight=.75*this.options.iconSize+this.options.iconSpacing+"px"}},s.prototype.drawLegendIcons=function(){if(this.dom.frame.parentNode){n.prepareElements(this.svgElements);var t=window.getComputedStyle(this.dom.frame).paddingTop,e=Number(t.replace("px","")),i=e,s=this.options.iconSize,o=.75*this.options.iconSize,r=e+.5*o+3;this.svg.style.width=s+5+e+"px";for(var a in this.groups)this.groups.hasOwnProperty(a)&&(1!=this.groups[a].visible||void 0!==this.linegraphOptions.visibility[a]&&1!=this.linegraphOptions.visibility[a]||(this.groups[a].drawIcon(i,r,this.svgElements,this.svg,s,o),r+=o+this.options.iconSpacing));n.cleanupElements(this.svgElements)}},t.exports=s},function(t,e,i){function s(t,e){this.id=o.randomUUID(),this.body=t,this.defaultOptions={yAxisOrientation:"left",defaultGroup:"default",sort:!0,sampling:!0,graphHeight:"400px",shaded:{enabled:!1,orientation:"bottom"},style:"line",barChart:{width:50,handleOverlap:"overlap",align:"center"},catmullRom:{enabled:!0,parametrization:"centripetal",alpha:.5},drawPoints:{enabled:!0,size:6,style:"square"},dataAxis:{showMinorLabels:!0,showMajorLabels:!0,icons:!1,width:"40px",visible:!0,alignZeros:!0,customRange:{left:{min:void 0,max:void 0},right:{min:void 0,max:void 0}}},legend:{enabled:!1,icons:!0,left:{visible:!0,position:"top-left"},right:{visible:!0,position:"top-right"}},groups:{visibility:{}}},this.options=o.extend({},this.defaultOptions),this.dom={},this.props={},this.hammer=null,this.groups={},this.abortedGraphUpdate=!1,this.updateSVGheight=!1,this.updateSVGheightOnResize=!1;var i=this;this.itemsData=null,this.groupsData=null,this.itemListeners={add:function(t,e){i._onAdd(e.items)},update:function(t,e){i._onUpdate(e.items)},remove:function(t,e){i._onRemove(e.items)}},this.groupListeners={add:function(t,e){i._onAddGroups(e.items)},update:function(t,e){i._onUpdateGroups(e.items)},remove:function(t,e){i._onRemoveGroups(e.items)}},this.items={},this.selection=[],this.lastStart=this.body.range.start,this.touchParams={},this.svgElements={},this.setOptions(e),this.groupsUsingDefaultStyles=[0],this.COUNTER=0,this.body.emitter.on("rangechanged",function(){i.lastStart=i.body.range.start,i.svg.style.left=o.option.asSize(-i.props.width),i.redraw.call(i,!0)}),this._create(),this.framework={svg:this.svg,svgElements:this.svgElements,options:this.options,groups:this.groups},this.body.emitter.emit("change")}var o=i(1),n=i(2),r=i(3),a=i(4),h=i(25),d=i(28),l=i(29),c=i(33),p=i(50),u="__ungrouped__";s.prototype=new h,s.prototype._create=function(){var t=document.createElement("div");t.className="LineGraph",this.dom.frame=t,this.svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),this.svg.style.position="relative",this.svg.style.height=(""+this.options.graphHeight).replace("px","")+"px",this.svg.style.display="block",t.appendChild(this.svg),this.options.dataAxis.orientation="left",this.yAxisLeft=new d(this.body,this.options.dataAxis,this.svg,this.options.groups),this.options.dataAxis.orientation="right",this.yAxisRight=new d(this.body,this.options.dataAxis,this.svg,this.options.groups),delete this.options.dataAxis.orientation,this.legendLeft=new c(this.body,this.options.legend,"left",this.options.groups),this.legendRight=new c(this.body,this.options.legend,"right",this.options.groups),this.show()},s.prototype.setOptions=function(t){if(t){var e=["sampling","defaultGroup","height","graphHeight","yAxisOrientation","style","barChart","dataAxis","sort","groups"];void 0===t.graphHeight&&void 0!==t.height&&void 0!==this.body.domProps.centerContainer.height?(this.updateSVGheight=!0,this.updateSVGheightOnResize=!0):void 0!==this.body.domProps.centerContainer.height&&void 0!==t.graphHeight&&parseInt((t.graphHeight+"").replace("px",""))<this.body.domProps.centerContainer.height&&(this.updateSVGheight=!0),o.selectiveDeepExtend(e,this.options,t),o.mergeOptions(this.options,t,"catmullRom"),o.mergeOptions(this.options,t,"drawPoints"),o.mergeOptions(this.options,t,"shaded"),o.mergeOptions(this.options,t,"legend"),t.catmullRom&&"object"==typeof t.catmullRom&&t.catmullRom.parametrization&&("uniform"==t.catmullRom.parametrization?this.options.catmullRom.alpha=0:"chordal"==t.catmullRom.parametrization?this.options.catmullRom.alpha=1:(this.options.catmullRom.parametrization="centripetal",this.options.catmullRom.alpha=.5)),this.yAxisLeft&&void 0!==t.dataAxis&&(this.yAxisLeft.setOptions(this.options.dataAxis),this.yAxisRight.setOptions(this.options.dataAxis)),this.legendLeft&&void 0!==t.legend&&(this.legendLeft.setOptions(this.options.legend),this.legendRight.setOptions(this.options.legend)),this.groups.hasOwnProperty(u)&&this.groups[u].setOptions(t)}this.dom.frame&&this.redraw(!0)},s.prototype.hide=function(){this.dom.frame.parentNode&&this.dom.frame.parentNode.removeChild(this.dom.frame)},s.prototype.show=function(){this.dom.frame.parentNode||this.body.dom.center.appendChild(this.dom.frame)},s.prototype.setItems=function(t){var e,i=this,s=this.itemsData;if(t){if(!(t instanceof r||t instanceof a))throw new TypeError("Data must be an instance of DataSet or DataView");this.itemsData=t}else this.itemsData=null;if(s&&(o.forEach(this.itemListeners,function(t,e){s.off(e,t)}),e=s.getIds(),this._onRemove(e)),this.itemsData){var n=this.id;o.forEach(this.itemListeners,function(t,e){i.itemsData.on(e,t,n)}),e=this.itemsData.getIds(),this._onAdd(e)}this._updateUngrouped(),this.redraw(!0)},s.prototype.setGroups=function(t){var e,i=this;if(this.groupsData&&(o.forEach(this.groupListeners,function(t,e){i.groupsData.unsubscribe(e,t)}),e=this.groupsData.getIds(),this.groupsData=null,this._onRemoveGroups(e)),t){if(!(t instanceof r||t instanceof a))throw new TypeError("Data must be an instance of DataSet or DataView");this.groupsData=t}else this.groupsData=null;if(this.groupsData){var s=this.id;o.forEach(this.groupListeners,function(t,e){i.groupsData.on(e,t,s)}),e=this.groupsData.getIds(),this._onAddGroups(e)}this._onUpdate()},s.prototype._onUpdate=function(){this._updateUngrouped(),this._updateAllGroupData(),this.redraw(!0)},s.prototype._onAdd=function(t){this._onUpdate(t)},s.prototype._onRemove=function(t){this._onUpdate(t)},s.prototype._onUpdateGroups=function(t){for(var e=0;e<t.length;e++){var i=this.groupsData.get(t[e]);this._updateGroup(i,t[e])}this.redraw(!0)},s.prototype._onAddGroups=function(t){this._onUpdateGroups(t)},s.prototype._onRemoveGroups=function(t){for(var e=0;e<t.length;e++)this.groups.hasOwnProperty(t[e])&&("right"==this.groups[t[e]].options.yAxisOrientation?(this.yAxisRight.removeGroup(t[e]),this.legendRight.removeGroup(t[e]),this.legendRight.redraw()):(this.yAxisLeft.removeGroup(t[e]),this.legendLeft.removeGroup(t[e]),this.legendLeft.redraw()),delete this.groups[t[e]]);this._updateUngrouped(),this.redraw(!0)},s.prototype._updateGroup=function(t,e){this.groups.hasOwnProperty(e)?(this.groups[e].update(t),"right"==this.groups[e].options.yAxisOrientation?(this.yAxisRight.updateGroup(e,this.groups[e]),this.legendRight.updateGroup(e,this.groups[e])):(this.yAxisLeft.updateGroup(e,this.groups[e]),this.legendLeft.updateGroup(e,this.groups[e]))):(this.groups[e]=new l(t,e,this.options,this.groupsUsingDefaultStyles),"right"==this.groups[e].options.yAxisOrientation?(this.yAxisRight.addGroup(e,this.groups[e]),this.legendRight.addGroup(e,this.groups[e])):(this.yAxisLeft.addGroup(e,this.groups[e]),this.legendLeft.addGroup(e,this.groups[e]))),this.legendLeft.redraw(),this.legendRight.redraw()},s.prototype._updateAllGroupData=function(){if(null!=this.itemsData){var t,e={};for(t in this.groups)this.groups.hasOwnProperty(t)&&(e[t]=[]);for(var i in this.itemsData._data)if(this.itemsData._data.hasOwnProperty(i)){var s=this.itemsData._data[i];if(void 0===e[s.group])throw new Error("Cannot find referenced group. Possible reason: items added before groups? Groups need to be added before items, as items refer to groups.");s.x=o.convert(s.x,"Date"),e[s.group].push(s)}for(t in this.groups)this.groups.hasOwnProperty(t)&&this.groups[t].setItems(e[t])}},s.prototype._updateUngrouped=function(){if(this.itemsData&&null!=this.itemsData){var t=0;for(var e in this.itemsData._data)if(this.itemsData._data.hasOwnProperty(e)){var i=this.itemsData._data[e];void 0!=i&&(i.hasOwnProperty("group")?void 0===i.group&&(i.group=u):i.group=u,t=i.group==u?t+1:t)}if(0==t)delete this.groups[u],this.legendLeft.removeGroup(u),this.legendRight.removeGroup(u),this.yAxisLeft.removeGroup(u),this.yAxisRight.removeGroup(u);else{var s={id:u,content:this.options.defaultGroup};this._updateGroup(s,u)}}else delete this.groups[u],this.legendLeft.removeGroup(u),this.legendRight.removeGroup(u),this.yAxisLeft.removeGroup(u),this.yAxisRight.removeGroup(u);this.legendLeft.redraw(),this.legendRight.redraw()},s.prototype.redraw=function(t){var e=!1;this.props.width=this.dom.frame.offsetWidth,this.props.height=this.body.domProps.centerContainer.height,void 0===this.lastWidth&&this.props.width&&(t=!0),e=this._isResized()||e;var i=this.body.range.end-this.body.range.start,s=i!=this.lastVisibleInterval;if(this.lastVisibleInterval=i,1==e&&(this.svg.style.width=o.option.asSize(3*this.props.width),this.svg.style.left=o.option.asSize(-this.props.width),(-1!=(this.options.height+"").indexOf("%")||1==this.updateSVGheightOnResize)&&(this.updateSVGheight=!0)),1==this.updateSVGheight?(this.options.graphHeight!=this.body.domProps.centerContainer.height+"px"&&(this.options.graphHeight=this.body.domProps.centerContainer.height+"px",this.svg.style.height=this.body.domProps.centerContainer.height+"px"),this.updateSVGheight=!1):this.svg.style.height=(""+this.options.graphHeight).replace("px","")+"px",1==e||1==s||1==this.abortedGraphUpdate||1==t)e=this._updateGraph()||e;else if(0!=this.lastStart){var n=this.body.range.start-this.lastStart,r=this.body.range.end-this.body.range.start;if(0!=this.props.width){var a=this.props.width/r,h=n*a;this.svg.style.left=-this.props.width-h+"px"}}return this.legendLeft.redraw(),this.legendRight.redraw(),e},s.prototype._updateGraph=function(){if(n.prepareElements(this.svgElements),0!=this.props.width&&null!=this.itemsData){var t,e,i={},s={},o={},r=!1,a=[];for(var h in this.groups)this.groups.hasOwnProperty(h)&&(t=this.groups[h],1!=t.visible||void 0!==this.options.groups.visibility[h]&&1!=this.options.groups.visibility[h]||a.push(h));if(a.length>0){var d=this.body.util.toGlobalTime(-this.body.domProps.root.width),l=this.body.util.toGlobalTime(2*this.body.domProps.root.width),c={};for(this._getRelevantData(a,c,d,l),this._applySampling(a,c),e=0;e<a.length;e++)i[a[e]]=this._convertXcoordinates(c[a[e]]);this._getYRanges(a,i,o),r=this._updateYAxis(a,o);var u=5;if(1==r&&this.COUNTER<u)return n.cleanupElements(this.svgElements),this.abortedGraphUpdate=!0,this.COUNTER++,this.body.emitter.emit("change"),!0;for(this.COUNTER>u&&console.log("WARNING: there may be an infinite loop in the _updateGraph emitter cycle."),this.COUNTER=0,this.abortedGraphUpdate=!1,e=0;e<a.length;e++)t=this.groups[a[e]],s[a[e]]=this._convertYcoordinates(c[a[e]],t);for(e=0;e<a.length;e++)t=this.groups[a[e]],"bar"!=t.options.style&&t.draw(s[a[e]],t,this.framework);p.draw(a,s,this.framework)}}return n.cleanupElements(this.svgElements),!1},s.prototype._getRelevantData=function(t,e,i,s){var n,r,a,h;if(t.length>0)for(r=0;r<t.length;r++){n=this.groups[t[r]],e[t[r]]=[];var d=e[t[r]];if(1==n.options.sort){var l=Math.max(0,o.binarySearchValue(n.itemsData,i,"x","before"));for(a=l;a<n.itemsData.length;a++)if(h=n.itemsData[a],void 0!==h){if(h.x>s){d.push(h);break}d.push(h)}}else for(a=0;a<n.itemsData.length;a++)h=n.itemsData[a],void 0!==h&&h.x>i&&h.x<s&&d.push(h)}},s.prototype._applySampling=function(t,e){var i;if(t.length>0)for(var s=0;s<t.length;s++)if(i=this.groups[t[s]],1==i.options.sampling){var o=e[t[s]];if(o.length>0){var n=1,r=o.length,a=this.body.util.toGlobalScreen(o[o.length-1].x)-this.body.util.toGlobalScreen(o[0].x),h=r/a;n=Math.min(Math.ceil(.2*r),Math.max(1,Math.round(h)));for(var d=[],l=0;r>l;l+=n)d.push(o[l]);e[t[s]]=d}}},s.prototype._getYRanges=function(t,e,i){var s,o,n,r,a=[],h=[];if(t.length>0){for(n=0;n<t.length;n++)s=e[t[n]],r=this.groups[t[n]].options,s.length>0&&(o=this.groups[t[n]],"stack"==r.barChart.handleOverlap&&"bar"==r.style?"left"==r.yAxisOrientation?a=a.concat(o.getYRange(s)):h=h.concat(o.getYRange(s)):i[t[n]]=o.getYRange(s,t[n]));p.getStackedBarYRange(a,i,t,"__barchartLeft","left"),p.getStackedBarYRange(h,i,t,"__barchartRight","right")}},s.prototype._updateYAxis=function(t,e){var i,s,o=!1,n=!1,r=!1,a=1e9,h=1e9,d=-1e9,l=-1e9;if(t.length>0){for(var c=0;c<t.length;c++){var p=this.groups[t[c]];p&&"right"!=p.options.yAxisOrientation?(n=!0,a=0,d=0):p&&p.options.yAxisOrientation&&(r=!0,h=0,l=0)}for(var c=0;c<t.length;c++)e.hasOwnProperty(t[c])&&e[t[c]].ignore!==!0&&(i=e[t[c]].min,s=e[t[c]].max,"right"!=e[t[c]].yAxisOrientation?(n=!0,a=a>i?i:a,d=s>d?s:d):(r=!0,h=h>i?i:h,l=s>l?s:l));1==n&&this.yAxisLeft.setRange(a,d),1==r&&this.yAxisRight.setRange(h,l)}return o=this._toggleAxisVisiblity(n,this.yAxisLeft)||o,o=this._toggleAxisVisiblity(r,this.yAxisRight)||o,1==r&&1==n?(this.yAxisLeft.drawIcons=!0,this.yAxisRight.drawIcons=!0):(this.yAxisLeft.drawIcons=!1,this.yAxisRight.drawIcons=!1),this.yAxisRight.master=!n,0==this.yAxisRight.master?(this.yAxisLeft.lineOffset=1==r?this.yAxisRight.width:0,o=this.yAxisLeft.redraw()||o,this.yAxisRight.stepPixelsForced=this.yAxisLeft.stepPixels,this.yAxisRight.zeroCrossing=this.yAxisLeft.zeroCrossing,o=this.yAxisRight.redraw()||o):o=this.yAxisRight.redraw()||o,-1!=t.indexOf("__barchartLeft")&&t.splice(t.indexOf("__barchartLeft"),1),-1!=t.indexOf("__barchartRight")&&t.splice(t.indexOf("__barchartRight"),1),o},s.prototype._toggleAxisVisiblity=function(t,e){var i=!1;return 0==t?e.dom.frame.parentNode&&0==e.hidden&&(e.hide(),i=!0):e.dom.frame.parentNode||1!=e.hidden||(e.show(),i=!0),i},s.prototype._convertXcoordinates=function(t){for(var e,i,s=[],o=this.body.util.toScreen,n=0;n<t.length;n++)e=o(t[n].x)+this.props.width,i=t[n].y,s.push({x:e,y:i});return s},s.prototype._convertYcoordinates=function(t,e){var i,s,o=[],n=this.body.util.toScreen,r=this.yAxisLeft,a=Number(this.svg.style.height.replace("px",""));"right"==e.options.yAxisOrientation&&(r=this.yAxisRight);for(var h=0;h<t.length;h++)i=n(t[h].x)+this.props.width,s=Math.round(r.convertValue(t[h].y)),o.push({x:i,y:s});return e.setZeroPosition(Math.min(a,r.convertValue(0))),o},t.exports=s},function(t,e,i){function s(t,e){this.dom={foreground:null,lines:[],majorTexts:[],minorTexts:[],redundant:{lines:[],majorTexts:[],minorTexts:[]}},this.props={range:{start:0,end:0,minimumStep:0},lineTop:0},this.defaultOptions={orientation:"bottom",showMinorLabels:!0,showMajorLabels:!0,format:null},this.options=o.extend({},this.defaultOptions),this.body=t,this._create(),this.setOptions(e)}var o=i(1),n=i(25),r=i(19),a=i(15),h=i(44);s.prototype=new n,s.prototype.setOptions=function(t){t&&(o.selectiveExtend(["orientation","showMinorLabels","showMajorLabels","hiddenDates","format"],this.options,t),"locale"in t&&("function"==typeof h.locale?h.locale(t.locale):h.lang(t.locale)))},s.prototype._create=function(){this.dom.foreground=document.createElement("div"),this.dom.background=document.createElement("div"),this.dom.foreground.className="timeaxis foreground",this.dom.background.className="timeaxis background"},s.prototype.destroy=function(){this.dom.foreground.parentNode&&this.dom.foreground.parentNode.removeChild(this.dom.foreground),this.dom.background.parentNode&&this.dom.background.parentNode.removeChild(this.dom.background),this.body=null},s.prototype.redraw=function(){var t=this.options,e=this.props,i=this.dom.foreground,s=this.dom.background,o="top"==t.orientation?this.body.dom.top:this.body.dom.bottom,n=i.parentNode!==o;this._calculateCharSize();var r=(this.options.orientation,this.options.showMinorLabels),a=this.options.showMajorLabels;e.minorLabelHeight=r?e.minorCharHeight:0,e.majorLabelHeight=a?e.majorCharHeight:0,e.height=e.minorLabelHeight+e.majorLabelHeight,e.width=i.offsetWidth,e.minorLineHeight=this.body.domProps.root.height-e.majorLabelHeight-("top"==t.orientation?this.body.domProps.bottom.height:this.body.domProps.top.height),e.minorLineWidth=1,e.majorLineHeight=e.minorLineHeight+e.majorLabelHeight,e.majorLineWidth=1;var h=i.nextSibling,d=s.nextSibling;return i.parentNode&&i.parentNode.removeChild(i),s.parentNode&&s.parentNode.removeChild(s),i.style.height=this.props.height+"px",this._repaintLabels(),h?o.insertBefore(i,h):o.appendChild(i),d?this.body.dom.backgroundVertical.insertBefore(s,d):this.body.dom.backgroundVertical.appendChild(s),this._isResized()||n},s.prototype._repaintLabels=function(){var t=this.options.orientation,e=o.convert(this.body.range.start,"Number"),i=o.convert(this.body.range.end,"Number"),s=this.body.util.toTime(7*(this.props.minorCharWidth||10)).valueOf(),n=s-a.getHiddenDurationBefore(this.body.hiddenDates,this.body.range,s);n-=this.body.util.toTime(0).valueOf();var h=new r(new Date(e),new Date(i),n,this.body.hiddenDates);this.options.format&&h.setFormat(this.options.format),this.step=h;var d=this.dom;d.redundant.lines=d.lines,d.redundant.majorTexts=d.majorTexts,d.redundant.minorTexts=d.minorTexts,d.lines=[],d.majorTexts=[],d.minorTexts=[];var l,c,p,u,m=0,f=0,g=0,v=void 0,y=0;for(h.first();h.hasNext()&&1e3>y;)y++,l=h.getCurrent(),c=h.isMajor(),u=h.getClassName(),f=m,m=this.body.util.toScreen(l),g=m-f,p&&(p.style.width=g+"px"),this.options.showMinorLabels&&this._repaintMinorText(m,h.getLabelMinor(),t,u),c&&this.options.showMajorLabels?(m>0&&(void 0==v&&(v=m),this._repaintMajorText(m,h.getLabelMajor(),t,u)),p=this._repaintMajorLine(m,t,u)):p=this._repaintMinorLine(m,t,u),h.next();if(this.options.showMajorLabels){var b=this.body.util.toTime(0),_=h.getLabelMajor(b),x=_.length*(this.props.majorCharWidth||10)+10;(void 0==v||v>x)&&this._repaintMajorText(0,_,t,u)}o.forEach(this.dom.redundant,function(t){for(;t.length;){var e=t.pop();e&&e.parentNode&&e.parentNode.removeChild(e)}})},s.prototype._repaintMinorText=function(t,e,i,s){var o=this.dom.redundant.minorTexts.shift();if(!o){var n=document.createTextNode("");o=document.createElement("div"),o.appendChild(n),this.dom.foreground.appendChild(o)}this.dom.minorTexts.push(o),o.childNodes[0].nodeValue=e,o.style.top="top"==i?this.props.majorLabelHeight+"px":"0",o.style.left=t+"px",o.className="text minor "+s},s.prototype._repaintMajorText=function(t,e,i,s){var o=this.dom.redundant.majorTexts.shift();if(!o){var n=document.createTextNode(e);o=document.createElement("div"),o.appendChild(n),this.dom.foreground.appendChild(o)}this.dom.majorTexts.push(o),o.childNodes[0].nodeValue=e,o.className="text major "+s,o.style.top="top"==i?"0":this.props.minorLabelHeight+"px",o.style.left=t+"px"},s.prototype._repaintMinorLine=function(t,e,i){var s=this.dom.redundant.lines.shift();s||(s=document.createElement("div"),this.dom.background.appendChild(s)),this.dom.lines.push(s);var o=this.props;return s.style.top="top"==e?o.majorLabelHeight+"px":this.body.domProps.top.height+"px",s.style.height=o.minorLineHeight+"px",s.style.left=t-o.minorLineWidth/2+"px",s.className="grid vertical minor "+i,s},s.prototype._repaintMajorLine=function(t,e,i){var s=this.dom.redundant.lines.shift();s||(s=document.createElement("div"),this.dom.background.appendChild(s)),this.dom.lines.push(s);var o=this.props;return s.style.top="top"==e?"0":this.body.domProps.top.height+"px",s.style.left=t-o.majorLineWidth/2+"px",s.style.height=o.majorLineHeight+"px",s.className="grid vertical major "+i,s},s.prototype._calculateCharSize=function(){this.dom.measureCharMinor||(this.dom.measureCharMinor=document.createElement("DIV"),this.dom.measureCharMinor.className="text minor measure",this.dom.measureCharMinor.style.position="absolute",this.dom.measureCharMinor.appendChild(document.createTextNode("0")),this.dom.foreground.appendChild(this.dom.measureCharMinor)),this.props.minorCharHeight=this.dom.measureCharMinor.clientHeight,this.props.minorCharWidth=this.dom.measureCharMinor.clientWidth,this.dom.measureCharMajor||(this.dom.measureCharMajor=document.createElement("DIV"),this.dom.measureCharMajor.className="text major measure",this.dom.measureCharMajor.style.position="absolute",this.dom.measureCharMajor.appendChild(document.createTextNode("0")),this.dom.foreground.appendChild(this.dom.measureCharMajor)),this.props.majorCharHeight=this.dom.measureCharMajor.clientHeight,this.props.majorCharWidth=this.dom.measureCharMajor.clientWidth},s.prototype.snap=function(t){return this.step.snap(t)},t.exports=s},function(t,e,i){function s(t,e,i){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");this._determineBrowserMethod(),this._initializeMixinLoaders(),this.containerElement=t,this.renderRefreshRate=60,this.renderTimestep=1e3/this.renderRefreshRate,this.renderTime=0,this.physicsTime=0,this.runDoubleSpeed=!1,this.physicsDiscreteStepsize=.5,this.initializing=!0,this.triggerFunctions={add:null,edit:null,editEdge:null,connect:null,del:null},this.defaultOptions={nodes:{mass:1,radiusMin:10,radiusMax:30,radius:10,shape:"ellipse",image:void 0,widthMin:16,widthMax:64,fontColor:"black",fontSize:14,fontFace:"verdana",fontFill:void 0,fontStrokeWidth:0,fontStrokeColor:"white",level:-1,color:{border:"#2B7CE9",background:"#97C2FC",highlight:{border:"#2B7CE9",background:"#D2E5FF"},hover:{border:"#2B7CE9",background:"#D2E5FF"}},group:void 0,borderWidth:1,borderWidthSelected:void 0},edges:{widthMin:1,widthMax:15,width:1,widthSelectionMultiplier:2,hoverWidth:1.5,style:"line",color:{color:"#848484",highlight:"#848484",hover:"#848484"},fontColor:"#343434",fontSize:14,fontFace:"arial",fontFill:"white",fontStrokeWidth:0,fontStrokeColor:"white",labelAlignment:"horizontal",arrowScaleFactor:1,dash:{length:10,gap:5,altLength:void 0},inheritColor:"from"},configurePhysics:!1,physics:{barnesHut:{enabled:!0,thetaInverted:2,gravitationalConstant:-2e3,centralGravity:.3,springLength:95,springConstant:.04,damping:.09},repulsion:{centralGravity:0,springLength:200,springConstant:.05,nodeDistance:100,damping:.09},hierarchicalRepulsion:{enabled:!1,centralGravity:0,springLength:100,springConstant:.01,nodeDistance:150,damping:.09},damping:null,centralGravity:null,springLength:null,springConstant:null},clustering:{enabled:!1,initialMaxNodes:100,clusterThreshold:500,reduceToNodes:300,chainThreshold:.4,clusterEdgeThreshold:20,sectorThreshold:100,screenSizeThreshold:.2,fontSizeMultiplier:4,maxFontSize:1e3,forceAmplification:.1,distanceAmplification:.1,edgeGrowth:20,nodeScaling:{width:1,height:1,radius:1},maxNodeSizeIncrements:600,activeAreaBoxSize:80,clusterLevelDifference:2},navigation:{enabled:!1},keyboard:{enabled:!1,speed:{x:10,y:10,zoom:.02}},dataManipulation:{enabled:!1,initiallyVisible:!1},hierarchicalLayout:{enabled:!1,levelSeparation:150,nodeSpacing:100,direction:"UD",layout:"hubsize"},freezeForStabilization:!1,smoothCurves:{enabled:!0,dynamic:!0,type:"continuous",roundness:.5},maxVelocity:30,minVelocity:.1,stabilize:!0,stabilizationIterations:1e3,zoomExtentOnStabilize:!0,locale:"en",locales:_,tooltip:{delay:300,fontColor:"black",fontSize:14,fontFace:"verdana",color:{border:"#666",background:"#FFFFC6"}},dragNetwork:!0,dragNodes:!0,zoomable:!0,hover:!1,hideEdgesOnDrag:!1,hideNodesOnDrag:!1,width:"100%",height:"100%",selectable:!0},this.constants=a.extend({},this.defaultOptions),this.pixelRatio=1,this.hoverObj={nodes:{},edges:{}},this.controlNodesActive=!1,this.navigationHammers={existing:[],_new:[]},this.animationSpeed=1/this.renderRefreshRate,this.animationEasingFunction="easeInOutQuint",this.animating=!1,this.easingTime=0,this.sourceScale=0,this.targetScale=0,this.sourceTranslation=0,this.targetTranslation=0,this.lockedOnNodeId=null,this.lockedOnNodeOffset=null,this.touchTime=0;var o=this;this.groups=new u,this.images=new m,this.images.setOnloadCallback(function(){o._redraw()}),this.xIncrement=0,this.yIncrement=0,this.zoomIncrement=0,this._loadPhysicsSystem(),this._create(),this._loadSectorSystem(),this._loadClusterSystem(),this._loadSelectionSystem(),this._loadHierarchySystem(),this._setTranslation(this.frame.clientWidth/2,this.frame.clientHeight/2),this._setScale(1),this.setOptions(i),this.freezeSimulation=!1,this.cachedFunctions={},this.startedStabilization=!1,this.stabilized=!1,this.stabilizationIterations=null,this.draggingNodes=!1,this.calculationNodes={},this.calculationNodeIndices=[],this.nodeIndices=[],this.nodes={},this.edges={},this.canvasTopLeft={x:0,y:0},this.canvasBottomRight={x:0,y:0},this.pointerPosition={x:0,y:0},this.areaCenter={},this.scale=1,this.previousScale=this.scale,this.nodesData=null,this.edgesData=null,this.nodesListeners={add:function(t,e){o._addNodes(e.items),o.start()},update:function(t,e){o._updateNodes(e.items,e.data),o.start()},remove:function(t,e){o._removeNodes(e.items),o.start()}},this.edgesListeners={add:function(t,e){o._addEdges(e.items),o.start()},update:function(t,e){o._updateEdges(e.items),o.start()},remove:function(t,e){o._removeEdges(e.items),o.start()}},this.moving=!0,this.timer=void 0,this.setData(e,this.constants.clustering.enabled||this.constants.hierarchicalLayout.enabled),this.initializing=!1,1==this.constants.hierarchicalLayout.enabled?this._setupHierarchicalLayout():0==this.constants.stabilize&&this.zoomExtent(void 0,!0,this.constants.clustering.enabled),this.constants.clustering.enabled&&this.startWithClustering()}var o=i(56),n=i(45),r=i(57),a=i(1),h=i(47),d=i(3),l=i(4),c=i(42),p=i(43),u=i(38),m=i(39),f=i(40),g=i(37),v=i(41),y=i(52),b=i(53),_=i(54);i(55),o(s.prototype),s.prototype._determineBrowserMethod=function(){var t=navigator.userAgent.toLowerCase();this.requiresTimeout=!1,-1!=t.indexOf("msie 9.0")?this.requiresTimeout=!0:-1!=t.indexOf("safari")&&t.indexOf("chrome")<=-1&&(this.requiresTimeout=!0)},s.prototype._getScriptPath=function(){for(var t=document.getElementsByTagName("script"),e=0;e<t.length;e++){var i=t[e].src,s=i&&/\/?vis(.min)?\.js$/.exec(i);if(s)return i.substring(0,i.length-s[0].length)}return null},s.prototype._getRange=function(){var t,e=1e9,i=-1e9,s=1e9,o=-1e9;for(var n in this.nodes)this.nodes.hasOwnProperty(n)&&(t=this.nodes[n],s>t.boundingBox.left&&(s=t.boundingBox.left),o<t.boundingBox.right&&(o=t.boundingBox.right),e>t.boundingBox.bottom&&(e=t.boundingBox.top),i<t.boundingBox.top&&(i=t.boundingBox.bottom));return 1e9==s&&-1e9==o&&1e9==e&&-1e9==i&&(e=0,i=0,s=0,o=0),{minX:s,maxX:o,minY:e,maxY:i}},s.prototype._findCenter=function(t){return{x:.5*(t.maxX+t.minX),y:.5*(t.maxY+t.minY)}},s.prototype.zoomExtent=function(t,e,i){this._redraw(!0),void 0===e&&(e=!1),void 0===i&&(i=!1),void 0===t&&(t=!1);var s,o=this._getRange();if(1==e){var n=this.nodeIndices.length;s=1==this.constants.smoothCurves?1==this.constants.clustering.enabled&&n>=this.constants.clustering.initialMaxNodes?49.07548/(n+142.05338)+91444e-8:12.662/(n+7.4147)+.0964822:1==this.constants.clustering.enabled&&n>=this.constants.clustering.initialMaxNodes?77.5271985/(n+187.266146)+476710517e-13:30.5062972/(n+19.93597763)+.08413486;var r=Math.min(this.frame.canvas.clientWidth/600,this.frame.canvas.clientHeight/600);s*=r}else{var a=1.1*Math.abs(o.maxX-o.minX),h=1.1*Math.abs(o.maxY-o.minY),d=this.frame.canvas.clientWidth/a,l=this.frame.canvas.clientHeight/h;s=l>=d?d:l}s>1&&(s=1);var c=this._findCenter(o);if(0==i){var p={position:c,scale:s,animation:t};this.moveTo(p),this.moving=!0,this.start()}else c.x*=s,c.y*=s,c.x-=.5*this.frame.canvas.clientWidth,c.y-=.5*this.frame.canvas.clientHeight,this._setScale(s),this._setTranslation(-c.x,-c.y)},s.prototype._updateNodeIndexList=function(){this._clearNodeIndexList();for(var t in this.nodes)this.nodes.hasOwnProperty(t)&&this.nodeIndices.push(t)},s.prototype.setData=function(t,e){if(void 0===e&&(e=!1),this.initializing=!0,t&&t.dot&&(t.nodes||t.edges))throw new SyntaxError('Data must contain either parameter "dot" or  parameter pair "nodes" and "edges", but not both.');if(1==this.constants.dataManipulation.enabled&&this._createManipulatorBar(),this.setOptions(t&&t.options),t&&t.dot){if(t&&t.dot){var i=c.DOTToGraph(t.dot);return void this.setData(i)}}else if(t&&t.gephi){if(t&&t.gephi){var s=p.parseGephi(t.gephi);return void this.setData(s)}}else this._setNodes(t&&t.nodes),this._setEdges(t&&t.edges);this._putDataInSector(),0==e&&(1==this.constants.hierarchicalLayout.enabled?(this._resetLevels(),this._setupHierarchicalLayout()):this.constants.stabilize&&this._stabilize(),this.start()),this.initializing=!1},s.prototype.setOptions=function(t){if(t){var e,i=["nodes","edges","smoothCurves","hierarchicalLayout","clustering","navigation","keyboard","dataManipulation","onAdd","onEdit","onEditEdge","onConnect","onDelete","clickToUse"];if(a.selectiveNotDeepExtend(i,this.constants,t),a.selectiveNotDeepExtend(["color"],this.constants.nodes,t.nodes),a.selectiveNotDeepExtend(["color","length"],this.constants.edges,t.edges),t.physics&&(a.mergeOptions(this.constants.physics,t.physics,"barnesHut"),a.mergeOptions(this.constants.physics,t.physics,"repulsion"),t.physics.hierarchicalRepulsion)){this.constants.hierarchicalLayout.enabled=!0,this.constants.physics.hierarchicalRepulsion.enabled=!0,this.constants.physics.barnesHut.enabled=!1;
for(e in t.physics.hierarchicalRepulsion)t.physics.hierarchicalRepulsion.hasOwnProperty(e)&&(this.constants.physics.hierarchicalRepulsion[e]=t.physics.hierarchicalRepulsion[e])}if(t.onAdd&&(this.triggerFunctions.add=t.onAdd),t.onEdit&&(this.triggerFunctions.edit=t.onEdit),t.onEditEdge&&(this.triggerFunctions.editEdge=t.onEditEdge),t.onConnect&&(this.triggerFunctions.connect=t.onConnect),t.onDelete&&(this.triggerFunctions.del=t.onDelete),a.mergeOptions(this.constants,t,"smoothCurves"),a.mergeOptions(this.constants,t,"hierarchicalLayout"),a.mergeOptions(this.constants,t,"clustering"),a.mergeOptions(this.constants,t,"navigation"),a.mergeOptions(this.constants,t,"keyboard"),a.mergeOptions(this.constants,t,"dataManipulation"),t.dataManipulation&&(this.editMode=this.constants.dataManipulation.initiallyVisible),t.edges&&(void 0!==t.edges.color&&(a.isString(t.edges.color)?(this.constants.edges.color={},this.constants.edges.color.color=t.edges.color,this.constants.edges.color.highlight=t.edges.color,this.constants.edges.color.hover=t.edges.color):(void 0!==t.edges.color.color&&(this.constants.edges.color.color=t.edges.color.color),void 0!==t.edges.color.highlight&&(this.constants.edges.color.highlight=t.edges.color.highlight),void 0!==t.edges.color.hover&&(this.constants.edges.color.hover=t.edges.color.hover)),this.constants.edges.inheritColor=!1),t.edges.fontColor||void 0!==t.edges.color&&(a.isString(t.edges.color)?this.constants.edges.fontColor=t.edges.color:void 0!==t.edges.color.color&&(this.constants.edges.fontColor=t.edges.color.color))),t.nodes&&t.nodes.color){var s=a.parseColor(t.nodes.color);this.constants.nodes.color.background=s.background,this.constants.nodes.color.border=s.border,this.constants.nodes.color.highlight.background=s.highlight.background,this.constants.nodes.color.highlight.border=s.highlight.border,this.constants.nodes.color.hover.background=s.hover.background,this.constants.nodes.color.hover.border=s.hover.border}if(t.groups)for(var o in t.groups)if(t.groups.hasOwnProperty(o)){var n=t.groups[o];this.groups.add(o,n)}if(t.tooltip){for(e in t.tooltip)t.tooltip.hasOwnProperty(e)&&(this.constants.tooltip[e]=t.tooltip[e]);t.tooltip.color&&(this.constants.tooltip.color=a.parseColor(t.tooltip.color))}if("clickToUse"in t&&(t.clickToUse?this.activator||(this.activator=new b(this.frame),this.activator.on("change",this._createKeyBinds.bind(this))):this.activator&&(this.activator.destroy(),delete this.activator)),t.labels)throw new Error('Option "labels" is deprecated. Use options "locale" and "locales" instead.');this._loadPhysicsSystem(),this._loadNavigationControls(),this._loadManipulationSystem(),this._configureSmoothCurves(),this._bindHammer(),this._createKeyBinds(),this.setSize(this.constants.width,this.constants.height),this.moving=!0,this.start()}},s.prototype._create=function(){for(;this.containerElement.hasChildNodes();)this.containerElement.removeChild(this.containerElement.firstChild);if(this.frame=document.createElement("div"),this.frame.className="vis network-frame",this.frame.style.position="relative",this.frame.style.overflow="hidden",this.frame.canvas=document.createElement("canvas"),this.frame.canvas.style.position="relative",this.frame.appendChild(this.frame.canvas),this.frame.canvas.getContext){var t=this.frame.canvas.getContext("2d");this.pixelRatio=(window.devicePixelRatio||1)/(t.webkitBackingStorePixelRatio||t.mozBackingStorePixelRatio||t.msBackingStorePixelRatio||t.oBackingStorePixelRatio||t.backingStorePixelRatio||1),this.frame.canvas.getContext("2d").setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0)}else{var e=document.createElement("DIV");e.style.color="red",e.style.fontWeight="bold",e.style.padding="10px",e.innerHTML="Error: your browser does not support HTML canvas",this.frame.canvas.appendChild(e)}this._bindHammer()},s.prototype._bindHammer=function(){var t=this;void 0!==this.hammer&&this.hammer.dispose(),this.drag={},this.pinch={},this.hammer=n(this.frame.canvas,{prevent_default:!0}),this.hammer.on("tap",t._onTap.bind(t)),this.hammer.on("doubletap",t._onDoubleTap.bind(t)),this.hammer.on("hold",t._onHold.bind(t)),this.hammer.on("touch",t._onTouch.bind(t)),this.hammer.on("dragstart",t._onDragStart.bind(t)),this.hammer.on("drag",t._onDrag.bind(t)),this.hammer.on("dragend",t._onDragEnd.bind(t)),1==this.constants.zoomable&&(this.hammer.on("mousewheel",t._onMouseWheel.bind(t)),this.hammer.on("DOMMouseScroll",t._onMouseWheel.bind(t)),this.hammer.on("pinch",t._onPinch.bind(t))),this.hammer.on("mousemove",t._onMouseMoveTitle.bind(t)),this.hammerFrame=n(this.frame,{prevent_default:!0}),this.hammerFrame.on("release",t._onRelease.bind(t)),this.containerElement.appendChild(this.frame)},s.prototype._createKeyBinds=function(){var t=this;void 0!==this.keycharm&&this.keycharm.destroy(),this.keycharm=r(),this.keycharm.reset(),this.constants.keyboard.enabled&&this.isActive()&&(this.keycharm.bind("up",this._moveUp.bind(t),"keydown"),this.keycharm.bind("up",this._yStopMoving.bind(t),"keyup"),this.keycharm.bind("down",this._moveDown.bind(t),"keydown"),this.keycharm.bind("down",this._yStopMoving.bind(t),"keyup"),this.keycharm.bind("left",this._moveLeft.bind(t),"keydown"),this.keycharm.bind("left",this._xStopMoving.bind(t),"keyup"),this.keycharm.bind("right",this._moveRight.bind(t),"keydown"),this.keycharm.bind("right",this._xStopMoving.bind(t),"keyup"),this.keycharm.bind("=",this._zoomIn.bind(t),"keydown"),this.keycharm.bind("=",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("num+",this._zoomIn.bind(t),"keydown"),this.keycharm.bind("num+",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("num-",this._zoomOut.bind(t),"keydown"),this.keycharm.bind("num-",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("-",this._zoomOut.bind(t),"keydown"),this.keycharm.bind("-",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("[",this._zoomIn.bind(t),"keydown"),this.keycharm.bind("[",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("]",this._zoomOut.bind(t),"keydown"),this.keycharm.bind("]",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("pageup",this._zoomIn.bind(t),"keydown"),this.keycharm.bind("pageup",this._stopZoom.bind(t),"keyup"),this.keycharm.bind("pagedown",this._zoomOut.bind(t),"keydown"),this.keycharm.bind("pagedown",this._stopZoom.bind(t),"keyup")),1==this.constants.dataManipulation.enabled&&(this.keycharm.bind("esc",this._createManipulatorBar.bind(t)),this.keycharm.bind("delete",this._deleteSelected.bind(t)))},s.prototype.destroy=function(){this.start=function(){},this.redraw=function(){},this.timer=!1,this._cleanupPhysicsConfiguration(),this.keycharm.reset(),this.hammer.dispose(),this.off(),this._recursiveDOMDelete(this.containerElement)},s.prototype._recursiveDOMDelete=function(t){for(;1==t.hasChildNodes();)this._recursiveDOMDelete(t.firstChild),t.removeChild(t.firstChild)},s.prototype._getPointer=function(t){return{x:t.pageX-a.getAbsoluteLeft(this.frame.canvas),y:t.pageY-a.getAbsoluteTop(this.frame.canvas)}},s.prototype._onTouch=function(t){(new Date).valueOf()-this.touchTime>100&&(this.drag.pointer=this._getPointer(t.gesture.center),this.drag.pinched=!1,this.pinch.scale=this._getScale(),this.touchTime=(new Date).valueOf(),this._handleTouch(this.drag.pointer))},s.prototype._onDragStart=function(t){this._handleDragStart(t)},s.prototype._handleDragStart=function(t){void 0===this.drag.pointer&&this._onTouch(t);var e=this._getNodeAt(this.drag.pointer);if(this.drag.dragging=!0,this.drag.selection=[],this.drag.translation=this._getTranslation(),this.drag.nodeId=null,this.draggingNodes=!1,null!=e&&1==this.constants.dragNodes){this.draggingNodes=!0,this.drag.nodeId=e.id,e.isSelected()||this._selectObject(e,!1),this.emit("dragStart",{nodeIds:this.getSelection().nodes});for(var i in this.selectionObj.nodes)if(this.selectionObj.nodes.hasOwnProperty(i)){var s=this.selectionObj.nodes[i],o={id:s.id,node:s,x:s.x,y:s.y,xFixed:s.xFixed,yFixed:s.yFixed};s.xFixed=!0,s.yFixed=!0,this.drag.selection.push(o)}}},s.prototype._onDrag=function(t){this._handleOnDrag(t)},s.prototype._handleOnDrag=function(t){if(!this.drag.pinched){this.releaseNode();var e=this._getPointer(t.gesture.center),i=this,s=this.drag,o=s.selection;if(o&&o.length&&1==this.constants.dragNodes){var n=e.x-s.pointer.x,r=e.y-s.pointer.y;o.forEach(function(t){var e=t.node;t.xFixed||(e.x=i._XconvertDOMtoCanvas(i._XconvertCanvasToDOM(t.x)+n)),t.yFixed||(e.y=i._YconvertDOMtoCanvas(i._YconvertCanvasToDOM(t.y)+r))}),this.moving||(this.moving=!0,this.start())}else if(1==this.constants.dragNetwork){if(void 0===this.drag.pointer)return void this._handleDragStart(t);var a=e.x-this.drag.pointer.x,h=e.y-this.drag.pointer.y;this._setTranslation(this.drag.translation.x+a,this.drag.translation.y+h),this._redraw()}}},s.prototype._onDragEnd=function(t){this._handleDragEnd(t)},s.prototype._handleDragEnd=function(){this.drag.dragging=!1;var t=this.drag.selection;t&&t.length?(t.forEach(function(t){t.node.xFixed=t.xFixed,t.node.yFixed=t.yFixed}),this.moving=!0,this.start()):this._redraw(),0==this.draggingNodes?this.emit("dragEnd",{nodeIds:[]}):this.emit("dragEnd",{nodeIds:this.getSelection().nodes})},s.prototype._onTap=function(t){var e=this._getPointer(t.gesture.center);this.pointerPosition=e,this._handleTap(e)},s.prototype._onDoubleTap=function(t){var e=this._getPointer(t.gesture.center);this._handleDoubleTap(e)},s.prototype._onHold=function(t){var e=this._getPointer(t.gesture.center);this.pointerPosition=e,this._handleOnHold(e)},s.prototype._onRelease=function(t){var e=this._getPointer(t.gesture.center);this._handleOnRelease(e)},s.prototype._onPinch=function(t){var e=this._getPointer(t.gesture.center);this.drag.pinched=!0,"scale"in this.pinch||(this.pinch.scale=1);var i=this.pinch.scale*t.gesture.scale;this._zoom(i,e)},s.prototype._zoom=function(t,e){if(1==this.constants.zoomable){var i=this._getScale();1e-5>t&&(t=1e-5),t>10&&(t=10);var s=null;void 0!==this.drag&&1==this.drag.dragging&&(s=this.DOMtoCanvas(this.drag.pointer));var o=this._getTranslation(),n=t/i,r=(1-n)*e.x+o.x*n,a=(1-n)*e.y+o.y*n;if(this.areaCenter={x:this._XconvertDOMtoCanvas(e.x),y:this._YconvertDOMtoCanvas(e.y)},this._setScale(t),this._setTranslation(r,a),this.updateClustersDefault(),null!=s){var h=this.canvasToDOM(s);this.drag.pointer.x=h.x,this.drag.pointer.y=h.y}return this._redraw(),t>i?this.emit("zoom",{direction:"+"}):this.emit("zoom",{direction:"-"}),t}},s.prototype._onMouseWheel=function(t){var e=0;if(t.wheelDelta?e=t.wheelDelta/120:t.detail&&(e=-t.detail/3),e){var i=this._getScale(),s=e/10;0>e&&(s/=1-s),i*=1+s;var o=h.fakeGesture(this,t),n=this._getPointer(o.center);this._zoom(i,n)}t.preventDefault()},s.prototype._onMouseMoveTitle=function(t){var e=h.fakeGesture(this,t),i=this._getPointer(e.center);this.popupObj&&this._checkHidePopup(i);var s=this,o=function(){s._checkShowPopup(i)};if(this.popupTimer&&clearInterval(this.popupTimer),this.drag.dragging||(this.popupTimer=setTimeout(o,this.constants.tooltip.delay)),1==this.constants.hover){for(var n in this.hoverObj.edges)this.hoverObj.edges.hasOwnProperty(n)&&(this.hoverObj.edges[n].hover=!1,delete this.hoverObj.edges[n]);var r=this._getNodeAt(i);null==r&&(r=this._getEdgeAt(i)),null!=r&&this._hoverObject(r);for(var a in this.hoverObj.nodes)this.hoverObj.nodes.hasOwnProperty(a)&&(r instanceof f&&r.id!=a||r instanceof g||null==r)&&(this._blurObject(this.hoverObj.nodes[a]),delete this.hoverObj.nodes[a]);this.redraw()}},s.prototype._checkShowPopup=function(t){var e,i={left:this._XconvertDOMtoCanvas(t.x),top:this._YconvertDOMtoCanvas(t.y),right:this._XconvertDOMtoCanvas(t.x),bottom:this._YconvertDOMtoCanvas(t.y)},s=this.popupObj,o=!1;if(void 0==this.popupObj){var n=this.nodes,r=[];for(e in n)if(n.hasOwnProperty(e)){var a=n[e];a.isOverlappingWith(i)&&void 0!==a.getTitle()&&r.push(e)}r.length>0&&(this.popupObj=this.nodes[r[r.length-1]],o=!0)}if(void 0===this.popupObj&&0==o){var h=this.edges,d=[];for(e in h)if(h.hasOwnProperty(e)){var l=h[e];l.connected&&void 0!==l.getTitle()&&l.isOverlappingWith(i)&&d.push(e)}d.length>0&&(this.popupObj=this.edges[d[d.length-1]])}if(this.popupObj){if(this.popupObj!=s){var c=this;c.popup||(c.popup=new v(c.frame,c.constants.tooltip)),c.popup.setPosition(t.x-3,t.y-3),c.popup.setText(c.popupObj.getTitle()),c.popup.show()}}else this.popup&&this.popup.hide()},s.prototype._checkHidePopup=function(t){this.popupObj&&this._getNodeAt(t)||(this.popupObj=void 0,this.popup&&this.popup.hide())},s.prototype.setSize=function(t,e){var i=!1,s=this.frame.canvas.width,o=this.frame.canvas.height;t!=this.constants.width||e!=this.constants.height||this.frame.style.width!=t||this.frame.style.height!=e?(this.frame.style.width=t,this.frame.style.height=e,this.frame.canvas.style.width="100%",this.frame.canvas.style.height="100%",this.frame.canvas.width=this.frame.canvas.clientWidth*this.pixelRatio,this.frame.canvas.height=this.frame.canvas.clientHeight*this.pixelRatio,this.constants.width=t,this.constants.height=e,i=!0):(this.frame.canvas.width!=this.frame.canvas.clientWidth*this.pixelRatio&&(this.frame.canvas.width=this.frame.canvas.clientWidth*this.pixelRatio,i=!0),this.frame.canvas.height!=this.frame.canvas.clientHeight*this.pixelRatio&&(this.frame.canvas.height=this.frame.canvas.clientHeight*this.pixelRatio,i=!0)),1==i&&this.emit("resize",{width:this.frame.canvas.width*this.pixelRatio,height:this.frame.canvas.height*this.pixelRatio,oldWidth:s*this.pixelRatio,oldHeight:o*this.pixelRatio})},s.prototype._setNodes=function(t){var e=this.nodesData;if(t instanceof d||t instanceof l)this.nodesData=t;else if(Array.isArray(t))this.nodesData=new d,this.nodesData.add(t);else{if(t)throw new TypeError("Array or DataSet expected");this.nodesData=new d}if(e&&a.forEach(this.nodesListeners,function(t,i){e.off(i,t)}),this.nodes={},this.nodesData){var i=this;a.forEach(this.nodesListeners,function(t,e){i.nodesData.on(e,t)});var s=this.nodesData.getIds();this._addNodes(s)}this._updateSelection()},s.prototype._addNodes=function(t){for(var e,i=0,s=t.length;s>i;i++){e=t[i];var o=this.nodesData.get(e),n=new f(o,this.images,this.groups,this.constants);if(this.nodes[e]=n,!(0!=n.xFixed&&0!=n.yFixed||null!==n.x&&null!==n.y)){var r=1*t.length+10,a=2*Math.PI*Math.random();0==n.xFixed&&(n.x=r*Math.cos(a)),0==n.yFixed&&(n.y=r*Math.sin(a))}this.moving=!0}this._updateNodeIndexList(),1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout()),this._updateCalculationNodes(),this._reconnectEdges(),this._updateValueRange(this.nodes),this.updateLabels()},s.prototype._updateNodes=function(t,e){for(var i=this.nodes,s=0,o=t.length;o>s;s++){var n=t[s],r=i[n],a=e[s];r?r.setProperties(a,this.constants):(r=new f(properties,this.images,this.groups,this.constants),i[n]=r)}this.moving=!0,1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout()),this._updateNodeIndexList(),this._updateValueRange(i)},s.prototype._removeNodes=function(t){for(var e=this.nodes,i=0,s=t.length;s>i;i++){var o=t[i];delete e[o]}this._updateNodeIndexList(),1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout()),this._updateCalculationNodes(),this._reconnectEdges(),this._updateSelection(),this._updateValueRange(e)},s.prototype._setEdges=function(t){var e=this.edgesData;if(t instanceof d||t instanceof l)this.edgesData=t;else if(Array.isArray(t))this.edgesData=new d,this.edgesData.add(t);else{if(t)throw new TypeError("Array or DataSet expected");this.edgesData=new d}if(e&&a.forEach(this.edgesListeners,function(t,i){e.off(i,t)}),this.edges={},this.edgesData){var i=this;a.forEach(this.edgesListeners,function(t,e){i.edgesData.on(e,t)});var s=this.edgesData.getIds();this._addEdges(s)}this._reconnectEdges()},s.prototype._addEdges=function(t){for(var e=this.edges,i=this.edgesData,s=0,o=t.length;o>s;s++){var n=t[s],r=e[n];r&&r.disconnect();var a=i.get(n,{showInternalIds:!0});e[n]=new g(a,this,this.constants)}this.moving=!0,this._updateValueRange(e),this._createBezierNodes(),this._updateCalculationNodes(),1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout())},s.prototype._updateEdges=function(t){for(var e=this.edges,i=this.edgesData,s=0,o=t.length;o>s;s++){var n=t[s],r=i.get(n),a=e[n];a?(a.disconnect(),a.setProperties(r,this.constants),a.connect()):(a=new g(r,this,this.constants),this.edges[n]=a)}this._createBezierNodes(),1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout()),this.moving=!0,this._updateValueRange(e)},s.prototype._removeEdges=function(t){for(var e=this.edges,i=0,s=t.length;s>i;i++){var o=t[i],n=e[o];n&&(null!=n.via&&delete this.sectors.support.nodes[n.via.id],n.disconnect(),delete e[o])}this.moving=!0,this._updateValueRange(e),1==this.constants.hierarchicalLayout.enabled&&0==this.initializing&&(this._resetLevels(),this._setupHierarchicalLayout()),this._updateCalculationNodes()},s.prototype._reconnectEdges=function(){var t,e=this.nodes,i=this.edges;for(t in e)e.hasOwnProperty(t)&&(e[t].edges=[],e[t].dynamicEdges=[]);for(t in i)if(i.hasOwnProperty(t)){var s=i[t];s.from=null,s.to=null,s.connect()}},s.prototype._updateValueRange=function(t){var e,i=void 0,s=void 0;for(e in t)if(t.hasOwnProperty(e)){var o=t[e].getValue();void 0!==o&&(i=void 0===i?o:Math.min(o,i),s=void 0===s?o:Math.max(o,s))}if(void 0!==i&&void 0!==s)for(e in t)t.hasOwnProperty(e)&&t[e].setValueRange(i,s)},s.prototype.redraw=function(){this.setSize(this.constants.width,this.constants.height),this._redraw()},s.prototype._redraw=function(t){var e=this.frame.canvas.getContext("2d");e.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);var i=this.frame.canvas.width*this.pixelRatio,s=this.frame.canvas.height*this.pixelRatio;e.clearRect(0,0,i,s),e.save(),e.translate(this.translation.x,this.translation.y),e.scale(this.scale,this.scale),this.canvasTopLeft={x:this._XconvertDOMtoCanvas(0),y:this._YconvertDOMtoCanvas(0)},this.canvasBottomRight={x:this._XconvertDOMtoCanvas(this.frame.canvas.clientWidth*this.pixelRatio),y:this._YconvertDOMtoCanvas(this.frame.canvas.clientHeight*this.pixelRatio)},1!=t&&(this._doInAllSectors("_drawAllSectorNodes",e),(0==this.drag.dragging||void 0===this.drag.dragging||0==this.constants.hideEdgesOnDrag)&&this._doInAllSectors("_drawEdges",e)),(0==this.drag.dragging||void 0===this.drag.dragging||0==this.constants.hideNodesOnDrag)&&this._doInAllSectors("_drawNodes",e,!1),1!=t&&1==this.controlNodesActive&&this._doInAllSectors("_drawControlNodes",e),e.restore(),1==t&&e.clearRect(0,0,i,s)},s.prototype._setTranslation=function(t,e){void 0===this.translation&&(this.translation={x:0,y:0}),void 0!==t&&(this.translation.x=t),void 0!==e&&(this.translation.y=e),this.emit("viewChanged")},s.prototype._getTranslation=function(){return{x:this.translation.x,y:this.translation.y}},s.prototype._setScale=function(t){this.scale=t},s.prototype._getScale=function(){return this.scale},s.prototype._XconvertDOMtoCanvas=function(t){return(t-this.translation.x)/this.scale},s.prototype._XconvertCanvasToDOM=function(t){return t*this.scale+this.translation.x},s.prototype._YconvertDOMtoCanvas=function(t){return(t-this.translation.y)/this.scale},s.prototype._YconvertCanvasToDOM=function(t){return t*this.scale+this.translation.y},s.prototype.canvasToDOM=function(t){return{x:this._XconvertCanvasToDOM(t.x),y:this._YconvertCanvasToDOM(t.y)}},s.prototype.DOMtoCanvas=function(t){return{x:this._XconvertDOMtoCanvas(t.x),y:this._YconvertDOMtoCanvas(t.y)}},s.prototype._drawNodes=function(t,e){void 0===e&&(e=!1);var i=this.nodes,s=[];for(var o in i)i.hasOwnProperty(o)&&(i[o].setScaleAndPos(this.scale,this.canvasTopLeft,this.canvasBottomRight),i[o].isSelected()?s.push(o):(i[o].inArea()||e)&&i[o].draw(t));for(var n=0,r=s.length;r>n;n++)(i[s[n]].inArea()||e)&&i[s[n]].draw(t)},s.prototype._drawEdges=function(t){var e=this.edges;for(var i in e)if(e.hasOwnProperty(i)){var s=e[i];s.setScale(this.scale),s.connected&&e[i].draw(t)}},s.prototype._drawControlNodes=function(t){var e=this.edges;for(var i in e)e.hasOwnProperty(i)&&e[i]._drawControlNodes(t)},s.prototype._stabilize=function(){1==this.constants.freezeForStabilization&&this._freezeDefinedNodes();for(var t=0;this.moving&&t<this.constants.stabilizationIterations;)this._physicsTick(),t++;1==this.constants.zoomExtentOnStabilize&&this.zoomExtent(void 0,!1,!0),1==this.constants.freezeForStabilization&&this._restoreFrozenNodes()},s.prototype._freezeDefinedNodes=function(){var t=this.nodes;for(var e in t)t.hasOwnProperty(e)&&null!=t[e].x&&null!=t[e].y&&(t[e].fixedData.x=t[e].xFixed,t[e].fixedData.y=t[e].yFixed,t[e].xFixed=!0,t[e].yFixed=!0)},s.prototype._restoreFrozenNodes=function(){var t=this.nodes;for(var e in t)t.hasOwnProperty(e)&&null!=t[e].fixedData.x&&(t[e].xFixed=t[e].fixedData.x,t[e].yFixed=t[e].fixedData.y)},s.prototype._isMoving=function(t){var e=this.nodes;for(var i in e)if(e.hasOwnProperty(i)&&e[i].isMoving(t))return!0;return!1},s.prototype._discreteStepNodes=function(){var t,e=this.physicsDiscreteStepsize,i=this.nodes,s=!1;if(this.constants.maxVelocity>0)for(t in i)i.hasOwnProperty(t)&&(i[t].discreteStepLimited(e,this.constants.maxVelocity),s=!0);else for(t in i)i.hasOwnProperty(t)&&(i[t].discreteStep(e),s=!0);if(1==s){var o=this.constants.minVelocity/Math.max(this.scale,.05);return o>.5*this.constants.maxVelocity?!0:this._isMoving(o)}return!1},s.prototype._revertPhysicsState=function(){var t=this.nodes;for(var e in t)t.hasOwnProperty(e)&&t[e].revertPosition()},s.prototype._revertPhysicsTick=function(){this._doInAllActiveSectors("_revertPhysicsState"),1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic&&this._doInSupportSector("_revertPhysicsState")},s.prototype._physicsTick=function(){if(!this.freezeSimulation&&1==this.moving){var t=!1,e=!1;this._doInAllActiveSectors("_initializeForceCalculation");var i=this._doInAllActiveSectors("_discreteStepNodes");1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic&&(e=this._doInSupportSector("_discreteStepNodes"));for(var s=0;s<i.length;s++)t=i[0]||t;this.moving=t||e,0==this.moving?this._revertPhysicsTick():0==this.startedStabilization&&(this.emit("startStabilization"),this.startedStabilization=!0),this.stabilizationIterations++}},s.prototype._animationStep=function(){if(this.timer=void 0,this._handleNavigation(),1==this.moving){var t=Date.now();this._physicsTick();var e=Date.now()-t;(this.renderTimestep-this.renderTime>2*e||1==this.runDoubleSpeed)&&1==this.moving&&(this._physicsTick(),0!=this.renderTime&&(this.runDoubleSpeed=!0))}var i=Date.now();this._redraw(),this.renderTime=Date.now()-i,this.start()},"undefined"!=typeof window&&(window.requestAnimationFrame=window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame||window.msRequestAnimationFrame),s.prototype.start=function(){if(1==this.moving||0!=this.xIncrement||0!=this.yIncrement||0!=this.zoomIncrement||1==this.animating)this.timer||(this.timer=1==this.requiresTimeout?window.setTimeout(this._animationStep.bind(this),this.renderTimestep):window.requestAnimationFrame(this._animationStep.bind(this)));else if(this._redraw(),this.stabilizationIterations>1){var t=this,e={iterations:t.stabilizationIterations};this.stabilizationIterations=0,this.startedStabilization=!1,setTimeout(function(){t.emit("stabilized",e)},0)}else this.stabilizationIterations=0},s.prototype._handleNavigation=function(){if(0!=this.xIncrement||0!=this.yIncrement){var t=this._getTranslation();this._setTranslation(t.x+this.xIncrement,t.y+this.yIncrement)}if(0!=this.zoomIncrement){var e={x:this.frame.canvas.clientWidth/2,y:this.frame.canvas.clientHeight/2};this._zoom(this.scale*(1+this.zoomIncrement),e)}},s.prototype.toggleFreeze=function(){0==this.freezeSimulation?this.freezeSimulation=!0:(this.freezeSimulation=!1,this.start())},s.prototype._configureSmoothCurves=function(t){if(void 0===t&&(t=!0),1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic){this._createBezierNodes();for(var e in this.sectors.support.nodes)this.sectors.support.nodes.hasOwnProperty(e)&&void 0===this.edges[this.sectors.support.nodes[e].parentEdgeId]&&delete this.sectors.support.nodes[e]}else{this.sectors.support.nodes={};for(var i in this.edges)this.edges.hasOwnProperty(i)&&(this.edges[i].via=null)}this._updateCalculationNodes(),t||(this.moving=!0,this.start())},s.prototype._createBezierNodes=function(){if(1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic)for(var t in this.edges)if(this.edges.hasOwnProperty(t)){var e=this.edges[t];if(null==e.via){var i="edgeId:".concat(e.id);this.sectors.support.nodes[i]=new f({id:i,mass:1,shape:"circle",image:"",internalMultiplier:1},{},{},this.constants),e.via=this.sectors.support.nodes[i],e.via.parentEdgeId=e.id,e.positionBezierNode()}}},s.prototype._initializeMixinLoaders=function(){for(var t in y)y.hasOwnProperty(t)&&(s.prototype[t]=y[t])},s.prototype.storePosition=function(){console.log("storePosition is depricated: use .storePositions() from now on."),this.storePositions()},s.prototype.storePositions=function(){var t=[];for(var e in this.nodes)if(this.nodes.hasOwnProperty(e)){var i=this.nodes[e],s=!this.nodes.xFixed,o=!this.nodes.yFixed;(this.nodesData._data[e].x!=Math.round(i.x)||this.nodesData._data[e].y!=Math.round(i.y))&&t.push({id:e,x:Math.round(i.x),y:Math.round(i.y),allowedToMoveX:s,allowedToMoveY:o})}this.nodesData.update(t)},s.prototype.getPositions=function(t){var e={};if(void 0!==t){if(1==Array.isArray(t)){for(var i=0;i<t.length;i++)if(void 0!==this.nodes[t[i]]){var s=this.nodes[t[i]];e[t[i]]={x:Math.round(s.x),y:Math.round(s.y)}}}else if(void 0!==this.nodes[t]){var s=this.nodes[t];e[t]={x:Math.round(s.x),y:Math.round(s.y)}}}else for(var o in this.nodes)if(this.nodes.hasOwnProperty(o)){var s=this.nodes[o];e[o]={x:Math.round(s.x),y:Math.round(s.y)}}return e},s.prototype.focusOnNode=function(t,e){if(this.nodes.hasOwnProperty(t)){void 0===e&&(e={});var i={x:this.nodes[t].x,y:this.nodes[t].y};e.position=i,e.lockedOnNode=t,this.moveTo(e)}else console.log("This nodeId cannot be found.")},s.prototype.moveTo=function(t){return void 0===t?void(t={}):(void 0===t.offset&&(t.offset={x:0,y:0}),void 0===t.offset.x&&(t.offset.x=0),void 0===t.offset.y&&(t.offset.y=0),void 0===t.scale&&(t.scale=this._getScale()),void 0===t.position&&(t.position=this._getTranslation()),void 0===t.animation&&(t.animation={duration:0}),t.animation===!1&&(t.animation={duration:0}),t.animation===!0&&(t.animation={}),void 0===t.animation.duration&&(t.animation.duration=1e3),void 0===t.animation.easingFunction&&(t.animation.easingFunction="easeInOutQuad"),void this.animateView(t))},s.prototype.animateView=function(t){if(void 0===t)return void(t={});this.releaseNode(),1==t.locked&&(this.lockedOnNodeId=t.lockedOnNode,this.lockedOnNodeOffset=t.offset),0!=this.easingTime&&this._transitionRedraw(1),this.sourceScale=this._getScale(),this.sourceTranslation=this._getTranslation(),this.targetScale=t.scale,this._setScale(this.targetScale);var e=this.DOMtoCanvas({x:.5*this.frame.canvas.clientWidth,y:.5*this.frame.canvas.clientHeight}),i={x:e.x-t.position.x,y:e.y-t.position.y};this.targetTranslation={x:this.sourceTranslation.x+i.x*this.targetScale+t.offset.x,y:this.sourceTranslation.y+i.y*this.targetScale+t.offset.y},0==t.animation.duration?null!=this.lockedOnNodeId?(this._classicRedraw=this._redraw,this._redraw=this._lockedRedraw):(this._setScale(this.targetScale),this._setTranslation(this.targetTranslation.x,this.targetTranslation.y),this._redraw()):(this.animating=!0,this.animationSpeed=1/(this.renderRefreshRate*t.animation.duration*.001)||1/this.renderRefreshRate,this.animationEasingFunction=t.animation.easingFunction,this._classicRedraw=this._redraw,this._redraw=this._transitionRedraw,this._redraw(),this.start())},s.prototype._lockedRedraw=function(){var t={x:this.nodes[this.lockedOnNodeId].x,y:this.nodes[this.lockedOnNodeId].y},e=this.DOMtoCanvas({x:.5*this.frame.canvas.clientWidth,y:.5*this.frame.canvas.clientHeight}),i={x:e.x-t.x,y:e.y-t.y},s=this._getTranslation(),o={x:s.x+i.x*this.scale+this.lockedOnNodeOffset.x,y:s.y+i.y*this.scale+this.lockedOnNodeOffset.y};this._setTranslation(o.x,o.y),this._classicRedraw()},s.prototype.releaseNode=function(){null!=this.lockedOnNodeId&&(this._redraw=this._classicRedraw,this.lockedOnNodeId=null,this.lockedOnNodeOffset=null)},s.prototype._transitionRedraw=function(t){this.easingTime=t||this.easingTime+this.animationSpeed,this.easingTime+=this.animationSpeed;var e=a.easingFunctions[this.animationEasingFunction](this.easingTime);this._setScale(this.sourceScale+(this.targetScale-this.sourceScale)*e),this._setTranslation(this.sourceTranslation.x+(this.targetTranslation.x-this.sourceTranslation.x)*e,this.sourceTranslation.y+(this.targetTranslation.y-this.sourceTranslation.y)*e),this._classicRedraw(),this.easingTime>=1&&(this.animating=!1,this.easingTime=0,this._redraw=null!=this.lockedOnNodeId?this._lockedRedraw:this._classicRedraw,this.emit("animationFinished"))},s.prototype._classicRedraw=function(){},s.prototype.isActive=function(){return!this.activator||this.activator.active},s.prototype.setScale=function(){return this._setScale()},s.prototype.getScale=function(){return this._getScale()},s.prototype.getCenterCoordinates=function(){return this.DOMtoCanvas({x:.5*this.frame.canvas.clientWidth,y:.5*this.frame.canvas.clientHeight})},s.prototype.getBoundingBox=function(t){return void 0!==this.nodes[t]?this.nodes[t].boundingBox:void 0},t.exports=s},function(t,e,i){function s(t,e,i){if(!e)throw"No network provided";var s=["edges","physics"],n=o.selectiveBridgeObject(s,i);this.options=n.edges,this.physics=n.physics,this.options.smoothCurves=i.smoothCurves,this.network=e,this.id=void 0,this.fromId=void 0,this.toId=void 0,this.title=void 0,this.widthSelected=this.options.width*this.options.widthSelectionMultiplier,this.value=void 0,this.selected=!1,this.hover=!1,this.labelDimensions={top:0,left:0,width:0,height:0,yLine:0},this.dirtyLabel=!0,this.from=null,this.to=null,this.via=null,this.fromBackup=null,this.toBackup=null,this.originalFromId=[],this.originalToId=[],this.connected=!1,this.widthFixed=!1,this.lengthFixed=!1,this.setProperties(t),this.controlNodesEnabled=!1,this.controlNodes={from:null,to:null,positions:{}},this.connectedNode=null}var o=i(1),n=i(40);s.prototype.setProperties=function(t){if(t){var e=["style","fontSize","fontFace","fontColor","fontFill","fontStrokeWidth","fontStrokeColor","width","widthSelectionMultiplier","hoverWidth","arrowScaleFactor","dash","inheritColor","labelAlignment"];switch(o.selectiveDeepExtend(e,this.options,t),void 0!==t.from&&(this.fromId=t.from),void 0!==t.to&&(this.toId=t.to),void 0!==t.id&&(this.id=t.id),void 0!==t.label&&(this.label=t.label,this.dirtyLabel=!0),void 0!==t.title&&(this.title=t.title),void 0!==t.value&&(this.value=t.value),void 0!==t.length&&(this.physics.springLength=t.length),void 0!==t.color&&(this.options.inheritColor=!1,o.isString(t.color)?(this.options.color.color=t.color,this.options.color.highlight=t.color):(void 0!==t.color.color&&(this.options.color.color=t.color.color),void 0!==t.color.highlight&&(this.options.color.highlight=t.color.highlight),void 0!==t.color.hover&&(this.options.color.hover=t.color.hover))),this.connect(),this.widthFixed=this.widthFixed||void 0!==t.width,this.lengthFixed=this.lengthFixed||void 0!==t.length,this.widthSelected=this.options.width*this.options.widthSelectionMultiplier,this.options.style){case"line":this.draw=this._drawLine;break;case"arrow":this.draw=this._drawArrow;break;case"arrow-center":this.draw=this._drawArrowCenter;break;case"dash-line":this.draw=this._drawDashLine;break;default:this.draw=this._drawLine}}},s.prototype.connect=function(){this.disconnect(),this.from=this.network.nodes[this.fromId]||null,this.to=this.network.nodes[this.toId]||null,this.connected=this.from&&this.to,this.connected?(this.from.attachEdge(this),this.to.attachEdge(this)):(this.from&&this.from.detachEdge(this),this.to&&this.to.detachEdge(this))
},s.prototype.disconnect=function(){this.from&&(this.from.detachEdge(this),this.from=null),this.to&&(this.to.detachEdge(this),this.to=null),this.connected=!1},s.prototype.getTitle=function(){return"function"==typeof this.title?this.title():this.title},s.prototype.getValue=function(){return this.value},s.prototype.setValueRange=function(t,e){if(!this.widthFixed&&void 0!==this.value){var i=(this.options.widthMax-this.options.widthMin)/(e-t);this.options.width=(this.value-t)*i+this.options.widthMin,this.widthSelected=this.options.width*this.options.widthSelectionMultiplier}},s.prototype.draw=function(){throw"Method draw not initialized in edge"},s.prototype.isOverlappingWith=function(t){if(this.connected){var e=10,i=this.from.x,s=this.from.y,o=this.to.x,n=this.to.y,r=t.left,a=t.top,h=this._getDistanceToEdge(i,s,o,n,r,a);return e>h}return!1},s.prototype._getColor=function(){var t=this.options.color;return"to"==this.options.inheritColor?t={highlight:this.to.options.color.highlight.border,hover:this.to.options.color.hover.border,color:this.to.options.color.border}:("from"==this.options.inheritColor||1==this.options.inheritColor)&&(t={highlight:this.from.options.color.highlight.border,hover:this.from.options.color.hover.border,color:this.from.options.color.border}),1==this.selected?t.highlight:1==this.hover?t.hover:t.color},s.prototype._drawLine=function(t){if(t.strokeStyle=this._getColor(),t.lineWidth=this._getLineWidth(),this.from!=this.to){var e,i=this._line(t);if(this.label){if(1==this.options.smoothCurves.enabled&&null!=i){var s=.5*(.5*(this.from.x+i.x)+.5*(this.to.x+i.x)),o=.5*(.5*(this.from.y+i.y)+.5*(this.to.y+i.y));e={x:s,y:o}}else e=this._pointOnLine(.5);this._label(t,this.label,e.x,e.y)}}else{var n,r,a=this.physics.springLength/4,h=this.from;h.width||h.resize(t),h.width>h.height?(n=h.x+h.width/2,r=h.y-a):(n=h.x+a,r=h.y-h.height/2),this._circle(t,n,r,a),e=this._pointOnCircle(n,r,a,.5),this._label(t,this.label,e.x,e.y)}},s.prototype._getLineWidth=function(){return 1==this.selected?Math.max(Math.min(this.widthSelected,this.options.widthMax),.3*this.networkScaleInv):1==this.hover?Math.max(Math.min(this.options.hoverWidth,this.options.widthMax),.3*this.networkScaleInv):Math.max(this.options.width,.3*this.networkScaleInv)},s.prototype._getViaCoordinates=function(){if(1==this.options.smoothCurves.dynamic&&1==this.options.smoothCurves.enabled)return this.via;if(0==this.options.smoothCurves.enabled)return{x:0,y:0};var t=null,e=null,i=this.options.smoothCurves.roundness,s=this.options.smoothCurves.type,o=Math.abs(this.from.x-this.to.x),n=Math.abs(this.from.y-this.to.y);return"discrete"==s||"diagonalCross"==s?Math.abs(this.from.x-this.to.x)<Math.abs(this.from.y-this.to.y)?(this.from.y>this.to.y?this.from.x<this.to.x?(t=this.from.x+i*n,e=this.from.y-i*n):this.from.x>this.to.x&&(t=this.from.x-i*n,e=this.from.y-i*n):this.from.y<this.to.y&&(this.from.x<this.to.x?(t=this.from.x+i*n,e=this.from.y+i*n):this.from.x>this.to.x&&(t=this.from.x-i*n,e=this.from.y+i*n)),"discrete"==s&&(t=i*n>o?this.from.x:t)):Math.abs(this.from.x-this.to.x)>Math.abs(this.from.y-this.to.y)&&(this.from.y>this.to.y?this.from.x<this.to.x?(t=this.from.x+i*o,e=this.from.y-i*o):this.from.x>this.to.x&&(t=this.from.x-i*o,e=this.from.y-i*o):this.from.y<this.to.y&&(this.from.x<this.to.x?(t=this.from.x+i*o,e=this.from.y+i*o):this.from.x>this.to.x&&(t=this.from.x-i*o,e=this.from.y+i*o)),"discrete"==s&&(e=i*o>n?this.from.y:e)):"straightCross"==s?Math.abs(this.from.x-this.to.x)<Math.abs(this.from.y-this.to.y)?(t=this.from.x,e=this.from.y<this.to.y?this.to.y-(1-i)*n:this.to.y+(1-i)*n):Math.abs(this.from.x-this.to.x)>Math.abs(this.from.y-this.to.y)&&(t=this.from.x<this.to.x?this.to.x-(1-i)*o:this.to.x+(1-i)*o,e=this.from.y):"horizontal"==s?(t=this.from.x<this.to.x?this.to.x-(1-i)*o:this.to.x+(1-i)*o,e=this.from.y):"vertical"==s?(t=this.from.x,e=this.from.y<this.to.y?this.to.y-(1-i)*n:this.to.y+(1-i)*n):Math.abs(this.from.x-this.to.x)<Math.abs(this.from.y-this.to.y)?this.from.y>this.to.y?this.from.x<this.to.x?(t=this.from.x+i*n,e=this.from.y-i*n,t=this.to.x<t?this.to.x:t):this.from.x>this.to.x&&(t=this.from.x-i*n,e=this.from.y-i*n,t=this.to.x>t?this.to.x:t):this.from.y<this.to.y&&(this.from.x<this.to.x?(t=this.from.x+i*n,e=this.from.y+i*n,t=this.to.x<t?this.to.x:t):this.from.x>this.to.x&&(t=this.from.x-i*n,e=this.from.y+i*n,t=this.to.x>t?this.to.x:t)):Math.abs(this.from.x-this.to.x)>Math.abs(this.from.y-this.to.y)&&(this.from.y>this.to.y?this.from.x<this.to.x?(t=this.from.x+i*o,e=this.from.y-i*o,e=this.to.y>e?this.to.y:e):this.from.x>this.to.x&&(t=this.from.x-i*o,e=this.from.y-i*o,e=this.to.y>e?this.to.y:e):this.from.y<this.to.y&&(this.from.x<this.to.x?(t=this.from.x+i*o,e=this.from.y+i*o,e=this.to.y<e?this.to.y:e):this.from.x>this.to.x&&(t=this.from.x-i*o,e=this.from.y+i*o,e=this.to.y<e?this.to.y:e))),{x:t,y:e}},s.prototype._line=function(t){if(t.beginPath(),t.moveTo(this.from.x,this.from.y),1==this.options.smoothCurves.enabled){if(0==this.options.smoothCurves.dynamic){var e=this._getViaCoordinates();return null==e.x?(t.lineTo(this.to.x,this.to.y),t.stroke(),null):(t.quadraticCurveTo(e.x,e.y,this.to.x,this.to.y),t.stroke(),e)}return t.quadraticCurveTo(this.via.x,this.via.y,this.to.x,this.to.y),t.stroke(),this.via}return t.lineTo(this.to.x,this.to.y),t.stroke(),null},s.prototype._circle=function(t,e,i,s){t.beginPath(),t.arc(e,i,s,0,2*Math.PI,!1),t.stroke()},s.prototype._label=function(t,e,i,s){if(e){t.font=(this.from.selected||this.to.selected?"bold ":"")+this.options.fontSize+"px "+this.options.fontFace;var o;if(1==this.dirtyLabel){var n=String(e).split("\n"),r=n.length,a=Number(this.options.fontSize);o=s+(1-r)/2*a;for(var h=t.measureText(n[0]).width,d=1;r>d;d++){var l=t.measureText(n[d]).width;h=l>h?l:h}var c=this.options.fontSize*r,p=i-h/2,u=s-c/2;this.labelDimensions={top:u,left:p,width:h,height:c,yLine:o}}var o=this.labelDimensions.yLine;t.save(),"horizontal"!=this.options.labelAlignment&&(t.translate(i,o),this._rotateForLabelAlignment(t),i=0,o=0),this._drawLabelRect(t),this._drawLabelText(t,i,o,n,r,a),t.restore()}},s.prototype._rotateForLabelAlignment=function(t){var e=this.from.y-this.to.y,i=this.from.x-this.to.x,s=Math.atan2(e,i);(-1>s&&0>i||s>0&&0>i)&&(s+=Math.PI),t.rotate(s)},s.prototype._drawLabelRect=function(t){if(void 0!==this.options.fontFill&&null!==this.options.fontFill&&"none"!==this.options.fontFill){t.fillStyle=this.options.fontFill;var e=2;"line-center"==this.options.labelAlignment?t.fillRect(.5*-this.labelDimensions.width,.5*-this.labelDimensions.height,this.labelDimensions.width,this.labelDimensions.height):"line-above"==this.options.labelAlignment?t.fillRect(.5*-this.labelDimensions.width,-(this.labelDimensions.height+e),this.labelDimensions.width,this.labelDimensions.height):"line-below"==this.options.labelAlignment?t.fillRect(.5*-this.labelDimensions.width,e,this.labelDimensions.width,this.labelDimensions.height):t.fillRect(this.labelDimensions.left,this.labelDimensions.top,this.labelDimensions.width,this.labelDimensions.height)}},s.prototype._drawLabelText=function(t,e,i,s,o,n){if(t.fillStyle=this.options.fontColor||"black",t.textAlign="center","horizontal"!=this.options.labelAlignment){var r=2;"line-above"==this.options.labelAlignment?(t.textBaseline="alphabetic",i-=2*r):"line-below"==this.options.labelAlignment?(t.textBaseline="hanging",i+=2*r):t.textBaseline="middle"}else t.textBaseline="middle";this.options.fontStrokeWidth>0&&(t.lineWidth=this.options.fontStrokeWidth,t.strokeStyle=this.options.fontStrokeColor,t.lineJoin="round");for(var a=0;o>a;a++)this.options.fontStrokeWidth>0&&t.strokeText(s[a],e,i),t.fillText(s[a],e,i),i+=n},s.prototype._drawDashLine=function(t){t.strokeStyle=this._getColor(),t.lineWidth=this._getLineWidth();var e=null;if(void 0!==t.setLineDash){t.save();var i=[0];i=void 0!==this.options.dash.length&&void 0!==this.options.dash.gap?[this.options.dash.length,this.options.dash.gap]:[5,5],t.setLineDash(i),t.lineDashOffset=0,e=this._line(t),t.setLineDash([0]),t.lineDashOffset=0,t.restore()}else t.beginPath(),t.lineCap="round",void 0!==this.options.dash.altLength?t.dashedLine(this.from.x,this.from.y,this.to.x,this.to.y,[this.options.dash.length,this.options.dash.gap,this.options.dash.altLength,this.options.dash.gap]):void 0!==this.options.dash.length&&void 0!==this.options.dash.gap?t.dashedLine(this.from.x,this.from.y,this.to.x,this.to.y,[this.options.dash.length,this.options.dash.gap]):(t.moveTo(this.from.x,this.from.y),t.lineTo(this.to.x,this.to.y)),t.stroke();if(this.label){var s;if(1==this.options.smoothCurves.enabled&&null!=e){var o=.5*(.5*(this.from.x+e.x)+.5*(this.to.x+e.x)),n=.5*(.5*(this.from.y+e.y)+.5*(this.to.y+e.y));s={x:o,y:n}}else s=this._pointOnLine(.5);this._label(t,this.label,s.x,s.y)}},s.prototype._pointOnLine=function(t){return{x:(1-t)*this.from.x+t*this.to.x,y:(1-t)*this.from.y+t*this.to.y}},s.prototype._pointOnCircle=function(t,e,i,s){var o=2*(s-3/8)*Math.PI;return{x:t+i*Math.cos(o),y:e-i*Math.sin(o)}},s.prototype._drawArrowCenter=function(t){var e;if(t.strokeStyle=this._getColor(),t.fillStyle=t.strokeStyle,t.lineWidth=this._getLineWidth(),this.from!=this.to){var i=this._line(t),s=Math.atan2(this.to.y-this.from.y,this.to.x-this.from.x),o=(10+5*this.options.width)*this.options.arrowScaleFactor;if(1==this.options.smoothCurves.enabled&&null!=i){var n=.5*(.5*(this.from.x+i.x)+.5*(this.to.x+i.x)),r=.5*(.5*(this.from.y+i.y)+.5*(this.to.y+i.y));e={x:n,y:r}}else e=this._pointOnLine(.5);t.arrow(e.x,e.y,s,o),t.fill(),t.stroke(),this.label&&this._label(t,this.label,e.x,e.y)}else{var a,h,d=.25*Math.max(100,this.physics.springLength),l=this.from;l.width||l.resize(t),l.width>l.height?(a=l.x+.5*l.width,h=l.y-d):(a=l.x+d,h=l.y-.5*l.height),this._circle(t,a,h,d);var s=.2*Math.PI,o=(10+5*this.options.width)*this.options.arrowScaleFactor;e=this._pointOnCircle(a,h,d,.5),t.arrow(e.x,e.y,s,o),t.fill(),t.stroke(),this.label&&(e=this._pointOnCircle(a,h,d,.5),this._label(t,this.label,e.x,e.y))}},s.prototype._pointOnBezier=function(t){var e=this._getViaCoordinates(),i=Math.pow(1-t,2)*this.from.x+2*t*(1-t)*e.x+Math.pow(t,2)*this.to.x,s=Math.pow(1-t,2)*this.from.y+2*t*(1-t)*e.y+Math.pow(t,2)*this.to.y;return{x:i,y:s}},s.prototype._findBorderPosition=function(t,e){var i,s,o,n,r,a=10,h=0,d=0,l=1,c=.2,p=this.to;for(1==t&&(p=this.from);l>=d&&a>h;){var u=.5*(d+l);if(i=this._pointOnBezier(u),s=Math.atan2(p.y-i.y,p.x-i.x),o=p.distanceToBorder(e,s),n=Math.sqrt(Math.pow(i.x-p.x,2)+Math.pow(i.y-p.y,2)),r=o-n,Math.abs(r)<c)break;0>r?0==t?d=u:l=u:0==t?l=u:d=u,h++}return i.t=u,i},s.prototype._drawArrow=function(t){t.strokeStyle=this._getColor(),t.fillStyle=t.strokeStyle,t.lineWidth=this._getLineWidth();var e,i,s;if(this.from!=this.to){if(this._line(t),1==this.options.smoothCurves.enabled){var o=this._getViaCoordinates();s=this._findBorderPosition(!1,t);var n=this._pointOnBezier(Math.max(0,s.t-.1));e=Math.atan2(s.y-n.y,s.x-n.x)}else{e=Math.atan2(this.to.y-this.from.y,this.to.x-this.from.x);var r=this.to.x-this.from.x,a=this.to.y-this.from.y,h=Math.sqrt(r*r+a*a),d=this.to.distanceToBorder(t,e),l=(h-d)/h;s={},s.x=(1-l)*this.from.x+l*this.to.x,s.y=(1-l)*this.from.y+l*this.to.y}if(i=(10+5*this.options.width)*this.options.arrowScaleFactor,t.arrow(s.x,s.y,e,i),t.fill(),t.stroke(),this.label){var c;c=1==this.options.smoothCurves.enabled&&null!=o?this._pointOnBezier(.5):this._pointOnLine(.5),this._label(t,this.label,c.x,c.y)}}else{var p,u,m,f=this.from,g=.25*Math.max(100,this.physics.springLength);f.width||f.resize(t),f.width>f.height?(p=f.x+.5*f.width,u=f.y-g,m={x:p,y:f.y,angle:.9*Math.PI}):(p=f.x+g,u=f.y-.5*f.height,m={x:f.x,y:u,angle:.6*Math.PI}),t.beginPath(),t.arc(p,u,g,0,2*Math.PI,!1),t.stroke();var i=(10+5*this.options.width)*this.options.arrowScaleFactor;t.arrow(m.x,m.y,m.angle,i),t.fill(),t.stroke(),this.label&&(c=this._pointOnCircle(p,u,g,.5),this._label(t,this.label,c.x,c.y))}},s.prototype._getDistanceToEdge=function(t,e,i,s,o,n){var r=0;if(this.from!=this.to)if(1==this.options.smoothCurves.enabled){var a,h;if(1==this.options.smoothCurves.enabled&&1==this.options.smoothCurves.dynamic)a=this.via.x,h=this.via.y;else{var d=this._getViaCoordinates();a=d.x,h=d.y}var l,c,p,u,m,f,g,v=1e9;for(c=0;10>c;c++)p=.1*c,u=Math.pow(1-p,2)*t+2*p*(1-p)*a+Math.pow(p,2)*i,m=Math.pow(1-p,2)*e+2*p*(1-p)*h+Math.pow(p,2)*s,c>0&&(l=this._getDistanceToLine(f,g,u,m,o,n),v=v>l?l:v),f=u,g=m;r=v}else r=this._getDistanceToLine(t,e,i,s,o,n);else{var u,m,y,b,_=.25*this.physics.springLength,x=this.from;x.width>x.height?(u=x.x+.5*x.width,m=x.y-_):(u=x.x+_,m=x.y-.5*x.height),y=u-o,b=m-n,r=Math.abs(Math.sqrt(y*y+b*b)-_)}return this.labelDimensions.left<o&&this.labelDimensions.left+this.labelDimensions.width>o&&this.labelDimensions.top<n&&this.labelDimensions.top+this.labelDimensions.height>n?0:r},s.prototype._getDistanceToLine=function(t,e,i,s,o,n){var r=i-t,a=s-e,h=r*r+a*a,d=((o-t)*r+(n-e)*a)/h;d>1?d=1:0>d&&(d=0);var l=t+d*r,c=e+d*a,p=l-o,u=c-n;return Math.sqrt(p*p+u*u)},s.prototype.setScale=function(t){this.networkScaleInv=1/t},s.prototype.select=function(){this.selected=!0},s.prototype.unselect=function(){this.selected=!1},s.prototype.positionBezierNode=function(){null!==this.via&&null!==this.from&&null!==this.to?(this.via.x=.5*(this.from.x+this.to.x),this.via.y=.5*(this.from.y+this.to.y)):null!==this.via&&(this.via.x=0,this.via.y=0)},s.prototype._drawControlNodes=function(t){if(1==this.controlNodesEnabled){if(null===this.controlNodes.from&&null===this.controlNodes.to){var e="edgeIdFrom:".concat(this.id),i="edgeIdTo:".concat(this.id),s={nodes:{group:"",radius:7,borderWidth:2,borderWidthSelected:2},physics:{damping:0},clustering:{maxNodeSizeIncrements:0,nodeScaling:{width:0,height:0,radius:0}}};this.controlNodes.from=new n({id:e,shape:"dot",color:{background:"#ff0000",border:"#3c3c3c",highlight:{background:"#07f968"}}},{},{},s),this.controlNodes.to=new n({id:i,shape:"dot",color:{background:"#ff0000",border:"#3c3c3c",highlight:{background:"#07f968"}}},{},{},s)}this.controlNodes.positions={},0==this.controlNodes.from.selected&&(this.controlNodes.positions.from=this.getControlNodeFromPosition(t),this.controlNodes.from.x=this.controlNodes.positions.from.x,this.controlNodes.from.y=this.controlNodes.positions.from.y),0==this.controlNodes.to.selected&&(this.controlNodes.positions.to=this.getControlNodeToPosition(t),this.controlNodes.to.x=this.controlNodes.positions.to.x,this.controlNodes.to.y=this.controlNodes.positions.to.y),this.controlNodes.from.draw(t),this.controlNodes.to.draw(t)}else this.controlNodes={from:null,to:null,positions:{}}},s.prototype._enableControlNodes=function(){this.fromBackup=this.from,this.toBackup=this.to,this.controlNodesEnabled=!0},s.prototype._disableControlNodes=function(){this.fromId=this.from.id,this.toId=this.to.id,this.fromId!=this.fromBackup.id?this.fromBackup.detachEdge(this):this.toId!=this.toBackup.id&&this.toBackup.detachEdge(this),this.fromBackup=null,this.toBackup=null,this.controlNodesEnabled=!1},s.prototype._getSelectedControlNode=function(t,e){var i=this.controlNodes.positions,s=Math.sqrt(Math.pow(t-i.from.x,2)+Math.pow(e-i.from.y,2)),o=Math.sqrt(Math.pow(t-i.to.x,2)+Math.pow(e-i.to.y,2));return 15>s?(this.connectedNode=this.from,this.from=this.controlNodes.from,this.controlNodes.from):15>o?(this.connectedNode=this.to,this.to=this.controlNodes.to,this.controlNodes.to):null},s.prototype._restoreControlNodes=function(){1==this.controlNodes.from.selected?(this.from=this.connectedNode,this.connectedNode=null,this.controlNodes.from.unselect()):1==this.controlNodes.to.selected&&(this.to=this.connectedNode,this.connectedNode=null,this.controlNodes.to.unselect())},s.prototype.getControlNodeFromPosition=function(t){var e;if(1==this.options.smoothCurves.enabled)e=this._findBorderPosition(!0,t);else{var i=Math.atan2(this.to.y-this.from.y,this.to.x-this.from.x),s=this.to.x-this.from.x,o=this.to.y-this.from.y,n=Math.sqrt(s*s+o*o),r=this.from.distanceToBorder(t,i+Math.PI),a=(n-r)/n;e={},e.x=a*this.from.x+(1-a)*this.to.x,e.y=a*this.from.y+(1-a)*this.to.y}return e},s.prototype.getControlNodeToPosition=function(t){var e;if(1==this.options.smoothCurves.enabled)e=this._findBorderPosition(!1,t);else{var i=Math.atan2(this.to.y-this.from.y,this.to.x-this.from.x),s=this.to.x-this.from.x,o=this.to.y-this.from.y,n=Math.sqrt(s*s+o*o),r=this.to.distanceToBorder(t,i),a=(n-r)/n;e={},e.x=(1-a)*this.from.x+a*this.to.x,e.y=(1-a)*this.from.y+a*this.to.y}return e},t.exports=s},function(t,e,i){function s(){this.clear(),this.defaultIndex=0}i(1);s.DEFAULT=[{border:"#2B7CE9",background:"#97C2FC",highlight:{border:"#2B7CE9",background:"#D2E5FF"},hover:{border:"#2B7CE9",background:"#D2E5FF"}},{border:"#FFA500",background:"#FFFF00",highlight:{border:"#FFA500",background:"#FFFFA3"},hover:{border:"#FFA500",background:"#FFFFA3"}},{border:"#FA0A10",background:"#FB7E81",highlight:{border:"#FA0A10",background:"#FFAFB1"},hover:{border:"#FA0A10",background:"#FFAFB1"}},{border:"#41A906",background:"#7BE141",highlight:{border:"#41A906",background:"#A1EC76"},hover:{border:"#41A906",background:"#A1EC76"}},{border:"#E129F0",background:"#EB7DF4",highlight:{border:"#E129F0",background:"#F0B3F5"},hover:{border:"#E129F0",background:"#F0B3F5"}},{border:"#7C29F0",background:"#AD85E4",highlight:{border:"#7C29F0",background:"#D3BDF0"},hover:{border:"#7C29F0",background:"#D3BDF0"}},{border:"#C37F00",background:"#FFA807",highlight:{border:"#C37F00",background:"#FFCA66"},hover:{border:"#C37F00",background:"#FFCA66"}},{border:"#4220FB",background:"#6E6EFD",highlight:{border:"#4220FB",background:"#9B9BFD"},hover:{border:"#4220FB",background:"#9B9BFD"}},{border:"#FD5A77",background:"#FFC0CB",highlight:{border:"#FD5A77",background:"#FFD1D9"},hover:{border:"#FD5A77",background:"#FFD1D9"}},{border:"#4AD63A",background:"#C2FABC",highlight:{border:"#4AD63A",background:"#E6FFE3"},hover:{border:"#4AD63A",background:"#E6FFE3"}}],s.prototype.clear=function(){this.groups={},this.groups.length=function(){var t=0;for(var e in this)this.hasOwnProperty(e)&&t++;return t}},s.prototype.get=function(t){var e=this.groups[t];if(void 0==e){var i=this.defaultIndex%s.DEFAULT.length;this.defaultIndex++,e={},e.color=s.DEFAULT[i],this.groups[t]=e}return e},s.prototype.add=function(t,e){return this.groups[t]=e,e},t.exports=s},function(t){function e(){this.images={},this.imageBroken={},this.callback=void 0}e.prototype.setOnloadCallback=function(t){this.callback=t},e.prototype.load=function(t,e){var i=this.images[t];if(void 0===i){var s=this;i=new Image,i.onload=function(){0==this.width&&(document.body.appendChild(this),this.width=this.offsetWidth,this.height=this.offsetHeight,document.body.removeChild(this)),s.callback&&(s.images[t]=i,s.callback(this))},i.onerror=function(){void 0===e?(console.error("Could not load image:",t),delete this.src,s.callback&&s.callback(this)):s.imageBroken[t]===!0?(console.error("Could not load brokenImage:",e),delete this.src,s.callback&&s.callback(this)):(this.src=e,s.imageBroken[t]=!0)},i.src=t}return i},t.exports=e},function(t,e,i){function s(t,e,i,s){var n=o.selectiveBridgeObject(["nodes"],s);this.options=n.nodes,this.selected=!1,this.hover=!1,this.edges=[],this.dynamicEdges=[],this.reroutedEdges={},this.fontDrawThreshold=3,this.id=void 0,this.allowedToMoveX=!1,this.allowedToMoveY=!1,this.xFixed=!1,this.yFixed=!1,this.horizontalAlignLeft=!0,this.verticalAlignTop=!0,this.baseRadiusValue=s.nodes.radius,this.radiusFixed=!1,this.level=-1,this.preassignedLevel=!1,this.hierarchyEnumerated=!1,this.labelDimensions={top:0,left:0,width:0,height:0,yLine:0},this.boundingBox={top:0,left:0,right:0,bottom:0},this.imagelist=e,this.grouplist=i,this.fx=0,this.fy=0,this.vx=0,this.vy=0,this.x=null,this.y=null,this.previousState={vx:0,vy:0,x:0,y:0},this.damping=s.physics.damping,this.fixedData={x:null,y:null},this.setProperties(t,n),this.resetCluster(),this.dynamicEdgesLength=0,this.clusterSession=0,this.clusterSizeWidthFactor=s.clustering.nodeScaling.width,this.clusterSizeHeightFactor=s.clustering.nodeScaling.height,this.clusterSizeRadiusFactor=s.clustering.nodeScaling.radius,this.maxNodeSizeIncrements=s.clustering.maxNodeSizeIncrements,this.growthIndicator=0,this.networkScaleInv=1,this.networkScale=1,this.canvasTopLeft={x:-300,y:-300},this.canvasBottomRight={x:300,y:300},this.parentEdgeId=null}var o=i(1);s.prototype.revertPosition=function(){this.x=this.previousState.x,this.y=this.previousState.y,this.vx=this.previousState.vx,this.vy=this.previousState.vy},s.prototype.resetCluster=function(){this.formationScale=void 0,this.clusterSize=1,this.containedNodes={},this.containedEdges={},this.clusterSessions=[]},s.prototype.attachEdge=function(t){-1==this.edges.indexOf(t)&&this.edges.push(t),-1==this.dynamicEdges.indexOf(t)&&this.dynamicEdges.push(t),this.dynamicEdgesLength=this.dynamicEdges.length},s.prototype.detachEdge=function(t){var e=this.edges.indexOf(t);-1!=e&&this.edges.splice(e,1),e=this.dynamicEdges.indexOf(t),-1!=e&&this.dynamicEdges.splice(e,1),this.dynamicEdgesLength=this.dynamicEdges.length},s.prototype.setProperties=function(t,e){if(t){var i=["borderWidth","borderWidthSelected","shape","image","brokenImage","radius","fontColor","fontSize","fontFace","fontFill","fontStrokeWidth","fontStrokeColor","group","mass"];if(o.selectiveDeepExtend(i,this.options,t),void 0!==t.id&&(this.id=t.id),void 0!==t.label&&(this.label=t.label,this.originalLabel=t.label),void 0!==t.title&&(this.title=t.title),void 0!==t.x&&(this.x=t.x),void 0!==t.y&&(this.y=t.y),void 0!==t.value&&(this.value=t.value),void 0!==t.level&&(this.level=t.level,this.preassignedLevel=!0),void 0!==t.horizontalAlignLeft&&(this.horizontalAlignLeft=t.horizontalAlignLeft),void 0!==t.verticalAlignTop&&(this.verticalAlignTop=t.verticalAlignTop),void 0!==t.triggerFunction&&(this.triggerFunction=t.triggerFunction),void 0===this.id)throw"Node must have an id";if("number"==typeof t.group||"string"==typeof t.group&&""!=t.group){var s=this.grouplist.get(t.group);o.deepExtend(this.options,s),this.options.color=o.parseColor(this.options.color)}if(void 0!==t.radius&&(this.baseRadiusValue=this.options.radius),void 0!==t.color&&(this.options.color=o.parseColor(t.color)),void 0!==this.options.image&&""!=this.options.image){if(!this.imagelist)throw"No imagelist provided";this.imageObj=this.imagelist.load(this.options.image,this.options.brokenImage)}switch(void 0!==t.allowedToMoveX?(this.xFixed=!t.allowedToMoveX,this.allowedToMoveX=t.allowedToMoveX):void 0!==t.x&&0==this.allowedToMoveX&&(this.xFixed=!0),void 0!==t.allowedToMoveY?(this.yFixed=!t.allowedToMoveY,this.allowedToMoveY=t.allowedToMoveY):void 0!==t.y&&0==this.allowedToMoveY&&(this.yFixed=!0),this.radiusFixed=this.radiusFixed||void 0!==t.radius,("image"===this.options.shape||"circularImage"===this.options.shape)&&(this.options.radiusMin=e.nodes.widthMin,this.options.radiusMax=e.nodes.widthMax),this.options.shape){case"database":this.draw=this._drawDatabase,this.resize=this._resizeDatabase;break;case"box":this.draw=this._drawBox,this.resize=this._resizeBox;break;case"circle":this.draw=this._drawCircle,this.resize=this._resizeCircle;break;case"ellipse":this.draw=this._drawEllipse,this.resize=this._resizeEllipse;break;case"image":this.draw=this._drawImage,this.resize=this._resizeImage;break;case"circularImage":this.draw=this._drawCircularImage,this.resize=this._resizeCircularImage;break;case"text":this.draw=this._drawText,this.resize=this._resizeText;break;case"dot":this.draw=this._drawDot,this.resize=this._resizeShape;break;case"square":this.draw=this._drawSquare,this.resize=this._resizeShape;break;case"triangle":this.draw=this._drawTriangle,this.resize=this._resizeShape;break;case"triangleDown":this.draw=this._drawTriangleDown,this.resize=this._resizeShape;break;case"star":this.draw=this._drawStar,this.resize=this._resizeShape;break;default:this.draw=this._drawEllipse,this.resize=this._resizeEllipse}this._reset()}},s.prototype.select=function(){this.selected=!0,this._reset()},s.prototype.unselect=function(){this.selected=!1,this._reset()},s.prototype.clearSizeCache=function(){this._reset()},s.prototype._reset=function(){this.width=void 0,this.height=void 0},s.prototype.getTitle=function(){return"function"==typeof this.title?this.title():this.title},s.prototype.distanceToBorder=function(t,e){var i=1;switch(this.width||this.resize(t),this.options.shape){case"circle":case"dot":return this.options.radius+i;case"ellipse":var s=this.width/2,o=this.height/2,n=Math.sin(e)*s,r=Math.cos(e)*o;return s*o/Math.sqrt(n*n+r*r);case"box":case"image":case"text":default:return this.width?Math.min(Math.abs(this.width/2/Math.cos(e)),Math.abs(this.height/2/Math.sin(e)))+i:0}},s.prototype._setForce=function(t,e){this.fx=t,this.fy=e},s.prototype._addForce=function(t,e){this.fx+=t,this.fy+=e},s.prototype.storeState=function(){this.previousState.x=this.x,this.previousState.y=this.y,this.previousState.vx=this.vx,this.previousState.vy=this.vy},s.prototype.discreteStep=function(t){if(this.storeState(),this.xFixed)this.fx=0,this.vx=0;else{var e=this.damping*this.vx,i=(this.fx-e)/this.options.mass;this.vx+=i*t,this.x+=this.vx*t}if(this.yFixed)this.fy=0,this.vy=0;else{var s=this.damping*this.vy,o=(this.fy-s)/this.options.mass;this.vy+=o*t,this.y+=this.vy*t}},s.prototype.discreteStepLimited=function(t,e){if(this.storeState(),this.xFixed)this.fx=0,this.vx=0;else{var i=this.damping*this.vx,s=(this.fx-i)/this.options.mass;this.vx+=s*t,this.vx=Math.abs(this.vx)>e?this.vx>0?e:-e:this.vx,this.x+=this.vx*t}if(this.yFixed)this.fy=0,this.vy=0;else{var o=this.damping*this.vy,n=(this.fy-o)/this.options.mass;this.vy+=n*t,this.vy=Math.abs(this.vy)>e?this.vy>0?e:-e:this.vy,this.y+=this.vy*t}},s.prototype.isFixed=function(){return this.xFixed&&this.yFixed},s.prototype.isMoving=function(t){var e=Math.sqrt(Math.pow(this.vx,2)+Math.pow(this.vy,2));return e>t},s.prototype.isSelected=function(){return this.selected},s.prototype.getValue=function(){return this.value},s.prototype.getDistance=function(t,e){var i=this.x-t,s=this.y-e;return Math.sqrt(i*i+s*s)},s.prototype.setValueRange=function(t,e){if(!this.radiusFixed&&void 0!==this.value)if(e==t)this.options.radius=(this.options.radiusMin+this.options.radiusMax)/2;else{var i=(this.options.radiusMax-this.options.radiusMin)/(e-t);this.options.radius=(this.value-t)*i+this.options.radiusMin}this.baseRadiusValue=this.options.radius},s.prototype.draw=function(){throw"Draw method not initialized for node"},s.prototype.resize=function(){throw"Resize method not initialized for node"},s.prototype.isOverlappingWith=function(t){return this.left<t.right&&this.left+this.width>t.left&&this.top<t.bottom&&this.top+this.height>t.top},s.prototype._resizeImage=function(){if(!this.width||!this.height){var t,e;if(this.value){this.options.radius=this.baseRadiusValue;var i=this.imageObj.height/this.imageObj.width;void 0!==i?(t=this.options.radius||this.imageObj.width,e=this.options.radius*i||this.imageObj.height):(t=0,e=0)}else t=this.imageObj.width,e=this.imageObj.height;this.width=t,this.height=e,this.growthIndicator=0,this.width>0&&this.height>0&&(this.width+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.options.radius+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.width-t)}},s.prototype._drawImageAtPosition=function(t){if(0!=this.imageObj.width){if(this.clusterSize>1){var e=this.clusterSize>1?10:0;e*=this.networkScaleInv,e=Math.min(.2*this.width,e),t.globalAlpha=.5,t.drawImage(this.imageObj,this.left-e,this.top-e,this.width+2*e,this.height+2*e)}t.globalAlpha=1,t.drawImage(this.imageObj,this.left,this.top,this.width,this.height)}},s.prototype._drawImageLabel=function(t){var e,i=0;if(this.height){i=this.height/2;var s=this.getTextSize(t);s.lineCount>=1&&(i+=s.height/2,i+=3)}e=this.y+i,this._label(t,this.label,this.x,e,void 0)},s.prototype._drawImage=function(t){this._resizeImage(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2,this._drawImageAtPosition(t),this.boundingBox.top=this.top,this.boundingBox.left=this.left,this.boundingBox.right=this.left+this.width,this.boundingBox.bottom=this.top+this.height,this._drawImageLabel(t),this.boundingBox.left=Math.min(this.boundingBox.left,this.labelDimensions.left),this.boundingBox.right=Math.max(this.boundingBox.right,this.labelDimensions.left+this.labelDimensions.width),this.boundingBox.bottom=Math.max(this.boundingBox.bottom,this.boundingBox.bottom+this.labelDimensions.height)},s.prototype._resizeCircularImage=function(t){if(this.imageObj.src&&this.imageObj.width&&this.imageObj.height)this._swapToImageResizeWhenImageLoaded&&(this.width=0,this.height=0,delete this._swapToImageResizeWhenImageLoaded),this._resizeImage(t);else if(!this.width){var e=2*this.options.radius;this.width=e,this.height=e,this.options.radius+=.5*Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.options.radius-.5*e,this._swapToImageResizeWhenImageLoaded=!0}},s.prototype._drawCircularImage=function(t){this._resizeCircularImage(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2;var e=this.left+this.width/2,i=this.top+this.height/2,s=Math.abs(this.height/2);this._drawRawCircle(t,e,i,s),t.save(),t.circle(this.x,this.y,s),t.stroke(),t.clip(),this._drawImageAtPosition(t),t.restore(),this.boundingBox.top=this.y-this.options.radius,this.boundingBox.left=this.x-this.options.radius,this.boundingBox.right=this.x+this.options.radius,this.boundingBox.bottom=this.y+this.options.radius,this._drawImageLabel(t),this.boundingBox.left=Math.min(this.boundingBox.left,this.labelDimensions.left),this.boundingBox.right=Math.max(this.boundingBox.right,this.labelDimensions.left+this.labelDimensions.width),this.boundingBox.bottom=Math.max(this.boundingBox.bottom,this.boundingBox.bottom+this.labelDimensions.height)},s.prototype._resizeBox=function(t){if(!this.width){var e=5,i=this.getTextSize(t);this.width=i.width+2*e,this.height=i.height+2*e,this.width+=.5*Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=.5*Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.growthIndicator=this.width-(i.width+2*e)}},s.prototype._drawBox=function(t){this._resizeBox(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2;var e=2.5,i=this.options.borderWidth,s=this.options.borderWidthSelected||2*this.options.borderWidth;t.strokeStyle=this.selected?this.options.color.highlight.border:this.hover?this.options.color.hover.border:this.options.color.border,this.clusterSize>1&&(t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.roundRect(this.left-2*t.lineWidth,this.top-2*t.lineWidth,this.width+4*t.lineWidth,this.height+4*t.lineWidth,this.options.radius),t.stroke()),t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.fillStyle=this.selected?this.options.color.highlight.background:this.hover?this.options.color.hover.background:this.options.color.background,t.roundRect(this.left,this.top,this.width,this.height,this.options.radius),t.fill(),t.stroke(),this.boundingBox.top=this.top,this.boundingBox.left=this.left,this.boundingBox.right=this.left+this.width,this.boundingBox.bottom=this.top+this.height,this._label(t,this.label,this.x,this.y)},s.prototype._resizeDatabase=function(t){if(!this.width){var e=5,i=this.getTextSize(t),s=i.width+2*e;this.width=s,this.height=s,this.width+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.options.radius+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.width-s}},s.prototype._drawDatabase=function(t){this._resizeDatabase(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2;
var e=2.5,i=this.options.borderWidth,s=this.options.borderWidthSelected||2*this.options.borderWidth;t.strokeStyle=this.selected?this.options.color.highlight.border:this.hover?this.options.color.hover.border:this.options.color.border,this.clusterSize>1&&(t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.database(this.x-this.width/2-2*t.lineWidth,this.y-.5*this.height-2*t.lineWidth,this.width+4*t.lineWidth,this.height+4*t.lineWidth),t.stroke()),t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.fillStyle=this.selected?this.options.color.highlight.background:this.hover?this.options.color.hover.background:this.options.color.background,t.database(this.x-this.width/2,this.y-.5*this.height,this.width,this.height),t.fill(),t.stroke(),this.boundingBox.top=this.top,this.boundingBox.left=this.left,this.boundingBox.right=this.left+this.width,this.boundingBox.bottom=this.top+this.height,this._label(t,this.label,this.x,this.y)},s.prototype._resizeCircle=function(t){if(!this.width){var e=5,i=this.getTextSize(t),s=Math.max(i.width,i.height)+2*e;this.options.radius=s/2,this.width=s,this.height=s,this.options.radius+=.5*Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.options.radius-.5*s}},s.prototype._drawRawCircle=function(t,e,i,s){var o=2.5,n=this.options.borderWidth,r=this.options.borderWidthSelected||2*this.options.borderWidth;t.strokeStyle=this.selected?this.options.color.highlight.border:this.hover?this.options.color.hover.border:this.options.color.border,this.clusterSize>1&&(t.lineWidth=(this.selected?r:n)+(this.clusterSize>1?o:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.circle(e,i,s+2*t.lineWidth),t.stroke()),t.lineWidth=(this.selected?r:n)+(this.clusterSize>1?o:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.fillStyle=this.selected?this.options.color.highlight.background:this.hover?this.options.color.hover.background:this.options.color.background,t.circle(this.x,this.y,s),t.fill(),t.stroke()},s.prototype._drawCircle=function(t){this._resizeCircle(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2,this._drawRawCircle(t,this.x,this.y,this.options.radius),this.boundingBox.top=this.y-this.options.radius,this.boundingBox.left=this.x-this.options.radius,this.boundingBox.right=this.x+this.options.radius,this.boundingBox.bottom=this.y+this.options.radius,this._label(t,this.label,this.x,this.y)},s.prototype._resizeEllipse=function(t){if(!this.width){var e=this.getTextSize(t);this.width=1.5*e.width,this.height=2*e.height,this.width<this.height&&(this.width=this.height);var i=this.width;this.width+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.options.radius+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.width-i}},s.prototype._drawEllipse=function(t){this._resizeEllipse(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2;var e=2.5,i=this.options.borderWidth,s=this.options.borderWidthSelected||2*this.options.borderWidth;t.strokeStyle=this.selected?this.options.color.highlight.border:this.hover?this.options.color.hover.border:this.options.color.border,this.clusterSize>1&&(t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.ellipse(this.left-2*t.lineWidth,this.top-2*t.lineWidth,this.width+4*t.lineWidth,this.height+4*t.lineWidth),t.stroke()),t.lineWidth=(this.selected?s:i)+(this.clusterSize>1?e:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.fillStyle=this.selected?this.options.color.highlight.background:this.hover?this.options.color.hover.background:this.options.color.background,t.ellipse(this.left,this.top,this.width,this.height),t.fill(),t.stroke(),this.boundingBox.top=this.top,this.boundingBox.left=this.left,this.boundingBox.right=this.left+this.width,this.boundingBox.bottom=this.top+this.height,this._label(t,this.label,this.x,this.y)},s.prototype._drawDot=function(t){this._drawShape(t,"circle")},s.prototype._drawTriangle=function(t){this._drawShape(t,"triangle")},s.prototype._drawTriangleDown=function(t){this._drawShape(t,"triangleDown")},s.prototype._drawSquare=function(t){this._drawShape(t,"square")},s.prototype._drawStar=function(t){this._drawShape(t,"star")},s.prototype._resizeShape=function(){if(!this.width){this.options.radius=this.baseRadiusValue;var t=2*this.options.radius;this.width=t,this.height=t,this.width+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.options.radius+=.5*Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.width-t}},s.prototype._drawShape=function(t,e){this._resizeShape(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2;var i=2.5,s=this.options.borderWidth,o=this.options.borderWidthSelected||2*this.options.borderWidth,n=2;switch(e){case"dot":n=2;break;case"square":n=2;break;case"triangle":n=3;break;case"triangleDown":n=3;break;case"star":n=4}t.strokeStyle=this.selected?this.options.color.highlight.border:this.hover?this.options.color.hover.border:this.options.color.border,this.clusterSize>1&&(t.lineWidth=(this.selected?o:s)+(this.clusterSize>1?i:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t[e](this.x,this.y,this.options.radius+n*t.lineWidth),t.stroke()),t.lineWidth=(this.selected?o:s)+(this.clusterSize>1?i:0),t.lineWidth*=this.networkScaleInv,t.lineWidth=Math.min(this.width,t.lineWidth),t.fillStyle=this.selected?this.options.color.highlight.background:this.hover?this.options.color.hover.background:this.options.color.background,t[e](this.x,this.y,this.options.radius),t.fill(),t.stroke(),this.boundingBox.top=this.y-this.options.radius,this.boundingBox.left=this.x-this.options.radius,this.boundingBox.right=this.x+this.options.radius,this.boundingBox.bottom=this.y+this.options.radius,this.label&&(this._label(t,this.label,this.x,this.y+this.height/2,void 0,"hanging",!0),this.boundingBox.left=Math.min(this.boundingBox.left,this.labelDimensions.left),this.boundingBox.right=Math.max(this.boundingBox.right,this.labelDimensions.left+this.labelDimensions.width),this.boundingBox.bottom=Math.max(this.boundingBox.bottom,this.boundingBox.bottom+this.labelDimensions.height))},s.prototype._resizeText=function(t){if(!this.width){var e=5,i=this.getTextSize(t);this.width=i.width+2*e,this.height=i.height+2*e,this.width+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeWidthFactor,this.height+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeHeightFactor,this.options.radius+=Math.min(this.clusterSize-1,this.maxNodeSizeIncrements)*this.clusterSizeRadiusFactor,this.growthIndicator=this.width-(i.width+2*e)}},s.prototype._drawText=function(t){this._resizeText(t),this.left=this.x-this.width/2,this.top=this.y-this.height/2,this._label(t,this.label,this.x,this.y),this.boundingBox.top=this.top,this.boundingBox.left=this.left,this.boundingBox.right=this.left+this.width,this.boundingBox.bottom=this.top+this.height},s.prototype._label=function(t,e,i,s,o,n,r){if(e&&Number(this.options.fontSize)*this.networkScale>this.fontDrawThreshold){t.font=(this.selected?"bold ":"")+this.options.fontSize+"px "+this.options.fontFace;var a=e.split("\n"),h=a.length,d=Number(this.options.fontSize),l=s+(1-h)/2*d;1==r&&(l=s+(1-h)/(2*d));for(var c=t.measureText(a[0]).width,p=1;h>p;p++){var u=t.measureText(a[p]).width;c=u>c?u:c}var m=this.options.fontSize*h,f=i-c/2,g=s-m/2;"hanging"==n&&(g+=.5*d,g+=4,l+=4),this.labelDimensions={top:g,left:f,width:c,height:m,yLine:l},void 0!==this.options.fontFill&&null!==this.options.fontFill&&"none"!==this.options.fontFill&&(t.fillStyle=this.options.fontFill,t.fillRect(f,g,c,m)),t.fillStyle=this.options.fontColor||"black",t.textAlign=o||"center",t.textBaseline=n||"middle",this.options.fontStrokeWidth>0&&(t.lineWidth=this.options.fontStrokeWidth,t.strokeStyle=this.options.fontStrokeColor,t.lineJoin="round");for(var p=0;h>p;p++)this.options.fontStrokeWidth&&t.strokeText(a[p],i,l),t.fillText(a[p],i,l),l+=d}},s.prototype.getTextSize=function(t){if(void 0!==this.label){t.font=(this.selected?"bold ":"")+this.options.fontSize+"px "+this.options.fontFace;for(var e=this.label.split("\n"),i=(Number(this.options.fontSize)+4)*e.length,s=0,o=0,n=e.length;n>o;o++)s=Math.max(s,t.measureText(e[o]).width);return{width:s,height:i,lineCount:e.length}}return{width:0,height:0,lineCount:0}},s.prototype.inArea=function(){return void 0!==this.width?this.x+this.width*this.networkScaleInv>=this.canvasTopLeft.x&&this.x-this.width*this.networkScaleInv<this.canvasBottomRight.x&&this.y+this.height*this.networkScaleInv>=this.canvasTopLeft.y&&this.y-this.height*this.networkScaleInv<this.canvasBottomRight.y:!0},s.prototype.inView=function(){return this.x>=this.canvasTopLeft.x&&this.x<this.canvasBottomRight.x&&this.y>=this.canvasTopLeft.y&&this.y<this.canvasBottomRight.y},s.prototype.setScaleAndPos=function(t,e,i){this.networkScaleInv=1/t,this.networkScale=t,this.canvasTopLeft=e,this.canvasBottomRight=i},s.prototype.setScale=function(t){this.networkScaleInv=1/t,this.networkScale=t},s.prototype.clearVelocity=function(){this.vx=0,this.vy=0},s.prototype.updateVelocity=function(t){var e=this.vx*this.vx*t;this.vx=Math.sqrt(e/this.options.mass),e=this.vy*this.vy*t,this.vy=Math.sqrt(e/this.options.mass)},t.exports=s},function(t){function e(t,e,i,s,o){this.container=t?t:document.body,void 0===o&&("object"==typeof e?(o=e,e=void 0):"object"==typeof s?(o=s,s=void 0):o={fontColor:"black",fontSize:14,fontFace:"verdana",color:{border:"#666",background:"#FFFFC6"}}),this.x=0,this.y=0,this.padding=5,void 0!==e&&void 0!==i&&this.setPosition(e,i),void 0!==s&&this.setText(s),this.frame=document.createElement("div");var n=this.frame.style;n.position="absolute",n.visibility="hidden",n.border="1px solid "+o.color.border,n.color=o.fontColor,n.fontSize=o.fontSize+"px",n.fontFamily=o.fontFace,n.padding=this.padding+"px",n.backgroundColor=o.color.background,n.borderRadius="3px",n.MozBorderRadius="3px",n.WebkitBorderRadius="3px",n.boxShadow="3px 3px 10px rgba(128, 128, 128, 0.5)",n.whiteSpace="nowrap",this.container.appendChild(this.frame)}e.prototype.setPosition=function(t,e){this.x=parseInt(t),this.y=parseInt(e)},e.prototype.setText=function(t){t instanceof Element?(this.frame.innerHTML="",this.frame.appendChild(t)):this.frame.innerHTML=t},e.prototype.show=function(t){if(void 0===t&&(t=!0),t){var e=this.frame.clientHeight,i=this.frame.clientWidth,s=this.frame.parentNode.clientHeight,o=this.frame.parentNode.clientWidth,n=this.y-e;n+e+this.padding>s&&(n=s-e-this.padding),n<this.padding&&(n=this.padding);var r=this.x;r+i+this.padding>o&&(r=o-i-this.padding),r<this.padding&&(r=this.padding),this.frame.style.left=r+"px",this.frame.style.top=n+"px",this.frame.style.visibility="visible"}else this.hide()},e.prototype.hide=function(){this.frame.style.visibility="hidden"},t.exports=e},function(t,e){function i(t){return T=t,u()}function s(){O=0,E=T.charAt(0)}function o(){O++,E=T.charAt(O)}function n(){return T.charAt(O+1)}function r(t){return L.test(t)}function a(t,e){if(t||(t={}),e)for(var i in e)e.hasOwnProperty(i)&&(t[i]=e[i]);return t}function h(t,e,i){for(var s=e.split("."),o=t;s.length;){var n=s.shift();s.length?(o[n]||(o[n]={}),o=o[n]):o[n]=i}}function d(t,e){for(var i,s,o=null,n=[t],r=t;r.parent;)n.push(r.parent),r=r.parent;if(r.nodes)for(i=0,s=r.nodes.length;s>i;i++)if(e.id===r.nodes[i].id){o=r.nodes[i];break}for(o||(o={id:e.id},t.node&&(o.attr=a(o.attr,t.node))),i=n.length-1;i>=0;i--){var h=n[i];h.nodes||(h.nodes=[]),-1==h.nodes.indexOf(o)&&h.nodes.push(o)}e.attr&&(o.attr=a(o.attr,e.attr))}function l(t,e){if(t.edges||(t.edges=[]),t.edges.push(e),t.edge){var i=a({},t.edge);e.attr=a(i,e.attr)}}function c(t,e,i,s,o){var n={from:e,to:i,type:s};return t.edge&&(n.attr=a({},t.edge)),n.attr=a(n.attr||{},o),n}function p(){for(N=D.NULL,k="";" "==E||"	"==E||"\n"==E||"\r"==E;)o();do{var t=!1;if("#"==E){for(var e=O-1;" "==T.charAt(e)||"	"==T.charAt(e);)e--;if("\n"==T.charAt(e)||""==T.charAt(e)){for(;""!=E&&"\n"!=E;)o();t=!0}}if("/"==E&&"/"==n()){for(;""!=E&&"\n"!=E;)o();t=!0}if("/"==E&&"*"==n()){for(;""!=E;){if("*"==E&&"/"==n()){o(),o();break}o()}t=!0}for(;" "==E||"	"==E||"\n"==E||"\r"==E;)o()}while(t);if(""==E)return void(N=D.DELIMITER);var i=E+n();if(C[i])return N=D.DELIMITER,k=i,o(),void o();if(C[E])return N=D.DELIMITER,k=E,void o();if(r(E)||"-"==E){for(k+=E,o();r(E);)k+=E,o();return"false"==k?k=!1:"true"==k?k=!0:isNaN(Number(k))||(k=Number(k)),void(N=D.IDENTIFIER)}if('"'==E){for(o();""!=E&&('"'!=E||'"'==E&&'"'==n());)k+=E,'"'==E&&o(),o();if('"'!=E)throw x('End of string " expected');return o(),void(N=D.IDENTIFIER)}for(N=D.UNKNOWN;""!=E;)k+=E,o();throw new SyntaxError('Syntax error in part "'+w(k,30)+'"')}function u(){var t={};if(s(),p(),"strict"==k&&(t.strict=!0,p()),("graph"==k||"digraph"==k)&&(t.type=k,p()),N==D.IDENTIFIER&&(t.id=k,p()),"{"!=k)throw x("Angle bracket { expected");if(p(),m(t),"}"!=k)throw x("Angle bracket } expected");if(p(),""!==k)throw x("End of file expected");return p(),delete t.node,delete t.edge,delete t.graph,t}function m(t){for(;""!==k&&"}"!=k;)f(t),";"==k&&p()}function f(t){var e=g(t);if(e)return void b(t,e);var i=v(t);if(!i){if(N!=D.IDENTIFIER)throw x("Identifier expected");var s=k;if(p(),"="==k){if(p(),N!=D.IDENTIFIER)throw x("Identifier expected");t[s]=k,p()}else y(t,s)}}function g(t){var e=null;if("subgraph"==k&&(e={},e.type="subgraph",p(),N==D.IDENTIFIER&&(e.id=k,p())),"{"==k){if(p(),e||(e={}),e.parent=t,e.node=t.node,e.edge=t.edge,e.graph=t.graph,m(e),"}"!=k)throw x("Angle bracket } expected");p(),delete e.node,delete e.edge,delete e.graph,delete e.parent,t.subgraphs||(t.subgraphs=[]),t.subgraphs.push(e)}return e}function v(t){return"node"==k?(p(),t.node=_(),"node"):"edge"==k?(p(),t.edge=_(),"edge"):"graph"==k?(p(),t.graph=_(),"graph"):null}function y(t,e){var i={id:e},s=_();s&&(i.attr=s),d(t,i),b(t,e)}function b(t,e){for(;"->"==k||"--"==k;){var i,s=k;p();var o=g(t);if(o)i=o;else{if(N!=D.IDENTIFIER)throw x("Identifier or subgraph expected");i=k,d(t,{id:i}),p()}var n=_(),r=c(t,e,i,s,n);l(t,r),e=i}}function _(){for(var t=null;"["==k;){for(p(),t={};""!==k&&"]"!=k;){if(N!=D.IDENTIFIER)throw x("Attribute name expected");var e=k;if(p(),"="!=k)throw x("Equal sign = expected");if(p(),N!=D.IDENTIFIER)throw x("Attribute value expected");var i=k;h(t,e,i),p(),","==k&&p()}if("]"!=k)throw x("Bracket ] expected");p()}return t}function x(t){return new SyntaxError(t+', got "'+w(k,30)+'" (char '+O+")")}function w(t,e){return t.length<=e?t:t.substr(0,27)+"..."}function M(t,e,i){Array.isArray(t)?t.forEach(function(t){Array.isArray(e)?e.forEach(function(e){i(t,e)}):i(t,e)}):Array.isArray(e)?e.forEach(function(e){i(t,e)}):i(t,e)}function S(t){var e=i(t),s={nodes:[],edges:[],options:{}};if(e.nodes&&e.nodes.forEach(function(t){var e={id:t.id,label:String(t.label||t.id)};a(e,t.attr),e.image&&(e.shape="image"),s.nodes.push(e)}),e.edges){var o=function(t){var e={from:t.from,to:t.to};return a(e,t.attr),e.style="->"==t.type?"arrow":"line",e};e.edges.forEach(function(t){var e,i;e=t.from instanceof Object?t.from.nodes:{id:t.from},i=t.to instanceof Object?t.to.nodes:{id:t.to},t.from instanceof Object&&t.from.edges&&t.from.edges.forEach(function(t){var e=o(t);s.edges.push(e)}),M(e,i,function(e,i){var n=c(s,e.id,i.id,t.type,t.attr),r=o(n);s.edges.push(r)}),t.to instanceof Object&&t.to.edges&&t.to.edges.forEach(function(t){var e=o(t);s.edges.push(e)})})}return e.attr&&(s.options=e.attr),s}var D={NULL:0,DELIMITER:1,IDENTIFIER:2,UNKNOWN:3},C={"{":!0,"}":!0,"[":!0,"]":!0,";":!0,"=":!0,",":!0,"->":!0,"--":!0},T="",O=0,E="",k="",N=D.NULL,L=/[a-zA-Z_0-9.:#]/;e.parseDOT=i,e.DOTToGraph=S},function(t,e){function i(t,e){var i=[],s=[];this.options={edges:{inheritColor:!0},nodes:{allowedToMove:!1,parseColor:!1}},void 0!==e&&(this.options.nodes.allowedToMove=e.allowedToMove|!1,this.options.nodes.parseColor=e.parseColor|!1,this.options.edges.inheritColor=e.inheritColor|!0);for(var o=t.edges,n=t.nodes,r=0;r<o.length;r++){var a={},h=o[r];a.id=h.id,a.from=h.source,a.to=h.target,a.attributes=h.attributes,a.color=h.color,a.inheritColor=void 0!==a.color?!1:this.options.inheritColor,i.push(a)}for(var r=0;r<n.length;r++){var d={},l=n[r];d.id=l.id,d.attributes=l.attributes,d.x=l.x,d.y=l.y,d.label=l.label,d.color=1==this.options.nodes.parseColor?l.color:void 0!==l.color?{background:l.color,border:l.color}:void 0,d.radius=l.size,d.allowedToMoveX=this.options.nodes.allowedToMove,d.allowedToMoveY=this.options.nodes.allowedToMove,s.push(d)}return{nodes:s,edges:i}}e.parseGephi=i},function(t,e,i){t.exports="undefined"!=typeof window&&window.moment||i(58)},function(t,e,i){t.exports="undefined"!=typeof window?window.Hammer||i(59):function(){throw Error("hammer.js is only available in a browser, not in node.js.")}},function(t,e,i){function s(){}var o=i(56),n=i(45),r=i(1),a=(i(3),i(4),i(17),i(32),i(53)),h=i(15);o(s.prototype),s.prototype._create=function(t){this.dom={},this.dom.root=document.createElement("div"),this.dom.background=document.createElement("div"),this.dom.backgroundVertical=document.createElement("div"),this.dom.backgroundHorizontal=document.createElement("div"),this.dom.centerContainer=document.createElement("div"),this.dom.leftContainer=document.createElement("div"),this.dom.rightContainer=document.createElement("div"),this.dom.center=document.createElement("div"),this.dom.left=document.createElement("div"),this.dom.right=document.createElement("div"),this.dom.top=document.createElement("div"),this.dom.bottom=document.createElement("div"),this.dom.shadowTop=document.createElement("div"),this.dom.shadowBottom=document.createElement("div"),this.dom.shadowTopLeft=document.createElement("div"),this.dom.shadowBottomLeft=document.createElement("div"),this.dom.shadowTopRight=document.createElement("div"),this.dom.shadowBottomRight=document.createElement("div"),this.dom.root.className="vis timeline root",this.dom.background.className="vispanel background",this.dom.backgroundVertical.className="vispanel background vertical",this.dom.backgroundHorizontal.className="vispanel background horizontal",this.dom.centerContainer.className="vispanel center",this.dom.leftContainer.className="vispanel left",this.dom.rightContainer.className="vispanel right",this.dom.top.className="vispanel top",this.dom.bottom.className="vispanel bottom",this.dom.left.className="content",this.dom.center.className="content",this.dom.right.className="content",this.dom.shadowTop.className="shadow top",this.dom.shadowBottom.className="shadow bottom",this.dom.shadowTopLeft.className="shadow top",this.dom.shadowBottomLeft.className="shadow bottom",this.dom.shadowTopRight.className="shadow top",this.dom.shadowBottomRight.className="shadow bottom",this.dom.root.appendChild(this.dom.background),this.dom.root.appendChild(this.dom.backgroundVertical),this.dom.root.appendChild(this.dom.backgroundHorizontal),this.dom.root.appendChild(this.dom.centerContainer),this.dom.root.appendChild(this.dom.leftContainer),this.dom.root.appendChild(this.dom.rightContainer),this.dom.root.appendChild(this.dom.top),this.dom.root.appendChild(this.dom.bottom),this.dom.centerContainer.appendChild(this.dom.center),this.dom.leftContainer.appendChild(this.dom.left),this.dom.rightContainer.appendChild(this.dom.right),this.dom.centerContainer.appendChild(this.dom.shadowTop),this.dom.centerContainer.appendChild(this.dom.shadowBottom),this.dom.leftContainer.appendChild(this.dom.shadowTopLeft),this.dom.leftContainer.appendChild(this.dom.shadowBottomLeft),this.dom.rightContainer.appendChild(this.dom.shadowTopRight),this.dom.rightContainer.appendChild(this.dom.shadowBottomRight),this.on("rangechange",this.redraw.bind(this)),this.on("touch",this._onTouch.bind(this)),this.on("pinch",this._onPinch.bind(this)),this.on("dragstart",this._onDragStart.bind(this)),this.on("drag",this._onDrag.bind(this));var e=this;this.on("change",function(t){t&&1==t.queue?e._redrawTimer||(e._redrawTimer=setTimeout(function(){e._redrawTimer=null,e.redraw()},0)):e.redraw()}),this.hammer=n(this.dom.root,{preventDefault:!0}),this.listeners={};var i=["touch","pinch","tap","doubletap","hold","dragstart","drag","dragend","mousewheel","DOMMouseScroll"];if(i.forEach(function(t){var i=function(){var i=[t].concat(Array.prototype.slice.call(arguments,0));e.isActive()&&e.emit.apply(e,i)};e.hammer.on(t,i),e.listeners[t]=i}),this.props={root:{},background:{},centerContainer:{},leftContainer:{},rightContainer:{},center:{},left:{},right:{},top:{},bottom:{},border:{},scrollTop:0,scrollTopMin:0},this.touch={},this.redrawCount=0,!t)throw new Error("No container provided");t.appendChild(this.dom.root)},s.prototype.setOptions=function(t){if(t){var e=["width","height","minHeight","maxHeight","autoResize","start","end","orientation","clickToUse","dataAttributes","hiddenDates"];r.selectiveExtend(e,this.options,t),"hiddenDates"in this.options&&h.convertHiddenOptions(this.body,this.options.hiddenDates),"clickToUse"in t&&(t.clickToUse?this.activator||(this.activator=new a(this.dom.root)):this.activator&&(this.activator.destroy(),delete this.activator)),this._initAutoResize()}if(this.components.forEach(function(e){e.setOptions(t)}),t&&t.order)throw new Error("Option order is deprecated. There is no replacement for this feature.");this.redraw()},s.prototype.isActive=function(){return!this.activator||this.activator.active},s.prototype.destroy=function(){this.clear(),this.off(),this._stopAutoResize(),this.dom.root.parentNode&&this.dom.root.parentNode.removeChild(this.dom.root),this.dom=null,this.activator&&(this.activator.destroy(),delete this.activator);for(var t in this.listeners)this.listeners.hasOwnProperty(t)&&delete this.listeners[t];this.listeners=null,this.hammer=null,this.components.forEach(function(t){t.destroy()}),this.body=null},s.prototype.setCustomTime=function(t){if(!this.customTime)throw new Error("Cannot get custom time: Custom time bar is not enabled");this.customTime.setCustomTime(t)},s.prototype.getCustomTime=function(){if(!this.customTime)throw new Error("Cannot get custom time: Custom time bar is not enabled");return this.customTime.getCustomTime()},s.prototype.getVisibleItems=function(){return this.itemSet&&this.itemSet.getVisibleItems()||[]},s.prototype.clear=function(t){(!t||t.items)&&this.setItems(null),(!t||t.groups)&&this.setGroups(null),(!t||t.options)&&(this.components.forEach(function(t){t.setOptions(t.defaultOptions)}),this.setOptions(this.defaultOptions))},s.prototype.fit=function(t){var e=this._getDataRange();if(null!==e.start||null!==e.end){var i=t&&void 0!==t.animate?t.animate:!0;this.range.setRange(e.start,e.end,i)}},s.prototype._getDataRange=function(){var t=this.getItemRange(),e=t.min,i=t.max;if(null!=e&&null!=i){var s=i.valueOf()-e.valueOf();0>=s&&(s=864e5),e=new Date(e.valueOf()-.05*s),i=new Date(i.valueOf()+.05*s)}return{start:e,end:i}},s.prototype.setWindow=function(t,e,i){var s=i&&void 0!==i.animate?i.animate:!0;if(1==arguments.length){var o=arguments[0];this.range.setRange(o.start,o.end,s)}else this.range.setRange(t,e,s)},s.prototype.moveTo=function(t,e){var i=this.range.end-this.range.start,s=r.convert(t,"Date").valueOf(),o=s-i/2,n=s+i/2,a=e&&void 0!==e.animate?e.animate:!0;this.range.setRange(o,n,a)},s.prototype.getWindow=function(){var t=this.range.getRange();return{start:new Date(t.start),end:new Date(t.end)}},s.prototype.redraw=function(){var t=!1,e=this.options,i=this.props,s=this.dom;if(s){h.updateHiddenDates(this.body,this.options.hiddenDates),"top"==e.orientation?(r.addClassName(s.root,"top"),r.removeClassName(s.root,"bottom")):(r.removeClassName(s.root,"top"),r.addClassName(s.root,"bottom")),s.root.style.maxHeight=r.option.asSize(e.maxHeight,""),s.root.style.minHeight=r.option.asSize(e.minHeight,""),s.root.style.width=r.option.asSize(e.width,""),i.border.left=(s.centerContainer.offsetWidth-s.centerContainer.clientWidth)/2,i.border.right=i.border.left,i.border.top=(s.centerContainer.offsetHeight-s.centerContainer.clientHeight)/2,i.border.bottom=i.border.top;var o=s.root.offsetHeight-s.root.clientHeight,n=s.root.offsetWidth-s.root.clientWidth;0===s.centerContainer.clientHeight&&(i.border.left=i.border.top,i.border.right=i.border.left),0===s.root.clientHeight&&(n=o),i.center.height=s.center.offsetHeight,i.left.height=s.left.offsetHeight,i.right.height=s.right.offsetHeight,i.top.height=s.top.clientHeight||-i.border.top,i.bottom.height=s.bottom.clientHeight||-i.border.bottom;var a=Math.max(i.left.height,i.center.height,i.right.height),d=i.top.height+a+i.bottom.height+o+i.border.top+i.border.bottom;s.root.style.height=r.option.asSize(e.height,d+"px"),i.root.height=s.root.offsetHeight,i.background.height=i.root.height-o;var l=i.root.height-i.top.height-i.bottom.height-o;i.centerContainer.height=l,i.leftContainer.height=l,i.rightContainer.height=i.leftContainer.height,i.root.width=s.root.offsetWidth,i.background.width=i.root.width-n,i.left.width=s.leftContainer.clientWidth||-i.border.left,i.leftContainer.width=i.left.width,i.right.width=s.rightContainer.clientWidth||-i.border.right,i.rightContainer.width=i.right.width;var c=i.root.width-i.left.width-i.right.width-n;i.center.width=c,i.centerContainer.width=c,i.top.width=c,i.bottom.width=c,s.background.style.height=i.background.height+"px",s.backgroundVertical.style.height=i.background.height+"px",s.backgroundHorizontal.style.height=i.centerContainer.height+"px",s.centerContainer.style.height=i.centerContainer.height+"px",s.leftContainer.style.height=i.leftContainer.height+"px",s.rightContainer.style.height=i.rightContainer.height+"px",s.background.style.width=i.background.width+"px",s.backgroundVertical.style.width=i.centerContainer.width+"px",s.backgroundHorizontal.style.width=i.background.width+"px",s.centerContainer.style.width=i.center.width+"px",s.top.style.width=i.top.width+"px",s.bottom.style.width=i.bottom.width+"px",s.background.style.left="0",s.background.style.top="0",s.backgroundVertical.style.left=i.left.width+i.border.left+"px",s.backgroundVertical.style.top="0",s.backgroundHorizontal.style.left="0",s.backgroundHorizontal.style.top=i.top.height+"px",s.centerContainer.style.left=i.left.width+"px",s.centerContainer.style.top=i.top.height+"px",s.leftContainer.style.left="0",s.leftContainer.style.top=i.top.height+"px",s.rightContainer.style.left=i.left.width+i.center.width+"px",s.rightContainer.style.top=i.top.height+"px",s.top.style.left=i.left.width+"px",s.top.style.top="0",s.bottom.style.left=i.left.width+"px",s.bottom.style.top=i.top.height+i.centerContainer.height+"px",this._updateScrollTop();var p=this.props.scrollTop;"bottom"==e.orientation&&(p+=Math.max(this.props.centerContainer.height-this.props.center.height-this.props.border.top-this.props.border.bottom,0)),s.center.style.left="0",s.center.style.top=p+"px",s.left.style.left="0",s.left.style.top=p+"px",s.right.style.left="0",s.right.style.top=p+"px";var u=0==this.props.scrollTop?"hidden":"",m=this.props.scrollTop==this.props.scrollTopMin?"hidden":"";if(s.shadowTop.style.visibility=u,s.shadowBottom.style.visibility=m,s.shadowTopLeft.style.visibility=u,s.shadowBottomLeft.style.visibility=m,s.shadowTopRight.style.visibility=u,s.shadowBottomRight.style.visibility=m,this.components.forEach(function(e){t=e.redraw()||t}),t){var f=3;this.redrawCount<f?(this.redrawCount++,this.redraw()):console.log("WARNING: infinite loop in redraw?"),this.redrawCount=0}this.emit("finishedRedraw")}},s.prototype.repaint=function(){throw new Error("Function repaint is deprecated. Use redraw instead.")},s.prototype.setCurrentTime=function(t){if(!this.currentTime)throw new Error("Option showCurrentTime must be true");this.currentTime.setCurrentTime(t)},s.prototype.getCurrentTime=function(){if(!this.currentTime)throw new Error("Option showCurrentTime must be true");return this.currentTime.getCurrentTime()},s.prototype._toTime=function(t){return h.toTime(this,t,this.props.center.width)},s.prototype._toGlobalTime=function(t){return h.toTime(this,t,this.props.root.width)},s.prototype._toScreen=function(t){return h.toScreen(this,t,this.props.center.width)},s.prototype._toGlobalScreen=function(t){return h.toScreen(this,t,this.props.root.width)},s.prototype._initAutoResize=function(){1==this.options.autoResize?this._startAutoResize():this._stopAutoResize()},s.prototype._startAutoResize=function(){var t=this;this._stopAutoResize(),this._onResize=function(){return 1!=t.options.autoResize?void t._stopAutoResize():void(t.dom.root&&(t.dom.root.offsetWidth!=t.props.lastWidth||t.dom.root.offsetHeight!=t.props.lastHeight)&&(t.props.lastWidth=t.dom.root.offsetWidth,t.props.lastHeight=t.dom.root.offsetHeight,t.emit("change")))},r.addEventListener(window,"resize",this._onResize),this.watchTimer=setInterval(this._onResize,1e3)},s.prototype._stopAutoResize=function(){this.watchTimer&&(clearInterval(this.watchTimer),this.watchTimer=void 0),r.removeEventListener(window,"resize",this._onResize),this._onResize=null},s.prototype._onTouch=function(){this.touch.allowDragging=!0},s.prototype._onPinch=function(){this.touch.allowDragging=!1},s.prototype._onDragStart=function(){this.touch.initialScrollTop=this.props.scrollTop},s.prototype._onDrag=function(t){if(this.touch.allowDragging){var e=t.gesture.deltaY,i=this._getScrollTop(),s=this._setScrollTop(this.touch.initialScrollTop+e);s!=i&&(this.redraw(),this.emit("verticalDrag"))}},s.prototype._setScrollTop=function(t){return this.props.scrollTop=t,this._updateScrollTop(),this.props.scrollTop},s.prototype._updateScrollTop=function(){var t=Math.min(this.props.centerContainer.height-this.props.center.height,0);return t!=this.props.scrollTopMin&&("bottom"==this.options.orientation&&(this.props.scrollTop+=t-this.props.scrollTopMin),this.props.scrollTopMin=t),this.props.scrollTop>0&&(this.props.scrollTop=0),this.props.scrollTop<t&&(this.props.scrollTop=t),this.props.scrollTop},s.prototype._getScrollTop=function(){return this.props.scrollTop},t.exports=s},function(t,e,i){var s=i(45);e.fakeGesture=function(t,e){var i=null,o=s.event.getTouchList(e,i),n=s.event.collectEventData(this,i,o,e);return isNaN(n.center.pageX)&&(n.center.pageX=e.pageX),isNaN(n.center.pageY)&&(n.center.pageY=e.pageY),n}},function(t,e){e.en={current:"current",time:"time"},e.en_EN=e.en,e.en_US=e.en,e.nl={custom:"aangepaste",time:"tijd"},e.nl_NL=e.nl,e.nl_BE=e.nl},function(t,e,i){function s(t,e){this.groupId=t,this.options=e}var o=i(2),n=i(51);s.prototype.getYRange=function(t){for(var e=t[0].y,i=t[0].y,s=0;s<t.length;s++)e=e>t[s].y?t[s].y:e,i=i<t[s].y?t[s].y:i;return{min:e,max:i,yAxisOrientation:this.options.yAxisOrientation}},s.prototype.draw=function(t,e,i){if(null!=t&&t.length>0){var r,a,h=Number(i.svg.style.height.replace("px",""));if(r=o.getSVGElement("path",i.svgElements,i.svg),r.setAttributeNS(null,"class",e.className),void 0!==e.style&&r.setAttributeNS(null,"style",e.style),a=1==e.options.catmullRom.enabled?s._catmullRom(t,e):s._linear(t),1==e.options.shaded.enabled){var d,l=o.getSVGElement("path",i.svgElements,i.svg);d="top"==e.options.shaded.orientation?"M"+t[0].x+",0 "+a+"L"+t[t.length-1].x+",0":"M"+t[0].x+","+h+" "+a+"L"+t[t.length-1].x+","+h,l.setAttributeNS(null,"class",e.className+" fill"),void 0!==e.options.shaded.style&&l.setAttributeNS(null,"style",e.options.shaded.style),l.setAttributeNS(null,"d",d)}r.setAttributeNS(null,"d","M"+a),1==e.options.drawPoints.enabled&&n.draw(t,e,i)}},s._catmullRomUniform=function(t){for(var e,i,s,o,n,r,a=Math.round(t[0].x)+","+Math.round(t[0].y)+" ",h=1/6,d=t.length,l=0;d-1>l;l++)e=0==l?t[0]:t[l-1],i=t[l],s=t[l+1],o=d>l+2?t[l+2]:s,n={x:(-e.x+6*i.x+s.x)*h,y:(-e.y+6*i.y+s.y)*h},r={x:(i.x+6*s.x-o.x)*h,y:(i.y+6*s.y-o.y)*h},a+="C"+n.x+","+n.y+" "+r.x+","+r.y+" "+s.x+","+s.y+" ";
return a},s._catmullRom=function(t,e){var i=e.options.catmullRom.alpha;if(0==i||void 0===i)return this._catmullRomUniform(t);for(var s,o,n,r,a,h,d,l,c,p,u,m,f,g,v,y,b,_,x,w=Math.round(t[0].x)+","+Math.round(t[0].y)+" ",M=t.length,S=0;M-1>S;S++)s=0==S?t[0]:t[S-1],o=t[S],n=t[S+1],r=M>S+2?t[S+2]:n,d=Math.sqrt(Math.pow(s.x-o.x,2)+Math.pow(s.y-o.y,2)),l=Math.sqrt(Math.pow(o.x-n.x,2)+Math.pow(o.y-n.y,2)),c=Math.sqrt(Math.pow(n.x-r.x,2)+Math.pow(n.y-r.y,2)),g=Math.pow(c,i),y=Math.pow(c,2*i),v=Math.pow(l,i),b=Math.pow(l,2*i),x=Math.pow(d,i),_=Math.pow(d,2*i),p=2*_+3*x*v+b,u=2*y+3*g*v+b,m=3*x*(x+v),m>0&&(m=1/m),f=3*g*(g+v),f>0&&(f=1/f),a={x:(-b*s.x+p*o.x+_*n.x)*m,y:(-b*s.y+p*o.y+_*n.y)*m},h={x:(y*o.x+u*n.x-b*r.x)*f,y:(y*o.y+u*n.y-b*r.y)*f},0==a.x&&0==a.y&&(a=o),0==h.x&&0==h.y&&(h=n),w+="C"+a.x+","+a.y+" "+h.x+","+h.y+" "+n.x+","+n.y+" ";return w},s._linear=function(t){for(var e="",i=0;i<t.length;i++)e+=0==i?t[i].x+","+t[i].y:" "+t[i].x+","+t[i].y;return e},t.exports=s},function(t,e,i){function s(t,e){this.groupId=t,this.options=e}{var o=i(2);i(51)}s.prototype.getYRange=function(t){if("stack"!=this.options.barChart.handleOverlap){for(var e=t[0].y,i=t[0].y,s=0;s<t.length;s++)e=e>t[s].y?t[s].y:e,i=i<t[s].y?t[s].y:i;return{min:e,max:i,yAxisOrientation:this.options.yAxisOrientation}}for(var o=[],s=0;s<t.length;s++)o.push({x:t[s].x,y:t[s].y,groupId:this.groupId});return o},s.draw=function(t,e,i){var n,r,a,h,d,l,c=[],p={},u=0;for(d=0;d<t.length;d++)if(h=i.groups[t[d]],"bar"==h.options.style&&1==h.visible&&(void 0===i.options.groups.visibility[t[d]]||1==i.options.groups.visibility[t[d]]))for(l=0;l<e[t[d]].length;l++)c.push({x:e[t[d]][l].x,y:e[t[d]][l].y,groupId:t[d]}),u+=1;if(0!=u)for(c.sort(function(t,e){return t.x==e.x?t.groupId-e.groupId:t.x-e.x}),s._getDataIntersections(p,c),d=0;d<c.length;d++){h=i.groups[c[d].groupId];var m=.1*h.options.barChart.width;r=c[d].x;var f=0;if(void 0===p[r])d+1<c.length&&(n=Math.abs(c[d+1].x-r)),d>0&&(n=Math.min(n,Math.abs(c[d-1].x-r))),a=s._getSafeDrawData(n,h,m);else{var g=d+(p[r].amount-p[r].resolved),v=d-(p[r].resolved+1);g<c.length&&(n=Math.abs(c[g].x-r)),v>0&&(n=Math.min(n,Math.abs(c[v].x-r))),a=s._getSafeDrawData(n,h,m),p[r].resolved+=1,"stack"==h.options.barChart.handleOverlap?(f=p[r].accumulated,p[r].accumulated+=h.zeroPosition-c[d].y):"sideBySide"==h.options.barChart.handleOverlap&&(a.width=a.width/p[r].amount,a.offset+=p[r].resolved*a.width-.5*a.width*(p[r].amount+1),"left"==h.options.barChart.align?a.offset-=.5*a.width:"right"==h.options.barChart.align&&(a.offset+=.5*a.width))}o.drawBar(c[d].x+a.offset,c[d].y-f,a.width,h.zeroPosition-c[d].y,h.className+" bar",i.svgElements,i.svg),1==h.options.drawPoints.enabled&&o.drawPoint(c[d].x+a.offset,c[d].y,h,i.svgElements,i.svg)}},s._getDataIntersections=function(t,e){for(var i,s=0;s<e.length;s++)s+1<e.length&&(i=Math.abs(e[s+1].x-e[s].x)),s>0&&(i=Math.min(i,Math.abs(e[s-1].x-e[s].x))),0==i&&(void 0===t[e[s].x]&&(t[e[s].x]={amount:0,resolved:0,accumulated:0}),t[e[s].x].amount+=1)},s._getSafeDrawData=function(t,e,i){var s,o;return t<e.options.barChart.width&&t>0?(s=i>t?i:t,o=0,"left"==e.options.barChart.align?o-=.5*t:"right"==e.options.barChart.align&&(o+=.5*t)):(s=e.options.barChart.width,o=0,"left"==e.options.barChart.align?o-=.5*e.options.barChart.width:"right"==e.options.barChart.align&&(o+=.5*e.options.barChart.width)),{width:s,offset:o}},s.getStackedBarYRange=function(t,e,i,o,n){if(t.length>0){t.sort(function(t,e){return t.x==e.x?t.groupId-e.groupId:t.x-e.x});var r={};s._getDataIntersections(r,t),e[o]=s._getStackedBarYRange(r,t),e[o].yAxisOrientation=n,i.push(o)}},s._getStackedBarYRange=function(t,e){for(var i,s=e[0].y,o=e[0].y,n=0;n<e.length;n++)i=e[n].x,void 0===t[i]?(s=s>e[n].y?e[n].y:s,o=o<e[n].y?e[n].y:o):t[i].accumulated+=e[n].y;for(var r in t)t.hasOwnProperty(r)&&(s=s>t[r].accumulated?t[r].accumulated:s,o=o<t[r].accumulated?t[r].accumulated:o);return{min:s,max:o}},t.exports=s},function(t,e,i){function s(t,e){this.groupId=t,this.options=e}var o=i(2);s.prototype.getYRange=function(t){for(var e=t[0].y,i=t[0].y,s=0;s<t.length;s++)e=e>t[s].y?t[s].y:e,i=i<t[s].y?t[s].y:i;return{min:e,max:i,yAxisOrientation:this.options.yAxisOrientation}},s.prototype.draw=function(t,e,i,o){s.draw(t,e,i,o)},s.draw=function(t,e,i,s){void 0===s&&(s=0);for(var n=0;n<t.length;n++)o.drawPoint(t[n].x+s,t[n].y,e,i.svgElements,i.svg)},t.exports=s},function(t,e,i){var s=i(60),o=i(61),n=i(62),r=i(63),a=i(64),h=i(65),d=i(66);e._loadMixin=function(t){for(var e in t)t.hasOwnProperty(e)&&(this[e]=t[e])},e._clearMixin=function(t){for(var e in t)t.hasOwnProperty(e)&&(this[e]=void 0)},e._loadPhysicsSystem=function(){this._loadMixin(s),this._loadSelectedForceSolver(),1==this.constants.configurePhysics?this._loadPhysicsConfiguration():this._cleanupPhysicsConfiguration()},e._loadClusterSystem=function(){this.clusterSession=0,this.hubThreshold=5,this._loadMixin(o)},e._loadSectorSystem=function(){this.sectors={},this.activeSector=["default"],this.sectors.active={},this.sectors.active["default"]={nodes:{},edges:{},nodeIndices:[],formationScale:1,drawingNode:void 0},this.sectors.frozen={},this.sectors.support={nodes:{},edges:{},nodeIndices:[],formationScale:1,drawingNode:void 0},this.nodeIndices=this.sectors.active["default"].nodeIndices,this._loadMixin(n)},e._loadSelectionSystem=function(){this.selectionObj={nodes:{},edges:{}},this._loadMixin(r)},e._loadManipulationSystem=function(){this.blockConnectingEdgeSelection=!1,this.forceAppendSelection=!1,1==this.constants.dataManipulation.enabled?(void 0===this.manipulationDiv&&(this.manipulationDiv=document.createElement("div"),this.manipulationDiv.className="network-manipulationDiv",this.manipulationDiv.style.display=1==this.editMode?"block":"none",this.frame.appendChild(this.manipulationDiv)),void 0===this.editModeDiv&&(this.editModeDiv=document.createElement("div"),this.editModeDiv.className="network-manipulation-editMode",this.editModeDiv.style.display=1==this.editMode?"none":"block",this.frame.appendChild(this.editModeDiv)),void 0===this.closeDiv&&(this.closeDiv=document.createElement("div"),this.closeDiv.className="network-manipulation-closeDiv",this.closeDiv.style.display=this.manipulationDiv.style.display,this.frame.appendChild(this.closeDiv)),this._loadMixin(a),this._createManipulatorBar()):void 0!==this.manipulationDiv&&(this._createManipulatorBar(),this.frame.removeChild(this.manipulationDiv),this.frame.removeChild(this.editModeDiv),this.frame.removeChild(this.closeDiv),this.manipulationDiv=void 0,this.editModeDiv=void 0,this.closeDiv=void 0,this._clearMixin(a))},e._loadNavigationControls=function(){this._loadMixin(h),this._cleanNavigation(),1==this.constants.navigation.enabled&&this._loadNavigationElements()},e._loadHierarchySystem=function(){this._loadMixin(d)}},function(t,e,i){function s(t){this.active=!1,this.dom={container:t},this.dom.overlay=document.createElement("div"),this.dom.overlay.className="overlay",this.dom.container.appendChild(this.dom.overlay),this.hammer=a(this.dom.overlay,{prevent_default:!1}),this.hammer.on("tap",this._onTapOverlay.bind(this));var e=this,i=["touch","pinch","doubletap","hold","dragstart","drag","dragend","mousewheel","DOMMouseScroll"];i.forEach(function(t){e.hammer.on(t,function(t){t.stopPropagation()})}),this.windowHammer=a(window,{prevent_default:!1}),this.windowHammer.on("tap",function(i){o(i.target,t)||e.deactivate()}),void 0!==this.keycharm&&this.keycharm.destroy(),this.keycharm=n(),this.escListener=this.deactivate.bind(this)}function o(t,e){for(;t;){if(t===e)return!0;t=t.parentNode}return!1}var n=i(57),r=i(56),a=i(45),h=i(1);r(s.prototype),s.current=null,s.prototype.destroy=function(){this.deactivate(),this.dom.overlay.parentNode.removeChild(this.dom.overlay),this.hammer=null,this.windowHammer=null},s.prototype.activate=function(){s.current&&s.current.deactivate(),s.current=this,this.active=!0,this.dom.overlay.style.display="none",h.addClassName(this.dom.container,"vis-active"),this.emit("change"),this.emit("activate"),this.keycharm.bind("esc",this.escListener)},s.prototype.deactivate=function(){this.active=!1,this.dom.overlay.style.display="",h.removeClassName(this.dom.container,"vis-active"),this.keycharm.unbind("esc",this.escListener),this.emit("change"),this.emit("deactivate")},s.prototype._onTapOverlay=function(t){this.activate(),t.stopPropagation()},t.exports=s},function(t,e){e.en={edit:"Edit",del:"Delete selected",back:"Back",addNode:"Add Node",addEdge:"Add Edge",editNode:"Edit Node",editEdge:"Edit Edge",addDescription:"Click in an empty space to place a new node.",edgeDescription:"Click on a node and drag the edge to another node to connect them.",editEdgeDescription:"Click on the control points and drag them to a node to connect to it.",createEdgeError:"Cannot link edges to a cluster.",deleteClusterError:"Clusters cannot be deleted."},e.en_EN=e.en,e.en_US=e.en,e.nl={edit:"Wijzigen",del:"Selectie verwijderen",back:"Terug",addNode:"Node toevoegen",addEdge:"Link toevoegen",editNode:"Node wijzigen",editEdge:"Link wijzigen",addDescription:"Klik op een leeg gebied om een nieuwe node te maken.",edgeDescription:"Klik op een node en sleep de link naar een andere node om ze te verbinden.",editEdgeDescription:"Klik op de verbindingspunten en sleep ze naar een node om daarmee te verbinden.",createEdgeError:"Kan geen link maken naar een cluster.",deleteClusterError:"Clusters kunnen niet worden verwijderd."},e.nl_NL=e.nl,e.nl_BE=e.nl},function(){"undefined"!=typeof CanvasRenderingContext2D&&(CanvasRenderingContext2D.prototype.circle=function(t,e,i){this.beginPath(),this.arc(t,e,i,0,2*Math.PI,!1)},CanvasRenderingContext2D.prototype.square=function(t,e,i){this.beginPath(),this.rect(t-i,e-i,2*i,2*i)},CanvasRenderingContext2D.prototype.triangle=function(t,e,i){this.beginPath();var s=2*i,o=s/2,n=Math.sqrt(3)/6*s,r=Math.sqrt(s*s-o*o);this.moveTo(t,e-(r-n)),this.lineTo(t+o,e+n),this.lineTo(t-o,e+n),this.lineTo(t,e-(r-n)),this.closePath()},CanvasRenderingContext2D.prototype.triangleDown=function(t,e,i){this.beginPath();var s=2*i,o=s/2,n=Math.sqrt(3)/6*s,r=Math.sqrt(s*s-o*o);this.moveTo(t,e+(r-n)),this.lineTo(t+o,e-n),this.lineTo(t-o,e-n),this.lineTo(t,e+(r-n)),this.closePath()},CanvasRenderingContext2D.prototype.star=function(t,e,i){this.beginPath();for(var s=0;10>s;s++){var o=s%2===0?1.3*i:.5*i;this.lineTo(t+o*Math.sin(2*s*Math.PI/10),e-o*Math.cos(2*s*Math.PI/10))}this.closePath()},CanvasRenderingContext2D.prototype.roundRect=function(t,e,i,s,o){var n=Math.PI/180;0>i-2*o&&(o=i/2),0>s-2*o&&(o=s/2),this.beginPath(),this.moveTo(t+o,e),this.lineTo(t+i-o,e),this.arc(t+i-o,e+o,o,270*n,360*n,!1),this.lineTo(t+i,e+s-o),this.arc(t+i-o,e+s-o,o,0,90*n,!1),this.lineTo(t+o,e+s),this.arc(t+o,e+s-o,o,90*n,180*n,!1),this.lineTo(t,e+o),this.arc(t+o,e+o,o,180*n,270*n,!1)},CanvasRenderingContext2D.prototype.ellipse=function(t,e,i,s){var o=.5522848,n=i/2*o,r=s/2*o,a=t+i,h=e+s,d=t+i/2,l=e+s/2;this.beginPath(),this.moveTo(t,l),this.bezierCurveTo(t,l-r,d-n,e,d,e),this.bezierCurveTo(d+n,e,a,l-r,a,l),this.bezierCurveTo(a,l+r,d+n,h,d,h),this.bezierCurveTo(d-n,h,t,l+r,t,l)},CanvasRenderingContext2D.prototype.database=function(t,e,i,s){var o=1/3,n=i,r=s*o,a=.5522848,h=n/2*a,d=r/2*a,l=t+n,c=e+r,p=t+n/2,u=e+r/2,m=e+(s-r/2),f=e+s;this.beginPath(),this.moveTo(l,u),this.bezierCurveTo(l,u+d,p+h,c,p,c),this.bezierCurveTo(p-h,c,t,u+d,t,u),this.bezierCurveTo(t,u-d,p-h,e,p,e),this.bezierCurveTo(p+h,e,l,u-d,l,u),this.lineTo(l,m),this.bezierCurveTo(l,m+d,p+h,f,p,f),this.bezierCurveTo(p-h,f,t,m+d,t,m),this.lineTo(t,u)},CanvasRenderingContext2D.prototype.arrow=function(t,e,i,s){var o=t-s*Math.cos(i),n=e-s*Math.sin(i),r=t-.9*s*Math.cos(i),a=e-.9*s*Math.sin(i),h=o+s/3*Math.cos(i+.5*Math.PI),d=n+s/3*Math.sin(i+.5*Math.PI),l=o+s/3*Math.cos(i-.5*Math.PI),c=n+s/3*Math.sin(i-.5*Math.PI);this.beginPath(),this.moveTo(t,e),this.lineTo(h,d),this.lineTo(r,a),this.lineTo(l,c),this.closePath()},CanvasRenderingContext2D.prototype.dashedLine=function(t,e,i,s,o){o||(o=[10,5]),0==p&&(p=.001);var n=o.length;this.moveTo(t,e);for(var r=i-t,a=s-e,h=a/r,d=Math.sqrt(r*r+a*a),l=0,c=!0;d>=.1;){var p=o[l++%n];p>d&&(p=d);var u=Math.sqrt(p*p/(1+h*h));0>r&&(u=-u),t+=u,e+=h*u,this[c?"lineTo":"moveTo"](t,e),d-=p,c=!c}})},function(t){function e(t){return t?i(t):void 0}function i(t){for(var i in e.prototype)t[i]=e.prototype[i];return t}t.exports=e,e.prototype.on=e.prototype.addEventListener=function(t,e){return this._callbacks=this._callbacks||{},(this._callbacks[t]=this._callbacks[t]||[]).push(e),this},e.prototype.once=function(t,e){function i(){s.off(t,i),e.apply(this,arguments)}var s=this;return this._callbacks=this._callbacks||{},i.fn=e,this.on(t,i),this},e.prototype.off=e.prototype.removeListener=e.prototype.removeAllListeners=e.prototype.removeEventListener=function(t,e){if(this._callbacks=this._callbacks||{},0==arguments.length)return this._callbacks={},this;var i=this._callbacks[t];if(!i)return this;if(1==arguments.length)return delete this._callbacks[t],this;for(var s,o=0;o<i.length;o++)if(s=i[o],s===e||s.fn===e){i.splice(o,1);break}return this},e.prototype.emit=function(t){this._callbacks=this._callbacks||{};var e=[].slice.call(arguments,1),i=this._callbacks[t];if(i){i=i.slice(0);for(var s=0,o=i.length;o>s;++s)i[s].apply(this,e)}return this},e.prototype.listeners=function(t){return this._callbacks=this._callbacks||{},this._callbacks[t]||[]},e.prototype.hasListeners=function(t){return!!this.listeners(t).length}},function(t,e){var i,s,o;!function(n,r){s=[],i=r,o="function"==typeof i?i.apply(e,s):i,!(void 0!==o&&(t.exports=o))}(this,function(){function t(t){var e,i=t&&t.preventDefault||!1,s=t&&t.container||window,o={},n={keydown:{},keyup:{}},r={};for(e=97;122>=e;e++)r[String.fromCharCode(e)]={code:65+(e-97),shift:!1};for(e=65;90>=e;e++)r[String.fromCharCode(e)]={code:e,shift:!0};for(e=0;9>=e;e++)r[""+e]={code:48+e,shift:!1};for(e=1;12>=e;e++)r["F"+e]={code:111+e,shift:!1};for(e=0;9>=e;e++)r["num"+e]={code:96+e,shift:!1};r["num*"]={code:106,shift:!1},r["num+"]={code:107,shift:!1},r["num-"]={code:109,shift:!1},r["num/"]={code:111,shift:!1},r["num."]={code:110,shift:!1},r.left={code:37,shift:!1},r.up={code:38,shift:!1},r.right={code:39,shift:!1},r.down={code:40,shift:!1},r.space={code:32,shift:!1},r.enter={code:13,shift:!1},r.shift={code:16,shift:void 0},r.esc={code:27,shift:!1},r.backspace={code:8,shift:!1},r.tab={code:9,shift:!1},r.ctrl={code:17,shift:!1},r.alt={code:18,shift:!1},r["delete"]={code:46,shift:!1},r.pageup={code:33,shift:!1},r.pagedown={code:34,shift:!1},r["="]={code:187,shift:!1},r["-"]={code:189,shift:!1},r["]"]={code:221,shift:!1},r["["]={code:219,shift:!1};var a=function(t){d(t,"keydown")},h=function(t){d(t,"keyup")},d=function(t,e){if(void 0!==n[e][t.keyCode]){for(var s=n[e][t.keyCode],o=0;o<s.length;o++)void 0===s[o].shift?s[o].fn(t):1==s[o].shift&&1==t.shiftKey?s[o].fn(t):0==s[o].shift&&0==t.shiftKey&&s[o].fn(t);1==i&&t.preventDefault()}};return o.bind=function(t,e,i){if(void 0===i&&(i="keydown"),void 0===r[t])throw new Error("unsupported key: "+t);void 0===n[i][r[t].code]&&(n[i][r[t].code]=[]),n[i][r[t].code].push({fn:e,shift:r[t].shift})},o.bindAll=function(t,e){void 0===e&&(e="keydown");for(var i in r)r.hasOwnProperty(i)&&o.bind(i,t,e)},o.getKey=function(t){for(var e in r)if(r.hasOwnProperty(e)){if(1==t.shiftKey&&1==r[e].shift&&t.keyCode==r[e].code)return e;if(0==t.shiftKey&&0==r[e].shift&&t.keyCode==r[e].code)return e;if(t.keyCode==r[e].code&&"shift"==e)return e}return"unknown key, currently not supported"},o.unbind=function(t,e,i){if(void 0===i&&(i="keydown"),void 0===r[t])throw new Error("unsupported key: "+t);if(void 0!==e){var s=[],o=n[i][r[t].code];if(void 0!==o)for(var a=0;a<o.length;a++)(o[a].fn!=e||o[a].shift!=r[t].shift)&&s.push(n[i][r[t].code][a]);n[i][r[t].code]=s}else n[i][r[t].code]=[]},o.reset=function(){n={keydown:{},keyup:{}}},o.destroy=function(){n={keydown:{},keyup:{}},s.removeEventListener("keydown",a,!0),s.removeEventListener("keyup",h,!0)},s.addEventListener("keydown",a,!0),s.addEventListener("keyup",h,!0),o}return t})},function(t,e,i){var s;(function(t,o){(function(n){function r(t,e,i){switch(arguments.length){case 2:return null!=t?t:e;case 3:return null!=t?t:null!=e?e:i;default:throw new Error("Implement me")}}function a(t,e){return Le.call(t,e)}function h(){return{empty:!1,unusedTokens:[],unusedInput:[],overflow:-2,charsLeftOver:0,nullInput:!1,invalidMonth:null,invalidFormat:!1,userInvalidated:!1,iso:!1}}function d(t){Ce.suppressDeprecationWarnings===!1&&"undefined"!=typeof console&&console.warn&&console.warn("Deprecation warning: "+t)}function l(t,e){var i=!0;return b(function(){return i&&(d(t),i=!1),e.apply(this,arguments)},e)}function c(t,e){Mi[t]||(d(e),Mi[t]=!0)}function p(t,e){return function(i){return w(t.call(this,i),e)}}function u(t,e){return function(i){return this.localeData().ordinal(t.call(this,i),e)}}function m(t,e){var i,s,o=12*(e.year()-t.year())+(e.month()-t.month()),n=t.clone().add(o,"months");return 0>e-n?(i=t.clone().add(o-1,"months"),s=(e-n)/(n-i)):(i=t.clone().add(o+1,"months"),s=(e-n)/(i-n)),-(o+s)}function f(t,e,i){var s;return null==i?e:null!=t.meridiemHour?t.meridiemHour(e,i):null!=t.isPM?(s=t.isPM(i),s&&12>e&&(e+=12),s||12!==e||(e=0),e):e}function g(){}function v(t,e){e!==!1&&F(t),_(this,t),this._d=new Date(+t._d),Di===!1&&(Di=!0,Ce.updateOffset(this),Di=!1)}function y(t){var e=N(t),i=e.year||0,s=e.quarter||0,o=e.month||0,n=e.week||0,r=e.day||0,a=e.hour||0,h=e.minute||0,d=e.second||0,l=e.millisecond||0;this._milliseconds=+l+1e3*d+6e4*h+36e5*a,this._days=+r+7*n,this._months=+o+3*s+12*i,this._data={},this._locale=Ce.localeData(),this._bubble()}function b(t,e){for(var i in e)a(e,i)&&(t[i]=e[i]);return a(e,"toString")&&(t.toString=e.toString),a(e,"valueOf")&&(t.valueOf=e.valueOf),t}function _(t,e){var i,s,o;if("undefined"!=typeof e._isAMomentObject&&(t._isAMomentObject=e._isAMomentObject),"undefined"!=typeof e._i&&(t._i=e._i),"undefined"!=typeof e._f&&(t._f=e._f),"undefined"!=typeof e._l&&(t._l=e._l),"undefined"!=typeof e._strict&&(t._strict=e._strict),"undefined"!=typeof e._tzm&&(t._tzm=e._tzm),"undefined"!=typeof e._isUTC&&(t._isUTC=e._isUTC),"undefined"!=typeof e._offset&&(t._offset=e._offset),"undefined"!=typeof e._pf&&(t._pf=e._pf),"undefined"!=typeof e._locale&&(t._locale=e._locale),Ye.length>0)for(i in Ye)s=Ye[i],o=e[s],"undefined"!=typeof o&&(t[s]=o);return t}function x(t){return 0>t?Math.ceil(t):Math.floor(t)}function w(t,e,i){for(var s=""+Math.abs(t),o=t>=0;s.length<e;)s="0"+s;return(o?i?"+":"":"-")+s}function M(t,e){var i={milliseconds:0,months:0};return i.months=e.month()-t.month()+12*(e.year()-t.year()),t.clone().add(i.months,"M").isAfter(e)&&--i.months,i.milliseconds=+e-+t.clone().add(i.months,"M"),i}function S(t,e){var i;return e=G(e,t),t.isBefore(e)?i=M(t,e):(i=M(e,t),i.milliseconds=-i.milliseconds,i.months=-i.months),i}function D(t,e){return function(i,s){var o,n;return null===s||isNaN(+s)||(c(e,"moment()."+e+"(period, number) is deprecated. Please use moment()."+e+"(number, period)."),n=i,i=s,s=n),i="string"==typeof i?+i:i,o=Ce.duration(i,s),C(this,o,t),this}}function C(t,e,i,s){var o=e._milliseconds,n=e._days,r=e._months;s=null==s?!0:s,o&&t._d.setTime(+t._d+o*i),n&&_e(t,"Date",be(t,"Date")+n*i),r&&ye(t,be(t,"Month")+r*i),s&&Ce.updateOffset(t,n||r)}function T(t){return"[object Array]"===Object.prototype.toString.call(t)}function O(t){return"[object Date]"===Object.prototype.toString.call(t)||t instanceof Date}function E(t,e,i){var s,o=Math.min(t.length,e.length),n=Math.abs(t.length-e.length),r=0;for(s=0;o>s;s++)(i&&t[s]!==e[s]||!i&&I(t[s])!==I(e[s]))&&r++;return r+n}function k(t){if(t){var e=t.toLowerCase().replace(/(.)s$/,"$1");t=gi[t]||vi[e]||e}return t}function N(t){var e,i,s={};for(i in t)a(t,i)&&(e=k(i),e&&(s[e]=t[i]));return s}function L(t){var e,i;if(0===t.indexOf("week"))e=7,i="day";else{if(0!==t.indexOf("month"))return;e=12,i="month"}Ce[t]=function(s,o){var r,a,h=Ce._locale[t],d=[];if("number"==typeof s&&(o=s,s=n),a=function(t){var e=Ce().utc().set(i,t);return h.call(Ce._locale,e,s||"")},null!=o)return a(o);for(r=0;e>r;r++)d.push(a(r));return d}}function I(t){var e=+t,i=0;return 0!==e&&isFinite(e)&&(i=e>=0?Math.floor(e):Math.ceil(e)),i}function z(t,e){return new Date(Date.UTC(t,e+1,0)).getUTCDate()}function P(t,e,i){return me(Ce([t,11,31+e-i]),e,i).week}function A(t){return R(t)?366:365}function R(t){return t%4===0&&t%100!==0||t%400===0}function F(t){var e;t._a&&-2===t._pf.overflow&&(e=t._a[ze]<0||t._a[ze]>11?ze:t._a[Pe]<1||t._a[Pe]>z(t._a[Ie],t._a[ze])?Pe:t._a[Ae]<0||t._a[Ae]>24||24===t._a[Ae]&&(0!==t._a[Re]||0!==t._a[Fe]||0!==t._a[He])?Ae:t._a[Re]<0||t._a[Re]>59?Re:t._a[Fe]<0||t._a[Fe]>59?Fe:t._a[He]<0||t._a[He]>999?He:-1,t._pf._overflowDayOfYear&&(Ie>e||e>Pe)&&(e=Pe),t._pf.overflow=e)}function H(t){return null==t._isValid&&(t._isValid=!isNaN(t._d.getTime())&&t._pf.overflow<0&&!t._pf.empty&&!t._pf.invalidMonth&&!t._pf.nullInput&&!t._pf.invalidFormat&&!t._pf.userInvalidated,t._strict&&(t._isValid=t._isValid&&0===t._pf.charsLeftOver&&0===t._pf.unusedTokens.length&&t._pf.bigHour===n)),t._isValid}function B(t){return t?t.toLowerCase().replace("_","-"):t}function Y(t){for(var e,i,s,o,n=0;n<t.length;){for(o=B(t[n]).split("-"),e=o.length,i=B(t[n+1]),i=i?i.split("-"):null;e>0;){if(s=W(o.slice(0,e).join("-")))return s;if(i&&i.length>=e&&E(o,i,!0)>=e-1)break;e--}n++}return null}function W(t){var e=null;if(!Be[t]&&We)try{e=Ce.locale(),!function(){var t=new Error('Cannot find module "./locale"');throw t.code="MODULE_NOT_FOUND",t}(),Ce.locale(e)}catch(i){}return Be[t]}function G(t,e){var i,s;return e._isUTC?(i=e.clone(),s=(Ce.isMoment(t)||O(t)?+t:+Ce(t))-+i,i._d.setTime(+i._d+s),Ce.updateOffset(i,!1),i):Ce(t).local()}function j(t){return t.match(/\[[\s\S]/)?t.replace(/^\[|\]$/g,""):t.replace(/\\/g,"")}function V(t){var e,i,s=t.match(Ue);for(e=0,i=s.length;i>e;e++)s[e]=wi[s[e]]?wi[s[e]]:j(s[e]);return function(o){var n="";for(e=0;i>e;e++)n+=s[e]instanceof Function?s[e].call(o,t):s[e];return n}}function U(t,e){return t.isValid()?(e=X(e,t.localeData()),yi[e]||(yi[e]=V(e)),yi[e](t)):t.localeData().invalidDate()}function X(t,e){function i(t){return e.longDateFormat(t)||t}var s=5;for(Xe.lastIndex=0;s>=0&&Xe.test(t);)t=t.replace(Xe,i),Xe.lastIndex=0,s-=1;return t}function q(t,e){var i,s=e._strict;switch(t){case"Q":return oi;case"DDDD":return ri;case"YYYY":case"GGGG":case"gggg":return s?ai:Qe;case"Y":case"G":case"g":return di;case"YYYYYY":case"YYYYY":case"GGGGG":case"ggggg":return s?hi:Ke;case"S":if(s)return oi;case"SS":if(s)return ni;case"SSS":if(s)return ri;case"DDD":return Ze;case"MMM":case"MMMM":case"dd":case"ddd":case"dddd":return Je;case"a":case"A":return e._locale._meridiemParse;case"x":return ii;case"X":return si;case"Z":case"ZZ":return ti;case"T":return ei;case"SSSS":return $e;case"MM":case"DD":case"YY":case"GG":case"gg":case"HH":case"hh":case"mm":case"ss":case"ww":case"WW":return s?ni:qe;case"M":case"D":case"d":case"H":case"h":case"m":case"s":case"w":case"W":case"e":case"E":return qe;case"Do":return s?e._locale._ordinalParse:e._locale._ordinalParseLenient;default:return i=new RegExp(se(ie(t.replace("\\","")),"i"))}}function Z(t){t=t||"";var e=t.match(ti)||[],i=e[e.length-1]||[],s=(i+"").match(mi)||["-",0,0],o=+(60*s[1])+I(s[2]);return"+"===s[0]?o:-o}function Q(t,e,i){var s,o=i._a;switch(t){case"Q":null!=e&&(o[ze]=3*(I(e)-1));break;case"M":case"MM":null!=e&&(o[ze]=I(e)-1);break;case"MMM":case"MMMM":s=i._locale.monthsParse(e,t,i._strict),null!=s?o[ze]=s:i._pf.invalidMonth=e;break;case"D":case"DD":null!=e&&(o[Pe]=I(e));break;case"Do":null!=e&&(o[Pe]=I(parseInt(e.match(/\d{1,2}/)[0],10)));break;case"DDD":case"DDDD":null!=e&&(i._dayOfYear=I(e));break;case"YY":o[Ie]=Ce.parseTwoDigitYear(e);break;case"YYYY":case"YYYYY":case"YYYYYY":o[Ie]=I(e);break;case"a":case"A":i._meridiem=e;break;case"h":case"hh":i._pf.bigHour=!0;case"H":case"HH":o[Ae]=I(e);break;case"m":case"mm":o[Re]=I(e);break;case"s":case"ss":o[Fe]=I(e);break;case"S":case"SS":case"SSS":case"SSSS":o[He]=I(1e3*("0."+e));break;case"x":i._d=new Date(I(e));break;case"X":i._d=new Date(1e3*parseFloat(e));break;case"Z":case"ZZ":i._useUTC=!0,i._tzm=Z(e);break;case"dd":case"ddd":case"dddd":s=i._locale.weekdaysParse(e),null!=s?(i._w=i._w||{},i._w.d=s):i._pf.invalidWeekday=e;break;case"w":case"ww":case"W":case"WW":case"d":case"e":case"E":t=t.substr(0,1);case"gggg":case"GGGG":case"GGGGG":t=t.substr(0,2),e&&(i._w=i._w||{},i._w[t]=I(e));break;case"gg":case"GG":i._w=i._w||{},i._w[t]=Ce.parseTwoDigitYear(e)}}function K(t){var e,i,s,o,n,a,h;e=t._w,null!=e.GG||null!=e.W||null!=e.E?(n=1,a=4,i=r(e.GG,t._a[Ie],me(Ce(),1,4).year),s=r(e.W,1),o=r(e.E,1)):(n=t._locale._week.dow,a=t._locale._week.doy,i=r(e.gg,t._a[Ie],me(Ce(),n,a).year),s=r(e.w,1),null!=e.d?(o=e.d,n>o&&++s):o=null!=e.e?e.e+n:n),h=fe(i,s,o,a,n),t._a[Ie]=h.year,t._dayOfYear=h.dayOfYear}function $(t){var e,i,s,o,n=[];if(!t._d){for(s=te(t),t._w&&null==t._a[Pe]&&null==t._a[ze]&&K(t),t._dayOfYear&&(o=r(t._a[Ie],s[Ie]),t._dayOfYear>A(o)&&(t._pf._overflowDayOfYear=!0),i=le(o,0,t._dayOfYear),t._a[ze]=i.getUTCMonth(),t._a[Pe]=i.getUTCDate()),e=0;3>e&&null==t._a[e];++e)t._a[e]=n[e]=s[e];for(;7>e;e++)t._a[e]=n[e]=null==t._a[e]?2===e?1:0:t._a[e];24===t._a[Ae]&&0===t._a[Re]&&0===t._a[Fe]&&0===t._a[He]&&(t._nextDay=!0,t._a[Ae]=0),t._d=(t._useUTC?le:de).apply(null,n),null!=t._tzm&&t._d.setUTCMinutes(t._d.getUTCMinutes()-t._tzm),t._nextDay&&(t._a[Ae]=24)}}function J(t){var e;t._d||(e=N(t._i),t._a=[e.year,e.month,e.day||e.date,e.hour,e.minute,e.second,e.millisecond],$(t))}function te(t){var e=new Date;return t._useUTC?[e.getUTCFullYear(),e.getUTCMonth(),e.getUTCDate()]:[e.getFullYear(),e.getMonth(),e.getDate()]}function ee(t){if(t._f===Ce.ISO_8601)return void ne(t);t._a=[],t._pf.empty=!0;var e,i,s,o,r,a=""+t._i,h=a.length,d=0;for(s=X(t._f,t._locale).match(Ue)||[],e=0;e<s.length;e++)o=s[e],i=(a.match(q(o,t))||[])[0],i&&(r=a.substr(0,a.indexOf(i)),r.length>0&&t._pf.unusedInput.push(r),a=a.slice(a.indexOf(i)+i.length),d+=i.length),wi[o]?(i?t._pf.empty=!1:t._pf.unusedTokens.push(o),Q(o,i,t)):t._strict&&!i&&t._pf.unusedTokens.push(o);t._pf.charsLeftOver=h-d,a.length>0&&t._pf.unusedInput.push(a),t._pf.bigHour===!0&&t._a[Ae]<=12&&(t._pf.bigHour=n),t._a[Ae]=f(t._locale,t._a[Ae],t._meridiem),$(t),F(t)}function ie(t){return t.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g,function(t,e,i,s,o){return e||i||s||o})}function se(t){return t.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")}function oe(t){var e,i,s,o,n;if(0===t._f.length)return t._pf.invalidFormat=!0,void(t._d=new Date(0/0));for(o=0;o<t._f.length;o++)n=0,e=_({},t),null!=t._useUTC&&(e._useUTC=t._useUTC),e._pf=h(),e._f=t._f[o],ee(e),H(e)&&(n+=e._pf.charsLeftOver,n+=10*e._pf.unusedTokens.length,e._pf.score=n,(null==s||s>n)&&(s=n,i=e));b(t,i||e)}function ne(t){var e,i,s=t._i,o=li.exec(s);if(o){for(t._pf.iso=!0,e=0,i=pi.length;i>e;e++)if(pi[e][1].exec(s)){t._f=pi[e][0]+(o[6]||" ");break}for(e=0,i=ui.length;i>e;e++)if(ui[e][1].exec(s)){t._f+=ui[e][0];break}s.match(ti)&&(t._f+="Z"),ee(t)}else t._isValid=!1}function re(t){ne(t),t._isValid===!1&&(delete t._isValid,Ce.createFromInputFallback(t))}function ae(t,e){var i,s=[];for(i=0;i<t.length;++i)s.push(e(t[i],i));return s}function he(t){var e,i=t._i;i===n?t._d=new Date:O(i)?t._d=new Date(+i):null!==(e=Ge.exec(i))?t._d=new Date(+e[1]):"string"==typeof i?re(t):T(i)?(t._a=ae(i.slice(0),function(t){return parseInt(t,10)}),$(t)):"object"==typeof i?J(t):"number"==typeof i?t._d=new Date(i):Ce.createFromInputFallback(t)}function de(t,e,i,s,o,n,r){var a=new Date(t,e,i,s,o,n,r);return 1970>t&&a.setFullYear(t),a}function le(t){var e=new Date(Date.UTC.apply(null,arguments));return 1970>t&&e.setUTCFullYear(t),e}function ce(t,e){if("string"==typeof t)if(isNaN(t)){if(t=e.weekdaysParse(t),"number"!=typeof t)return null}else t=parseInt(t,10);return t}function pe(t,e,i,s,o){return o.relativeTime(e||1,!!i,t,s)}function ue(t,e,i){var s=Ce.duration(t).abs(),o=Ne(s.as("s")),n=Ne(s.as("m")),r=Ne(s.as("h")),a=Ne(s.as("d")),h=Ne(s.as("M")),d=Ne(s.as("y")),l=o<bi.s&&["s",o]||1===n&&["m"]||n<bi.m&&["mm",n]||1===r&&["h"]||r<bi.h&&["hh",r]||1===a&&["d"]||a<bi.d&&["dd",a]||1===h&&["M"]||h<bi.M&&["MM",h]||1===d&&["y"]||["yy",d];return l[2]=e,l[3]=+t>0,l[4]=i,pe.apply({},l)}function me(t,e,i){var s,o=i-e,n=i-t.day();return n>o&&(n-=7),o-7>n&&(n+=7),s=Ce(t).add(n,"d"),{week:Math.ceil(s.dayOfYear()/7),year:s.year()}}function fe(t,e,i,s,o){var n,r,a=le(t,0,1).getUTCDay();return a=0===a?7:a,i=null!=i?i:o,n=o-a+(a>s?7:0)-(o>a?7:0),r=7*(e-1)+(i-o)+n+1,{year:r>0?t:t-1,dayOfYear:r>0?r:A(t-1)+r}}function ge(t){var e,i=t._i,s=t._f;return t._locale=t._locale||Ce.localeData(t._l),null===i||s===n&&""===i?Ce.invalid({nullInput:!0}):("string"==typeof i&&(t._i=i=t._locale.preparse(i)),Ce.isMoment(i)?new v(i,!0):(s?T(s)?oe(t):ee(t):he(t),e=new v(t),e._nextDay&&(e.add(1,"d"),e._nextDay=n),e))}function ve(t,e){var i,s;if(1===e.length&&T(e[0])&&(e=e[0]),!e.length)return Ce();for(i=e[0],s=1;s<e.length;++s)e[s][t](i)&&(i=e[s]);return i}function ye(t,e){var i;return"string"==typeof e&&(e=t.localeData().monthsParse(e),"number"!=typeof e)?t:(i=Math.min(t.date(),z(t.year(),e)),t._d["set"+(t._isUTC?"UTC":"")+"Month"](e,i),t)}function be(t,e){return t._d["get"+(t._isUTC?"UTC":"")+e]()}function _e(t,e,i){return"Month"===e?ye(t,i):t._d["set"+(t._isUTC?"UTC":"")+e](i)}function xe(t,e){return function(i){return null!=i?(_e(this,t,i),Ce.updateOffset(this,e),this):be(this,t)}}function we(t){return 400*t/146097}function Me(t){return 146097*t/400}function Se(t){Ce.duration.fn[t]=function(){return this._data[t]}}function De(t){"undefined"==typeof ender&&(Te=ke.moment,ke.moment=t?l("Accessing Moment through the global scope is deprecated, and will be removed in an upcoming release.",Ce):Ce)}for(var Ce,Te,Oe,Ee="2.9.0",ke="undefined"==typeof t||"undefined"!=typeof window&&window!==t.window?this:t,Ne=Math.round,Le=Object.prototype.hasOwnProperty,Ie=0,ze=1,Pe=2,Ae=3,Re=4,Fe=5,He=6,Be={},Ye=[],We="undefined"!=typeof o&&o&&o.exports,Ge=/^\/?Date\((\-?\d+)/i,je=/(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,Ve=/^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,Ue=/(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Q|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|x|X|zz?|ZZ?|.)/g,Xe=/(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g,qe=/\d\d?/,Ze=/\d{1,3}/,Qe=/\d{1,4}/,Ke=/[+\-]?\d{1,6}/,$e=/\d+/,Je=/[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i,ti=/Z|[\+\-]\d\d:?\d\d/gi,ei=/T/i,ii=/[\+\-]?\d+/,si=/[\+\-]?\d+(\.\d{1,3})?/,oi=/\d/,ni=/\d\d/,ri=/\d{3}/,ai=/\d{4}/,hi=/[+-]?\d{6}/,di=/[+-]?\d+/,li=/^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,ci="YYYY-MM-DDTHH:mm:ssZ",pi=[["YYYYYY-MM-DD",/[+-]\d{6}-\d{2}-\d{2}/],["YYYY-MM-DD",/\d{4}-\d{2}-\d{2}/],["GGGG-[W]WW-E",/\d{4}-W\d{2}-\d/],["GGGG-[W]WW",/\d{4}-W\d{2}/],["YYYY-DDD",/\d{4}-\d{3}/]],ui=[["HH:mm:ss.SSSS",/(T| )\d\d:\d\d:\d\d\.\d+/],["HH:mm:ss",/(T| )\d\d:\d\d:\d\d/],["HH:mm",/(T| )\d\d:\d\d/],["HH",/(T| )\d\d/]],mi=/([\+\-]|\d\d)/gi,fi=("Date|Hours|Minutes|Seconds|Milliseconds".split("|"),{Milliseconds:1,Seconds:1e3,Minutes:6e4,Hours:36e5,Days:864e5,Months:2592e6,Years:31536e6}),gi={ms:"millisecond",s:"second",m:"minute",h:"hour",d:"day",D:"date",w:"week",W:"isoWeek",M:"month",Q:"quarter",y:"year",DDD:"dayOfYear",e:"weekday",E:"isoWeekday",gg:"weekYear",GG:"isoWeekYear"},vi={dayofyear:"dayOfYear",isoweekday:"isoWeekday",isoweek:"isoWeek",weekyear:"weekYear",isoweekyear:"isoWeekYear"},yi={},bi={s:45,m:45,h:22,d:26,M:11},_i="DDD w W M D d".split(" "),xi="M D H h m s w W".split(" "),wi={M:function(){return this.month()+1},MMM:function(t){return this.localeData().monthsShort(this,t)},MMMM:function(t){return this.localeData().months(this,t)},D:function(){return this.date()},DDD:function(){return this.dayOfYear()},d:function(){return this.day()
},dd:function(t){return this.localeData().weekdaysMin(this,t)},ddd:function(t){return this.localeData().weekdaysShort(this,t)},dddd:function(t){return this.localeData().weekdays(this,t)},w:function(){return this.week()},W:function(){return this.isoWeek()},YY:function(){return w(this.year()%100,2)},YYYY:function(){return w(this.year(),4)},YYYYY:function(){return w(this.year(),5)},YYYYYY:function(){var t=this.year(),e=t>=0?"+":"-";return e+w(Math.abs(t),6)},gg:function(){return w(this.weekYear()%100,2)},gggg:function(){return w(this.weekYear(),4)},ggggg:function(){return w(this.weekYear(),5)},GG:function(){return w(this.isoWeekYear()%100,2)},GGGG:function(){return w(this.isoWeekYear(),4)},GGGGG:function(){return w(this.isoWeekYear(),5)},e:function(){return this.weekday()},E:function(){return this.isoWeekday()},a:function(){return this.localeData().meridiem(this.hours(),this.minutes(),!0)},A:function(){return this.localeData().meridiem(this.hours(),this.minutes(),!1)},H:function(){return this.hours()},h:function(){return this.hours()%12||12},m:function(){return this.minutes()},s:function(){return this.seconds()},S:function(){return I(this.milliseconds()/100)},SS:function(){return w(I(this.milliseconds()/10),2)},SSS:function(){return w(this.milliseconds(),3)},SSSS:function(){return w(this.milliseconds(),3)},Z:function(){var t=this.utcOffset(),e="+";return 0>t&&(t=-t,e="-"),e+w(I(t/60),2)+":"+w(I(t)%60,2)},ZZ:function(){var t=this.utcOffset(),e="+";return 0>t&&(t=-t,e="-"),e+w(I(t/60),2)+w(I(t)%60,2)},z:function(){return this.zoneAbbr()},zz:function(){return this.zoneName()},x:function(){return this.valueOf()},X:function(){return this.unix()},Q:function(){return this.quarter()}},Mi={},Si=["months","monthsShort","weekdays","weekdaysShort","weekdaysMin"],Di=!1;_i.length;)Oe=_i.pop(),wi[Oe+"o"]=u(wi[Oe],Oe);for(;xi.length;)Oe=xi.pop(),wi[Oe+Oe]=p(wi[Oe],2);wi.DDDD=p(wi.DDD,3),b(g.prototype,{set:function(t){var e,i;for(i in t)e=t[i],"function"==typeof e?this[i]=e:this["_"+i]=e;this._ordinalParseLenient=new RegExp(this._ordinalParse.source+"|"+/\d{1,2}/.source)},_months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),months:function(t){return this._months[t.month()]},_monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),monthsShort:function(t){return this._monthsShort[t.month()]},monthsParse:function(t,e,i){var s,o,n;for(this._monthsParse||(this._monthsParse=[],this._longMonthsParse=[],this._shortMonthsParse=[]),s=0;12>s;s++){if(o=Ce.utc([2e3,s]),i&&!this._longMonthsParse[s]&&(this._longMonthsParse[s]=new RegExp("^"+this.months(o,"").replace(".","")+"$","i"),this._shortMonthsParse[s]=new RegExp("^"+this.monthsShort(o,"").replace(".","")+"$","i")),i||this._monthsParse[s]||(n="^"+this.months(o,"")+"|^"+this.monthsShort(o,""),this._monthsParse[s]=new RegExp(n.replace(".",""),"i")),i&&"MMMM"===e&&this._longMonthsParse[s].test(t))return s;if(i&&"MMM"===e&&this._shortMonthsParse[s].test(t))return s;if(!i&&this._monthsParse[s].test(t))return s}},_weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdays:function(t){return this._weekdays[t.day()]},_weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysShort:function(t){return this._weekdaysShort[t.day()]},_weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),weekdaysMin:function(t){return this._weekdaysMin[t.day()]},weekdaysParse:function(t){var e,i,s;for(this._weekdaysParse||(this._weekdaysParse=[]),e=0;7>e;e++)if(this._weekdaysParse[e]||(i=Ce([2e3,1]).day(e),s="^"+this.weekdays(i,"")+"|^"+this.weekdaysShort(i,"")+"|^"+this.weekdaysMin(i,""),this._weekdaysParse[e]=new RegExp(s.replace(".",""),"i")),this._weekdaysParse[e].test(t))return e},_longDateFormat:{LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY LT",LLLL:"dddd, MMMM D, YYYY LT"},longDateFormat:function(t){var e=this._longDateFormat[t];return!e&&this._longDateFormat[t.toUpperCase()]&&(e=this._longDateFormat[t.toUpperCase()].replace(/MMMM|MM|DD|dddd/g,function(t){return t.slice(1)}),this._longDateFormat[t]=e),e},isPM:function(t){return"p"===(t+"").toLowerCase().charAt(0)},_meridiemParse:/[ap]\.?m?\.?/i,meridiem:function(t,e,i){return t>11?i?"pm":"PM":i?"am":"AM"},_calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},calendar:function(t,e,i){var s=this._calendar[t];return"function"==typeof s?s.apply(e,[i]):s},_relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},relativeTime:function(t,e,i,s){var o=this._relativeTime[i];return"function"==typeof o?o(t,e,i,s):o.replace(/%d/i,t)},pastFuture:function(t,e){var i=this._relativeTime[t>0?"future":"past"];return"function"==typeof i?i(e):i.replace(/%s/i,e)},ordinal:function(t){return this._ordinal.replace("%d",t)},_ordinal:"%d",_ordinalParse:/\d{1,2}/,preparse:function(t){return t},postformat:function(t){return t},week:function(t){return me(t,this._week.dow,this._week.doy).week},_week:{dow:0,doy:6},firstDayOfWeek:function(){return this._week.dow},firstDayOfYear:function(){return this._week.doy},_invalidDate:"Invalid date",invalidDate:function(){return this._invalidDate}}),Ce=function(t,e,i,s){var o;return"boolean"==typeof i&&(s=i,i=n),o={},o._isAMomentObject=!0,o._i=t,o._f=e,o._l=i,o._strict=s,o._isUTC=!1,o._pf=h(),ge(o)},Ce.suppressDeprecationWarnings=!1,Ce.createFromInputFallback=l("moment construction falls back to js Date. This is discouraged and will be removed in upcoming major release. Please refer to https://github.com/moment/moment/issues/1407 for more info.",function(t){t._d=new Date(t._i+(t._useUTC?" UTC":""))}),Ce.min=function(){var t=[].slice.call(arguments,0);return ve("isBefore",t)},Ce.max=function(){var t=[].slice.call(arguments,0);return ve("isAfter",t)},Ce.utc=function(t,e,i,s){var o;return"boolean"==typeof i&&(s=i,i=n),o={},o._isAMomentObject=!0,o._useUTC=!0,o._isUTC=!0,o._l=i,o._i=t,o._f=e,o._strict=s,o._pf=h(),ge(o).utc()},Ce.unix=function(t){return Ce(1e3*t)},Ce.duration=function(t,e){var i,s,o,n,r=t,h=null;return Ce.isDuration(t)?r={ms:t._milliseconds,d:t._days,M:t._months}:"number"==typeof t?(r={},e?r[e]=t:r.milliseconds=t):(h=je.exec(t))?(i="-"===h[1]?-1:1,r={y:0,d:I(h[Pe])*i,h:I(h[Ae])*i,m:I(h[Re])*i,s:I(h[Fe])*i,ms:I(h[He])*i}):(h=Ve.exec(t))?(i="-"===h[1]?-1:1,o=function(t){var e=t&&parseFloat(t.replace(",","."));return(isNaN(e)?0:e)*i},r={y:o(h[2]),M:o(h[3]),d:o(h[4]),h:o(h[5]),m:o(h[6]),s:o(h[7]),w:o(h[8])}):null==r?r={}:"object"==typeof r&&("from"in r||"to"in r)&&(n=S(Ce(r.from),Ce(r.to)),r={},r.ms=n.milliseconds,r.M=n.months),s=new y(r),Ce.isDuration(t)&&a(t,"_locale")&&(s._locale=t._locale),s},Ce.version=Ee,Ce.defaultFormat=ci,Ce.ISO_8601=function(){},Ce.momentProperties=Ye,Ce.updateOffset=function(){},Ce.relativeTimeThreshold=function(t,e){return bi[t]===n?!1:e===n?bi[t]:(bi[t]=e,!0)},Ce.lang=l("moment.lang is deprecated. Use moment.locale instead.",function(t,e){return Ce.locale(t,e)}),Ce.locale=function(t,e){var i;return t&&(i="undefined"!=typeof e?Ce.defineLocale(t,e):Ce.localeData(t),i&&(Ce.duration._locale=Ce._locale=i)),Ce._locale._abbr},Ce.defineLocale=function(t,e){return null!==e?(e.abbr=t,Be[t]||(Be[t]=new g),Be[t].set(e),Ce.locale(t),Be[t]):(delete Be[t],null)},Ce.langData=l("moment.langData is deprecated. Use moment.localeData instead.",function(t){return Ce.localeData(t)}),Ce.localeData=function(t){var e;if(t&&t._locale&&t._locale._abbr&&(t=t._locale._abbr),!t)return Ce._locale;if(!T(t)){if(e=W(t))return e;t=[t]}return Y(t)},Ce.isMoment=function(t){return t instanceof v||null!=t&&a(t,"_isAMomentObject")},Ce.isDuration=function(t){return t instanceof y};for(Oe=Si.length-1;Oe>=0;--Oe)L(Si[Oe]);Ce.normalizeUnits=function(t){return k(t)},Ce.invalid=function(t){var e=Ce.utc(0/0);return null!=t?b(e._pf,t):e._pf.userInvalidated=!0,e},Ce.parseZone=function(){return Ce.apply(null,arguments).parseZone()},Ce.parseTwoDigitYear=function(t){return I(t)+(I(t)>68?1900:2e3)},Ce.isDate=O,b(Ce.fn=v.prototype,{clone:function(){return Ce(this)},valueOf:function(){return+this._d-6e4*(this._offset||0)},unix:function(){return Math.floor(+this/1e3)},toString:function(){return this.clone().locale("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ")},toDate:function(){return this._offset?new Date(+this):this._d},toISOString:function(){var t=Ce(this).utc();return 0<t.year()&&t.year()<=9999?"function"==typeof Date.prototype.toISOString?this.toDate().toISOString():U(t,"YYYY-MM-DD[T]HH:mm:ss.SSS[Z]"):U(t,"YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]")},toArray:function(){var t=this;return[t.year(),t.month(),t.date(),t.hours(),t.minutes(),t.seconds(),t.milliseconds()]},isValid:function(){return H(this)},isDSTShifted:function(){return this._a?this.isValid()&&E(this._a,(this._isUTC?Ce.utc(this._a):Ce(this._a)).toArray())>0:!1},parsingFlags:function(){return b({},this._pf)},invalidAt:function(){return this._pf.overflow},utc:function(t){return this.utcOffset(0,t)},local:function(t){return this._isUTC&&(this.utcOffset(0,t),this._isUTC=!1,t&&this.subtract(this._dateUtcOffset(),"m")),this},format:function(t){var e=U(this,t||Ce.defaultFormat);return this.localeData().postformat(e)},add:D(1,"add"),subtract:D(-1,"subtract"),diff:function(t,e,i){var s,o,n=G(t,this),r=6e4*(n.utcOffset()-this.utcOffset());return e=k(e),"year"===e||"month"===e||"quarter"===e?(o=m(this,n),"quarter"===e?o/=3:"year"===e&&(o/=12)):(s=this-n,o="second"===e?s/1e3:"minute"===e?s/6e4:"hour"===e?s/36e5:"day"===e?(s-r)/864e5:"week"===e?(s-r)/6048e5:s),i?o:x(o)},from:function(t,e){return Ce.duration({to:this,from:t}).locale(this.locale()).humanize(!e)},fromNow:function(t){return this.from(Ce(),t)},calendar:function(t){var e=t||Ce(),i=G(e,this).startOf("day"),s=this.diff(i,"days",!0),o=-6>s?"sameElse":-1>s?"lastWeek":0>s?"lastDay":1>s?"sameDay":2>s?"nextDay":7>s?"nextWeek":"sameElse";return this.format(this.localeData().calendar(o,this,Ce(e)))},isLeapYear:function(){return R(this.year())},isDST:function(){return this.utcOffset()>this.clone().month(0).utcOffset()||this.utcOffset()>this.clone().month(5).utcOffset()},day:function(t){var e=this._isUTC?this._d.getUTCDay():this._d.getDay();return null!=t?(t=ce(t,this.localeData()),this.add(t-e,"d")):e},month:xe("Month",!0),startOf:function(t){switch(t=k(t)){case"year":this.month(0);case"quarter":case"month":this.date(1);case"week":case"isoWeek":case"day":this.hours(0);case"hour":this.minutes(0);case"minute":this.seconds(0);case"second":this.milliseconds(0)}return"week"===t?this.weekday(0):"isoWeek"===t&&this.isoWeekday(1),"quarter"===t&&this.month(3*Math.floor(this.month()/3)),this},endOf:function(t){return t=k(t),t===n||"millisecond"===t?this:this.startOf(t).add(1,"isoWeek"===t?"week":t).subtract(1,"ms")},isAfter:function(t,e){var i;return e=k("undefined"!=typeof e?e:"millisecond"),"millisecond"===e?(t=Ce.isMoment(t)?t:Ce(t),+this>+t):(i=Ce.isMoment(t)?+t:+Ce(t),i<+this.clone().startOf(e))},isBefore:function(t,e){var i;return e=k("undefined"!=typeof e?e:"millisecond"),"millisecond"===e?(t=Ce.isMoment(t)?t:Ce(t),+t>+this):(i=Ce.isMoment(t)?+t:+Ce(t),+this.clone().endOf(e)<i)},isBetween:function(t,e,i){return this.isAfter(t,i)&&this.isBefore(e,i)},isSame:function(t,e){var i;return e=k(e||"millisecond"),"millisecond"===e?(t=Ce.isMoment(t)?t:Ce(t),+this===+t):(i=+Ce(t),+this.clone().startOf(e)<=i&&i<=+this.clone().endOf(e))},min:l("moment().min is deprecated, use moment.min instead. https://github.com/moment/moment/issues/1548",function(t){return t=Ce.apply(null,arguments),this>t?this:t}),max:l("moment().max is deprecated, use moment.max instead. https://github.com/moment/moment/issues/1548",function(t){return t=Ce.apply(null,arguments),t>this?this:t}),zone:l("moment().zone is deprecated, use moment().utcOffset instead. https://github.com/moment/moment/issues/1779",function(t,e){return null!=t?("string"!=typeof t&&(t=-t),this.utcOffset(t,e),this):-this.utcOffset()}),utcOffset:function(t,e){var i,s=this._offset||0;return null!=t?("string"==typeof t&&(t=Z(t)),Math.abs(t)<16&&(t=60*t),!this._isUTC&&e&&(i=this._dateUtcOffset()),this._offset=t,this._isUTC=!0,null!=i&&this.add(i,"m"),s!==t&&(!e||this._changeInProgress?C(this,Ce.duration(t-s,"m"),1,!1):this._changeInProgress||(this._changeInProgress=!0,Ce.updateOffset(this,!0),this._changeInProgress=null)),this):this._isUTC?s:this._dateUtcOffset()},isLocal:function(){return!this._isUTC},isUtcOffset:function(){return this._isUTC},isUtc:function(){return this._isUTC&&0===this._offset},zoneAbbr:function(){return this._isUTC?"UTC":""},zoneName:function(){return this._isUTC?"Coordinated Universal Time":""},parseZone:function(){return this._tzm?this.utcOffset(this._tzm):"string"==typeof this._i&&this.utcOffset(Z(this._i)),this},hasAlignedHourOffset:function(t){return t=t?Ce(t).utcOffset():0,(this.utcOffset()-t)%60===0},daysInMonth:function(){return z(this.year(),this.month())},dayOfYear:function(t){var e=Ne((Ce(this).startOf("day")-Ce(this).startOf("year"))/864e5)+1;return null==t?e:this.add(t-e,"d")},quarter:function(t){return null==t?Math.ceil((this.month()+1)/3):this.month(3*(t-1)+this.month()%3)},weekYear:function(t){var e=me(this,this.localeData()._week.dow,this.localeData()._week.doy).year;return null==t?e:this.add(t-e,"y")},isoWeekYear:function(t){var e=me(this,1,4).year;return null==t?e:this.add(t-e,"y")},week:function(t){var e=this.localeData().week(this);return null==t?e:this.add(7*(t-e),"d")},isoWeek:function(t){var e=me(this,1,4).week;return null==t?e:this.add(7*(t-e),"d")},weekday:function(t){var e=(this.day()+7-this.localeData()._week.dow)%7;return null==t?e:this.add(t-e,"d")},isoWeekday:function(t){return null==t?this.day()||7:this.day(this.day()%7?t:t-7)},isoWeeksInYear:function(){return P(this.year(),1,4)},weeksInYear:function(){var t=this.localeData()._week;return P(this.year(),t.dow,t.doy)},get:function(t){return t=k(t),this[t]()},set:function(t,e){var i;if("object"==typeof t)for(i in t)this.set(i,t[i]);else t=k(t),"function"==typeof this[t]&&this[t](e);return this},locale:function(t){var e;return t===n?this._locale._abbr:(e=Ce.localeData(t),null!=e&&(this._locale=e),this)},lang:l("moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.",function(t){return t===n?this.localeData():this.locale(t)}),localeData:function(){return this._locale},_dateUtcOffset:function(){return 15*-Math.round(this._d.getTimezoneOffset()/15)}}),Ce.fn.millisecond=Ce.fn.milliseconds=xe("Milliseconds",!1),Ce.fn.second=Ce.fn.seconds=xe("Seconds",!1),Ce.fn.minute=Ce.fn.minutes=xe("Minutes",!1),Ce.fn.hour=Ce.fn.hours=xe("Hours",!0),Ce.fn.date=xe("Date",!0),Ce.fn.dates=l("dates accessor is deprecated. Use date instead.",xe("Date",!0)),Ce.fn.year=xe("FullYear",!0),Ce.fn.years=l("years accessor is deprecated. Use year instead.",xe("FullYear",!0)),Ce.fn.days=Ce.fn.day,Ce.fn.months=Ce.fn.month,Ce.fn.weeks=Ce.fn.week,Ce.fn.isoWeeks=Ce.fn.isoWeek,Ce.fn.quarters=Ce.fn.quarter,Ce.fn.toJSON=Ce.fn.toISOString,Ce.fn.isUTC=Ce.fn.isUtc,b(Ce.duration.fn=y.prototype,{_bubble:function(){var t,e,i,s=this._milliseconds,o=this._days,n=this._months,r=this._data,a=0;r.milliseconds=s%1e3,t=x(s/1e3),r.seconds=t%60,e=x(t/60),r.minutes=e%60,i=x(e/60),r.hours=i%24,o+=x(i/24),a=x(we(o)),o-=x(Me(a)),n+=x(o/30),o%=30,a+=x(n/12),n%=12,r.days=o,r.months=n,r.years=a},abs:function(){return this._milliseconds=Math.abs(this._milliseconds),this._days=Math.abs(this._days),this._months=Math.abs(this._months),this._data.milliseconds=Math.abs(this._data.milliseconds),this._data.seconds=Math.abs(this._data.seconds),this._data.minutes=Math.abs(this._data.minutes),this._data.hours=Math.abs(this._data.hours),this._data.months=Math.abs(this._data.months),this._data.years=Math.abs(this._data.years),this},weeks:function(){return x(this.days()/7)},valueOf:function(){return this._milliseconds+864e5*this._days+this._months%12*2592e6+31536e6*I(this._months/12)},humanize:function(t){var e=ue(this,!t,this.localeData());return t&&(e=this.localeData().pastFuture(+this,e)),this.localeData().postformat(e)},add:function(t,e){var i=Ce.duration(t,e);return this._milliseconds+=i._milliseconds,this._days+=i._days,this._months+=i._months,this._bubble(),this},subtract:function(t,e){var i=Ce.duration(t,e);return this._milliseconds-=i._milliseconds,this._days-=i._days,this._months-=i._months,this._bubble(),this},get:function(t){return t=k(t),this[t.toLowerCase()+"s"]()},as:function(t){var e,i;if(t=k(t),"month"===t||"year"===t)return e=this._days+this._milliseconds/864e5,i=this._months+12*we(e),"month"===t?i:i/12;switch(e=this._days+Math.round(Me(this._months/12)),t){case"week":return e/7+this._milliseconds/6048e5;case"day":return e+this._milliseconds/864e5;case"hour":return 24*e+this._milliseconds/36e5;case"minute":return 24*e*60+this._milliseconds/6e4;case"second":return 24*e*60*60+this._milliseconds/1e3;case"millisecond":return Math.floor(24*e*60*60*1e3)+this._milliseconds;default:throw new Error("Unknown unit "+t)}},lang:Ce.fn.lang,locale:Ce.fn.locale,toIsoString:l("toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)",function(){return this.toISOString()}),toISOString:function(){var t=Math.abs(this.years()),e=Math.abs(this.months()),i=Math.abs(this.days()),s=Math.abs(this.hours()),o=Math.abs(this.minutes()),n=Math.abs(this.seconds()+this.milliseconds()/1e3);return this.asSeconds()?(this.asSeconds()<0?"-":"")+"P"+(t?t+"Y":"")+(e?e+"M":"")+(i?i+"D":"")+(s||o||n?"T":"")+(s?s+"H":"")+(o?o+"M":"")+(n?n+"S":""):"P0D"},localeData:function(){return this._locale},toJSON:function(){return this.toISOString()}}),Ce.duration.fn.toString=Ce.duration.fn.toISOString;for(Oe in fi)a(fi,Oe)&&Se(Oe.toLowerCase());Ce.duration.fn.asMilliseconds=function(){return this.as("ms")},Ce.duration.fn.asSeconds=function(){return this.as("s")},Ce.duration.fn.asMinutes=function(){return this.as("m")},Ce.duration.fn.asHours=function(){return this.as("h")},Ce.duration.fn.asDays=function(){return this.as("d")},Ce.duration.fn.asWeeks=function(){return this.as("weeks")},Ce.duration.fn.asMonths=function(){return this.as("M")},Ce.duration.fn.asYears=function(){return this.as("y")},Ce.locale("en",{ordinalParse:/\d{1,2}(th|st|nd|rd)/,ordinal:function(t){var e=t%10,i=1===I(t%100/10)?"th":1===e?"st":2===e?"nd":3===e?"rd":"th";return t+i}}),We?o.exports=Ce:(s=function(t,e,i){return i.config&&i.config()&&i.config().noGlobal===!0&&(ke.moment=Te),Ce}.call(e,i,e,o),!(s!==n&&(o.exports=s)),De(!0))}).call(this)}).call(e,function(){return this}(),i(71)(t))},function(t,e,i){var s;!function(o,n){function r(){a.READY||(w.determineEventTypes(),x.each(a.gestures,function(t){S.register(t)}),w.onTouch(a.DOCUMENT,v,S.detect),w.onTouch(a.DOCUMENT,y,S.detect),a.READY=!0)}var a=function D(t,e){return new D.Instance(t,e||{})};a.VERSION="1.1.3",a.defaults={behavior:{userSelect:"none",touchAction:"pan-y",touchCallout:"none",contentZooming:"none",userDrag:"none",tapHighlightColor:"rgba(0,0,0,0)"}},a.DOCUMENT=document,a.HAS_POINTEREVENTS=navigator.pointerEnabled||navigator.msPointerEnabled,a.HAS_TOUCHEVENTS="ontouchstart"in o,a.IS_MOBILE=/mobile|tablet|ip(ad|hone|od)|android|silk/i.test(navigator.userAgent),a.NO_MOUSEEVENTS=a.HAS_TOUCHEVENTS&&a.IS_MOBILE||a.HAS_POINTEREVENTS,a.CALCULATE_INTERVAL=25;var h={},d=a.DIRECTION_DOWN="down",l=a.DIRECTION_LEFT="left",c=a.DIRECTION_UP="up",p=a.DIRECTION_RIGHT="right",u=a.POINTER_MOUSE="mouse",m=a.POINTER_TOUCH="touch",f=a.POINTER_PEN="pen",g=a.EVENT_START="start",v=a.EVENT_MOVE="move",y=a.EVENT_END="end",b=a.EVENT_RELEASE="release",_=a.EVENT_TOUCH="touch";a.READY=!1,a.plugins=a.plugins||{},a.gestures=a.gestures||{};var x=a.utils={extend:function(t,e,i){for(var s in e)!e.hasOwnProperty(s)||t[s]!==n&&i||(t[s]=e[s]);return t},on:function(t,e,i){t.addEventListener(e,i,!1)},off:function(t,e,i){t.removeEventListener(e,i,!1)},each:function(t,e,i){var s,o;if("forEach"in t)t.forEach(e,i);else if(t.length!==n){for(s=0,o=t.length;o>s;s++)if(e.call(i,t[s],s,t)===!1)return}else for(s in t)if(t.hasOwnProperty(s)&&e.call(i,t[s],s,t)===!1)return},inStr:function(t,e){return t.indexOf(e)>-1},inArray:function(t,e){if(t.indexOf){var i=t.indexOf(e);return-1===i?!1:i}for(var s=0,o=t.length;o>s;s++)if(t[s]===e)return s;return!1},toArray:function(t){return Array.prototype.slice.call(t,0)},hasParent:function(t,e){for(;t;){if(t==e)return!0;t=t.parentNode}return!1},getCenter:function(t){var e=[],i=[],s=[],o=[],n=Math.min,r=Math.max;return 1===t.length?{pageX:t[0].pageX,pageY:t[0].pageY,clientX:t[0].clientX,clientY:t[0].clientY}:(x.each(t,function(t){e.push(t.pageX),i.push(t.pageY),s.push(t.clientX),o.push(t.clientY)}),{pageX:(n.apply(Math,e)+r.apply(Math,e))/2,pageY:(n.apply(Math,i)+r.apply(Math,i))/2,clientX:(n.apply(Math,s)+r.apply(Math,s))/2,clientY:(n.apply(Math,o)+r.apply(Math,o))/2})},getVelocity:function(t,e,i){return{x:Math.abs(e/t)||0,y:Math.abs(i/t)||0}},getAngle:function(t,e){var i=e.clientX-t.clientX,s=e.clientY-t.clientY;return 180*Math.atan2(s,i)/Math.PI},getDirection:function(t,e){var i=Math.abs(t.clientX-e.clientX),s=Math.abs(t.clientY-e.clientY);return i>=s?t.clientX-e.clientX>0?l:p:t.clientY-e.clientY>0?c:d},getDistance:function(t,e){var i=e.clientX-t.clientX,s=e.clientY-t.clientY;return Math.sqrt(i*i+s*s)},getScale:function(t,e){return t.length>=2&&e.length>=2?this.getDistance(e[0],e[1])/this.getDistance(t[0],t[1]):1},getRotation:function(t,e){return t.length>=2&&e.length>=2?this.getAngle(e[1],e[0])-this.getAngle(t[1],t[0]):0},isVertical:function(t){return t==c||t==d},setPrefixedCss:function(t,e,i,s){var o=["","Webkit","Moz","O","ms"];e=x.toCamelCase(e);for(var n=0;n<o.length;n++){var r=e;if(o[n]&&(r=o[n]+r.slice(0,1).toUpperCase()+r.slice(1)),r in t.style){t.style[r]=(null==s||s)&&i||"";break}}},toggleBehavior:function(t,e,i){if(e&&t&&t.style){x.each(e,function(e,s){x.setPrefixedCss(t,s,e,i)});var s=i&&function(){return!1};"none"==e.userSelect&&(t.onselectstart=s),"none"==e.userDrag&&(t.ondragstart=s)}},toCamelCase:function(t){return t.replace(/[_-]([a-z])/g,function(t){return t[1].toUpperCase()})}},w=a.event={preventMouseEvents:!1,started:!1,shouldDetect:!1,on:function(t,e,i,s){var o=e.split(" ");x.each(o,function(e){x.on(t,e,i),s&&s(e)})},off:function(t,e,i,s){var o=e.split(" ");x.each(o,function(e){x.off(t,e,i),s&&s(e)})},onTouch:function(t,e,i){var s=this,o=function(o){var n,r=o.type.toLowerCase(),h=a.HAS_POINTEREVENTS,d=x.inStr(r,"mouse");d&&s.preventMouseEvents||(d&&e==g&&0===o.button?(s.preventMouseEvents=!1,s.shouldDetect=!0):h&&e==g?s.shouldDetect=1===o.buttons||M.matchType(m,o):d||e!=g||(s.preventMouseEvents=!0,s.shouldDetect=!0),h&&e!=y&&M.updatePointer(e,o),s.shouldDetect&&(n=s.doDetect.call(s,o,e,t,i)),n==y&&(s.preventMouseEvents=!1,s.shouldDetect=!1,M.reset()),h&&e==y&&M.updatePointer(e,o))};return this.on(t,h[e],o),o},doDetect:function(t,e,i,s){var o=this.getTouchList(t,e),n=o.length,r=e,a=o.trigger,h=n;e==g?a=_:e==y&&(a=b,h=o.length-(t.changedTouches?t.changedTouches.length:1)),h>0&&this.started&&(r=v),this.started=!0;var d=this.collectEventData(i,r,o,t);return e!=y&&s.call(S,d),a&&(d.changedLength=h,d.eventType=a,s.call(S,d),d.eventType=r,delete d.changedLength),r==y&&(s.call(S,d),this.started=!1),r},determineEventTypes:function(){var t;return t=a.HAS_POINTEREVENTS?o.PointerEvent?["pointerdown","pointermove","pointerup pointercancel lostpointercapture"]:["MSPointerDown","MSPointerMove","MSPointerUp MSPointerCancel MSLostPointerCapture"]:a.NO_MOUSEEVENTS?["touchstart","touchmove","touchend touchcancel"]:["touchstart mousedown","touchmove mousemove","touchend touchcancel mouseup"],h[g]=t[0],h[v]=t[1],h[y]=t[2],h},getTouchList:function(t,e){if(a.HAS_POINTEREVENTS)return M.getTouchList();if(t.touches){if(e==v)return t.touches;var i=[],s=[].concat(x.toArray(t.touches),x.toArray(t.changedTouches)),o=[];return x.each(s,function(t){x.inArray(i,t.identifier)===!1&&o.push(t),i.push(t.identifier)}),o}return t.identifier=1,[t]},collectEventData:function(t,e,i,s){var o=m;return x.inStr(s.type,"mouse")||M.matchType(u,s)?o=u:M.matchType(f,s)&&(o=f),{center:x.getCenter(i),timeStamp:Date.now(),target:s.target,touches:i,eventType:e,pointerType:o,srcEvent:s,preventDefault:function(){var t=this.srcEvent;t.preventManipulation&&t.preventManipulation(),t.preventDefault&&t.preventDefault()},stopPropagation:function(){this.srcEvent.stopPropagation()},stopDetect:function(){return S.stopDetect()}}}},M=a.PointerEvent={pointers:{},getTouchList:function(){var t=[];return x.each(this.pointers,function(e){t.push(e)}),t},updatePointer:function(t,e){t==y||t!=y&&1!==e.buttons?delete this.pointers[e.pointerId]:(e.identifier=e.pointerId,this.pointers[e.pointerId]=e)},matchType:function(t,e){if(!e.pointerType)return!1;var i=e.pointerType,s={};return s[u]=i===(e.MSPOINTER_TYPE_MOUSE||u),s[m]=i===(e.MSPOINTER_TYPE_TOUCH||m),s[f]=i===(e.MSPOINTER_TYPE_PEN||f),s[t]},reset:function(){this.pointers={}}},S=a.detection={gestures:[],current:null,previous:null,stopped:!1,startDetect:function(t,e){this.current||(this.stopped=!1,this.current={inst:t,startEvent:x.extend({},e),lastEvent:!1,lastCalcEvent:!1,futureCalcEvent:!1,lastCalcData:{},name:""},this.detect(e))},detect:function(t){if(this.current&&!this.stopped){t=this.extendEventData(t);var e=this.current.inst,i=e.options;return x.each(this.gestures,function(s){!this.stopped&&e.enabled&&i[s.name]&&s.handler.call(s,t,e)},this),this.current&&(this.current.lastEvent=t),t.eventType==y&&this.stopDetect(),t}},stopDetect:function(){this.previous=x.extend({},this.current),this.current=null,this.stopped=!0},getCalculatedData:function(t,e,i,s,o){var n=this.current,r=!1,h=n.lastCalcEvent,d=n.lastCalcData;h&&t.timeStamp-h.timeStamp>a.CALCULATE_INTERVAL&&(e=h.center,i=t.timeStamp-h.timeStamp,s=t.center.clientX-h.center.clientX,o=t.center.clientY-h.center.clientY,r=!0),(t.eventType==_||t.eventType==b)&&(n.futureCalcEvent=t),(!n.lastCalcEvent||r)&&(d.velocity=x.getVelocity(i,s,o),d.angle=x.getAngle(e,t.center),d.direction=x.getDirection(e,t.center),n.lastCalcEvent=n.futureCalcEvent||t,n.futureCalcEvent=t),t.velocityX=d.velocity.x,t.velocityY=d.velocity.y,t.interimAngle=d.angle,t.interimDirection=d.direction},extendEventData:function(t){var e=this.current,i=e.startEvent,s=e.lastEvent||i;(t.eventType==_||t.eventType==b)&&(i.touches=[],x.each(t.touches,function(t){i.touches.push({clientX:t.clientX,clientY:t.clientY})}));var o=t.timeStamp-i.timeStamp,n=t.center.clientX-i.center.clientX,r=t.center.clientY-i.center.clientY;return this.getCalculatedData(t,s.center,o,n,r),x.extend(t,{startEvent:i,deltaTime:o,deltaX:n,deltaY:r,distance:x.getDistance(i.center,t.center),angle:x.getAngle(i.center,t.center),direction:x.getDirection(i.center,t.center),scale:x.getScale(i.touches,t.touches),rotation:x.getRotation(i.touches,t.touches)}),t},register:function(t){var e=t.defaults||{};return e[t.name]===n&&(e[t.name]=!0),x.extend(a.defaults,e,!0),t.index=t.index||1e3,this.gestures.push(t),this.gestures.sort(function(t,e){return t.index<e.index?-1:t.index>e.index?1:0}),this.gestures}};a.Instance=function(t,e){var i=this;r(),this.element=t,this.enabled=!0,x.each(e,function(t,i){delete e[i],e[x.toCamelCase(i)]=t}),this.options=x.extend(x.extend({},a.defaults),e||{}),this.options.behavior&&x.toggleBehavior(this.element,this.options.behavior,!0),this.eventStartHandler=w.onTouch(t,g,function(t){i.enabled&&t.eventType==g?S.startDetect(i,t):t.eventType==_&&S.detect(t)}),this.eventHandlers=[]},a.Instance.prototype={on:function(t,e){var i=this;return w.on(i.element,t,e,function(t){i.eventHandlers.push({gesture:t,handler:e})}),i},off:function(t,e){var i=this;return w.off(i.element,t,e,function(t){var s=x.inArray({gesture:t,handler:e});s!==!1&&i.eventHandlers.splice(s,1)}),i},trigger:function(t,e){e||(e={});var i=a.DOCUMENT.createEvent("Event");i.initEvent(t,!0,!0),i.gesture=e;var s=this.element;return x.hasParent(e.target,s)&&(s=e.target),s.dispatchEvent(i),this},enable:function(t){return this.enabled=t,this},dispose:function(){var t,e;for(x.toggleBehavior(this.element,this.options.behavior,!1),t=-1;e=this.eventHandlers[++t];)x.off(this.element,e.gesture,e.handler);return this.eventHandlers=[],w.off(this.element,h[g],this.eventStartHandler),null}},function(t){function e(e,s){var o=S.current;if(!(s.options.dragMaxTouches>0&&e.touches.length>s.options.dragMaxTouches))switch(e.eventType){case g:i=!1;break;case v:if(e.distance<s.options.dragMinDistance&&o.name!=t)return;var n=o.startEvent.center;if(o.name!=t&&(o.name=t,s.options.dragDistanceCorrection&&e.distance>0)){var r=Math.abs(s.options.dragMinDistance/e.distance);n.pageX+=e.deltaX*r,n.pageY+=e.deltaY*r,n.clientX+=e.deltaX*r,n.clientY+=e.deltaY*r,e=S.extendEventData(e)}(o.lastEvent.dragLockToAxis||s.options.dragLockToAxis&&s.options.dragLockMinDistance<=e.distance)&&(e.dragLockToAxis=!0);var a=o.lastEvent.direction;e.dragLockToAxis&&a!==e.direction&&(e.direction=x.isVertical(a)?e.deltaY<0?c:d:e.deltaX<0?l:p),i||(s.trigger(t+"start",e),i=!0),s.trigger(t,e),s.trigger(t+e.direction,e);var h=x.isVertical(e.direction);(s.options.dragBlockVertical&&h||s.options.dragBlockHorizontal&&!h)&&e.preventDefault();break;case b:i&&e.changedLength<=s.options.dragMaxTouches&&(s.trigger(t+"end",e),i=!1);break;case y:i=!1}}var i=!1;a.gestures.Drag={name:t,index:50,handler:e,defaults:{dragMinDistance:10,dragDistanceCorrection:!0,dragMaxTouches:1,dragBlockHorizontal:!1,dragBlockVertical:!1,dragLockToAxis:!1,dragLockMinDistance:25}}}("drag"),a.gestures.Gesture={name:"gesture",index:1337,handler:function(t,e){e.trigger(this.name,t)}},function(t){function e(e,s){var o=s.options,n=S.current;switch(e.eventType){case g:clearTimeout(i),n.name=t,i=setTimeout(function(){n&&n.name==t&&s.trigger(t,e)},o.holdTimeout);break;case v:e.distance>o.holdThreshold&&clearTimeout(i);break;case b:clearTimeout(i)}}var i;a.gestures.Hold={name:t,index:10,defaults:{holdTimeout:500,holdThreshold:2},handler:e}}("hold"),a.gestures.Release={name:"release",index:1/0,handler:function(t,e){t.eventType==b&&e.trigger(this.name,t)}},a.gestures.Swipe={name:"swipe",index:40,defaults:{swipeMinTouches:1,swipeMaxTouches:1,swipeVelocityX:.6,swipeVelocityY:.6},handler:function(t,e){if(t.eventType==b){var i=t.touches.length,s=e.options;if(i<s.swipeMinTouches||i>s.swipeMaxTouches)return;(t.velocityX>s.swipeVelocityX||t.velocityY>s.swipeVelocityY)&&(e.trigger(this.name,t),e.trigger(this.name+t.direction,t))}}},function(t){function e(e,s){var o,n,r=s.options,a=S.current,h=S.previous;switch(e.eventType){case g:i=!1;break;case v:i=i||e.distance>r.tapMaxDistance;break;case y:!x.inStr(e.srcEvent.type,"cancel")&&e.deltaTime<r.tapMaxTime&&!i&&(o=h&&h.lastEvent&&e.timeStamp-h.lastEvent.timeStamp,n=!1,h&&h.name==t&&o&&o<r.doubleTapInterval&&e.distance<r.doubleTapDistance&&(s.trigger("doubletap",e),n=!0),(!n||r.tapAlways)&&(a.name=t,s.trigger(a.name,e)))}}var i=!1;a.gestures.Tap={name:t,index:100,handler:e,defaults:{tapMaxTime:250,tapMaxDistance:10,tapAlways:!0,doubleTapDistance:20,doubleTapInterval:300}}}("tap"),a.gestures.Touch={name:"touch",index:-1/0,defaults:{preventDefault:!1,preventMouse:!1},handler:function(t,e){return e.options.preventMouse&&t.pointerType==u?void t.stopDetect():(e.options.preventDefault&&t.preventDefault(),void(t.eventType==_&&e.trigger("touch",t)))}},function(t){function e(e,s){switch(e.eventType){case g:i=!1;break;case v:if(e.touches.length<2)return;var o=Math.abs(1-e.scale),n=Math.abs(e.rotation);if(o<s.options.transformMinScale&&n<s.options.transformMinRotation)return;S.current.name=t,i||(s.trigger(t+"start",e),i=!0),s.trigger(t,e),n>s.options.transformMinRotation&&s.trigger("rotate",e),o>s.options.transformMinScale&&(s.trigger("pinch",e),s.trigger("pinch"+(e.scale<1?"in":"out"),e));break;case b:i&&e.changedLength<2&&(s.trigger(t+"end",e),i=!1)}}var i=!1;a.gestures.Transform={name:t,index:45,defaults:{transformMinScale:.01,transformMinRotation:1},handler:e}
}("transform"),s=function(){return a}.call(e,i,e,t),!(s!==n&&(t.exports=s))}(window)},function(t,e,i){function s(){this.constants.smoothCurves.enabled=!this.constants.smoothCurves.enabled;var t=document.getElementById("graph_toggleSmooth");t.style.background=1==this.constants.smoothCurves.enabled?"#A4FF56":"#FF8532",this._configureSmoothCurves(!1)}function o(){for(var t in this.calculationNodes)this.calculationNodes.hasOwnProperty(t)&&(this.calculationNodes[t].vx=0,this.calculationNodes[t].vy=0,this.calculationNodes[t].fx=0,this.calculationNodes[t].fy=0);1==this.constants.hierarchicalLayout.enabled?(this._setupHierarchicalLayout(),a.call(this,"graph_H_nd",1,"physics_hierarchicalRepulsion_nodeDistance"),a.call(this,"graph_H_cg",1,"physics_centralGravity"),a.call(this,"graph_H_sc",1,"physics_springConstant"),a.call(this,"graph_H_sl",1,"physics_springLength"),a.call(this,"graph_H_damp",1,"physics_damping")):this.repositionNodes(),this.moving=!0,this.start()}function n(){var t="No options are required, default values used.",e=[],i=document.getElementById("graph_physicsMethod1"),s=document.getElementById("graph_physicsMethod2");if(1==i.checked){if(this.constants.physics.barnesHut.gravitationalConstant!=this.backupConstants.physics.barnesHut.gravitationalConstant&&e.push("gravitationalConstant: "+this.constants.physics.barnesHut.gravitationalConstant),this.constants.physics.centralGravity!=this.backupConstants.physics.barnesHut.centralGravity&&e.push("centralGravity: "+this.constants.physics.centralGravity),this.constants.physics.springLength!=this.backupConstants.physics.barnesHut.springLength&&e.push("springLength: "+this.constants.physics.springLength),this.constants.physics.springConstant!=this.backupConstants.physics.barnesHut.springConstant&&e.push("springConstant: "+this.constants.physics.springConstant),this.constants.physics.damping!=this.backupConstants.physics.barnesHut.damping&&e.push("damping: "+this.constants.physics.damping),0!=e.length){t="var options = {",t+="physics: {barnesHut: {";for(var o=0;o<e.length;o++)t+=e[o],o<e.length-1&&(t+=", ");t+="}}"}this.constants.smoothCurves.enabled!=this.backupConstants.smoothCurves.enabled&&(0==e.length?t="var options = {":t+=", ",t+="smoothCurves: "+this.constants.smoothCurves.enabled),"No options are required, default values used."!=t&&(t+="};")}else if(1==s.checked){if(t="var options = {",t+="physics: {barnesHut: {enabled: false}",this.constants.physics.repulsion.nodeDistance!=this.backupConstants.physics.repulsion.nodeDistance&&e.push("nodeDistance: "+this.constants.physics.repulsion.nodeDistance),this.constants.physics.centralGravity!=this.backupConstants.physics.repulsion.centralGravity&&e.push("centralGravity: "+this.constants.physics.centralGravity),this.constants.physics.springLength!=this.backupConstants.physics.repulsion.springLength&&e.push("springLength: "+this.constants.physics.springLength),this.constants.physics.springConstant!=this.backupConstants.physics.repulsion.springConstant&&e.push("springConstant: "+this.constants.physics.springConstant),this.constants.physics.damping!=this.backupConstants.physics.repulsion.damping&&e.push("damping: "+this.constants.physics.damping),0!=e.length){t+=", repulsion: {";for(var o=0;o<e.length;o++)t+=e[o],o<e.length-1&&(t+=", ");t+="}}"}0==e.length&&(t+="}"),this.constants.smoothCurves!=this.backupConstants.smoothCurves&&(t+=", smoothCurves: "+this.constants.smoothCurves),t+="};"}else{if(t="var options = {",this.constants.physics.hierarchicalRepulsion.nodeDistance!=this.backupConstants.physics.hierarchicalRepulsion.nodeDistance&&e.push("nodeDistance: "+this.constants.physics.hierarchicalRepulsion.nodeDistance),this.constants.physics.centralGravity!=this.backupConstants.physics.hierarchicalRepulsion.centralGravity&&e.push("centralGravity: "+this.constants.physics.centralGravity),this.constants.physics.springLength!=this.backupConstants.physics.hierarchicalRepulsion.springLength&&e.push("springLength: "+this.constants.physics.springLength),this.constants.physics.springConstant!=this.backupConstants.physics.hierarchicalRepulsion.springConstant&&e.push("springConstant: "+this.constants.physics.springConstant),this.constants.physics.damping!=this.backupConstants.physics.hierarchicalRepulsion.damping&&e.push("damping: "+this.constants.physics.damping),0!=e.length){t+="physics: {hierarchicalRepulsion: {";for(var o=0;o<e.length;o++)t+=e[o],o<e.length-1&&(t+=", ");t+="}},"}if(t+="hierarchicalLayout: {",e=[],this.constants.hierarchicalLayout.direction!=this.backupConstants.hierarchicalLayout.direction&&e.push("direction: "+this.constants.hierarchicalLayout.direction),Math.abs(this.constants.hierarchicalLayout.levelSeparation)!=this.backupConstants.hierarchicalLayout.levelSeparation&&e.push("levelSeparation: "+this.constants.hierarchicalLayout.levelSeparation),this.constants.hierarchicalLayout.nodeSpacing!=this.backupConstants.hierarchicalLayout.nodeSpacing&&e.push("nodeSpacing: "+this.constants.hierarchicalLayout.nodeSpacing),0!=e.length){for(var o=0;o<e.length;o++)t+=e[o],o<e.length-1&&(t+=", ");t+="}"}else t+="enabled:true}";t+="};"}this.optionsDiv.innerHTML=t}function r(){var t=["graph_BH_table","graph_R_table","graph_H_table"],e=document.querySelector('input[name="graph_physicsMethod"]:checked').value,i="graph_"+e+"_table",s=document.getElementById(i);s.style.display="block";for(var o=0;o<t.length;o++)t[o]!=i&&(s=document.getElementById(t[o]),s.style.display="none");this._restoreNodes(),"R"==e?(this.constants.hierarchicalLayout.enabled=!1,this.constants.physics.hierarchicalRepulsion.enabled=!1,this.constants.physics.barnesHut.enabled=!1):"H"==e?0==this.constants.hierarchicalLayout.enabled&&(this.constants.hierarchicalLayout.enabled=!0,this.constants.physics.hierarchicalRepulsion.enabled=!0,this.constants.physics.barnesHut.enabled=!1,this.constants.smoothCurves.enabled=!1,this._setupHierarchicalLayout()):(this.constants.hierarchicalLayout.enabled=!1,this.constants.physics.hierarchicalRepulsion.enabled=!1,this.constants.physics.barnesHut.enabled=!0),this._loadSelectedForceSolver();var n=document.getElementById("graph_toggleSmooth");n.style.background=1==this.constants.smoothCurves.enabled?"#A4FF56":"#FF8532",this.moving=!0,this.start()}function a(t,e,i){var s=t+"_value",o=document.getElementById(t).value;Array.isArray(e)?(document.getElementById(s).value=e[parseInt(o)],this._overWriteGraphConstants(i,e[parseInt(o)])):(document.getElementById(s).value=parseInt(e)*parseFloat(o),this._overWriteGraphConstants(i,parseInt(e)*parseFloat(o))),("hierarchicalLayout_direction"==i||"hierarchicalLayout_levelSeparation"==i||"hierarchicalLayout_nodeSpacing"==i)&&this._setupHierarchicalLayout(),this.moving=!0,this.start()}var h=i(1),d=i(67),l=i(68),c=i(69);e._toggleBarnesHut=function(){this.constants.physics.barnesHut.enabled=!this.constants.physics.barnesHut.enabled,this._loadSelectedForceSolver(),this.moving=!0,this.start()},e._loadSelectedForceSolver=function(){1==this.constants.physics.barnesHut.enabled?(this._clearMixin(d),this._clearMixin(l),this.constants.physics.centralGravity=this.constants.physics.barnesHut.centralGravity,this.constants.physics.springLength=this.constants.physics.barnesHut.springLength,this.constants.physics.springConstant=this.constants.physics.barnesHut.springConstant,this.constants.physics.damping=this.constants.physics.barnesHut.damping,this._loadMixin(c)):1==this.constants.physics.hierarchicalRepulsion.enabled?(this._clearMixin(c),this._clearMixin(d),this.constants.physics.centralGravity=this.constants.physics.hierarchicalRepulsion.centralGravity,this.constants.physics.springLength=this.constants.physics.hierarchicalRepulsion.springLength,this.constants.physics.springConstant=this.constants.physics.hierarchicalRepulsion.springConstant,this.constants.physics.damping=this.constants.physics.hierarchicalRepulsion.damping,this._loadMixin(l)):(this._clearMixin(c),this._clearMixin(l),this.barnesHutTree=void 0,this.constants.physics.centralGravity=this.constants.physics.repulsion.centralGravity,this.constants.physics.springLength=this.constants.physics.repulsion.springLength,this.constants.physics.springConstant=this.constants.physics.repulsion.springConstant,this.constants.physics.damping=this.constants.physics.repulsion.damping,this._loadMixin(d))},e._initializeForceCalculation=function(){1==this.nodeIndices.length?this.nodes[this.nodeIndices[0]]._setForce(0,0):(this.nodeIndices.length>this.constants.clustering.clusterThreshold&&1==this.constants.clustering.enabled&&this.clusterToFit(this.constants.clustering.reduceToNodes,!1),this._calculateForces())},e._calculateForces=function(){this._calculateGravitationalForces(),this._calculateNodeForces(),this.constants.physics.springConstant>0&&(1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic?this._calculateSpringForcesWithSupport():1==this.constants.physics.hierarchicalRepulsion.enabled?this._calculateHierarchicalSpringForces():this._calculateSpringForces())},e._updateCalculationNodes=function(){if(1==this.constants.smoothCurves.enabled&&1==this.constants.smoothCurves.dynamic){this.calculationNodes={},this.calculationNodeIndices=[];for(var t in this.nodes)this.nodes.hasOwnProperty(t)&&(this.calculationNodes[t]=this.nodes[t]);var e=this.sectors.support.nodes;for(var i in e)e.hasOwnProperty(i)&&(this.edges.hasOwnProperty(e[i].parentEdgeId)?this.calculationNodes[i]=e[i]:e[i]._setForce(0,0));for(var s in this.calculationNodes)this.calculationNodes.hasOwnProperty(s)&&this.calculationNodeIndices.push(s)}else this.calculationNodes=this.nodes,this.calculationNodeIndices=this.nodeIndices},e._calculateGravitationalForces=function(){var t,e,i,s,o,n=this.calculationNodes,r=this.constants.physics.centralGravity,a=0;for(o=0;o<this.calculationNodeIndices.length;o++)s=n[this.calculationNodeIndices[o]],s.damping=this.constants.physics.damping,"default"==this._sector()&&0!=r?(t=-s.x,e=-s.y,i=Math.sqrt(t*t+e*e),a=0==i?0:r/i,s.fx=t*a,s.fy=e*a):(s.fx=0,s.fy=0)},e._calculateSpringForces=function(){var t,e,i,s,o,n,r,a,h,d=this.edges;for(i in d)d.hasOwnProperty(i)&&(e=d[i],e.connected&&this.nodes.hasOwnProperty(e.toId)&&this.nodes.hasOwnProperty(e.fromId)&&(t=e.physics.springLength,t+=(e.to.clusterSize+e.from.clusterSize-2)*this.constants.clustering.edgeGrowth,s=e.from.x-e.to.x,o=e.from.y-e.to.y,h=Math.sqrt(s*s+o*o),0==h&&(h=.01),a=this.constants.physics.springConstant*(t-h)/h,n=s*a,r=o*a,e.from.fx+=n,e.from.fy+=r,e.to.fx-=n,e.to.fy-=r))},e._calculateSpringForcesWithSupport=function(){var t,e,i,s,o=this.edges;for(i in o)if(o.hasOwnProperty(i)&&(e=o[i],e.connected&&this.nodes.hasOwnProperty(e.toId)&&this.nodes.hasOwnProperty(e.fromId)&&null!=e.via)){var n=e.to,r=e.via,a=e.from;t=e.physics.springLength,s=n.clusterSize+a.clusterSize-2,t+=s*this.constants.clustering.edgeGrowth,this._calculateSpringForce(n,r,.5*t),this._calculateSpringForce(r,a,.5*t)}},e._calculateSpringForce=function(t,e,i){var s,o,n,r,a,h;s=t.x-e.x,o=t.y-e.y,h=Math.sqrt(s*s+o*o),0==h&&(h=.01),a=this.constants.physics.springConstant*(i-h)/h,n=s*a,r=o*a,t.fx+=n,t.fy+=r,e.fx-=n,e.fy-=r},e._cleanupPhysicsConfiguration=function(){if(void 0!==this.physicsConfiguration){for(;this.physicsConfiguration.hasChildNodes();)this.physicsConfiguration.removeChild(this.physicsConfiguration.firstChild);this.physicsConfiguration.parentNode.removeChild(this.physicsConfiguration),this.physicsConfiguration=void 0}},e._loadPhysicsConfiguration=function(){if(void 0===this.physicsConfiguration){this.backupConstants={},h.deepExtend(this.backupConstants,this.constants);var t=["LR","RL","UD","DU"];this.physicsConfiguration=document.createElement("div"),this.physicsConfiguration.className="PhysicsConfiguration",this.physicsConfiguration.innerHTML='<table><tr><td><b>Simulation Mode:</b></td></tr><tr><td width="120px"><input type="radio" name="graph_physicsMethod" id="graph_physicsMethod1" value="BH" checked="checked">Barnes Hut</td><td width="120px"><input type="radio" name="graph_physicsMethod" id="graph_physicsMethod2" value="R">Repulsion</td><td width="120px"><input type="radio" name="graph_physicsMethod" id="graph_physicsMethod3" value="H">Hierarchical</td></tr></table><table id="graph_BH_table" style="display:none"><tr><td><b>Barnes Hut</b></td></tr><tr><td width="150px">gravitationalConstant</td><td>0</td><td><input type="range" min="0" max="20000" value="'+-1*this.constants.physics.barnesHut.gravitationalConstant+'" step="25" style="width:300px" id="graph_BH_gc"></td><td  width="50px">-20000</td><td><input value="'+-1*this.constants.physics.barnesHut.gravitationalConstant+'" id="graph_BH_gc_value" style="width:60px"></td></tr><tr><td width="150px">centralGravity</td><td>0</td><td><input type="range" min="0" max="3"  value="'+this.constants.physics.barnesHut.centralGravity+'" step="0.05"  style="width:300px" id="graph_BH_cg"></td><td>3</td><td><input value="'+this.constants.physics.barnesHut.centralGravity+'" id="graph_BH_cg_value" style="width:60px"></td></tr><tr><td width="150px">springLength</td><td>0</td><td><input type="range" min="0" max="500" value="'+this.constants.physics.barnesHut.springLength+'" step="1" style="width:300px" id="graph_BH_sl"></td><td>500</td><td><input value="'+this.constants.physics.barnesHut.springLength+'" id="graph_BH_sl_value" style="width:60px"></td></tr><tr><td width="150px">springConstant</td><td>0</td><td><input type="range" min="0" max="0.5" value="'+this.constants.physics.barnesHut.springConstant+'" step="0.001" style="width:300px" id="graph_BH_sc"></td><td>0.5</td><td><input value="'+this.constants.physics.barnesHut.springConstant+'" id="graph_BH_sc_value" style="width:60px"></td></tr><tr><td width="150px">damping</td><td>0</td><td><input type="range" min="0" max="0.3" value="'+this.constants.physics.barnesHut.damping+'" step="0.005" style="width:300px" id="graph_BH_damp"></td><td>0.3</td><td><input value="'+this.constants.physics.barnesHut.damping+'" id="graph_BH_damp_value" style="width:60px"></td></tr></table><table id="graph_R_table" style="display:none"><tr><td><b>Repulsion</b></td></tr><tr><td width="150px">nodeDistance</td><td>0</td><td><input type="range" min="0" max="300" value="'+this.constants.physics.repulsion.nodeDistance+'" step="1" style="width:300px" id="graph_R_nd"></td><td width="50px">300</td><td><input value="'+this.constants.physics.repulsion.nodeDistance+'" id="graph_R_nd_value" style="width:60px"></td></tr><tr><td width="150px">centralGravity</td><td>0</td><td><input type="range" min="0" max="3"  value="'+this.constants.physics.repulsion.centralGravity+'" step="0.05"  style="width:300px" id="graph_R_cg"></td><td>3</td><td><input value="'+this.constants.physics.repulsion.centralGravity+'" id="graph_R_cg_value" style="width:60px"></td></tr><tr><td width="150px">springLength</td><td>0</td><td><input type="range" min="0" max="500" value="'+this.constants.physics.repulsion.springLength+'" step="1" style="width:300px" id="graph_R_sl"></td><td>500</td><td><input value="'+this.constants.physics.repulsion.springLength+'" id="graph_R_sl_value" style="width:60px"></td></tr><tr><td width="150px">springConstant</td><td>0</td><td><input type="range" min="0" max="0.5" value="'+this.constants.physics.repulsion.springConstant+'" step="0.001" style="width:300px" id="graph_R_sc"></td><td>0.5</td><td><input value="'+this.constants.physics.repulsion.springConstant+'" id="graph_R_sc_value" style="width:60px"></td></tr><tr><td width="150px">damping</td><td>0</td><td><input type="range" min="0" max="0.3" value="'+this.constants.physics.repulsion.damping+'" step="0.005" style="width:300px" id="graph_R_damp"></td><td>0.3</td><td><input value="'+this.constants.physics.repulsion.damping+'" id="graph_R_damp_value" style="width:60px"></td></tr></table><table id="graph_H_table" style="display:none"><tr><td width="150"><b>Hierarchical</b></td></tr><tr><td width="150px">nodeDistance</td><td>0</td><td><input type="range" min="0" max="300" value="'+this.constants.physics.hierarchicalRepulsion.nodeDistance+'" step="1" style="width:300px" id="graph_H_nd"></td><td width="50px">300</td><td><input value="'+this.constants.physics.hierarchicalRepulsion.nodeDistance+'" id="graph_H_nd_value" style="width:60px"></td></tr><tr><td width="150px">centralGravity</td><td>0</td><td><input type="range" min="0" max="3"  value="'+this.constants.physics.hierarchicalRepulsion.centralGravity+'" step="0.05"  style="width:300px" id="graph_H_cg"></td><td>3</td><td><input value="'+this.constants.physics.hierarchicalRepulsion.centralGravity+'" id="graph_H_cg_value" style="width:60px"></td></tr><tr><td width="150px">springLength</td><td>0</td><td><input type="range" min="0" max="500" value="'+this.constants.physics.hierarchicalRepulsion.springLength+'" step="1" style="width:300px" id="graph_H_sl"></td><td>500</td><td><input value="'+this.constants.physics.hierarchicalRepulsion.springLength+'" id="graph_H_sl_value" style="width:60px"></td></tr><tr><td width="150px">springConstant</td><td>0</td><td><input type="range" min="0" max="0.5" value="'+this.constants.physics.hierarchicalRepulsion.springConstant+'" step="0.001" style="width:300px" id="graph_H_sc"></td><td>0.5</td><td><input value="'+this.constants.physics.hierarchicalRepulsion.springConstant+'" id="graph_H_sc_value" style="width:60px"></td></tr><tr><td width="150px">damping</td><td>0</td><td><input type="range" min="0" max="0.3" value="'+this.constants.physics.hierarchicalRepulsion.damping+'" step="0.005" style="width:300px" id="graph_H_damp"></td><td>0.3</td><td><input value="'+this.constants.physics.hierarchicalRepulsion.damping+'" id="graph_H_damp_value" style="width:60px"></td></tr><tr><td width="150px">direction</td><td>1</td><td><input type="range" min="0" max="3" value="'+t.indexOf(this.constants.hierarchicalLayout.direction)+'" step="1" style="width:300px" id="graph_H_direction"></td><td>4</td><td><input value="'+this.constants.hierarchicalLayout.direction+'" id="graph_H_direction_value" style="width:60px"></td></tr><tr><td width="150px">levelSeparation</td><td>1</td><td><input type="range" min="0" max="500" value="'+this.constants.hierarchicalLayout.levelSeparation+'" step="1" style="width:300px" id="graph_H_levsep"></td><td>500</td><td><input value="'+this.constants.hierarchicalLayout.levelSeparation+'" id="graph_H_levsep_value" style="width:60px"></td></tr><tr><td width="150px">nodeSpacing</td><td>1</td><td><input type="range" min="0" max="500" value="'+this.constants.hierarchicalLayout.nodeSpacing+'" step="1" style="width:300px" id="graph_H_nspac"></td><td>500</td><td><input value="'+this.constants.hierarchicalLayout.nodeSpacing+'" id="graph_H_nspac_value" style="width:60px"></td></tr></table><table><tr><td><b>Options:</b></td></tr><tr><td width="180px"><input type="button" id="graph_toggleSmooth" value="Toggle smoothCurves" style="width:150px"></td><td width="180px"><input type="button" id="graph_repositionNodes" value="Reinitialize" style="width:150px"></td><td width="180px"><input type="button" id="graph_generateOptions" value="Generate Options" style="width:150px"></td></tr></table>',this.containerElement.parentElement.insertBefore(this.physicsConfiguration,this.containerElement),this.optionsDiv=document.createElement("div"),this.optionsDiv.style.fontSize="14px",this.optionsDiv.style.fontFamily="verdana",this.containerElement.parentElement.insertBefore(this.optionsDiv,this.containerElement);var e;e=document.getElementById("graph_BH_gc"),e.onchange=a.bind(this,"graph_BH_gc",-1,"physics_barnesHut_gravitationalConstant"),e=document.getElementById("graph_BH_cg"),e.onchange=a.bind(this,"graph_BH_cg",1,"physics_centralGravity"),e=document.getElementById("graph_BH_sc"),e.onchange=a.bind(this,"graph_BH_sc",1,"physics_springConstant"),e=document.getElementById("graph_BH_sl"),e.onchange=a.bind(this,"graph_BH_sl",1,"physics_springLength"),e=document.getElementById("graph_BH_damp"),e.onchange=a.bind(this,"graph_BH_damp",1,"physics_damping"),e=document.getElementById("graph_R_nd"),e.onchange=a.bind(this,"graph_R_nd",1,"physics_repulsion_nodeDistance"),e=document.getElementById("graph_R_cg"),e.onchange=a.bind(this,"graph_R_cg",1,"physics_centralGravity"),e=document.getElementById("graph_R_sc"),e.onchange=a.bind(this,"graph_R_sc",1,"physics_springConstant"),e=document.getElementById("graph_R_sl"),e.onchange=a.bind(this,"graph_R_sl",1,"physics_springLength"),e=document.getElementById("graph_R_damp"),e.onchange=a.bind(this,"graph_R_damp",1,"physics_damping"),e=document.getElementById("graph_H_nd"),e.onchange=a.bind(this,"graph_H_nd",1,"physics_hierarchicalRepulsion_nodeDistance"),e=document.getElementById("graph_H_cg"),e.onchange=a.bind(this,"graph_H_cg",1,"physics_centralGravity"),e=document.getElementById("graph_H_sc"),e.onchange=a.bind(this,"graph_H_sc",1,"physics_springConstant"),e=document.getElementById("graph_H_sl"),e.onchange=a.bind(this,"graph_H_sl",1,"physics_springLength"),e=document.getElementById("graph_H_damp"),e.onchange=a.bind(this,"graph_H_damp",1,"physics_damping"),e=document.getElementById("graph_H_direction"),e.onchange=a.bind(this,"graph_H_direction",t,"hierarchicalLayout_direction"),e=document.getElementById("graph_H_levsep"),e.onchange=a.bind(this,"graph_H_levsep",1,"hierarchicalLayout_levelSeparation"),e=document.getElementById("graph_H_nspac"),e.onchange=a.bind(this,"graph_H_nspac",1,"hierarchicalLayout_nodeSpacing");var i=document.getElementById("graph_physicsMethod1"),d=document.getElementById("graph_physicsMethod2"),l=document.getElementById("graph_physicsMethod3");d.checked=!0,this.constants.physics.barnesHut.enabled&&(i.checked=!0),this.constants.hierarchicalLayout.enabled&&(l.checked=!0);var c=document.getElementById("graph_toggleSmooth"),p=document.getElementById("graph_repositionNodes"),u=document.getElementById("graph_generateOptions");c.onclick=s.bind(this),p.onclick=o.bind(this),u.onclick=n.bind(this),c.style.background=1==this.constants.smoothCurves&&0==this.constants.dynamicSmoothCurves?"#A4FF56":"#FF8532",r.apply(this),i.onchange=r.bind(this),d.onchange=r.bind(this),l.onchange=r.bind(this)}},e._overWriteGraphConstants=function(t,e){var i=t.split("_");1==i.length?this.constants[i[0]]=e:2==i.length?this.constants[i[0]][i[1]]=e:3==i.length&&(this.constants[i[0]][i[1]][i[2]]=e)}},function(t,e){e.startWithClustering=function(){this.clusterToFit(this.constants.clustering.initialMaxNodes,!0),this.updateLabels(),this.stabilize&&this._stabilize(),this.start()},e.clusterToFit=function(t,e){for(var i=this.nodeIndices.length,s=50,o=0;i>t&&s>o;)o%3==0?(this.forceAggregateHubs(!0),this.normalizeClusterLevels()):this.increaseClusterLevel(),i=this.nodeIndices.length,o+=1;o>0&&1==e&&this.repositionNodes(),this._updateCalculationNodes()},e.openCluster=function(t){var e=this.moving;if(t.clusterSize>this.constants.clustering.sectorThreshold&&this._nodeInActiveArea(t)&&("default"!=this._sector()||1!=this.nodeIndices.length)){this._addSector(t);for(var i=0;this.nodeIndices.length<this.constants.clustering.initialMaxNodes&&10>i;)this.decreaseClusterLevel(),i+=1}else this._expandClusterNode(t,!1,!0),this._updateNodeIndexList(),this._updateDynamicEdges(),this._updateCalculationNodes(),this.updateLabels();this.moving!=e&&this.start()},e.updateClustersDefault=function(){1==this.constants.clustering.enabled&&this.updateClusters(0,!1,!1)},e.increaseClusterLevel=function(){this.updateClusters(-1,!1,!0)},e.decreaseClusterLevel=function(){this.updateClusters(1,!1,!0)},e.updateClusters=function(t,e,i,s){var o=this.moving,n=this.nodeIndices.length;this.previousScale>this.scale&&0==t&&this._collapseSector(),this.previousScale>this.scale||-1==t?this._formClusters(i):(this.previousScale<this.scale||1==t)&&(1==i?this._openClusters(e,i):this._openClustersBySize()),this._updateNodeIndexList(),this.nodeIndices.length==n&&(this.previousScale>this.scale||-1==t)&&(this._aggregateHubs(i),this._updateNodeIndexList()),(this.previousScale>this.scale||-1==t)&&(this.handleChains(),this._updateNodeIndexList()),this.previousScale=this.scale,this._updateDynamicEdges(),this.updateLabels(),this.nodeIndices.length<n&&(this.clusterSession+=1,this.normalizeClusterLevels()),(0==s||void 0===s)&&this.moving!=o&&this.start(),this._updateCalculationNodes()},e.handleChains=function(){var t=this._getChainFraction();t>this.constants.clustering.chainThreshold&&this._reduceAmountOfChains(1-this.constants.clustering.chainThreshold/t)},e._aggregateHubs=function(t){this._getHubSize(),this._formClustersByHub(t,!1)},e.forceAggregateHubs=function(t){var e=this.moving,i=this.nodeIndices.length;this._aggregateHubs(!0),this._updateNodeIndexList(),this._updateDynamicEdges(),this.updateLabels(),this.nodeIndices.length!=i&&(this.clusterSession+=1),(0==t||void 0===t)&&this.moving!=e&&this.start()},e._openClustersBySize=function(){for(var t in this.nodes)if(this.nodes.hasOwnProperty(t)){var e=this.nodes[t];1==e.inView()&&(e.width*this.scale>this.constants.clustering.screenSizeThreshold*this.frame.canvas.clientWidth||e.height*this.scale>this.constants.clustering.screenSizeThreshold*this.frame.canvas.clientHeight)&&this.openCluster(e)}},e._openClusters=function(t,e){for(var i=0;i<this.nodeIndices.length;i++){var s=this.nodes[this.nodeIndices[i]];this._expandClusterNode(s,t,e),this._updateCalculationNodes()}},e._expandClusterNode=function(t,e,i,s){if(t.clusterSize>1&&(t.clusterSize<this.constants.clustering.sectorThreshold&&(s=!0),e=s?!0:e,t.formationScale<this.scale||1==i))for(var o in t.containedNodes)if(t.containedNodes.hasOwnProperty(o)){var n=t.containedNodes[o];1==i?(n.clusterSession==t.clusterSessions[t.clusterSessions.length-1]||s)&&this._expelChildFromParent(t,o,e,i,s):this._nodeInActiveArea(t)&&this._expelChildFromParent(t,o,e,i,s)}},e._expelChildFromParent=function(t,e,i,s,o){var n=t.containedNodes[e];if(n.formationScale<this.scale||1==s){this._unselectAll(),this.nodes[e]=n,this._releaseContainedEdges(t,n),this._connectEdgeBackToChild(t,n),this._validateEdges(t),t.options.mass-=n.options.mass,t.clusterSize-=n.clusterSize,t.options.fontSize=Math.min(this.constants.clustering.maxFontSize,this.constants.nodes.fontSize+this.constants.clustering.fontSizeMultiplier*(t.clusterSize-1)),t.dynamicEdgesLength=t.dynamicEdges.length,n.x=t.x+t.growthIndicator*(.5-Math.random()),n.y=t.y+t.growthIndicator*(.5-Math.random()),delete t.containedNodes[e];var r=!1;for(var a in t.containedNodes)if(t.containedNodes.hasOwnProperty(a)&&t.containedNodes[a].clusterSession==n.clusterSession){r=!0;break}0==r&&t.clusterSessions.pop(),this._repositionBezierNodes(n),n.clusterSession=0,t.clearSizeCache(),this.moving=!0}1==i&&this._expandClusterNode(n,i,s,o)},e._repositionBezierNodes=function(t){for(var e=0;e<t.dynamicEdges.length;e++)t.dynamicEdges[e].positionBezierNode()},e._formClusters=function(t){0==t?this._formClustersByZoom():this._forceClustersByZoom()},e._formClustersByZoom=function(){var t,e,i,s=this.constants.clustering.clusterEdgeThreshold/this.scale;for(var o in this.edges)if(this.edges.hasOwnProperty(o)){var n=this.edges[o];if(n.connected&&n.toId!=n.fromId&&(t=n.to.x-n.from.x,e=n.to.y-n.from.y,i=Math.sqrt(t*t+e*e),s>i)){var r=n.from,a=n.to;n.to.options.mass>n.from.options.mass&&(r=n.to,a=n.from),1==a.dynamicEdgesLength?this._addToCluster(r,a,!1):1==r.dynamicEdgesLength&&this._addToCluster(a,r,!1)}}},e._forceClustersByZoom=function(){for(var t in this.nodes)if(this.nodes.hasOwnProperty(t)){var e=this.nodes[t];if(1==e.dynamicEdgesLength&&0!=e.dynamicEdges.length){var i=e.dynamicEdges[0],s=i.toId==e.id?this.nodes[i.fromId]:this.nodes[i.toId];e.id!=s.id&&(s.options.mass>e.options.mass?this._addToCluster(s,e,!0):this._addToCluster(e,s,!0))}}},e._clusterToSmallestNeighbour=function(t){for(var e=-1,i=null,s=0;s<t.dynamicEdges.length;s++)if(void 0!==t.dynamicEdges[s]){var o=null;t.dynamicEdges[s].fromId!=t.id?o=t.dynamicEdges[s].from:t.dynamicEdges[s].toId!=t.id&&(o=t.dynamicEdges[s].to),null!=o&&e>o.clusterSessions.length&&(e=o.clusterSessions.length,i=o)}null!=o&&void 0!==this.nodes[o.id]&&this._addToCluster(o,t,!0)},e._formClustersByHub=function(t,e){for(var i in this.nodes)this.nodes.hasOwnProperty(i)&&this._formClusterFromHub(this.nodes[i],t,e)},e._formClusterFromHub=function(t,e,i,s){if(void 0===s&&(s=0),t.dynamicEdgesLength>=this.hubThreshold&&0==i||t.dynamicEdgesLength==this.hubThreshold&&1==i){for(var o,n,r,a=this.constants.clustering.clusterEdgeThreshold/this.scale,h=!1,d=[],l=t.dynamicEdges.length,c=0;l>c;c++)d.push(t.dynamicEdges[c].id);if(0==e)for(h=!1,c=0;l>c;c++){var p=this.edges[d[c]];if(void 0!==p&&p.connected&&p.toId!=p.fromId&&(o=p.to.x-p.from.x,n=p.to.y-p.from.y,r=Math.sqrt(o*o+n*n),a>r)){h=!0;break}}if(!e&&h||e)for(c=0;l>c;c++)if(p=this.edges[d[c]],void 0!==p){var u=this.nodes[p.fromId==t.id?p.toId:p.fromId];u.dynamicEdges.length<=this.hubThreshold+s&&u.id!=t.id&&this._addToCluster(t,u,e)}}},e._addToCluster=function(t,e,i){t.containedNodes[e.id]=e;for(var s=0;s<e.dynamicEdges.length;s++){var o=e.dynamicEdges[s];o.toId==t.id||o.fromId==t.id?this._addToContainedEdges(t,e,o):this._connectEdgeToCluster(t,e,o)}e.dynamicEdges=[],this._containCircularEdgesFromNode(t,e),delete this.nodes[e.id];var n=t.options.mass;e.clusterSession=this.clusterSession,t.options.mass+=e.options.mass,t.clusterSize+=e.clusterSize,t.options.fontSize=Math.min(this.constants.clustering.maxFontSize,this.constants.nodes.fontSize+this.constants.clustering.fontSizeMultiplier*t.clusterSize),t.clusterSessions[t.clusterSessions.length-1]!=this.clusterSession&&t.clusterSessions.push(this.clusterSession),t.formationScale=1==i?0:this.scale,t.clearSizeCache(),t.containedNodes[e.id].formationScale=t.formationScale,e.clearVelocity(),t.updateVelocity(n),this.moving=!0},e._updateDynamicEdges=function(){for(var t=0;t<this.nodeIndices.length;t++){var e=this.nodes[this.nodeIndices[t]];e.dynamicEdgesLength=e.dynamicEdges.length;var i=0;if(e.dynamicEdgesLength>1)for(var s=0;s<e.dynamicEdgesLength-1;s++)for(var o=e.dynamicEdges[s].toId,n=e.dynamicEdges[s].fromId,r=s+1;r<e.dynamicEdgesLength;r++)(e.dynamicEdges[r].toId==o&&e.dynamicEdges[r].fromId==n||e.dynamicEdges[r].fromId==o&&e.dynamicEdges[r].toId==n)&&(i+=1);e.dynamicEdgesLength-=i}},e._addToContainedEdges=function(t,e,i){t.containedEdges.hasOwnProperty(e.id)||(t.containedEdges[e.id]=[]),t.containedEdges[e.id].push(i),delete this.edges[i.id];for(var s=0;s<t.dynamicEdges.length;s++)if(t.dynamicEdges[s].id==i.id){t.dynamicEdges.splice(s,1);break}},e._connectEdgeToCluster=function(t,e,i){i.toId==i.fromId?this._addToContainedEdges(t,e,i):(i.toId==e.id?(i.originalToId.push(e.id),i.to=t,i.toId=t.id):(i.originalFromId.push(e.id),i.from=t,i.fromId=t.id),this._addToReroutedEdges(t,e,i))},e._containCircularEdgesFromNode=function(t,e){for(var i=0;i<t.dynamicEdges.length;i++){var s=t.dynamicEdges[i];s.toId==s.fromId&&this._addToContainedEdges(t,e,s)}},e._addToReroutedEdges=function(t,e,i){t.reroutedEdges.hasOwnProperty(e.id)||(t.reroutedEdges[e.id]=[]),t.reroutedEdges[e.id].push(i),t.dynamicEdges.push(i)},e._connectEdgeBackToChild=function(t,e){if(t.reroutedEdges.hasOwnProperty(e.id)){for(var i=0;i<t.reroutedEdges[e.id].length;i++){var s=t.reroutedEdges[e.id][i];s.originalFromId[s.originalFromId.length-1]==e.id?(s.originalFromId.pop(),s.fromId=e.id,s.from=e):(s.originalToId.pop(),s.toId=e.id,s.to=e),e.dynamicEdges.push(s);for(var o=0;o<t.dynamicEdges.length;o++)if(t.dynamicEdges[o].id==s.id){t.dynamicEdges.splice(o,1);break}}delete t.reroutedEdges[e.id]}},e._validateEdges=function(t){for(var e=0;e<t.dynamicEdges.length;e++){var i=t.dynamicEdges[e];t.id!=i.toId&&t.id!=i.fromId&&t.dynamicEdges.splice(e,1)}},e._releaseContainedEdges=function(t,e){for(var i=0;i<t.containedEdges[e.id].length;i++){var s=t.containedEdges[e.id][i];this.edges[s.id]=s,e.dynamicEdges.push(s),t.dynamicEdges.push(s)}delete t.containedEdges[e.id]},e.updateLabels=function(){var t;for(t in this.nodes)if(this.nodes.hasOwnProperty(t)){var e=this.nodes[t];e.clusterSize>1&&(e.label="[".concat(String(e.clusterSize),"]"))}for(t in this.nodes)this.nodes.hasOwnProperty(t)&&(e=this.nodes[t],1==e.clusterSize&&(e.label=void 0!==e.originalLabel?e.originalLabel:String(e.id)))
},e.normalizeClusterLevels=function(){var t,e=0,i=1e9,s=0;for(t in this.nodes)this.nodes.hasOwnProperty(t)&&(s=this.nodes[t].clusterSessions.length,s>e&&(e=s),i>s&&(i=s));if(e-i>this.constants.clustering.clusterLevelDifference){var o=this.nodeIndices.length,n=e-this.constants.clustering.clusterLevelDifference;for(t in this.nodes)this.nodes.hasOwnProperty(t)&&this.nodes[t].clusterSessions.length<n&&this._clusterToSmallestNeighbour(this.nodes[t]);this._updateNodeIndexList(),this._updateDynamicEdges(),this.nodeIndices.length!=o&&(this.clusterSession+=1)}},e._nodeInActiveArea=function(t){return Math.abs(t.x-this.areaCenter.x)<=this.constants.clustering.activeAreaBoxSize/this.scale&&Math.abs(t.y-this.areaCenter.y)<=this.constants.clustering.activeAreaBoxSize/this.scale},e.repositionNodes=function(){for(var t=0;t<this.nodeIndices.length;t++){var e=this.nodes[this.nodeIndices[t]];if(0==e.xFixed||0==e.yFixed){var i=1*this.nodeIndices.length*Math.min(100,e.options.mass),s=2*Math.PI*Math.random();0==e.xFixed&&(e.x=i*Math.cos(s)),0==e.yFixed&&(e.y=i*Math.sin(s)),this._repositionBezierNodes(e)}}},e._getHubSize=function(){for(var t=0,e=0,i=0,s=0,o=0;o<this.nodeIndices.length;o++){var n=this.nodes[this.nodeIndices[o]];n.dynamicEdgesLength>s&&(s=n.dynamicEdgesLength),t+=n.dynamicEdgesLength,e+=Math.pow(n.dynamicEdgesLength,2),i+=1}t/=i,e/=i;var r=e-Math.pow(t,2),a=Math.sqrt(r);this.hubThreshold=Math.floor(t+2*a),this.hubThreshold>s&&(this.hubThreshold=s)},e._reduceAmountOfChains=function(t){this.hubThreshold=2;var e=Math.floor(this.nodeIndices.length*t);for(var i in this.nodes)this.nodes.hasOwnProperty(i)&&2==this.nodes[i].dynamicEdgesLength&&this.nodes[i].dynamicEdges.length>=2&&e>0&&(this._formClusterFromHub(this.nodes[i],!0,!0,1),e-=1)},e._getChainFraction=function(){var t=0,e=0;for(var i in this.nodes)this.nodes.hasOwnProperty(i)&&(2==this.nodes[i].dynamicEdgesLength&&this.nodes[i].dynamicEdges.length>=2&&(t+=1),e+=1);return t/e}},function(t,e,i){var s=i(1),o=i(40);e._putDataInSector=function(){this.sectors.active[this._sector()].nodes=this.nodes,this.sectors.active[this._sector()].edges=this.edges,this.sectors.active[this._sector()].nodeIndices=this.nodeIndices},e._switchToSector=function(t,e){void 0===e||"active"==e?this._switchToActiveSector(t):this._switchToFrozenSector(t)},e._switchToActiveSector=function(t){this.nodeIndices=this.sectors.active[t].nodeIndices,this.nodes=this.sectors.active[t].nodes,this.edges=this.sectors.active[t].edges},e._switchToSupportSector=function(){this.nodeIndices=this.sectors.support.nodeIndices,this.nodes=this.sectors.support.nodes,this.edges=this.sectors.support.edges},e._switchToFrozenSector=function(t){this.nodeIndices=this.sectors.frozen[t].nodeIndices,this.nodes=this.sectors.frozen[t].nodes,this.edges=this.sectors.frozen[t].edges},e._loadLatestSector=function(){this._switchToSector(this._sector())},e._sector=function(){return this.activeSector[this.activeSector.length-1]},e._previousSector=function(){if(this.activeSector.length>1)return this.activeSector[this.activeSector.length-2];throw new TypeError("there are not enough sectors in the this.activeSector array.")},e._setActiveSector=function(t){this.activeSector.push(t)},e._forgetLastSector=function(){this.activeSector.pop()},e._createNewSector=function(t){this.sectors.active[t]={nodes:{},edges:{},nodeIndices:[],formationScale:this.scale,drawingNode:void 0},this.sectors.active[t].drawingNode=new o({id:t,color:{background:"#eaefef",border:"495c5e"}},{},{},this.constants),this.sectors.active[t].drawingNode.clusterSize=2},e._deleteActiveSector=function(t){delete this.sectors.active[t]},e._deleteFrozenSector=function(t){delete this.sectors.frozen[t]},e._freezeSector=function(t){this.sectors.frozen[t]=this.sectors.active[t],this._deleteActiveSector(t)},e._activateSector=function(t){this.sectors.active[t]=this.sectors.frozen[t],this._deleteFrozenSector(t)},e._mergeThisWithFrozen=function(t){for(var e in this.nodes)this.nodes.hasOwnProperty(e)&&(this.sectors.frozen[t].nodes[e]=this.nodes[e]);for(var i in this.edges)this.edges.hasOwnProperty(i)&&(this.sectors.frozen[t].edges[i]=this.edges[i]);for(var s=0;s<this.nodeIndices.length;s++)this.sectors.frozen[t].nodeIndices.push(this.nodeIndices[s])},e._collapseThisToSingleCluster=function(){this.clusterToFit(1,!1)},e._addSector=function(t){var e=this._sector();delete this.nodes[t.id];var i=s.randomUUID();this._freezeSector(e),this._createNewSector(i),this._setActiveSector(i),this._switchToSector(this._sector()),this.nodes[t.id]=t},e._collapseSector=function(){var t=this._sector();if("default"!=t&&(1==this.nodeIndices.length||this.sectors.active[t].drawingNode.width*this.scale<this.constants.clustering.screenSizeThreshold*this.frame.canvas.clientWidth||this.sectors.active[t].drawingNode.height*this.scale<this.constants.clustering.screenSizeThreshold*this.frame.canvas.clientHeight)){var e=this._previousSector();this._collapseThisToSingleCluster(),this._mergeThisWithFrozen(e),this._deleteActiveSector(t),this._activateSector(e),this._switchToSector(e),this._forgetLastSector(),this._updateNodeIndexList(),this._updateCalculationNodes()}},e._doInAllActiveSectors=function(t,e){var i=[];if(void 0===e)for(var s in this.sectors.active)this.sectors.active.hasOwnProperty(s)&&(this._switchToActiveSector(s),i.push(this[t]()));else for(var s in this.sectors.active)if(this.sectors.active.hasOwnProperty(s)){this._switchToActiveSector(s);var o=Array.prototype.splice.call(arguments,1);i.push(o.length>1?this[t](o[0],o[1]):this[t](e))}return this._loadLatestSector(),i},e._doInSupportSector=function(t,e){var i=!1;if(void 0===e)this._switchToSupportSector(),i=this[t]();else{this._switchToSupportSector();var s=Array.prototype.splice.call(arguments,1);i=s.length>1?this[t](s[0],s[1]):this[t](e)}return this._loadLatestSector(),i},e._doInAllFrozenSectors=function(t,e){if(void 0===e)for(var i in this.sectors.frozen)this.sectors.frozen.hasOwnProperty(i)&&(this._switchToFrozenSector(i),this[t]());else for(var i in this.sectors.frozen)if(this.sectors.frozen.hasOwnProperty(i)){this._switchToFrozenSector(i);var s=Array.prototype.splice.call(arguments,1);s.length>1?this[t](s[0],s[1]):this[t](e)}this._loadLatestSector()},e._doInAllSectors=function(t,e){var i=Array.prototype.splice.call(arguments,1);void 0===e?(this._doInAllActiveSectors(t),this._doInAllFrozenSectors(t)):i.length>1?(this._doInAllActiveSectors(t,i[0],i[1]),this._doInAllFrozenSectors(t,i[0],i[1])):(this._doInAllActiveSectors(t,e),this._doInAllFrozenSectors(t,e))},e._clearNodeIndexList=function(){var t=this._sector();this.sectors.active[t].nodeIndices=[],this.nodeIndices=this.sectors.active[t].nodeIndices},e._drawSectorNodes=function(t,e){var i,s=1e9,o=-1e9,n=1e9,r=-1e9;for(var a in this.sectors[e])if(this.sectors[e].hasOwnProperty(a)&&void 0!==this.sectors[e][a].drawingNode){this._switchToSector(a,e),s=1e9,o=-1e9,n=1e9,r=-1e9;for(var h in this.nodes)this.nodes.hasOwnProperty(h)&&(i=this.nodes[h],i.resize(t),n>i.x-.5*i.width&&(n=i.x-.5*i.width),r<i.x+.5*i.width&&(r=i.x+.5*i.width),s>i.y-.5*i.height&&(s=i.y-.5*i.height),o<i.y+.5*i.height&&(o=i.y+.5*i.height));i=this.sectors[e][a].drawingNode,i.x=.5*(r+n),i.y=.5*(o+s),i.width=2*(i.x-n),i.height=2*(i.y-s),i.options.radius=Math.sqrt(Math.pow(.5*i.width,2)+Math.pow(.5*i.height,2)),i.setScale(this.scale),i._drawCircle(t)}},e._drawAllSectorNodes=function(t){this._drawSectorNodes(t,"frozen"),this._drawSectorNodes(t,"active"),this._loadLatestSector()}},function(t,e,i){var s=i(40);e._getNodesOverlappingWith=function(t,e){var i=this.nodes;for(var s in i)i.hasOwnProperty(s)&&i[s].isOverlappingWith(t)&&e.push(s)},e._getAllNodesOverlappingWith=function(t){var e=[];return this._doInAllActiveSectors("_getNodesOverlappingWith",t,e),e},e._pointerToPositionObject=function(t){var e=this._XconvertDOMtoCanvas(t.x),i=this._YconvertDOMtoCanvas(t.y);return{left:e,top:i,right:e,bottom:i}},e._getNodeAt=function(t){var e=this._pointerToPositionObject(t),i=this._getAllNodesOverlappingWith(e);return i.length>0?this.nodes[i[i.length-1]]:null},e._getEdgesOverlappingWith=function(t,e){var i=this.edges;for(var s in i)i.hasOwnProperty(s)&&i[s].isOverlappingWith(t)&&e.push(s)},e._getAllEdgesOverlappingWith=function(t){var e=[];return this._doInAllActiveSectors("_getEdgesOverlappingWith",t,e),e},e._getEdgeAt=function(t){var e=this._pointerToPositionObject(t),i=this._getAllEdgesOverlappingWith(e);return i.length>0?this.edges[i[i.length-1]]:null},e._addToSelection=function(t){t instanceof s?this.selectionObj.nodes[t.id]=t:this.selectionObj.edges[t.id]=t},e._addToHover=function(t){t instanceof s?this.hoverObj.nodes[t.id]=t:this.hoverObj.edges[t.id]=t},e._removeFromSelection=function(t){t instanceof s?delete this.selectionObj.nodes[t.id]:delete this.selectionObj.edges[t.id]},e._unselectAll=function(t){void 0===t&&(t=!1);for(var e in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(e)&&this.selectionObj.nodes[e].unselect();for(var i in this.selectionObj.edges)this.selectionObj.edges.hasOwnProperty(i)&&this.selectionObj.edges[i].unselect();this.selectionObj={nodes:{},edges:{}},0==t&&this.emit("select",this.getSelection())},e._unselectClusters=function(t){void 0===t&&(t=!1);for(var e in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(e)&&this.selectionObj.nodes[e].clusterSize>1&&(this.selectionObj.nodes[e].unselect(),this._removeFromSelection(this.selectionObj.nodes[e]));0==t&&this.emit("select",this.getSelection())},e._getSelectedNodeCount=function(){var t=0;for(var e in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(e)&&(t+=1);return t},e._getSelectedNode=function(){for(var t in this.selectionObj.nodes)if(this.selectionObj.nodes.hasOwnProperty(t))return this.selectionObj.nodes[t];return null},e._getSelectedEdge=function(){for(var t in this.selectionObj.edges)if(this.selectionObj.edges.hasOwnProperty(t))return this.selectionObj.edges[t];return null},e._getSelectedEdgeCount=function(){var t=0;for(var e in this.selectionObj.edges)this.selectionObj.edges.hasOwnProperty(e)&&(t+=1);return t},e._getSelectedObjectCount=function(){var t=0;for(var e in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(e)&&(t+=1);for(var i in this.selectionObj.edges)this.selectionObj.edges.hasOwnProperty(i)&&(t+=1);return t},e._selectionIsEmpty=function(){for(var t in this.selectionObj.nodes)if(this.selectionObj.nodes.hasOwnProperty(t))return!1;for(var e in this.selectionObj.edges)if(this.selectionObj.edges.hasOwnProperty(e))return!1;return!0},e._clusterInSelection=function(){for(var t in this.selectionObj.nodes)if(this.selectionObj.nodes.hasOwnProperty(t)&&this.selectionObj.nodes[t].clusterSize>1)return!0;return!1},e._selectConnectedEdges=function(t){for(var e=0;e<t.dynamicEdges.length;e++){var i=t.dynamicEdges[e];i.select(),this._addToSelection(i)}},e._hoverConnectedEdges=function(t){for(var e=0;e<t.dynamicEdges.length;e++){var i=t.dynamicEdges[e];i.hover=!0,this._addToHover(i)}},e._unselectConnectedEdges=function(t){for(var e=0;e<t.dynamicEdges.length;e++){var i=t.dynamicEdges[e];i.unselect(),this._removeFromSelection(i)}},e._selectObject=function(t,e,i,o,n){void 0===i&&(i=!1),void 0===o&&(o=!0),0==this._selectionIsEmpty()&&0==e&&0==this.forceAppendSelection&&this._unselectAll(!0),0!=t.selected||1!=this.constants.selectable&&!n?0==t.selected?(this._addToSelection(t),i=!0):(t.unselect(),this._removeFromSelection(t)):(t.select(),this._addToSelection(t),t instanceof s&&0==this.blockConnectingEdgeSelection&&1==o&&this._selectConnectedEdges(t)),0==i&&this.emit("select",this.getSelection())},e._blurObject=function(t){1==t.hover&&(t.hover=!1,this.emit("blurNode",{node:t.id}))},e._hoverObject=function(t){0==t.hover&&(t.hover=!0,this._addToHover(t),t instanceof s&&this.emit("hoverNode",{node:t.id})),t instanceof s&&this._hoverConnectedEdges(t)},e._handleTouch=function(){},e._handleTap=function(t){var e=this._getNodeAt(t);if(null!=e)this._selectObject(e,!1);else{var i=this._getEdgeAt(t);null!=i?this._selectObject(i,!1):this._unselectAll()}var s=this.getSelection();s.pointer={DOM:{x:t.x,y:t.y},canvas:{x:this._XconvertDOMtoCanvas(t.x),y:this._YconvertDOMtoCanvas(t.y)}},this.emit("click",s),this._redraw()},e._handleDoubleTap=function(t){var e=this._getNodeAt(t);null!=e&&void 0!==e&&(this.areaCenter={x:this._XconvertDOMtoCanvas(t.x),y:this._YconvertDOMtoCanvas(t.y)},this.openCluster(e));var i=this.getSelection();i.pointer={DOM:{x:t.x,y:t.y},canvas:{x:this._XconvertDOMtoCanvas(t.x),y:this._YconvertDOMtoCanvas(t.y)}},this.emit("doubleClick",i)},e._handleOnHold=function(t){var e=this._getNodeAt(t);if(null!=e)this._selectObject(e,!0);else{var i=this._getEdgeAt(t);null!=i&&this._selectObject(i,!0)}this._redraw()},e._handleOnRelease=function(t){this._manipulationReleaseOverload(t),this._navigationReleaseOverload(t)},e._manipulationReleaseOverload=function(){},e._navigationReleaseOverload=function(){},e.getSelection=function(){var t=this.getSelectedNodes(),e=this.getSelectedEdges();return{nodes:t,edges:e}},e.getSelectedNodes=function(){var t=[];if(1==this.constants.selectable)for(var e in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(e)&&t.push(e);return t},e.getSelectedEdges=function(){var t=[];if(1==this.constants.selectable)for(var e in this.selectionObj.edges)this.selectionObj.edges.hasOwnProperty(e)&&t.push(e);return t},e.setSelection=function(){console.log("setSelection is deprecated. Please use selectNodes instead.")},e.selectNodes=function(t,e){var i,s,o;if(!t||void 0==t.length)throw"Selection must be an array with ids";for(this._unselectAll(!0),i=0,s=t.length;s>i;i++){o=t[i];var n=this.nodes[o];if(!n)throw new RangeError('Node with id "'+o+'" not found');this._selectObject(n,!0,!0,e,!0)}this.redraw()},e.selectEdges=function(t){var e,i,s;if(!t||void 0==t.length)throw"Selection must be an array with ids";for(this._unselectAll(!0),e=0,i=t.length;i>e;e++){s=t[e];var o=this.edges[s];if(!o)throw new RangeError('Edge with id "'+s+'" not found');this._selectObject(o,!0,!0,!1,!0)}this.redraw()},e._updateSelection=function(){for(var t in this.selectionObj.nodes)this.selectionObj.nodes.hasOwnProperty(t)&&(this.nodes.hasOwnProperty(t)||delete this.selectionObj.nodes[t]);for(var e in this.selectionObj.edges)this.selectionObj.edges.hasOwnProperty(e)&&(this.edges.hasOwnProperty(e)||delete this.selectionObj.edges[e])}},function(t,e,i){var s=i(1),o=i(40),n=i(37);e._clearManipulatorBar=function(){this._recursiveDOMDelete(this.manipulationDiv),this.manipulationDOM={},this._manipulationReleaseOverload=function(){},delete this.sectors.support.nodes.targetNode,delete this.sectors.support.nodes.targetViaNode,this.controlNodesActive=!1,this.freezeSimulation=!1},e._restoreOverloadedFunctions=function(){for(var t in this.cachedFunctions)this.cachedFunctions.hasOwnProperty(t)&&(this[t]=this.cachedFunctions[t],delete this.cachedFunctions[t])},e._toggleEditMode=function(){this.editMode=!this.editMode;var t=this.manipulationDiv,e=this.closeDiv,i=this.editModeDiv;1==this.editMode?(t.style.display="block",e.style.display="block",i.style.display="none",e.onclick=this._toggleEditMode.bind(this)):(t.style.display="none",e.style.display="none",i.style.display="block",e.onclick=null),this._createManipulatorBar()},e._createManipulatorBar=function(){this.boundFunction&&this.off("select",this.boundFunction);var t=this.constants.locales[this.constants.locale];if(void 0!==this.edgeBeingEdited&&(this.edgeBeingEdited._disableControlNodes(),this.edgeBeingEdited=void 0,this.selectedControlNode=null,this.controlNodesActive=!1,this._redraw()),this._restoreOverloadedFunctions(),this.freezeSimulation=!1,this.blockConnectingEdgeSelection=!1,this.forceAppendSelection=!1,this.manipulationDOM={},1==this.editMode){for(;this.manipulationDiv.hasChildNodes();)this.manipulationDiv.removeChild(this.manipulationDiv.firstChild);this.manipulationDOM.addNodeSpan=document.createElement("span"),this.manipulationDOM.addNodeSpan.className="network-manipulationUI add",this.manipulationDOM.addNodeLabelSpan=document.createElement("span"),this.manipulationDOM.addNodeLabelSpan.className="network-manipulationLabel",this.manipulationDOM.addNodeLabelSpan.innerHTML=t.addNode,this.manipulationDOM.addNodeSpan.appendChild(this.manipulationDOM.addNodeLabelSpan),this.manipulationDOM.seperatorLineDiv1=document.createElement("div"),this.manipulationDOM.seperatorLineDiv1.className="network-seperatorLine",this.manipulationDOM.addEdgeSpan=document.createElement("span"),this.manipulationDOM.addEdgeSpan.className="network-manipulationUI connect",this.manipulationDOM.addEdgeLabelSpan=document.createElement("span"),this.manipulationDOM.addEdgeLabelSpan.className="network-manipulationLabel",this.manipulationDOM.addEdgeLabelSpan.innerHTML=t.addEdge,this.manipulationDOM.addEdgeSpan.appendChild(this.manipulationDOM.addEdgeLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.addNodeSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv1),this.manipulationDiv.appendChild(this.manipulationDOM.addEdgeSpan),1==this._getSelectedNodeCount()&&this.triggerFunctions.edit?(this.manipulationDOM.seperatorLineDiv2=document.createElement("div"),this.manipulationDOM.seperatorLineDiv2.className="network-seperatorLine",this.manipulationDOM.editNodeSpan=document.createElement("span"),this.manipulationDOM.editNodeSpan.className="network-manipulationUI edit",this.manipulationDOM.editNodeLabelSpan=document.createElement("span"),this.manipulationDOM.editNodeLabelSpan.className="network-manipulationLabel",this.manipulationDOM.editNodeLabelSpan.innerHTML=t.editNode,this.manipulationDOM.editNodeSpan.appendChild(this.manipulationDOM.editNodeLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv2),this.manipulationDiv.appendChild(this.manipulationDOM.editNodeSpan)):1==this._getSelectedEdgeCount()&&0==this._getSelectedNodeCount()&&(this.manipulationDOM.seperatorLineDiv3=document.createElement("div"),this.manipulationDOM.seperatorLineDiv3.className="network-seperatorLine",this.manipulationDOM.editEdgeSpan=document.createElement("span"),this.manipulationDOM.editEdgeSpan.className="network-manipulationUI edit",this.manipulationDOM.editEdgeLabelSpan=document.createElement("span"),this.manipulationDOM.editEdgeLabelSpan.className="network-manipulationLabel",this.manipulationDOM.editEdgeLabelSpan.innerHTML=t.editEdge,this.manipulationDOM.editEdgeSpan.appendChild(this.manipulationDOM.editEdgeLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv3),this.manipulationDiv.appendChild(this.manipulationDOM.editEdgeSpan)),0==this._selectionIsEmpty()&&(this.manipulationDOM.seperatorLineDiv4=document.createElement("div"),this.manipulationDOM.seperatorLineDiv4.className="network-seperatorLine",this.manipulationDOM.deleteSpan=document.createElement("span"),this.manipulationDOM.deleteSpan.className="network-manipulationUI delete",this.manipulationDOM.deleteLabelSpan=document.createElement("span"),this.manipulationDOM.deleteLabelSpan.className="network-manipulationLabel",this.manipulationDOM.deleteLabelSpan.innerHTML=t.del,this.manipulationDOM.deleteSpan.appendChild(this.manipulationDOM.deleteLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv4),this.manipulationDiv.appendChild(this.manipulationDOM.deleteSpan)),this.manipulationDOM.addNodeSpan.onclick=this._createAddNodeToolbar.bind(this),this.manipulationDOM.addEdgeSpan.onclick=this._createAddEdgeToolbar.bind(this),1==this._getSelectedNodeCount()&&this.triggerFunctions.edit?this.manipulationDOM.editNodeSpan.onclick=this._editNode.bind(this):1==this._getSelectedEdgeCount()&&0==this._getSelectedNodeCount()&&(this.manipulationDOM.editEdgeSpan.onclick=this._createEditEdgeToolbar.bind(this)),0==this._selectionIsEmpty()&&(this.manipulationDOM.deleteSpan.onclick=this._deleteSelected.bind(this)),this.closeDiv.onclick=this._toggleEditMode.bind(this);var e=this;this.boundFunction=e._createManipulatorBar,this.on("select",this.boundFunction)}else{for(;this.editModeDiv.hasChildNodes();)this.editModeDiv.removeChild(this.editModeDiv.firstChild);this.manipulationDOM.editModeSpan=document.createElement("span"),this.manipulationDOM.editModeSpan.className="network-manipulationUI edit editmode",this.manipulationDOM.editModeLabelSpan=document.createElement("span"),this.manipulationDOM.editModeLabelSpan.className="network-manipulationLabel",this.manipulationDOM.editModeLabelSpan.innerHTML=t.edit,this.manipulationDOM.editModeSpan.appendChild(this.manipulationDOM.editModeLabelSpan),this.editModeDiv.appendChild(this.manipulationDOM.editModeSpan),this.manipulationDOM.editModeSpan.onclick=this._toggleEditMode.bind(this)}},e._createAddNodeToolbar=function(){this._clearManipulatorBar(),this.boundFunction&&this.off("select",this.boundFunction);var t=this.constants.locales[this.constants.locale];this.manipulationDOM={},this.manipulationDOM.backSpan=document.createElement("span"),this.manipulationDOM.backSpan.className="network-manipulationUI back",this.manipulationDOM.backLabelSpan=document.createElement("span"),this.manipulationDOM.backLabelSpan.className="network-manipulationLabel",this.manipulationDOM.backLabelSpan.innerHTML=t.back,this.manipulationDOM.backSpan.appendChild(this.manipulationDOM.backLabelSpan),this.manipulationDOM.seperatorLineDiv1=document.createElement("div"),this.manipulationDOM.seperatorLineDiv1.className="network-seperatorLine",this.manipulationDOM.descriptionSpan=document.createElement("span"),this.manipulationDOM.descriptionSpan.className="network-manipulationUI none",this.manipulationDOM.descriptionLabelSpan=document.createElement("span"),this.manipulationDOM.descriptionLabelSpan.className="network-manipulationLabel",this.manipulationDOM.descriptionLabelSpan.innerHTML=t.addDescription,this.manipulationDOM.descriptionSpan.appendChild(this.manipulationDOM.descriptionLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.backSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv1),this.manipulationDiv.appendChild(this.manipulationDOM.descriptionSpan),this.manipulationDOM.backSpan.onclick=this._createManipulatorBar.bind(this);var e=this;this.boundFunction=e._addNode,this.on("select",this.boundFunction)},e._createAddEdgeToolbar=function(){this._clearManipulatorBar(),this._unselectAll(!0),this.freezeSimulation=!0,this.boundFunction&&this.off("select",this.boundFunction);var t=this.constants.locales[this.constants.locale];this._unselectAll(),this.forceAppendSelection=!1,this.blockConnectingEdgeSelection=!0,this.manipulationDOM={},this.manipulationDOM.backSpan=document.createElement("span"),this.manipulationDOM.backSpan.className="network-manipulationUI back",this.manipulationDOM.backLabelSpan=document.createElement("span"),this.manipulationDOM.backLabelSpan.className="network-manipulationLabel",this.manipulationDOM.backLabelSpan.innerHTML=t.back,this.manipulationDOM.backSpan.appendChild(this.manipulationDOM.backLabelSpan),this.manipulationDOM.seperatorLineDiv1=document.createElement("div"),this.manipulationDOM.seperatorLineDiv1.className="network-seperatorLine",this.manipulationDOM.descriptionSpan=document.createElement("span"),this.manipulationDOM.descriptionSpan.className="network-manipulationUI none",this.manipulationDOM.descriptionLabelSpan=document.createElement("span"),this.manipulationDOM.descriptionLabelSpan.className="network-manipulationLabel",this.manipulationDOM.descriptionLabelSpan.innerHTML=t.edgeDescription,this.manipulationDOM.descriptionSpan.appendChild(this.manipulationDOM.descriptionLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.backSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv1),this.manipulationDiv.appendChild(this.manipulationDOM.descriptionSpan),this.manipulationDOM.backSpan.onclick=this._createManipulatorBar.bind(this);var e=this;this.boundFunction=e._handleConnect,this.on("select",this.boundFunction),this.cachedFunctions._handleTouch=this._handleTouch,this.cachedFunctions._manipulationReleaseOverload=this._manipulationReleaseOverload,this.cachedFunctions._handleDragStart=this._handleDragStart,this.cachedFunctions._handleDragEnd=this._handleDragEnd,this._handleTouch=this._handleConnect,this._manipulationReleaseOverload=function(){},this._handleDragStart=function(){},this._handleDragEnd=this._finishConnect,this._redraw()},e._createEditEdgeToolbar=function(){this._clearManipulatorBar(),this.controlNodesActive=!0,this.boundFunction&&this.off("select",this.boundFunction),this.edgeBeingEdited=this._getSelectedEdge(),this.edgeBeingEdited._enableControlNodes();var t=this.constants.locales[this.constants.locale];this.manipulationDOM={},this.manipulationDOM.backSpan=document.createElement("span"),this.manipulationDOM.backSpan.className="network-manipulationUI back",this.manipulationDOM.backLabelSpan=document.createElement("span"),this.manipulationDOM.backLabelSpan.className="network-manipulationLabel",this.manipulationDOM.backLabelSpan.innerHTML=t.back,this.manipulationDOM.backSpan.appendChild(this.manipulationDOM.backLabelSpan),this.manipulationDOM.seperatorLineDiv1=document.createElement("div"),this.manipulationDOM.seperatorLineDiv1.className="network-seperatorLine",this.manipulationDOM.descriptionSpan=document.createElement("span"),this.manipulationDOM.descriptionSpan.className="network-manipulationUI none",this.manipulationDOM.descriptionLabelSpan=document.createElement("span"),this.manipulationDOM.descriptionLabelSpan.className="network-manipulationLabel",this.manipulationDOM.descriptionLabelSpan.innerHTML=t.editEdgeDescription,this.manipulationDOM.descriptionSpan.appendChild(this.manipulationDOM.descriptionLabelSpan),this.manipulationDiv.appendChild(this.manipulationDOM.backSpan),this.manipulationDiv.appendChild(this.manipulationDOM.seperatorLineDiv1),this.manipulationDiv.appendChild(this.manipulationDOM.descriptionSpan),this.manipulationDOM.backSpan.onclick=this._createManipulatorBar.bind(this),this.cachedFunctions._handleTouch=this._handleTouch,this.cachedFunctions._manipulationReleaseOverload=this._manipulationReleaseOverload,this.cachedFunctions._handleTap=this._handleTap,this.cachedFunctions._handleDragStart=this._handleDragStart,this.cachedFunctions._handleOnDrag=this._handleOnDrag,this._handleTouch=this._selectControlNode,this._handleTap=function(){},this._handleOnDrag=this._controlNodeDrag,this._handleDragStart=function(){},this._manipulationReleaseOverload=this._releaseControlNode,this._redraw()},e._selectControlNode=function(t){this.edgeBeingEdited.controlNodes.from.unselect(),this.edgeBeingEdited.controlNodes.to.unselect(),this.selectedControlNode=this.edgeBeingEdited._getSelectedControlNode(this._XconvertDOMtoCanvas(t.x),this._YconvertDOMtoCanvas(t.y)),null!==this.selectedControlNode&&(this.selectedControlNode.select(),this.freezeSimulation=!0),this._redraw()},e._controlNodeDrag=function(t){var e=this._getPointer(t.gesture.center);null!==this.selectedControlNode&&void 0!==this.selectedControlNode&&(this.selectedControlNode.x=this._XconvertDOMtoCanvas(e.x),this.selectedControlNode.y=this._YconvertDOMtoCanvas(e.y)),this._redraw()},e._releaseControlNode=function(t){var e=this._getNodeAt(t);null!==e?(1==this.edgeBeingEdited.controlNodes.from.selected&&(this.edgeBeingEdited._restoreControlNodes(),this._editEdge(e.id,this.edgeBeingEdited.to.id),this.edgeBeingEdited.controlNodes.from.unselect()),1==this.edgeBeingEdited.controlNodes.to.selected&&(this.edgeBeingEdited._restoreControlNodes(),this._editEdge(this.edgeBeingEdited.from.id,e.id),this.edgeBeingEdited.controlNodes.to.unselect())):this.edgeBeingEdited._restoreControlNodes(),this.freezeSimulation=!1,this._redraw()},e._handleConnect=function(t){if(0==this._getSelectedNodeCount()){var e=this._getNodeAt(t);if(null!=e)if(e.clusterSize>1)alert(this.constants.locales[this.constants.locale].createEdgeError);else{this._selectObject(e,!1);var i=this.sectors.support.nodes;i.targetNode=new o({id:"targetNode"},{},{},this.constants);var s=i.targetNode;s.x=e.x,s.y=e.y,this.edges.connectionEdge=new n({id:"connectionEdge",from:e.id,to:s.id},this,this.constants);var r=this.edges.connectionEdge;r.from=e,r.connected=!0,r.options.smoothCurves={enabled:!0,dynamic:!1,type:"continuous",roundness:.5},r.selected=!0,r.to=s,this.cachedFunctions._handleOnDrag=this._handleOnDrag,this._handleOnDrag=function(t){var e=this._getPointer(t.gesture.center),i=this.edges.connectionEdge;i.to.x=this._XconvertDOMtoCanvas(e.x),i.to.y=this._YconvertDOMtoCanvas(e.y)},this.moving=!0,this.start()}}},e._finishConnect=function(t){if(1==this._getSelectedNodeCount()){var e=this._getPointer(t.gesture.center);this._handleOnDrag=this.cachedFunctions._handleOnDrag,delete this.cachedFunctions._handleOnDrag;var i=this.edges.connectionEdge.fromId;delete this.edges.connectionEdge,delete this.sectors.support.nodes.targetNode,delete this.sectors.support.nodes.targetViaNode;var s=this._getNodeAt(e);null!=s&&(s.clusterSize>1?alert(this.constants.locales[this.constants.locale].createEdgeError):(this._createEdge(i,s.id),this._createManipulatorBar())),this._unselectAll()}},e._addNode=function(){if(this._selectionIsEmpty()&&1==this.editMode){var t=this._pointerToPositionObject(this.pointerPosition),e={id:s.randomUUID(),x:t.left,y:t.top,label:"new",allowedToMoveX:!0,allowedToMoveY:!0};if(this.triggerFunctions.add){if(2!=this.triggerFunctions.add.length)throw new Error("The function for add does not support two arguments (data,callback)");var i=this;this.triggerFunctions.add(e,function(t){i.nodesData.add(t),i._createManipulatorBar(),i.moving=!0,i.start()})}else this.nodesData.add(e),this._createManipulatorBar(),this.moving=!0,this.start()}},e._createEdge=function(t,e){if(1==this.editMode){var i={from:t,to:e};if(this.triggerFunctions.connect){if(2!=this.triggerFunctions.connect.length)throw new Error("The function for connect does not support two arguments (data,callback)");var s=this;this.triggerFunctions.connect(i,function(t){s.edgesData.add(t),s.moving=!0,s.start()})}else this.edgesData.add(i),this.moving=!0,this.start()}},e._editEdge=function(t,e){if(1==this.editMode){var i={id:this.edgeBeingEdited.id,from:t,to:e};if(this.triggerFunctions.editEdge){if(2!=this.triggerFunctions.editEdge.length)throw new Error("The function for edit does not support two arguments (data, callback)");var s=this;this.triggerFunctions.editEdge(i,function(t){s.edgesData.update(t),s.moving=!0,s.start()})}else this.edgesData.update(i),this.moving=!0,this.start()}},e._editNode=function(){if(!this.triggerFunctions.edit||1!=this.editMode)throw new Error("No edit function has been bound to this button");var t=this._getSelectedNode(),e={id:t.id,label:t.label,group:t.options.group,shape:t.options.shape,color:{background:t.options.color.background,border:t.options.color.border,highlight:{background:t.options.color.highlight.background,border:t.options.color.highlight.border}}};if(2!=this.triggerFunctions.edit.length)throw new Error("The function for edit does not support two arguments (data, callback)");var i=this;this.triggerFunctions.edit(e,function(t){i.nodesData.update(t),i._createManipulatorBar(),i.moving=!0,i.start()})},e._deleteSelected=function(){if(!this._selectionIsEmpty()&&1==this.editMode)if(this._clusterInSelection())alert(this.constants.locales[this.constants.locale].deleteClusterError);else{var t=this.getSelectedNodes(),e=this.getSelectedEdges();if(this.triggerFunctions.del){var i=this,s={nodes:t,edges:e};if(2!=this.triggerFunctions.del.length)throw new Error("The function for delete does not support two arguments (data, callback)");this.triggerFunctions.del(s,function(t){i.edgesData.remove(t.edges),i.nodesData.remove(t.nodes),i._unselectAll(),i.moving=!0,i.start()})}else this.edgesData.remove(e),this.nodesData.remove(t),this._unselectAll(),this.moving=!0,this.start()}}},function(t,e,i){var s=(i(1),i(45));e._cleanNavigation=function(){if(0!=this.navigationHammers.existing.length){for(var t=0;t<this.navigationHammers.existing.length;t++)this.navigationHammers.existing[t].dispose();
this.navigationHammers.existing=[]}this._navigationReleaseOverload=function(){},this.navigationDivs&&this.navigationDivs.wrapper&&this.navigationDivs.wrapper.parentNode&&this.navigationDivs.wrapper.parentNode.removeChild(this.navigationDivs.wrapper)},e._loadNavigationElements=function(){this._cleanNavigation(),this.navigationDivs={};var t=["up","down","left","right","zoomIn","zoomOut","zoomExtends"],e=["_moveUp","_moveDown","_moveLeft","_moveRight","_zoomIn","_zoomOut","_zoomExtent"];this.navigationDivs.wrapper=document.createElement("div"),this.frame.appendChild(this.navigationDivs.wrapper);for(var i=0;i<t.length;i++){this.navigationDivs[t[i]]=document.createElement("div"),this.navigationDivs[t[i]].className="network-navigation "+t[i],this.navigationDivs.wrapper.appendChild(this.navigationDivs[t[i]]);var o=s(this.navigationDivs[t[i]],{prevent_default:!0});o.on("touch",this[e[i]].bind(this)),this.navigationHammers._new.push(o)}this._navigationReleaseOverload=this._stopMovement,this.navigationHammers.existing=this.navigationHammers._new},e._zoomExtent=function(t){this.zoomExtent({duration:700}),t.stopPropagation()},e._stopMovement=function(){this._xStopMoving(),this._yStopMoving(),this._stopZoom()},e._moveUp=function(t){this.yIncrement=this.constants.keyboard.speed.y,this.start(),t.preventDefault()},e._moveDown=function(t){this.yIncrement=-this.constants.keyboard.speed.y,this.start(),t.preventDefault()},e._moveLeft=function(t){this.xIncrement=this.constants.keyboard.speed.x,this.start(),t.preventDefault()},e._moveRight=function(t){this.xIncrement=-this.constants.keyboard.speed.y,this.start(),t.preventDefault()},e._zoomIn=function(t){this.zoomIncrement=this.constants.keyboard.speed.zoom,this.start(),t.preventDefault()},e._zoomOut=function(t){this.zoomIncrement=-this.constants.keyboard.speed.zoom,this.start(),t.preventDefault()},e._stopZoom=function(t){this.zoomIncrement=0,t&&t.preventDefault()},e._yStopMoving=function(t){this.yIncrement=0,t&&t.preventDefault()},e._xStopMoving=function(t){this.xIncrement=0,t&&t.preventDefault()}},function(t,e){e._resetLevels=function(){for(var t in this.nodes)if(this.nodes.hasOwnProperty(t)){var e=this.nodes[t];0==e.preassignedLevel&&(e.level=-1,e.hierarchyEnumerated=!1)}},e._setupHierarchicalLayout=function(){if(1==this.constants.hierarchicalLayout.enabled&&this.nodeIndices.length>0){var t,e,i=0,s=!1,o=!1;for(e in this.nodes)this.nodes.hasOwnProperty(e)&&(t=this.nodes[e],-1!=t.level?s=!0:o=!0,i<t.edges.length&&(i=t.edges.length));if(1==o&&1==s)throw new Error("To use the hierarchical layout, nodes require either no predefined levels or levels have to be defined for all nodes.");this._changeConstants(),1==o&&("hubsize"==this.constants.hierarchicalLayout.layout?this._determineLevels(i):this._determineLevelsDirected(!1));var n=this._getDistribution();this._placeNodesByHierarchy(n),this.start()}},e._placeNodesByHierarchy=function(t){var e,i;for(var s in t)if(t.hasOwnProperty(s))for(e in t[s].nodes)t[s].nodes.hasOwnProperty(e)&&(i=t[s].nodes[e],"UD"==this.constants.hierarchicalLayout.direction||"DU"==this.constants.hierarchicalLayout.direction?i.xFixed&&(i.x=t[s].minPos,i.xFixed=!1,t[s].minPos+=t[s].nodeSpacing):i.yFixed&&(i.y=t[s].minPos,i.yFixed=!1,t[s].minPos+=t[s].nodeSpacing),this._placeBranchNodes(i.edges,i.id,t,i.level));this._stabilize()},e._getDistribution=function(){var t,e,i,s={};for(t in this.nodes)this.nodes.hasOwnProperty(t)&&(e=this.nodes[t],e.xFixed=!0,e.yFixed=!0,"UD"==this.constants.hierarchicalLayout.direction||"DU"==this.constants.hierarchicalLayout.direction?e.y=this.constants.hierarchicalLayout.levelSeparation*e.level:e.x=this.constants.hierarchicalLayout.levelSeparation*e.level,void 0===s[e.level]&&(s[e.level]={amount:0,nodes:{},minPos:0,nodeSpacing:0}),s[e.level].amount+=1,s[e.level].nodes[t]=e);var o=0;for(i in s)s.hasOwnProperty(i)&&o<s[i].amount&&(o=s[i].amount);for(i in s)s.hasOwnProperty(i)&&(s[i].nodeSpacing=(o+1)*this.constants.hierarchicalLayout.nodeSpacing,s[i].nodeSpacing/=s[i].amount+1,s[i].minPos=s[i].nodeSpacing-.5*(s[i].amount+1)*s[i].nodeSpacing);return s},e._determineLevels=function(t){var e,i;for(e in this.nodes)this.nodes.hasOwnProperty(e)&&(i=this.nodes[e],i.edges.length==t&&(i.level=0));for(e in this.nodes)this.nodes.hasOwnProperty(e)&&(i=this.nodes[e],0==i.level&&this._setLevel(1,i.edges,i.id))},e._determineLevelsDirected=function(){var t,e,i,s=1e4;i=this.nodes[this.nodeIndices[0]],i.level=s,this._setLevelDirected(s,i.edges,i.id);for(t in this.nodes)this.nodes.hasOwnProperty(t)&&(e=this.nodes[t],s=e.level<s?e.level:s);for(t in this.nodes)this.nodes.hasOwnProperty(t)&&(e=this.nodes[t],e.level-=s)},e._changeConstants=function(){this.constants.clustering.enabled=!1,this.constants.physics.barnesHut.enabled=!1,this.constants.physics.hierarchicalRepulsion.enabled=!0,this._loadSelectedForceSolver(),1==this.constants.smoothCurves.enabled&&(this.constants.smoothCurves.dynamic=!1),this._configureSmoothCurves();var t=this.constants.hierarchicalLayout;t.levelSeparation=Math.abs(t.levelSeparation),("RL"==t.direction||"DU"==t.direction)&&(t.levelSeparation*=-1),"RL"==t.direction||"LR"==t.direction?1==this.constants.smoothCurves.enabled&&(this.constants.smoothCurves.type="vertical"):1==this.constants.smoothCurves.enabled&&(this.constants.smoothCurves.type="horizontal")},e._placeBranchNodes=function(t,e,i,s){for(var o=0;o<t.length;o++){var n=null;n=t[o].toId==e?t[o].from:t[o].to;var r=!1;"UD"==this.constants.hierarchicalLayout.direction||"DU"==this.constants.hierarchicalLayout.direction?n.xFixed&&n.level>s&&(n.xFixed=!1,n.x=i[n.level].minPos,r=!0):n.yFixed&&n.level>s&&(n.yFixed=!1,n.y=i[n.level].minPos,r=!0),1==r&&(i[n.level].minPos+=i[n.level].nodeSpacing,n.edges.length>1&&this._placeBranchNodes(n.edges,n.id,i,n.level))}},e._setLevel=function(t,e,i){for(var s=0;s<e.length;s++){var o=null;o=e[s].toId==i?e[s].from:e[s].to,(-1==o.level||o.level>t)&&(o.level=t,o.edges.length>1&&this._setLevel(t+1,o.edges,o.id))}},e._setLevelDirected=function(t,e,i){this.nodes[i].hierarchyEnumerated=!0;for(var s,o,n=0;n<e.length;n++)o=1,e[n].toId==i?(s=e[n].from,o=-1):s=e[n].to,-1==s.level&&(s.level=t+o);for(var n=0;n<e.length;n++)s=e[n].toId==i?e[n].from:e[n].to,s.edges.length>1&&s.hierarchyEnumerated===!1&&this._setLevelDirected(s.level,s.edges,s.id)},e._restoreNodes=function(){for(var t in this.nodes)this.nodes.hasOwnProperty(t)&&(this.nodes[t].xFixed=!1,this.nodes[t].yFixed=!1)}},function(t,e){e._calculateNodeForces=function(){var t,e,i,s,o,n,r,a,h,d,l,c=this.calculationNodes,p=this.calculationNodeIndices,u=-2/3,m=4/3,f=this.constants.physics.repulsion.nodeDistance,g=f;for(d=0;d<p.length-1;d++)for(a=c[p[d]],l=d+1;l<p.length;l++){h=c[p[l]],n=a.clusterSize+h.clusterSize-2,t=h.x-a.x,e=h.y-a.y,i=Math.sqrt(t*t+e*e),0==i&&(i=.1*Math.random(),t=i),g=0==n?f:f*(1+n*this.constants.clustering.distanceAmplification);var v=u/g;2*g>i&&(r=.5*g>i?1:v*i+m,r*=0==n?1:1+n*this.constants.clustering.forceAmplification,r/=Math.max(i,.01*g),s=t*r,o=e*r,a.fx-=s,a.fy-=o,h.fx+=s,h.fy+=o)}}},function(t,e){e._calculateNodeForces=function(){var t,e,i,s,o,n,r,a,h,d,l=this.calculationNodes,c=this.calculationNodeIndices,p=this.constants.physics.hierarchicalRepulsion.nodeDistance;for(h=0;h<c.length-1;h++)for(r=l[c[h]],d=h+1;d<c.length;d++)if(a=l[c[d]],r.level==a.level){t=a.x-r.x,e=a.y-r.y,i=Math.sqrt(t*t+e*e);var u=.05;n=p>i?-Math.pow(u*i,2)+Math.pow(u*p,2):0,0==i?i=.01:n/=i,s=t*n,o=e*n,r.fx-=s,r.fy-=o,a.fx+=s,a.fy+=o}},e._calculateHierarchicalSpringForces=function(){for(var t,e,i,s,o,n,r,a,h,d=this.edges,l=this.calculationNodes,c=this.calculationNodeIndices,p=0;p<c.length;p++){var u=l[c[p]];u.springFx=0,u.springFy=0}for(i in d)if(d.hasOwnProperty(i)&&(e=d[i],e.connected&&this.nodes.hasOwnProperty(e.toId)&&this.nodes.hasOwnProperty(e.fromId)))if(t=e.physics.springLength,t+=(e.to.clusterSize+e.from.clusterSize-2)*this.constants.clustering.edgeGrowth,s=e.from.x-e.to.x,o=e.from.y-e.to.y,h=Math.sqrt(s*s+o*o),0==h&&(h=.01),a=this.constants.physics.springConstant*(t-h)/h,n=s*a,r=o*a,e.to.level!=e.from.level)e.to.springFx-=n,e.to.springFy-=r,e.from.springFx+=n,e.from.springFy+=r;else{var m=.5;e.to.fx-=m*n,e.to.fy-=m*r,e.from.fx+=m*n,e.from.fy+=m*r}var f,g,a=1;for(p=0;p<c.length;p++){var v=l[c[p]];f=Math.min(a,Math.max(-a,v.springFx)),g=Math.min(a,Math.max(-a,v.springFy)),v.fx+=f,v.fy+=g}var y=0,b=0;for(p=0;p<c.length;p++){var v=l[c[p]];y+=v.fx,b+=v.fy}var _=y/c.length,x=b/c.length;for(p=0;p<c.length;p++){var v=l[c[p]];v.fx-=_,v.fy-=x}}},function(t,e){e._calculateNodeForces=function(){if(0!=this.constants.physics.barnesHut.gravitationalConstant){var t,e=this.calculationNodes,i=this.calculationNodeIndices,s=i.length;this._formBarnesHutTree(e,i);for(var o=this.barnesHutTree,n=0;s>n;n++)t=e[i[n]],t.options.mass>0&&(this._getForceContribution(o.root.children.NW,t),this._getForceContribution(o.root.children.NE,t),this._getForceContribution(o.root.children.SW,t),this._getForceContribution(o.root.children.SE,t))}},e._getForceContribution=function(t,e){if(t.childrenCount>0){var i,s,o;if(i=t.centerOfMass.x-e.x,s=t.centerOfMass.y-e.y,o=Math.sqrt(i*i+s*s),o*t.calcSize>this.constants.physics.barnesHut.thetaInverted){0==o&&(o=.1*Math.random(),i=o);var n=this.constants.physics.barnesHut.gravitationalConstant*t.mass*e.options.mass/(o*o*o),r=i*n,a=s*n;e.fx+=r,e.fy+=a}else if(4==t.childrenCount)this._getForceContribution(t.children.NW,e),this._getForceContribution(t.children.NE,e),this._getForceContribution(t.children.SW,e),this._getForceContribution(t.children.SE,e);else if(t.children.data.id!=e.id){0==o&&(o=.5*Math.random(),i=o);var n=this.constants.physics.barnesHut.gravitationalConstant*t.mass*e.options.mass/(o*o*o),r=i*n,a=s*n;e.fx+=r,e.fy+=a}}},e._formBarnesHutTree=function(t,e){for(var i,s=e.length,o=Number.MAX_VALUE,n=Number.MAX_VALUE,r=-Number.MAX_VALUE,a=-Number.MAX_VALUE,h=0;s>h;h++){var d=t[e[h]].x,l=t[e[h]].y;t[e[h]].options.mass>0&&(o>d&&(o=d),d>r&&(r=d),n>l&&(n=l),l>a&&(a=l))}var c=Math.abs(r-o)-Math.abs(a-n);c>0?(n-=.5*c,a+=.5*c):(o+=.5*c,r-=.5*c);var p=1e-5,u=Math.max(p,Math.abs(r-o)),m=.5*u,f=.5*(o+r),g=.5*(n+a),v={root:{centerOfMass:{x:0,y:0},mass:0,range:{minX:f-m,maxX:f+m,minY:g-m,maxY:g+m},size:u,calcSize:1/u,children:{data:null},maxWidth:0,level:0,childrenCount:4}};for(this._splitBranch(v.root),h=0;s>h;h++)i=t[e[h]],i.options.mass>0&&this._placeInTree(v.root,i);this.barnesHutTree=v},e._updateBranchMass=function(t,e){var i=t.mass+e.options.mass,s=1/i;t.centerOfMass.x=t.centerOfMass.x*t.mass+e.x*e.options.mass,t.centerOfMass.x*=s,t.centerOfMass.y=t.centerOfMass.y*t.mass+e.y*e.options.mass,t.centerOfMass.y*=s,t.mass=i;var o=Math.max(Math.max(e.height,e.radius),e.width);t.maxWidth=t.maxWidth<o?o:t.maxWidth},e._placeInTree=function(t,e,i){(1!=i||void 0===i)&&this._updateBranchMass(t,e),t.children.NW.range.maxX>e.x?t.children.NW.range.maxY>e.y?this._placeInRegion(t,e,"NW"):this._placeInRegion(t,e,"SW"):t.children.NW.range.maxY>e.y?this._placeInRegion(t,e,"NE"):this._placeInRegion(t,e,"SE")},e._placeInRegion=function(t,e,i){switch(t.children[i].childrenCount){case 0:t.children[i].children.data=e,t.children[i].childrenCount=1,this._updateBranchMass(t.children[i],e);break;case 1:t.children[i].children.data.x==e.x&&t.children[i].children.data.y==e.y?(e.x+=Math.random(),e.y+=Math.random()):(this._splitBranch(t.children[i]),this._placeInTree(t.children[i],e));break;case 4:this._placeInTree(t.children[i],e)}},e._splitBranch=function(t){var e=null;1==t.childrenCount&&(e=t.children.data,t.mass=0,t.centerOfMass.x=0,t.centerOfMass.y=0),t.childrenCount=4,t.children.data=null,this._insertRegion(t,"NW"),this._insertRegion(t,"NE"),this._insertRegion(t,"SW"),this._insertRegion(t,"SE"),null!=e&&this._placeInTree(t,e)},e._insertRegion=function(t,e){var i,s,o,n,r=.5*t.size;switch(e){case"NW":i=t.range.minX,s=t.range.minX+r,o=t.range.minY,n=t.range.minY+r;break;case"NE":i=t.range.minX+r,s=t.range.maxX,o=t.range.minY,n=t.range.minY+r;break;case"SW":i=t.range.minX,s=t.range.minX+r,o=t.range.minY+r,n=t.range.maxY;break;case"SE":i=t.range.minX+r,s=t.range.maxX,o=t.range.minY+r,n=t.range.maxY}t.children[e]={centerOfMass:{x:0,y:0},mass:0,range:{minX:i,maxX:s,minY:o,maxY:n},size:.5*t.size,calcSize:2*t.calcSize,children:{data:null},maxWidth:0,level:t.level+1,childrenCount:0}},e._drawTree=function(t,e){void 0!==this.barnesHutTree&&(t.lineWidth=1,this._drawBranch(this.barnesHutTree.root,t,e))},e._drawBranch=function(t,e,i){void 0===i&&(i="#FF0000"),4==t.childrenCount&&(this._drawBranch(t.children.NW,e),this._drawBranch(t.children.NE,e),this._drawBranch(t.children.SE,e),this._drawBranch(t.children.SW,e)),e.strokeStyle=i,e.beginPath(),e.moveTo(t.range.minX,t.range.minY),e.lineTo(t.range.maxX,t.range.minY),e.stroke(),e.beginPath(),e.moveTo(t.range.maxX,t.range.minY),e.lineTo(t.range.maxX,t.range.maxY),e.stroke(),e.beginPath(),e.moveTo(t.range.maxX,t.range.maxY),e.lineTo(t.range.minX,t.range.maxY),e.stroke(),e.beginPath(),e.moveTo(t.range.minX,t.range.maxY),e.lineTo(t.range.minX,t.range.minY),e.stroke()}},function(t){function e(t){throw new Error("Cannot find module '"+t+"'.")}e.keys=function(){return[]},e.resolve=e,t.exports=e,e.id=70},function(t){t.exports=function(t){return t.webpackPolyfill||(t.deprecate=function(){},t.paths=[],t.children=[],t.webpackPolyfill=1),t}}])});
//# sourceMappingURL=vis.map
;
(function () {
    

    define('common/vis/graph.directive',['vis'], function (vis) {

        var initDirective = function ($element) {
            var nodes = [];
            var edges = [];
            var connectionCount = [];

            var from,to;

            // randomly create some nodes and edges
            var nodeCount = 20;
            for (var i = 0; i < nodeCount; i++) {
                nodes.push({
                    id: i,
                    label: ""
                });

                connectionCount[i] = 0;

                // create edges in a scale-free-network way
                if (i == 1) {
                    from = i;
                    to = 0;
                    edges.push({
                        from: from,
                        to: to
                    });
                    connectionCount[from]++;
                    connectionCount[to]++;
                }
                else if (i > 1) {
                    var conn = edges.length * 2;
                    var rand = Math.floor(Math.random() * conn);
                    var cum = 0;
                    var j = 0;
                    while (j < connectionCount.length && cum < rand) {
                        cum += connectionCount[j];
                        j++;
                    }

                    from = i;
                    to = j;
                    edges.push({
                        from: from,
                        to: to
                    });
                    connectionCount[from]++;
                    connectionCount[to]++;
                }
            }

            // create a network
            var clusteringOn = false;
            var clusterEdgeThreshold = 10;
            var container = document.getElementById('graph');
            var data = {
                nodes: nodes,
                edges: edges
            };
            var options = {
                style: 'surface',
                showPerspective: true,
                clustering: {
                    enabled: clusteringOn,
                    clusterEdgeThreshold: clusterEdgeThreshold
                },
                stabilize: false,
                zoomable: false,
                dragNetwork: false

            };
           new vis.Network(container, data, options);

        };


        /**
         * Required for the angular directive;
         * @returns {{restrict: string, scope: boolean, link: link}}
         */
        var graph = function ($timeout) {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    $timeout(function () {
                        initDirective($element);
                    }, 1000);
                }
            };
        };
        return ["$timeout", graph];

    });
}());
/*! jQuery v2.1.3 | (c) 2005, 2014 jQuery Foundation, Inc. | jquery.org/license */
!function(a,b){"object"==typeof module&&"object"==typeof module.exports?module.exports=a.document?b(a,!0):function(a){if(!a.document)throw new Error("jQuery requires a window with a document");return b(a)}:b(a)}("undefined"!=typeof window?window:this,function(a,b){var c=[],d=c.slice,e=c.concat,f=c.push,g=c.indexOf,h={},i=h.toString,j=h.hasOwnProperty,k={},l=a.document,m="2.1.3",n=function(a,b){return new n.fn.init(a,b)},o=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,p=/^-ms-/,q=/-([\da-z])/gi,r=function(a,b){return b.toUpperCase()};n.fn=n.prototype={jquery:m,constructor:n,selector:"",length:0,toArray:function(){return d.call(this)},get:function(a){return null!=a?0>a?this[a+this.length]:this[a]:d.call(this)},pushStack:function(a){var b=n.merge(this.constructor(),a);return b.prevObject=this,b.context=this.context,b},each:function(a,b){return n.each(this,a,b)},map:function(a){return this.pushStack(n.map(this,function(b,c){return a.call(b,c,b)}))},slice:function(){return this.pushStack(d.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},eq:function(a){var b=this.length,c=+a+(0>a?b:0);return this.pushStack(c>=0&&b>c?[this[c]]:[])},end:function(){return this.prevObject||this.constructor(null)},push:f,sort:c.sort,splice:c.splice},n.extend=n.fn.extend=function(){var a,b,c,d,e,f,g=arguments[0]||{},h=1,i=arguments.length,j=!1;for("boolean"==typeof g&&(j=g,g=arguments[h]||{},h++),"object"==typeof g||n.isFunction(g)||(g={}),h===i&&(g=this,h--);i>h;h++)if(null!=(a=arguments[h]))for(b in a)c=g[b],d=a[b],g!==d&&(j&&d&&(n.isPlainObject(d)||(e=n.isArray(d)))?(e?(e=!1,f=c&&n.isArray(c)?c:[]):f=c&&n.isPlainObject(c)?c:{},g[b]=n.extend(j,f,d)):void 0!==d&&(g[b]=d));return g},n.extend({expando:"jQuery"+(m+Math.random()).replace(/\D/g,""),isReady:!0,error:function(a){throw new Error(a)},noop:function(){},isFunction:function(a){return"function"===n.type(a)},isArray:Array.isArray,isWindow:function(a){return null!=a&&a===a.window},isNumeric:function(a){return!n.isArray(a)&&a-parseFloat(a)+1>=0},isPlainObject:function(a){return"object"!==n.type(a)||a.nodeType||n.isWindow(a)?!1:a.constructor&&!j.call(a.constructor.prototype,"isPrototypeOf")?!1:!0},isEmptyObject:function(a){var b;for(b in a)return!1;return!0},type:function(a){return null==a?a+"":"object"==typeof a||"function"==typeof a?h[i.call(a)]||"object":typeof a},globalEval:function(a){var b,c=eval;a=n.trim(a),a&&(1===a.indexOf("use strict")?(b=l.createElement("script"),b.text=a,l.head.appendChild(b).parentNode.removeChild(b)):c(a))},camelCase:function(a){return a.replace(p,"ms-").replace(q,r)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toLowerCase()===b.toLowerCase()},each:function(a,b,c){var d,e=0,f=a.length,g=s(a);if(c){if(g){for(;f>e;e++)if(d=b.apply(a[e],c),d===!1)break}else for(e in a)if(d=b.apply(a[e],c),d===!1)break}else if(g){for(;f>e;e++)if(d=b.call(a[e],e,a[e]),d===!1)break}else for(e in a)if(d=b.call(a[e],e,a[e]),d===!1)break;return a},trim:function(a){return null==a?"":(a+"").replace(o,"")},makeArray:function(a,b){var c=b||[];return null!=a&&(s(Object(a))?n.merge(c,"string"==typeof a?[a]:a):f.call(c,a)),c},inArray:function(a,b,c){return null==b?-1:g.call(b,a,c)},merge:function(a,b){for(var c=+b.length,d=0,e=a.length;c>d;d++)a[e++]=b[d];return a.length=e,a},grep:function(a,b,c){for(var d,e=[],f=0,g=a.length,h=!c;g>f;f++)d=!b(a[f],f),d!==h&&e.push(a[f]);return e},map:function(a,b,c){var d,f=0,g=a.length,h=s(a),i=[];if(h)for(;g>f;f++)d=b(a[f],f,c),null!=d&&i.push(d);else for(f in a)d=b(a[f],f,c),null!=d&&i.push(d);return e.apply([],i)},guid:1,proxy:function(a,b){var c,e,f;return"string"==typeof b&&(c=a[b],b=a,a=c),n.isFunction(a)?(e=d.call(arguments,2),f=function(){return a.apply(b||this,e.concat(d.call(arguments)))},f.guid=a.guid=a.guid||n.guid++,f):void 0},now:Date.now,support:k}),n.each("Boolean Number String Function Array Date RegExp Object Error".split(" "),function(a,b){h["[object "+b+"]"]=b.toLowerCase()});function s(a){var b=a.length,c=n.type(a);return"function"===c||n.isWindow(a)?!1:1===a.nodeType&&b?!0:"array"===c||0===b||"number"==typeof b&&b>0&&b-1 in a}var t=function(a){var b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u="sizzle"+1*new Date,v=a.document,w=0,x=0,y=hb(),z=hb(),A=hb(),B=function(a,b){return a===b&&(l=!0),0},C=1<<31,D={}.hasOwnProperty,E=[],F=E.pop,G=E.push,H=E.push,I=E.slice,J=function(a,b){for(var c=0,d=a.length;d>c;c++)if(a[c]===b)return c;return-1},K="checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",L="[\\x20\\t\\r\\n\\f]",M="(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",N=M.replace("w","w#"),O="\\["+L+"*("+M+")(?:"+L+"*([*^$|!~]?=)"+L+"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|("+N+"))|)"+L+"*\\]",P=":("+M+")(?:\\((('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|((?:\\\\.|[^\\\\()[\\]]|"+O+")*)|.*)\\)|)",Q=new RegExp(L+"+","g"),R=new RegExp("^"+L+"+|((?:^|[^\\\\])(?:\\\\.)*)"+L+"+$","g"),S=new RegExp("^"+L+"*,"+L+"*"),T=new RegExp("^"+L+"*([>+~]|"+L+")"+L+"*"),U=new RegExp("="+L+"*([^\\]'\"]*?)"+L+"*\\]","g"),V=new RegExp(P),W=new RegExp("^"+N+"$"),X={ID:new RegExp("^#("+M+")"),CLASS:new RegExp("^\\.("+M+")"),TAG:new RegExp("^("+M.replace("w","w*")+")"),ATTR:new RegExp("^"+O),PSEUDO:new RegExp("^"+P),CHILD:new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+L+"*(even|odd|(([+-]|)(\\d*)n|)"+L+"*(?:([+-]|)"+L+"*(\\d+)|))"+L+"*\\)|)","i"),bool:new RegExp("^(?:"+K+")$","i"),needsContext:new RegExp("^"+L+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+L+"*((?:-\\d)?\\d*)"+L+"*\\)|)(?=[^-]|$)","i")},Y=/^(?:input|select|textarea|button)$/i,Z=/^h\d$/i,$=/^[^{]+\{\s*\[native \w/,_=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,ab=/[+~]/,bb=/'|\\/g,cb=new RegExp("\\\\([\\da-f]{1,6}"+L+"?|("+L+")|.)","ig"),db=function(a,b,c){var d="0x"+b-65536;return d!==d||c?b:0>d?String.fromCharCode(d+65536):String.fromCharCode(d>>10|55296,1023&d|56320)},eb=function(){m()};try{H.apply(E=I.call(v.childNodes),v.childNodes),E[v.childNodes.length].nodeType}catch(fb){H={apply:E.length?function(a,b){G.apply(a,I.call(b))}:function(a,b){var c=a.length,d=0;while(a[c++]=b[d++]);a.length=c-1}}}function gb(a,b,d,e){var f,h,j,k,l,o,r,s,w,x;if((b?b.ownerDocument||b:v)!==n&&m(b),b=b||n,d=d||[],k=b.nodeType,"string"!=typeof a||!a||1!==k&&9!==k&&11!==k)return d;if(!e&&p){if(11!==k&&(f=_.exec(a)))if(j=f[1]){if(9===k){if(h=b.getElementById(j),!h||!h.parentNode)return d;if(h.id===j)return d.push(h),d}else if(b.ownerDocument&&(h=b.ownerDocument.getElementById(j))&&t(b,h)&&h.id===j)return d.push(h),d}else{if(f[2])return H.apply(d,b.getElementsByTagName(a)),d;if((j=f[3])&&c.getElementsByClassName)return H.apply(d,b.getElementsByClassName(j)),d}if(c.qsa&&(!q||!q.test(a))){if(s=r=u,w=b,x=1!==k&&a,1===k&&"object"!==b.nodeName.toLowerCase()){o=g(a),(r=b.getAttribute("id"))?s=r.replace(bb,"\\$&"):b.setAttribute("id",s),s="[id='"+s+"'] ",l=o.length;while(l--)o[l]=s+rb(o[l]);w=ab.test(a)&&pb(b.parentNode)||b,x=o.join(",")}if(x)try{return H.apply(d,w.querySelectorAll(x)),d}catch(y){}finally{r||b.removeAttribute("id")}}}return i(a.replace(R,"$1"),b,d,e)}function hb(){var a=[];function b(c,e){return a.push(c+" ")>d.cacheLength&&delete b[a.shift()],b[c+" "]=e}return b}function ib(a){return a[u]=!0,a}function jb(a){var b=n.createElement("div");try{return!!a(b)}catch(c){return!1}finally{b.parentNode&&b.parentNode.removeChild(b),b=null}}function kb(a,b){var c=a.split("|"),e=a.length;while(e--)d.attrHandle[c[e]]=b}function lb(a,b){var c=b&&a,d=c&&1===a.nodeType&&1===b.nodeType&&(~b.sourceIndex||C)-(~a.sourceIndex||C);if(d)return d;if(c)while(c=c.nextSibling)if(c===b)return-1;return a?1:-1}function mb(a){return function(b){var c=b.nodeName.toLowerCase();return"input"===c&&b.type===a}}function nb(a){return function(b){var c=b.nodeName.toLowerCase();return("input"===c||"button"===c)&&b.type===a}}function ob(a){return ib(function(b){return b=+b,ib(function(c,d){var e,f=a([],c.length,b),g=f.length;while(g--)c[e=f[g]]&&(c[e]=!(d[e]=c[e]))})})}function pb(a){return a&&"undefined"!=typeof a.getElementsByTagName&&a}c=gb.support={},f=gb.isXML=function(a){var b=a&&(a.ownerDocument||a).documentElement;return b?"HTML"!==b.nodeName:!1},m=gb.setDocument=function(a){var b,e,g=a?a.ownerDocument||a:v;return g!==n&&9===g.nodeType&&g.documentElement?(n=g,o=g.documentElement,e=g.defaultView,e&&e!==e.top&&(e.addEventListener?e.addEventListener("unload",eb,!1):e.attachEvent&&e.attachEvent("onunload",eb)),p=!f(g),c.attributes=jb(function(a){return a.className="i",!a.getAttribute("className")}),c.getElementsByTagName=jb(function(a){return a.appendChild(g.createComment("")),!a.getElementsByTagName("*").length}),c.getElementsByClassName=$.test(g.getElementsByClassName),c.getById=jb(function(a){return o.appendChild(a).id=u,!g.getElementsByName||!g.getElementsByName(u).length}),c.getById?(d.find.ID=function(a,b){if("undefined"!=typeof b.getElementById&&p){var c=b.getElementById(a);return c&&c.parentNode?[c]:[]}},d.filter.ID=function(a){var b=a.replace(cb,db);return function(a){return a.getAttribute("id")===b}}):(delete d.find.ID,d.filter.ID=function(a){var b=a.replace(cb,db);return function(a){var c="undefined"!=typeof a.getAttributeNode&&a.getAttributeNode("id");return c&&c.value===b}}),d.find.TAG=c.getElementsByTagName?function(a,b){return"undefined"!=typeof b.getElementsByTagName?b.getElementsByTagName(a):c.qsa?b.querySelectorAll(a):void 0}:function(a,b){var c,d=[],e=0,f=b.getElementsByTagName(a);if("*"===a){while(c=f[e++])1===c.nodeType&&d.push(c);return d}return f},d.find.CLASS=c.getElementsByClassName&&function(a,b){return p?b.getElementsByClassName(a):void 0},r=[],q=[],(c.qsa=$.test(g.querySelectorAll))&&(jb(function(a){o.appendChild(a).innerHTML="<a id='"+u+"'></a><select id='"+u+"-\f]' msallowcapture=''><option selected=''></option></select>",a.querySelectorAll("[msallowcapture^='']").length&&q.push("[*^$]="+L+"*(?:''|\"\")"),a.querySelectorAll("[selected]").length||q.push("\\["+L+"*(?:value|"+K+")"),a.querySelectorAll("[id~="+u+"-]").length||q.push("~="),a.querySelectorAll(":checked").length||q.push(":checked"),a.querySelectorAll("a#"+u+"+*").length||q.push(".#.+[+~]")}),jb(function(a){var b=g.createElement("input");b.setAttribute("type","hidden"),a.appendChild(b).setAttribute("name","D"),a.querySelectorAll("[name=d]").length&&q.push("name"+L+"*[*^$|!~]?="),a.querySelectorAll(":enabled").length||q.push(":enabled",":disabled"),a.querySelectorAll("*,:x"),q.push(",.*:")})),(c.matchesSelector=$.test(s=o.matches||o.webkitMatchesSelector||o.mozMatchesSelector||o.oMatchesSelector||o.msMatchesSelector))&&jb(function(a){c.disconnectedMatch=s.call(a,"div"),s.call(a,"[s!='']:x"),r.push("!=",P)}),q=q.length&&new RegExp(q.join("|")),r=r.length&&new RegExp(r.join("|")),b=$.test(o.compareDocumentPosition),t=b||$.test(o.contains)?function(a,b){var c=9===a.nodeType?a.documentElement:a,d=b&&b.parentNode;return a===d||!(!d||1!==d.nodeType||!(c.contains?c.contains(d):a.compareDocumentPosition&&16&a.compareDocumentPosition(d)))}:function(a,b){if(b)while(b=b.parentNode)if(b===a)return!0;return!1},B=b?function(a,b){if(a===b)return l=!0,0;var d=!a.compareDocumentPosition-!b.compareDocumentPosition;return d?d:(d=(a.ownerDocument||a)===(b.ownerDocument||b)?a.compareDocumentPosition(b):1,1&d||!c.sortDetached&&b.compareDocumentPosition(a)===d?a===g||a.ownerDocument===v&&t(v,a)?-1:b===g||b.ownerDocument===v&&t(v,b)?1:k?J(k,a)-J(k,b):0:4&d?-1:1)}:function(a,b){if(a===b)return l=!0,0;var c,d=0,e=a.parentNode,f=b.parentNode,h=[a],i=[b];if(!e||!f)return a===g?-1:b===g?1:e?-1:f?1:k?J(k,a)-J(k,b):0;if(e===f)return lb(a,b);c=a;while(c=c.parentNode)h.unshift(c);c=b;while(c=c.parentNode)i.unshift(c);while(h[d]===i[d])d++;return d?lb(h[d],i[d]):h[d]===v?-1:i[d]===v?1:0},g):n},gb.matches=function(a,b){return gb(a,null,null,b)},gb.matchesSelector=function(a,b){if((a.ownerDocument||a)!==n&&m(a),b=b.replace(U,"='$1']"),!(!c.matchesSelector||!p||r&&r.test(b)||q&&q.test(b)))try{var d=s.call(a,b);if(d||c.disconnectedMatch||a.document&&11!==a.document.nodeType)return d}catch(e){}return gb(b,n,null,[a]).length>0},gb.contains=function(a,b){return(a.ownerDocument||a)!==n&&m(a),t(a,b)},gb.attr=function(a,b){(a.ownerDocument||a)!==n&&m(a);var e=d.attrHandle[b.toLowerCase()],f=e&&D.call(d.attrHandle,b.toLowerCase())?e(a,b,!p):void 0;return void 0!==f?f:c.attributes||!p?a.getAttribute(b):(f=a.getAttributeNode(b))&&f.specified?f.value:null},gb.error=function(a){throw new Error("Syntax error, unrecognized expression: "+a)},gb.uniqueSort=function(a){var b,d=[],e=0,f=0;if(l=!c.detectDuplicates,k=!c.sortStable&&a.slice(0),a.sort(B),l){while(b=a[f++])b===a[f]&&(e=d.push(f));while(e--)a.splice(d[e],1)}return k=null,a},e=gb.getText=function(a){var b,c="",d=0,f=a.nodeType;if(f){if(1===f||9===f||11===f){if("string"==typeof a.textContent)return a.textContent;for(a=a.firstChild;a;a=a.nextSibling)c+=e(a)}else if(3===f||4===f)return a.nodeValue}else while(b=a[d++])c+=e(b);return c},d=gb.selectors={cacheLength:50,createPseudo:ib,match:X,attrHandle:{},find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(a){return a[1]=a[1].replace(cb,db),a[3]=(a[3]||a[4]||a[5]||"").replace(cb,db),"~="===a[2]&&(a[3]=" "+a[3]+" "),a.slice(0,4)},CHILD:function(a){return a[1]=a[1].toLowerCase(),"nth"===a[1].slice(0,3)?(a[3]||gb.error(a[0]),a[4]=+(a[4]?a[5]+(a[6]||1):2*("even"===a[3]||"odd"===a[3])),a[5]=+(a[7]+a[8]||"odd"===a[3])):a[3]&&gb.error(a[0]),a},PSEUDO:function(a){var b,c=!a[6]&&a[2];return X.CHILD.test(a[0])?null:(a[3]?a[2]=a[4]||a[5]||"":c&&V.test(c)&&(b=g(c,!0))&&(b=c.indexOf(")",c.length-b)-c.length)&&(a[0]=a[0].slice(0,b),a[2]=c.slice(0,b)),a.slice(0,3))}},filter:{TAG:function(a){var b=a.replace(cb,db).toLowerCase();return"*"===a?function(){return!0}:function(a){return a.nodeName&&a.nodeName.toLowerCase()===b}},CLASS:function(a){var b=y[a+" "];return b||(b=new RegExp("(^|"+L+")"+a+"("+L+"|$)"))&&y(a,function(a){return b.test("string"==typeof a.className&&a.className||"undefined"!=typeof a.getAttribute&&a.getAttribute("class")||"")})},ATTR:function(a,b,c){return function(d){var e=gb.attr(d,a);return null==e?"!="===b:b?(e+="","="===b?e===c:"!="===b?e!==c:"^="===b?c&&0===e.indexOf(c):"*="===b?c&&e.indexOf(c)>-1:"$="===b?c&&e.slice(-c.length)===c:"~="===b?(" "+e.replace(Q," ")+" ").indexOf(c)>-1:"|="===b?e===c||e.slice(0,c.length+1)===c+"-":!1):!0}},CHILD:function(a,b,c,d,e){var f="nth"!==a.slice(0,3),g="last"!==a.slice(-4),h="of-type"===b;return 1===d&&0===e?function(a){return!!a.parentNode}:function(b,c,i){var j,k,l,m,n,o,p=f!==g?"nextSibling":"previousSibling",q=b.parentNode,r=h&&b.nodeName.toLowerCase(),s=!i&&!h;if(q){if(f){while(p){l=b;while(l=l[p])if(h?l.nodeName.toLowerCase()===r:1===l.nodeType)return!1;o=p="only"===a&&!o&&"nextSibling"}return!0}if(o=[g?q.firstChild:q.lastChild],g&&s){k=q[u]||(q[u]={}),j=k[a]||[],n=j[0]===w&&j[1],m=j[0]===w&&j[2],l=n&&q.childNodes[n];while(l=++n&&l&&l[p]||(m=n=0)||o.pop())if(1===l.nodeType&&++m&&l===b){k[a]=[w,n,m];break}}else if(s&&(j=(b[u]||(b[u]={}))[a])&&j[0]===w)m=j[1];else while(l=++n&&l&&l[p]||(m=n=0)||o.pop())if((h?l.nodeName.toLowerCase()===r:1===l.nodeType)&&++m&&(s&&((l[u]||(l[u]={}))[a]=[w,m]),l===b))break;return m-=e,m===d||m%d===0&&m/d>=0}}},PSEUDO:function(a,b){var c,e=d.pseudos[a]||d.setFilters[a.toLowerCase()]||gb.error("unsupported pseudo: "+a);return e[u]?e(b):e.length>1?(c=[a,a,"",b],d.setFilters.hasOwnProperty(a.toLowerCase())?ib(function(a,c){var d,f=e(a,b),g=f.length;while(g--)d=J(a,f[g]),a[d]=!(c[d]=f[g])}):function(a){return e(a,0,c)}):e}},pseudos:{not:ib(function(a){var b=[],c=[],d=h(a.replace(R,"$1"));return d[u]?ib(function(a,b,c,e){var f,g=d(a,null,e,[]),h=a.length;while(h--)(f=g[h])&&(a[h]=!(b[h]=f))}):function(a,e,f){return b[0]=a,d(b,null,f,c),b[0]=null,!c.pop()}}),has:ib(function(a){return function(b){return gb(a,b).length>0}}),contains:ib(function(a){return a=a.replace(cb,db),function(b){return(b.textContent||b.innerText||e(b)).indexOf(a)>-1}}),lang:ib(function(a){return W.test(a||"")||gb.error("unsupported lang: "+a),a=a.replace(cb,db).toLowerCase(),function(b){var c;do if(c=p?b.lang:b.getAttribute("xml:lang")||b.getAttribute("lang"))return c=c.toLowerCase(),c===a||0===c.indexOf(a+"-");while((b=b.parentNode)&&1===b.nodeType);return!1}}),target:function(b){var c=a.location&&a.location.hash;return c&&c.slice(1)===b.id},root:function(a){return a===o},focus:function(a){return a===n.activeElement&&(!n.hasFocus||n.hasFocus())&&!!(a.type||a.href||~a.tabIndex)},enabled:function(a){return a.disabled===!1},disabled:function(a){return a.disabled===!0},checked:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&!!a.checked||"option"===b&&!!a.selected},selected:function(a){return a.parentNode&&a.parentNode.selectedIndex,a.selected===!0},empty:function(a){for(a=a.firstChild;a;a=a.nextSibling)if(a.nodeType<6)return!1;return!0},parent:function(a){return!d.pseudos.empty(a)},header:function(a){return Z.test(a.nodeName)},input:function(a){return Y.test(a.nodeName)},button:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&"button"===a.type||"button"===b},text:function(a){var b;return"input"===a.nodeName.toLowerCase()&&"text"===a.type&&(null==(b=a.getAttribute("type"))||"text"===b.toLowerCase())},first:ob(function(){return[0]}),last:ob(function(a,b){return[b-1]}),eq:ob(function(a,b,c){return[0>c?c+b:c]}),even:ob(function(a,b){for(var c=0;b>c;c+=2)a.push(c);return a}),odd:ob(function(a,b){for(var c=1;b>c;c+=2)a.push(c);return a}),lt:ob(function(a,b,c){for(var d=0>c?c+b:c;--d>=0;)a.push(d);return a}),gt:ob(function(a,b,c){for(var d=0>c?c+b:c;++d<b;)a.push(d);return a})}},d.pseudos.nth=d.pseudos.eq;for(b in{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})d.pseudos[b]=mb(b);for(b in{submit:!0,reset:!0})d.pseudos[b]=nb(b);function qb(){}qb.prototype=d.filters=d.pseudos,d.setFilters=new qb,g=gb.tokenize=function(a,b){var c,e,f,g,h,i,j,k=z[a+" "];if(k)return b?0:k.slice(0);h=a,i=[],j=d.preFilter;while(h){(!c||(e=S.exec(h)))&&(e&&(h=h.slice(e[0].length)||h),i.push(f=[])),c=!1,(e=T.exec(h))&&(c=e.shift(),f.push({value:c,type:e[0].replace(R," ")}),h=h.slice(c.length));for(g in d.filter)!(e=X[g].exec(h))||j[g]&&!(e=j[g](e))||(c=e.shift(),f.push({value:c,type:g,matches:e}),h=h.slice(c.length));if(!c)break}return b?h.length:h?gb.error(a):z(a,i).slice(0)};function rb(a){for(var b=0,c=a.length,d="";c>b;b++)d+=a[b].value;return d}function sb(a,b,c){var d=b.dir,e=c&&"parentNode"===d,f=x++;return b.first?function(b,c,f){while(b=b[d])if(1===b.nodeType||e)return a(b,c,f)}:function(b,c,g){var h,i,j=[w,f];if(g){while(b=b[d])if((1===b.nodeType||e)&&a(b,c,g))return!0}else while(b=b[d])if(1===b.nodeType||e){if(i=b[u]||(b[u]={}),(h=i[d])&&h[0]===w&&h[1]===f)return j[2]=h[2];if(i[d]=j,j[2]=a(b,c,g))return!0}}}function tb(a){return a.length>1?function(b,c,d){var e=a.length;while(e--)if(!a[e](b,c,d))return!1;return!0}:a[0]}function ub(a,b,c){for(var d=0,e=b.length;e>d;d++)gb(a,b[d],c);return c}function vb(a,b,c,d,e){for(var f,g=[],h=0,i=a.length,j=null!=b;i>h;h++)(f=a[h])&&(!c||c(f,d,e))&&(g.push(f),j&&b.push(h));return g}function wb(a,b,c,d,e,f){return d&&!d[u]&&(d=wb(d)),e&&!e[u]&&(e=wb(e,f)),ib(function(f,g,h,i){var j,k,l,m=[],n=[],o=g.length,p=f||ub(b||"*",h.nodeType?[h]:h,[]),q=!a||!f&&b?p:vb(p,m,a,h,i),r=c?e||(f?a:o||d)?[]:g:q;if(c&&c(q,r,h,i),d){j=vb(r,n),d(j,[],h,i),k=j.length;while(k--)(l=j[k])&&(r[n[k]]=!(q[n[k]]=l))}if(f){if(e||a){if(e){j=[],k=r.length;while(k--)(l=r[k])&&j.push(q[k]=l);e(null,r=[],j,i)}k=r.length;while(k--)(l=r[k])&&(j=e?J(f,l):m[k])>-1&&(f[j]=!(g[j]=l))}}else r=vb(r===g?r.splice(o,r.length):r),e?e(null,g,r,i):H.apply(g,r)})}function xb(a){for(var b,c,e,f=a.length,g=d.relative[a[0].type],h=g||d.relative[" "],i=g?1:0,k=sb(function(a){return a===b},h,!0),l=sb(function(a){return J(b,a)>-1},h,!0),m=[function(a,c,d){var e=!g&&(d||c!==j)||((b=c).nodeType?k(a,c,d):l(a,c,d));return b=null,e}];f>i;i++)if(c=d.relative[a[i].type])m=[sb(tb(m),c)];else{if(c=d.filter[a[i].type].apply(null,a[i].matches),c[u]){for(e=++i;f>e;e++)if(d.relative[a[e].type])break;return wb(i>1&&tb(m),i>1&&rb(a.slice(0,i-1).concat({value:" "===a[i-2].type?"*":""})).replace(R,"$1"),c,e>i&&xb(a.slice(i,e)),f>e&&xb(a=a.slice(e)),f>e&&rb(a))}m.push(c)}return tb(m)}function yb(a,b){var c=b.length>0,e=a.length>0,f=function(f,g,h,i,k){var l,m,o,p=0,q="0",r=f&&[],s=[],t=j,u=f||e&&d.find.TAG("*",k),v=w+=null==t?1:Math.random()||.1,x=u.length;for(k&&(j=g!==n&&g);q!==x&&null!=(l=u[q]);q++){if(e&&l){m=0;while(o=a[m++])if(o(l,g,h)){i.push(l);break}k&&(w=v)}c&&((l=!o&&l)&&p--,f&&r.push(l))}if(p+=q,c&&q!==p){m=0;while(o=b[m++])o(r,s,g,h);if(f){if(p>0)while(q--)r[q]||s[q]||(s[q]=F.call(i));s=vb(s)}H.apply(i,s),k&&!f&&s.length>0&&p+b.length>1&&gb.uniqueSort(i)}return k&&(w=v,j=t),r};return c?ib(f):f}return h=gb.compile=function(a,b){var c,d=[],e=[],f=A[a+" "];if(!f){b||(b=g(a)),c=b.length;while(c--)f=xb(b[c]),f[u]?d.push(f):e.push(f);f=A(a,yb(e,d)),f.selector=a}return f},i=gb.select=function(a,b,e,f){var i,j,k,l,m,n="function"==typeof a&&a,o=!f&&g(a=n.selector||a);if(e=e||[],1===o.length){if(j=o[0]=o[0].slice(0),j.length>2&&"ID"===(k=j[0]).type&&c.getById&&9===b.nodeType&&p&&d.relative[j[1].type]){if(b=(d.find.ID(k.matches[0].replace(cb,db),b)||[])[0],!b)return e;n&&(b=b.parentNode),a=a.slice(j.shift().value.length)}i=X.needsContext.test(a)?0:j.length;while(i--){if(k=j[i],d.relative[l=k.type])break;if((m=d.find[l])&&(f=m(k.matches[0].replace(cb,db),ab.test(j[0].type)&&pb(b.parentNode)||b))){if(j.splice(i,1),a=f.length&&rb(j),!a)return H.apply(e,f),e;break}}}return(n||h(a,o))(f,b,!p,e,ab.test(a)&&pb(b.parentNode)||b),e},c.sortStable=u.split("").sort(B).join("")===u,c.detectDuplicates=!!l,m(),c.sortDetached=jb(function(a){return 1&a.compareDocumentPosition(n.createElement("div"))}),jb(function(a){return a.innerHTML="<a href='#'></a>","#"===a.firstChild.getAttribute("href")})||kb("type|href|height|width",function(a,b,c){return c?void 0:a.getAttribute(b,"type"===b.toLowerCase()?1:2)}),c.attributes&&jb(function(a){return a.innerHTML="<input/>",a.firstChild.setAttribute("value",""),""===a.firstChild.getAttribute("value")})||kb("value",function(a,b,c){return c||"input"!==a.nodeName.toLowerCase()?void 0:a.defaultValue}),jb(function(a){return null==a.getAttribute("disabled")})||kb(K,function(a,b,c){var d;return c?void 0:a[b]===!0?b.toLowerCase():(d=a.getAttributeNode(b))&&d.specified?d.value:null}),gb}(a);n.find=t,n.expr=t.selectors,n.expr[":"]=n.expr.pseudos,n.unique=t.uniqueSort,n.text=t.getText,n.isXMLDoc=t.isXML,n.contains=t.contains;var u=n.expr.match.needsContext,v=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,w=/^.[^:#\[\.,]*$/;function x(a,b,c){if(n.isFunction(b))return n.grep(a,function(a,d){return!!b.call(a,d,a)!==c});if(b.nodeType)return n.grep(a,function(a){return a===b!==c});if("string"==typeof b){if(w.test(b))return n.filter(b,a,c);b=n.filter(b,a)}return n.grep(a,function(a){return g.call(b,a)>=0!==c})}n.filter=function(a,b,c){var d=b[0];return c&&(a=":not("+a+")"),1===b.length&&1===d.nodeType?n.find.matchesSelector(d,a)?[d]:[]:n.find.matches(a,n.grep(b,function(a){return 1===a.nodeType}))},n.fn.extend({find:function(a){var b,c=this.length,d=[],e=this;if("string"!=typeof a)return this.pushStack(n(a).filter(function(){for(b=0;c>b;b++)if(n.contains(e[b],this))return!0}));for(b=0;c>b;b++)n.find(a,e[b],d);return d=this.pushStack(c>1?n.unique(d):d),d.selector=this.selector?this.selector+" "+a:a,d},filter:function(a){return this.pushStack(x(this,a||[],!1))},not:function(a){return this.pushStack(x(this,a||[],!0))},is:function(a){return!!x(this,"string"==typeof a&&u.test(a)?n(a):a||[],!1).length}});var y,z=/^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,A=n.fn.init=function(a,b){var c,d;if(!a)return this;if("string"==typeof a){if(c="<"===a[0]&&">"===a[a.length-1]&&a.length>=3?[null,a,null]:z.exec(a),!c||!c[1]&&b)return!b||b.jquery?(b||y).find(a):this.constructor(b).find(a);if(c[1]){if(b=b instanceof n?b[0]:b,n.merge(this,n.parseHTML(c[1],b&&b.nodeType?b.ownerDocument||b:l,!0)),v.test(c[1])&&n.isPlainObject(b))for(c in b)n.isFunction(this[c])?this[c](b[c]):this.attr(c,b[c]);return this}return d=l.getElementById(c[2]),d&&d.parentNode&&(this.length=1,this[0]=d),this.context=l,this.selector=a,this}return a.nodeType?(this.context=this[0]=a,this.length=1,this):n.isFunction(a)?"undefined"!=typeof y.ready?y.ready(a):a(n):(void 0!==a.selector&&(this.selector=a.selector,this.context=a.context),n.makeArray(a,this))};A.prototype=n.fn,y=n(l);var B=/^(?:parents|prev(?:Until|All))/,C={children:!0,contents:!0,next:!0,prev:!0};n.extend({dir:function(a,b,c){var d=[],e=void 0!==c;while((a=a[b])&&9!==a.nodeType)if(1===a.nodeType){if(e&&n(a).is(c))break;d.push(a)}return d},sibling:function(a,b){for(var c=[];a;a=a.nextSibling)1===a.nodeType&&a!==b&&c.push(a);return c}}),n.fn.extend({has:function(a){var b=n(a,this),c=b.length;return this.filter(function(){for(var a=0;c>a;a++)if(n.contains(this,b[a]))return!0})},closest:function(a,b){for(var c,d=0,e=this.length,f=[],g=u.test(a)||"string"!=typeof a?n(a,b||this.context):0;e>d;d++)for(c=this[d];c&&c!==b;c=c.parentNode)if(c.nodeType<11&&(g?g.index(c)>-1:1===c.nodeType&&n.find.matchesSelector(c,a))){f.push(c);break}return this.pushStack(f.length>1?n.unique(f):f)},index:function(a){return a?"string"==typeof a?g.call(n(a),this[0]):g.call(this,a.jquery?a[0]:a):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(a,b){return this.pushStack(n.unique(n.merge(this.get(),n(a,b))))},addBack:function(a){return this.add(null==a?this.prevObject:this.prevObject.filter(a))}});function D(a,b){while((a=a[b])&&1!==a.nodeType);return a}n.each({parent:function(a){var b=a.parentNode;return b&&11!==b.nodeType?b:null},parents:function(a){return n.dir(a,"parentNode")},parentsUntil:function(a,b,c){return n.dir(a,"parentNode",c)},next:function(a){return D(a,"nextSibling")},prev:function(a){return D(a,"previousSibling")},nextAll:function(a){return n.dir(a,"nextSibling")},prevAll:function(a){return n.dir(a,"previousSibling")},nextUntil:function(a,b,c){return n.dir(a,"nextSibling",c)},prevUntil:function(a,b,c){return n.dir(a,"previousSibling",c)},siblings:function(a){return n.sibling((a.parentNode||{}).firstChild,a)},children:function(a){return n.sibling(a.firstChild)},contents:function(a){return a.contentDocument||n.merge([],a.childNodes)}},function(a,b){n.fn[a]=function(c,d){var e=n.map(this,b,c);return"Until"!==a.slice(-5)&&(d=c),d&&"string"==typeof d&&(e=n.filter(d,e)),this.length>1&&(C[a]||n.unique(e),B.test(a)&&e.reverse()),this.pushStack(e)}});var E=/\S+/g,F={};function G(a){var b=F[a]={};return n.each(a.match(E)||[],function(a,c){b[c]=!0}),b}n.Callbacks=function(a){a="string"==typeof a?F[a]||G(a):n.extend({},a);var b,c,d,e,f,g,h=[],i=!a.once&&[],j=function(l){for(b=a.memory&&l,c=!0,g=e||0,e=0,f=h.length,d=!0;h&&f>g;g++)if(h[g].apply(l[0],l[1])===!1&&a.stopOnFalse){b=!1;break}d=!1,h&&(i?i.length&&j(i.shift()):b?h=[]:k.disable())},k={add:function(){if(h){var c=h.length;!function g(b){n.each(b,function(b,c){var d=n.type(c);"function"===d?a.unique&&k.has(c)||h.push(c):c&&c.length&&"string"!==d&&g(c)})}(arguments),d?f=h.length:b&&(e=c,j(b))}return this},remove:function(){return h&&n.each(arguments,function(a,b){var c;while((c=n.inArray(b,h,c))>-1)h.splice(c,1),d&&(f>=c&&f--,g>=c&&g--)}),this},has:function(a){return a?n.inArray(a,h)>-1:!(!h||!h.length)},empty:function(){return h=[],f=0,this},disable:function(){return h=i=b=void 0,this},disabled:function(){return!h},lock:function(){return i=void 0,b||k.disable(),this},locked:function(){return!i},fireWith:function(a,b){return!h||c&&!i||(b=b||[],b=[a,b.slice?b.slice():b],d?i.push(b):j(b)),this},fire:function(){return k.fireWith(this,arguments),this},fired:function(){return!!c}};return k},n.extend({Deferred:function(a){var b=[["resolve","done",n.Callbacks("once memory"),"resolved"],["reject","fail",n.Callbacks("once memory"),"rejected"],["notify","progress",n.Callbacks("memory")]],c="pending",d={state:function(){return c},always:function(){return e.done(arguments).fail(arguments),this},then:function(){var a=arguments;return n.Deferred(function(c){n.each(b,function(b,f){var g=n.isFunction(a[b])&&a[b];e[f[1]](function(){var a=g&&g.apply(this,arguments);a&&n.isFunction(a.promise)?a.promise().done(c.resolve).fail(c.reject).progress(c.notify):c[f[0]+"With"](this===d?c.promise():this,g?[a]:arguments)})}),a=null}).promise()},promise:function(a){return null!=a?n.extend(a,d):d}},e={};return d.pipe=d.then,n.each(b,function(a,f){var g=f[2],h=f[3];d[f[1]]=g.add,h&&g.add(function(){c=h},b[1^a][2].disable,b[2][2].lock),e[f[0]]=function(){return e[f[0]+"With"](this===e?d:this,arguments),this},e[f[0]+"With"]=g.fireWith}),d.promise(e),a&&a.call(e,e),e},when:function(a){var b=0,c=d.call(arguments),e=c.length,f=1!==e||a&&n.isFunction(a.promise)?e:0,g=1===f?a:n.Deferred(),h=function(a,b,c){return function(e){b[a]=this,c[a]=arguments.length>1?d.call(arguments):e,c===i?g.notifyWith(b,c):--f||g.resolveWith(b,c)}},i,j,k;if(e>1)for(i=new Array(e),j=new Array(e),k=new Array(e);e>b;b++)c[b]&&n.isFunction(c[b].promise)?c[b].promise().done(h(b,k,c)).fail(g.reject).progress(h(b,j,i)):--f;return f||g.resolveWith(k,c),g.promise()}});var H;n.fn.ready=function(a){return n.ready.promise().done(a),this},n.extend({isReady:!1,readyWait:1,holdReady:function(a){a?n.readyWait++:n.ready(!0)},ready:function(a){(a===!0?--n.readyWait:n.isReady)||(n.isReady=!0,a!==!0&&--n.readyWait>0||(H.resolveWith(l,[n]),n.fn.triggerHandler&&(n(l).triggerHandler("ready"),n(l).off("ready"))))}});function I(){l.removeEventListener("DOMContentLoaded",I,!1),a.removeEventListener("load",I,!1),n.ready()}n.ready.promise=function(b){return H||(H=n.Deferred(),"complete"===l.readyState?setTimeout(n.ready):(l.addEventListener("DOMContentLoaded",I,!1),a.addEventListener("load",I,!1))),H.promise(b)},n.ready.promise();var J=n.access=function(a,b,c,d,e,f,g){var h=0,i=a.length,j=null==c;if("object"===n.type(c)){e=!0;for(h in c)n.access(a,b,h,c[h],!0,f,g)}else if(void 0!==d&&(e=!0,n.isFunction(d)||(g=!0),j&&(g?(b.call(a,d),b=null):(j=b,b=function(a,b,c){return j.call(n(a),c)})),b))for(;i>h;h++)b(a[h],c,g?d:d.call(a[h],h,b(a[h],c)));return e?a:j?b.call(a):i?b(a[0],c):f};n.acceptData=function(a){return 1===a.nodeType||9===a.nodeType||!+a.nodeType};function K(){Object.defineProperty(this.cache={},0,{get:function(){return{}}}),this.expando=n.expando+K.uid++}K.uid=1,K.accepts=n.acceptData,K.prototype={key:function(a){if(!K.accepts(a))return 0;var b={},c=a[this.expando];if(!c){c=K.uid++;try{b[this.expando]={value:c},Object.defineProperties(a,b)}catch(d){b[this.expando]=c,n.extend(a,b)}}return this.cache[c]||(this.cache[c]={}),c},set:function(a,b,c){var d,e=this.key(a),f=this.cache[e];if("string"==typeof b)f[b]=c;else if(n.isEmptyObject(f))n.extend(this.cache[e],b);else for(d in b)f[d]=b[d];return f},get:function(a,b){var c=this.cache[this.key(a)];return void 0===b?c:c[b]},access:function(a,b,c){var d;return void 0===b||b&&"string"==typeof b&&void 0===c?(d=this.get(a,b),void 0!==d?d:this.get(a,n.camelCase(b))):(this.set(a,b,c),void 0!==c?c:b)},remove:function(a,b){var c,d,e,f=this.key(a),g=this.cache[f];if(void 0===b)this.cache[f]={};else{n.isArray(b)?d=b.concat(b.map(n.camelCase)):(e=n.camelCase(b),b in g?d=[b,e]:(d=e,d=d in g?[d]:d.match(E)||[])),c=d.length;while(c--)delete g[d[c]]}},hasData:function(a){return!n.isEmptyObject(this.cache[a[this.expando]]||{})},discard:function(a){a[this.expando]&&delete this.cache[a[this.expando]]}};var L=new K,M=new K,N=/^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,O=/([A-Z])/g;function P(a,b,c){var d;if(void 0===c&&1===a.nodeType)if(d="data-"+b.replace(O,"-$1").toLowerCase(),c=a.getAttribute(d),"string"==typeof c){try{c="true"===c?!0:"false"===c?!1:"null"===c?null:+c+""===c?+c:N.test(c)?n.parseJSON(c):c}catch(e){}M.set(a,b,c)}else c=void 0;return c}n.extend({hasData:function(a){return M.hasData(a)||L.hasData(a)},data:function(a,b,c){return M.access(a,b,c)
},removeData:function(a,b){M.remove(a,b)},_data:function(a,b,c){return L.access(a,b,c)},_removeData:function(a,b){L.remove(a,b)}}),n.fn.extend({data:function(a,b){var c,d,e,f=this[0],g=f&&f.attributes;if(void 0===a){if(this.length&&(e=M.get(f),1===f.nodeType&&!L.get(f,"hasDataAttrs"))){c=g.length;while(c--)g[c]&&(d=g[c].name,0===d.indexOf("data-")&&(d=n.camelCase(d.slice(5)),P(f,d,e[d])));L.set(f,"hasDataAttrs",!0)}return e}return"object"==typeof a?this.each(function(){M.set(this,a)}):J(this,function(b){var c,d=n.camelCase(a);if(f&&void 0===b){if(c=M.get(f,a),void 0!==c)return c;if(c=M.get(f,d),void 0!==c)return c;if(c=P(f,d,void 0),void 0!==c)return c}else this.each(function(){var c=M.get(this,d);M.set(this,d,b),-1!==a.indexOf("-")&&void 0!==c&&M.set(this,a,b)})},null,b,arguments.length>1,null,!0)},removeData:function(a){return this.each(function(){M.remove(this,a)})}}),n.extend({queue:function(a,b,c){var d;return a?(b=(b||"fx")+"queue",d=L.get(a,b),c&&(!d||n.isArray(c)?d=L.access(a,b,n.makeArray(c)):d.push(c)),d||[]):void 0},dequeue:function(a,b){b=b||"fx";var c=n.queue(a,b),d=c.length,e=c.shift(),f=n._queueHooks(a,b),g=function(){n.dequeue(a,b)};"inprogress"===e&&(e=c.shift(),d--),e&&("fx"===b&&c.unshift("inprogress"),delete f.stop,e.call(a,g,f)),!d&&f&&f.empty.fire()},_queueHooks:function(a,b){var c=b+"queueHooks";return L.get(a,c)||L.access(a,c,{empty:n.Callbacks("once memory").add(function(){L.remove(a,[b+"queue",c])})})}}),n.fn.extend({queue:function(a,b){var c=2;return"string"!=typeof a&&(b=a,a="fx",c--),arguments.length<c?n.queue(this[0],a):void 0===b?this:this.each(function(){var c=n.queue(this,a,b);n._queueHooks(this,a),"fx"===a&&"inprogress"!==c[0]&&n.dequeue(this,a)})},dequeue:function(a){return this.each(function(){n.dequeue(this,a)})},clearQueue:function(a){return this.queue(a||"fx",[])},promise:function(a,b){var c,d=1,e=n.Deferred(),f=this,g=this.length,h=function(){--d||e.resolveWith(f,[f])};"string"!=typeof a&&(b=a,a=void 0),a=a||"fx";while(g--)c=L.get(f[g],a+"queueHooks"),c&&c.empty&&(d++,c.empty.add(h));return h(),e.promise(b)}});var Q=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,R=["Top","Right","Bottom","Left"],S=function(a,b){return a=b||a,"none"===n.css(a,"display")||!n.contains(a.ownerDocument,a)},T=/^(?:checkbox|radio)$/i;!function(){var a=l.createDocumentFragment(),b=a.appendChild(l.createElement("div")),c=l.createElement("input");c.setAttribute("type","radio"),c.setAttribute("checked","checked"),c.setAttribute("name","t"),b.appendChild(c),k.checkClone=b.cloneNode(!0).cloneNode(!0).lastChild.checked,b.innerHTML="<textarea>x</textarea>",k.noCloneChecked=!!b.cloneNode(!0).lastChild.defaultValue}();var U="undefined";k.focusinBubbles="onfocusin"in a;var V=/^key/,W=/^(?:mouse|pointer|contextmenu)|click/,X=/^(?:focusinfocus|focusoutblur)$/,Y=/^([^.]*)(?:\.(.+)|)$/;function Z(){return!0}function $(){return!1}function _(){try{return l.activeElement}catch(a){}}n.event={global:{},add:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=L.get(a);if(r){c.handler&&(f=c,c=f.handler,e=f.selector),c.guid||(c.guid=n.guid++),(i=r.events)||(i=r.events={}),(g=r.handle)||(g=r.handle=function(b){return typeof n!==U&&n.event.triggered!==b.type?n.event.dispatch.apply(a,arguments):void 0}),b=(b||"").match(E)||[""],j=b.length;while(j--)h=Y.exec(b[j])||[],o=q=h[1],p=(h[2]||"").split(".").sort(),o&&(l=n.event.special[o]||{},o=(e?l.delegateType:l.bindType)||o,l=n.event.special[o]||{},k=n.extend({type:o,origType:q,data:d,handler:c,guid:c.guid,selector:e,needsContext:e&&n.expr.match.needsContext.test(e),namespace:p.join(".")},f),(m=i[o])||(m=i[o]=[],m.delegateCount=0,l.setup&&l.setup.call(a,d,p,g)!==!1||a.addEventListener&&a.addEventListener(o,g,!1)),l.add&&(l.add.call(a,k),k.handler.guid||(k.handler.guid=c.guid)),e?m.splice(m.delegateCount++,0,k):m.push(k),n.event.global[o]=!0)}},remove:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=L.hasData(a)&&L.get(a);if(r&&(i=r.events)){b=(b||"").match(E)||[""],j=b.length;while(j--)if(h=Y.exec(b[j])||[],o=q=h[1],p=(h[2]||"").split(".").sort(),o){l=n.event.special[o]||{},o=(d?l.delegateType:l.bindType)||o,m=i[o]||[],h=h[2]&&new RegExp("(^|\\.)"+p.join("\\.(?:.*\\.|)")+"(\\.|$)"),g=f=m.length;while(f--)k=m[f],!e&&q!==k.origType||c&&c.guid!==k.guid||h&&!h.test(k.namespace)||d&&d!==k.selector&&("**"!==d||!k.selector)||(m.splice(f,1),k.selector&&m.delegateCount--,l.remove&&l.remove.call(a,k));g&&!m.length&&(l.teardown&&l.teardown.call(a,p,r.handle)!==!1||n.removeEvent(a,o,r.handle),delete i[o])}else for(o in i)n.event.remove(a,o+b[j],c,d,!0);n.isEmptyObject(i)&&(delete r.handle,L.remove(a,"events"))}},trigger:function(b,c,d,e){var f,g,h,i,k,m,o,p=[d||l],q=j.call(b,"type")?b.type:b,r=j.call(b,"namespace")?b.namespace.split("."):[];if(g=h=d=d||l,3!==d.nodeType&&8!==d.nodeType&&!X.test(q+n.event.triggered)&&(q.indexOf(".")>=0&&(r=q.split("."),q=r.shift(),r.sort()),k=q.indexOf(":")<0&&"on"+q,b=b[n.expando]?b:new n.Event(q,"object"==typeof b&&b),b.isTrigger=e?2:3,b.namespace=r.join("."),b.namespace_re=b.namespace?new RegExp("(^|\\.)"+r.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,b.result=void 0,b.target||(b.target=d),c=null==c?[b]:n.makeArray(c,[b]),o=n.event.special[q]||{},e||!o.trigger||o.trigger.apply(d,c)!==!1)){if(!e&&!o.noBubble&&!n.isWindow(d)){for(i=o.delegateType||q,X.test(i+q)||(g=g.parentNode);g;g=g.parentNode)p.push(g),h=g;h===(d.ownerDocument||l)&&p.push(h.defaultView||h.parentWindow||a)}f=0;while((g=p[f++])&&!b.isPropagationStopped())b.type=f>1?i:o.bindType||q,m=(L.get(g,"events")||{})[b.type]&&L.get(g,"handle"),m&&m.apply(g,c),m=k&&g[k],m&&m.apply&&n.acceptData(g)&&(b.result=m.apply(g,c),b.result===!1&&b.preventDefault());return b.type=q,e||b.isDefaultPrevented()||o._default&&o._default.apply(p.pop(),c)!==!1||!n.acceptData(d)||k&&n.isFunction(d[q])&&!n.isWindow(d)&&(h=d[k],h&&(d[k]=null),n.event.triggered=q,d[q](),n.event.triggered=void 0,h&&(d[k]=h)),b.result}},dispatch:function(a){a=n.event.fix(a);var b,c,e,f,g,h=[],i=d.call(arguments),j=(L.get(this,"events")||{})[a.type]||[],k=n.event.special[a.type]||{};if(i[0]=a,a.delegateTarget=this,!k.preDispatch||k.preDispatch.call(this,a)!==!1){h=n.event.handlers.call(this,a,j),b=0;while((f=h[b++])&&!a.isPropagationStopped()){a.currentTarget=f.elem,c=0;while((g=f.handlers[c++])&&!a.isImmediatePropagationStopped())(!a.namespace_re||a.namespace_re.test(g.namespace))&&(a.handleObj=g,a.data=g.data,e=((n.event.special[g.origType]||{}).handle||g.handler).apply(f.elem,i),void 0!==e&&(a.result=e)===!1&&(a.preventDefault(),a.stopPropagation()))}return k.postDispatch&&k.postDispatch.call(this,a),a.result}},handlers:function(a,b){var c,d,e,f,g=[],h=b.delegateCount,i=a.target;if(h&&i.nodeType&&(!a.button||"click"!==a.type))for(;i!==this;i=i.parentNode||this)if(i.disabled!==!0||"click"!==a.type){for(d=[],c=0;h>c;c++)f=b[c],e=f.selector+" ",void 0===d[e]&&(d[e]=f.needsContext?n(e,this).index(i)>=0:n.find(e,this,null,[i]).length),d[e]&&d.push(f);d.length&&g.push({elem:i,handlers:d})}return h<b.length&&g.push({elem:this,handlers:b.slice(h)}),g},props:"altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(a,b){return null==a.which&&(a.which=null!=b.charCode?b.charCode:b.keyCode),a}},mouseHooks:{props:"button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(a,b){var c,d,e,f=b.button;return null==a.pageX&&null!=b.clientX&&(c=a.target.ownerDocument||l,d=c.documentElement,e=c.body,a.pageX=b.clientX+(d&&d.scrollLeft||e&&e.scrollLeft||0)-(d&&d.clientLeft||e&&e.clientLeft||0),a.pageY=b.clientY+(d&&d.scrollTop||e&&e.scrollTop||0)-(d&&d.clientTop||e&&e.clientTop||0)),a.which||void 0===f||(a.which=1&f?1:2&f?3:4&f?2:0),a}},fix:function(a){if(a[n.expando])return a;var b,c,d,e=a.type,f=a,g=this.fixHooks[e];g||(this.fixHooks[e]=g=W.test(e)?this.mouseHooks:V.test(e)?this.keyHooks:{}),d=g.props?this.props.concat(g.props):this.props,a=new n.Event(f),b=d.length;while(b--)c=d[b],a[c]=f[c];return a.target||(a.target=l),3===a.target.nodeType&&(a.target=a.target.parentNode),g.filter?g.filter(a,f):a},special:{load:{noBubble:!0},focus:{trigger:function(){return this!==_()&&this.focus?(this.focus(),!1):void 0},delegateType:"focusin"},blur:{trigger:function(){return this===_()&&this.blur?(this.blur(),!1):void 0},delegateType:"focusout"},click:{trigger:function(){return"checkbox"===this.type&&this.click&&n.nodeName(this,"input")?(this.click(),!1):void 0},_default:function(a){return n.nodeName(a.target,"a")}},beforeunload:{postDispatch:function(a){void 0!==a.result&&a.originalEvent&&(a.originalEvent.returnValue=a.result)}}},simulate:function(a,b,c,d){var e=n.extend(new n.Event,c,{type:a,isSimulated:!0,originalEvent:{}});d?n.event.trigger(e,null,b):n.event.dispatch.call(b,e),e.isDefaultPrevented()&&c.preventDefault()}},n.removeEvent=function(a,b,c){a.removeEventListener&&a.removeEventListener(b,c,!1)},n.Event=function(a,b){return this instanceof n.Event?(a&&a.type?(this.originalEvent=a,this.type=a.type,this.isDefaultPrevented=a.defaultPrevented||void 0===a.defaultPrevented&&a.returnValue===!1?Z:$):this.type=a,b&&n.extend(this,b),this.timeStamp=a&&a.timeStamp||n.now(),void(this[n.expando]=!0)):new n.Event(a,b)},n.Event.prototype={isDefaultPrevented:$,isPropagationStopped:$,isImmediatePropagationStopped:$,preventDefault:function(){var a=this.originalEvent;this.isDefaultPrevented=Z,a&&a.preventDefault&&a.preventDefault()},stopPropagation:function(){var a=this.originalEvent;this.isPropagationStopped=Z,a&&a.stopPropagation&&a.stopPropagation()},stopImmediatePropagation:function(){var a=this.originalEvent;this.isImmediatePropagationStopped=Z,a&&a.stopImmediatePropagation&&a.stopImmediatePropagation(),this.stopPropagation()}},n.each({mouseenter:"mouseover",mouseleave:"mouseout",pointerenter:"pointerover",pointerleave:"pointerout"},function(a,b){n.event.special[a]={delegateType:b,bindType:b,handle:function(a){var c,d=this,e=a.relatedTarget,f=a.handleObj;return(!e||e!==d&&!n.contains(d,e))&&(a.type=f.origType,c=f.handler.apply(this,arguments),a.type=b),c}}}),k.focusinBubbles||n.each({focus:"focusin",blur:"focusout"},function(a,b){var c=function(a){n.event.simulate(b,a.target,n.event.fix(a),!0)};n.event.special[b]={setup:function(){var d=this.ownerDocument||this,e=L.access(d,b);e||d.addEventListener(a,c,!0),L.access(d,b,(e||0)+1)},teardown:function(){var d=this.ownerDocument||this,e=L.access(d,b)-1;e?L.access(d,b,e):(d.removeEventListener(a,c,!0),L.remove(d,b))}}}),n.fn.extend({on:function(a,b,c,d,e){var f,g;if("object"==typeof a){"string"!=typeof b&&(c=c||b,b=void 0);for(g in a)this.on(g,b,c,a[g],e);return this}if(null==c&&null==d?(d=b,c=b=void 0):null==d&&("string"==typeof b?(d=c,c=void 0):(d=c,c=b,b=void 0)),d===!1)d=$;else if(!d)return this;return 1===e&&(f=d,d=function(a){return n().off(a),f.apply(this,arguments)},d.guid=f.guid||(f.guid=n.guid++)),this.each(function(){n.event.add(this,a,d,c,b)})},one:function(a,b,c,d){return this.on(a,b,c,d,1)},off:function(a,b,c){var d,e;if(a&&a.preventDefault&&a.handleObj)return d=a.handleObj,n(a.delegateTarget).off(d.namespace?d.origType+"."+d.namespace:d.origType,d.selector,d.handler),this;if("object"==typeof a){for(e in a)this.off(e,b,a[e]);return this}return(b===!1||"function"==typeof b)&&(c=b,b=void 0),c===!1&&(c=$),this.each(function(){n.event.remove(this,a,c,b)})},trigger:function(a,b){return this.each(function(){n.event.trigger(a,b,this)})},triggerHandler:function(a,b){var c=this[0];return c?n.event.trigger(a,b,c,!0):void 0}});var ab=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,bb=/<([\w:]+)/,cb=/<|&#?\w+;/,db=/<(?:script|style|link)/i,eb=/checked\s*(?:[^=]|=\s*.checked.)/i,fb=/^$|\/(?:java|ecma)script/i,gb=/^true\/(.*)/,hb=/^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,ib={option:[1,"<select multiple='multiple'>","</select>"],thead:[1,"<table>","</table>"],col:[2,"<table><colgroup>","</colgroup></table>"],tr:[2,"<table><tbody>","</tbody></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:[0,"",""]};ib.optgroup=ib.option,ib.tbody=ib.tfoot=ib.colgroup=ib.caption=ib.thead,ib.th=ib.td;function jb(a,b){return n.nodeName(a,"table")&&n.nodeName(11!==b.nodeType?b:b.firstChild,"tr")?a.getElementsByTagName("tbody")[0]||a.appendChild(a.ownerDocument.createElement("tbody")):a}function kb(a){return a.type=(null!==a.getAttribute("type"))+"/"+a.type,a}function lb(a){var b=gb.exec(a.type);return b?a.type=b[1]:a.removeAttribute("type"),a}function mb(a,b){for(var c=0,d=a.length;d>c;c++)L.set(a[c],"globalEval",!b||L.get(b[c],"globalEval"))}function nb(a,b){var c,d,e,f,g,h,i,j;if(1===b.nodeType){if(L.hasData(a)&&(f=L.access(a),g=L.set(b,f),j=f.events)){delete g.handle,g.events={};for(e in j)for(c=0,d=j[e].length;d>c;c++)n.event.add(b,e,j[e][c])}M.hasData(a)&&(h=M.access(a),i=n.extend({},h),M.set(b,i))}}function ob(a,b){var c=a.getElementsByTagName?a.getElementsByTagName(b||"*"):a.querySelectorAll?a.querySelectorAll(b||"*"):[];return void 0===b||b&&n.nodeName(a,b)?n.merge([a],c):c}function pb(a,b){var c=b.nodeName.toLowerCase();"input"===c&&T.test(a.type)?b.checked=a.checked:("input"===c||"textarea"===c)&&(b.defaultValue=a.defaultValue)}n.extend({clone:function(a,b,c){var d,e,f,g,h=a.cloneNode(!0),i=n.contains(a.ownerDocument,a);if(!(k.noCloneChecked||1!==a.nodeType&&11!==a.nodeType||n.isXMLDoc(a)))for(g=ob(h),f=ob(a),d=0,e=f.length;e>d;d++)pb(f[d],g[d]);if(b)if(c)for(f=f||ob(a),g=g||ob(h),d=0,e=f.length;e>d;d++)nb(f[d],g[d]);else nb(a,h);return g=ob(h,"script"),g.length>0&&mb(g,!i&&ob(a,"script")),h},buildFragment:function(a,b,c,d){for(var e,f,g,h,i,j,k=b.createDocumentFragment(),l=[],m=0,o=a.length;o>m;m++)if(e=a[m],e||0===e)if("object"===n.type(e))n.merge(l,e.nodeType?[e]:e);else if(cb.test(e)){f=f||k.appendChild(b.createElement("div")),g=(bb.exec(e)||["",""])[1].toLowerCase(),h=ib[g]||ib._default,f.innerHTML=h[1]+e.replace(ab,"<$1></$2>")+h[2],j=h[0];while(j--)f=f.lastChild;n.merge(l,f.childNodes),f=k.firstChild,f.textContent=""}else l.push(b.createTextNode(e));k.textContent="",m=0;while(e=l[m++])if((!d||-1===n.inArray(e,d))&&(i=n.contains(e.ownerDocument,e),f=ob(k.appendChild(e),"script"),i&&mb(f),c)){j=0;while(e=f[j++])fb.test(e.type||"")&&c.push(e)}return k},cleanData:function(a){for(var b,c,d,e,f=n.event.special,g=0;void 0!==(c=a[g]);g++){if(n.acceptData(c)&&(e=c[L.expando],e&&(b=L.cache[e]))){if(b.events)for(d in b.events)f[d]?n.event.remove(c,d):n.removeEvent(c,d,b.handle);L.cache[e]&&delete L.cache[e]}delete M.cache[c[M.expando]]}}}),n.fn.extend({text:function(a){return J(this,function(a){return void 0===a?n.text(this):this.empty().each(function(){(1===this.nodeType||11===this.nodeType||9===this.nodeType)&&(this.textContent=a)})},null,a,arguments.length)},append:function(){return this.domManip(arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=jb(this,a);b.appendChild(a)}})},prepend:function(){return this.domManip(arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=jb(this,a);b.insertBefore(a,b.firstChild)}})},before:function(){return this.domManip(arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this)})},after:function(){return this.domManip(arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this.nextSibling)})},remove:function(a,b){for(var c,d=a?n.filter(a,this):this,e=0;null!=(c=d[e]);e++)b||1!==c.nodeType||n.cleanData(ob(c)),c.parentNode&&(b&&n.contains(c.ownerDocument,c)&&mb(ob(c,"script")),c.parentNode.removeChild(c));return this},empty:function(){for(var a,b=0;null!=(a=this[b]);b++)1===a.nodeType&&(n.cleanData(ob(a,!1)),a.textContent="");return this},clone:function(a,b){return a=null==a?!1:a,b=null==b?a:b,this.map(function(){return n.clone(this,a,b)})},html:function(a){return J(this,function(a){var b=this[0]||{},c=0,d=this.length;if(void 0===a&&1===b.nodeType)return b.innerHTML;if("string"==typeof a&&!db.test(a)&&!ib[(bb.exec(a)||["",""])[1].toLowerCase()]){a=a.replace(ab,"<$1></$2>");try{for(;d>c;c++)b=this[c]||{},1===b.nodeType&&(n.cleanData(ob(b,!1)),b.innerHTML=a);b=0}catch(e){}}b&&this.empty().append(a)},null,a,arguments.length)},replaceWith:function(){var a=arguments[0];return this.domManip(arguments,function(b){a=this.parentNode,n.cleanData(ob(this)),a&&a.replaceChild(b,this)}),a&&(a.length||a.nodeType)?this:this.remove()},detach:function(a){return this.remove(a,!0)},domManip:function(a,b){a=e.apply([],a);var c,d,f,g,h,i,j=0,l=this.length,m=this,o=l-1,p=a[0],q=n.isFunction(p);if(q||l>1&&"string"==typeof p&&!k.checkClone&&eb.test(p))return this.each(function(c){var d=m.eq(c);q&&(a[0]=p.call(this,c,d.html())),d.domManip(a,b)});if(l&&(c=n.buildFragment(a,this[0].ownerDocument,!1,this),d=c.firstChild,1===c.childNodes.length&&(c=d),d)){for(f=n.map(ob(c,"script"),kb),g=f.length;l>j;j++)h=c,j!==o&&(h=n.clone(h,!0,!0),g&&n.merge(f,ob(h,"script"))),b.call(this[j],h,j);if(g)for(i=f[f.length-1].ownerDocument,n.map(f,lb),j=0;g>j;j++)h=f[j],fb.test(h.type||"")&&!L.access(h,"globalEval")&&n.contains(i,h)&&(h.src?n._evalUrl&&n._evalUrl(h.src):n.globalEval(h.textContent.replace(hb,"")))}return this}}),n.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(a,b){n.fn[a]=function(a){for(var c,d=[],e=n(a),g=e.length-1,h=0;g>=h;h++)c=h===g?this:this.clone(!0),n(e[h])[b](c),f.apply(d,c.get());return this.pushStack(d)}});var qb,rb={};function sb(b,c){var d,e=n(c.createElement(b)).appendTo(c.body),f=a.getDefaultComputedStyle&&(d=a.getDefaultComputedStyle(e[0]))?d.display:n.css(e[0],"display");return e.detach(),f}function tb(a){var b=l,c=rb[a];return c||(c=sb(a,b),"none"!==c&&c||(qb=(qb||n("<iframe frameborder='0' width='0' height='0'/>")).appendTo(b.documentElement),b=qb[0].contentDocument,b.write(),b.close(),c=sb(a,b),qb.detach()),rb[a]=c),c}var ub=/^margin/,vb=new RegExp("^("+Q+")(?!px)[a-z%]+$","i"),wb=function(b){return b.ownerDocument.defaultView.opener?b.ownerDocument.defaultView.getComputedStyle(b,null):a.getComputedStyle(b,null)};function xb(a,b,c){var d,e,f,g,h=a.style;return c=c||wb(a),c&&(g=c.getPropertyValue(b)||c[b]),c&&(""!==g||n.contains(a.ownerDocument,a)||(g=n.style(a,b)),vb.test(g)&&ub.test(b)&&(d=h.width,e=h.minWidth,f=h.maxWidth,h.minWidth=h.maxWidth=h.width=g,g=c.width,h.width=d,h.minWidth=e,h.maxWidth=f)),void 0!==g?g+"":g}function yb(a,b){return{get:function(){return a()?void delete this.get:(this.get=b).apply(this,arguments)}}}!function(){var b,c,d=l.documentElement,e=l.createElement("div"),f=l.createElement("div");if(f.style){f.style.backgroundClip="content-box",f.cloneNode(!0).style.backgroundClip="",k.clearCloneStyle="content-box"===f.style.backgroundClip,e.style.cssText="border:0;width:0;height:0;top:0;left:-9999px;margin-top:1px;position:absolute",e.appendChild(f);function g(){f.style.cssText="-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box;display:block;margin-top:1%;top:1%;border:1px;padding:1px;width:4px;position:absolute",f.innerHTML="",d.appendChild(e);var g=a.getComputedStyle(f,null);b="1%"!==g.top,c="4px"===g.width,d.removeChild(e)}a.getComputedStyle&&n.extend(k,{pixelPosition:function(){return g(),b},boxSizingReliable:function(){return null==c&&g(),c},reliableMarginRight:function(){var b,c=f.appendChild(l.createElement("div"));return c.style.cssText=f.style.cssText="-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box;display:block;margin:0;border:0;padding:0",c.style.marginRight=c.style.width="0",f.style.width="1px",d.appendChild(e),b=!parseFloat(a.getComputedStyle(c,null).marginRight),d.removeChild(e),f.removeChild(c),b}})}}(),n.swap=function(a,b,c,d){var e,f,g={};for(f in b)g[f]=a.style[f],a.style[f]=b[f];e=c.apply(a,d||[]);for(f in b)a.style[f]=g[f];return e};var zb=/^(none|table(?!-c[ea]).+)/,Ab=new RegExp("^("+Q+")(.*)$","i"),Bb=new RegExp("^([+-])=("+Q+")","i"),Cb={position:"absolute",visibility:"hidden",display:"block"},Db={letterSpacing:"0",fontWeight:"400"},Eb=["Webkit","O","Moz","ms"];function Fb(a,b){if(b in a)return b;var c=b[0].toUpperCase()+b.slice(1),d=b,e=Eb.length;while(e--)if(b=Eb[e]+c,b in a)return b;return d}function Gb(a,b,c){var d=Ab.exec(b);return d?Math.max(0,d[1]-(c||0))+(d[2]||"px"):b}function Hb(a,b,c,d,e){for(var f=c===(d?"border":"content")?4:"width"===b?1:0,g=0;4>f;f+=2)"margin"===c&&(g+=n.css(a,c+R[f],!0,e)),d?("content"===c&&(g-=n.css(a,"padding"+R[f],!0,e)),"margin"!==c&&(g-=n.css(a,"border"+R[f]+"Width",!0,e))):(g+=n.css(a,"padding"+R[f],!0,e),"padding"!==c&&(g+=n.css(a,"border"+R[f]+"Width",!0,e)));return g}function Ib(a,b,c){var d=!0,e="width"===b?a.offsetWidth:a.offsetHeight,f=wb(a),g="border-box"===n.css(a,"boxSizing",!1,f);if(0>=e||null==e){if(e=xb(a,b,f),(0>e||null==e)&&(e=a.style[b]),vb.test(e))return e;d=g&&(k.boxSizingReliable()||e===a.style[b]),e=parseFloat(e)||0}return e+Hb(a,b,c||(g?"border":"content"),d,f)+"px"}function Jb(a,b){for(var c,d,e,f=[],g=0,h=a.length;h>g;g++)d=a[g],d.style&&(f[g]=L.get(d,"olddisplay"),c=d.style.display,b?(f[g]||"none"!==c||(d.style.display=""),""===d.style.display&&S(d)&&(f[g]=L.access(d,"olddisplay",tb(d.nodeName)))):(e=S(d),"none"===c&&e||L.set(d,"olddisplay",e?c:n.css(d,"display"))));for(g=0;h>g;g++)d=a[g],d.style&&(b&&"none"!==d.style.display&&""!==d.style.display||(d.style.display=b?f[g]||"":"none"));return a}n.extend({cssHooks:{opacity:{get:function(a,b){if(b){var c=xb(a,"opacity");return""===c?"1":c}}}},cssNumber:{columnCount:!0,fillOpacity:!0,flexGrow:!0,flexShrink:!0,fontWeight:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":"cssFloat"},style:function(a,b,c,d){if(a&&3!==a.nodeType&&8!==a.nodeType&&a.style){var e,f,g,h=n.camelCase(b),i=a.style;return b=n.cssProps[h]||(n.cssProps[h]=Fb(i,h)),g=n.cssHooks[b]||n.cssHooks[h],void 0===c?g&&"get"in g&&void 0!==(e=g.get(a,!1,d))?e:i[b]:(f=typeof c,"string"===f&&(e=Bb.exec(c))&&(c=(e[1]+1)*e[2]+parseFloat(n.css(a,b)),f="number"),null!=c&&c===c&&("number"!==f||n.cssNumber[h]||(c+="px"),k.clearCloneStyle||""!==c||0!==b.indexOf("background")||(i[b]="inherit"),g&&"set"in g&&void 0===(c=g.set(a,c,d))||(i[b]=c)),void 0)}},css:function(a,b,c,d){var e,f,g,h=n.camelCase(b);return b=n.cssProps[h]||(n.cssProps[h]=Fb(a.style,h)),g=n.cssHooks[b]||n.cssHooks[h],g&&"get"in g&&(e=g.get(a,!0,c)),void 0===e&&(e=xb(a,b,d)),"normal"===e&&b in Db&&(e=Db[b]),""===c||c?(f=parseFloat(e),c===!0||n.isNumeric(f)?f||0:e):e}}),n.each(["height","width"],function(a,b){n.cssHooks[b]={get:function(a,c,d){return c?zb.test(n.css(a,"display"))&&0===a.offsetWidth?n.swap(a,Cb,function(){return Ib(a,b,d)}):Ib(a,b,d):void 0},set:function(a,c,d){var e=d&&wb(a);return Gb(a,c,d?Hb(a,b,d,"border-box"===n.css(a,"boxSizing",!1,e),e):0)}}}),n.cssHooks.marginRight=yb(k.reliableMarginRight,function(a,b){return b?n.swap(a,{display:"inline-block"},xb,[a,"marginRight"]):void 0}),n.each({margin:"",padding:"",border:"Width"},function(a,b){n.cssHooks[a+b]={expand:function(c){for(var d=0,e={},f="string"==typeof c?c.split(" "):[c];4>d;d++)e[a+R[d]+b]=f[d]||f[d-2]||f[0];return e}},ub.test(a)||(n.cssHooks[a+b].set=Gb)}),n.fn.extend({css:function(a,b){return J(this,function(a,b,c){var d,e,f={},g=0;if(n.isArray(b)){for(d=wb(a),e=b.length;e>g;g++)f[b[g]]=n.css(a,b[g],!1,d);return f}return void 0!==c?n.style(a,b,c):n.css(a,b)},a,b,arguments.length>1)},show:function(){return Jb(this,!0)},hide:function(){return Jb(this)},toggle:function(a){return"boolean"==typeof a?a?this.show():this.hide():this.each(function(){S(this)?n(this).show():n(this).hide()})}});function Kb(a,b,c,d,e){return new Kb.prototype.init(a,b,c,d,e)}n.Tween=Kb,Kb.prototype={constructor:Kb,init:function(a,b,c,d,e,f){this.elem=a,this.prop=c,this.easing=e||"swing",this.options=b,this.start=this.now=this.cur(),this.end=d,this.unit=f||(n.cssNumber[c]?"":"px")},cur:function(){var a=Kb.propHooks[this.prop];return a&&a.get?a.get(this):Kb.propHooks._default.get(this)},run:function(a){var b,c=Kb.propHooks[this.prop];return this.pos=b=this.options.duration?n.easing[this.easing](a,this.options.duration*a,0,1,this.options.duration):a,this.now=(this.end-this.start)*b+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),c&&c.set?c.set(this):Kb.propHooks._default.set(this),this}},Kb.prototype.init.prototype=Kb.prototype,Kb.propHooks={_default:{get:function(a){var b;return null==a.elem[a.prop]||a.elem.style&&null!=a.elem.style[a.prop]?(b=n.css(a.elem,a.prop,""),b&&"auto"!==b?b:0):a.elem[a.prop]},set:function(a){n.fx.step[a.prop]?n.fx.step[a.prop](a):a.elem.style&&(null!=a.elem.style[n.cssProps[a.prop]]||n.cssHooks[a.prop])?n.style(a.elem,a.prop,a.now+a.unit):a.elem[a.prop]=a.now}}},Kb.propHooks.scrollTop=Kb.propHooks.scrollLeft={set:function(a){a.elem.nodeType&&a.elem.parentNode&&(a.elem[a.prop]=a.now)}},n.easing={linear:function(a){return a},swing:function(a){return.5-Math.cos(a*Math.PI)/2}},n.fx=Kb.prototype.init,n.fx.step={};var Lb,Mb,Nb=/^(?:toggle|show|hide)$/,Ob=new RegExp("^(?:([+-])=|)("+Q+")([a-z%]*)$","i"),Pb=/queueHooks$/,Qb=[Vb],Rb={"*":[function(a,b){var c=this.createTween(a,b),d=c.cur(),e=Ob.exec(b),f=e&&e[3]||(n.cssNumber[a]?"":"px"),g=(n.cssNumber[a]||"px"!==f&&+d)&&Ob.exec(n.css(c.elem,a)),h=1,i=20;if(g&&g[3]!==f){f=f||g[3],e=e||[],g=+d||1;do h=h||".5",g/=h,n.style(c.elem,a,g+f);while(h!==(h=c.cur()/d)&&1!==h&&--i)}return e&&(g=c.start=+g||+d||0,c.unit=f,c.end=e[1]?g+(e[1]+1)*e[2]:+e[2]),c}]};function Sb(){return setTimeout(function(){Lb=void 0}),Lb=n.now()}function Tb(a,b){var c,d=0,e={height:a};for(b=b?1:0;4>d;d+=2-b)c=R[d],e["margin"+c]=e["padding"+c]=a;return b&&(e.opacity=e.width=a),e}function Ub(a,b,c){for(var d,e=(Rb[b]||[]).concat(Rb["*"]),f=0,g=e.length;g>f;f++)if(d=e[f].call(c,b,a))return d}function Vb(a,b,c){var d,e,f,g,h,i,j,k,l=this,m={},o=a.style,p=a.nodeType&&S(a),q=L.get(a,"fxshow");c.queue||(h=n._queueHooks(a,"fx"),null==h.unqueued&&(h.unqueued=0,i=h.empty.fire,h.empty.fire=function(){h.unqueued||i()}),h.unqueued++,l.always(function(){l.always(function(){h.unqueued--,n.queue(a,"fx").length||h.empty.fire()})})),1===a.nodeType&&("height"in b||"width"in b)&&(c.overflow=[o.overflow,o.overflowX,o.overflowY],j=n.css(a,"display"),k="none"===j?L.get(a,"olddisplay")||tb(a.nodeName):j,"inline"===k&&"none"===n.css(a,"float")&&(o.display="inline-block")),c.overflow&&(o.overflow="hidden",l.always(function(){o.overflow=c.overflow[0],o.overflowX=c.overflow[1],o.overflowY=c.overflow[2]}));for(d in b)if(e=b[d],Nb.exec(e)){if(delete b[d],f=f||"toggle"===e,e===(p?"hide":"show")){if("show"!==e||!q||void 0===q[d])continue;p=!0}m[d]=q&&q[d]||n.style(a,d)}else j=void 0;if(n.isEmptyObject(m))"inline"===("none"===j?tb(a.nodeName):j)&&(o.display=j);else{q?"hidden"in q&&(p=q.hidden):q=L.access(a,"fxshow",{}),f&&(q.hidden=!p),p?n(a).show():l.done(function(){n(a).hide()}),l.done(function(){var b;L.remove(a,"fxshow");for(b in m)n.style(a,b,m[b])});for(d in m)g=Ub(p?q[d]:0,d,l),d in q||(q[d]=g.start,p&&(g.end=g.start,g.start="width"===d||"height"===d?1:0))}}function Wb(a,b){var c,d,e,f,g;for(c in a)if(d=n.camelCase(c),e=b[d],f=a[c],n.isArray(f)&&(e=f[1],f=a[c]=f[0]),c!==d&&(a[d]=f,delete a[c]),g=n.cssHooks[d],g&&"expand"in g){f=g.expand(f),delete a[d];for(c in f)c in a||(a[c]=f[c],b[c]=e)}else b[d]=e}function Xb(a,b,c){var d,e,f=0,g=Qb.length,h=n.Deferred().always(function(){delete i.elem}),i=function(){if(e)return!1;for(var b=Lb||Sb(),c=Math.max(0,j.startTime+j.duration-b),d=c/j.duration||0,f=1-d,g=0,i=j.tweens.length;i>g;g++)j.tweens[g].run(f);return h.notifyWith(a,[j,f,c]),1>f&&i?c:(h.resolveWith(a,[j]),!1)},j=h.promise({elem:a,props:n.extend({},b),opts:n.extend(!0,{specialEasing:{}},c),originalProperties:b,originalOptions:c,startTime:Lb||Sb(),duration:c.duration,tweens:[],createTween:function(b,c){var d=n.Tween(a,j.opts,b,c,j.opts.specialEasing[b]||j.opts.easing);return j.tweens.push(d),d},stop:function(b){var c=0,d=b?j.tweens.length:0;if(e)return this;for(e=!0;d>c;c++)j.tweens[c].run(1);return b?h.resolveWith(a,[j,b]):h.rejectWith(a,[j,b]),this}}),k=j.props;for(Wb(k,j.opts.specialEasing);g>f;f++)if(d=Qb[f].call(j,a,k,j.opts))return d;return n.map(k,Ub,j),n.isFunction(j.opts.start)&&j.opts.start.call(a,j),n.fx.timer(n.extend(i,{elem:a,anim:j,queue:j.opts.queue})),j.progress(j.opts.progress).done(j.opts.done,j.opts.complete).fail(j.opts.fail).always(j.opts.always)}n.Animation=n.extend(Xb,{tweener:function(a,b){n.isFunction(a)?(b=a,a=["*"]):a=a.split(" ");for(var c,d=0,e=a.length;e>d;d++)c=a[d],Rb[c]=Rb[c]||[],Rb[c].unshift(b)},prefilter:function(a,b){b?Qb.unshift(a):Qb.push(a)}}),n.speed=function(a,b,c){var d=a&&"object"==typeof a?n.extend({},a):{complete:c||!c&&b||n.isFunction(a)&&a,duration:a,easing:c&&b||b&&!n.isFunction(b)&&b};return d.duration=n.fx.off?0:"number"==typeof d.duration?d.duration:d.duration in n.fx.speeds?n.fx.speeds[d.duration]:n.fx.speeds._default,(null==d.queue||d.queue===!0)&&(d.queue="fx"),d.old=d.complete,d.complete=function(){n.isFunction(d.old)&&d.old.call(this),d.queue&&n.dequeue(this,d.queue)},d},n.fn.extend({fadeTo:function(a,b,c,d){return this.filter(S).css("opacity",0).show().end().animate({opacity:b},a,c,d)},animate:function(a,b,c,d){var e=n.isEmptyObject(a),f=n.speed(b,c,d),g=function(){var b=Xb(this,n.extend({},a),f);(e||L.get(this,"finish"))&&b.stop(!0)};return g.finish=g,e||f.queue===!1?this.each(g):this.queue(f.queue,g)},stop:function(a,b,c){var d=function(a){var b=a.stop;delete a.stop,b(c)};return"string"!=typeof a&&(c=b,b=a,a=void 0),b&&a!==!1&&this.queue(a||"fx",[]),this.each(function(){var b=!0,e=null!=a&&a+"queueHooks",f=n.timers,g=L.get(this);if(e)g[e]&&g[e].stop&&d(g[e]);else for(e in g)g[e]&&g[e].stop&&Pb.test(e)&&d(g[e]);for(e=f.length;e--;)f[e].elem!==this||null!=a&&f[e].queue!==a||(f[e].anim.stop(c),b=!1,f.splice(e,1));(b||!c)&&n.dequeue(this,a)})},finish:function(a){return a!==!1&&(a=a||"fx"),this.each(function(){var b,c=L.get(this),d=c[a+"queue"],e=c[a+"queueHooks"],f=n.timers,g=d?d.length:0;for(c.finish=!0,n.queue(this,a,[]),e&&e.stop&&e.stop.call(this,!0),b=f.length;b--;)f[b].elem===this&&f[b].queue===a&&(f[b].anim.stop(!0),f.splice(b,1));for(b=0;g>b;b++)d[b]&&d[b].finish&&d[b].finish.call(this);delete c.finish})}}),n.each(["toggle","show","hide"],function(a,b){var c=n.fn[b];n.fn[b]=function(a,d,e){return null==a||"boolean"==typeof a?c.apply(this,arguments):this.animate(Tb(b,!0),a,d,e)}}),n.each({slideDown:Tb("show"),slideUp:Tb("hide"),slideToggle:Tb("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(a,b){n.fn[a]=function(a,c,d){return this.animate(b,a,c,d)}}),n.timers=[],n.fx.tick=function(){var a,b=0,c=n.timers;for(Lb=n.now();b<c.length;b++)a=c[b],a()||c[b]!==a||c.splice(b--,1);c.length||n.fx.stop(),Lb=void 0},n.fx.timer=function(a){n.timers.push(a),a()?n.fx.start():n.timers.pop()},n.fx.interval=13,n.fx.start=function(){Mb||(Mb=setInterval(n.fx.tick,n.fx.interval))},n.fx.stop=function(){clearInterval(Mb),Mb=null},n.fx.speeds={slow:600,fast:200,_default:400},n.fn.delay=function(a,b){return a=n.fx?n.fx.speeds[a]||a:a,b=b||"fx",this.queue(b,function(b,c){var d=setTimeout(b,a);c.stop=function(){clearTimeout(d)}})},function(){var a=l.createElement("input"),b=l.createElement("select"),c=b.appendChild(l.createElement("option"));a.type="checkbox",k.checkOn=""!==a.value,k.optSelected=c.selected,b.disabled=!0,k.optDisabled=!c.disabled,a=l.createElement("input"),a.value="t",a.type="radio",k.radioValue="t"===a.value}();var Yb,Zb,$b=n.expr.attrHandle;n.fn.extend({attr:function(a,b){return J(this,n.attr,a,b,arguments.length>1)},removeAttr:function(a){return this.each(function(){n.removeAttr(this,a)})}}),n.extend({attr:function(a,b,c){var d,e,f=a.nodeType;if(a&&3!==f&&8!==f&&2!==f)return typeof a.getAttribute===U?n.prop(a,b,c):(1===f&&n.isXMLDoc(a)||(b=b.toLowerCase(),d=n.attrHooks[b]||(n.expr.match.bool.test(b)?Zb:Yb)),void 0===c?d&&"get"in d&&null!==(e=d.get(a,b))?e:(e=n.find.attr(a,b),null==e?void 0:e):null!==c?d&&"set"in d&&void 0!==(e=d.set(a,c,b))?e:(a.setAttribute(b,c+""),c):void n.removeAttr(a,b))
},removeAttr:function(a,b){var c,d,e=0,f=b&&b.match(E);if(f&&1===a.nodeType)while(c=f[e++])d=n.propFix[c]||c,n.expr.match.bool.test(c)&&(a[d]=!1),a.removeAttribute(c)},attrHooks:{type:{set:function(a,b){if(!k.radioValue&&"radio"===b&&n.nodeName(a,"input")){var c=a.value;return a.setAttribute("type",b),c&&(a.value=c),b}}}}}),Zb={set:function(a,b,c){return b===!1?n.removeAttr(a,c):a.setAttribute(c,c),c}},n.each(n.expr.match.bool.source.match(/\w+/g),function(a,b){var c=$b[b]||n.find.attr;$b[b]=function(a,b,d){var e,f;return d||(f=$b[b],$b[b]=e,e=null!=c(a,b,d)?b.toLowerCase():null,$b[b]=f),e}});var _b=/^(?:input|select|textarea|button)$/i;n.fn.extend({prop:function(a,b){return J(this,n.prop,a,b,arguments.length>1)},removeProp:function(a){return this.each(function(){delete this[n.propFix[a]||a]})}}),n.extend({propFix:{"for":"htmlFor","class":"className"},prop:function(a,b,c){var d,e,f,g=a.nodeType;if(a&&3!==g&&8!==g&&2!==g)return f=1!==g||!n.isXMLDoc(a),f&&(b=n.propFix[b]||b,e=n.propHooks[b]),void 0!==c?e&&"set"in e&&void 0!==(d=e.set(a,c,b))?d:a[b]=c:e&&"get"in e&&null!==(d=e.get(a,b))?d:a[b]},propHooks:{tabIndex:{get:function(a){return a.hasAttribute("tabindex")||_b.test(a.nodeName)||a.href?a.tabIndex:-1}}}}),k.optSelected||(n.propHooks.selected={get:function(a){var b=a.parentNode;return b&&b.parentNode&&b.parentNode.selectedIndex,null}}),n.each(["tabIndex","readOnly","maxLength","cellSpacing","cellPadding","rowSpan","colSpan","useMap","frameBorder","contentEditable"],function(){n.propFix[this.toLowerCase()]=this});var ac=/[\t\r\n\f]/g;n.fn.extend({addClass:function(a){var b,c,d,e,f,g,h="string"==typeof a&&a,i=0,j=this.length;if(n.isFunction(a))return this.each(function(b){n(this).addClass(a.call(this,b,this.className))});if(h)for(b=(a||"").match(E)||[];j>i;i++)if(c=this[i],d=1===c.nodeType&&(c.className?(" "+c.className+" ").replace(ac," "):" ")){f=0;while(e=b[f++])d.indexOf(" "+e+" ")<0&&(d+=e+" ");g=n.trim(d),c.className!==g&&(c.className=g)}return this},removeClass:function(a){var b,c,d,e,f,g,h=0===arguments.length||"string"==typeof a&&a,i=0,j=this.length;if(n.isFunction(a))return this.each(function(b){n(this).removeClass(a.call(this,b,this.className))});if(h)for(b=(a||"").match(E)||[];j>i;i++)if(c=this[i],d=1===c.nodeType&&(c.className?(" "+c.className+" ").replace(ac," "):"")){f=0;while(e=b[f++])while(d.indexOf(" "+e+" ")>=0)d=d.replace(" "+e+" "," ");g=a?n.trim(d):"",c.className!==g&&(c.className=g)}return this},toggleClass:function(a,b){var c=typeof a;return"boolean"==typeof b&&"string"===c?b?this.addClass(a):this.removeClass(a):this.each(n.isFunction(a)?function(c){n(this).toggleClass(a.call(this,c,this.className,b),b)}:function(){if("string"===c){var b,d=0,e=n(this),f=a.match(E)||[];while(b=f[d++])e.hasClass(b)?e.removeClass(b):e.addClass(b)}else(c===U||"boolean"===c)&&(this.className&&L.set(this,"__className__",this.className),this.className=this.className||a===!1?"":L.get(this,"__className__")||"")})},hasClass:function(a){for(var b=" "+a+" ",c=0,d=this.length;d>c;c++)if(1===this[c].nodeType&&(" "+this[c].className+" ").replace(ac," ").indexOf(b)>=0)return!0;return!1}});var bc=/\r/g;n.fn.extend({val:function(a){var b,c,d,e=this[0];{if(arguments.length)return d=n.isFunction(a),this.each(function(c){var e;1===this.nodeType&&(e=d?a.call(this,c,n(this).val()):a,null==e?e="":"number"==typeof e?e+="":n.isArray(e)&&(e=n.map(e,function(a){return null==a?"":a+""})),b=n.valHooks[this.type]||n.valHooks[this.nodeName.toLowerCase()],b&&"set"in b&&void 0!==b.set(this,e,"value")||(this.value=e))});if(e)return b=n.valHooks[e.type]||n.valHooks[e.nodeName.toLowerCase()],b&&"get"in b&&void 0!==(c=b.get(e,"value"))?c:(c=e.value,"string"==typeof c?c.replace(bc,""):null==c?"":c)}}}),n.extend({valHooks:{option:{get:function(a){var b=n.find.attr(a,"value");return null!=b?b:n.trim(n.text(a))}},select:{get:function(a){for(var b,c,d=a.options,e=a.selectedIndex,f="select-one"===a.type||0>e,g=f?null:[],h=f?e+1:d.length,i=0>e?h:f?e:0;h>i;i++)if(c=d[i],!(!c.selected&&i!==e||(k.optDisabled?c.disabled:null!==c.getAttribute("disabled"))||c.parentNode.disabled&&n.nodeName(c.parentNode,"optgroup"))){if(b=n(c).val(),f)return b;g.push(b)}return g},set:function(a,b){var c,d,e=a.options,f=n.makeArray(b),g=e.length;while(g--)d=e[g],(d.selected=n.inArray(d.value,f)>=0)&&(c=!0);return c||(a.selectedIndex=-1),f}}}}),n.each(["radio","checkbox"],function(){n.valHooks[this]={set:function(a,b){return n.isArray(b)?a.checked=n.inArray(n(a).val(),b)>=0:void 0}},k.checkOn||(n.valHooks[this].get=function(a){return null===a.getAttribute("value")?"on":a.value})}),n.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(a,b){n.fn[b]=function(a,c){return arguments.length>0?this.on(b,null,a,c):this.trigger(b)}}),n.fn.extend({hover:function(a,b){return this.mouseenter(a).mouseleave(b||a)},bind:function(a,b,c){return this.on(a,null,b,c)},unbind:function(a,b){return this.off(a,null,b)},delegate:function(a,b,c,d){return this.on(b,a,c,d)},undelegate:function(a,b,c){return 1===arguments.length?this.off(a,"**"):this.off(b,a||"**",c)}});var cc=n.now(),dc=/\?/;n.parseJSON=function(a){return JSON.parse(a+"")},n.parseXML=function(a){var b,c;if(!a||"string"!=typeof a)return null;try{c=new DOMParser,b=c.parseFromString(a,"text/xml")}catch(d){b=void 0}return(!b||b.getElementsByTagName("parsererror").length)&&n.error("Invalid XML: "+a),b};var ec=/#.*$/,fc=/([?&])_=[^&]*/,gc=/^(.*?):[ \t]*([^\r\n]*)$/gm,hc=/^(?:about|app|app-storage|.+-extension|file|res|widget):$/,ic=/^(?:GET|HEAD)$/,jc=/^\/\//,kc=/^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,lc={},mc={},nc="*/".concat("*"),oc=a.location.href,pc=kc.exec(oc.toLowerCase())||[];function qc(a){return function(b,c){"string"!=typeof b&&(c=b,b="*");var d,e=0,f=b.toLowerCase().match(E)||[];if(n.isFunction(c))while(d=f[e++])"+"===d[0]?(d=d.slice(1)||"*",(a[d]=a[d]||[]).unshift(c)):(a[d]=a[d]||[]).push(c)}}function rc(a,b,c,d){var e={},f=a===mc;function g(h){var i;return e[h]=!0,n.each(a[h]||[],function(a,h){var j=h(b,c,d);return"string"!=typeof j||f||e[j]?f?!(i=j):void 0:(b.dataTypes.unshift(j),g(j),!1)}),i}return g(b.dataTypes[0])||!e["*"]&&g("*")}function sc(a,b){var c,d,e=n.ajaxSettings.flatOptions||{};for(c in b)void 0!==b[c]&&((e[c]?a:d||(d={}))[c]=b[c]);return d&&n.extend(!0,a,d),a}function tc(a,b,c){var d,e,f,g,h=a.contents,i=a.dataTypes;while("*"===i[0])i.shift(),void 0===d&&(d=a.mimeType||b.getResponseHeader("Content-Type"));if(d)for(e in h)if(h[e]&&h[e].test(d)){i.unshift(e);break}if(i[0]in c)f=i[0];else{for(e in c){if(!i[0]||a.converters[e+" "+i[0]]){f=e;break}g||(g=e)}f=f||g}return f?(f!==i[0]&&i.unshift(f),c[f]):void 0}function uc(a,b,c,d){var e,f,g,h,i,j={},k=a.dataTypes.slice();if(k[1])for(g in a.converters)j[g.toLowerCase()]=a.converters[g];f=k.shift();while(f)if(a.responseFields[f]&&(c[a.responseFields[f]]=b),!i&&d&&a.dataFilter&&(b=a.dataFilter(b,a.dataType)),i=f,f=k.shift())if("*"===f)f=i;else if("*"!==i&&i!==f){if(g=j[i+" "+f]||j["* "+f],!g)for(e in j)if(h=e.split(" "),h[1]===f&&(g=j[i+" "+h[0]]||j["* "+h[0]])){g===!0?g=j[e]:j[e]!==!0&&(f=h[0],k.unshift(h[1]));break}if(g!==!0)if(g&&a["throws"])b=g(b);else try{b=g(b)}catch(l){return{state:"parsererror",error:g?l:"No conversion from "+i+" to "+f}}}return{state:"success",data:b}}n.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:oc,type:"GET",isLocal:hc.test(pc[1]),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":nc,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText",json:"responseJSON"},converters:{"* text":String,"text html":!0,"text json":n.parseJSON,"text xml":n.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(a,b){return b?sc(sc(a,n.ajaxSettings),b):sc(n.ajaxSettings,a)},ajaxPrefilter:qc(lc),ajaxTransport:qc(mc),ajax:function(a,b){"object"==typeof a&&(b=a,a=void 0),b=b||{};var c,d,e,f,g,h,i,j,k=n.ajaxSetup({},b),l=k.context||k,m=k.context&&(l.nodeType||l.jquery)?n(l):n.event,o=n.Deferred(),p=n.Callbacks("once memory"),q=k.statusCode||{},r={},s={},t=0,u="canceled",v={readyState:0,getResponseHeader:function(a){var b;if(2===t){if(!f){f={};while(b=gc.exec(e))f[b[1].toLowerCase()]=b[2]}b=f[a.toLowerCase()]}return null==b?null:b},getAllResponseHeaders:function(){return 2===t?e:null},setRequestHeader:function(a,b){var c=a.toLowerCase();return t||(a=s[c]=s[c]||a,r[a]=b),this},overrideMimeType:function(a){return t||(k.mimeType=a),this},statusCode:function(a){var b;if(a)if(2>t)for(b in a)q[b]=[q[b],a[b]];else v.always(a[v.status]);return this},abort:function(a){var b=a||u;return c&&c.abort(b),x(0,b),this}};if(o.promise(v).complete=p.add,v.success=v.done,v.error=v.fail,k.url=((a||k.url||oc)+"").replace(ec,"").replace(jc,pc[1]+"//"),k.type=b.method||b.type||k.method||k.type,k.dataTypes=n.trim(k.dataType||"*").toLowerCase().match(E)||[""],null==k.crossDomain&&(h=kc.exec(k.url.toLowerCase()),k.crossDomain=!(!h||h[1]===pc[1]&&h[2]===pc[2]&&(h[3]||("http:"===h[1]?"80":"443"))===(pc[3]||("http:"===pc[1]?"80":"443")))),k.data&&k.processData&&"string"!=typeof k.data&&(k.data=n.param(k.data,k.traditional)),rc(lc,k,b,v),2===t)return v;i=n.event&&k.global,i&&0===n.active++&&n.event.trigger("ajaxStart"),k.type=k.type.toUpperCase(),k.hasContent=!ic.test(k.type),d=k.url,k.hasContent||(k.data&&(d=k.url+=(dc.test(d)?"&":"?")+k.data,delete k.data),k.cache===!1&&(k.url=fc.test(d)?d.replace(fc,"$1_="+cc++):d+(dc.test(d)?"&":"?")+"_="+cc++)),k.ifModified&&(n.lastModified[d]&&v.setRequestHeader("If-Modified-Since",n.lastModified[d]),n.etag[d]&&v.setRequestHeader("If-None-Match",n.etag[d])),(k.data&&k.hasContent&&k.contentType!==!1||b.contentType)&&v.setRequestHeader("Content-Type",k.contentType),v.setRequestHeader("Accept",k.dataTypes[0]&&k.accepts[k.dataTypes[0]]?k.accepts[k.dataTypes[0]]+("*"!==k.dataTypes[0]?", "+nc+"; q=0.01":""):k.accepts["*"]);for(j in k.headers)v.setRequestHeader(j,k.headers[j]);if(k.beforeSend&&(k.beforeSend.call(l,v,k)===!1||2===t))return v.abort();u="abort";for(j in{success:1,error:1,complete:1})v[j](k[j]);if(c=rc(mc,k,b,v)){v.readyState=1,i&&m.trigger("ajaxSend",[v,k]),k.async&&k.timeout>0&&(g=setTimeout(function(){v.abort("timeout")},k.timeout));try{t=1,c.send(r,x)}catch(w){if(!(2>t))throw w;x(-1,w)}}else x(-1,"No Transport");function x(a,b,f,h){var j,r,s,u,w,x=b;2!==t&&(t=2,g&&clearTimeout(g),c=void 0,e=h||"",v.readyState=a>0?4:0,j=a>=200&&300>a||304===a,f&&(u=tc(k,v,f)),u=uc(k,u,v,j),j?(k.ifModified&&(w=v.getResponseHeader("Last-Modified"),w&&(n.lastModified[d]=w),w=v.getResponseHeader("etag"),w&&(n.etag[d]=w)),204===a||"HEAD"===k.type?x="nocontent":304===a?x="notmodified":(x=u.state,r=u.data,s=u.error,j=!s)):(s=x,(a||!x)&&(x="error",0>a&&(a=0))),v.status=a,v.statusText=(b||x)+"",j?o.resolveWith(l,[r,x,v]):o.rejectWith(l,[v,x,s]),v.statusCode(q),q=void 0,i&&m.trigger(j?"ajaxSuccess":"ajaxError",[v,k,j?r:s]),p.fireWith(l,[v,x]),i&&(m.trigger("ajaxComplete",[v,k]),--n.active||n.event.trigger("ajaxStop")))}return v},getJSON:function(a,b,c){return n.get(a,b,c,"json")},getScript:function(a,b){return n.get(a,void 0,b,"script")}}),n.each(["get","post"],function(a,b){n[b]=function(a,c,d,e){return n.isFunction(c)&&(e=e||d,d=c,c=void 0),n.ajax({url:a,type:b,dataType:e,data:c,success:d})}}),n._evalUrl=function(a){return n.ajax({url:a,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0})},n.fn.extend({wrapAll:function(a){var b;return n.isFunction(a)?this.each(function(b){n(this).wrapAll(a.call(this,b))}):(this[0]&&(b=n(a,this[0].ownerDocument).eq(0).clone(!0),this[0].parentNode&&b.insertBefore(this[0]),b.map(function(){var a=this;while(a.firstElementChild)a=a.firstElementChild;return a}).append(this)),this)},wrapInner:function(a){return this.each(n.isFunction(a)?function(b){n(this).wrapInner(a.call(this,b))}:function(){var b=n(this),c=b.contents();c.length?c.wrapAll(a):b.append(a)})},wrap:function(a){var b=n.isFunction(a);return this.each(function(c){n(this).wrapAll(b?a.call(this,c):a)})},unwrap:function(){return this.parent().each(function(){n.nodeName(this,"body")||n(this).replaceWith(this.childNodes)}).end()}}),n.expr.filters.hidden=function(a){return a.offsetWidth<=0&&a.offsetHeight<=0},n.expr.filters.visible=function(a){return!n.expr.filters.hidden(a)};var vc=/%20/g,wc=/\[\]$/,xc=/\r?\n/g,yc=/^(?:submit|button|image|reset|file)$/i,zc=/^(?:input|select|textarea|keygen)/i;function Ac(a,b,c,d){var e;if(n.isArray(b))n.each(b,function(b,e){c||wc.test(a)?d(a,e):Ac(a+"["+("object"==typeof e?b:"")+"]",e,c,d)});else if(c||"object"!==n.type(b))d(a,b);else for(e in b)Ac(a+"["+e+"]",b[e],c,d)}n.param=function(a,b){var c,d=[],e=function(a,b){b=n.isFunction(b)?b():null==b?"":b,d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(void 0===b&&(b=n.ajaxSettings&&n.ajaxSettings.traditional),n.isArray(a)||a.jquery&&!n.isPlainObject(a))n.each(a,function(){e(this.name,this.value)});else for(c in a)Ac(c,a[c],b,e);return d.join("&").replace(vc,"+")},n.fn.extend({serialize:function(){return n.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var a=n.prop(this,"elements");return a?n.makeArray(a):this}).filter(function(){var a=this.type;return this.name&&!n(this).is(":disabled")&&zc.test(this.nodeName)&&!yc.test(a)&&(this.checked||!T.test(a))}).map(function(a,b){var c=n(this).val();return null==c?null:n.isArray(c)?n.map(c,function(a){return{name:b.name,value:a.replace(xc,"\r\n")}}):{name:b.name,value:c.replace(xc,"\r\n")}}).get()}}),n.ajaxSettings.xhr=function(){try{return new XMLHttpRequest}catch(a){}};var Bc=0,Cc={},Dc={0:200,1223:204},Ec=n.ajaxSettings.xhr();a.attachEvent&&a.attachEvent("onunload",function(){for(var a in Cc)Cc[a]()}),k.cors=!!Ec&&"withCredentials"in Ec,k.ajax=Ec=!!Ec,n.ajaxTransport(function(a){var b;return k.cors||Ec&&!a.crossDomain?{send:function(c,d){var e,f=a.xhr(),g=++Bc;if(f.open(a.type,a.url,a.async,a.username,a.password),a.xhrFields)for(e in a.xhrFields)f[e]=a.xhrFields[e];a.mimeType&&f.overrideMimeType&&f.overrideMimeType(a.mimeType),a.crossDomain||c["X-Requested-With"]||(c["X-Requested-With"]="XMLHttpRequest");for(e in c)f.setRequestHeader(e,c[e]);b=function(a){return function(){b&&(delete Cc[g],b=f.onload=f.onerror=null,"abort"===a?f.abort():"error"===a?d(f.status,f.statusText):d(Dc[f.status]||f.status,f.statusText,"string"==typeof f.responseText?{text:f.responseText}:void 0,f.getAllResponseHeaders()))}},f.onload=b(),f.onerror=b("error"),b=Cc[g]=b("abort");try{f.send(a.hasContent&&a.data||null)}catch(h){if(b)throw h}},abort:function(){b&&b()}}:void 0}),n.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/(?:java|ecma)script/},converters:{"text script":function(a){return n.globalEval(a),a}}}),n.ajaxPrefilter("script",function(a){void 0===a.cache&&(a.cache=!1),a.crossDomain&&(a.type="GET")}),n.ajaxTransport("script",function(a){if(a.crossDomain){var b,c;return{send:function(d,e){b=n("<script>").prop({async:!0,charset:a.scriptCharset,src:a.url}).on("load error",c=function(a){b.remove(),c=null,a&&e("error"===a.type?404:200,a.type)}),l.head.appendChild(b[0])},abort:function(){c&&c()}}}});var Fc=[],Gc=/(=)\?(?=&|$)|\?\?/;n.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var a=Fc.pop()||n.expando+"_"+cc++;return this[a]=!0,a}}),n.ajaxPrefilter("json jsonp",function(b,c,d){var e,f,g,h=b.jsonp!==!1&&(Gc.test(b.url)?"url":"string"==typeof b.data&&!(b.contentType||"").indexOf("application/x-www-form-urlencoded")&&Gc.test(b.data)&&"data");return h||"jsonp"===b.dataTypes[0]?(e=b.jsonpCallback=n.isFunction(b.jsonpCallback)?b.jsonpCallback():b.jsonpCallback,h?b[h]=b[h].replace(Gc,"$1"+e):b.jsonp!==!1&&(b.url+=(dc.test(b.url)?"&":"?")+b.jsonp+"="+e),b.converters["script json"]=function(){return g||n.error(e+" was not called"),g[0]},b.dataTypes[0]="json",f=a[e],a[e]=function(){g=arguments},d.always(function(){a[e]=f,b[e]&&(b.jsonpCallback=c.jsonpCallback,Fc.push(e)),g&&n.isFunction(f)&&f(g[0]),g=f=void 0}),"script"):void 0}),n.parseHTML=function(a,b,c){if(!a||"string"!=typeof a)return null;"boolean"==typeof b&&(c=b,b=!1),b=b||l;var d=v.exec(a),e=!c&&[];return d?[b.createElement(d[1])]:(d=n.buildFragment([a],b,e),e&&e.length&&n(e).remove(),n.merge([],d.childNodes))};var Hc=n.fn.load;n.fn.load=function(a,b,c){if("string"!=typeof a&&Hc)return Hc.apply(this,arguments);var d,e,f,g=this,h=a.indexOf(" ");return h>=0&&(d=n.trim(a.slice(h)),a=a.slice(0,h)),n.isFunction(b)?(c=b,b=void 0):b&&"object"==typeof b&&(e="POST"),g.length>0&&n.ajax({url:a,type:e,dataType:"html",data:b}).done(function(a){f=arguments,g.html(d?n("<div>").append(n.parseHTML(a)).find(d):a)}).complete(c&&function(a,b){g.each(c,f||[a.responseText,b,a])}),this},n.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(a,b){n.fn[b]=function(a){return this.on(b,a)}}),n.expr.filters.animated=function(a){return n.grep(n.timers,function(b){return a===b.elem}).length};var Ic=a.document.documentElement;function Jc(a){return n.isWindow(a)?a:9===a.nodeType&&a.defaultView}n.offset={setOffset:function(a,b,c){var d,e,f,g,h,i,j,k=n.css(a,"position"),l=n(a),m={};"static"===k&&(a.style.position="relative"),h=l.offset(),f=n.css(a,"top"),i=n.css(a,"left"),j=("absolute"===k||"fixed"===k)&&(f+i).indexOf("auto")>-1,j?(d=l.position(),g=d.top,e=d.left):(g=parseFloat(f)||0,e=parseFloat(i)||0),n.isFunction(b)&&(b=b.call(a,c,h)),null!=b.top&&(m.top=b.top-h.top+g),null!=b.left&&(m.left=b.left-h.left+e),"using"in b?b.using.call(a,m):l.css(m)}},n.fn.extend({offset:function(a){if(arguments.length)return void 0===a?this:this.each(function(b){n.offset.setOffset(this,a,b)});var b,c,d=this[0],e={top:0,left:0},f=d&&d.ownerDocument;if(f)return b=f.documentElement,n.contains(b,d)?(typeof d.getBoundingClientRect!==U&&(e=d.getBoundingClientRect()),c=Jc(f),{top:e.top+c.pageYOffset-b.clientTop,left:e.left+c.pageXOffset-b.clientLeft}):e},position:function(){if(this[0]){var a,b,c=this[0],d={top:0,left:0};return"fixed"===n.css(c,"position")?b=c.getBoundingClientRect():(a=this.offsetParent(),b=this.offset(),n.nodeName(a[0],"html")||(d=a.offset()),d.top+=n.css(a[0],"borderTopWidth",!0),d.left+=n.css(a[0],"borderLeftWidth",!0)),{top:b.top-d.top-n.css(c,"marginTop",!0),left:b.left-d.left-n.css(c,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var a=this.offsetParent||Ic;while(a&&!n.nodeName(a,"html")&&"static"===n.css(a,"position"))a=a.offsetParent;return a||Ic})}}),n.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(b,c){var d="pageYOffset"===c;n.fn[b]=function(e){return J(this,function(b,e,f){var g=Jc(b);return void 0===f?g?g[c]:b[e]:void(g?g.scrollTo(d?a.pageXOffset:f,d?f:a.pageYOffset):b[e]=f)},b,e,arguments.length,null)}}),n.each(["top","left"],function(a,b){n.cssHooks[b]=yb(k.pixelPosition,function(a,c){return c?(c=xb(a,b),vb.test(c)?n(a).position()[b]+"px":c):void 0})}),n.each({Height:"height",Width:"width"},function(a,b){n.each({padding:"inner"+a,content:b,"":"outer"+a},function(c,d){n.fn[d]=function(d,e){var f=arguments.length&&(c||"boolean"!=typeof d),g=c||(d===!0||e===!0?"margin":"border");return J(this,function(b,c,d){var e;return n.isWindow(b)?b.document.documentElement["client"+a]:9===b.nodeType?(e=b.documentElement,Math.max(b.body["scroll"+a],e["scroll"+a],b.body["offset"+a],e["offset"+a],e["client"+a])):void 0===d?n.css(b,c,g):n.style(b,c,d,g)},b,f?d:void 0,f,null)}})}),n.fn.size=function(){return this.length},n.fn.andSelf=n.fn.addBack,"function"==typeof define&&define.amd&&define("jquery",[],function(){return n});var Kc=a.jQuery,Lc=a.$;return n.noConflict=function(b){return a.$===n&&(a.$=Lc),b&&a.jQuery===n&&(a.jQuery=Kc),n},typeof b===U&&(a.jQuery=a.$=n),n});
//# sourceMappingURL=jquery.min.map;
define("jQuery", (function (global) {
    return function () {
        var ret, fn;
        return ret || global.jQuery;
    };
}(this)));

//     Underscore.js 1.7.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.
(function(){var n=this,t=n._,r=Array.prototype,e=Object.prototype,u=Function.prototype,i=r.push,a=r.slice,o=r.concat,l=e.toString,c=e.hasOwnProperty,f=Array.isArray,s=Object.keys,p=u.bind,h=function(n){return n instanceof h?n:this instanceof h?void(this._wrapped=n):new h(n)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=h),exports._=h):n._=h,h.VERSION="1.7.0";var g=function(n,t,r){if(t===void 0)return n;switch(null==r?3:r){case 1:return function(r){return n.call(t,r)};case 2:return function(r,e){return n.call(t,r,e)};case 3:return function(r,e,u){return n.call(t,r,e,u)};case 4:return function(r,e,u,i){return n.call(t,r,e,u,i)}}return function(){return n.apply(t,arguments)}};h.iteratee=function(n,t,r){return null==n?h.identity:h.isFunction(n)?g(n,t,r):h.isObject(n)?h.matches(n):h.property(n)},h.each=h.forEach=function(n,t,r){if(null==n)return n;t=g(t,r);var e,u=n.length;if(u===+u)for(e=0;u>e;e++)t(n[e],e,n);else{var i=h.keys(n);for(e=0,u=i.length;u>e;e++)t(n[i[e]],i[e],n)}return n},h.map=h.collect=function(n,t,r){if(null==n)return[];t=h.iteratee(t,r);for(var e,u=n.length!==+n.length&&h.keys(n),i=(u||n).length,a=Array(i),o=0;i>o;o++)e=u?u[o]:o,a[o]=t(n[e],e,n);return a};var v="Reduce of empty array with no initial value";h.reduce=h.foldl=h.inject=function(n,t,r,e){null==n&&(n=[]),t=g(t,e,4);var u,i=n.length!==+n.length&&h.keys(n),a=(i||n).length,o=0;if(arguments.length<3){if(!a)throw new TypeError(v);r=n[i?i[o++]:o++]}for(;a>o;o++)u=i?i[o]:o,r=t(r,n[u],u,n);return r},h.reduceRight=h.foldr=function(n,t,r,e){null==n&&(n=[]),t=g(t,e,4);var u,i=n.length!==+n.length&&h.keys(n),a=(i||n).length;if(arguments.length<3){if(!a)throw new TypeError(v);r=n[i?i[--a]:--a]}for(;a--;)u=i?i[a]:a,r=t(r,n[u],u,n);return r},h.find=h.detect=function(n,t,r){var e;return t=h.iteratee(t,r),h.some(n,function(n,r,u){return t(n,r,u)?(e=n,!0):void 0}),e},h.filter=h.select=function(n,t,r){var e=[];return null==n?e:(t=h.iteratee(t,r),h.each(n,function(n,r,u){t(n,r,u)&&e.push(n)}),e)},h.reject=function(n,t,r){return h.filter(n,h.negate(h.iteratee(t)),r)},h.every=h.all=function(n,t,r){if(null==n)return!0;t=h.iteratee(t,r);var e,u,i=n.length!==+n.length&&h.keys(n),a=(i||n).length;for(e=0;a>e;e++)if(u=i?i[e]:e,!t(n[u],u,n))return!1;return!0},h.some=h.any=function(n,t,r){if(null==n)return!1;t=h.iteratee(t,r);var e,u,i=n.length!==+n.length&&h.keys(n),a=(i||n).length;for(e=0;a>e;e++)if(u=i?i[e]:e,t(n[u],u,n))return!0;return!1},h.contains=h.include=function(n,t){return null==n?!1:(n.length!==+n.length&&(n=h.values(n)),h.indexOf(n,t)>=0)},h.invoke=function(n,t){var r=a.call(arguments,2),e=h.isFunction(t);return h.map(n,function(n){return(e?t:n[t]).apply(n,r)})},h.pluck=function(n,t){return h.map(n,h.property(t))},h.where=function(n,t){return h.filter(n,h.matches(t))},h.findWhere=function(n,t){return h.find(n,h.matches(t))},h.max=function(n,t,r){var e,u,i=-1/0,a=-1/0;if(null==t&&null!=n){n=n.length===+n.length?n:h.values(n);for(var o=0,l=n.length;l>o;o++)e=n[o],e>i&&(i=e)}else t=h.iteratee(t,r),h.each(n,function(n,r,e){u=t(n,r,e),(u>a||u===-1/0&&i===-1/0)&&(i=n,a=u)});return i},h.min=function(n,t,r){var e,u,i=1/0,a=1/0;if(null==t&&null!=n){n=n.length===+n.length?n:h.values(n);for(var o=0,l=n.length;l>o;o++)e=n[o],i>e&&(i=e)}else t=h.iteratee(t,r),h.each(n,function(n,r,e){u=t(n,r,e),(a>u||1/0===u&&1/0===i)&&(i=n,a=u)});return i},h.shuffle=function(n){for(var t,r=n&&n.length===+n.length?n:h.values(n),e=r.length,u=Array(e),i=0;e>i;i++)t=h.random(0,i),t!==i&&(u[i]=u[t]),u[t]=r[i];return u},h.sample=function(n,t,r){return null==t||r?(n.length!==+n.length&&(n=h.values(n)),n[h.random(n.length-1)]):h.shuffle(n).slice(0,Math.max(0,t))},h.sortBy=function(n,t,r){return t=h.iteratee(t,r),h.pluck(h.map(n,function(n,r,e){return{value:n,index:r,criteria:t(n,r,e)}}).sort(function(n,t){var r=n.criteria,e=t.criteria;if(r!==e){if(r>e||r===void 0)return 1;if(e>r||e===void 0)return-1}return n.index-t.index}),"value")};var m=function(n){return function(t,r,e){var u={};return r=h.iteratee(r,e),h.each(t,function(e,i){var a=r(e,i,t);n(u,e,a)}),u}};h.groupBy=m(function(n,t,r){h.has(n,r)?n[r].push(t):n[r]=[t]}),h.indexBy=m(function(n,t,r){n[r]=t}),h.countBy=m(function(n,t,r){h.has(n,r)?n[r]++:n[r]=1}),h.sortedIndex=function(n,t,r,e){r=h.iteratee(r,e,1);for(var u=r(t),i=0,a=n.length;a>i;){var o=i+a>>>1;r(n[o])<u?i=o+1:a=o}return i},h.toArray=function(n){return n?h.isArray(n)?a.call(n):n.length===+n.length?h.map(n,h.identity):h.values(n):[]},h.size=function(n){return null==n?0:n.length===+n.length?n.length:h.keys(n).length},h.partition=function(n,t,r){t=h.iteratee(t,r);var e=[],u=[];return h.each(n,function(n,r,i){(t(n,r,i)?e:u).push(n)}),[e,u]},h.first=h.head=h.take=function(n,t,r){return null==n?void 0:null==t||r?n[0]:0>t?[]:a.call(n,0,t)},h.initial=function(n,t,r){return a.call(n,0,Math.max(0,n.length-(null==t||r?1:t)))},h.last=function(n,t,r){return null==n?void 0:null==t||r?n[n.length-1]:a.call(n,Math.max(n.length-t,0))},h.rest=h.tail=h.drop=function(n,t,r){return a.call(n,null==t||r?1:t)},h.compact=function(n){return h.filter(n,h.identity)};var y=function(n,t,r,e){if(t&&h.every(n,h.isArray))return o.apply(e,n);for(var u=0,a=n.length;a>u;u++){var l=n[u];h.isArray(l)||h.isArguments(l)?t?i.apply(e,l):y(l,t,r,e):r||e.push(l)}return e};h.flatten=function(n,t){return y(n,t,!1,[])},h.without=function(n){return h.difference(n,a.call(arguments,1))},h.uniq=h.unique=function(n,t,r,e){if(null==n)return[];h.isBoolean(t)||(e=r,r=t,t=!1),null!=r&&(r=h.iteratee(r,e));for(var u=[],i=[],a=0,o=n.length;o>a;a++){var l=n[a];if(t)a&&i===l||u.push(l),i=l;else if(r){var c=r(l,a,n);h.indexOf(i,c)<0&&(i.push(c),u.push(l))}else h.indexOf(u,l)<0&&u.push(l)}return u},h.union=function(){return h.uniq(y(arguments,!0,!0,[]))},h.intersection=function(n){if(null==n)return[];for(var t=[],r=arguments.length,e=0,u=n.length;u>e;e++){var i=n[e];if(!h.contains(t,i)){for(var a=1;r>a&&h.contains(arguments[a],i);a++);a===r&&t.push(i)}}return t},h.difference=function(n){var t=y(a.call(arguments,1),!0,!0,[]);return h.filter(n,function(n){return!h.contains(t,n)})},h.zip=function(n){if(null==n)return[];for(var t=h.max(arguments,"length").length,r=Array(t),e=0;t>e;e++)r[e]=h.pluck(arguments,e);return r},h.object=function(n,t){if(null==n)return{};for(var r={},e=0,u=n.length;u>e;e++)t?r[n[e]]=t[e]:r[n[e][0]]=n[e][1];return r},h.indexOf=function(n,t,r){if(null==n)return-1;var e=0,u=n.length;if(r){if("number"!=typeof r)return e=h.sortedIndex(n,t),n[e]===t?e:-1;e=0>r?Math.max(0,u+r):r}for(;u>e;e++)if(n[e]===t)return e;return-1},h.lastIndexOf=function(n,t,r){if(null==n)return-1;var e=n.length;for("number"==typeof r&&(e=0>r?e+r+1:Math.min(e,r+1));--e>=0;)if(n[e]===t)return e;return-1},h.range=function(n,t,r){arguments.length<=1&&(t=n||0,n=0),r=r||1;for(var e=Math.max(Math.ceil((t-n)/r),0),u=Array(e),i=0;e>i;i++,n+=r)u[i]=n;return u};var d=function(){};h.bind=function(n,t){var r,e;if(p&&n.bind===p)return p.apply(n,a.call(arguments,1));if(!h.isFunction(n))throw new TypeError("Bind must be called on a function");return r=a.call(arguments,2),e=function(){if(!(this instanceof e))return n.apply(t,r.concat(a.call(arguments)));d.prototype=n.prototype;var u=new d;d.prototype=null;var i=n.apply(u,r.concat(a.call(arguments)));return h.isObject(i)?i:u}},h.partial=function(n){var t=a.call(arguments,1);return function(){for(var r=0,e=t.slice(),u=0,i=e.length;i>u;u++)e[u]===h&&(e[u]=arguments[r++]);for(;r<arguments.length;)e.push(arguments[r++]);return n.apply(this,e)}},h.bindAll=function(n){var t,r,e=arguments.length;if(1>=e)throw new Error("bindAll must be passed function names");for(t=1;e>t;t++)r=arguments[t],n[r]=h.bind(n[r],n);return n},h.memoize=function(n,t){var r=function(e){var u=r.cache,i=t?t.apply(this,arguments):e;return h.has(u,i)||(u[i]=n.apply(this,arguments)),u[i]};return r.cache={},r},h.delay=function(n,t){var r=a.call(arguments,2);return setTimeout(function(){return n.apply(null,r)},t)},h.defer=function(n){return h.delay.apply(h,[n,1].concat(a.call(arguments,1)))},h.throttle=function(n,t,r){var e,u,i,a=null,o=0;r||(r={});var l=function(){o=r.leading===!1?0:h.now(),a=null,i=n.apply(e,u),a||(e=u=null)};return function(){var c=h.now();o||r.leading!==!1||(o=c);var f=t-(c-o);return e=this,u=arguments,0>=f||f>t?(clearTimeout(a),a=null,o=c,i=n.apply(e,u),a||(e=u=null)):a||r.trailing===!1||(a=setTimeout(l,f)),i}},h.debounce=function(n,t,r){var e,u,i,a,o,l=function(){var c=h.now()-a;t>c&&c>0?e=setTimeout(l,t-c):(e=null,r||(o=n.apply(i,u),e||(i=u=null)))};return function(){i=this,u=arguments,a=h.now();var c=r&&!e;return e||(e=setTimeout(l,t)),c&&(o=n.apply(i,u),i=u=null),o}},h.wrap=function(n,t){return h.partial(t,n)},h.negate=function(n){return function(){return!n.apply(this,arguments)}},h.compose=function(){var n=arguments,t=n.length-1;return function(){for(var r=t,e=n[t].apply(this,arguments);r--;)e=n[r].call(this,e);return e}},h.after=function(n,t){return function(){return--n<1?t.apply(this,arguments):void 0}},h.before=function(n,t){var r;return function(){return--n>0?r=t.apply(this,arguments):t=null,r}},h.once=h.partial(h.before,2),h.keys=function(n){if(!h.isObject(n))return[];if(s)return s(n);var t=[];for(var r in n)h.has(n,r)&&t.push(r);return t},h.values=function(n){for(var t=h.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=n[t[u]];return e},h.pairs=function(n){for(var t=h.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=[t[u],n[t[u]]];return e},h.invert=function(n){for(var t={},r=h.keys(n),e=0,u=r.length;u>e;e++)t[n[r[e]]]=r[e];return t},h.functions=h.methods=function(n){var t=[];for(var r in n)h.isFunction(n[r])&&t.push(r);return t.sort()},h.extend=function(n){if(!h.isObject(n))return n;for(var t,r,e=1,u=arguments.length;u>e;e++){t=arguments[e];for(r in t)c.call(t,r)&&(n[r]=t[r])}return n},h.pick=function(n,t,r){var e,u={};if(null==n)return u;if(h.isFunction(t)){t=g(t,r);for(e in n){var i=n[e];t(i,e,n)&&(u[e]=i)}}else{var l=o.apply([],a.call(arguments,1));n=new Object(n);for(var c=0,f=l.length;f>c;c++)e=l[c],e in n&&(u[e]=n[e])}return u},h.omit=function(n,t,r){if(h.isFunction(t))t=h.negate(t);else{var e=h.map(o.apply([],a.call(arguments,1)),String);t=function(n,t){return!h.contains(e,t)}}return h.pick(n,t,r)},h.defaults=function(n){if(!h.isObject(n))return n;for(var t=1,r=arguments.length;r>t;t++){var e=arguments[t];for(var u in e)n[u]===void 0&&(n[u]=e[u])}return n},h.clone=function(n){return h.isObject(n)?h.isArray(n)?n.slice():h.extend({},n):n},h.tap=function(n,t){return t(n),n};var b=function(n,t,r,e){if(n===t)return 0!==n||1/n===1/t;if(null==n||null==t)return n===t;n instanceof h&&(n=n._wrapped),t instanceof h&&(t=t._wrapped);var u=l.call(n);if(u!==l.call(t))return!1;switch(u){case"[object RegExp]":case"[object String]":return""+n==""+t;case"[object Number]":return+n!==+n?+t!==+t:0===+n?1/+n===1/t:+n===+t;case"[object Date]":case"[object Boolean]":return+n===+t}if("object"!=typeof n||"object"!=typeof t)return!1;for(var i=r.length;i--;)if(r[i]===n)return e[i]===t;var a=n.constructor,o=t.constructor;if(a!==o&&"constructor"in n&&"constructor"in t&&!(h.isFunction(a)&&a instanceof a&&h.isFunction(o)&&o instanceof o))return!1;r.push(n),e.push(t);var c,f;if("[object Array]"===u){if(c=n.length,f=c===t.length)for(;c--&&(f=b(n[c],t[c],r,e)););}else{var s,p=h.keys(n);if(c=p.length,f=h.keys(t).length===c)for(;c--&&(s=p[c],f=h.has(t,s)&&b(n[s],t[s],r,e)););}return r.pop(),e.pop(),f};h.isEqual=function(n,t){return b(n,t,[],[])},h.isEmpty=function(n){if(null==n)return!0;if(h.isArray(n)||h.isString(n)||h.isArguments(n))return 0===n.length;for(var t in n)if(h.has(n,t))return!1;return!0},h.isElement=function(n){return!(!n||1!==n.nodeType)},h.isArray=f||function(n){return"[object Array]"===l.call(n)},h.isObject=function(n){var t=typeof n;return"function"===t||"object"===t&&!!n},h.each(["Arguments","Function","String","Number","Date","RegExp"],function(n){h["is"+n]=function(t){return l.call(t)==="[object "+n+"]"}}),h.isArguments(arguments)||(h.isArguments=function(n){return h.has(n,"callee")}),"function"!=typeof/./&&(h.isFunction=function(n){return"function"==typeof n||!1}),h.isFinite=function(n){return isFinite(n)&&!isNaN(parseFloat(n))},h.isNaN=function(n){return h.isNumber(n)&&n!==+n},h.isBoolean=function(n){return n===!0||n===!1||"[object Boolean]"===l.call(n)},h.isNull=function(n){return null===n},h.isUndefined=function(n){return n===void 0},h.has=function(n,t){return null!=n&&c.call(n,t)},h.noConflict=function(){return n._=t,this},h.identity=function(n){return n},h.constant=function(n){return function(){return n}},h.noop=function(){},h.property=function(n){return function(t){return t[n]}},h.matches=function(n){var t=h.pairs(n),r=t.length;return function(n){if(null==n)return!r;n=new Object(n);for(var e=0;r>e;e++){var u=t[e],i=u[0];if(u[1]!==n[i]||!(i in n))return!1}return!0}},h.times=function(n,t,r){var e=Array(Math.max(0,n));t=g(t,r,1);for(var u=0;n>u;u++)e[u]=t(u);return e},h.random=function(n,t){return null==t&&(t=n,n=0),n+Math.floor(Math.random()*(t-n+1))},h.now=Date.now||function(){return(new Date).getTime()};var _={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},w=h.invert(_),j=function(n){var t=function(t){return n[t]},r="(?:"+h.keys(n).join("|")+")",e=RegExp(r),u=RegExp(r,"g");return function(n){return n=null==n?"":""+n,e.test(n)?n.replace(u,t):n}};h.escape=j(_),h.unescape=j(w),h.result=function(n,t){if(null==n)return void 0;var r=n[t];return h.isFunction(r)?n[t]():r};var x=0;h.uniqueId=function(n){var t=++x+"";return n?n+t:t},h.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var A=/(.)^/,k={"'":"'","\\":"\\","\r":"r","\n":"n","\u2028":"u2028","\u2029":"u2029"},O=/\\|'|\r|\n|\u2028|\u2029/g,F=function(n){return"\\"+k[n]};h.template=function(n,t,r){!t&&r&&(t=r),t=h.defaults({},t,h.templateSettings);var e=RegExp([(t.escape||A).source,(t.interpolate||A).source,(t.evaluate||A).source].join("|")+"|$","g"),u=0,i="__p+='";n.replace(e,function(t,r,e,a,o){return i+=n.slice(u,o).replace(O,F),u=o+t.length,r?i+="'+\n((__t=("+r+"))==null?'':_.escape(__t))+\n'":e?i+="'+\n((__t=("+e+"))==null?'':__t)+\n'":a&&(i+="';\n"+a+"\n__p+='"),t}),i+="';\n",t.variable||(i="with(obj||{}){\n"+i+"}\n"),i="var __t,__p='',__j=Array.prototype.join,"+"print=function(){__p+=__j.call(arguments,'');};\n"+i+"return __p;\n";try{var a=new Function(t.variable||"obj","_",i)}catch(o){throw o.source=i,o}var l=function(n){return a.call(this,n,h)},c=t.variable||"obj";return l.source="function("+c+"){\n"+i+"}",l},h.chain=function(n){var t=h(n);return t._chain=!0,t};var E=function(n){return this._chain?h(n).chain():n};h.mixin=function(n){h.each(h.functions(n),function(t){var r=h[t]=n[t];h.prototype[t]=function(){var n=[this._wrapped];return i.apply(n,arguments),E.call(this,r.apply(h,n))}})},h.mixin(h),h.each(["pop","push","reverse","shift","sort","splice","unshift"],function(n){var t=r[n];h.prototype[n]=function(){var r=this._wrapped;return t.apply(r,arguments),"shift"!==n&&"splice"!==n||0!==r.length||delete r[0],E.call(this,r)}}),h.each(["concat","join","slice"],function(n){var t=r[n];h.prototype[n]=function(){return E.call(this,t.apply(this._wrapped,arguments))}}),h.prototype.value=function(){return this._wrapped},"function"==typeof define&&define.amd&&define("underscore",[],function(){return h})}).call(this);
//# sourceMappingURL=underscore-min.map;
/*!
 * jmpress.js v0.4.5
 * http://jmpressjs.github.com/jmpress.js
 *
 * A jQuery plugin to build a website on the infinite canvas.
 *
 * Copyright 2013 Kyle Robinson Young @shama & Tobias Koppers @sokra
 * Licensed MIT
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Based on the foundation laid by Bartek Szopka @bartaz
 *//*
 * core.js
 * The core of jmpress.js
 */
(function ($, document, window, undefined) {

    

    /**
     * Set supported prefixes
     *
     * @access protected
     * @return Function to get prefixed property
     */
    var pfx = (function () {
        var style = document.createElement('dummy').style,
            prefixes = 'Webkit Moz O ms Khtml'.split(' '),
            memory = {};
        return function (prop) {
            if (typeof memory[ prop ] === "undefined") {
                var ucProp = prop.charAt(0).toUpperCase() + prop.substr(1),
                    props = (prop + ' ' + prefixes.join(ucProp + ' ') + ucProp).split(' ');
                memory[ prop ] = null;
                for (var i in props) {
                    if (style[ props[i] ] !== undefined) {
                        memory[ prop ] = props[i];
                        break;
                    }
                }
            }
            return memory[ prop ];
        };
    }());

    /**
     * map ex. "WebkitTransform" to "-webkit-transform"
     */
    function mapProperty(name) {
        if (!name) {
            return;
        }
        var index = 1 + name.substr(1).search(/[A-Z]/);
        var prefix = name.substr(0, index).toLowerCase();
        var postfix = name.substr(index).toLowerCase();
        return "-" + prefix + "-" + postfix;
    }

    function addComma(attribute) {
        if (!attribute) {
            return "";
        }
        return attribute + ",";
    }

    /**
     * Return an jquery object only if it's not empty
     */
    function ifNotEmpty(el) {
        if (el.length > 0) {
            return el;
        }
        return null;
    }

    /**
     * Default Settings
     */
    var defaults = {
        /* CLASSES */
        stepSelector: '.step', containerClass: '', canvasClass: '', areaClass: '', notSupportedClass: 'not-supported'

        /* CONFIG */, fullscreen: true

        /* ANIMATION */, animation: {
            transformOrigin: 'top left', transitionProperty: addComma(mapProperty(pfx('transform'))) + addComma(mapProperty(pfx('perspective'))) + 'opacity', transitionDuration: '1s', transitionDelay: '500ms', transitionTimingFunction: 'ease-in-out', transformStyle: "preserve-3d"
        }, transitionDuration: 1500
    };
    var callbacks = {
        'beforeChange': 1, 'beforeInitStep': 1, 'initStep': 1, 'beforeInit': 1, 'afterInit': 1, 'beforeDeinit': 1, 'afterDeinit': 1, 'applyStep': 1, 'unapplyStep': 1, 'setInactive': 1, 'beforeActive': 1, 'setActive': 1, 'selectInitialStep': 1, 'selectPrev': 1, 'selectNext': 1, 'selectHome': 1, 'selectEnd': 1, 'idle': 1, 'applyTarget': 1
    };
    for (var callbackName in callbacks) {
        defaults[callbackName] = [];
    }


    /**
     * Initialize jmpress
     */
    function init(args) {
        args = $.extend(true, {}, args || {});

        // accept functions and arrays of functions as callbacks
        var callbackArgs = {};
        var callbackName = null;
        for (callbackName in callbacks) {
            callbackArgs[callbackName] = $.isFunction(args[callbackName]) ?
                [ args[callbackName] ] :
                args[callbackName];
            args[callbackName] = [];
        }

        // MERGE SETTINGS
        var settings = $.extend(true, {}, defaults, args);

        for (callbackName in callbacks) {
            if (callbackArgs[callbackName]) {
                Array.prototype.push.apply(settings[callbackName], callbackArgs[callbackName]);
            }
        }

        /*** MEMBER VARS ***/

        var jmpress = $(this)
            , container = null
            , area = null
            , oldStyle = {
                container: "", area: ""
            }
            , canvas = null
            , current = null
            , active = false
            , activeSubstep = null
            , activeDelegated = false;


        /*** MEMBER FUNCTIONS ***/
        // functions have to be called with this

        /**
         * Init a single step
         *
         * @param element the element of the step
         * @param idx number of step
         */
        function doStepInit(element, idx) {
            var data = dataset(element);
            var step = {
                oldStyle: $(element).attr("style") || ""
            };

            var callbackData = {
                data: data, stepData: step
            };
            callCallback.call(this, 'beforeInitStep', $(element), callbackData);
            step.delegate = data.delegate;
            callCallback.call(this, 'initStep', $(element), callbackData);

            $(element).data('stepData', step);

            if (!$(element).attr('id')) {
                $(element).attr('id', 'step-' + (idx + 1));
            }

            callCallback.call(this, 'applyStep', $(element), callbackData);
        }

        /**
         * Deinit a single step
         *
         * @param element the element of the step
         */
        function doStepDeinit(element) {
            var stepData = $(element).data('stepData');

            $(element).attr("style", stepData.oldStyle);

            callCallback.call(this, 'unapplyStep', $(element), {
                stepData: stepData
            });
        }

        /**
         * Reapplies stepData to the element
         *
         * @param element
         */
        function doStepReapply(element) {
            callCallback.call(this, 'unapplyStep', $(element), {
                stepData: element.data("stepData")
            });

            callCallback.call(this, 'applyStep', $(element), {
                stepData: element.data("stepData")
            });
        }

        /**
         * Completly deinit jmpress
         *
         */
        function deinit() {
            if (active) {
                callCallback.call(this, 'setInactive', active, {
                    stepData: $(active).data('stepData'), reason: "deinit"
                });
            }
            if (current.jmpressClass) {
                $(jmpress).removeClass(current.jmpressClass);
            }

            callCallback.call(this, 'beforeDeinit', $(this), {});

            $(settings.stepSelector, jmpress).each(function (idx) {
                doStepDeinit.call(jmpress, this);
            });

            container.attr("style", oldStyle.container);
            if (settings.fullscreen) {
                $("html").attr("style", "");
            }
            area.attr("style", oldStyle.area);
            $(canvas).children().each(function () {
                jmpress.append($(this));
            });
            if (settings.fullscreen) {
                canvas.remove();
            } else {
                canvas.remove();
                area.remove();
            }

            callCallback.call(this, 'afterDeinit', $(this), {});

            $(jmpress).data("jmpressmethods", false);
        }

        /**
         * Call a callback
         *
         * @param callbackName String callback which should be called
         * @param element some arguments to the callback
         * @param eventData
         */
        function callCallback(callbackName, element, eventData) {
            eventData.settings = settings;
            eventData.current = current;
            eventData.container = container;
            eventData.parents = element ? getStepParents(element) : null;
            eventData.current = current;
            eventData.jmpress = this;
            var result = {};
            $.each(settings[callbackName], function (idx, callback) {
                result.value = callback.call(jmpress, element, eventData) || result.value;
            });
            return result.value;
        }

        /**
         *
         */
        function getStepParents(el) {
            return $(el).parentsUntil(jmpress).not(jmpress).filter(settings.stepSelector);
        }

        /**
         * Reselect the active step
         *
         * @param String type reason of reselecting step
         */
        function reselect(type) {
            return select({ step: active, substep: activeSubstep }, type);
        }

        /**
         * Select a given step
         *
         * @param el element to select
         * @param type reason of changing step
         * @return Object element selected
         */
        function select(el, type) {
            var substep;
            if ($.isPlainObject(el)) {
                substep = el.substep;
                el = el.step;
            }
            if (typeof el === 'string') {
                el = jmpress.find(el).first();
            }
            if (!el || !$(el).data('stepData')) {
                return false;
            }

            scrollFix.call(this);

            var step = $(el).data('stepData');

            var cancelSelect = false;
            callCallback.call(this, "beforeChange", el, {
                stepData: step, reason: type, cancel: function () {
                    cancelSelect = true;
                }
            });
            if (cancelSelect) {
                return undefined;
            }

            var target = {};

            var delegated = el;
            if ($(el).data("stepData").delegate) {
                delegated = ifNotEmpty($(el).parentsUntil(jmpress).filter(settings.stepSelector).filter(step.delegate)) ||
                    ifNotEmpty($(el).near(step.delegate)) ||
                    ifNotEmpty($(el).near(step.delegate, true)) ||
                    ifNotEmpty($(step.delegate, jmpress));
                if (delegated) {
                    step = delegated.data("stepData");
                } else {
                    // Do not delegate if expression not found
                    delegated = el;
                }
            }
            if (activeDelegated) {
                callCallback.call(this, 'setInactive', activeDelegated, {
                    stepData: $(activeDelegated).data('stepData'), delegatedFrom: active, reason: type, target: target, nextStep: delegated, nextSubstep: substep, nextStepData: step
                });
            }
            var callbackData = {
                stepData: step, delegatedFrom: el, reason: type, target: target, substep: substep, prevStep: activeDelegated, prevSubstep: activeSubstep, prevStepData: activeDelegated && $(activeDelegated).data('stepData')
            };
            callCallback.call(this, 'beforeActive', delegated, callbackData);
            callCallback.call(this, 'setActive', delegated, callbackData);

            // Set on step class on root element
            if (current.jmpressClass) {
                $(jmpress).removeClass(current.jmpressClass);
            }
            $(jmpress).addClass(current.jmpressClass = 'step-' + $(delegated).attr('id'));
            if (current.jmpressDelegatedClass) {
                $(jmpress).removeClass(current.jmpressDelegatedClass);
            }
            $(jmpress).addClass(current.jmpressDelegatedClass = 'delegating-step-' + $(el).attr('id'));

            callCallback.call(this, "applyTarget", delegated, $.extend({
                canvas: canvas, area: area, beforeActive: activeDelegated
            }, callbackData));

            active = el;
            activeSubstep = callbackData.substep;
            activeDelegated = delegated;

            if (current.idleTimeout) {
                clearTimeout(current.idleTimeout);
            }
            current.idleTimeout = setTimeout(function () {
                try {
                    callCallback.call(this, 'idle', delegated, callbackData);
                } catch (e) {
                }
            }, Math.max(1, settings.transitionDuration - 100));

            return delegated;
        }

        /**
         * This should fix ANY kind of buggy scrolling
         */
        function scrollFix() {
            (function fix() {
                if ($(container)[0].tagName === "BODY") {
                    try {
                        window.scrollTo(0, 0);
                    } catch (e) {
                    }
                }
                $(container).scrollTop(0);
                $(container).scrollLeft(0);
                function check() {
                    if ($(container).scrollTop() !== 0 ||
                        $(container).scrollLeft() !== 0) {
                        fix();
                    }
                }

                setTimeout(check, 1);
                setTimeout(check, 10);
                setTimeout(check, 100);
                setTimeout(check, 200);
                setTimeout(check, 400);
            }());
        }

        /**
         * Alias for select
         */
        function goTo(el) {
            return select.call(this, el, "jump");
        }

        /**
         * Goto Next Slide
         *
         * @return Object newly active slide
         */
        function next() {
            return select.call(this, callCallback.call(this, 'selectNext', active, {
                stepData: $(active).data('stepData'), substep: activeSubstep
            }), "next");
        }

        /**
         * Goto Previous Slide
         *
         * @return Object newly active slide
         */
        function prev() {
            return select.call(this, callCallback.call(this, 'selectPrev', active, {
                stepData: $(active).data('stepData'), substep: activeSubstep
            }), "prev");
        }

        /**
         * Goto First Slide
         *
         * @return Object newly active slide
         */
        function home() {
            return select.call(this, callCallback.call(this, 'selectHome', active, {
                stepData: $(active).data('stepData')
            }), "home");
        }

        /**
         * Goto Last Slide
         *
         * @return Object newly active slide
         */
        function end() {
            return select.call(this, callCallback.call(this, 'selectEnd', active, {
                stepData: $(active).data('stepData')
            }), "end");
        }

        /**
         * Manipulate the canvas
         *
         * @param props
         * @return Object
         */
        function canvasMod(props) {
            css(canvas, props || {});
            return $(canvas);
        }

        /**
         * Return current step
         *
         * @return Object
         */
        function getActive() {
            return activeDelegated && $(activeDelegated);
        }

        /**
         * fire a callback
         *
         * @param callbackName
         * @param element
         * @param eventData
         * @return void
         */
        function fire(callbackName, element, eventData) {
            if (!callbacks[callbackName]) {
                $.error("callback " + callbackName + " is not registered.");
            } else {
                return callCallback.call(this, callbackName, element, eventData);
            }
        }

        /**
         * PUBLIC METHODS LIST
         */
        jmpress.data("jmpressmethods", {
            select: select, reselect: reselect, scrollFix: scrollFix, goTo: goTo, next: next, prev: prev, home: home, end: end, canvas: canvasMod, container: function () {
                return container;
            }, settings: function () {
                return settings;
            }, active: getActive, current: function () {
                return current;
            }, fire: fire, init: function (step) {
                doStepInit.call(this, $(step), current.nextIdNumber++);
            }, deinit: function (step) {
                if (step) {
                    doStepDeinit.call(this, $(step));
                } else {
                    deinit.call(this);
                }
            }, reapply: doStepReapply
        });

        /**
         * Check for support
         * This will be removed in near future, when support is coming
         *
         * @access protected
         * @return void
         */
        function checkSupport() {
            var ua = navigator.userAgent.toLowerCase();
            return (ua.search(/(iphone)|(ipod)|(android)/) === -1) || (ua.search(/(chrome)/) !== -1);
        }

        // BEGIN INIT

        // CHECK FOR SUPPORT
        if (checkSupport() === false) {
            if (settings.notSupportedClass) {
                jmpress.addClass(settings.notSupportedClass);
            }
            return;
        } else {
            if (settings.notSupportedClass) {
                jmpress.removeClass(settings.notSupportedClass);
            }
        }

        // grabbing all steps
        var steps = $(settings.stepSelector, jmpress);

        // GERNERAL INIT OF FRAME
        container = jmpress;
        area = $('<div />');
        canvas = $('<div />');
        $(jmpress).children().filter(steps).each(function () {
            canvas.append($(this));
        });
        if (settings.fullscreen) {
            container = $('body');
            $("html").css({
                overflow: 'hidden'
            });
            area = jmpress;
        }
        oldStyle.area = area.attr("style") || "";
        oldStyle.container = container.attr("style") || "";
        if (settings.fullscreen) {
            container.css({
                height: '100%'
            });
            jmpress.append(canvas);
        } else {
            container.css({
                position: "relative"
            });
            area.append(canvas);
            jmpress.append(area);
        }

        $(container).addClass(settings.containerClass);
        $(area).addClass(settings.areaClass);
        $(canvas).addClass(settings.canvasClass);

        document.documentElement.style.height = "100%";
        container.css({
            overflow: 'hidden'
        });

        var props = {
            position: "absolute", transitionDuration: '0s'
        };
        props = $.extend({}, settings.animation, props);
        css(area, props);
        css(area, {
            top: '50%', left: '50%', perspective: '1000px'
        });
        css(canvas, props);

        current = {};

        callCallback.call(this, 'beforeInit', null, {});

        // INITIALIZE EACH STEP
        steps.each(function (idx) {
            doStepInit.call(jmpress, this, idx);
        });
        current.nextIdNumber = steps.length;

        callCallback.call(this, 'afterInit', null, {});

        // START
        select.call(this, callCallback.call(this, 'selectInitialStep', "init", {}));

        if (settings.initClass) {
            $(steps).removeClass(settings.initClass);
        }
    }

    /**
     * Return default settings
     *
     * @return Object
     */
    function getDefaults() {
        return defaults;
    }

    /**
     * Register a callback or a jmpress function
     *
     * @access public
     * @param name String the name of the callback or function
     * @param func Function? the function to be added
     */
    function register(name, func) {
        if ($.isFunction(func)) {
            if (methods[name]) {
                methods[name] = func;
            } else {
                methods[name] = func;
            }
        } else {
            if (callbacks[name]) {
                $.error("callback " + name + " is already registered.");
            } else {
                callbacks[name] = 1;
                defaults[name] = [];
            }
        }
    }

    /**
     * Set CSS on element w/ prefixes
     *
     * @return Object element which properties were set
     *
     * TODO: Consider bypassing pfx and blindly set as jQuery
     * already checks for support
     */
    function css(el, props) {
        var key, pkey, cssObj = {};
        for (key in props) {
            if (props.hasOwnProperty(key)) {
                pkey = pfx(key);
                if (pkey !== null) {
                    cssObj[pkey] = props[key];
                }
            }
        }
        $(el).css(cssObj);
        return el;
    }

    /**
     * Return dataset for element
     *
     * @param el element
     * @return Object
     */
    function dataset(el) {
        if ($(el)[0].dataset) {
            return $.extend({}, $(el)[0].dataset);
        }
        function toCamelcase(str) {
            str = str.split('-');
            for (var i = 1; i < str.length; i++) {
                str[i] = str[i].substr(0, 1).toUpperCase() + str[i].substr(1);
            }
            return str.join('');
        }

        var returnDataset = {};
        var attrs = $(el)[0].attributes;
        $.each(attrs, function (idx, attr) {
            if (attr.nodeName.substr(0, 5) === "data-") {
                returnDataset[ toCamelcase(attr.nodeName.substr(5)) ] = attr.nodeValue;
            }
        });
        return returnDataset;
    }

    /**
     * Returns true, if jmpress is initialized
     *
     * @return bool
     */
    function initialized() {
        return !!$(this).data("jmpressmethods");
    }


    /**
     * PUBLIC STATIC METHODS LIST
     */
    var methods = {
        init: init, initialized: initialized, deinit: function () {
        }, css: css, pfx: pfx, defaults: getDefaults, register: register, dataset: dataset
    };

    /**
     * $.jmpress()
     */
    $.fn.jmpress = function (method) {
        function f() {
            var jmpressmethods = $(this).data("jmpressmethods");
            if (jmpressmethods && jmpressmethods[method]) {
                return jmpressmethods[method].apply(this, Array.prototype.slice.call(arguments, 1));
            } else if (methods[method]) {
                return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
            } else if (callbacks[method] && jmpressmethods) {
                var settings = jmpressmethods.settings();
                var func = Array.prototype.slice.call(arguments, 1)[0];
                if ($.isFunction(func)) {
                    settings[method] = settings[method] || [];
                    settings[method].push(func);
                }
            } else if (typeof method === 'object' || !method) {
                return init.apply(this, arguments);
            } else {
                $.error('Method ' + method + ' does not exist on jQuery.jmpress');
            }
            // to allow chaining
            return this;
        }

        var args = arguments;
        var result;
        $(this).each(function (idx, element) {
            result = f.apply(element, args);
        });
        return result;
    };
    $.extend({
        jmpress: function (method) {
            if (methods[method]) {
                return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
            } else if (callbacks[method]) {
                // plugin interface
                var func = Array.prototype.slice.call(arguments, 1)[0];
                if ($.isFunction(func)) {
                    defaults[method].push(func);
                } else {
                    $.error('Second parameter should be a function: $.jmpress( callbackName, callbackFunction )');
                }
            } else {
                $.error('Method ' + method + ' does not exist on jQuery.jmpress');
            }
        }
    });

}(jQuery, document, window));

/*
 * near.js
 * Find steps near each other
 */
(function ($, document, window, undefined) {

    

    // add near( selector, backwards = false) to jquery


    function checkAndGo(elements, func, selector, backwards) {
        var next;
        elements.each(function (idx, element) {
            if (backwards) {
                next = func(element, selector, backwards);
                if (next) {
                    return false;
                }
            }
            if ($(element).is(selector)) {
                next = element;
                return false;
            }
            if (!backwards) {
                next = func(element, selector, backwards);
                if (next) {
                    return false;
                }
            }
        });
        return next;
    }

    function findNextInChildren(item, selector, backwards) {
        var children = $(item).children();
        if (backwards) {
            children = $(children.get().reverse());
        }
        return checkAndGo(children, findNextInChildren, selector, backwards);
    }

    function findNextInSiblings(item, selector, backwards) {
        return checkAndGo(
            $(item)[backwards ? "prevAll" : "nextAll"](),
            findNextInChildren, selector, backwards);
    }

    function findNextInParents(item, selector, backwards) {
        var next;
        var parents = $(item).parents();
        parents = $(parents.get());
        $.each(parents.get(), function (idx, element) {
            if (backwards && $(element).is(selector)) {
                next = element;
                return false;
            }
            next = findNextInSiblings(element, selector, backwards);
            if (next) {
                return false;
            }
        });
        return next;
    }

    $.fn.near = function (selector, backwards) {
        var array = [];
        $(this).each(function (idx, element) {
            var near = (backwards ?
                false :
                findNextInChildren(element, selector, backwards)) ||
                findNextInSiblings(element, selector, backwards) ||
                findNextInParents(element, selector, backwards);
            if (near) {
                array.push(near);
            }
        });
        return $(array);
    };
}(jQuery, document, window));
/*
 * transform.js
 * The engine that powers the transforms or falls back to other methods
 */
(function ($, document, window, undefined) {

    

    /* FUNCTIONS */
    function toCssNumber(number) {
        return (Math.round(10000 * number) / 10000) + "";
    }

    /**
     * 3D and 2D engines
     */
    var engines = {
        3: {
            transform: function (el, data) {
                var transform = 'translate(-50%,-50%)';
                $.each(data, function (idx, item) {
                    var coord = ["X", "Y", "Z"];
                    var i;
                    if (item[0] === "translate") { // ["translate", x, y, z]
                        transform += " translate3d(" + toCssNumber(item[1] || 0) + "px," + toCssNumber(item[2] || 0) + "px," + toCssNumber(item[3] || 0) + "px)";
                    } else if (item[0] === "rotate") {
                        var order = item[4] ? [1, 2, 3] : [3, 2, 1];
                        for (i = 0; i < 3; i++) {
                            transform += " rotate" + coord[order[i] - 1] + "(" + toCssNumber(item[order[i]] || 0) + "deg)";
                        }
                    } else if (item[0] === "scale") {
                        for (i = 0; i < 3; i++) {
                            transform += " scale" + coord[i] + "(" + toCssNumber(item[i + 1] || 1) + ")";
                        }
                    }
                });
                $.jmpress("css", el, $.extend({}, { transform: transform }));
            }
        }, 2: {
            transform: function (el, data) {
                var transform = 'translate(-50%,-50%)';
                $.each(data, function (idx, item) {
                    var coord = ["X", "Y"];
                    if (item[0] === "translate") { // ["translate", x, y, z]
                        transform += " translate(" + toCssNumber(item[1] || 0) + "px," + toCssNumber(item[2] || 0) + "px)";
                    } else if (item[0] === "rotate") {
                        transform += " rotate(" + toCssNumber(item[3] || 0) + "deg)";
                    } else if (item[0] === "scale") {
                        for (var i = 0; i < 2; i++) {
                            transform += " scale" + coord[i] + "(" + toCssNumber(item[i + 1] || 1) + ")";
                        }
                    }
                });
                $.jmpress("css", el, $.extend({}, { transform: transform }));
            }
        }, 1: {
            // CHECK IF SUPPORT IS REALLY NEEDED?
            // this not even work without scaling...
            // it may better to display the normal view
            transform: function (el, data) {
                var anitarget = { top: 0, left: 0 };
                $.each(data, function (idx, item) {
                    var coord = ["X", "Y"];
                    if (item[0] === "translate") { // ["translate", x, y, z]
                        anitarget.left = Math.round(item[1] || 0) + "px";
                        anitarget.top = Math.round(item[2] || 0) + "px";
                    }
                });
                el.animate(anitarget, 1000); // TODO: Use animation duration
            }
        }
    };

    /**
     * Engine to power cross-browser translate, scale and rotate.
     */
    var engine = (function () {
        if ($.jmpress("pfx", "perspective")) {
            return engines[3];
        } else if ($.jmpress("pfx", "transform")) {
            return engines[2];
        } else {
            // CHECK IF SUPPORT IS REALLY NEEDED?
            return engines[1];
        }
    }());

    $.jmpress("defaults").reasonableAnimation = {};
    $.jmpress("initStep", function (step, eventData) {
        var data = eventData.data;
        var stepData = eventData.stepData;
        var pf = parseFloat;
        $.extend(stepData, {
            x: pf(data.x) || 0, y: pf(data.y) || 0, z: pf(data.z) || 0, r: pf(data.r) || 0, phi: pf(data.phi) || 0, rotate: pf(data.rotate) || 0, rotateX: pf(data.rotateX) || 0, rotateY: pf(data.rotateY) || 0, rotateZ: pf(data.rotateZ) || 0, revertRotate: false, scale: pf(data.scale) || 1, scaleX: pf(data.scaleX) || false, scaleY: pf(data.scaleY) || false, scaleZ: pf(data.scaleZ) || 1
        });
    });
    $.jmpress("afterInit", function (nil, eventData) {
        var stepSelector = eventData.settings.stepSelector,
            current = eventData.current;
        current.perspectiveScale = 1;
        current.maxNestedDepth = 0;
        var nestedSteps = $(eventData.jmpress).find(stepSelector).children(stepSelector);
        while (nestedSteps.length) {
            current.maxNestedDepth++;
            nestedSteps = nestedSteps.children(stepSelector);
        }
    });
    $.jmpress("applyStep", function (step, eventData) {
        $.jmpress("css", $(step), {
            position: "absolute", transformStyle: "preserve-3d"
        });
        if (eventData.parents.length > 0) {
            $.jmpress("css", $(step), {
                top: "50%", left: "50%"
            });
        }
        var sd = eventData.stepData;
        var transform = [
            ["translate",
                sd.x || (sd.r * Math.sin(sd.phi * Math.PI / 180)),
                sd.y || (-sd.r * Math.cos(sd.phi * Math.PI / 180)),
                sd.z],
            ["rotate",
                sd.rotateX,
                sd.rotateY,
                sd.rotateZ || sd.rotate,
                true],
            ["scale",
                sd.scaleX || sd.scale,
                sd.scaleY || sd.scale,
                sd.scaleZ || sd.scale]
        ];
        engine.transform(step, transform);
    });
    $.jmpress("setActive", function (element, eventData) {
        var target = eventData.target;
        var step = eventData.stepData;
        var tf = target.transform = [];
        target.perspectiveScale = 1;

        for (var i = eventData.current.maxNestedDepth; i > (eventData.parents.length || 0); i--) {
            tf.push(["scale"], ["rotate"], ["translate"]);
        }

        tf.push(["scale",
            1 / (step.scaleX || step.scale),
            1 / (step.scaleY || step.scale),
            1 / (step.scaleZ)]);
        tf.push(["rotate",
            -step.rotateX,
            -step.rotateY,
            -(step.rotateZ || step.rotate)]);
        tf.push(["translate",
            -(step.x || (step.r * Math.sin(step.phi * Math.PI / 180))),
            -(step.y || (-step.r * Math.cos(step.phi * Math.PI / 180))),
            -step.z]);
        target.perspectiveScale *= (step.scaleX || step.scale);

        $.each(eventData.parents, function (idx, element) {
            var step = $(element).data("stepData");
            tf.push(["scale",
                1 / (step.scaleX || step.scale),
                1 / (step.scaleY || step.scale),
                1 / (step.scaleZ)]);
            tf.push(["rotate",
                -step.rotateX,
                -step.rotateY,
                -(step.rotateZ || step.rotate)]);
            tf.push(["translate",
                -(step.x || (step.r * Math.sin(step.phi * Math.PI / 180))),
                -(step.y || (-step.r * Math.cos(step.phi * Math.PI / 180))),
                -step.z]);
            target.perspectiveScale *= (step.scaleX || step.scale);
        });

        $.each(tf, function (idx, item) {
            if (item[0] !== "rotate") {
                return;
            }
            function lowRotate(name) {
                if (eventData.current["rotate" + name + "-" + idx] === undefined) {
                    eventData.current["rotate" + name + "-" + idx] = item[name] || 0;
                }
                var cur = eventData.current["rotate" + name + "-" + idx], tar = item[name] || 0,
                    curmod = cur % 360, tarmod = tar % 360;
                if (curmod < 0) {
                    curmod += 360;
                }
                if (tarmod < 0) {
                    tarmod += 360;
                }
                var diff = tarmod - curmod;
                if (diff < -180) {
                    diff += 360;
                } else if (diff > 180) {
                    diff -= 360;
                }
                eventData.current["rotate" + name + "-" + idx] = item[name] = cur + diff;
            }

            lowRotate(1);
            lowRotate(2);
            lowRotate(3);
        });
    });
    $.jmpress("applyTarget", function (active, eventData) {

        var target = eventData.target,
            props, step = eventData.stepData,
            settings = eventData.settings,
            zoomin = target.perspectiveScale * 1.3 < eventData.current.perspectiveScale,
            zoomout = target.perspectiveScale > eventData.current.perspectiveScale * 1.3;

        // extract first scale from transform
        var lastScale = -1;
        $.each(target.transform, function (idx, item) {
            if (item.length <= 1) {
                return;
            }
            if (item[0] === "rotate" &&
                item[1] % 360 === 0 &&
                item[2] % 360 === 0 &&
                item[3] % 360 === 0) {
                return;
            }
            if (item[0] === "scale") {
                lastScale = idx;
            } else {
                return false;
            }
        });

        if (lastScale !== eventData.current.oldLastScale) {
            zoomin = zoomout = false;
            eventData.current.oldLastScale = lastScale;
        }

        var extracted = [];
        if (lastScale !== -1) {
            while (lastScale >= 0) {
                if (target.transform[lastScale][0] === "scale") {
                    extracted.push(target.transform[lastScale]);
                    target.transform[lastScale] = ["scale"];
                }
                lastScale--;
            }
        }

        var animation = settings.animation;
        if (settings.reasonableAnimation[eventData.reason]) {
            animation = $.extend({},
                animation,
                settings.reasonableAnimation[eventData.reason]);
        }

        props = {
            // to keep the perspective look similar for different scales
            // we need to 'scale' the perspective, too
            perspective: Math.round(target.perspectiveScale * 1000) + "px"
        };
        props = $.extend({}, animation, props);
        if (!zoomin) {
            props.transitionDelay = '0s';
        }
        if (!eventData.beforeActive) {
            props.transitionDuration = '0s';
            props.transitionDelay = '0s';
        }
        $.jmpress("css", eventData.area, props);
        engine.transform(eventData.area, extracted);

        props = $.extend({}, animation);
        if (!zoomout) {
            props.transitionDelay = '0s';
        }
        if (!eventData.beforeActive) {
            props.transitionDuration = '0s';
            props.transitionDelay = '0s';
        }

        eventData.current.perspectiveScale = target.perspectiveScale;

        $.jmpress("css", eventData.canvas, props);
        engine.transform(eventData.canvas, target.transform);
    });

}(jQuery, document, window));
/*
 * active.js
 * Set the active classes on steps
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* DEFINES */
    var activeClass = 'activeClass',
        nestedActiveClass = 'nestedActiveClass';

    /* DEFAULTS */
    var defaults = $jmpress('defaults');
    defaults[nestedActiveClass] = "nested-active";
    defaults[activeClass] = "active";

    /* HOOKS */
    $jmpress('setInactive', function (step, eventData) {
        var settings = eventData.settings,
            activeClassSetting = settings[activeClass],
            nestedActiveClassSettings = settings[nestedActiveClass];
        if (activeClassSetting) {
            $(step).removeClass(activeClassSetting);
        }
        if (nestedActiveClassSettings) {
            $.each(eventData.parents, function (idx, element) {
                $(element).removeClass(nestedActiveClassSettings);
            });
        }
    });
    $jmpress('setActive', function (step, eventData) {
        var settings = eventData.settings,
            activeClassSetting = settings[activeClass],
            nestedActiveClassSettings = settings[nestedActiveClass];
        if (activeClassSetting) {
            $(step).addClass(activeClassSetting);
        }
        if (nestedActiveClassSettings) {
            $.each(eventData.parents, function (idx, element) {
                $(element).addClass(nestedActiveClassSettings);
            });
        }
    });

}(jQuery, document, window));
/*
 * circular.js
 * Repeat from start after end
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* FUNCTIONS */
    function firstSlide(step, eventData) {
        return $(this).find(eventData.settings.stepSelector).first();
    }

    function prevOrNext(jmpress, step, eventData, prev) {
        if (!step) {
            return false;
        }
        var stepSelector = eventData.settings.stepSelector;
        step = $(step);
        do {
            var item = step.near(stepSelector, prev);
            if (item.length === 0 || item.closest(jmpress).length === 0) {
                item = $(jmpress).find(stepSelector)[prev ? "last" : "first"]();
            }
            if (!item.length) {
                return false;
            }
            step = item;
        } while (step.data("stepData").exclude);
        return step;
    }

    /* HOOKS */
    $jmpress('initStep', function (step, eventData) {
        eventData.stepData.exclude = eventData.data.exclude && ["false", "no"].indexOf(eventData.data.exclude) === -1;
    });
    $jmpress('selectInitialStep', firstSlide);
    $jmpress('selectHome', firstSlide);
    $jmpress('selectEnd', function (step, eventData) {
        return $(this).find(eventData.settings.stepSelector).last();
    });
    $jmpress('selectPrev', function (step, eventData) {
        return prevOrNext(this, step, eventData, true);
    });
    $jmpress('selectNext', function (step, eventData) {
        return prevOrNext(this, step, eventData);
    });
}(jQuery, document, window));
/*
 * start.js
 * Set the first step to start on
 */
(function ($, document, window, undefined) {

    

    /* HOOKS */
    $.jmpress('selectInitialStep', function (nil, eventData) {
        return eventData.settings.start;
    });

}(jQuery, document, window));
/*
 * ways.js
 * Control the flow of the steps
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* FUNCTIONS */
    function routeFunc(jmpress, route, type) {
        for (var i = 0; i < route.length - 1; i++) {
            var from = route[i];
            var to = route[i + 1];
            if ($(jmpress).jmpress("initialized")) {
                $(from, jmpress).data("stepData")[type] = to;
            } else {
                $(from, jmpress).attr('data-' + type, to);
            }
        }
    }

    function selectPrevOrNext(step, eventData, attr, prev) {
        var stepData = eventData.stepData;
        if (stepData[attr]) {
            var near = $(step).near(stepData[attr], prev);
            if (near && near.length) {
                return near;
            }
            near = $(stepData[attr], this)[prev ? "last" : "first"]();
            if (near && near.length) {
                return near;
            }
        }
    }

    /* EXPORTED FUNCTIONS */
    $jmpress('register', 'route', function (route, unidirectional, reversedRoute) {
        if (typeof route === "string") {
            route = [route, route];
        }
        routeFunc(this, route, reversedRoute ? "prev" : "next");
        if (!unidirectional) {
            routeFunc(this, route.reverse(), reversedRoute ? "next" : "prev");
        }
    });

    /* HOOKS */
    $jmpress('initStep', function (step, eventData) {
        for (var attr in {next: 1, prev: 1}) {
            eventData.stepData[attr] = eventData.data[attr];
        }
    });
    $jmpress('selectNext', function (step, eventData) {
        return selectPrevOrNext.call(this, step, eventData, "next");
    });
    $jmpress('selectPrev', function (step, eventData) {
        return selectPrevOrNext.call(this, step, eventData, "prev", true);
    });

}(jQuery, document, window));
/*
 * ajax.js
 * Load steps via ajax
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* DEFINES */
    var afterStepLoaded = 'ajax:afterStepLoaded',
        loadStep = 'ajax:loadStep';

    /* REGISTER EVENTS */
    $jmpress('register', loadStep);
    $jmpress('register', afterStepLoaded);

    /* DEFAULTS */
    $jmpress('defaults').ajaxLoadedClass = "loaded";

    /* HOOKS */
    $jmpress('initStep', function (step, eventData) {
        eventData.stepData.src = $(step).attr('href') || eventData.data.src || false;
        eventData.stepData.srcLoaded = false;
    });
    $jmpress(loadStep, function (step, eventData) {
        var stepData = eventData.stepData,
            href = stepData && stepData.src,
            settings = eventData.settings;
        if (href) {
            $(step).addClass(settings.ajaxLoadedClass);
            stepData.srcLoaded = true;
            $(step).load(href, function (response, status, xhr) {
                $(eventData.jmpress).jmpress('fire', afterStepLoaded, step, $.extend({}, eventData, {
                    response: response, status: status, xhr: xhr
                }));
            });
        }
    });
    $jmpress('idle', function (step, eventData) {
        if (!step) {
            return;
        }
        var settings = eventData.settings,
            jmpress = $(this),
            stepData = eventData.stepData;
        var siblings = $(step)
            .add($(step).near(settings.stepSelector))
            .add($(step).near(settings.stepSelector, true))
            .add(jmpress.jmpress('fire', 'selectPrev', step, {
                stepData: $(step).data('stepData')
            }))
            .add(jmpress.jmpress('fire', 'selectNext', step, {
                stepData: $(step).data('stepData')
            }));
        siblings.each(function () {
            var step = this,
                stepData = $(step).data("stepData");
            if (!stepData.src || stepData.srcLoaded) {
                return;
            }
            jmpress.jmpress('fire', loadStep, step, {
                stepData: $(step).data('stepData')
            });
        });
    });
    $jmpress("setActive", function (step, eventData) {
        var stepData = $(step).data("stepData");
        if (!stepData.src || stepData.srcLoaded) {
            return;
        }
        $(this).jmpress('fire', loadStep, step, {
            stepData: $(step).data('stepData')
        });
    });

}(jQuery, document, window));
/*
 * hash.js
 * Detect and set the URL hash
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress,
        hashLink = "a[href^=#]";

    /* FUNCTIONS */
    function randomString() {
        return "" + Math.round(Math.random() * 100000, 0);
    }

    /**
     * getElementFromUrl
     *
     * @return String or undefined
     */
    function getElementFromUrl(settings) {
        // get id from url # by removing `#` or `#/` from the beginning,
        // so both "fallback" `#slide-id` and "enhanced" `#/slide-id` will work
        // TODO SECURITY check user input to be valid!
        try {
            var el = $('#' + window.location.hash.replace(/^#\/?/, ""));
            return el.length > 0 && el.is(settings.stepSelector) ? el : undefined;
        } catch (e) {
        }
    }

    function setHash(stepid) {
        var shouldBeHash = "#/" + stepid;
        if (window.history && window.history.pushState) {
            // shouldBeHash = "#" + stepid;
            // consider this for future versions
            //  it has currently issues, when startup with a link with hash (webkit)
            if (window.location.hash !== shouldBeHash) {
                window.history.pushState({}, '', shouldBeHash);
            }
        } else {
            if (window.location.hash !== shouldBeHash) {
                window.location.hash = shouldBeHash;
            }
        }
    }

    /* DEFAULTS */
    $jmpress('defaults').hash = {
        use: true, update: true, bindChange: true
        // NOTICE: {use: true, update: false, bindChange: true}
        // will cause a error after clicking on a link to the current step
    };

    /* HOOKS */
    $jmpress('selectInitialStep', function (step, eventData) {
        var settings = eventData.settings,
            hashSettings = settings.hash,
            current = eventData.current,
            jmpress = $(this);
        eventData.current.hashNamespace = ".jmpress-" + randomString();
        // HASH CHANGE EVENT
        if (hashSettings.use) {
            if (hashSettings.bindChange) {
                $(window).bind('hashchange' + current.hashNamespace, function (event) {
                    var urlItem = getElementFromUrl(settings);
                    if (jmpress.jmpress('initialized')) {
                        jmpress.jmpress("scrollFix");
                    }
                    if (urlItem && urlItem.length) {
                        if (urlItem.attr("id") !== jmpress.jmpress("active").attr("id")) {
                            jmpress.jmpress('select', urlItem);
                        }
                        setHash(urlItem.attr("id"));
                    }
                    event.preventDefault();
                });
                $(hashLink).on("click" + current.hashNamespace, function (event) {
                    var href = $(this).attr("href");
                    try {
                        if ($(href).is(settings.stepSelector)) {
                            jmpress.jmpress("select", href);
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    } catch (e) {
                    }
                });
            }
            return getElementFromUrl(settings);
        }
    });
    $jmpress('afterDeinit', function (nil, eventData) {
        $(hashLink).off(eventData.current.hashNamespace);
        $(window).unbind(eventData.current.hashNamespace);
    });
    $jmpress('setActive', function (step, eventData) {
        var settings = eventData.settings,
            current = eventData.current;
        // `#/step-id` is used instead of `#step-id` to prevent default browser
        // scrolling to element in hash
        if (settings.hash.use && settings.hash.update) {
            clearTimeout(current.hashtimeout);
            current.hashtimeout = setTimeout(function () {
                setHash($(eventData.delegatedFrom).attr('id'));
            }, settings.transitionDuration + 200);
        }
    });

}(jQuery, document, window));
/*
 * keyboard.js
 * Keyboard event mapping and default keyboard actions
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress,
        jmpressNext = "next",
        jmpressPrev = "prev";

    /* FUNCTIONS */
    function randomString() {
        return "" + Math.round(Math.random() * 100000, 0);
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    /* DEFAULTS */
    $jmpress('defaults').keyboard = {
        use: true, keys: {
            33: jmpressPrev // pg up
            , 37: jmpressPrev // left
            , 38: jmpressPrev // up

            , 9: jmpressNext + ":" + jmpressPrev // tab
            , 32: jmpressNext // space
            , 34: jmpressNext // pg down
            , 39: jmpressNext // right
            , 40: jmpressNext // down

            , 36: "home" // home

            , 35: "end" // end
        }, ignore: {
            "INPUT": [
                32 // space
                , 37 // left
                , 38 // up
                , 39 // right
                , 40 // down
            ], "TEXTAREA": [
                32 // space
                , 37 // left
                , 38 // up
                , 39 // right
                , 40 // down
            ], "SELECT": [
                38 // up
                , 40 // down
            ]
        }, tabSelector: "a[href]:visible, :input:visible"
    };

    /* HOOKS */
    $jmpress('afterInit', function (nil, eventData) {
        var settings = eventData.settings,
            keyboardSettings = settings.keyboard,
            ignoreKeyboardSettings = keyboardSettings.ignore,
            current = eventData.current,
            jmpress = $(this);

        // tabindex make it focusable so that it can recieve key events
        if (!settings.fullscreen) {
            jmpress.attr("tabindex", 0);
        }

        current.keyboardNamespace = ".jmpress-" + randomString();

        // KEYPRESS EVENT: this fixes a Opera bug
        $(settings.fullscreen ? document : jmpress)
            .bind("keypress" + current.keyboardNamespace, function (event) {

                for (var nodeName in ignoreKeyboardSettings) {
                    if (event.target.nodeName === nodeName && ignoreKeyboardSettings[nodeName].indexOf(event.which) !== -1) {
                        return;
                    }
                }
                if (event.which >= 37 && event.which <= 40 || event.which === 32) {
                    stopEvent(event);
                }
            });
        // KEYDOWN EVENT
        $(settings.fullscreen ? document : jmpress)
            .bind("keydown" + current.keyboardNamespace, function (event) {
                var eventTarget = $(event.target);

                if (!settings.fullscreen && !eventTarget.closest(jmpress).length || !keyboardSettings.use) {
                    return;
                }

                for (var nodeName in ignoreKeyboardSettings) {
                    if (eventTarget[0].nodeName === nodeName && ignoreKeyboardSettings[nodeName].indexOf(event.which) !== -1) {
                        return;
                    }
                }

                var reverseSelect = false;
                var nextFocus;
                if (event.which === 9) {
                    // tab
                    if (!eventTarget.closest(jmpress.jmpress('active')).length) {
                        if (!event.shiftKey) {
                            nextFocus = jmpress.jmpress('active').find("a[href], :input").filter(":visible").first();
                        } else {
                            reverseSelect = true;
                        }
                    } else {
                        nextFocus = eventTarget.near(keyboardSettings.tabSelector, event.shiftKey);
                        if (!$(nextFocus)
                            .closest(settings.stepSelector)
                            .is(jmpress.jmpress('active'))) {
                            nextFocus = undefined;
                        }
                    }
                    if (nextFocus && nextFocus.length > 0) {
                        nextFocus.focus();
                        jmpress.jmpress("scrollFix");
                        stopEvent(event);
                        return;
                    } else {
                        if (event.shiftKey) {
                            reverseSelect = true;
                        }
                    }
                }

                var action = keyboardSettings.keys[ event.which ];
                if (typeof action === "string") {
                    if (action.indexOf(":") !== -1) {
                        action = action.split(":");
                        action = event.shiftKey ? action[1] : action[0];
                    }
                    jmpress.jmpress(action);
                    stopEvent(event);
                } else if ($.isFunction(action)) {
                    action.call(jmpress, event);
                } else if (action) {
                    jmpress.jmpress.apply(jmpress, action);
                    stopEvent(event);
                }

                if (reverseSelect) {
                    // tab
                    nextFocus = jmpress.jmpress('active').find("a[href], :input").filter(":visible").last();
                    nextFocus.focus();
                    jmpress.jmpress("scrollFix");
                }
            });
    });
    $jmpress('afterDeinit', function (nil, eventData) {
        $(document).unbind(eventData.current.keyboardNamespace);
    });


}(jQuery, document, window));
/*
 * viewport.js
 * Scale to fit a given viewport
 */
(function ($, document, window, undefined) {

    

    function randomString() {
        return "" + Math.round(Math.random() * 100000, 0);
    }

    var browser = (function () {
        var ua = navigator.userAgent.toLowerCase();
        var match = /(chrome)[ \/]([\w.]+)/.exec(ua) ||
            /(webkit)[ \/]([\w.]+)/.exec(ua) ||
            /(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) ||
            /(msie) ([\w.]+)/.exec(ua) ||
            ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua) ||
            [];
        return match[1] || "";
    }());

    var defaults = $.jmpress("defaults");
    defaults.viewPort = {
        width: false, height: false, maxScale: 0, minScale: 0, zoomable: 0, zoomBindMove: true, zoomBindWheel: true
    };
    var keys = defaults.keyboard.keys;
    keys[browser === 'mozilla' ? 107 : 187] = "zoomIn";  // +
    keys[browser === 'mozilla' ? 109 : 189] = "zoomOut"; // -
    defaults.reasonableAnimation.resize = {
        transitionDuration: '0s', transitionDelay: '0ms'
    };
    defaults.reasonableAnimation.zoom = {
        transitionDuration: '0s', transitionDelay: '0ms'
    };
    $.jmpress("initStep", function (step, eventData) {
        for (var variable in {"viewPortHeight": 1, "viewPortWidth": 1, "viewPortMinScale": 1, "viewPortMaxScale": 1, "viewPortZoomable": 1}) {
            eventData.stepData[variable] = eventData.data[variable] && parseFloat(eventData.data[variable]);
        }
    });
    $.jmpress("afterInit", function (nil, eventData) {
        var jmpress = this;
        eventData.current.viewPortNamespace = ".jmpress-" + randomString();
        $(window).bind("resize" + eventData.current.viewPortNamespace, function (event) {
            $(jmpress).jmpress("reselect", "resize");
        });
        eventData.current.userZoom = 0;
        eventData.current.userTranslateX = 0;
        eventData.current.userTranslateY = 0;
        if (eventData.settings.viewPort.zoomBindWheel) {
            $(eventData.settings.fullscreen ? document : this)
                .bind("mousewheel" + eventData.current.viewPortNamespace + " DOMMouseScroll" + eventData.current.viewPortNamespace, function (event, delta) {
                    delta = delta || event.originalEvent.wheelDelta || -event.originalEvent.detail /* mozilla */;
                    var direction = (delta / Math.abs(delta));
                    if (direction < 0) {
                        $(eventData.jmpress).jmpress("zoomOut", event.originalEvent.x, event.originalEvent.y);
                    } else if (direction > 0) {
                        $(eventData.jmpress).jmpress("zoomIn", event.originalEvent.x, event.originalEvent.y);
                    }
                    return false;
                });
        }
        if (eventData.settings.viewPort.zoomBindMove) {
            $(eventData.settings.fullscreen ? document : this).bind("mousedown" + eventData.current.viewPortNamespace,function (event) {
                if (eventData.current.userZoom) {
                    eventData.current.userTranslating = { x: event.clientX, y: event.clientY };
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }).bind("mousemove" + eventData.current.viewPortNamespace,function (event) {
                var userTranslating = eventData.current.userTranslating;
                if (userTranslating) {
                    $(jmpress).jmpress("zoomTranslate", event.clientX - userTranslating.x, event.clientY - userTranslating.y);
                    userTranslating.x = event.clientX;
                    userTranslating.y = event.clientY;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }).bind("mouseup" + eventData.current.viewPortNamespace, function (event) {
                if (eventData.current.userTranslating) {
                    eventData.current.userTranslating = undefined;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            });
        }
    });
    function maxAbs(value, range) {
        return Math.max(Math.min(value, range), -range);
    }

    function zoom(x, y, direction) {
        var current = $(this).jmpress("current"),
            settings = $(this).jmpress("settings"),
            stepData = $(this).jmpress("active").data("stepData"),
            container = $(this).jmpress("container");
        if (current.userZoom === 0 && direction < 0) {
            return;
        }
        var zoomableSteps = stepData.viewPortZoomable || settings.viewPort.zoomable;
        if (current.userZoom === zoomableSteps && direction > 0) {
            return;
        }
        current.userZoom += direction;

        var halfWidth = $(container).innerWidth() / 2,
            halfHeight = $(container).innerHeight() / 2;

        x = x ? x - halfWidth : x;
        y = y ? y - halfHeight : y;

        // TODO this is not perfect... too much math... :(
        current.userTranslateX =
            maxAbs(current.userTranslateX - direction * x / current.zoomOriginWindowScale / zoomableSteps,
                halfWidth * current.userZoom * current.userZoom / zoomableSteps);
        current.userTranslateY =
            maxAbs(current.userTranslateY - direction * y / current.zoomOriginWindowScale / zoomableSteps,
                halfHeight * current.userZoom * current.userZoom / zoomableSteps);

        $(this).jmpress("reselect", "zoom");
    }

    $.jmpress("register", "zoomIn", function (x, y) {
        zoom.call(this, x || 0, y || 0, 1);
    });
    $.jmpress("register", "zoomOut", function (x, y) {
        zoom.call(this, x || 0, y || 0, -1);
    });
    $.jmpress("register", "zoomTranslate", function (x, y) {
        var current = $(this).jmpress("current"),
            settings = $(this).jmpress("settings"),
            stepData = $(this).jmpress("active").data("stepData"),
            container = $(this).jmpress("container");
        var zoomableSteps = stepData.viewPortZoomable || settings.viewPort.zoomable;
        var halfWidth = $(container).innerWidth(),
            halfHeight = $(container).innerHeight();
        current.userTranslateX =
            maxAbs(current.userTranslateX + x / current.zoomOriginWindowScale,
                halfWidth * current.userZoom * current.userZoom / zoomableSteps);
        current.userTranslateY =
            maxAbs(current.userTranslateY + y / current.zoomOriginWindowScale,
                halfHeight * current.userZoom * current.userZoom / zoomableSteps);
        $(this).jmpress("reselect", "zoom");
    });
    $.jmpress('afterDeinit', function (nil, eventData) {
        $(eventData.settings.fullscreen ? document : this).unbind(eventData.current.viewPortNamespace);
        $(window).unbind(eventData.current.viewPortNamespace);
    });
    $.jmpress("setActive", function (step, eventData) {
        var viewPort = eventData.settings.viewPort;
        var viewPortHeight = eventData.stepData.viewPortHeight || viewPort.height;
        var viewPortWidth = eventData.stepData.viewPortWidth || viewPort.width;
        var viewPortMaxScale = eventData.stepData.viewPortMaxScale || viewPort.maxScale;
        var viewPortMinScale = eventData.stepData.viewPortMinScale || viewPort.minScale;
        // Correct the scale based on the window's size
        var windowScaleY = viewPortHeight && $(eventData.container).innerHeight() / viewPortHeight;
        var windowScaleX = viewPortWidth && $(eventData.container).innerWidth() / viewPortWidth;
        var windowScale = (windowScaleX || windowScaleY) && Math.min(windowScaleX || windowScaleY, windowScaleY || windowScaleX);

        if (windowScale) {
            windowScale = windowScale || 1;
            if (viewPortMaxScale) {
                windowScale = Math.min(windowScale, viewPortMaxScale);
            }
            if (viewPortMinScale) {
                windowScale = Math.max(windowScale, viewPortMinScale);
            }

            var zoomableSteps = eventData.stepData.viewPortZoomable || eventData.settings.viewPort.zoomable;
            if (zoomableSteps) {
                var diff = (1 / windowScale) - (1 / viewPortMaxScale);
                diff /= zoomableSteps;
                windowScale = 1 / ((1 / windowScale) - diff * eventData.current.userZoom);
            }

            eventData.target.transform.reverse();
            if (eventData.current.userTranslateX && eventData.current.userTranslateY) {
                eventData.target.transform.push(["translate", eventData.current.userTranslateX, eventData.current.userTranslateY, 0]);
            } else {
                eventData.target.transform.push(["translate"]);
            }
            eventData.target.transform.push(["scale",
                windowScale,
                windowScale,
                1]);
            eventData.target.transform.reverse();
            eventData.target.perspectiveScale /= windowScale;
        }
        eventData.current.zoomOriginWindowScale = windowScale;
    });
    $.jmpress("setInactive", function (step, eventData) {
        if (!eventData.nextStep || !step || $(eventData.nextStep).attr("id") !== $(step).attr("id")) {
            eventData.current.userZoom = 0;
            eventData.current.userTranslateX = 0;
            eventData.current.userTranslateY = 0;
        }
    });

}(jQuery, document, window));

/*
 * mouse.js
 * Clicking to select a step
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* FUNCTIONS */
    function randomString() {
        return "" + Math.round(Math.random() * 100000, 0);
    }

    /* DEFAULTS */
    $jmpress("defaults").mouse = {
        clickSelects: true
    };

    /* HOOKS */
    $jmpress("afterInit", function (nil, eventData) {
        var settings = eventData.settings,
            stepSelector = settings.stepSelector,
            current = eventData.current,
            jmpress = $(this);
        current.clickableStepsNamespace = ".jmpress-" + randomString();
        jmpress.bind("click" + current.clickableStepsNamespace, function (event) {
            if (!settings.mouse.clickSelects || current.userZoom) {
                return;
            }

            // get clicked step
            var clickedStep = $(event.target).closest(stepSelector);

            // clicks on the active step do default
            if (clickedStep.is(jmpress.jmpress("active"))) {
                return;
            }

            if (clickedStep.length) {
                // select the clicked step
                jmpress.jmpress("select", clickedStep[0], "click");
                event.preventDefault();
                event.stopPropagation();
            }
        });
    });
    $jmpress('afterDeinit', function (nil, eventData) {
        $(this).unbind(eventData.current.clickableStepsNamespace);
    });

}(jQuery, document, window));
/*
 * mobile.js
 * Adds support for swipe on touch supported browsers
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress;

    /* FUNCTIONS */
    function randomString() {
        return "" + Math.round(Math.random() * 100000, 0);
    }

    /* HOOKS */
    $jmpress('afterInit', function (step, eventData) {
        var settings = eventData.settings,
            current = eventData.current,
            jmpress = eventData.jmpress;
        current.mobileNamespace = ".jmpress-" + randomString();
        var data, start = [0, 0];
        $(settings.fullscreen ? document : jmpress)
            .bind("touchstart" + current.mobileNamespace,function (event) {

                data = event.originalEvent.touches[0];
                start = [ data.pageX, data.pageY ];

            }).bind("touchmove" + current.mobileNamespace,function (event) {
                data = event.originalEvent.touches[0];
                event.preventDefault();
                return false;
            }).bind("touchend" + current.mobileNamespace, function (event) {
                var end = [ data.pageX, data.pageY ],
                    diff = [ end[0] - start[0], end[1] - start[1] ];

                if (Math.max(Math.abs(diff[0]), Math.abs(diff[1])) > 50) {
                    diff = Math.abs(diff[0]) > Math.abs(diff[1]) ? diff[0] : diff[1];
                    $(jmpress).jmpress(diff > 0 ? "prev" : "next");
                    event.preventDefault();
                    return false;
                }
            });
    });
    $jmpress('afterDeinit', function (nil, eventData) {
        var settings = eventData.settings,
            current = eventData.current,
            jmpress = eventData.jmpress;
        $(settings.fullscreen ? document : jmpress).unbind(current.mobileNamespace);
    });

}(jQuery, document, window));
/*
 * templates.js
 * The amazing template engine
 */
(function ($, document, window, undefined) {

    
    var $jmpress = $.jmpress,
        templateFromParentIdent = "_template_",
        templateFromApplyIdent = "_applied_template_";

    /* STATIC VARS */
    var templates = {};

    /* FUNCTIONS */
    function addUndefined(target, values, prefix) {
        for (var name in values) {
            var targetName = name;
            if (prefix) {
                targetName = prefix + targetName.substr(0, 1).toUpperCase() + targetName.substr(1);
            }
            if ($.isPlainObject(values[name])) {
                addUndefined(target, values[name], targetName);
            } else if (target[targetName] === undefined) {
                target[targetName] = values[name];
            }
        }
    }

    function applyChildrenTemplates(children, templateChildren) {
        if ($.isArray(templateChildren)) {
            if (templateChildren.length < children.length) {
                $.error("more nested steps than children in template");
            } else {
                children.each(function (idx, child) {
                    child = $(child);
                    var tmpl = child.data(templateFromParentIdent) || {};
                    addUndefined(tmpl, templateChildren[idx]);
                    child.data(templateFromParentIdent, tmpl);
                });
            }
        } else if ($.isFunction(templateChildren)) {
            children.each(function (idx, child) {
                child = $(child);
                var tmpl = child.data(templateFromParentIdent) || {};
                addUndefined(tmpl, templateChildren(idx, child, children));
                child.data(templateFromParentIdent, tmpl);
            });
        } // TODO: else if(object)
    }

    function applyTemplate(data, element, template, eventData) {
        if (template.children) {
            var children = element.children(eventData.settings.stepSelector);
            applyChildrenTemplates(children, template.children);
        }
        applyTemplateData(data, template);
    }

    function applyTemplateData(data, template) {
        addUndefined(data, template);
    }

    /* HOOKS */
    $jmpress("beforeInitStep", function (step, eventData) {
        step = $(step);
        var data = eventData.data,
            templateFromAttr = data.template,
            templateFromApply = step.data(templateFromApplyIdent),
            templateFromParent = step.data(templateFromParentIdent);
        if (templateFromAttr) {
            $.each(templateFromAttr.split(" "), function (idx, tmpl) {
                var template = templates[tmpl];
                applyTemplate(data, step, template, eventData);
            });
        }
        if (templateFromApply) {
            applyTemplate(data, step, templateFromApply, eventData);
        }
        if (templateFromParent) {
            applyTemplate(data, step, templateFromParent, eventData);
            step.data(templateFromParentIdent, null);
            if (templateFromParent.template) {
                $.each(templateFromParent.template.split(" "), function (idx, tmpl) {
                    var template = templates[tmpl];
                    applyTemplate(data, step, template, eventData);
                });
            }
        }
    });
    $jmpress("beforeInit", function (nil, eventData) {
        var data = $jmpress("dataset", this),
            dataTemplate = data.template,
            stepSelector = eventData.settings.stepSelector;
        if (dataTemplate) {
            var template = templates[dataTemplate];
            applyChildrenTemplates($(this).find(stepSelector).filter(function () {
                return !$(this).parent().is(stepSelector);
            }), template.children);
        }
    });

    /* EXPORTED FUNCTIONS */
    $jmpress("register", "template", function (name, tmpl) {
        if (templates[name]) {
            templates[name] = $.extend(true, {}, templates[name], tmpl);
        } else {
            templates[name] = $.extend(true, {}, tmpl);
        }
    });
    $jmpress("register", "apply", function (selector, tmpl) {
        if (!tmpl) {
            // TODO ERROR because settings not found
            var stepSelector = $(this).jmpress("settings").stepSelector;
            applyChildrenTemplates($(this).find(stepSelector).filter(function () {
                return !$(this).parent().is(stepSelector);
            }), selector);
        } else if ($.isArray(tmpl)) {
            applyChildrenTemplates($(selector), tmpl);
        } else {
            var template;
            if (typeof tmpl === "string") {
                template = templates[tmpl];
            } else {
                template = $.extend(true, {}, tmpl);
            }
            $(selector).each(function (idx, element) {
                element = $(element);
                var tmpl = element.data(templateFromApplyIdent) || {};
                addUndefined(tmpl, template);
                element.data(templateFromApplyIdent, tmpl);
            });
        }
    });

}(jQuery, document, window));
/*
 * jqevents.js
 * Fires jQuery events
 */
(function ($, document, window, undefined) {

    

    /* HOOKS */
    // the events should not bubble up the tree
    // elsewise nested jmpress would cause buggy behavior
    $.jmpress("setActive", function (step, eventData) {
        if (eventData.prevStep !== step) {
            $(step).triggerHandler("enterStep");
        }
    });
    $.jmpress("setInactive", function (step, eventData) {
        if (eventData.nextStep !== step) {
            $(step).triggerHandler("leaveStep");
        }
    });

}(jQuery, document, window));
/*
 * animation.js
 * Apply custom animations to steps
 */
(function ($, document, window, undefined) {

    

    function parseSubstepInfo(str) {
        var arr = str.split(" ");
        var className = arr[0];
        var config = { willClass: "will-" + className, doClass: "do-" + className, hasClass: "has-" + className };
        var state = "";
        for (var i = 1; i < arr.length; i++) {
            var s = arr[i];
            switch (state) {
                case "":
                    if (s === "after") {
                        state = "after";
                    } else {
                        $.warn("unknown keyword in '" + str + "'. '" + s + "' unknown.");
                    }
                    break;
                case "after":
                    if (s.match(/^[1-9][0-9]*m?s?/)) {
                        var value = parseFloat(s);
                        if (s.indexOf("ms") !== -1) {
                            value *= 1;
                        } else if (s.indexOf("s") !== -1) {
                            value *= 1000;
                        } else if (s.indexOf("m") !== -1) {
                            value *= 60000;
                        }
                        config.delay = value;
                    } else {
                        config.after = Array.prototype.slice.call(arr, i).join(" ");
                        i = arr.length;
                    }
            }
        }
        return config;
    }

    function find(array, selector, start, end) {
        end = end || (array.length - 1);
        start = start || 0;
        for (var i = start; i < end + 1; i++) {
            if ($(array[i].element).is(selector)) {
                return i;
            }
        }
    }

    function addOn(list, substep, delay) {
        $.each(substep._on, function (idx, child) {
            list.push({substep: child.substep, delay: child.delay + delay});
            addOn(list, child.substep, child.delay + delay);
        });
    }

    $.jmpress("defaults").customAnimationDataAttribute = "jmpress";
    $.jmpress("afterInit", function (nil, eventData) {
        eventData.current.animationTimeouts = [];
        eventData.current.animationCleanupWaiting = [];
    });
    $.jmpress("applyStep", function (step, eventData) {
        // read custom animation from elements
        var substepsData = {};
        var listOfSubsteps = [];
        $(step).find("[data-" + eventData.settings.customAnimationDataAttribute + "]")
            .each(function (idx, element) {
                if ($(element).closest(eventData.settings.stepSelector).is(step)) {
                    listOfSubsteps.push({element: element});
                }
            });
        if (listOfSubsteps.length === 0) {
            return;
        }
        $.each(listOfSubsteps, function (idx, substep) {
            substep.info = parseSubstepInfo(
                $(substep.element).data(eventData.settings.customAnimationDataAttribute));
            $(substep.element).addClass(substep.info.willClass);
            substep._on = [];
            substep._after = null;
        });
        var current = {_after: undefined, _on: [], info: {}}; // virtual zero step
        $.each(listOfSubsteps, function (idx, substep) {
            var other = substep.info.after;
            if (other) {
                if (other === "step") {
                    other = current;
                } else if (other === "prev") {
                    other = listOfSubsteps[idx - 1];
                } else {
                    var index = find(listOfSubsteps, other, 0, idx - 1);
                    if (index === undefined) {
                        index = find(listOfSubsteps, other);
                    }
                    other = (index === undefined || index === idx) ? listOfSubsteps[idx - 1] : listOfSubsteps[index];
                }
            } else {
                other = listOfSubsteps[idx - 1];
            }
            if (other) {
                if (!substep.info.delay) {
                    if (!other._after) {
                        other._after = substep;
                        return;
                    }
                    other = other._after;
                }
                other._on.push({substep: substep, delay: substep.info.delay || 0});
            }
        });
        if (current._after === undefined && current._on.length === 0) {
            var startStep = find(listOfSubsteps, eventData.stepData.startSubstep) || 0;
            current._after = listOfSubsteps[startStep];
        }
        var substepsInOrder = [];

        function findNextFunc(idx, item) {
            if (item.substep._after) {
                current = item.substep._after;
                return false;
            }
        }

        do {
            var substepList = [
                {substep: current, delay: 0}
            ];
            addOn(substepList, current, 0);
            substepsInOrder.push(substepList);
            current = null;
            $.each(substepList, findNextFunc);
        } while (current);
        substepsData.list = substepsInOrder;
        $(step).data("substepsData", substepsData);
    });
    $.jmpress("unapplyStep", function (step, eventData) {
        var substepsData = $(step).data("substepsData");
        if (substepsData) {
            $.each(substepsData.list, function (idx, activeSubsteps) {
                $.each(activeSubsteps, function (idx, substep) {
                    if (substep.substep.info.willClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.willClass);
                    }
                    if (substep.substep.info.hasClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.hasClass);
                    }
                    if (substep.substep.info.doClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.doClass);
                    }
                });
            });
        }
    });
    $.jmpress("setActive", function (step, eventData) {
        var substepsData = $(step).data("substepsData");
        if (!substepsData) {
            return;
        }
        if (eventData.substep === undefined) {
            eventData.substep =
                (eventData.reason === "prev" ?
                    substepsData.list.length - 1 :
                    0
                    );
        }
        var substep = eventData.substep;
        $.each(eventData.current.animationTimeouts, function (idx, timeout) {
            clearTimeout(timeout);
        });
        eventData.current.animationTimeouts = [];
        $.each(substepsData.list, function (idx, activeSubsteps) {
            var applyHas = idx < substep;
            var applyDo = idx <= substep;
            $.each(activeSubsteps, function (idx, substep) {
                if (substep.substep.info.hasClass) {
                    $(substep.substep.element)[(applyHas ? "add" : "remove") + "Class"](substep.substep.info.hasClass);
                }
                function applyIt() {
                    $(substep.substep.element).addClass(substep.substep.info.doClass);
                }

                if (applyDo && !applyHas && substep.delay && eventData.reason !== "prev") {
                    if (substep.substep.info.doClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.doClass);
                        eventData.current.animationTimeouts.push(setTimeout(applyIt, substep.delay));
                    }
                } else {
                    if (substep.substep.info.doClass) {
                        $(substep.substep.element)[(applyDo ? "add" : "remove") + "Class"](substep.substep.info.doClass);
                    }
                }
            });
        });
    });
    $.jmpress("setInactive", function (step, eventData) {
        if (eventData.nextStep === step) {
            return;
        }
        function cleanupAnimation(substepsData) {
            $.each(substepsData.list, function (idx, activeSubsteps) {
                $.each(activeSubsteps, function (idx, substep) {
                    if (substep.substep.info.hasClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.hasClass);
                    }
                    if (substep.substep.info.doClass) {
                        $(substep.substep.element).removeClass(substep.substep.info.doClass);
                    }
                });
            });
        }

        $.each(eventData.current.animationCleanupWaiting, function (idx, item) {
            cleanupAnimation(item);
        });
        eventData.current.animationCleanupWaiting = [];
        var substepsData = $(step).data("substepsData");
        if (substepsData) {
            eventData.current.animationCleanupWaiting.push(substepsData);
        }
    });
    $.jmpress("selectNext", function (step, eventData) {
        if (eventData.substep === undefined) {
            return;
        }
        var substepsData = $(step).data("substepsData");
        if (!substepsData) {
            return;
        }
        if (eventData.substep < substepsData.list.length - 1) {
            return {step: step, substep: eventData.substep + 1};
        }
    });
    $.jmpress("selectPrev", function (step, eventData) {
        if (eventData.substep === undefined) {
            return;
        }
        var substepsData = $(step).data("substepsData");
        if (!substepsData) {
            return;
        }
        if (eventData.substep > 0) {
            return {step: step, substep: eventData.substep - 1};
        }
    });

}(jQuery, document, window));
define("jmpress", ["jQuery","underscore"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.jmpress;
    };
}(this)));

(function () {
    

    define('common/jmpress/cube.directive',['jmpress'], function (jmpress) {

        /**
         * @param element
         * @constructor
         */
        var Cube = function (element) {
            this.element = element;
            this.deinitDirective = function () {
                element.jmpress("deinit");
            };
            this.initDirective = function () {
                $.jmpress("initStep", function (step, eventData) {
                    eventData.stepData.up = eventData.data.up;
                    eventData.stepData.down = eventData.data.down;
                });

                element.jmpress({
                    stepSelector: 'section',
                    hash: false,
                    viewPort: {
                        width: 2000,
                        height: 2000
                    },
                    keyboard: {
                        keys: {
                            38: "up",
                            40: "down"
                        }
                    }
                });
                element.jmpress("route", ["#left", "#front"]);
                element.jmpress("route", ["#top", "#right"], true);
                element.jmpress("route", ["#top", "#left"], true, true);
                element.jmpress("route", ["#bottom", "#left"], true, true);
                element.jmpress("route", ["#bottom", "#right"], true);

                element.jmpress("register", "up", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.up)
                        element.jmpress("select", stepData.up);
                });
                element.jmpress("register", "down", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.down)
                        element.jmpress("select", stepData.down);
                });

                element.css("display", "block");
                element.jmpress("next");
            };
            this.go = function (where) {
                element.jmpress(where);
            };
        };

        /**
         * Required for the angular directive;
         * @returns {{restrict: string, scope: boolean, link: link}}
         */
        var jmPress = function ($timeout) {
            var cube;
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    $timeout(function () {
                        cube = new Cube($($element));
                        cube.initDirective();
                    }, 100);
                    $scope.$on('$destroy', function () {
                        cube.deinitDirective();
                    });

                    $scope.go = function (where, $event) {
                        cube.go(where);
                        if (event) {
                            event.stopPropagation();
                            event.preventDefault();
                        }
                    };
                }
            };
        };
        return ["$timeout", jmPress];

    });
}());
/*!
 * Bootstrap v3.3.1 (http://getbootstrap.com)
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 */
if("undefined"==typeof jQuery)throw new Error("Bootstrap's JavaScript requires jQuery");+function(a){var b=a.fn.jquery.split(" ")[0].split(".");if(b[0]<2&&b[1]<9||1==b[0]&&9==b[1]&&b[2]<1)throw new Error("Bootstrap's JavaScript requires jQuery version 1.9.1 or higher")}(jQuery),+function(a){function b(){var a=document.createElement("bootstrap"),b={WebkitTransition:"webkitTransitionEnd",MozTransition:"transitionend",OTransition:"oTransitionEnd otransitionend",transition:"transitionend"};for(var c in b)if(void 0!==a.style[c])return{end:b[c]};return!1}a.fn.emulateTransitionEnd=function(b){var c=!1,d=this;a(this).one("bsTransitionEnd",function(){c=!0});var e=function(){c||a(d).trigger(a.support.transition.end)};return setTimeout(e,b),this},a(function(){a.support.transition=b(),a.support.transition&&(a.event.special.bsTransitionEnd={bindType:a.support.transition.end,delegateType:a.support.transition.end,handle:function(b){return a(b.target).is(this)?b.handleObj.handler.apply(this,arguments):void 0}})})}(jQuery),+function(a){function b(b){return this.each(function(){var c=a(this),e=c.data("bs.alert");e||c.data("bs.alert",e=new d(this)),"string"==typeof b&&e[b].call(c)})}var c='[data-dismiss="alert"]',d=function(b){a(b).on("click",c,this.close)};d.VERSION="3.3.1",d.TRANSITION_DURATION=150,d.prototype.close=function(b){function c(){g.detach().trigger("closed.bs.alert").remove()}var e=a(this),f=e.attr("data-target");f||(f=e.attr("href"),f=f&&f.replace(/.*(?=#[^\s]*$)/,""));var g=a(f);b&&b.preventDefault(),g.length||(g=e.closest(".alert")),g.trigger(b=a.Event("close.bs.alert")),b.isDefaultPrevented()||(g.removeClass("in"),a.support.transition&&g.hasClass("fade")?g.one("bsTransitionEnd",c).emulateTransitionEnd(d.TRANSITION_DURATION):c())};var e=a.fn.alert;a.fn.alert=b,a.fn.alert.Constructor=d,a.fn.alert.noConflict=function(){return a.fn.alert=e,this},a(document).on("click.bs.alert.data-api",c,d.prototype.close)}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.button"),f="object"==typeof b&&b;e||d.data("bs.button",e=new c(this,f)),"toggle"==b?e.toggle():b&&e.setState(b)})}var c=function(b,d){this.$element=a(b),this.options=a.extend({},c.DEFAULTS,d),this.isLoading=!1};c.VERSION="3.3.1",c.DEFAULTS={loadingText:"loading..."},c.prototype.setState=function(b){var c="disabled",d=this.$element,e=d.is("input")?"val":"html",f=d.data();b+="Text",null==f.resetText&&d.data("resetText",d[e]()),setTimeout(a.proxy(function(){d[e](null==f[b]?this.options[b]:f[b]),"loadingText"==b?(this.isLoading=!0,d.addClass(c).attr(c,c)):this.isLoading&&(this.isLoading=!1,d.removeClass(c).removeAttr(c))},this),0)},c.prototype.toggle=function(){var a=!0,b=this.$element.closest('[data-toggle="buttons"]');if(b.length){var c=this.$element.find("input");"radio"==c.prop("type")&&(c.prop("checked")&&this.$element.hasClass("active")?a=!1:b.find(".active").removeClass("active")),a&&c.prop("checked",!this.$element.hasClass("active")).trigger("change")}else this.$element.attr("aria-pressed",!this.$element.hasClass("active"));a&&this.$element.toggleClass("active")};var d=a.fn.button;a.fn.button=b,a.fn.button.Constructor=c,a.fn.button.noConflict=function(){return a.fn.button=d,this},a(document).on("click.bs.button.data-api",'[data-toggle^="button"]',function(c){var d=a(c.target);d.hasClass("btn")||(d=d.closest(".btn")),b.call(d,"toggle"),c.preventDefault()}).on("focus.bs.button.data-api blur.bs.button.data-api",'[data-toggle^="button"]',function(b){a(b.target).closest(".btn").toggleClass("focus",/^focus(in)?$/.test(b.type))})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.carousel"),f=a.extend({},c.DEFAULTS,d.data(),"object"==typeof b&&b),g="string"==typeof b?b:f.slide;e||d.data("bs.carousel",e=new c(this,f)),"number"==typeof b?e.to(b):g?e[g]():f.interval&&e.pause().cycle()})}var c=function(b,c){this.$element=a(b),this.$indicators=this.$element.find(".carousel-indicators"),this.options=c,this.paused=this.sliding=this.interval=this.$active=this.$items=null,this.options.keyboard&&this.$element.on("keydown.bs.carousel",a.proxy(this.keydown,this)),"hover"==this.options.pause&&!("ontouchstart"in document.documentElement)&&this.$element.on("mouseenter.bs.carousel",a.proxy(this.pause,this)).on("mouseleave.bs.carousel",a.proxy(this.cycle,this))};c.VERSION="3.3.1",c.TRANSITION_DURATION=600,c.DEFAULTS={interval:5e3,pause:"hover",wrap:!0,keyboard:!0},c.prototype.keydown=function(a){if(!/input|textarea/i.test(a.target.tagName)){switch(a.which){case 37:this.prev();break;case 39:this.next();break;default:return}a.preventDefault()}},c.prototype.cycle=function(b){return b||(this.paused=!1),this.interval&&clearInterval(this.interval),this.options.interval&&!this.paused&&(this.interval=setInterval(a.proxy(this.next,this),this.options.interval)),this},c.prototype.getItemIndex=function(a){return this.$items=a.parent().children(".item"),this.$items.index(a||this.$active)},c.prototype.getItemForDirection=function(a,b){var c="prev"==a?-1:1,d=this.getItemIndex(b),e=(d+c)%this.$items.length;return this.$items.eq(e)},c.prototype.to=function(a){var b=this,c=this.getItemIndex(this.$active=this.$element.find(".item.active"));return a>this.$items.length-1||0>a?void 0:this.sliding?this.$element.one("slid.bs.carousel",function(){b.to(a)}):c==a?this.pause().cycle():this.slide(a>c?"next":"prev",this.$items.eq(a))},c.prototype.pause=function(b){return b||(this.paused=!0),this.$element.find(".next, .prev").length&&a.support.transition&&(this.$element.trigger(a.support.transition.end),this.cycle(!0)),this.interval=clearInterval(this.interval),this},c.prototype.next=function(){return this.sliding?void 0:this.slide("next")},c.prototype.prev=function(){return this.sliding?void 0:this.slide("prev")},c.prototype.slide=function(b,d){var e=this.$element.find(".item.active"),f=d||this.getItemForDirection(b,e),g=this.interval,h="next"==b?"left":"right",i="next"==b?"first":"last",j=this;if(!f.length){if(!this.options.wrap)return;f=this.$element.find(".item")[i]()}if(f.hasClass("active"))return this.sliding=!1;var k=f[0],l=a.Event("slide.bs.carousel",{relatedTarget:k,direction:h});if(this.$element.trigger(l),!l.isDefaultPrevented()){if(this.sliding=!0,g&&this.pause(),this.$indicators.length){this.$indicators.find(".active").removeClass("active");var m=a(this.$indicators.children()[this.getItemIndex(f)]);m&&m.addClass("active")}var n=a.Event("slid.bs.carousel",{relatedTarget:k,direction:h});return a.support.transition&&this.$element.hasClass("slide")?(f.addClass(b),f[0].offsetWidth,e.addClass(h),f.addClass(h),e.one("bsTransitionEnd",function(){f.removeClass([b,h].join(" ")).addClass("active"),e.removeClass(["active",h].join(" ")),j.sliding=!1,setTimeout(function(){j.$element.trigger(n)},0)}).emulateTransitionEnd(c.TRANSITION_DURATION)):(e.removeClass("active"),f.addClass("active"),this.sliding=!1,this.$element.trigger(n)),g&&this.cycle(),this}};var d=a.fn.carousel;a.fn.carousel=b,a.fn.carousel.Constructor=c,a.fn.carousel.noConflict=function(){return a.fn.carousel=d,this};var e=function(c){var d,e=a(this),f=a(e.attr("data-target")||(d=e.attr("href"))&&d.replace(/.*(?=#[^\s]+$)/,""));if(f.hasClass("carousel")){var g=a.extend({},f.data(),e.data()),h=e.attr("data-slide-to");h&&(g.interval=!1),b.call(f,g),h&&f.data("bs.carousel").to(h),c.preventDefault()}};a(document).on("click.bs.carousel.data-api","[data-slide]",e).on("click.bs.carousel.data-api","[data-slide-to]",e),a(window).on("load",function(){a('[data-ride="carousel"]').each(function(){var c=a(this);b.call(c,c.data())})})}(jQuery),+function(a){function b(b){var c,d=b.attr("data-target")||(c=b.attr("href"))&&c.replace(/.*(?=#[^\s]+$)/,"");return a(d)}function c(b){return this.each(function(){var c=a(this),e=c.data("bs.collapse"),f=a.extend({},d.DEFAULTS,c.data(),"object"==typeof b&&b);!e&&f.toggle&&"show"==b&&(f.toggle=!1),e||c.data("bs.collapse",e=new d(this,f)),"string"==typeof b&&e[b]()})}var d=function(b,c){this.$element=a(b),this.options=a.extend({},d.DEFAULTS,c),this.$trigger=a(this.options.trigger).filter('[href="#'+b.id+'"], [data-target="#'+b.id+'"]'),this.transitioning=null,this.options.parent?this.$parent=this.getParent():this.addAriaAndCollapsedClass(this.$element,this.$trigger),this.options.toggle&&this.toggle()};d.VERSION="3.3.1",d.TRANSITION_DURATION=350,d.DEFAULTS={toggle:!0,trigger:'[data-toggle="collapse"]'},d.prototype.dimension=function(){var a=this.$element.hasClass("width");return a?"width":"height"},d.prototype.show=function(){if(!this.transitioning&&!this.$element.hasClass("in")){var b,e=this.$parent&&this.$parent.find("> .panel").children(".in, .collapsing");if(!(e&&e.length&&(b=e.data("bs.collapse"),b&&b.transitioning))){var f=a.Event("show.bs.collapse");if(this.$element.trigger(f),!f.isDefaultPrevented()){e&&e.length&&(c.call(e,"hide"),b||e.data("bs.collapse",null));var g=this.dimension();this.$element.removeClass("collapse").addClass("collapsing")[g](0).attr("aria-expanded",!0),this.$trigger.removeClass("collapsed").attr("aria-expanded",!0),this.transitioning=1;var h=function(){this.$element.removeClass("collapsing").addClass("collapse in")[g](""),this.transitioning=0,this.$element.trigger("shown.bs.collapse")};if(!a.support.transition)return h.call(this);var i=a.camelCase(["scroll",g].join("-"));this.$element.one("bsTransitionEnd",a.proxy(h,this)).emulateTransitionEnd(d.TRANSITION_DURATION)[g](this.$element[0][i])}}}},d.prototype.hide=function(){if(!this.transitioning&&this.$element.hasClass("in")){var b=a.Event("hide.bs.collapse");if(this.$element.trigger(b),!b.isDefaultPrevented()){var c=this.dimension();this.$element[c](this.$element[c]())[0].offsetHeight,this.$element.addClass("collapsing").removeClass("collapse in").attr("aria-expanded",!1),this.$trigger.addClass("collapsed").attr("aria-expanded",!1),this.transitioning=1;var e=function(){this.transitioning=0,this.$element.removeClass("collapsing").addClass("collapse").trigger("hidden.bs.collapse")};return a.support.transition?void this.$element[c](0).one("bsTransitionEnd",a.proxy(e,this)).emulateTransitionEnd(d.TRANSITION_DURATION):e.call(this)}}},d.prototype.toggle=function(){this[this.$element.hasClass("in")?"hide":"show"]()},d.prototype.getParent=function(){return a(this.options.parent).find('[data-toggle="collapse"][data-parent="'+this.options.parent+'"]').each(a.proxy(function(c,d){var e=a(d);this.addAriaAndCollapsedClass(b(e),e)},this)).end()},d.prototype.addAriaAndCollapsedClass=function(a,b){var c=a.hasClass("in");a.attr("aria-expanded",c),b.toggleClass("collapsed",!c).attr("aria-expanded",c)};var e=a.fn.collapse;a.fn.collapse=c,a.fn.collapse.Constructor=d,a.fn.collapse.noConflict=function(){return a.fn.collapse=e,this},a(document).on("click.bs.collapse.data-api",'[data-toggle="collapse"]',function(d){var e=a(this);e.attr("data-target")||d.preventDefault();var f=b(e),g=f.data("bs.collapse"),h=g?"toggle":a.extend({},e.data(),{trigger:this});c.call(f,h)})}(jQuery),+function(a){function b(b){b&&3===b.which||(a(e).remove(),a(f).each(function(){var d=a(this),e=c(d),f={relatedTarget:this};e.hasClass("open")&&(e.trigger(b=a.Event("hide.bs.dropdown",f)),b.isDefaultPrevented()||(d.attr("aria-expanded","false"),e.removeClass("open").trigger("hidden.bs.dropdown",f)))}))}function c(b){var c=b.attr("data-target");c||(c=b.attr("href"),c=c&&/#[A-Za-z]/.test(c)&&c.replace(/.*(?=#[^\s]*$)/,""));var d=c&&a(c);return d&&d.length?d:b.parent()}function d(b){return this.each(function(){var c=a(this),d=c.data("bs.dropdown");d||c.data("bs.dropdown",d=new g(this)),"string"==typeof b&&d[b].call(c)})}var e=".dropdown-backdrop",f='[data-toggle="dropdown"]',g=function(b){a(b).on("click.bs.dropdown",this.toggle)};g.VERSION="3.3.1",g.prototype.toggle=function(d){var e=a(this);if(!e.is(".disabled, :disabled")){var f=c(e),g=f.hasClass("open");if(b(),!g){"ontouchstart"in document.documentElement&&!f.closest(".navbar-nav").length&&a('<div class="dropdown-backdrop"/>').insertAfter(a(this)).on("click",b);var h={relatedTarget:this};if(f.trigger(d=a.Event("show.bs.dropdown",h)),d.isDefaultPrevented())return;e.trigger("focus").attr("aria-expanded","true"),f.toggleClass("open").trigger("shown.bs.dropdown",h)}return!1}},g.prototype.keydown=function(b){if(/(38|40|27|32)/.test(b.which)&&!/input|textarea/i.test(b.target.tagName)){var d=a(this);if(b.preventDefault(),b.stopPropagation(),!d.is(".disabled, :disabled")){var e=c(d),g=e.hasClass("open");if(!g&&27!=b.which||g&&27==b.which)return 27==b.which&&e.find(f).trigger("focus"),d.trigger("click");var h=" li:not(.divider):visible a",i=e.find('[role="menu"]'+h+', [role="listbox"]'+h);if(i.length){var j=i.index(b.target);38==b.which&&j>0&&j--,40==b.which&&j<i.length-1&&j++,~j||(j=0),i.eq(j).trigger("focus")}}}};var h=a.fn.dropdown;a.fn.dropdown=d,a.fn.dropdown.Constructor=g,a.fn.dropdown.noConflict=function(){return a.fn.dropdown=h,this},a(document).on("click.bs.dropdown.data-api",b).on("click.bs.dropdown.data-api",".dropdown form",function(a){a.stopPropagation()}).on("click.bs.dropdown.data-api",f,g.prototype.toggle).on("keydown.bs.dropdown.data-api",f,g.prototype.keydown).on("keydown.bs.dropdown.data-api",'[role="menu"]',g.prototype.keydown).on("keydown.bs.dropdown.data-api",'[role="listbox"]',g.prototype.keydown)}(jQuery),+function(a){function b(b,d){return this.each(function(){var e=a(this),f=e.data("bs.modal"),g=a.extend({},c.DEFAULTS,e.data(),"object"==typeof b&&b);f||e.data("bs.modal",f=new c(this,g)),"string"==typeof b?f[b](d):g.show&&f.show(d)})}var c=function(b,c){this.options=c,this.$body=a(document.body),this.$element=a(b),this.$backdrop=this.isShown=null,this.scrollbarWidth=0,this.options.remote&&this.$element.find(".modal-content").load(this.options.remote,a.proxy(function(){this.$element.trigger("loaded.bs.modal")},this))};c.VERSION="3.3.1",c.TRANSITION_DURATION=300,c.BACKDROP_TRANSITION_DURATION=150,c.DEFAULTS={backdrop:!0,keyboard:!0,show:!0},c.prototype.toggle=function(a){return this.isShown?this.hide():this.show(a)},c.prototype.show=function(b){var d=this,e=a.Event("show.bs.modal",{relatedTarget:b});this.$element.trigger(e),this.isShown||e.isDefaultPrevented()||(this.isShown=!0,this.checkScrollbar(),this.setScrollbar(),this.$body.addClass("modal-open"),this.escape(),this.resize(),this.$element.on("click.dismiss.bs.modal",'[data-dismiss="modal"]',a.proxy(this.hide,this)),this.backdrop(function(){var e=a.support.transition&&d.$element.hasClass("fade");d.$element.parent().length||d.$element.appendTo(d.$body),d.$element.show().scrollTop(0),d.options.backdrop&&d.adjustBackdrop(),d.adjustDialog(),e&&d.$element[0].offsetWidth,d.$element.addClass("in").attr("aria-hidden",!1),d.enforceFocus();var f=a.Event("shown.bs.modal",{relatedTarget:b});e?d.$element.find(".modal-dialog").one("bsTransitionEnd",function(){d.$element.trigger("focus").trigger(f)}).emulateTransitionEnd(c.TRANSITION_DURATION):d.$element.trigger("focus").trigger(f)}))},c.prototype.hide=function(b){b&&b.preventDefault(),b=a.Event("hide.bs.modal"),this.$element.trigger(b),this.isShown&&!b.isDefaultPrevented()&&(this.isShown=!1,this.escape(),this.resize(),a(document).off("focusin.bs.modal"),this.$element.removeClass("in").attr("aria-hidden",!0).off("click.dismiss.bs.modal"),a.support.transition&&this.$element.hasClass("fade")?this.$element.one("bsTransitionEnd",a.proxy(this.hideModal,this)).emulateTransitionEnd(c.TRANSITION_DURATION):this.hideModal())},c.prototype.enforceFocus=function(){a(document).off("focusin.bs.modal").on("focusin.bs.modal",a.proxy(function(a){this.$element[0]===a.target||this.$element.has(a.target).length||this.$element.trigger("focus")},this))},c.prototype.escape=function(){this.isShown&&this.options.keyboard?this.$element.on("keydown.dismiss.bs.modal",a.proxy(function(a){27==a.which&&this.hide()},this)):this.isShown||this.$element.off("keydown.dismiss.bs.modal")},c.prototype.resize=function(){this.isShown?a(window).on("resize.bs.modal",a.proxy(this.handleUpdate,this)):a(window).off("resize.bs.modal")},c.prototype.hideModal=function(){var a=this;this.$element.hide(),this.backdrop(function(){a.$body.removeClass("modal-open"),a.resetAdjustments(),a.resetScrollbar(),a.$element.trigger("hidden.bs.modal")})},c.prototype.removeBackdrop=function(){this.$backdrop&&this.$backdrop.remove(),this.$backdrop=null},c.prototype.backdrop=function(b){var d=this,e=this.$element.hasClass("fade")?"fade":"";if(this.isShown&&this.options.backdrop){var f=a.support.transition&&e;if(this.$backdrop=a('<div class="modal-backdrop '+e+'" />').prependTo(this.$element).on("click.dismiss.bs.modal",a.proxy(function(a){a.target===a.currentTarget&&("static"==this.options.backdrop?this.$element[0].focus.call(this.$element[0]):this.hide.call(this))},this)),f&&this.$backdrop[0].offsetWidth,this.$backdrop.addClass("in"),!b)return;f?this.$backdrop.one("bsTransitionEnd",b).emulateTransitionEnd(c.BACKDROP_TRANSITION_DURATION):b()}else if(!this.isShown&&this.$backdrop){this.$backdrop.removeClass("in");var g=function(){d.removeBackdrop(),b&&b()};a.support.transition&&this.$element.hasClass("fade")?this.$backdrop.one("bsTransitionEnd",g).emulateTransitionEnd(c.BACKDROP_TRANSITION_DURATION):g()}else b&&b()},c.prototype.handleUpdate=function(){this.options.backdrop&&this.adjustBackdrop(),this.adjustDialog()},c.prototype.adjustBackdrop=function(){this.$backdrop.css("height",0).css("height",this.$element[0].scrollHeight)},c.prototype.adjustDialog=function(){var a=this.$element[0].scrollHeight>document.documentElement.clientHeight;this.$element.css({paddingLeft:!this.bodyIsOverflowing&&a?this.scrollbarWidth:"",paddingRight:this.bodyIsOverflowing&&!a?this.scrollbarWidth:""})},c.prototype.resetAdjustments=function(){this.$element.css({paddingLeft:"",paddingRight:""})},c.prototype.checkScrollbar=function(){this.bodyIsOverflowing=document.body.scrollHeight>document.documentElement.clientHeight,this.scrollbarWidth=this.measureScrollbar()},c.prototype.setScrollbar=function(){var a=parseInt(this.$body.css("padding-right")||0,10);this.bodyIsOverflowing&&this.$body.css("padding-right",a+this.scrollbarWidth)},c.prototype.resetScrollbar=function(){this.$body.css("padding-right","")},c.prototype.measureScrollbar=function(){var a=document.createElement("div");a.className="modal-scrollbar-measure",this.$body.append(a);var b=a.offsetWidth-a.clientWidth;return this.$body[0].removeChild(a),b};var d=a.fn.modal;a.fn.modal=b,a.fn.modal.Constructor=c,a.fn.modal.noConflict=function(){return a.fn.modal=d,this},a(document).on("click.bs.modal.data-api",'[data-toggle="modal"]',function(c){var d=a(this),e=d.attr("href"),f=a(d.attr("data-target")||e&&e.replace(/.*(?=#[^\s]+$)/,"")),g=f.data("bs.modal")?"toggle":a.extend({remote:!/#/.test(e)&&e},f.data(),d.data());d.is("a")&&c.preventDefault(),f.one("show.bs.modal",function(a){a.isDefaultPrevented()||f.one("hidden.bs.modal",function(){d.is(":visible")&&d.trigger("focus")})}),b.call(f,g,this)})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.tooltip"),f="object"==typeof b&&b,g=f&&f.selector;(e||"destroy"!=b)&&(g?(e||d.data("bs.tooltip",e={}),e[g]||(e[g]=new c(this,f))):e||d.data("bs.tooltip",e=new c(this,f)),"string"==typeof b&&e[b]())})}var c=function(a,b){this.type=this.options=this.enabled=this.timeout=this.hoverState=this.$element=null,this.init("tooltip",a,b)};c.VERSION="3.3.1",c.TRANSITION_DURATION=150,c.DEFAULTS={animation:!0,placement:"top",selector:!1,template:'<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',trigger:"hover focus",title:"",delay:0,html:!1,container:!1,viewport:{selector:"body",padding:0}},c.prototype.init=function(b,c,d){this.enabled=!0,this.type=b,this.$element=a(c),this.options=this.getOptions(d),this.$viewport=this.options.viewport&&a(this.options.viewport.selector||this.options.viewport);for(var e=this.options.trigger.split(" "),f=e.length;f--;){var g=e[f];if("click"==g)this.$element.on("click."+this.type,this.options.selector,a.proxy(this.toggle,this));else if("manual"!=g){var h="hover"==g?"mouseenter":"focusin",i="hover"==g?"mouseleave":"focusout";this.$element.on(h+"."+this.type,this.options.selector,a.proxy(this.enter,this)),this.$element.on(i+"."+this.type,this.options.selector,a.proxy(this.leave,this))}}this.options.selector?this._options=a.extend({},this.options,{trigger:"manual",selector:""}):this.fixTitle()},c.prototype.getDefaults=function(){return c.DEFAULTS},c.prototype.getOptions=function(b){return b=a.extend({},this.getDefaults(),this.$element.data(),b),b.delay&&"number"==typeof b.delay&&(b.delay={show:b.delay,hide:b.delay}),b},c.prototype.getDelegateOptions=function(){var b={},c=this.getDefaults();return this._options&&a.each(this._options,function(a,d){c[a]!=d&&(b[a]=d)}),b},c.prototype.enter=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget).data("bs."+this.type);return c&&c.$tip&&c.$tip.is(":visible")?void(c.hoverState="in"):(c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c)),clearTimeout(c.timeout),c.hoverState="in",c.options.delay&&c.options.delay.show?void(c.timeout=setTimeout(function(){"in"==c.hoverState&&c.show()},c.options.delay.show)):c.show())},c.prototype.leave=function(b){var c=b instanceof this.constructor?b:a(b.currentTarget).data("bs."+this.type);return c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c)),clearTimeout(c.timeout),c.hoverState="out",c.options.delay&&c.options.delay.hide?void(c.timeout=setTimeout(function(){"out"==c.hoverState&&c.hide()},c.options.delay.hide)):c.hide()},c.prototype.show=function(){var b=a.Event("show.bs."+this.type);if(this.hasContent()&&this.enabled){this.$element.trigger(b);var d=a.contains(this.$element[0].ownerDocument.documentElement,this.$element[0]);if(b.isDefaultPrevented()||!d)return;var e=this,f=this.tip(),g=this.getUID(this.type);this.setContent(),f.attr("id",g),this.$element.attr("aria-describedby",g),this.options.animation&&f.addClass("fade");var h="function"==typeof this.options.placement?this.options.placement.call(this,f[0],this.$element[0]):this.options.placement,i=/\s?auto?\s?/i,j=i.test(h);j&&(h=h.replace(i,"")||"top"),f.detach().css({top:0,left:0,display:"block"}).addClass(h).data("bs."+this.type,this),this.options.container?f.appendTo(this.options.container):f.insertAfter(this.$element);var k=this.getPosition(),l=f[0].offsetWidth,m=f[0].offsetHeight;if(j){var n=h,o=this.options.container?a(this.options.container):this.$element.parent(),p=this.getPosition(o);h="bottom"==h&&k.bottom+m>p.bottom?"top":"top"==h&&k.top-m<p.top?"bottom":"right"==h&&k.right+l>p.width?"left":"left"==h&&k.left-l<p.left?"right":h,f.removeClass(n).addClass(h)}var q=this.getCalculatedOffset(h,k,l,m);this.applyPlacement(q,h);var r=function(){var a=e.hoverState;e.$element.trigger("shown.bs."+e.type),e.hoverState=null,"out"==a&&e.leave(e)};a.support.transition&&this.$tip.hasClass("fade")?f.one("bsTransitionEnd",r).emulateTransitionEnd(c.TRANSITION_DURATION):r()}},c.prototype.applyPlacement=function(b,c){var d=this.tip(),e=d[0].offsetWidth,f=d[0].offsetHeight,g=parseInt(d.css("margin-top"),10),h=parseInt(d.css("margin-left"),10);isNaN(g)&&(g=0),isNaN(h)&&(h=0),b.top=b.top+g,b.left=b.left+h,a.offset.setOffset(d[0],a.extend({using:function(a){d.css({top:Math.round(a.top),left:Math.round(a.left)})}},b),0),d.addClass("in");var i=d[0].offsetWidth,j=d[0].offsetHeight;"top"==c&&j!=f&&(b.top=b.top+f-j);var k=this.getViewportAdjustedDelta(c,b,i,j);k.left?b.left+=k.left:b.top+=k.top;var l=/top|bottom/.test(c),m=l?2*k.left-e+i:2*k.top-f+j,n=l?"offsetWidth":"offsetHeight";d.offset(b),this.replaceArrow(m,d[0][n],l)},c.prototype.replaceArrow=function(a,b,c){this.arrow().css(c?"left":"top",50*(1-a/b)+"%").css(c?"top":"left","")},c.prototype.setContent=function(){var a=this.tip(),b=this.getTitle();a.find(".tooltip-inner")[this.options.html?"html":"text"](b),a.removeClass("fade in top bottom left right")},c.prototype.hide=function(b){function d(){"in"!=e.hoverState&&f.detach(),e.$element.removeAttr("aria-describedby").trigger("hidden.bs."+e.type),b&&b()}var e=this,f=this.tip(),g=a.Event("hide.bs."+this.type);return this.$element.trigger(g),g.isDefaultPrevented()?void 0:(f.removeClass("in"),a.support.transition&&this.$tip.hasClass("fade")?f.one("bsTransitionEnd",d).emulateTransitionEnd(c.TRANSITION_DURATION):d(),this.hoverState=null,this)},c.prototype.fixTitle=function(){var a=this.$element;(a.attr("title")||"string"!=typeof a.attr("data-original-title"))&&a.attr("data-original-title",a.attr("title")||"").attr("title","")},c.prototype.hasContent=function(){return this.getTitle()},c.prototype.getPosition=function(b){b=b||this.$element;var c=b[0],d="BODY"==c.tagName,e=c.getBoundingClientRect();null==e.width&&(e=a.extend({},e,{width:e.right-e.left,height:e.bottom-e.top}));var f=d?{top:0,left:0}:b.offset(),g={scroll:d?document.documentElement.scrollTop||document.body.scrollTop:b.scrollTop()},h=d?{width:a(window).width(),height:a(window).height()}:null;return a.extend({},e,g,h,f)},c.prototype.getCalculatedOffset=function(a,b,c,d){return"bottom"==a?{top:b.top+b.height,left:b.left+b.width/2-c/2}:"top"==a?{top:b.top-d,left:b.left+b.width/2-c/2}:"left"==a?{top:b.top+b.height/2-d/2,left:b.left-c}:{top:b.top+b.height/2-d/2,left:b.left+b.width}},c.prototype.getViewportAdjustedDelta=function(a,b,c,d){var e={top:0,left:0};if(!this.$viewport)return e;var f=this.options.viewport&&this.options.viewport.padding||0,g=this.getPosition(this.$viewport);if(/right|left/.test(a)){var h=b.top-f-g.scroll,i=b.top+f-g.scroll+d;h<g.top?e.top=g.top-h:i>g.top+g.height&&(e.top=g.top+g.height-i)}else{var j=b.left-f,k=b.left+f+c;j<g.left?e.left=g.left-j:k>g.width&&(e.left=g.left+g.width-k)}return e},c.prototype.getTitle=function(){var a,b=this.$element,c=this.options;return a=b.attr("data-original-title")||("function"==typeof c.title?c.title.call(b[0]):c.title)},c.prototype.getUID=function(a){do a+=~~(1e6*Math.random());while(document.getElementById(a));return a},c.prototype.tip=function(){return this.$tip=this.$tip||a(this.options.template)},c.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".tooltip-arrow")},c.prototype.enable=function(){this.enabled=!0},c.prototype.disable=function(){this.enabled=!1},c.prototype.toggleEnabled=function(){this.enabled=!this.enabled},c.prototype.toggle=function(b){var c=this;b&&(c=a(b.currentTarget).data("bs."+this.type),c||(c=new this.constructor(b.currentTarget,this.getDelegateOptions()),a(b.currentTarget).data("bs."+this.type,c))),c.tip().hasClass("in")?c.leave(c):c.enter(c)},c.prototype.destroy=function(){var a=this;clearTimeout(this.timeout),this.hide(function(){a.$element.off("."+a.type).removeData("bs."+a.type)})};var d=a.fn.tooltip;a.fn.tooltip=b,a.fn.tooltip.Constructor=c,a.fn.tooltip.noConflict=function(){return a.fn.tooltip=d,this}}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.popover"),f="object"==typeof b&&b,g=f&&f.selector;(e||"destroy"!=b)&&(g?(e||d.data("bs.popover",e={}),e[g]||(e[g]=new c(this,f))):e||d.data("bs.popover",e=new c(this,f)),"string"==typeof b&&e[b]())})}var c=function(a,b){this.init("popover",a,b)};if(!a.fn.tooltip)throw new Error("Popover requires tooltip.js");c.VERSION="3.3.1",c.DEFAULTS=a.extend({},a.fn.tooltip.Constructor.DEFAULTS,{placement:"right",trigger:"click",content:"",template:'<div class="popover" role="tooltip"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'}),c.prototype=a.extend({},a.fn.tooltip.Constructor.prototype),c.prototype.constructor=c,c.prototype.getDefaults=function(){return c.DEFAULTS},c.prototype.setContent=function(){var a=this.tip(),b=this.getTitle(),c=this.getContent();a.find(".popover-title")[this.options.html?"html":"text"](b),a.find(".popover-content").children().detach().end()[this.options.html?"string"==typeof c?"html":"append":"text"](c),a.removeClass("fade top bottom left right in"),a.find(".popover-title").html()||a.find(".popover-title").hide()},c.prototype.hasContent=function(){return this.getTitle()||this.getContent()},c.prototype.getContent=function(){var a=this.$element,b=this.options;return a.attr("data-content")||("function"==typeof b.content?b.content.call(a[0]):b.content)},c.prototype.arrow=function(){return this.$arrow=this.$arrow||this.tip().find(".arrow")},c.prototype.tip=function(){return this.$tip||(this.$tip=a(this.options.template)),this.$tip};var d=a.fn.popover;a.fn.popover=b,a.fn.popover.Constructor=c,a.fn.popover.noConflict=function(){return a.fn.popover=d,this}}(jQuery),+function(a){function b(c,d){var e=a.proxy(this.process,this);this.$body=a("body"),this.$scrollElement=a(a(c).is("body")?window:c),this.options=a.extend({},b.DEFAULTS,d),this.selector=(this.options.target||"")+" .nav li > a",this.offsets=[],this.targets=[],this.activeTarget=null,this.scrollHeight=0,this.$scrollElement.on("scroll.bs.scrollspy",e),this.refresh(),this.process()}function c(c){return this.each(function(){var d=a(this),e=d.data("bs.scrollspy"),f="object"==typeof c&&c;e||d.data("bs.scrollspy",e=new b(this,f)),"string"==typeof c&&e[c]()})}b.VERSION="3.3.1",b.DEFAULTS={offset:10},b.prototype.getScrollHeight=function(){return this.$scrollElement[0].scrollHeight||Math.max(this.$body[0].scrollHeight,document.documentElement.scrollHeight)},b.prototype.refresh=function(){var b="offset",c=0;a.isWindow(this.$scrollElement[0])||(b="position",c=this.$scrollElement.scrollTop()),this.offsets=[],this.targets=[],this.scrollHeight=this.getScrollHeight();var d=this;this.$body.find(this.selector).map(function(){var d=a(this),e=d.data("target")||d.attr("href"),f=/^#./.test(e)&&a(e);return f&&f.length&&f.is(":visible")&&[[f[b]().top+c,e]]||null}).sort(function(a,b){return a[0]-b[0]}).each(function(){d.offsets.push(this[0]),d.targets.push(this[1])})},b.prototype.process=function(){var a,b=this.$scrollElement.scrollTop()+this.options.offset,c=this.getScrollHeight(),d=this.options.offset+c-this.$scrollElement.height(),e=this.offsets,f=this.targets,g=this.activeTarget;if(this.scrollHeight!=c&&this.refresh(),b>=d)return g!=(a=f[f.length-1])&&this.activate(a);if(g&&b<e[0])return this.activeTarget=null,this.clear();for(a=e.length;a--;)g!=f[a]&&b>=e[a]&&(!e[a+1]||b<=e[a+1])&&this.activate(f[a])},b.prototype.activate=function(b){this.activeTarget=b,this.clear();var c=this.selector+'[data-target="'+b+'"],'+this.selector+'[href="'+b+'"]',d=a(c).parents("li").addClass("active");d.parent(".dropdown-menu").length&&(d=d.closest("li.dropdown").addClass("active")),d.trigger("activate.bs.scrollspy")},b.prototype.clear=function(){a(this.selector).parentsUntil(this.options.target,".active").removeClass("active")};var d=a.fn.scrollspy;a.fn.scrollspy=c,a.fn.scrollspy.Constructor=b,a.fn.scrollspy.noConflict=function(){return a.fn.scrollspy=d,this},a(window).on("load.bs.scrollspy.data-api",function(){a('[data-spy="scroll"]').each(function(){var b=a(this);c.call(b,b.data())})})}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.tab");e||d.data("bs.tab",e=new c(this)),"string"==typeof b&&e[b]()})}var c=function(b){this.element=a(b)};c.VERSION="3.3.1",c.TRANSITION_DURATION=150,c.prototype.show=function(){var b=this.element,c=b.closest("ul:not(.dropdown-menu)"),d=b.data("target");if(d||(d=b.attr("href"),d=d&&d.replace(/.*(?=#[^\s]*$)/,"")),!b.parent("li").hasClass("active")){var e=c.find(".active:last a"),f=a.Event("hide.bs.tab",{relatedTarget:b[0]}),g=a.Event("show.bs.tab",{relatedTarget:e[0]});if(e.trigger(f),b.trigger(g),!g.isDefaultPrevented()&&!f.isDefaultPrevented()){var h=a(d);this.activate(b.closest("li"),c),this.activate(h,h.parent(),function(){e.trigger({type:"hidden.bs.tab",relatedTarget:b[0]}),b.trigger({type:"shown.bs.tab",relatedTarget:e[0]})
})}}},c.prototype.activate=function(b,d,e){function f(){g.removeClass("active").find("> .dropdown-menu > .active").removeClass("active").end().find('[data-toggle="tab"]').attr("aria-expanded",!1),b.addClass("active").find('[data-toggle="tab"]').attr("aria-expanded",!0),h?(b[0].offsetWidth,b.addClass("in")):b.removeClass("fade"),b.parent(".dropdown-menu")&&b.closest("li.dropdown").addClass("active").end().find('[data-toggle="tab"]').attr("aria-expanded",!0),e&&e()}var g=d.find("> .active"),h=e&&a.support.transition&&(g.length&&g.hasClass("fade")||!!d.find("> .fade").length);g.length&&h?g.one("bsTransitionEnd",f).emulateTransitionEnd(c.TRANSITION_DURATION):f(),g.removeClass("in")};var d=a.fn.tab;a.fn.tab=b,a.fn.tab.Constructor=c,a.fn.tab.noConflict=function(){return a.fn.tab=d,this};var e=function(c){c.preventDefault(),b.call(a(this),"show")};a(document).on("click.bs.tab.data-api",'[data-toggle="tab"]',e).on("click.bs.tab.data-api",'[data-toggle="pill"]',e)}(jQuery),+function(a){function b(b){return this.each(function(){var d=a(this),e=d.data("bs.affix"),f="object"==typeof b&&b;e||d.data("bs.affix",e=new c(this,f)),"string"==typeof b&&e[b]()})}var c=function(b,d){this.options=a.extend({},c.DEFAULTS,d),this.$target=a(this.options.target).on("scroll.bs.affix.data-api",a.proxy(this.checkPosition,this)).on("click.bs.affix.data-api",a.proxy(this.checkPositionWithEventLoop,this)),this.$element=a(b),this.affixed=this.unpin=this.pinnedOffset=null,this.checkPosition()};c.VERSION="3.3.1",c.RESET="affix affix-top affix-bottom",c.DEFAULTS={offset:0,target:window},c.prototype.getState=function(a,b,c,d){var e=this.$target.scrollTop(),f=this.$element.offset(),g=this.$target.height();if(null!=c&&"top"==this.affixed)return c>e?"top":!1;if("bottom"==this.affixed)return null!=c?e+this.unpin<=f.top?!1:"bottom":a-d>=e+g?!1:"bottom";var h=null==this.affixed,i=h?e:f.top,j=h?g:b;return null!=c&&c>=i?"top":null!=d&&i+j>=a-d?"bottom":!1},c.prototype.getPinnedOffset=function(){if(this.pinnedOffset)return this.pinnedOffset;this.$element.removeClass(c.RESET).addClass("affix");var a=this.$target.scrollTop(),b=this.$element.offset();return this.pinnedOffset=b.top-a},c.prototype.checkPositionWithEventLoop=function(){setTimeout(a.proxy(this.checkPosition,this),1)},c.prototype.checkPosition=function(){if(this.$element.is(":visible")){var b=this.$element.height(),d=this.options.offset,e=d.top,f=d.bottom,g=a("body").height();"object"!=typeof d&&(f=e=d),"function"==typeof e&&(e=d.top(this.$element)),"function"==typeof f&&(f=d.bottom(this.$element));var h=this.getState(g,b,e,f);if(this.affixed!=h){null!=this.unpin&&this.$element.css("top","");var i="affix"+(h?"-"+h:""),j=a.Event(i+".bs.affix");if(this.$element.trigger(j),j.isDefaultPrevented())return;this.affixed=h,this.unpin="bottom"==h?this.getPinnedOffset():null,this.$element.removeClass(c.RESET).addClass(i).trigger(i.replace("affix","affixed")+".bs.affix")}"bottom"==h&&this.$element.offset({top:g-b-f})}};var d=a.fn.affix;a.fn.affix=b,a.fn.affix.Constructor=c,a.fn.affix.noConflict=function(){return a.fn.affix=d,this},a(window).on("load",function(){a('[data-spy="affix"]').each(function(){var c=a(this),d=c.data();d.offset=d.offset||{},null!=d.offsetBottom&&(d.offset.bottom=d.offsetBottom),null!=d.offsetTop&&(d.offset.top=d.offsetTop),b.call(c,d)})})}(jQuery);
define("bootstrap", ["jQuery"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.bootstrap;
    };
}(this)));

/*
 AngularJS v1.3.9
 (c) 2010-2014 Google, Inc. http://angularjs.org
 License: MIT
*/
(function(N,f,W){f.module("ngAnimate",["ng"]).directive("ngAnimateChildren",function(){return function(X,C,g){g=g.ngAnimateChildren;f.isString(g)&&0===g.length?C.data("$$ngAnimateChildren",!0):X.$watch(g,function(f){C.data("$$ngAnimateChildren",!!f)})}}).factory("$$animateReflow",["$$rAF","$document",function(f,C){return function(g){return f(function(){g()})}}]).config(["$provide","$animateProvider",function(X,C){function g(f){for(var n=0;n<f.length;n++){var g=f[n];if(1==g.nodeType)return g}}
function ba(f,n){return g(f)==g(n)}var t=f.noop,n=f.forEach,da=C.$$selectors,aa=f.isArray,ea=f.isString,ga=f.isObject,r={running:!0},u;X.decorator("$animate",["$delegate","$$q","$injector","$sniffer","$rootElement","$$asyncCallback","$rootScope","$document","$templateRequest","$$jqLite",function(O,N,M,Y,y,H,P,W,Z,Q){function R(a,c){var b=a.data("$$ngAnimateState")||{};c&&(b.running=!0,b.structural=!0,a.data("$$ngAnimateState",b));return b.disabled||b.running&&b.structural}function D(a){var c,b=N.defer();
b.promise.$$cancelFn=function(){c&&c()};P.$$postDigest(function(){c=a(function(){b.resolve()})});return b.promise}function I(a){if(ga(a))return a.tempClasses&&ea(a.tempClasses)&&(a.tempClasses=a.tempClasses.split(/\s+/)),a}function S(a,c,b){b=b||{};var d={};n(b,function(e,a){n(a.split(" "),function(a){d[a]=e})});var h=Object.create(null);n((a.attr("class")||"").split(/\s+/),function(e){h[e]=!0});var f=[],l=[];n(c&&c.classes||[],function(e,a){var b=h[a],c=d[a]||{};!1===e?(b||"addClass"==c.event)&&
l.push(a):!0===e&&(b&&"removeClass"!=c.event||f.push(a))});return 0<f.length+l.length&&[f.join(" "),l.join(" ")]}function T(a){if(a){var c=[],b={};a=a.substr(1).split(".");(Y.transitions||Y.animations)&&c.push(M.get(da[""]));for(var d=0;d<a.length;d++){var f=a[d],k=da[f];k&&!b[f]&&(c.push(M.get(k)),b[f]=!0)}return c}}function U(a,c,b,d){function h(e,a){var b=e[a],c=e["before"+a.charAt(0).toUpperCase()+a.substr(1)];if(b||c)return"leave"==a&&(c=b,b=null),u.push({event:a,fn:b}),J.push({event:a,fn:c}),
!0}function k(c,l,w){var E=[];n(c,function(a){a.fn&&E.push(a)});var m=0;n(E,function(c,f){var p=function(){a:{if(l){(l[f]||t)();if(++m<E.length)break a;l=null}w()}};switch(c.event){case "setClass":l.push(c.fn(a,e,A,p,d));break;case "animate":l.push(c.fn(a,b,d.from,d.to,p));break;case "addClass":l.push(c.fn(a,e||b,p,d));break;case "removeClass":l.push(c.fn(a,A||b,p,d));break;default:l.push(c.fn(a,p,d))}});l&&0===l.length&&w()}var l=a[0];if(l){d&&(d.to=d.to||{},d.from=d.from||{});var e,A;aa(b)&&(e=
b[0],A=b[1],e?A?b=e+" "+A:(b=e,c="addClass"):(b=A,c="removeClass"));var w="setClass"==c,E=w||"addClass"==c||"removeClass"==c||"animate"==c,p=a.attr("class")+" "+b;if(x(p)){var ca=t,m=[],J=[],g=t,s=[],u=[],p=(" "+p).replace(/\s+/g,".");n(T(p),function(a){!h(a,c)&&w&&(h(a,"addClass"),h(a,"removeClass"))});return{node:l,event:c,className:b,isClassBased:E,isSetClassOperation:w,applyStyles:function(){d&&a.css(f.extend(d.from||{},d.to||{}))},before:function(a){ca=a;k(J,m,function(){ca=t;a()})},after:function(a){g=
a;k(u,s,function(){g=t;a()})},cancel:function(){m&&(n(m,function(a){(a||t)(!0)}),ca(!0));s&&(n(s,function(a){(a||t)(!0)}),g(!0))}}}}}function G(a,c,b,d,h,k,l,e){function A(e){var l="$animate:"+e;J&&J[l]&&0<J[l].length&&H(function(){b.triggerHandler(l,{event:a,className:c})})}function w(){A("before")}function E(){A("after")}function p(){p.hasBeenRun||(p.hasBeenRun=!0,k())}function g(){if(!g.hasBeenRun){m&&m.applyStyles();g.hasBeenRun=!0;l&&l.tempClasses&&n(l.tempClasses,function(a){u.removeClass(b,
a)});var w=b.data("$$ngAnimateState");w&&(m&&m.isClassBased?B(b,c):(H(function(){var e=b.data("$$ngAnimateState")||{};fa==e.index&&B(b,c,a)}),b.data("$$ngAnimateState",w)));A("close");e()}}var m=U(b,a,c,l);if(!m)return p(),w(),E(),g(),t;a=m.event;c=m.className;var J=f.element._data(m.node),J=J&&J.events;d||(d=h?h.parent():b.parent());if(z(b,d))return p(),w(),E(),g(),t;d=b.data("$$ngAnimateState")||{};var L=d.active||{},s=d.totalActive||0,q=d.last;h=!1;if(0<s){s=[];if(m.isClassBased)"setClass"==q.event?
(s.push(q),B(b,c)):L[c]&&(v=L[c],v.event==a?h=!0:(s.push(v),B(b,c)));else if("leave"==a&&L["ng-leave"])h=!0;else{for(var v in L)s.push(L[v]);d={};B(b,!0)}0<s.length&&n(s,function(a){a.cancel()})}!m.isClassBased||m.isSetClassOperation||"animate"==a||h||(h="addClass"==a==b.hasClass(c));if(h)return p(),w(),E(),A("close"),e(),t;L=d.active||{};s=d.totalActive||0;if("leave"==a)b.one("$destroy",function(a){a=f.element(this);var e=a.data("$$ngAnimateState");e&&(e=e.active["ng-leave"])&&(e.cancel(),B(a,"ng-leave"))});
u.addClass(b,"ng-animate");l&&l.tempClasses&&n(l.tempClasses,function(a){u.addClass(b,a)});var fa=K++;s++;L[c]=m;b.data("$$ngAnimateState",{last:m,active:L,index:fa,totalActive:s});w();m.before(function(e){var l=b.data("$$ngAnimateState");e=e||!l||!l.active[c]||m.isClassBased&&l.active[c].event!=a;p();!0===e?g():(E(),m.after(g))});return m.cancel}function q(a){if(a=g(a))a=f.isFunction(a.getElementsByClassName)?a.getElementsByClassName("ng-animate"):a.querySelectorAll(".ng-animate"),n(a,function(a){a=
f.element(a);(a=a.data("$$ngAnimateState"))&&a.active&&n(a.active,function(a){a.cancel()})})}function B(a,c){if(ba(a,y))r.disabled||(r.running=!1,r.structural=!1);else if(c){var b=a.data("$$ngAnimateState")||{},d=!0===c;!d&&b.active&&b.active[c]&&(b.totalActive--,delete b.active[c]);if(d||!b.totalActive)u.removeClass(a,"ng-animate"),a.removeData("$$ngAnimateState")}}function z(a,c){if(r.disabled)return!0;if(ba(a,y))return r.running;var b,d,g;do{if(0===c.length)break;var k=ba(c,y),l=k?r:c.data("$$ngAnimateState")||
{};if(l.disabled)return!0;k&&(g=!0);!1!==b&&(k=c.data("$$ngAnimateChildren"),f.isDefined(k)&&(b=k));d=d||l.running||l.last&&!l.last.isClassBased}while(c=c.parent());return!g||!b&&d}u=Q;y.data("$$ngAnimateState",r);var $=P.$watch(function(){return Z.totalPendingRequests},function(a,c){0===a&&($(),P.$$postDigest(function(){P.$$postDigest(function(){r.running=!1})}))}),K=0,V=C.classNameFilter(),x=V?function(a){return V.test(a)}:function(){return!0};return{animate:function(a,c,b,d,h){d=d||"ng-inline-animate";
h=I(h)||{};h.from=b?c:null;h.to=b?b:c;return D(function(b){return G("animate",d,f.element(g(a)),null,null,t,h,b)})},enter:function(a,c,b,d){d=I(d);a=f.element(a);c=c&&f.element(c);b=b&&f.element(b);R(a,!0);O.enter(a,c,b);return D(function(h){return G("enter","ng-enter",f.element(g(a)),c,b,t,d,h)})},leave:function(a,c){c=I(c);a=f.element(a);q(a);R(a,!0);return D(function(b){return G("leave","ng-leave",f.element(g(a)),null,null,function(){O.leave(a)},c,b)})},move:function(a,c,b,d){d=I(d);a=f.element(a);
c=c&&f.element(c);b=b&&f.element(b);q(a);R(a,!0);O.move(a,c,b);return D(function(h){return G("move","ng-move",f.element(g(a)),c,b,t,d,h)})},addClass:function(a,c,b){return this.setClass(a,c,[],b)},removeClass:function(a,c,b){return this.setClass(a,[],c,b)},setClass:function(a,c,b,d){d=I(d);a=f.element(a);a=f.element(g(a));if(R(a))return O.$$setClassImmediately(a,c,b,d);var h,k=a.data("$$animateClasses"),l=!!k;k||(k={classes:{}});h=k.classes;c=aa(c)?c:c.split(" ");n(c,function(a){a&&a.length&&(h[a]=
!0)});b=aa(b)?b:b.split(" ");n(b,function(a){a&&a.length&&(h[a]=!1)});if(l)return d&&k.options&&(k.options=f.extend(k.options||{},d)),k.promise;a.data("$$animateClasses",k={classes:h,options:d});return k.promise=D(function(e){var l=a.parent(),b=g(a),c=b.parentNode;if(!c||c.$$NG_REMOVED||b.$$NG_REMOVED)e();else{b=a.data("$$animateClasses");a.removeData("$$animateClasses");var c=a.data("$$ngAnimateState")||{},d=S(a,b,c.active);return d?G("setClass",d,a,l,null,function(){d[0]&&O.$$addClassImmediately(a,
d[0]);d[1]&&O.$$removeClassImmediately(a,d[1])},b.options,e):e()}})},cancel:function(a){a.$$cancelFn()},enabled:function(a,c){switch(arguments.length){case 2:if(a)B(c);else{var b=c.data("$$ngAnimateState")||{};b.disabled=!0;c.data("$$ngAnimateState",b)}break;case 1:r.disabled=!a;break;default:a=!r.disabled}return!!a}}}]);C.register("",["$window","$sniffer","$timeout","$$animateReflow",function(r,C,M,Y){function y(){b||(b=Y(function(){c=[];b=null;x={}}))}function H(a,e){b&&b();c.push(e);b=Y(function(){n(c,
function(a){a()});c=[];b=null;x={}})}function P(a,e){var b=g(a);a=f.element(b);k.push(a);b=Date.now()+e;b<=h||(M.cancel(d),h=b,d=M(function(){X(k);k=[]},e,!1))}function X(a){n(a,function(a){(a=a.data("$$ngAnimateCSS3Data"))&&n(a.closeAnimationFns,function(a){a()})})}function Z(a,e){var b=e?x[e]:null;if(!b){var c=0,d=0,f=0,g=0;n(a,function(a){if(1==a.nodeType){a=r.getComputedStyle(a)||{};c=Math.max(Q(a[z+"Duration"]),c);d=Math.max(Q(a[z+"Delay"]),d);g=Math.max(Q(a[K+"Delay"]),g);var e=Q(a[K+"Duration"]);
0<e&&(e*=parseInt(a[K+"IterationCount"],10)||1);f=Math.max(e,f)}});b={total:0,transitionDelay:d,transitionDuration:c,animationDelay:g,animationDuration:f};e&&(x[e]=b)}return b}function Q(a){var e=0;a=ea(a)?a.split(/\s*,\s*/):[];n(a,function(a){e=Math.max(parseFloat(a)||0,e)});return e}function R(b,e,c,d){b=0<=["ng-enter","ng-leave","ng-move"].indexOf(c);var f,p=e.parent(),h=p.data("$$ngAnimateKey");h||(p.data("$$ngAnimateKey",++a),h=a);f=h+"-"+g(e).getAttribute("class");var p=f+" "+c,h=x[p]?++x[p].total:
0,m={};if(0<h){var n=c+"-stagger",m=f+" "+n;(f=!x[m])&&u.addClass(e,n);m=Z(e,m);f&&u.removeClass(e,n)}u.addClass(e,c);var n=e.data("$$ngAnimateCSS3Data")||{},k=Z(e,p);f=k.transitionDuration;k=k.animationDuration;if(b&&0===f&&0===k)return u.removeClass(e,c),!1;c=d||b&&0<f;b=0<k&&0<m.animationDelay&&0===m.animationDuration;e.data("$$ngAnimateCSS3Data",{stagger:m,cacheKey:p,running:n.running||0,itemIndex:h,blockTransition:c,closeAnimationFns:n.closeAnimationFns||[]});p=g(e);c&&(I(p,!0),d&&e.css(d));
b&&(p.style[K+"PlayState"]="paused");return!0}function D(a,e,b,c,d){function f(){e.off(D,h);u.removeClass(e,k);u.removeClass(e,t);z&&M.cancel(z);G(e,b);var a=g(e),c;for(c in s)a.style.removeProperty(s[c])}function h(a){a.stopPropagation();var b=a.originalEvent||a;a=b.$manualTimeStamp||b.timeStamp||Date.now();b=parseFloat(b.elapsedTime.toFixed(3));Math.max(a-H,0)>=C&&b>=x&&c()}var m=g(e);a=e.data("$$ngAnimateCSS3Data");if(-1!=m.getAttribute("class").indexOf(b)&&a){var k="",t="";n(b.split(" "),function(a,
b){var e=(0<b?" ":"")+a;k+=e+"-active";t+=e+"-pending"});var s=[],q=a.itemIndex,v=a.stagger,r=0;if(0<q){r=0;0<v.transitionDelay&&0===v.transitionDuration&&(r=v.transitionDelay*q);var y=0;0<v.animationDelay&&0===v.animationDuration&&(y=v.animationDelay*q,s.push(B+"animation-play-state"));r=Math.round(100*Math.max(r,y))/100}r||(u.addClass(e,k),a.blockTransition&&I(m,!1));var F=Z(e,a.cacheKey+" "+k),x=Math.max(F.transitionDuration,F.animationDuration);if(0===x)u.removeClass(e,k),G(e,b),c();else{!r&&
d&&(F.transitionDuration||(e.css("transition",F.animationDuration+"s linear all"),s.push("transition")),e.css(d));var q=Math.max(F.transitionDelay,F.animationDelay),C=1E3*q;0<s.length&&(v=m.getAttribute("style")||"",";"!==v.charAt(v.length-1)&&(v+=";"),m.setAttribute("style",v+" "));var H=Date.now(),D=V+" "+$,q=1E3*(r+1.5*(q+x)),z;0<r&&(u.addClass(e,t),z=M(function(){z=null;0<F.transitionDuration&&I(m,!1);0<F.animationDuration&&(m.style[K+"PlayState"]="");u.addClass(e,k);u.removeClass(e,t);d&&(0===
F.transitionDuration&&e.css("transition",F.animationDuration+"s linear all"),e.css(d),s.push("transition"))},1E3*r,!1));e.on(D,h);a.closeAnimationFns.push(function(){f();c()});a.running++;P(e,q);return f}}else c()}function I(a,b){a.style[z+"Property"]=b?"none":""}function S(a,b,c,d){if(R(a,b,c,d))return function(a){a&&G(b,c)}}function T(a,b,c,d,f){if(b.data("$$ngAnimateCSS3Data"))return D(a,b,c,d,f);G(b,c);d()}function U(a,b,c,d,f){var g=S(a,b,c,f.from);if(g){var h=g;H(b,function(){h=T(a,b,c,d,f.to)});
return function(a){(h||t)(a)}}y();d()}function G(a,b){u.removeClass(a,b);var c=a.data("$$ngAnimateCSS3Data");c&&(c.running&&c.running--,c.running&&0!==c.running||a.removeData("$$ngAnimateCSS3Data"))}function q(a,b){var c="";a=aa(a)?a:a.split(/\s+/);n(a,function(a,d){a&&0<a.length&&(c+=(0<d?" ":"")+a+b)});return c}var B="",z,$,K,V;N.ontransitionend===W&&N.onwebkittransitionend!==W?(B="-webkit-",z="WebkitTransition",$="webkitTransitionEnd transitionend"):(z="transition",$="transitionend");N.onanimationend===
W&&N.onwebkitanimationend!==W?(B="-webkit-",K="WebkitAnimation",V="webkitAnimationEnd animationend"):(K="animation",V="animationend");var x={},a=0,c=[],b,d=null,h=0,k=[];return{animate:function(a,b,c,d,f,g){g=g||{};g.from=c;g.to=d;return U("animate",a,b,f,g)},enter:function(a,b,c){c=c||{};return U("enter",a,"ng-enter",b,c)},leave:function(a,b,c){c=c||{};return U("leave",a,"ng-leave",b,c)},move:function(a,b,c){c=c||{};return U("move",a,"ng-move",b,c)},beforeSetClass:function(a,b,c,d,f){f=f||{};b=q(c,
"-remove")+" "+q(b,"-add");if(f=S("setClass",a,b,f.from))return H(a,d),f;y();d()},beforeAddClass:function(a,b,c,d){d=d||{};if(b=S("addClass",a,q(b,"-add"),d.from))return H(a,c),b;y();c()},beforeRemoveClass:function(a,b,c,d){d=d||{};if(b=S("removeClass",a,q(b,"-remove"),d.from))return H(a,c),b;y();c()},setClass:function(a,b,c,d,f){f=f||{};c=q(c,"-remove");b=q(b,"-add");return T("setClass",a,c+" "+b,d,f.to)},addClass:function(a,b,c,d){d=d||{};return T("addClass",a,q(b,"-add"),c,d.to)},removeClass:function(a,
b,c,d){d=d||{};return T("removeClass",a,q(b,"-remove"),c,d.to)}}}])}])})(window,window.angular);
//# sourceMappingURL=angular-animate.min.js.map
;
define("angular-animate", ["angular"], function(){});

(function () {
    


    define('app',[
        'angular',
        'home/home-ctrl',
        'login/login-ctrl',
        'about/about-module',
        'services/login-service',
        'common/vis/graph.directive',
        'common/jmpress/cube.directive',
        'bootstrap',
        'jmpress',
        'angular-ui-router',
        'angular-animate'
    ], function (angular, HomeController, LoginCtrl, aboutModule, loginService, graphDirective, cube) {

        var app = angular.module('myApp', ['ui.router', 'ngAnimate', aboutModule.moduleName]);
        app.init = function () {
            angular.bootstrap(document, ['myApp']);
        };

        app.service("LoginService", loginService);
        app.directive('graphDirective', graphDirective);
        app.directive('impressCube', cube);
        app.controller("HomeCtrl", HomeController);
        app.controller("LoginCtrl", LoginCtrl);


        app.config(function ($stateProvider, $urlRouterProvider, $locationProvider) {
            $urlRouterProvider.otherwise('about');
            $urlRouterProvider.when("", '/');

            $locationProvider
                .hashPrefix('!');

            $stateProvider
                .state('home', {
                    url: "/",
                    controller: "HomeCtrl",
                    templateUrl: "app/home/home.html"
                });
        });


        return app;
    });
}());
/**
 *
 */
require.config({
    baseUrl: "app",
    //ceva
    paths: {
        'angular': '../static/vendor/angular/angular.min',
        'angular-ui-router': '../static/vendor/angular-ui-router/release/angular-ui-router.min',
        'angular-animate': '../static/vendor/angular-animate/angular-animate.min',

        /* external non angular dependencies*/


        'jQuery': '../static/vendor/jquery/dist/jquery.min',
        'bootstrap': '../static/vendor/bootstrap/dist/js/bootstrap.min',
        'jmpress': '../static/vendor/jmpress/jmpress',
        'underscore': '../static/vendor/underscore/underscore-min',
        'vis': '../static/vendor/vis/dist/vis.min'
    },
    shim: {
        'angular-ui-router': {
            deps: ['angular']
        },
        angular: {
            exports: 'angular'
        },
        'angular-animate': {
            deps: ['angular']
        },

        /* jQuery & BooStrap*/
        jQuery: {
            exports: 'jQuery'
        },
        bootstrap: {
            deps: ['jQuery'],
            exports: 'bootstrap'
        },
        jmpress: {
            deps: ['jQuery', 'underscore'],
            exports: 'jmpress'
        }
    }
});

require(['app'], function (app) {
    app.init();
});
define("main", function(){});

