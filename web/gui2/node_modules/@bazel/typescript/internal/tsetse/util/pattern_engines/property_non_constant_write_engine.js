"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../../error_code");
const ast_tools_1 = require("../ast_tools");
const is_literal_1 = require("../is_literal");
const match_symbol_1 = require("../match_symbol");
const pattern_engine_1 = require("./pattern_engine");
/**
 * The engine for BANNED_PROPERTY_NON_CONSTANT_WRITE.
 */
class PropertyNonConstantWriteEngine extends pattern_engine_1.PatternEngine {
    constructor(config, fixer) {
        super(config, fixer);
        // TODO: Support more than one single value here, or even build a
        // multi-pattern engine. This would help for performance.
        if (this.config.values.length !== 1) {
            throw new Error(`BANNED_PROPERTY_NON_CONSTANT_WRITE expects one value, got(${this.config.values.join(',')})`);
        }
        this.matcher = match_symbol_1.PropertyMatcher.fromSpec(this.config.values[0]);
    }
    register(checker) {
        checker.on(ts.SyntaxKind.BinaryExpression, this.checkAndFilterResults.bind(this), error_code_1.ErrorCode.CONFORMANCE_PATTERN);
    }
    check(tc, n) {
        if (!ast_tools_1.isPropertyWriteExpression(n)) {
            return;
        }
        ast_tools_1.debugLog(`inspecting ${n.getFullText().trim()}`);
        if (!this.matcher.matches(n.left, tc)) {
            ast_tools_1.debugLog('Not an assignment to the right property');
            return;
        }
        if (is_literal_1.isLiteral(tc, n.right)) {
            ast_tools_1.debugLog(`Assigned value (${n.right.getFullText()}) is a compile-time constant.`);
            return;
        }
        return n;
    }
}
exports.PropertyNonConstantWriteEngine = PropertyNonConstantWriteEngine;
