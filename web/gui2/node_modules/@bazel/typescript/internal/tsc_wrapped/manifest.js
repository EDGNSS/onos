"use strict";
/**
 * @fileoverview utilities to construct a static graph representation of the
 * import graph discovered in typescript inputs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Recursively walk the import graph provided by tsickle, populating entries
 * in the result map such that if foo imports bar, foo will appear before bar
 * in the map.
 */
function topologicalSort(result, current, modulesManifest, visiting) {
    const referencedModules = modulesManifest.getReferencedModules(current);
    if (!referencedModules)
        return; // not in the local set of sources.
    for (const referencedModule of referencedModules) {
        const referencedFileName = modulesManifest.getFileNameFromModule(referencedModule);
        if (!referencedFileName)
            continue; // Ambient modules.
        if (!result[referencedFileName]) {
            if (visiting[referencedFileName]) {
                const path = [current, ...Object.keys(visiting)].join(' ->\n');
                throw new Error(`\n\nCyclical dependency between files:\n${path}\n`);
            }
            visiting[referencedFileName] = true;
            topologicalSort(result, referencedFileName, modulesManifest, visiting);
            delete visiting[referencedFileName];
        }
    }
    result[current] = true;
}
/**
 * Create the contents of the .es5.MF file which propagates partial ordering of
 * the import graph to later actions.
 * Each line in the resulting text corresponds with a workspace-relative file
 * path, and the lines are ordered to match the expected load order in a
 * browser.
 */
function constructManifest(modulesManifest, host) {
    const result = {};
    for (const file of modulesManifest.fileNames) {
        topologicalSort(result, file, modulesManifest, {});
    }
    // NB: The object literal maintains insertion order.
    return Object.keys(result).map(fn => host.relativeOutputPath(fn)).join('\n') +
        '\n';
}
exports.constructManifest = constructManifest;
