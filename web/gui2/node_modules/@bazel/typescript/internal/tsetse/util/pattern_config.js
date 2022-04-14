"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The list of supported patterns useable in ConformancePatternRule. The
 * patterns whose name match JSConformance patterns should behave similarly (see
 * https://github.com/google/closure-compiler/wiki/JS-Conformance-Framework)
 */
var PatternKind;
(function (PatternKind) {
    PatternKind["BANNED_NAME"] = "banned-name";
    PatternKind["BANNED_PROPERTY_WRITE"] = "banned-property-write";
    PatternKind["BANNED_PROPERTY_NON_CONSTANT_WRITE"] = "banned-property-non-constant-write";
    // Not from JSConformance.
    PatternKind["BANNED_NAME_CALL_NON_CONSTANT_ARGUMENT"] = "banned-call-non-constant-argument";
})(PatternKind = exports.PatternKind || (exports.PatternKind = {}));
/**
 * The categories of whitelist entries.
 */
var WhitelistReason;
(function (WhitelistReason) {
    /** No reason. */
    WhitelistReason[WhitelistReason["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /** Code that has to be grandfathered in (no guarantees). */
    WhitelistReason[WhitelistReason["LEGACY"] = 1] = "LEGACY";
    /**
     * Code that does not enter the scope of this particular check  (no
     * guarantees).
     */
    WhitelistReason[WhitelistReason["OUT_OF_SCOPE"] = 2] = "OUT_OF_SCOPE";
    /** Manually reviewed exceptions (supposedly okay). */
    WhitelistReason[WhitelistReason["MANUALLY_REVIEWED"] = 3] = "MANUALLY_REVIEWED";
})(WhitelistReason = exports.WhitelistReason || (exports.WhitelistReason = {}));
