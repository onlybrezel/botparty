'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { DashboardAllowlistSection } from '@/components/dashboard/dashboard-allowlist-section';
import { DashboardFleetSummary } from '@/components/dashboard/dashboard-fleet-summary';
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar';
import { DashboardTokenSection } from '@/components/dashboard/dashboard-token-section';
import { RobotCardGrid } from '@/components/dashboard/robot-card-grid';
import { RobotCardGridSkeleton } from '@/components/dashboard/robot-card-grid-skeleton';
import { useDashboardPage } from '@/components/dashboard/use-dashboard-page';

const CreateRobotPanel = dynamic(() =>
  import('@/components/dashboard/create-robot-panel').then((module) => module.CreateRobotPanel),
);
const DashboardOperationsSection = dynamic(() =>
  import('@/components/dashboard/dashboard-operations-section').then((module) => module.DashboardOperationsSection),
);
const DashboardSettingsSection = dynamic(() =>
  import('@/components/dashboard/dashboard-settings-section').then((module) => module.DashboardSettingsSection),
);

const DashboardPreview = dynamic(
  () =>
    import('@/components/dashboard/dashboard-preview').then((module) => module.DashboardPreview),
  {
    ssr: false,
    loading: () => (
      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading preview...
      </div>
    ),
  },
);

const ControlButtonEditor = dynamic(
  () =>
    import('@/components/dashboard/control-button-editor').then(
      (module) => module.ControlButtonEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading control editor...
      </div>
    ),
  },
);

const MonitoringSection = dynamic(
  () =>
    import('@/components/dashboard/monitoring-section').then((module) => module.MonitoringSection),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading monitoring...
      </div>
    ),
  },
);

const DashboardWebhooksSection = dynamic(
  () =>
    import('@/components/dashboard/dashboard-webhooks-section').then(
      (module) => module.DashboardWebhooksSection,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading webhooks...
      </div>
    ),
  },
);

