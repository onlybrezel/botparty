'use client';

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { CircleHelp, Copy, ExternalLink, Plus, RefreshCcw, X } from 'lucide-react';
import type { RobotCameraIngress, RobotManaged } from '@/lib/api';
import { AclPicker } from '@/components/dashboard/acl-picker';
import { Select } from '@/components/ui/select';
import type { RobotFormState, RoomMode } from './types';
import { queueModeDescription } from './types';

type Props = {
  robot: RobotManaged;
  editForm: RobotFormState;
  setEditForm: Dispatch<SetStateAction<RobotFormState>>;
  buildSelectedRobotRoomHref: (roomMode?: RoomMode) => string;
  copyInviteLink: () => void | Promise<void>;
  regenerateInviteCode: () => void | Promise<void>;
  regeneratingInvite: boolean;
  ingressLoading: boolean;
  ingressCameras: RobotCameraIngress[];
  ingressOp: string | null;
  newIngressCameraId: string;
  setNewIngressCameraId: Dispatch<SetStateAction<string>>;
  newIngressLabel: string;
  setNewIngressLabel: Dispatch<SetStateAction<string>>;
  newIngressCompatibilityMode: boolean;
  setNewIngressCompatibilityMode: Dispatch<SetStateAction<boolean>>;
  createIngressCamera: () => void | Promise<void>;
  deleteIngressCamera: (ingressId: string) => void | Promise<void>;
  copyIngressEndpoint: (endpointUrl: string) => void | Promise<void>;
  obsHelpOpen: boolean;
  setObsHelpOpen: Dispatch<SetStateAction<boolean>>;
  thumbnailInputRef: RefObject<HTMLInputElement | null>;
  handleThumbnailFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  thumbnailOp: 'upload' | 'snapshot' | 'remove' | null;
  capturePreviewThumbnail: (options?: { silent?: boolean }) => void | Promise<void>;
  removeThumbnail: () => void | Promise<void>;
};

