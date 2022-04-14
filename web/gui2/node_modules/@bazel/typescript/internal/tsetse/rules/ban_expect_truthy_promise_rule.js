"use strict";
/**
 * @fileoverview Bans expect(returnsPromise()).toBeTruthy(). Promises are always
 * truthy, and this pattern is likely to be a bug where the developer meant
 * expect(await returnsPromise()).toBeTruthy() and forgot the await.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const tsutils = require("tsutils");
const ts = require("typescript");
const error_code_1 = require("../error_code");
const rule_1 = require("../rule");
class Rule extends rule_1.AbstractRule {
    constructor() {
        super(...arguments);
        this.ruleName = 'ban-expect-truthy-promise';
        this.code = error_code_1.ErrorCode.BAN_EXPECT_TRUTHY_PROMISE;
    }
    register(checker) {
        checker.on(ts.SyntaxKind.PropertyAccessExpression, checkForTruthy, this.code);
    }
}
exports.Rule = Rule;
function checkForTruthy(checker, node) {
    if (node.name.text !== 'toBeTruthy') {
        return;
    }
    const expectCallNode = getLeftmostNode(node);
    if (!ts.isCallExpression(expectCallNode)) {
        return;
    }
    if (!ts.isIdentifier(expectCallNode.expression) || expectCallNode.expression.text !== 'expect') {
        return;
    }
    if (expectCallNode.arguments.length === 0 || ts.isAwaitExpression(expectCallNode.arguments[0])) {
        return;
    }
    const tc = checker.typeChecker;
    const signature = tc.getResolvedSignature(expectCallNode);
    if (signature === undefined) {
        return;
    }
    const symbol = tc.getReturnTypeOfSignature(signature).getSymbol();
    if (symbol === undefined) {
        return;
    }
    // Only look for methods named expect that return a Matchers
    if (symbol.name !== 'Matchers') {
        return;
    }
    const argType = tc.getTypeAtLocation(expectCallNode.arguments[0]);
    if (!tsutils.isThenableType(tc, expectCallNode.arguments[0], argType)) {
        return;
    }
    checker.addFailureAtNode(node, `Value passed to expect() is of type ${tc.typeToString(argType)}, which` +
        ` is thenable. Promises are always truthy. Either use toBe(true) or` +
        ` await the value.` +
        `\n\tSee http://tsetse.info/ban-expect-truthy-promise`);
}
function getLeftmostNode(node) {
    let current = node;
    while (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
    }
    return current;
}