export default function DashboardPage() {
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  useEffect(() => {
    const openCreatePanelFromHash = () => {
      if (window.location.hash === '#new-robot') {
        setCreatePanelOpen(true);
      }
    };

    openCreatePanelFromHash();
    window.addEventListener('hashchange', openCreatePanelFromHash);
    return () => window.removeEventListener('hashchange', openCreatePanelFromHash);
  }, []);
  const {
    accessToken,
    hasHydrated,
    robots,
    createForm,
    setCreateForm,
    selectedId,
    setSelectedId,
    editForm,
    setEditForm,
    showToken,
    setShowToken,
    controlDraft,
    setControlDraft,
    controlPreset,
    setControlPreset,
    editingControlId,
    setEditingControlId,
    controlEditDraft,
    setControlEditDraft,
    controlEditPreset,
    setControlEditPreset,
    allowlistUsername,
    setAllowlistUsername,
    newIngressCameraId,
    setNewIngressCameraId,
    newIngressLabel,
    setNewIngressLabel,
    newIngressCompatibilityMode,
    setNewIngressCompatibilityMode,
    obsHelpOpen,
    setObsHelpOpen,
    activeSectionId,
    setActiveSectionId,
    loading,
    error,
    status,
    creating,
    selectedRobot,
    saving,
    deleting,
    regenerating,
    regeneratingInvite,
    opLoading,
    pendingActionTypes,
    logsLoading,
    diagLogs,
    telemetry,
    onboarding,
    preview,
    previewVersion,
    controlButtons,
    controlsLoading,
    creatingControl,
    controlOp,
    allowedUsers,
    allowlistLoading,
    allowlistOp,
    ingressCameras,
    ingressLoading,
    ingressOp,
    webhooks,
    webhooksLoading,
    webhookOp,
    webhookUrl,
    setWebhookUrl,
    webhookEvents,
    webhookActive,
    setWebhookActive,
    createdWebhookSecret,
    editFormRef,
    thumbnailInputRef,
    previewContainerRef,
    thumbnailOp,
    handleCreate,
    handleSave,
    handleDelete,
    handleRegenerate,
    copyToken,
    buildRobotRoomHref,
    buildSelectedRobotRoomHref,
    buildSelectedRobotEmbedHref,
    handleThumbnailFileChange,
    capturePreviewThumbnail,
    removeThumbnail,
    regenerateInviteCode,
    copyInviteLink,
    copyEmbedCode,
    createIngressCamera,
    deleteIngressCamera,
    copyIngressEndpoint,
    toggleWebhookEvent,
    createWebhook,
    deleteWebhook,
    runRobotAction,
    refreshLogs,
    handleCreateControl,
    handleToggleControl,
    startEditControl,
    saveControlEdit,
    handleDeleteControl,
    moveControl,
    addAllowedUser,
    removeAllowedUser,
    refreshPreview,
    createSlugOwner,
  } = useDashboardPage();

  const awaitingSession = !hasHydrated || !accessToken;
  const showingLoadingState = loading || awaitingSession;

  // Keep the public shell visible during hydration; robot data stays behind
  // the loading state until the authenticated session is available.
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Robots</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Create robots, manage access and operate connected clients.
          </p>
        </div>
        {showingLoadingState || robots.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreatePanelOpen((open) => !open)}
            disabled={showingLoadingState}
            aria-expanded={createPanelOpen}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)]"
          >
            <Plus className="h-4 w-4" />
            {createPanelOpen ? 'Close form' : 'Add robot'}
          </button>
        ) : null}
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      {status && (
        <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {status}
        </p>
      )}

      {!awaitingSession && (createPanelOpen || (!loading && robots.length === 0)) ? (
        <CreateRobotPanel
          createForm={createForm}
          setCreateForm={setCreateForm}
          onSubmit={handleCreate}
          creating={creating}
          loading={loading}
          slugOwner={createSlugOwner}
        />
      ) : null}

      <section className="mt-8 border-t border-[var(--border)] pt-6">
        <h2 className="mb-4 text-lg font-bold">Your robots</h2>

        {showingLoadingState ? (
          <>
            <DashboardFleetSummary robots={[]} selectedId={null} loading />
            <RobotCardGridSkeleton />
          </>
        ) : robots.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] p-8 text-center">
            <p className="text-base font-semibold">No robots yet</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Complete the form above to create your first robot room.
            </p>
          </div>
        ) : (
          <>
            <DashboardFleetSummary robots={robots} selectedId={selectedId} />
            {!selectedRobot ? (
              <RobotCardGrid robots={robots} onSelect={setSelectedId} />
            ) : (
              <div className="flex items-start gap-5">
                <DashboardSidebar
                  robots={robots}
                  selectedId={selectedId}
                  activeSectionId={activeSectionId}
                  saving={saving}
                  deleting={deleting}
                  editFormRef={editFormRef}
                  onSelect={setSelectedId}
                  onSectionSelect={(id) => {
                    setActiveSectionId(id);
                    document
                      .getElementById(id)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  onDelete={() => void handleDelete()}
                />
                <div className="min-w-0 flex-1">
                  <DashboardPreview
                    robot={selectedRobot}
                    roomHref={buildRobotRoomHref(selectedRobot)}
                    preview={preview}
                    previewVersion={previewVersion}
                    previewContainerRef={previewContainerRef}
                    onStreamStalled={() => {
                      void refreshPreview(true);
                    }}
                  />

                  <form
                    ref={editFormRef}
                    onSubmit={handleSave}
                    autoComplete="off"
                    className="flex flex-col gap-3"
                  >
                    <DashboardSettingsSection
                      robot={selectedRobot}
                      editForm={editForm}
                      setEditForm={setEditForm}
                      buildSelectedRobotRoomHref={buildSelectedRobotRoomHref}
                      copyInviteLink={copyInviteLink}
                      regenerateInviteCode={regenerateInviteCode}
                      regeneratingInvite={regeneratingInvite}
                      ingressLoading={ingressLoading}
                      ingressCameras={ingressCameras}
                      ingressOp={ingressOp}
                      newIngressCameraId={newIngressCameraId}
                      setNewIngressCameraId={setNewIngressCameraId}
                      newIngressLabel={newIngressLabel}
                      setNewIngressLabel={setNewIngressLabel}
                      newIngressCompatibilityMode={newIngressCompatibilityMode}
                      setNewIngressCompatibilityMode={setNewIngressCompatibilityMode}
                      createIngressCamera={createIngressCamera}
                      deleteIngressCamera={deleteIngressCamera}
                      copyIngressEndpoint={copyIngressEndpoint}
                      obsHelpOpen={obsHelpOpen}
                      setObsHelpOpen={setObsHelpOpen}
                      thumbnailInputRef={thumbnailInputRef}
                      handleThumbnailFileChange={handleThumbnailFileChange}
                      thumbnailOp={thumbnailOp}
                      capturePreviewThumbnail={capturePreviewThumbnail}
                      removeThumbnail={removeThumbnail}
                    />

                    <DashboardTokenSection
                      robot={selectedRobot}
                      showToken={showToken}
                      regenerating={regenerating}
                      embedCode={`<iframe src="${buildSelectedRobotEmbedHref()}" title="${selectedRobot.name} on BotParty" width="960" height="540" loading="lazy" allow="autoplay; fullscreen" style="border:0; width:100%; aspect-ratio:16 / 9;"></iframe>`}
                      onToggleVisibility={() => setShowToken((prev) => !prev)}
                      onCopyToken={() => void copyToken()}
                      onCopyEmbedCode={() => void copyEmbedCode()}
                      onRegenerate={() => void handleRegenerate()}
                    />

                    <DashboardOperationsSection
                      telemetry={telemetry}
                      onboarding={onboarding}
                      opLoading={opLoading}
                      pendingActionTypes={pendingActionTypes}
                      logsLoading={logsLoading}
                      diagLogs={diagLogs}
                      onRunAction={(type, durationSec) => void runRobotAction(type, durationSec)}
                      onRefreshLogs={() => void refreshLogs()}
                    />

                    <DashboardWebhooksSection
                      webhooksLoading={webhooksLoading}
                      webhooks={webhooks}
                      webhookUrl={webhookUrl}
                      webhookEvents={webhookEvents}
                      webhookActive={webhookActive}
                      webhookOp={webhookOp}
                      createdWebhookSecret={createdWebhookSecret}
                      onWebhookUrlChange={setWebhookUrl}
                      onToggleEvent={toggleWebhookEvent}
                      onWebhookActiveChange={setWebhookActive}
                      onCreateWebhook={() => void createWebhook()}
                      onDeleteWebhook={(webhook) => void deleteWebhook(webhook)}
                    />

                    <DashboardAllowlistSection
                      visible={editForm.roomMode === 'ALLOWED_USERS'}
                      allowlistUsername={allowlistUsername}
                      allowlistOp={allowlistOp}
                      allowlistLoading={allowlistLoading}
                      allowedUsers={allowedUsers}
                      onUsernameChange={setAllowlistUsername}
                      onAdd={() => void addAllowedUser()}
                      onRemove={(user) => void removeAllowedUser(user)}
                    />

                    <ControlButtonEditor
                      controlButtons={controlButtons}
                      controlsLoading={controlsLoading}
                      controlDraft={controlDraft}
                      setControlDraft={setControlDraft}
                      controlPreset={controlPreset}
                      setControlPreset={setControlPreset}
                      editingControlId={editingControlId}
                      controlEditDraft={controlEditDraft}
                      setControlEditDraft={setControlEditDraft}
                      controlEditPreset={controlEditPreset}
                      setControlEditPreset={setControlEditPreset}
                      setEditingControlId={setEditingControlId}
                      controlOp={controlOp}
                      creatingControl={creatingControl}
                      onCreateControl={handleCreateControl}
                      onToggleControl={handleToggleControl}
                      onStartEditControl={startEditControl}
                      onSaveControlEdit={saveControlEdit}
                      onDeleteControl={handleDeleteControl}
                      onMoveControl={moveControl}
                    />

                    <MonitoringSection telemetry={telemetry} />

                    <div className="order-5 flex flex-wrap gap-2 lg:hidden">
                      <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDelete()}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60 dark:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deleting ? 'Deleting...' : 'Delete robot'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
