/*
 * Copyright 2016-present Open Networking Foundation
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
package org.onosproject.store.app;

import com.google.common.base.Charsets;
import com.google.common.base.MoreObjects;
import com.google.common.base.Preconditions;
import com.google.common.base.Throwables;
import com.google.common.collect.ImmutableSet;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;
import com.google.common.collect.Multimap;
import com.google.common.collect.Sets;
import org.onosproject.app.ApplicationDescription;
import org.onosproject.app.ApplicationEvent;
import org.onosproject.app.ApplicationException;
import org.onosproject.app.ApplicationIdStore;
import org.onosproject.app.ApplicationState;
import org.onosproject.app.ApplicationStore;
import org.onosproject.app.ApplicationStoreDelegate;
import org.onosproject.cluster.ClusterService;
import org.onosproject.cluster.ControllerNode;
import org.onosproject.common.app.ApplicationArchive;
import org.onosproject.core.Application;
import org.onosproject.core.ApplicationId;
import org.onosproject.core.CoreService;
import org.onosproject.core.DefaultApplication;
import org.onosproject.core.Version;
import org.onosproject.core.VersionService;
import org.onosproject.security.Permission;
import org.onosproject.store.cluster.messaging.ClusterCommunicationService;
import org.onosproject.store.cluster.messaging.MessageSubject;
import org.onosproject.store.serializers.KryoNamespaces;
import org.onosproject.store.service.ConsistentMap;
import org.onosproject.store.service.DistributedPrimitive.Status;
import org.onosproject.store.service.MapEvent;
import org.onosproject.store.service.MapEventListener;
import org.onosproject.store.service.RevisionType;
import org.onosproject.store.service.Serializer;
import org.onosproject.store.service.StorageException;
import org.onosproject.store.service.StorageService;
import org.onosproject.store.service.Topic;
import org.onosproject.store.service.Versioned;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.slf4j.Logger;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.google.common.collect.Multimaps.newSetMultimap;
import static com.google.common.collect.Multimaps.synchronizedSetMultimap;
import static com.google.common.io.ByteStreams.toByteArray;
import static java.util.concurrent.Executors.newSingleThreadExecutor;
import static java.util.concurrent.Executors.newSingleThreadScheduledExecutor;
import static java.util.concurrent.TimeUnit.MILLISECONDS;
import static org.onlab.util.Tools.groupedThreads;
import static org.onlab.util.Tools.randomDelay;
import static org.onosproject.app.ApplicationEvent.Type.APP_ACTIVATED;
import static org.onosproject.app.ApplicationEvent.Type.APP_DEACTIVATED;
import static org.onosproject.app.ApplicationEvent.Type.APP_INSTALLED;
import static org.onosproject.app.ApplicationEvent.Type.APP_PERMISSIONS_CHANGED;
import static org.onosproject.app.ApplicationEvent.Type.APP_UNINSTALLED;
import static org.onosproject.store.app.DistributedApplicationStore.InternalState.ACTIVATED;
import static org.onosproject.store.app.DistributedApplicationStore.InternalState.DEACTIVATED;
import static org.onosproject.store.app.DistributedApplicationStore.InternalState.INSTALLED;
import static org.slf4j.LoggerFactory.getLogger;

/**
 * Manages inventory of applications in a distributed data store providing
 * stronger consistency guarantees.
 */
