/*
 * Copyright 2015-present Open Networking Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.onosproject.netconf;

import org.onosproject.net.DeviceId;

/**
 * Allows for providers interested in node events to be notified.
 */
public interface NetconfDeviceListener {

    /**
     * Notifies that the device was added.
     *
     * @param deviceId the device that was added
     */
    void deviceAdded(DeviceId deviceId);

    /**
     * Notifies that the device was removed.
     *
     * @param deviceId the device that was removed
     */

    void deviceRemoved(DeviceId deviceId);

    /**
     * Notifies that netconf connection with device is reestablished.
     *
     * @param deviceId the device with which netconf connection is reestablished
     */
    default void netconfConnectionReestablished(DeviceId deviceId) {
    }
}
