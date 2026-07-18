'use client';

import dynamic from 'next/dynamic';
import { Bot, Save, Trash2 } from 'lucide-react';
import { CreateRobotPanel } from '@/components/dashboard/create-robot-panel';
import { DashboardAllowlistSection } from '@/components/dashboard/dashboard-allowlist-section';
import { DashboardFleetSummary } from '@/components/dashboard/dashboard-fleet-summary';
import { DashboardOperationsSection } from '@/components/dashboard/dashboard-operations-section';
import { DashboardSettingsSection } from '@/components/dashboard/dashboard-settings-section';
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar';
import { DashboardTokenSection } from '@/components/dashboard/dashboard-token-section';
import { RobotCardGrid } from '@/components/dashboard/robot-card-grid';
import { RobotCardGridSkeleton } from '@/components/dashboard/robot-card-grid-skeleton';
import { useDashboardPage } from '@/components/dashboard/use-dashboard-page';

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

  if (!hasHydrated || !accessToken) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15">
            <Bot className="h-5 w-5 text-violet-300" />
          </span>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Robots Dashboard</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Create robots, configure settings, and copy claim tokens for your Linux robot client.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {status && (
        <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {status}
        </p>
      )}

      <CreateRobotPanel
        createForm={createForm}
        setCreateForm={setCreateForm}
        onSubmit={handleCreate}
        creating={creating}
        loading={loading}
        slugOwner={createSlugOwner}
      />

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="mb-4 text-lg font-bold">My Robots</h2>

        {loading ? (
          <RobotCardGridSkeleton />
        ) : robots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
            <p className="text-base font-semibold">No robots yet</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Create your first robot using the form above, then follow these steps to go live:
            </p>
            <ol className="mx-auto mt-4 max-w-sm space-y-2 text-left text-sm text-[var(--muted-foreground)]">
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-bold text-violet-400">1.</span>Create a robot profile
                &amp; grab the claim token.
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-bold text-violet-400">2.</span>Install the robot
                client on your hardware (
                <a
                  href="/docs/getting-started"
                  className="underline hover:text-[var(--foreground)]"
                >
                  Getting Started guide
                </a>
                ).
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-bold text-violet-400">3.</span>Configure{' '}
                <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-xs">config.yaml</code>{' '}
                with your claim token &amp; start the client.
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 font-bold text-violet-400">4.</span>Return here — the
                robot will appear as Online once connected.
              </li>
            </ol>
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
                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-60"
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
