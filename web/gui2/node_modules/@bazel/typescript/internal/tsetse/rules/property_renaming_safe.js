"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../error_code");
const rule_1 = require("../rule");
/**
 * A Tsetse rule that checks for some potential unsafe property renaming
 * patterns.
 *
 * Note: This rule can have false positives.
 */
class Rule extends rule_1.AbstractRule {
    constructor() {
        super(...arguments);
        this.ruleName = 'property-renaming-safe';
        this.code = error_code_1.ErrorCode.PROPERTY_RENAMING_SAFE;
    }
    register(checker) {
        checker.on(ts.SyntaxKind.PropertyAccessExpression, checkIndexSignAccessedWithPropAccess, this.code);
    }
}
exports.Rule = Rule;
// Copied from tsickle/src/quoting_transformer.ts, with the intention of
// removing it from there and only keeping a tsetse rule about this.
function checkIndexSignAccessedWithPropAccess(checker, pae) {
    // Reject dotted accesses to types that have an index type declared to quoted
    // accesses, to avoid Closure renaming one access but not the other. This can
    // happen because TS allows dotted access to string index types.
    const typeChecker = checker.typeChecker;
    const t = typeChecker.getTypeAtLocation(pae.expression);
    if (!t.getStringIndexType())
        return;
    // Types can have string index signatures and declared properties (of the
    // matching type). These properties have a symbol, as opposed to pure string
    // index types.
    const propSym = typeChecker.getSymbolAtLocation(pae.name);
    // The decision to return below is a judgement call. Presumably, in most
    // situations, dotted access to a property is correct, and should not be
    // turned into quoted access even if there is a string index on the type.
    // However it is possible to construct programs where this is incorrect, e.g.
    // where user code assigns into a property through the index access in another
    // location.
    if (propSym)
        return;
    checker.addFailureAtNode(pae.name, `Property ${pae.name.text} is not declared on Type ` +
        `${typeChecker.typeToString(t)}. The type has a string index ` +
        `signature, but it is being accessed using a dotted property ` +
        `access.
See http://tsetse.info/property-renaming-safe.`);
}
