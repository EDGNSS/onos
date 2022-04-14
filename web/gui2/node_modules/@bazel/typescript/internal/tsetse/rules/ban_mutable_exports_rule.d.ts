/**
 * @fileoverview Bans 'export' of mutable variables.
 * It is illegal to mutate them, so you might as well use 'const'.
 */
import { Checker } from '../checker';
import { ErrorCode } from '../error_code';
import { AbstractRule } from '../rule';
export declare class Rule extends AbstractRule {
    readonly ruleName = "ban-mutable-exports";
    readonly code = ErrorCode.BAN_MUTABLE_EXPORTS;
    register(checker: Checker): void;
}
