"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../../error_code");
const ast_tools_1 = require("../ast_tools");
const match_symbol_1 = require("../match_symbol");
const pattern_engine_1 = require("./pattern_engine");
class NameEngine extends pattern_engine_1.PatternEngine {
    constructor(config, fixer) {
        super(config, fixer);
        // TODO: Support more than one single value here, or even build a
        // multi-pattern engine. This would help for performance.
        if (this.config.values.length !== 1) {
            throw new Error(`BANNED_NAME expects one value, got(${this.config.values.join(',')})`);
        }
        this.matcher = new match_symbol_1.AbsoluteMatcher(this.config.values[0]);
    }
    register(checker) {
        checker.on(ts.SyntaxKind.Identifier, this.checkAndFilterResults.bind(this), error_code_1.ErrorCode.CONFORMANCE_PATTERN);
    }
    check(tc, n) {
        if (!ast_tools_1.shouldExamineNode(n) || n.getSourceFile().isDeclarationFile) {
            return;
        }
        ast_tools_1.debugLog(`inspecting ${n.getText().trim()}`);
        if (!this.matcher.matches(n, tc)) {
            ast_tools_1.debugLog('Not the right global name.');
            return;
        }
        return n;
    }
}
exports.NameEngine = NameEngine;
