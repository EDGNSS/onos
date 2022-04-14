"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ast_tools_1 = require("../ast_tools");
/**
 * A patternEngine is the logic that handles a specific PatternKind.
 */
class PatternEngine {
    constructor(config, fixer) {
        this.config = config;
        this.fixer = fixer;
        this.whitelistedPrefixes = [];
        this.whitelistedRegExps = [];
        this.whitelistMemoizer = new Map();
        if (config.whitelistEntries) {
            for (const e of config.whitelistEntries) {
                if (e.prefix) {
                    this.whitelistedPrefixes =
                        this.whitelistedPrefixes.concat(...e.prefix);
                }
                if (e.regexp) {
                    this.whitelistedRegExps = this.whitelistedRegExps.concat(...e.regexp.map(r => new RegExp(r)));
                }
            }
        }
    }
    /**
     * A wrapper for `check` that handles aspects of the analysis that are not
     * engine-specific, and which defers to the subclass-specific logic
     * afterwards.
     */
    checkAndFilterResults(c, n) {
        if (!ast_tools_1.shouldExamineNode(n) || n.getSourceFile().isDeclarationFile) {
            return;
        }
        const matchedNode = this.check(c.typeChecker, n);
        if (matchedNode && !this.isWhitelisted(matchedNode)) {
            const fix = this.fixer ? this.fixer.getFixForFlaggedNode(matchedNode) : undefined;
            c.addFailureAtNode(matchedNode, this.config.errorMessage, fix);
        }
    }
    isWhitelisted(n) {
        const name = n.getSourceFile().fileName;
        if (this.whitelistMemoizer.has(name)) {
            return this.whitelistMemoizer.get(name);
        }
        for (const p of this.whitelistedPrefixes) {
            if (name.indexOf(p) == 0) {
                this.whitelistMemoizer.set(name, true);
                return true;
            }
        }
        for (const re of this.whitelistedRegExps) {
            if (re.test(name)) {
                this.whitelistMemoizer.set(name, true);
                return true;
            }
        }
        this.whitelistMemoizer.set(name, false);
        return false;
    }
}
exports.PatternEngine = PatternEngine;