export function DashboardSettingsSection({
  robot,
  editForm,
  setEditForm,
  buildSelectedRobotRoomHref,
  copyInviteLink,
  regenerateInviteCode,
  regeneratingInvite,
  ingressLoading,
  ingressCameras,
  ingressOp,
  newIngressCameraId,
  setNewIngressCameraId,
  newIngressLabel,
  setNewIngressLabel,
  newIngressCompatibilityMode,
  setNewIngressCompatibilityMode,
  createIngressCamera,
  deleteIngressCamera,
  copyIngressEndpoint,
  obsHelpOpen,
  setObsHelpOpen,
  thumbnailInputRef,
  handleThumbnailFileChange,
  thumbnailOp,
  capturePreviewThumbnail,
  removeThumbnail,
}: Props) {
  return (
    <>
      <div id="section-settings" className="scroll-mt-4 flex items-center gap-3">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Settings
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Robot Name</label>
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            value={editForm.name}
            onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">URL Slug</label>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
            <span className="shrink-0 text-[var(--muted-foreground)]">/robot/{robot.owner.username}/</span>
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              autoComplete="off"
              inputMode="text"
              spellCheck={false}
              value={editForm.slug}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                }))
              }
              placeholder={robot.slug}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              minLength={3}
              maxLength={50}
              title="3-50 lowercase letters, numbers, and hyphens. No leading or trailing hyphen."
            />
          </div>
          {editForm.slug && editForm.slug !== robot.slug ? (
            <p className="text-[10px] text-amber-400">Old URL will redirect to the new one automatically.</p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Room Access</label>
          <Select
            className="bg-[var(--background)]"
            value={editForm.roomMode}
            onChange={(event) => setEditForm((prev) => ({ ...prev, roomMode: event.target.value as RoomMode }))}
          >
            <option value="PUBLIC">Public (anyone can view and control)</option>
            <option value="UNLISTED">Unlisted (hidden from explore, direct link only)</option>
            <option value="LINK_ONLY">Link only (share via invite link)</option>
            <option value="PASSWORD">Password protected</option>
            <option value="ALLOWED_USERS">Allowed users only</option>
            <option value="PRIVATE">Private (owner only)</option>
          </Select>
        </div>

        {editForm.roomMode === 'PASSWORD' ? (
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Room Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              value={editForm.accessPassword}
              onChange={(event) => setEditForm((prev) => ({ ...prev, accessPassword: event.target.value }))}
              placeholder="Room password"
            />
          </div>
        ) : null}

        {editForm.roomMode === 'LINK_ONLY' && robot.inviteCode ? (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Invite Link</p>
            <code className="block break-all text-xs text-[var(--foreground)]">
              {buildSelectedRobotRoomHref('LINK_ONLY')}
            </code>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Invite code: <span className="font-semibold text-[var(--foreground)]">{robot.inviteCode}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyInviteLink()}
                aria-label={`Copy invite link for ${robot.name}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy invite link
              </button>
              <a
                href={buildSelectedRobotRoomHref('LINK_ONLY')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open invite link
              </a>
              <button
                type="button"
                onClick={() => void regenerateInviteCode()}
                disabled={regeneratingInvite}
                aria-label={`Regenerate invite link for ${robot.name}`}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-60"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {regeneratingInvite ? 'Regenerating...' : 'Renew invite link'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Queue Mode
            <span title="First come, first served gives control to the next user in line. Voting lets viewers vote for the next controller. Disabled turns queueing off entirely.">
              <CircleHelp className="h-3.5 w-3.5" />
            </span>
          </label>
          <Select
            className="bg-[var(--background)]"
            value={editForm.queueMode}
            onChange={(event) =>
              setEditForm((prev) => ({
                ...prev,
                queueMode: event.target.value as RobotFormState['queueMode'],
              }))
            }
          >
            <option value="FIRST_COME">First come, first served</option>
            <option value="VOTING">Voting</option>
            <option value="DISABLED">Disabled</option>
          </Select>
          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {queueModeDescription(editForm.queueMode)}
          </p>
        </div>

        <AclPicker
          title="Video Access"
          value={editForm.aclVideo}
          onChange={(value) => setEditForm((prev) => ({ ...prev, aclVideo: value }))}
        />
        <AclPicker
          title="Control Access"
          value={editForm.aclControl}
          onChange={(value) => setEditForm((prev) => ({ ...prev, aclControl: value }))}
        />
        <AclPicker
          title="Chat Access"
          value={editForm.aclChat}
          onChange={(value) => setEditForm((prev) => ({ ...prev, aclChat: value }))}
        />
        <AclPicker
          title="E-STOP Access"
          value={editForm.aclEStop}
          onChange={(value) => setEditForm((prev) => ({ ...prev, aclEStop: value }))}
        />

        <div className="flex items-center gap-2 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
            Stream
          </span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Target Bitrate (kbps)
          </label>
          <input
            type="number"
            min={150}
            max={3000}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            value={editForm.targetBitrateKbps}
            onChange={(event) => setEditForm((prev) => ({ ...prev, targetBitrateKbps: event.target.value }))}
            placeholder="e.g. 1800"
          />
        </div>

        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              External Camera Feed (OBS via WHIP)
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setObsHelpOpen(true)}
                aria-label="Open OBS connection help"
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                How to connect
              </button>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {ingressLoading ? 'Loading...' : `${ingressCameras.length} configured`}
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">
            Add one or more camera feeds. Use camera IDs like front, rear, arm. In OBS, paste the endpoint
            URL as WHIP server.
          </p>

          <div className="mb-2 flex gap-1.5">
            <input
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              placeholder="Camera ID (e.g. front)"
              value={newIngressCameraId}
              onChange={(event) => setNewIngressCameraId(event.target.value)}
            />
            <input
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              placeholder="Display label (optional)"
              value={newIngressLabel}
              onChange={(event) => setNewIngressLabel(event.target.value)}
            />
            <button
              type="button"
              onClick={() => void createIngressCamera()}
              disabled={Boolean(ingressOp)}
              aria-label="Add external camera ingress"
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={newIngressCompatibilityMode}
              onChange={(event) => setNewIngressCompatibilityMode(event.target.checked)}
              className="h-3 w-3"
            />
            Compatibility mode (enable when OBS has WHIP handshake issues)
          </label>

          {ingressCameras.length === 0 ? (
            <p className="text-[10px] italic text-[var(--muted-foreground)]">No external camera feeds configured yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {ingressCameras.map((entry) => {
                const deleting = ingressOp === `delete:${entry.ingressId}`;
                return (
                  <div
                    key={entry.ingressId}
                    className="rounded border border-[var(--border)] bg-[var(--card)] p-1.5 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="truncate">
                        <p className="truncate font-semibold">{entry.cameraId ?? 'default'}</p>
                      </div>
                      <span
                        className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${
                          entry.isLive
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-[var(--border)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {entry.isLive ? 'LIVE' : 'Off'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void copyIngressEndpoint(entry.endpointUrl)}
                        aria-label={`Copy WHIP URL for ${entry.cameraId ?? 'default'} camera`}
                        className="flex-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[8px] hover:border-[var(--muted-foreground)]"
                      >
                        Copy URL
                      </button>
                      {entry.cameraId ? (
                        <button
                          type="button"
                          onClick={() => void deleteIngressCamera(entry.ingressId)}
                          disabled={Boolean(ingressOp)}
                          aria-label={`Delete ingress for ${entry.cameraId ?? 'default'} camera`}
                          className="rounded border border-red-500/40 px-1.5 py-0.5 text-[8px] text-red-300 disabled:opacity-60"
                        >
                          {deleting ? '...' : 'Del'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {obsHelpOpen ? (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setObsHelpOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold">OBS Low-Latency Setup</h3>
                <button
                  type="button"
                  onClick={() => setObsHelpOpen(false)}
                  className="rounded border border-[var(--border)] p-1.5"
                  aria-label="Close OBS help"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-sm">
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                  30s delay is usually OBS buffering/transcoding settings, not WHIP itself.
                </p>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="font-semibold">Recommended OBS output values</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
                    <li>Encoder: H.264 (NVENC/VAAPI/QSV or x264 veryfast)</li>
                    <li>Keyframe interval: 1s (max 2s)</li>
                    <li>B-frames: 0</li>
                    <li>Rate control: CBR</li>
                    <li>Bitrate: 1200-3500 kbps (depending on resolution)</li>
                    <li>Disable any Stream Delay in OBS</li>
                    <li>Advanced Network: Low Latency Mode ON</li>
                  </ul>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="font-semibold">In this dashboard</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
                    <li>Keep Compatibility mode OFF for minimum latency.</li>
                    <li>Use Compatibility mode only if the stream fails to appear.</li>
                    <li>Viewer only shows the camera when OBS is actively publishing.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Max Turn Time (ms)</label>
          <input
            type="number"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            value={editForm.maxTurnTime}
            onChange={(event) => setEditForm((prev) => ({ ...prev, maxTurnTime: Number(event.target.value) }))}
            placeholder="e.g. 60000"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Thumbnail</label>
        <input
          ref={thumbnailInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void handleThumbnailFileChange(event)}
          className="hidden"
        />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              disabled={thumbnailOp !== null}
              aria-label={`Upload thumbnail for ${robot.name}`}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {thumbnailOp === 'upload' ? 'Uploading...' : 'Upload image'}
            </button>
            <button
              type="button"
              onClick={() => void capturePreviewThumbnail()}
              disabled={thumbnailOp !== null || (robot.status !== 'ONLINE' && robot.status !== 'BUSY')}
              aria-label={`Capture live thumbnail for ${robot.name}`}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {thumbnailOp === 'snapshot' ? 'Capturing...' : 'Use live snapshot'}
            </button>
            {robot.thumbnailUrl ? (
              <button
                type="button"
                onClick={() => void removeThumbnail()}
                disabled={thumbnailOp !== null}
                aria-label={`Remove thumbnail for ${robot.name}`}
                className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 disabled:opacity-60"
              >
                {thumbnailOp === 'remove' ? 'Removing...' : 'Remove thumbnail'}
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Upload an image, or capture the current frame from the first live camera when the robot is online.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Description</label>
        <textarea
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          rows={3}
          value={editForm.description}
          onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder="Describe your robot and how viewers should use it"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Tags</label>
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          value={editForm.tags}
          onChange={(event) => setEditForm((prev) => ({ ...prev, tags: event.target.value }))}
          placeholder="comma separated, e.g. rover, camera, claw"
        />
      </div>
    </>
  );
}
