/*
 * Copyright 2014-present Open Networking Foundation
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
package org.onosproject.net.intent.impl;

import com.google.common.collect.ImmutableSet;
import org.onlab.util.Tools;
import org.onosproject.cfg.ComponentConfigService;
import org.onosproject.core.ApplicationId;
import org.onosproject.core.CoreService;
import org.onosproject.core.IdGenerator;
import org.onosproject.event.AbstractListenerManager;
import org.onosproject.net.DeviceId;
import org.onosproject.net.config.NetworkConfigService;
import org.onosproject.net.domain.DomainIntentService;
import org.onosproject.net.flow.FlowRuleService;
import org.onosproject.net.flowobjective.FlowObjectiveService;
import org.onosproject.net.group.GroupKey;
import org.onosproject.net.group.GroupService;
import org.onosproject.net.intent.Intent;
import org.onosproject.net.intent.IntentBatchDelegate;
import org.onosproject.net.intent.IntentCompiler;
import org.onosproject.net.intent.IntentData;
import org.onosproject.net.intent.IntentEvent;
import org.onosproject.net.intent.IntentExtensionService;
import org.onosproject.net.intent.IntentInstallCoordinator;
import org.onosproject.net.intent.IntentInstaller;
import org.onosproject.net.intent.IntentListener;
import org.onosproject.net.intent.IntentOperationContext;
import org.onosproject.net.intent.IntentService;
import org.onosproject.net.intent.IntentState;
import org.onosproject.net.intent.IntentStore;
import org.onosproject.net.intent.IntentStoreDelegate;
import org.onosproject.net.intent.Key;
import org.onosproject.net.intent.ObjectiveTrackerService;
import org.onosproject.net.intent.PointToPointIntent;
import org.onosproject.net.intent.TopologyChangeDelegate;
import org.onosproject.net.intent.impl.compiler.PointToPointIntentCompiler;
import org.onosproject.net.intent.impl.phase.FinalIntentProcessPhase;
import org.onosproject.net.intent.impl.phase.IntentProcessPhase;
import org.onosproject.net.intent.impl.phase.Skipped;
import org.onosproject.net.resource.ResourceConsumer;
import org.onosproject.net.resource.ResourceService;
import org.osgi.service.component.ComponentContext;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.slf4j.Logger;

import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.stream.Collectors;

import static com.google.common.base.Preconditions.checkNotNull;
import static com.google.common.base.Strings.isNullOrEmpty;
import static java.util.concurrent.Executors.newFixedThreadPool;
import static java.util.concurrent.Executors.newSingleThreadExecutor;
import static org.onlab.util.Tools.groupedThreads;
import static org.onosproject.net.OsgiPropertyConstants.IM_NUM_THREADS;
import static org.onosproject.net.OsgiPropertyConstants.IM_NUM_THREADS_DEFAULT;
import static org.onosproject.net.OsgiPropertyConstants.IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL;
import static org.onosproject.net.OsgiPropertyConstants.IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL_DEFAULT;
import static org.onosproject.net.intent.IntentState.FAILED;
import static org.onosproject.net.intent.IntentState.INSTALL_REQ;
import static org.onosproject.net.intent.IntentState.WITHDRAWING;
import static org.onosproject.net.intent.IntentState.WITHDRAWN;
import static org.onosproject.net.intent.IntentState.WITHDRAW_REQ;
import static org.onosproject.net.intent.constraint.PartialFailureConstraint.intentAllowsPartialFailure;
import static org.onosproject.net.intent.impl.phase.IntentProcessPhase.newInitialPhase;
import static org.onosproject.security.AppGuard.checkPermission;
import static org.onosproject.security.AppPermission.Type.*;
import static org.slf4j.LoggerFactory.getLogger;

/**
 * An implementation of intent service.
 */
