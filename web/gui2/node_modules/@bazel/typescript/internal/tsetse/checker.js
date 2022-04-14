"use strict";
/**
 * @fileoverview Checker contains all the information we need to perform source
 * file AST traversals and report errors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const failure_1 = require("./failure");
/**
 * Tsetse rules use on() and addFailureAtNode() for rule implementations.
 * Rules can get a ts.TypeChecker from checker.typeChecker so typed rules are
 * possible. Compiler uses execute() to run the Tsetse check.
 */
class Checker {
    constructor(program) {
        /**
         * nodeHandlersMap contains node to handlers mapping for all enabled rules.
         */
        this.nodeHandlersMap = new Map();
        this.failures = [];
        // currentCode will be set before invoking any handler functions so the value
        // initialized here is never used.
        this.currentCode = 0;
        // Avoid the cost for each rule to create a new TypeChecker.
        this.typeChecker = program.getTypeChecker();
    }
    /**
     * This doesn't run any checks yet. Instead, it registers `handlerFunction` on
     * `nodeKind` node in `nodeHandlersMap` map. After all rules register their
     * handlers, the source file AST will be traversed.
     */
    on(nodeKind, handlerFunction, code) {
        const newHandler = { handlerFunction, code };
        const registeredHandlers = this.nodeHandlersMap.get(nodeKind);
        if (registeredHandlers === undefined) {
            this.nodeHandlersMap.set(nodeKind, [newHandler]);
        }
        else {
            registeredHandlers.push(newHandler);
        }
    }
    /**
     * Add a failure with a span. addFailure() is currently private because
     * `addFailureAtNode` is preferred.
     */
    addFailure(start, end, failureText, fix) {
        if (!this.currentSourceFile) {
            throw new Error('Source file not defined');
        }
        if (start >= end || end > this.currentSourceFile.end || start < 0) {
            // Since only addFailureAtNode() is exposed for now this shouldn't happen.
            throw new Error(`Invalid start and end position: [${start}, ${end}]` +
                ` in file ${this.currentSourceFile.fileName}.`);
        }
        const failure = new failure_1.Failure(this.currentSourceFile, start, end, failureText, this.currentCode, fix);
        this.failures.push(failure);
    }
    addFailureAtNode(node, failureText, fix) {
        // node.getStart() takes a sourceFile as argument whereas node.getEnd()
        // doesn't need it.
        this.addFailure(node.getStart(this.currentSourceFile), node.getEnd(), failureText, fix);
    }
    /**
     * Walk `sourceFile`, invoking registered handlers with Checker as the first
     * argument and current node as the second argument. Return failures if there
     * are any.
     */
    execute(sourceFile) {
        const thisChecker = this;
        this.currentSourceFile = sourceFile;
        this.failures = [];
        run(sourceFile);
        return this.failures;
        function run(node) {
            const handlers = thisChecker.nodeHandlersMap.get(node.kind);
            if (handlers !== undefined) {
                for (const handler of handlers) {
                    thisChecker.currentCode = handler.code;
                    handler.handlerFunction(thisChecker, node);
                }
            }
            ts.forEachChild(node, run);
        }
    }
}
exports.Checker = Checker;
