/**
 * @license
 * Copyright 2017 The Bazel Authors. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/// <amd-module name="@bazel/protractor/protractor-utils" />
export declare function isTcpPortFree(port: number): Promise<boolean>;
export declare function isTcpPortBound(port: number): Promise<boolean>;
export declare function findFreeTcpPort(): Promise<number>;
export interface OnPrepareConfig {
    workspace: string;
    server: string;
}
export declare function waitForServer(port: number, timeout: number): Promise<boolean>;
export interface ServerSpec {
    port: number;
}
/**
 * Runs the specified server binary from a given workspace and waits for the server
 * being ready. The server binary will be resolved from the Bazel runfiles. Note that
 * the server will be launched with a random free port in order to support test concurrency
 * with Bazel.
 */
export declare function runServer(workspace: string, serverTarget: string, portFlag: string, serverArgs: string[], timeout?: number): Promise<ServerSpec>;