@Component(
    immediate = true,
    service = {
        IntentService.class,
        IntentExtensionService.class,
        IntentInstallCoordinator.class
    },
    property = {
        IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL + ":Boolean=" + IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL_DEFAULT,
        IM_NUM_THREADS + ":Integer=" + IM_NUM_THREADS_DEFAULT
    }
)
public class IntentManager
        extends AbstractListenerManager<IntentEvent, IntentListener>
        implements IntentService, IntentExtensionService, IntentInstallCoordinator {

    private static final Logger log = getLogger(IntentManager.class);

    private static final String INTENT_NULL = "Intent cannot be null";
    private static final String INTENT_ID_NULL = "Intent key cannot be null";

    private static final EnumSet<IntentState> RECOMPILE
            = EnumSet.of(INSTALL_REQ, FAILED, WITHDRAW_REQ);
    private static final EnumSet<IntentState> WITHDRAW
            = EnumSet.of(WITHDRAW_REQ, WITHDRAWING, WITHDRAWN);

    /** Indicates whether skipping resource releases on withdrawal is enabled or not. */
    private boolean skipReleaseResourcesOnWithdrawal = IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL_DEFAULT;

    /** Number of worker threads. */
    private int numThreads = IM_NUM_THREADS_DEFAULT;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected CoreService coreService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected IntentStore store;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ObjectiveTrackerService trackerService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected FlowRuleService flowRuleService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected FlowObjectiveService flowObjectiveService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected DomainIntentService domainIntentService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ResourceService resourceService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ComponentConfigService configService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected GroupService groupService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    private NetworkConfigService networkConfigService;

    private ExecutorService batchExecutor;
    private ExecutorService workerExecutor;

    private final CompilerRegistry compilerRegistry = new CompilerRegistry();
    private final InstallerRegistry installerRegistry = new InstallerRegistry();
    private final InternalIntentProcessor processor = new InternalIntentProcessor();
    private final IntentStoreDelegate delegate = new InternalStoreDelegate();
    private final IntentStoreDelegate testOnlyDelegate = new TestOnlyIntentStoreDelegate();
    private final TopologyChangeDelegate topoDelegate = new InternalTopoChangeDelegate();
    private final IntentBatchDelegate batchDelegate = new InternalBatchDelegate();
    private InstallCoordinator installCoordinator;
    private IdGenerator idGenerator;

    private final IntentAccumulator accumulator = new IntentAccumulator(batchDelegate);

    @Activate
    public void activate() {
        configService.registerProperties(getClass());
        if (skipReleaseResourcesOnWithdrawal) {
            store.setDelegate(testOnlyDelegate);
        } else {
            store.setDelegate(delegate);
        }
        trackerService.setDelegate(topoDelegate);
        eventDispatcher.addSink(IntentEvent.class, listenerRegistry);
        batchExecutor = newSingleThreadExecutor(groupedThreads("onos/intent", "batch", log));
        workerExecutor = newFixedThreadPool(numThreads, groupedThreads("onos/intent", "worker-%d", log));
        idGenerator = coreService.getIdGenerator("intent-ids");
        Intent.unbindIdGenerator(idGenerator);
        Intent.bindIdGenerator(idGenerator);
        installCoordinator = new InstallCoordinator(installerRegistry, store);
        log.info("Started");
    }

    @Deactivate
    public void deactivate() {
        if (skipReleaseResourcesOnWithdrawal) {
            store.unsetDelegate(testOnlyDelegate);
        } else {
            store.unsetDelegate(delegate);
        }
        configService.unregisterProperties(getClass(), false);
        trackerService.unsetDelegate(topoDelegate);
        eventDispatcher.removeSink(IntentEvent.class);
        batchExecutor.shutdown();
        workerExecutor.shutdown();
        Intent.unbindIdGenerator(idGenerator);
        log.info("Stopped");
    }

    @Modified
    public void modified(ComponentContext context) {
        if (context == null) {
            skipReleaseResourcesOnWithdrawal = IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL_DEFAULT;
            logConfig("Default config");
            return;
        }

        String s = Tools.get(context.getProperties(), IM_SKIP_RELEASE_RESOURCES_ON_WITHDRAWAL);
        boolean newTestEnabled = isNullOrEmpty(s) ? skipReleaseResourcesOnWithdrawal : Boolean.parseBoolean(s.trim());
        if (skipReleaseResourcesOnWithdrawal && !newTestEnabled) {
            store.unsetDelegate(testOnlyDelegate);
            store.setDelegate(delegate);
            skipReleaseResourcesOnWithdrawal = false;
            logConfig("Reconfigured skip release resources on withdrawal");
        } else if (!skipReleaseResourcesOnWithdrawal && newTestEnabled) {
            store.unsetDelegate(delegate);
            store.setDelegate(testOnlyDelegate);
            skipReleaseResourcesOnWithdrawal = true;
            logConfig("Reconfigured skip release resources on withdrawal");
        }

        s = Tools.get(context.getProperties(), IM_NUM_THREADS);
        int newNumThreads = isNullOrEmpty(s) ? numThreads : Integer.parseInt(s);
        if (newNumThreads != numThreads) {
            numThreads = newNumThreads;
            ExecutorService oldWorkerExecutor = workerExecutor;
            workerExecutor = newFixedThreadPool(numThreads, groupedThreads("onos/intent", "worker-%d", log));
            if (oldWorkerExecutor != null) {
                oldWorkerExecutor.shutdown();
            }
            logConfig("Reconfigured number of worker threads");
        }
    }

    private void logConfig(String prefix) {
        log.info("{} with skipReleaseResourcesOnWithdrawal = {}", prefix, skipReleaseResourcesOnWithdrawal);
    }

    @Override
    public void submit(Intent intent) {
        checkPermission(INTENT_WRITE);
        checkNotNull(intent, INTENT_NULL);
        IntentData data = IntentData.submit(intent);
        store.addPending(data);
    }

    @Override
    public void withdraw(Intent intent) {
        checkPermission(INTENT_WRITE);
        checkNotNull(intent, INTENT_NULL);
        IntentData data = IntentData.withdraw(intent);
        store.addPending(data);
    }

    @Override
    public void purge(Intent intent) {
        checkPermission(INTENT_WRITE);
        checkNotNull(intent, INTENT_NULL);
        IntentData data = IntentData.purge(intent);
        store.addPending(data);

        // remove associated group if there is one
        if (intent instanceof PointToPointIntent) {
            PointToPointIntent pointIntent = (PointToPointIntent) intent;
            DeviceId deviceId = pointIntent.filteredIngressPoint().connectPoint().deviceId();
            GroupKey groupKey = PointToPointIntentCompiler.makeGroupKey(intent.id());
            groupService.removeGroup(deviceId, groupKey,
                                     intent.appId());
        }
    }

    @Override
    public Intent getIntent(Key key) {
        checkPermission(INTENT_READ);
        return store.getIntent(key);
    }

    @Override
    public Iterable<Intent> getIntents() {
        checkPermission(INTENT_READ);
        return store.getIntents();
    }

    @Override
    public Iterable<Intent> getIntentsByAppId(ApplicationId id) {
        checkPermission(INTENT_READ);

        ImmutableSet.Builder<Intent> builder = ImmutableSet.builder();
        for (Intent intent : store.getIntents()) {
            if (intent.appId().equals(id)) {
                builder.add(intent);
            }
        }

        return builder.build();
    }

    @Override
    public void addPending(IntentData intentData) {
        checkPermission(INTENT_WRITE);
        checkNotNull(intentData, INTENT_NULL);
        //TODO we might consider further checking / assertions
        store.addPending(intentData);
    }

    @Override
    public Iterable<IntentData> getIntentData() {
        checkPermission(INTENT_READ);
        return store.getIntentData(false, 0);
    }

    @Override
    public long getIntentCount() {
        checkPermission(INTENT_READ);
        return store.getIntentCount();
    }

    @Override
    public IntentState getIntentState(Key intentKey) {
        checkPermission(INTENT_READ);
        checkNotNull(intentKey, INTENT_ID_NULL);
        return store.getIntentState(intentKey);
    }

    @Override
    public List<Intent> getInstallableIntents(Key intentKey) {
        checkPermission(INTENT_READ);
        checkNotNull(intentKey, INTENT_ID_NULL);
        return store.getInstallableIntents(intentKey);
    }

    @Override
    public boolean isLocal(Key intentKey) {
        checkPermission(INTENT_READ);
        return store.isMaster(intentKey);
    }

    @Override
    public <T extends Intent> void registerCompiler(Class<T> cls, IntentCompiler<T> compiler) {
        checkPermission(INTENT_WRITE);
        compilerRegistry.registerCompiler(cls, compiler);
    }

    @Override
    public <T extends Intent> void unregisterCompiler(Class<T> cls) {
        checkPermission(INTENT_WRITE);
        compilerRegistry.unregisterCompiler(cls);
    }

    @Override
    public Map<Class<? extends Intent>, IntentCompiler<? extends Intent>> getCompilers() {
        checkPermission(INTENT_READ);
        return compilerRegistry.getCompilers();
    }

    @Override
    public <T extends Intent> void registerInstaller(Class<T> cls, IntentInstaller<T> installer) {
        installerRegistry.registerInstaller(cls, installer);
    }

    @Override
    public <T extends Intent> void unregisterInstaller(Class<T> cls) {
        installerRegistry.unregisterInstaller(cls);
    }

    @Override
    public Map<Class<? extends Intent>, IntentInstaller<? extends Intent>> getInstallers() {
        return installerRegistry.getInstallers();
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T extends Intent> IntentInstaller<T> getInstaller(Class<T> cls) {
        return (IntentInstaller<T>) installerRegistry.getInstallers().get(cls);
    }

    @Override
    public Iterable<Intent> getPending() {
        checkPermission(INTENT_READ);
        return store.getPending();
    }

    @Override
    public void intentInstallSuccess(IntentOperationContext context) {
        installCoordinator.success(context);
    }

    @Override
    public void intentInstallFailed(IntentOperationContext context) {
        installCoordinator.failed(context);
    }

    // Store delegate to re-post events emitted from the store.
    private class InternalStoreDelegate implements IntentStoreDelegate {
        @Override
        public void notify(IntentEvent event) {
            post(event);
            switch (event.type()) {
                case WITHDRAWN:
                    if (!skipReleaseResourcesOnWithdrawal) {
                        releaseResources(event.subject());
                    }
                    break;
                default:
                    break;
            }
        }

        @Override
        public void process(IntentData data) {
            accumulator.add(data);
        }

        @Override
        public void onUpdate(IntentData intentData) {
            trackerService.trackIntent(intentData);
        }

        private void releaseResources(Intent intent) {
            // If a resource group is set on the intent, the resource consumer is
            // set equal to it. Otherwise it's set to the intent key
            ResourceConsumer resourceConsumer =
                    intent.resourceGroup() != null ? intent.resourceGroup() : intent.key();

            // By default the resource doesn't get released
            boolean removeResource = false;

            if (intent.resourceGroup() == null) {
                // If the intent doesn't have a resource group, it means the
                // resource was registered using the intent key, so it can be
                // released
                removeResource = true;
            } else {
                // When a resource group is set, we make sure there are no other
                // intents using the same resource group, before deleting the
                // related resources.
                Long remainingIntents =
                        Tools.stream(store.getIntents())
                             .filter(i -> {
                                 return i.resourceGroup() != null
                                     && i.resourceGroup().equals(intent.resourceGroup());
                             })
                             .count();
                if (remainingIntents == 0) {
                    removeResource = true;
                }
            }

            if (removeResource) {
                // Release resources allocated to withdrawn intent
                if (!resourceService.release(resourceConsumer)) {
                    log.error("Failed to release resources allocated to {}", resourceConsumer);
                }
            }
        }
    }

    // Store delegate enabled only when performing intent throughput tests
    private class TestOnlyIntentStoreDelegate implements IntentStoreDelegate {
        @Override
        public void process(IntentData data) {
            accumulator.add(data);
        }

        @Override
        public void onUpdate(IntentData data) {
            trackerService.trackIntent(data);
        }

        @Override
        public void notify(IntentEvent event) {
            post(event);
        }
    }

    private void buildAndSubmitBatches(Iterable<Key> intentKeys,
                                       boolean compileAllFailed) {
        // Attempt recompilation of the specified intents first.
        for (Key key : intentKeys) {
            if (!store.isMaster(key)) {
                continue;
            }
            Intent intent = store.getIntent(key);
            if (intent == null) {
                continue;
            }
            if (store.getPendingData(key) != null) {
                continue;
            }
            submit(intent);
        }

        if (compileAllFailed) {
            // If required, compile all currently failed intents.
            for (Intent intent : getIntents()) {
                if (!store.isMaster(intent.key())) {
                    continue;
                }
                if (store.getPendingData(intent.key()) != null) {
                    continue;
                }
                IntentState state = getIntentState(intent.key());
                if (RECOMPILE.contains(state) || intentAllowsPartialFailure(intent)) {
                    if (WITHDRAW.contains(state)) {
                        withdraw(intent);
                    } else {
                        submit(intent);
                    }
                }
            }
        }
    }

    // Topology change delegate
    private class InternalTopoChangeDelegate implements TopologyChangeDelegate {
        @Override
        public void triggerCompile(Iterable<Key> intentKeys,
                                   boolean compileAllFailed) {
            // TODO figure out who is making excessive calls?
            log.trace("submitting {} + all?:{} for compilation", intentKeys, compileAllFailed);
            buildAndSubmitBatches(intentKeys, compileAllFailed);
        }
    }

    private class InternalBatchDelegate implements IntentBatchDelegate {
        @Override
        public void execute(Collection<IntentData> operations) {
            log.debug("Execute {} operation(s).", operations.size());
            log.trace("Execute operations: {}", operations);

            // batchExecutor is single-threaded, so only one batch is in flight at a time
            CompletableFuture.runAsync(() -> {
                // process intent until the phase reaches one of the final phases
                List<CompletableFuture<IntentData>> futures = operations.stream()
                        .map(data -> {
                            log.debug("Start processing of {} {}@{}", data.request(), data.key(), data.version());
                            return data;
                        })
                        .map(x -> CompletableFuture.completedFuture(x)
                                .thenApply(IntentManager.this::createInitialPhase)
                                .thenApplyAsync(IntentProcessPhase::process, workerExecutor)
                                .thenApply(FinalIntentProcessPhase::data)
                                .exceptionally(e -> {
                                    // When the future fails, we update the Intent to simulate the failure of
                                    // the installation/withdrawal phase and we save in the current map. In
                                    // the next round the CleanUp Thread will pick this Intent again.
                                    log.warn("Future failed", e);
                                    log.warn("Intent {} - state {} - request {}",
                                             x.key(), x.state(), x.request());
                                    switch (x.state()) {
                                        case INSTALL_REQ:
                                        case INSTALLING:
                                        case WITHDRAW_REQ:
                                        case WITHDRAWING:
                                            // TODO should we swtich based on current
                                            IntentData current = store.getIntentData(x.key());
                                            return IntentData.nextState(current, FAILED);
                                        default:
                                            return null;
                                    }
                                }))
                        .collect(Collectors.toList());

                // write multiple data to store in order
                store.batchWrite(Tools.allOf(futures).join().stream()
                                         .filter(Objects::nonNull)
                                         .collect(Collectors.toList()));
            }, batchExecutor).exceptionally(e -> {
                log.error("Error submitting batches:", e);
                // FIXME incomplete Intents should be cleaned up
                //       (transition to FAILED, etc.)

                // the batch has failed
                // TODO: maybe we should do more?
                log.error("Walk the plank, matey...");
                return null;
            }).thenRun(accumulator::ready);

        }
    }

    private IntentProcessPhase createInitialPhase(IntentData data) {
        IntentData pending = store.getPendingData(data.key());
        if (pending == null || pending.version().isNewerThan(data.version())) {
            /*
                If the pending map is null, then this intent was compiled by a
                previous batch iteration, so we can skip it.
                If the pending map has a newer request, it will get compiled as
                part of the next batch, so we can skip it.
             */
            return Skipped.getPhase();
        }
        IntentData current = store.getIntentData(data.key());
        return newInitialPhase(processor, data, current);
    }

    private class InternalIntentProcessor implements IntentProcessor {
        @Override
        public List<Intent> compile(Intent intent, List<Intent> previousInstallables) {
            return compilerRegistry.compile(intent, previousInstallables);
        }

        @Override
        public void apply(Optional<IntentData> toUninstall, Optional<IntentData> toInstall) {
            installCoordinator.installIntents(toUninstall, toInstall);
        }
    }

}
