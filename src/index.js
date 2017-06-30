import moduleToCdn from 'module-to-cdn';
import {sync as readPkg} from 'read-pkg';
import HtmlWebpackIncludeAssetsPlugin from 'html-webpack-include-assets-plugin';
import ExternalModule from 'webpack/lib/ExternalModule';
import resolvePkg from 'resolve-pkg';

let HtmlWebpackPlugin;
try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    HtmlWebpackPlugin = require('html-webpack-plugin');
} catch (err) {
    HtmlWebpackPlugin = null;
}

export default class ModulesCdnWebpackPlugin {
    constructor({disable = false, env} = {}) {
        this.disable = disable;
        this.env = env || process.env.NODE_ENV || 'development';
        this.urls = {};
    }

    apply(compiler) {
        if (!this.disable) {
            this.execute(compiler, {env: this.env});
        }

        const isUsingHtmlWebpackPlugin = HtmlWebpackPlugin != null && compiler.options.plugins.some(x => x instanceof HtmlWebpackPlugin);

        if (isUsingHtmlWebpackPlugin) {
            this.applyHtmlWebpackPlugin(compiler);
        } else {
            this.applyWebpackCore(compiler);
        }
    }

    execute(compiler, {env}) {
        compiler.plugin('normal-module-factory', nmf => {
            nmf.plugin('factory', factory => (data, cb) => {
                const modulePath = data.dependencies[0].request;
                const contextPath = data.context;

                const varName = this.addModule(contextPath, modulePath, {env});

                if (varName === false) {
                    return factory(data, cb);
                }

                cb(null, new ExternalModule(varName));
            });
        });
    }

    addModule(contextPath, modulePath, {env}) {
        const {version, peerDependencies} = readPkg(resolvePkg(modulePath, {cwd: contextPath}));

        const cdnConfig = moduleToCdn(modulePath, version, {env});

        if (cdnConfig == null) {
            return false;
        }

        if (peerDependencies) {
            for (const peerDependencyName in peerDependencies) {
                if ({}.hasOwnProperty.call(peerDependencies, peerDependencyName)) {
                    this.addModule(contextPath, peerDependencyName, {env});
                }
            }
        }

        this.urls[cdnConfig.name] = cdnConfig.url;

        return cdnConfig.var;
    }

    applyWebpackCore(compiler) {
        compiler.plugin('after-compile', (compilation, cb) => {
            const entrypoint = compilation.entrypoints[Object.keys(compilation.entrypoints)[0]];
            const parentChunk = entrypoint.chunks.find(x => x.isInitial());

            for (const name of Object.keys(this.urls)) {
                const url = this.urls[name];

                const chunk = compilation.addChunk(name);
                chunk.files.push(url);

                chunk.parents = [parentChunk];
                parentChunk.addChunk(chunk);
                entrypoint.insertChunk(chunk, parentChunk);
            }

            cb();
        });
    }

    applyHtmlWebpackPlugin(compiler) {
        const includeAssetsPlugin = new HtmlWebpackIncludeAssetsPlugin({
            assets: [],
            publicPath: '',
            append: false
        });

        includeAssetsPlugin.apply(compiler);

        compiler.plugin('after-compile', (compilation, cb) => {
            const assets = Object.values(this.urls);

            // HACK: Calling the constructor directly is not recomended
            //       But that's the only secure way to edit `assets` afterhand
            includeAssetsPlugin.constructor({
                assets,
                publicPath: '',
                append: false
            });

            cb();
        });
    }
}
