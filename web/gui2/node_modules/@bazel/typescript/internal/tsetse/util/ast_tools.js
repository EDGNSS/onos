"use strict";
/**
 * @fileoverview This is a collection of smaller utility functions to operate on
 * a TypeScript AST, used by JSConformance rules and elsewhere.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
/**
 * Triggers increased verbosity in the rules.
 */
let DEBUG = false;
/**
 * Turns on or off logging for ConformancePatternRules.
 */
function setDebug(state) {
    DEBUG = state;
}
exports.setDebug = setDebug;
/**
 * Debug helper.
 */
function debugLog(msg) {
    if (DEBUG)
        console.log(msg);
}
exports.debugLog = debugLog;
/**
 * Returns `n`'s parents in order.
 */
function parents(n) {
    const p = [];
    while (n.parent) {
        n = n.parent;
        p.push(n);
    }
    return p;
}
exports.parents = parents;
/**
 * Searches for something satisfying the given test in `n` or its children.
 */
function findInChildren(n, test) {
    let toExplore = [n];
    let cur;
    while (cur = toExplore.pop()) {
        if (test(cur)) {
            return true;
        }
        // Recurse
        toExplore = toExplore.concat(cur.getChildren());
    }
    return false;
}
exports.findInChildren = findInChildren;
/**
 * Returns true if the pattern-based Rule should look at that node and consider
 * warning there. The goal is to make it easy to exclude on source files,
 * blocks, module declarations, JSDoc, lib.d.ts nodes, that kind of things.
 */
function shouldExamineNode(n) {
    return !(ts.isBlock(n) || ts.isModuleBlock(n) || ts.isModuleDeclaration(n) ||
        ts.isSourceFile(n) || (n.parent && ts.isTypeNode(n.parent)) ||
        ts.isJSDoc(n) || isInStockLibraries(n));
}
exports.shouldExamineNode = shouldExamineNode;
/**
 * Return whether the given declaration is ambient.
 */
function isAmbientDeclaration(d) {
    return Boolean(d.modifiers &&
        d.modifiers.some(m => m.kind === ts.SyntaxKind.DeclareKeyword));
}
exports.isAmbientDeclaration = isAmbientDeclaration;
/**
 * Return whether the given Node is (or is in) a library included as default.
 * We currently look for a node_modules/typescript/ prefix, but this could
 * be expanded if needed.
 */
function isInStockLibraries(n) {
    const sourceFile = ts.isSourceFile(n) ? n : n.getSourceFile();
    if (sourceFile) {
        return sourceFile.fileName.indexOf('node_modules/typescript/') !== -1;
    }
    else {
        // the node is nowhere? Consider it as part of the core libs: we can't do
        // anything with it anyways, and it was likely included as default.
        return true;
    }
}
exports.isInStockLibraries = isInStockLibraries;
/**
 * Turns the given Symbol into its non-aliased version (which could be itself).
 * Returns undefined if given an undefined Symbol (so you can call
 * `dealias(typeChecker.getSymbolAtLocation(node))`).
 */
function dealias(symbol, tc) {
    if (!symbol) {
        return undefined;
    }
    if (symbol.getFlags() & ts.SymbolFlags.Alias) {
        // Note: something that has only TypeAlias is not acceptable here.
        return dealias(tc.getAliasedSymbol(symbol), tc);
    }
    return symbol;
}
exports.dealias = dealias;
/**
 * Returns whether `n`'s parents are something indicating a type.
 */
function isPartOfTypeDeclaration(n) {
    return [n, ...parents(n)].some(p => p.kind === ts.SyntaxKind.TypeReference ||
        p.kind === ts.SyntaxKind.TypeLiteral);
}
exports.isPartOfTypeDeclaration = isPartOfTypeDeclaration;
/**
 * Returns whether `n` is under an import statement.
 */
function isPartOfImportStatement(n) {
    return [n, ...parents(n)].some(p => p.kind === ts.SyntaxKind.ImportDeclaration);
}
exports.isPartOfImportStatement = isPartOfImportStatement;
/**
 * Returns whether `n` is a declaration.
 */
function isDeclaration(n) {
    return ts.isVariableDeclaration(n) || ts.isClassDeclaration(n) ||
        ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ||
        ts.isPropertyDeclaration(n) || ts.isVariableDeclarationList(n) ||
        ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) ||
        ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n) ||
        ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n) ||
        ts.isExportDeclaration(n) || ts.isMissingDeclaration(n);
}
exports.isDeclaration = isDeclaration;
/** Type guard for expressions that looks like property writes. */
function isPropertyWriteExpression(node) {
    if (!ts.isBinaryExpression(node)) {
        return false;
    }
    if (node.operatorToken.getText().trim() !== '=') {
        return false;
    }
    if (!ts.isPropertyAccessExpression(node.left) ||
        node.left.expression.getFullText().trim() === '') {
        return false;
    }
    // TODO: Destructuring assigments aren't covered. This would be a potential
    // bypass, but I doubt we'd catch bugs, so fixing it seems low priority
    // overall.
    return true;
}
exports.isPropertyWriteExpression = isPropertyWriteExpression;
/**
 * If verbose, logs the given error that happened while walking n, with a
 * stacktrace.
 */
function logASTWalkError(verbose, n, e) {
    let nodeText = `[error getting name for ${JSON.stringify(n)}]`;
    try {
        nodeText = '"' + n.getFullText().trim() + '"';
    }
    catch (_a) {
    }
    debugLog(`Walking node ${nodeText} failed with error ${e}.\n` +
        `Stacktrace:\n${e.stack}`);
}
exports.logASTWalkError = logASTWalkError;
