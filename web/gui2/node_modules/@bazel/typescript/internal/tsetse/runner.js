"use strict";
/**
 * @fileoverview Runner is the entry point of running Tsetse checks in compiler.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const checker_1 = require("./checker");
const ban_expect_truthy_promise_rule_1 = require("./rules/ban_expect_truthy_promise_rule");
const ban_promise_as_condition_rule_1 = require("./rules/ban_promise_as_condition_rule");
const ban_string_initialized_sets_rule_1 = require("./rules/ban_string_initialized_sets_rule");
const check_return_value_rule_1 = require("./rules/check_return_value_rule");
const equals_nan_rule_1 = require("./rules/equals_nan_rule");
const must_use_promises_rule_1 = require("./rules/must_use_promises_rule");
/**
 * List of Tsetse rules. Shared between the program plugin and the language
 * service plugin.
 */
const ENABLED_RULES = [
    new check_return_value_rule_1.Rule(),
    new equals_nan_rule_1.Rule(),
    new ban_expect_truthy_promise_rule_1.Rule(),
    new must_use_promises_rule_1.Rule(),
    new ban_promise_as_condition_rule_1.Rule(),
    new ban_string_initialized_sets_rule_1.Rule(),
];
/**
 * The Tsetse check plugin performs compile-time static analysis for TypeScript
 * code.
 */
class Plugin {
    constructor(program, disabledTsetseRules = []) {
        this.name = 'tsetse';
        this.checker = new checker_1.Checker(program);
        registerRules(this.checker, disabledTsetseRules);
    }
    getDiagnostics(sourceFile) {
        // Tsetse, in its plugin form, outputs ts.Diagnostic that don't make use
        // of the potential suggested fixes Tsetse generates. These diagnostics are
        // however displayed in context: we can therefore stringify any potential
        // suggested fixes in the error message, so they don't go to waste.
        return this.checker.execute(sourceFile)
            .map(failure => failure.toDiagnosticWithStringifiedFix());
    }
}
exports.Plugin = Plugin;
function registerRules(checker, disabledTsetseRules) {
    for (const rule of ENABLED_RULES) {
        if (disabledTsetseRules.indexOf(rule.ruleName) === -1) {
            rule.register(checker);
        }
    }
}
exports.registerRules = registerRules;
