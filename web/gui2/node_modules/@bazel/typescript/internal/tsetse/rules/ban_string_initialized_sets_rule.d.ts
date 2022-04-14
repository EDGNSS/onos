/**
 * @fileoverview Bans `new Set(<string>)` since it is a potential source of bugs
 * due to strings also implementing `Iterable<string>`.
 */
import { Checker } from '../checker';
import { ErrorCode } from '../error_code';
import { AbstractRule } from '../rule';
export declare class Rule extends AbstractRule {
    readonly ruleName = "ban-string-initialized-sets";
    readonly code = ErrorCode.BAN_STRING_INITIALIZED_SETS;
    register(checker: Checker): void;
}
