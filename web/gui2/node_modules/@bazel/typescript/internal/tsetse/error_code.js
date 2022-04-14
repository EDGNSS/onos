"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Error codes for tsetse checks.
 *
 * Start with 21222 and increase linearly.
 * The intent is for these codes to be fixed, so that tsetse users can
 * search for them in user forums and other media.
 */
var ErrorCode;
(function (ErrorCode) {
    ErrorCode[ErrorCode["CHECK_RETURN_VALUE"] = 21222] = "CHECK_RETURN_VALUE";
    ErrorCode[ErrorCode["EQUALS_NAN"] = 21223] = "EQUALS_NAN";
    ErrorCode[ErrorCode["BAN_EXPECT_TRUTHY_PROMISE"] = 21224] = "BAN_EXPECT_TRUTHY_PROMISE";
    ErrorCode[ErrorCode["MUST_USE_PROMISES"] = 21225] = "MUST_USE_PROMISES";
    ErrorCode[ErrorCode["BAN_PROMISE_AS_CONDITION"] = 21226] = "BAN_PROMISE_AS_CONDITION";
    ErrorCode[ErrorCode["PROPERTY_RENAMING_SAFE"] = 21227] = "PROPERTY_RENAMING_SAFE";
    ErrorCode[ErrorCode["CONFORMANCE_PATTERN"] = 21228] = "CONFORMANCE_PATTERN";
    ErrorCode[ErrorCode["BAN_MUTABLE_EXPORTS"] = 21229] = "BAN_MUTABLE_EXPORTS";
    ErrorCode[ErrorCode["BAN_STRING_INITIALIZED_SETS"] = 21230] = "BAN_STRING_INITIALIZED_SETS";
})(ErrorCode = exports.ErrorCode || (exports.ErrorCode = {}));
