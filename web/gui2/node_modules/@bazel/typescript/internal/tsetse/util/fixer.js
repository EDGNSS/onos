"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const ast_tools_1 = require("./ast_tools");
/**
 * A simple Fixer builder based on a function that looks at a node, and
 * output either nothing, or a replacement. If this is too limiting, implement
 * Fixer instead.
 */
function buildReplacementFixer(potentialReplacementGenerator) {
    return {
        getFixForFlaggedNode: (n) => {
            const partialFix = potentialReplacementGenerator(n);
            if (!partialFix) {
                return;
            }
            return {
                changes: [{
                        sourceFile: n.getSourceFile(),
                        start: n.getStart(),
                        end: n.getEnd(),
                        replacement: partialFix.replaceWith,
                    }],
            };
        }
    };
}
exports.buildReplacementFixer = buildReplacementFixer;
// TODO(rjamet): Both maybeAddNamedImport and maybeAddNamespacedImport are too
// hard to read to my taste. This could probably be improved upon by being more
// functionnal, to show the filter passes and get rid of the continues and
// returns (which are confusing).
/**
 * Builds an IndividualChange that imports the required symbol from the given
 * file under the given name. This might reimport the same thing twice in some
 * cases, but it will always make it available under the right name (though
 * its name might collide with other imports, as we don't currently check for
 * that).
 */
function maybeAddNamedImport(source, importWhat, fromFile, importAs, tazeComment) {
    const importStatements = source.statements.filter(ts.isImportDeclaration);
    const importSpecifier = importAs ? `${importWhat} as ${importAs}` : importWhat;
    for (const iDecl of importStatements) {
        const parsedDecl = maybeParseImportNode(iDecl);
        if (!parsedDecl || parsedDecl.fromFile !== fromFile) {
            // Not an import from the right file, or couldn't understand the import.
            continue; // Jump to the next import.
        }
        if (ts.isNamespaceImport(parsedDecl.namedBindings)) {
            ast_tools_1.debugLog(`... but it's a wildcard import`);
            continue; // Jump to the next import.
        }
        // Else, bindings is a NamedImports. We can now search whether the right
        // symbol is there under the right name.
        const foundRightImport = parsedDecl.namedBindings.elements.some(iSpec => iSpec.propertyName ?
            iSpec.name.getText() === importAs && // import {foo as bar}
                iSpec.propertyName.getText() === importWhat :
            iSpec.name.getText() === importWhat); // import {foo}
        if (foundRightImport) {
            ast_tools_1.debugLog(`"${iDecl.getFullText()}" imports ${importWhat} as we want.`);
            return; // Our request is already imported under the right name.
        }
        // Else, insert our symbol in the list of imports from that file.
        ast_tools_1.debugLog(`No named imports from that file, generating new fix`);
        return {
            start: parsedDecl.namedBindings.elements[0].getStart(),
            end: parsedDecl.namedBindings.elements[0].getStart(),
            sourceFile: source,
            replacement: `${importSpecifier}, `,
        };
    }
    // If we get here, we didn't find anything imported from the wanted file, so
    // we'll need the full import string. Add it after the last import,
    // and let clang-format handle the rest.
    const newImportStatement = `import {${importSpecifier}} from '${fromFile}';` +
        (tazeComment ? `  ${tazeComment}\n` : `\n`);
    const insertionPosition = importStatements.length ?
        importStatements[importStatements.length - 1].getEnd() + 1 :
        0;
    return {
        start: insertionPosition,
        end: insertionPosition,
        sourceFile: source,
        replacement: newImportStatement,
    };
}
exports.maybeAddNamedImport = maybeAddNamedImport;
/**
 * Builds an IndividualChange that imports the required namespace from the given
 * file under the given name. This might reimport the same thing twice in some
 * cases, but it will always make it available under the right name (though
 * its name might collide with other imports, as we don't currently check for
 * that).
 */
function maybeAddNamespaceImport(source, fromFile, importAs, tazeComment) {
    const importStatements = source.statements.filter(ts.isImportDeclaration);
    const hasTheRightImport = importStatements.some(iDecl => {
        const parsedDecl = maybeParseImportNode(iDecl);
        if (!parsedDecl || parsedDecl.fromFile !== fromFile) {
            // Not an import from the right file, or couldn't understand the import.
            return false;
        }
        ast_tools_1.debugLog(`"${iDecl.getFullText()}" is an import from the right file`);
        if (ts.isNamedImports(parsedDecl.namedBindings)) {
            ast_tools_1.debugLog(`... but it's a named import`);
            return false; // irrelevant to our namespace imports
        }
        // Else, bindings is a NamespaceImport.
        if (parsedDecl.namedBindings.name.getText() !== importAs) {
            ast_tools_1.debugLog(`... but not the right name, we need to reimport`);
            return false;
        }
        ast_tools_1.debugLog(`... and the right name, no need to reimport`);
        return true;
    });
    if (!hasTheRightImport) {
        const insertionPosition = importStatements.length ?
            importStatements[importStatements.length - 1].getEnd() + 1 :
            0;
        return {
            start: insertionPosition,
            end: insertionPosition,
            sourceFile: source,
            replacement: tazeComment ?
                `import * as ${importAs} from '${fromFile}';  ${tazeComment}\n` :
                `import * as ${importAs} from '${fromFile}';\n`,
        };
    }
    return;
}
exports.maybeAddNamespaceImport = maybeAddNamespaceImport;
/**
 * This tries to make sense of an ImportDeclaration, and returns the interesting
 * parts, undefined if the import declaration is valid but not understandable by
 * the checker.
 */
function maybeParseImportNode(iDecl) {
    if (!iDecl.importClause) {
        // something like import "./file";
        ast_tools_1.debugLog(`Ignoring import without imported symbol: ${iDecl.getFullText()}`);
        return;
    }
    if (iDecl.importClause.name || !iDecl.importClause.namedBindings) {
        // Seems to happen in defaults imports like import Foo from 'Bar'.
        // Not much we can do with that when trying to get a hold of some symbols,
        // so just ignore that line (worst case, we'll suggest another import
        // style).
        ast_tools_1.debugLog(`Ignoring import: ${iDecl.getFullText()}`);
        return;
    }
    if (!ts.isStringLiteral(iDecl.moduleSpecifier)) {
        ast_tools_1.debugLog(`Ignoring import whose module specifier is not literal`);
        return;
    }
    return {
        namedBindings: iDecl.importClause.namedBindings,
        fromFile: iDecl.moduleSpecifier.text
    };
}
