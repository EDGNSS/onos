"use strict";
/**
 * @fileoverview Bans `new Set(<string>)` since it is a potential source of bugs
 * due to strings also implementing `Iterable<string>`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../error_code");
const rule_1 = require("../rule");
const errorMsg = 'Value passed to Set constructor is a string. This will' +
    ' create a Set of the characters of the string, rather than a Set' +
    ' containing the string. To make a Set of the string, pass an array' +
    ' containing the string. To make a Set of the characters, use \'as\' to ' +
    ' create an Iterable<string>, eg: new Set(myStr as Iterable<string>).';
class Rule extends rule_1.AbstractRule {
    constructor() {
        super(...arguments);
        this.ruleName = 'ban-string-initialized-sets';
        this.code = error_code_1.ErrorCode.BAN_STRING_INITIALIZED_SETS;
    }
    register(checker) {
        checker.on(ts.SyntaxKind.NewExpression, checkNewExpression, this.code);
    }
}
exports.Rule = Rule;
function checkNewExpression(checker, node) {
    const typeChecker = checker.typeChecker;
    // Check that it's a Set which is being constructed
    const ctorTypeSymbol = typeChecker.getTypeAtLocation(node.expression).getSymbol();
    if (!ctorTypeSymbol || ctorTypeSymbol.getEscapedName() !== 'SetConstructor') {
        return;
    }
    const isES2015SetCtor = ctorTypeSymbol.declarations.some((decl) => {
        return sourceFileIsStdLib(decl.getSourceFile());
    });
    if (!isES2015SetCtor)
        return;
    // If there's no arguments provided, then it's not a string so bail out.
    if (!node.arguments || node.arguments.length !== 1)
        return;
    // Check the type of the first argument, expanding union & intersection types
    const arg = node.arguments[0];
    const argType = typeChecker.getTypeAtLocation(arg);
    const allTypes = argType.isUnionOrIntersection() ? argType.types : [argType];
    // Checks if the type (or any of the union/intersection types) are either
    // strings or string literals.
    const typeContainsString = allTypes.some((tsType) => {
        return (tsType.getFlags() & ts.TypeFlags.StringLike) !== 0;
    });
    if (!typeContainsString)
        return;
    checker.addFailureAtNode(arg, errorMsg);
}
function sourceFileIsStdLib(sourceFile) {
    return /lib\.es2015\.(collection|iterable)\.d\.ts$/.test(sourceFile.fileName);
}
