"use strict";
/**
 * @fileoverview A Tsetse rule that checks that all promises in async function
 * blocks are awaited or used.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const tsutils = require("tsutils");
const ts = require("typescript");
const error_code_1 = require("../error_code");
const rule_1 = require("../rule");
const FAILURE_STRING = 'All Promises in async functions must either be awaited or used in an expression.' +
    '\n\tSee http://tsetse.info/must-use-promises';
class Rule extends rule_1.AbstractRule {
    constructor() {
        super(...arguments);
        this.ruleName = 'must-use-promises';
        this.code = error_code_1.ErrorCode.MUST_USE_PROMISES;
    }
    register(checker) {
        checker.on(ts.SyntaxKind.CallExpression, checkCallExpression, this.code);
    }
}
exports.Rule = Rule;
function checkCallExpression(checker, node) {
    // Short-circuit before using the typechecker if possible, as its expensive.
    // Workaround for https://github.com/Microsoft/TypeScript/issues/27997
    if (tsutils.isExpressionValueUsed(node) || !inAsyncFunction(node)) {
        return;
    }
    if (tsutils.isThenableType(checker.typeChecker, node)) {
        checker.addFailureAtNode(node, FAILURE_STRING);
    }
}
function inAsyncFunction(node) {
    for (let inode = node.parent; inode !== undefined; inode = inode.parent) {
        switch (inode.kind) {
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.MethodDeclaration:
                // Potentially async
                return tsutils.hasModifier(inode.modifiers, ts.SyntaxKind.AsyncKeyword);
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
                // These cannot be async
                return false;
            default:
                // Loop and check parent
                break;
        }
    }
    return false;
}
