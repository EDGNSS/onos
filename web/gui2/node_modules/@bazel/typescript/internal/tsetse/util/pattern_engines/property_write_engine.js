"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../../error_code");
const ast_tools_1 = require("../ast_tools");
const match_symbol_1 = require("../match_symbol");
const pattern_engine_1 = require("../pattern_engines/pattern_engine");
/**
 * The engine for BANNED_PROPERTY_WRITE.
 */
class PropertyWriteEngine extends pattern_engine_1.PatternEngine {
    constructor(config, fixer) {
        super(config, fixer);
        // TODO: Support more than one single value here, or even build a
        // multi-pattern engine. This would help for performance.
        if (this.config.values.length !== 1) {
            throw new Error(`BANNED_PROPERTY_WRITE expects one value, got(${this.config.values.join(',')})`);
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
        ast_tools_1.debugLog(`inspecting ${n.getText().trim()}`);
        if (!this.matcher.matches(n.left, tc)) {
            return;
        }
        ast_tools_1.debugLog(`Match. Reporting failure (boundaries: ${n.getStart()}, ${n.getEnd()}] on node [${n.getText()}]`);
        return n;
    }
}
exports.PropertyWriteEngine = PropertyWriteEngine;
