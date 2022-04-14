"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const error_code_1 = require("../../error_code");
const ast_tools_1 = require("../ast_tools");
const is_literal_1 = require("../is_literal");
const match_symbol_1 = require("../match_symbol");
const pattern_engine_1 = require("./pattern_engine");
/**
 * The engine for BANNED_CALL_NON_CONSTANT_ARGUMENT.
 *
 * This takes any amount of (functionName, argument) position pairs, separated
 * by a colon. The first part matches symbols that were defined on the global
 * scope, and their fields, without going through a prototype chain.
 *
 * For instance, "URL.createObjectURL:0" will target any createObjectURL-named
 * call on a URL-named object (like the ambient URL declared in lib.dom.d.ts),
 * or "Car.buildFromParts:1" will match any buildFromParts reached from a
 * Car-named symbol, including a hypothetical class with a static member
 * function "buildFromParts" that lives in its own module.
 */
class CallNonConstantArgumentEngine extends pattern_engine_1.PatternEngine {
    constructor(config, fixer) {
        super(config, fixer);
        this.matchers = [];
        for (const v of config.values) {
            const [matcherSpec, strPosition] = v.split(':', 2);
            if (!matcherSpec || !strPosition.match('^\\d+$')) {
                throw new Error('Couldn\'t parse values');
            }
            const position = Number(strPosition);
            this.matchers.push([new match_symbol_1.AbsoluteMatcher(matcherSpec), position]);
        }
    }
    register(checker) {
        checker.on(ts.SyntaxKind.CallExpression, this.checkAndFilterResults.bind(this), error_code_1.ErrorCode.CONFORMANCE_PATTERN);
    }
    check(tc, n) {
        if (!ts.isCallExpression(n)) {
            ast_tools_1.debugLog(`Should not happen: node is not a CallExpression`);
            return;
        }
        ast_tools_1.debugLog(`inspecting ${n.getText().trim()}`);
        /**
         * Inspects a particular CallExpression to see if it calls the target
         * function with a non-literal parameter in the target position. Returns
         * that CallExpression if `n` matches the search, undefined otherwise.
         */
        function checkIndividual(n, m) {
            if (!m[0].matches(n.expression, tc)) {
                ast_tools_1.debugLog(`Wrong symbol, not ${m[0].bannedName}`);
                return;
            }
            if (n.arguments.length < m[1]) {
                ast_tools_1.debugLog(`Good symbol, not enough arguments to match (got ${n.arguments.length}, want ${m[1]})`);
                return;
            }
            if (is_literal_1.isLiteral(tc, n.arguments[m[1]])) {
                ast_tools_1.debugLog(`Good symbol, argument literal`);
                return;
            }
            ast_tools_1.debugLog(`Match. Reporting failure (boundaries: ${n.getStart()}, ${n.getEnd()}] on node [${n.getText()}]`);
            return n;
        }
        for (const m of this.matchers) {
            // The first matching matcher will be used.
            const r = checkIndividual(n, m);
            if (r)
                return r;
        }
        // No match.
        return;
    }
}
exports.CallNonConstantArgumentEngine = CallNonConstantArgumentEngine;
