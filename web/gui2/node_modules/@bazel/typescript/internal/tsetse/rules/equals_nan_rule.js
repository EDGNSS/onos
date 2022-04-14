"use strict";
/**
 * @fileoverview Bans `== NaN`, `=== NaN`, `!= NaN`, and `!== NaN` in TypeScript
 * code, since no value (including NaN) is equal to NaN.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../error_code");
const rule_1 = require("../rule");
class Rule extends rule_1.AbstractRule {
    constructor() {
        super(...arguments);
        this.ruleName = 'equals-nan';
        this.code = error_code_1.ErrorCode.EQUALS_NAN;
    }
    register(checker) {
        checker.on(ts.SyntaxKind.BinaryExpression, checkBinaryExpression, this.code);
    }
}
exports.Rule = Rule;
function checkBinaryExpression(checker, node) {
    const isLeftNaN = ts.isIdentifier(node.left) && node.left.text === 'NaN';
    const isRightNaN = ts.isIdentifier(node.right) && node.right.text === 'NaN';
    if (!isLeftNaN && !isRightNaN) {
        return;
    }
    // We avoid calling getText() on the node.operatorToken because it's slow.
    // Instead, manually map back from the kind to the string form of the operator
    switch (node.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsToken:
            checker.addFailureAtNode(node, `x == NaN is always false; use isNaN(x) instead`);
            break;
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
            checker.addFailureAtNode(node, `x === NaN is always false; use isNaN(x) instead`);
            break;
        case ts.SyntaxKind.ExclamationEqualsToken:
            checker.addFailureAtNode(node, `x != NaN is always true; use !isNaN(x) instead`);
            break;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            checker.addFailureAtNode(node, `x !== NaN is always true; use !isNaN(x) instead`);
            break;
        default:
            // We don't care about other operators acting on NaN
            break;
    }
}