@Component(immediate = true, service = ApplicationStore.class)
public class DistributedApplicationStore extends ApplicationArchive
        implements ApplicationStore {

    private final Logger log = getLogger(getClass());

    private static final MessageSubject APP_BITS_REQUEST = new MessageSubject("app-bits-request");

    private static final int MAX_LOAD_RETRIES = 5;
    private static final int RETRY_DELAY_MS = 2_000;

    private static final int FETCH_TIMEOUT_MS = 10_000;

    private static final int APP_LOAD_DELAY_MS = 500;

    private static List<String> pendingApps = Lists.newArrayList();

    public enum InternalState {
        INSTALLED, ACTIVATED, DEACTIVATED
    }

    private ScheduledExecutorService executor;
    private ExecutorService messageHandlingExecutor, activationExecutor;

    private ConsistentMap<ApplicationId, InternalApplicationHolder> apps;
    private Topic<Application> appActivationTopic;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ClusterCommunicationService clusterCommunicator;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ClusterService clusterService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected StorageService storageService;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected ApplicationIdStore idStore;

    @Reference(cardinality = ReferenceCardinality.MANDATORY)
    protected VersionService versionService;

    private final InternalAppsListener appsListener = new InternalAppsListener();
    private final Consumer<Application> appActivator = new AppActivator();

    private Consumer<Status> statusChangeListener;

    // Multimap to track which apps are required by others apps
    // app -> { required-by, ... }
    // Apps explicitly activated will be required by the CORE app
    private final Multimap<ApplicationId, ApplicationId> requiredBy =
            synchronizedSetMultimap(newSetMultimap(Maps.newHashMap(), Sets::newHashSet));

    private ApplicationId coreAppId;

    // Apps started in this node.
    private final Set<String> localStartedApps = Sets.newConcurrentHashSet();

    @Activate
    public void activate() {
        messageHandlingExecutor = newSingleThreadExecutor(groupedThreads("onos/store/app",
                "message-handler", log));
        clusterCommunicator.addSubscriber(APP_BITS_REQUEST,
                bytes -> new String(bytes, Charsets.UTF_8),
                name -> {
                    try {
                        log.info("Sending bits for application {}", name);
                        return toByteArray(getApplicationInputStream(name));
                    } catch (ApplicationException e) {
                        log.warn("Bits for application {} are not available on this node yet", name);
                        return null;
                    } catch (IOException e) {
                        throw new StorageException(e);
                    }
                },
                Function.identity(),
                messageHandlingExecutor);

        apps = storageService.<ApplicationId, InternalApplicationHolder>consistentMapBuilder()
                .withName("onos-apps")
                .withRelaxedReadConsistency()
                .withSerializer(Serializer.using(KryoNamespaces.API,
                        InternalApplicationHolder.class,
                        InternalState.class))
                .withVersion(versionService.version())
                .withRevisionType(RevisionType.PROPAGATE)
                .withCompatibilityFunction(this::convertApplication)
                .build();

        /* To update the version in application store if it does not matche with the local system.
           This will happen only when upgrading onos using issu or during rollback if upgrade does not work.
         */
        apps.asJavaMap().forEach((appId, holder) -> apps.asJavaMap()
                .put(appId, convertApplication(holder, versionService.version())));

        appActivationTopic = storageService.<Application>topicBuilder()
            .withName("onos-apps-activation-topic")
            .withSerializer(Serializer.using(KryoNamespaces.API))
            .withVersion(versionService.version())
            .withRevisionType(RevisionType.PROPAGATE)
            .withCompatibilityFunction(this::convertApplication)
            .build();

        activationExecutor = newSingleThreadExecutor(groupedThreads("onos/store/app",
                "app-activation", log));
        appActivationTopic.subscribe(appActivator, activationExecutor);

        executor = newSingleThreadScheduledExecutor(groupedThreads("onos/app", "store", log));
        statusChangeListener = status -> {
            if (status == Status.ACTIVE) {
                executor.execute(this::bootstrapExistingApplications);
            }
        };
        apps.addListener(appsListener, activationExecutor);
        apps.addStatusChangeListener(statusChangeListener);
        coreAppId = getId(CoreService.CORE_APP_NAME);

        downloadMissingApplications();
        activateExistingApplications();
        log.info("Started");
    }

    /**
     * Converts the version of the application in store to the version of the local application.
     */
    private InternalApplicationHolder convertApplication(InternalApplicationHolder appHolder, Version version) {
        // Load the application description from disk. If the version doesn't match the persisted
        // version, update the stored application with the new version.
        ApplicationDescription appDesc = null;
        try {
            appDesc = getApplicationDescription(appHolder.app.id().name());
        } catch (ApplicationException e) {
            // If external application is not present then just ignore it as it will be installed from other onos nodes
            log.warn("Application : {} not found in disk", appHolder.app.id().name());
        }
        if (appDesc != null && !appDesc.version().equals(appHolder.app().version())) {
            log.info("Updating app version to : {} in store for app : {}", appDesc.version(), appHolder.app.id());
            Application newApplication = DefaultApplication.builder(appDesc)
                .withAppId(appHolder.app.id())
                .build();
            return new InternalApplicationHolder(
                newApplication, appHolder.state, appHolder.permissions);
        }
        return appHolder;
    }

    /**
     * Converts the versions of stored applications propagated from the prior version to the local application versions.
     */
    private Application convertApplication(Application app, Version version) {
        // Load the application description from disk. If the version doesn't match the persisted
        // version, update the stored application with the new version.
        ApplicationDescription appDesc = getApplicationDescription(app.id().name());
        if (!appDesc.version().equals(app.version())) {
            return DefaultApplication.builder(appDesc)
                .withAppId(app.id())
                .build();
        }
        return app;
    }

    /**
     * Downloads any missing bits for installed applications.
     */
    private void downloadMissingApplications() {
        log.info("Going to download missing applications");
        apps.asJavaMap().forEach((appId, holder) -> fetchBitsIfNeeded(holder.app));
    }

    /**
     * Activates applications that should be activated according to the distributed store.
     */
    private void activateExistingApplications() {
        log.info("Going to activate existing applications");
        getApplicationNames().forEach(appName -> {
            // Only update the application version if the application has already been installed.
            ApplicationId appId = getId(appName);
            if (appId != null) {
                ApplicationDescription appDesc = getApplicationDescription(appName);
                InternalApplicationHolder appHolder = Versioned.valueOrNull(apps.get(appId));

                if (appHolder != null && appHolder.state == ACTIVATED) {
                    log.debug("App name and version from local system : {}, {}", appDesc.name(), appDesc.version());
                    log.debug("App name and version from app store : {}, {}", appHolder.app.id(),
                             appHolder.app().version());
                }
                // If the application has already been activated, set the local state to active.
                if (appHolder != null
                    && appDesc.version().equals(appHolder.app().version())
                    && appHolder.state == ACTIVATED) {
                    log.info("Going to activate app : {}", appHolder.app.id());
                    setActive(appName);
                    updateTime(appName);
                }
            }
        });
    }


    /**
     * Processes existing applications from the distributed map. This is done to
     * account for events that this instance may be have missed due to a staggered start.
     */
    private void bootstrapExistingApplications() {
        apps.asJavaMap().forEach((appId, holder) -> setupApplicationAndNotify(appId, holder.app(), holder.state()));
    }

    /**
     * Loads the application inventory from the disk and activates apps if
     * they are marked to be active.
     */
    private void loadFromDisk() {
        getApplicationNames().forEach(appName -> {
            Application app = loadFromDisk(appName);
            if (app != null && isActive(app.id().name())) {
                // For now, apps loaded from disk will be marked as having been
                // activated explicitly, which means they won't deactivate
                // implicitly when all dependent apps have been deactivated.
                requiredBy.put(app.id(), coreAppId);
                activate(app.id(), false);
                // TODO Load app permissions
            }
        });
    }

    private Application loadFromDisk(String appName) {
        pendingApps.add(appName);

        for (int i = 0; i < MAX_LOAD_RETRIES; i++) {
            try {
                // Directly return if app already exists
                ApplicationId appId = getId(appName);
                if (appId != null) {
                    Application application = getApplication(appId);
                    if (application != null) {
                        pendingApps.remove(appName);
                        return application;
                    }
                }

                ApplicationDescription appDesc = getApplicationDescription(appName);

                Optional<String> loop = appDesc.requiredApps().stream()
                        .filter(app -> pendingApps.contains(app)).findAny();
                if (loop.isPresent()) {
                    log.error("Circular app dependency detected: {} -> {}", pendingApps, loop.get());
                    pendingApps.remove(appName);
                    return null;
                }

                boolean success = appDesc.requiredApps().stream()
                        .noneMatch(requiredApp -> loadFromDisk(requiredApp) == null);
                pendingApps.remove(appName);

                if (success) {
                    return create(appDesc, false);
                } else {
                    log.error("Unable to load dependencies for application {}", appName);
                    return null;
                }

            } catch (Exception e) {
                log.warn("Unable to load application {} from disk: {}; retrying",
                         appName,
                         Throwables.getRootCause(e).getMessage());
                log.debug("Full error details:", e);
                randomDelay(RETRY_DELAY_MS); //FIXME: This is a deliberate hack; fix in Falcon
            }
        }
        pendingApps.remove(appName);
        log.error("Unable to load application {}", appName);
        return null;
    }

    @Deactivate
    public void deactivate() {
        clusterCommunicator.removeSubscriber(APP_BITS_REQUEST);
        apps.removeStatusChangeListener(statusChangeListener);
        apps.removeListener(appsListener);
        appActivationTopic.unsubscribe(appActivator);
        messageHandlingExecutor.shutdown();
        activationExecutor.shutdown();
        executor.shutdown();
        log.info("Stopped");
    }

    @Override
    public void setDelegate(ApplicationStoreDelegate delegate) {
        super.setDelegate(delegate);
        executor.execute(this::bootstrapExistingApplications);
        executor.schedule((Runnable) this::loadFromDisk, APP_LOAD_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    @Override
    public Set<Application> getApplications() {
        return ImmutableSet.copyOf(apps.values()
                .stream()
                .map(Versioned::value)
                .map(InternalApplicationHolder::app)
                .collect(Collectors.toSet()));
    }

    @Override
    public ApplicationId getId(String name) {
        return idStore.getAppId(name);
    }

    @Override
    public Application getApplication(ApplicationId appId) {
        InternalApplicationHolder appHolder = Versioned.valueOrNull(apps.get(appId));
        return appHolder != null ? appHolder.app() : null;
    }

    @Override
    public ApplicationState getState(ApplicationId appId) {
        InternalApplicationHolder appHolder = Versioned.valueOrNull(apps.get(appId));
        InternalState state = appHolder != null ? appHolder.state() : null;
        return state == null ? null : state == ACTIVATED ? ApplicationState.ACTIVE : ApplicationState.INSTALLED;
    }

    @Override
    public Application create(InputStream appDescStream) {
        ApplicationDescription appDesc = saveApplication(appDescStream);
        if (hasPrerequisites(appDesc)) {
            return create(appDesc, true);
        }
        // Purge bits off disk if we don't have prerequisites to allow app to be
        // reinstalled later
        purgeApplication(appDesc.name());
        throw new ApplicationException("Missing dependencies for app " + appDesc.name());
    }

    private boolean hasPrerequisites(ApplicationDescription app) {
        for (String required : app.requiredApps()) {
            ApplicationId id = getId(required);
            if (id == null || getApplication(id) == null) {
                log.error("{} required for {} not available", required, app.name());
                return false;
            }
        }
        return true;
    }

    private Application create(ApplicationDescription appDesc, boolean updateTime) {
        Application app = registerApp(appDesc);
        if (updateTime) {
            updateTime(app.id().name());
        }
        InternalApplicationHolder previousApp =
                Versioned.valueOrNull(apps.putIfAbsent(app.id(), new InternalApplicationHolder(app, INSTALLED, null)));
        return previousApp != null ? previousApp.app() : app;
    }

    @Override
    public void remove(ApplicationId appId) {
        uninstallDependentApps(appId);
        apps.remove(appId);
    }

    // Uninstalls all apps that depend on the given app.
    private void uninstallDependentApps(ApplicationId appId) {
        getApplications().stream()
                .filter(a -> a.requiredApps().contains(appId.name()))
                .forEach(a -> remove(a.id()));
    }

    @Override
    public void activate(ApplicationId appId) {
        activate(appId, coreAppId);
    }

    private void activate(ApplicationId appId, ApplicationId forAppId) {
        requiredBy.put(appId, forAppId);
        activate(appId, true);
    }

    private void activate(ApplicationId appId, boolean updateTime) {
        Versioned<InternalApplicationHolder> vAppHolder = apps.get(appId);
        if (vAppHolder != null) {
            if (log.isTraceEnabled()) {
                log.trace("Activating {}", appId);
            }
            if (updateTime) {
                updateTime(appId.name());
            }
            activateRequiredApps(vAppHolder.value().app());

            apps.computeIf(appId, v -> v != null && v.state() != ACTIVATED,
                    (k, v) -> new InternalApplicationHolder(
                            v.app(), ACTIVATED, v.permissions()));
            appActivationTopic.publish(vAppHolder.value().app());
            appActivationTopic.publish(null); // FIXME: Once ONOS-6977 is fixed
        }
    }

    // Activates all apps required by this application.
    private void activateRequiredApps(Application app) {
        app.requiredApps().stream().map(this::getId).forEach(id -> activate(id, app.id()));
    }

    @Override
    public void deactivate(ApplicationId appId) {
        deactivateDependentApps(appId);
        deactivate(appId, coreAppId);
    }

    private void deactivate(ApplicationId appId, ApplicationId forAppId) {
        requiredBy.remove(appId, forAppId);
        if (requiredBy.get(appId).isEmpty()) {
            AtomicBoolean stateChanged = new AtomicBoolean(false);
            apps.computeIf(appId,
                    v -> v != null && v.state() != DEACTIVATED,
                    (k, v) -> {
                        stateChanged.set(true);
                        return new InternalApplicationHolder(v.app(), DEACTIVATED, v.permissions());
                    });
            if (stateChanged.get()) {
                updateTime(appId.name());
                deactivateRequiredApps(appId);
            }
        }
    }

    // Deactivates all apps that require this application.
    private void deactivateDependentApps(ApplicationId appId) {
        apps.values()
                .stream()
                .map(Versioned::value)
                .filter(a -> a.state() == ACTIVATED)
                .filter(a -> a.app().requiredApps().contains(appId.name()))
                .forEach(a -> deactivate(a.app().id()));
    }

    // Deactivates all apps required by this application.
    private void deactivateRequiredApps(ApplicationId appId) {
        getApplication(appId).requiredApps()
                .stream()
                .map(this::getId)
                .map(apps::get)
                .map(Versioned::value)
                .filter(a -> a.state() == ACTIVATED)
                .forEach(a -> deactivate(a.app().id(), appId));
    }

    @Override
    public Set<Permission> getPermissions(ApplicationId appId) {
        InternalApplicationHolder app = Versioned.valueOrNull(apps.get(appId));
        return app != null ? ImmutableSet.copyOf(app.permissions()) : ImmutableSet.of();
    }

    @Override
    public void setPermissions(ApplicationId appId, Set<Permission> permissions) {
        AtomicBoolean permissionsChanged = new AtomicBoolean(false);
        Versioned<InternalApplicationHolder> appHolder = apps.computeIf(appId,
                v -> v != null && !Sets.symmetricDifference(v.permissions(), permissions).isEmpty(),
                (k, v) -> {
                    permissionsChanged.set(true);
                    return new InternalApplicationHolder(v.app(), v.state(), ImmutableSet.copyOf(permissions));
                });
        if (permissionsChanged.get()) {
            if (log.isTraceEnabled()) {
                log.trace("Permission changed for {}", appId);
            }
            notifyDelegate(new ApplicationEvent(APP_PERMISSIONS_CHANGED, appHolder.value().app()));
        }
    }

    @Override
    public InputStream getApplicationArchive(ApplicationId appId) {
        return getApplicationInputStream(appId.name());
    }

    private class AppActivator implements Consumer<Application> {
        @Override
        public void accept(Application app) {
            if (app != null) { // FIXME: Once ONOS-6977 is fixed
                if (log.isTraceEnabled()) {
                    log.trace("Received an activation for {}", app.id());
                }
                String appName = app.id().name();
                installAppIfNeeded(app);
                setActive(appName);
                boolean ready = localStartedApps.containsAll(app.requiredApps());
                if (ready && delegate != null) {
                    notifyDelegate(new ApplicationEvent(APP_ACTIVATED, app));
                    localStartedApps.add(appName);
                } else if (delegate == null) {
                    log.warn("Postponing app activation {} due to the delegate being null", app.id());
                } else {
                    log.warn("Postponing app activation {} due to req apps being not ready", app.id());
                }
            }
        }
    }

    /**
     * Listener to application state distributed map changes.
     */
    private final class InternalAppsListener
            implements MapEventListener<ApplicationId, InternalApplicationHolder> {
        @Override
        public void event(MapEvent<ApplicationId, InternalApplicationHolder> event) {
            if (delegate == null) {
                return;
            }

            ApplicationId appId = event.key();
            InternalApplicationHolder newApp = event.newValue() == null ? null : event.newValue().value();
            InternalApplicationHolder oldApp = event.oldValue() == null ? null : event.oldValue().value();
            if (event.type() == MapEvent.Type.UPDATE && (newApp == null || oldApp == null ||
                    newApp.state() == oldApp.state())) {
                log.warn("Can't update the application {}", event.key());
                return;
            }
            if ((event.type() == MapEvent.Type.INSERT || event.type() == MapEvent.Type.UPDATE) && newApp != null) {
                setupApplicationAndNotify(appId, newApp.app(), newApp.state());
            } else if (event.type() == MapEvent.Type.REMOVE && oldApp != null) {
                if (log.isTraceEnabled()) {
                    log.trace("{} has been uninstalled", appId);
                }
                notifyDelegate(new ApplicationEvent(APP_UNINSTALLED, oldApp.app()));
                purgeApplication(appId.name());
                localStartedApps.remove(appId.name());
            } else {
                log.warn("Can't perform {} on application {}", event.type(), event.key());
            }
        }
    }

    private void setupApplicationAndNotify(ApplicationId appId, Application app, InternalState state) {
        // ACTIVATED state is handled separately in NextAppToActivateValueListener
        if (state == INSTALLED) {
            fetchBitsIfNeeded(app);
            if (log.isTraceEnabled()) {
                log.trace("{} has been installed", app.id());
            }
            notifyDelegate(new ApplicationEvent(APP_INSTALLED, app));
        } else if (state == DEACTIVATED) {
            if (log.isTraceEnabled()) {
                log.trace("{} has been deactivated", app.id());
            }
            clearActive(appId.name());
            notifyDelegate(new ApplicationEvent(APP_DEACTIVATED, app));
            localStartedApps.remove(appId.name());
        }
    }

    /**
     * Determines if the application bits are available locally.
     */
    private boolean appBitsAvailable(Application app) {
        try {
            ApplicationDescription appDesc = getApplicationDescription(app.id().name());
            return appDesc.version().equals(app.version());
        } catch (ApplicationException e) {
            return false;
        }
    }

    /**
     * Fetches the bits from the cluster peers if necessary.
     */
    private void fetchBitsIfNeeded(Application app) {
        if (!appBitsAvailable(app)) {
            fetchBits(app, false);
        }
    }

    /**
     * Installs the application if necessary from the application peers.
     */
    private void installAppIfNeeded(Application app) {
        if (!appBitsAvailable(app)) {
            fetchBits(app, true);
        }
    }

    /**
     * Fetches the bits from the cluster peers.
     */
    private void fetchBits(Application app, boolean delegateInstallation) {
        ControllerNode localNode = clusterService.getLocalNode();
        CountDownLatch latch = new CountDownLatch(1);

        // FIXME: send message with name & version to make sure we don't get served old bits

        log.info("Downloading bits for application {} for version : {}", app.id().name(), app.version());
        for (ControllerNode node : clusterService.getNodes()) {
            if (latch.getCount() == 0) {
                break;
            }
            if (node.equals(localNode)) {
                continue;
            }
            clusterCommunicator.sendAndReceive(app.id().name(),
                    APP_BITS_REQUEST,
                    s -> s.getBytes(Charsets.UTF_8),
                    Function.identity(),
                    node.id())
                    .whenCompleteAsync((bits, error) -> {
                        if (error == null && latch.getCount() > 0) {
                            saveApplication(new ByteArrayInputStream(bits));
                            log.info("Downloaded bits for application {} from node {}",
                                    app.id().name(), node.id());
                            latch.countDown();
                            if (delegateInstallation) {
                                if (log.isTraceEnabled()) {
                                    log.trace("Delegate installation for {}", app.id());
                                }
                                notifyDelegate(new ApplicationEvent(APP_INSTALLED, app));
                            }
                        } else if (error != null) {
                            log.warn("Unable to fetch bits for application {} from node {}",
                                    app.id().name(), node.id());
                        }
                    }, messageHandlingExecutor);
        }

        try {
            if (!latch.await(FETCH_TIMEOUT_MS, MILLISECONDS)) {
                log.warn("Unable to fetch bits for application {}", app.id().name());
            }
        } catch (InterruptedException e) {
            log.warn("Interrupted while fetching bits for application {}", app.id().name());
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Produces a registered application from the supplied description.
     */
    private Application registerApp(ApplicationDescription appDesc) {
        ApplicationId appId = idStore.registerApplication(appDesc.name());
        return DefaultApplication
                .builder(appDesc)
                .withAppId(appId)
                .build();
    }

    /**
     * Internal class for holding app information.
     */
    private static final class InternalApplicationHolder {
        private final Application app;
        private final InternalState state;
        private final Set<Permission> permissions;

        @SuppressWarnings("unused")
        private InternalApplicationHolder() {
            app = null;
            state = null;
            permissions = null;
        }

        private InternalApplicationHolder(Application app, InternalState state, Set<Permission> permissions) {
            this.app = Preconditions.checkNotNull(app);
            this.state = state;
            this.permissions = permissions == null ? null : ImmutableSet.copyOf(permissions);
        }

        public Application app() {
            return app;
        }

        public InternalState state() {
            return state;
        }

        public Set<Permission> permissions() {
            return permissions;
        }

        @Override
        public String toString() {
            return MoreObjects.toStringHelper(getClass())
                    .add("app", app.id())
                    .add("state", state)
                    .toString();
        }
    }
}
