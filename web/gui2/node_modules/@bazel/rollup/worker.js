"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const protobufjs = require("protobufjs");
// Equivalent of running node with --expose-gc
// but easier to write tooling since we don't need to inject that arg to
// nodejs_binary
if (typeof global.gc !== 'function') {
    // tslint:disable-next-line:no-require-imports
    require('v8').setFlagsFromString('--expose_gc');
    // tslint:disable-next-line:no-require-imports
    global.gc = require('vm').runInNewContext('gc');
}
/**
 * Whether to print debug messages (to console.error) from the debug function
 * below.
 */
exports.DEBUG = false;
/** Maybe print a debug message (depending on a flag defaulting to false). */
function debug(...args) {
    if (exports.DEBUG)
        console.error.call(console, ...args);
}
exports.debug = debug;
/**
 * Write a message to stderr, which appears in the bazel log and is visible to
 * the end user.
 */
function log(...args) {
    console.error.call(console, ...args);
}
exports.log = log;
/**
 * runAsWorker returns true if the given arguments indicate the process should
 * run as a persistent worker.
 */
function runAsWorker(args) {
    return args.indexOf('--persistent_worker') !== -1;
}
exports.runAsWorker = runAsWorker;
/**
 * loadWorkerPb finds and loads the protocol buffer definition for bazel's
 * worker protocol using protobufjs. In protobufjs, this means it's a reflection
 * object that also contains properties for the individual messages.
 */
function loadWorkerPb() {
    const protoPath = './third_party/github.com/bazelbuild/bazel/src/main/protobuf/worker_protocol.proto';
    // Use node module resolution so we can find the .proto file in any of the
    // root dirs
    let protofile;
    try {
        // Look for the .proto file relative in its @bazel/typescript npm package
        // location
        protofile = require.resolve(protoPath);
    }
    catch (e) {
    }
    if (!protofile) {
        // If not found above, look for the .proto file in its rules_typescript
        // workspace location
        // This extra lookup should never happen in google3. It's only needed for
        // local development in the rules_typescript repo.
        const runfiles = process.env['BAZEL_NODE_RUNFILES_HELPER'];
        if (runfiles) {
            protofile = require(runfiles).resolve('@bazel/worker/third_party/github.com/bazelbuild/bazel/src/main/protobuf/worker_protocol.proto');
        }
        if (!protofile) {
            throw new Error(`cannot find worker_protocol.proto at ${protoPath} or in Runfiles`);
        }
    }
    const protoNamespace = protobufjs.loadSync(protofile);
    if (!protoNamespace) {
        throw new Error('Cannot find ' + path.resolve(protoPath));
    }
    const workerpb = protoNamespace.lookup('blaze.worker');
    if (!workerpb) {
        throw new Error(`Cannot find namespace blaze.worker`);
    }
    return workerpb;
}
/**
 * workerpb contains the runtime representation of the worker protocol buffer,
 * including accessor for the defined messages.
 */
const workerpb = loadWorkerPb();
/**
 * runWorkerLoop handles the interacton between bazel workers and the
 * TypeScript compiler. It reads compilation requests from stdin, unmarshals the
 * data, and dispatches into `runOneBuild` for the actual compilation to happen.
 *
 * The compilation handler is parameterized so that this code can be used by
 * different compiler entry points (currently TypeScript compilation, Angular
 * compilation, and the contrib vulcanize worker).
 *
 * It's also exposed publicly as an npm package:
 *   https://www.npmjs.com/package/@bazel/worker
 */
function runWorkerLoop(runOneBuild) {
    var e_1, _a;
    return __awaiter(this, void 0, void 0, function* () {
        // Hook all output to stderr and write it to a buffer, then include
        // that buffer's in the worker protcol proto's textual output.  This
        // means you can log via console.error() and it will appear to the
        // user as expected.
        let consoleOutput = '';
        process.stderr.write =
            (chunk, ...otherArgs) => {
                consoleOutput += chunk.toString();
                return true;
            };
        // Accumulator for asynchronously read input.
        // protobufjs uses node's Buffer, but has its own reader abstraction on top of
        // it (for browser compatiblity). It ignores Buffer's builtin start and
        // offset, which means the handling code below cannot use Buffer in a
        // meaningful way (such as cycling data through it). The handler below reads
        // any data available on stdin, concatenating it into this buffer. It then
        // attempts to read a delimited Message from it. If a message is incomplete,
        // it exits and waits for more input. If a message has been read, it strips
        // its data of this buffer.
        let buf = Buffer.alloc(0);
        try {
            stdinLoop: for (var _b = __asyncValues(process.stdin), _c; _c = yield _b.next(), !_c.done;) {
                const chunk = _c.value;
                buf = Buffer.concat([buf, chunk]);
                try {
                    const reader = new protobufjs.Reader(buf);
                    // Read all requests that have accumulated in the buffer.
                    while (reader.len - reader.pos > 0) {
                        const messageStart = reader.len;
                        const msgLength = reader.uint32();
                        // chunk might be an incomplete read from stdin. If there are not enough
                        // bytes for the next full message, wait for more input.
                        if ((reader.len - reader.pos) < msgLength)
                            continue stdinLoop;
                        const req = workerpb.WorkRequest.decode(reader, msgLength);
                        // Once a message has been read, remove it from buf so that if we pause
                        // to read more input, this message will not be processed again.
                        buf = buf.slice(messageStart);
                        debug('=== Handling new build request');
                        // Reset accumulated log output.
                        consoleOutput = '';
                        const args = req.arguments;
                        const inputs = {};
                        for (const input of req.inputs) {
                            inputs[input.path] = input.digest.toString('hex');
                        }
                        debug('Compiling with:\n\t' + args.join('\n\t'));
                        const exitCode = (yield runOneBuild(args, inputs)) ? 0 : 1;
                        process.stdout.write((workerpb.WorkResponse.encodeDelimited({
                            exitCode,
                            output: consoleOutput,
                        })).finish());
                        // Force a garbage collection pass.  This keeps our memory usage
                        // consistent across multiple compilations, and allows the file
                        // cache to use the current memory usage as a guideline for expiring
                        // data.  Note: this is intentionally not within runOneBuild(), as
                        // we want to gc only after all its locals have gone out of scope.
                        global.gc();
                    }
                    // All messages have been handled, make sure the invariant holds and
                    // Buffer is empty once all messages have been read.
                    if (buf.length > 0) {
                        throw new Error('buffer not empty after reading all messages');
                    }
                }
                catch (e) {
                    log('Compilation failed', e.stack);
                    process.stdout.write(workerpb.WorkResponse
                        .encodeDelimited({ exitCode: 1, output: consoleOutput })
                        .finish());
                    // Clear buffer so the next build won't read an incomplete request.
                    buf = Buffer.alloc(0);
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) yield _a.call(_b);
            }
            finally { if (e_1) throw e_1.error; }
        }
    });
}
exports.runWorkerLoop = runWorkerLoop;
