"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
/**
 * A Tsetse check Failure is almost identical to a Diagnostic from TypeScript
 * except that:
 * (1) The error code is defined by each individual Tsetse rule.
 * (2) The optional `source` property is set to `Tsetse` so the host (VS Code
 * for instance) would use that to indicate where the error comes from.
 * (3) There's an optional suggestedFix field.
 */
class Failure {
    constructor(sourceFile, start, end, failureText, code, suggestedFix) {
        this.sourceFile = sourceFile;
        this.start = start;
        this.end = end;
        this.failureText = failureText;
        this.code = code;
        this.suggestedFix = suggestedFix;
    }
    /**
     * This returns a structure compatible with ts.Diagnostic, but with added
     * fields, for convenience and to support suggested fixes.
     */
    toDiagnostic() {
        return {
            file: this.sourceFile,
            start: this.start,
            end: this.end,
            // start-end-using systems.
            length: this.end - this.start,
            messageText: this.failureText,
            category: ts.DiagnosticCategory.Error,
            code: this.code,
            // source is the name of the plugin.
            source: 'Tsetse',
            fix: this.suggestedFix
        };
    }
    /**
     * Same as toDiagnostic, but include the fix in the message, so that systems
     * that don't support displaying suggested fixes can still surface that
     * information. This assumes the diagnostic message is going to be presented
     * within the context of the problematic code
     */
    toDiagnosticWithStringifiedFix() {
        const diagnostic = this.toDiagnostic();
        if (this.suggestedFix) {
            diagnostic.messageText += ' ' + this.fixToReadableStringInContext();
        }
        return diagnostic;
    }
    toString() {
        return `{ sourceFile:${this.sourceFile ? this.sourceFile.fileName : 'unknown'}, start:${this.start}, end:${this.end}, fix:${fixToString(this.suggestedFix)} }`;
    }
    /**
     * Stringifies a `Fix`, in a way that makes sense when presented alongside the
     * finding. This is a heuristic, obviously.
     */
    fixToReadableStringInContext() {
        if (!this.suggestedFix)
            return ''; // no changes, nothing to state.
        const f = this.suggestedFix;
        let fixText = '';
        for (const c of f.changes) {
            // Remove leading/trailing whitespace from the stringified suggestions:
            // since we add line breaks after each line of stringified suggestion, and
            // since users will manually apply the fix, there is no need to show
            // trailing whitespace. This is however just for stringification of the
            // fixes: the suggested fix itself still keeps trailing whitespace.
            const printableReplacement = c.replacement.trim();
            // Insertion.
            if (c.start === c.end) {
                // Try to see if that's an import.
                if (c.replacement.indexOf('import') !== -1) {
                    fixText += `- Add new import: ${printableReplacement}\n`;
                }
                else {
                    // Insertion that's not a full import. This should rarely happen in
                    // our context, and we don't have a great message for these.
                    // For instance, this could be the addition of a new symbol in an
                    // existing import (`import {foo}` becoming `import {foo, bar}`).
                    fixText += `- Insert ${this.readableRange(c.start, c.end)}: ${printableReplacement}\n`;
                }
            }
            else if (c.start === this.start && c.end === this.end) {
                // We assume the replacement is the main part of the fix, so put that
                // individual change first in `fixText`.
                fixText = `- Replace the full match with: ${printableReplacement}\n` +
                    fixText;
            }
            else {
                // Fallback case: Use a numerical range to specify a replacement. In
                // general, falling through in this case should be avoided, as it's not
                // really readable without an IDE (the range can be outside of the
                // matched code).
                fixText = `- Replace ${this.readableRange(c.start, c.end)} with: ` +
                    `${printableReplacement}\n${fixText}`;
            }
        }
        return 'Suggested fix:\n' + fixText.trim();
    }
    // TS indexes from 0 both ways, but tooling generally indexes from 1 for both
    // lines and columns. The translation is done here.
    readableRange(from, to) {
        const lcf = this.sourceFile.getLineAndCharacterOfPosition(from);
        const lct = this.sourceFile.getLineAndCharacterOfPosition(to);
        if (lcf.line === lct.line) {
            if (lcf.character === lct.character) {
                return `at line ${lcf.line + 1}, char ${lcf.character + 1}`;
            }
            return `line ${lcf.line + 1}, from char ${lcf.character + 1} to ${lct.character + 1}`;
        }
        else {
            return `from line ${lcf.line + 1}, char ${lcf.character + 1} to line ${lct.line + 1}, char ${lct.character + 1}`;
        }
    }
}
exports.Failure = Failure;
/**
 * Stringifies a `Fix`, replacing the `ts.SourceFile` with the matching
 * filename.
 */
function fixToString(f) {
    if (!f)
        return 'undefined';
    return '{' + JSON.stringify(f.changes.map(ic => {
        return {
            start: ic.start,
            end: ic.end,
            replacement: ic.replacement,
            fileName: ic.sourceFile.fileName
        };
    })) +
        '}';
}
exports.fixToString = fixToString;
