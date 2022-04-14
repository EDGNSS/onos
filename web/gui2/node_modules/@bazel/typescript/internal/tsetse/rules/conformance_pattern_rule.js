"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const error_code_1 = require("../error_code");
const pattern_config_1 = require("../util/pattern_config");
exports.PatternKind = pattern_config_1.PatternKind;
const name_call_non_constant_argument_1 = require("../util/pattern_engines/name_call_non_constant_argument");
const name_engine_1 = require("../util/pattern_engines/name_engine");
const property_non_constant_write_engine_1 = require("../util/pattern_engines/property_non_constant_write_engine");
const property_write_engine_1 = require("../util/pattern_engines/property_write_engine");
/**
 * Builds a Rule that matches a certain pattern, given as parameter, and
 * that can additionally run a suggested fix generator on the matches.
 *
 * This is templated, mostly to ensure the nodes that have been matched
 * correspond to what the Fixer expects.
 */
class ConformancePatternRule {
    constructor(config, fixer) {
        this.code = error_code_1.ErrorCode.CONFORMANCE_PATTERN;
        switch (config.kind) {
            case pattern_config_1.PatternKind.BANNED_PROPERTY_WRITE:
                this.engine = new property_write_engine_1.PropertyWriteEngine(config, fixer);
                break;
            case pattern_config_1.PatternKind.BANNED_PROPERTY_NON_CONSTANT_WRITE:
                this.engine = new property_non_constant_write_engine_1.PropertyNonConstantWriteEngine(config, fixer);
                break;
            case pattern_config_1.PatternKind.BANNED_NAME:
                this.engine = new name_engine_1.NameEngine(config, fixer);
                break;
            case pattern_config_1.PatternKind.BANNED_NAME_CALL_NON_CONSTANT_ARGUMENT:
                this.engine = new name_call_non_constant_argument_1.CallNonConstantArgumentEngine(config, fixer);
                break;
            default:
                throw new Error('Config type not recognized, or not implemented yet.');
        }
        this.ruleName = config.name || `conformance-pattern-${config.kind}`;
    }
    register(checker) {
        this.engine.register(checker);
    }
}
exports.ConformancePatternRule = ConformancePatternRule;
