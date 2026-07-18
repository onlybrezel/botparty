/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddAllowedUserDto } from '../models/AddAllowedUserDto';
import type { ClaimRobotDto } from '../models/ClaimRobotDto';
import type { CreateIngressCameraDto } from '../models/CreateIngressCameraDto';
import type { CreateRobotWebhookDto } from '../models/CreateRobotWebhookDto';
import type { EnqueueActionDto } from '../models/EnqueueActionDto';
import type { IngestRobotLogsDto } from '../models/IngestRobotLogsDto';
import type { PushTelemetryDto } from '../models/PushTelemetryDto';
import type { UploadThumbnailDto } from '../models/UploadThumbnailDto';
import type { VerifyRobotAccessDto } from '../models/VerifyRobotAccessDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RobotsService {
    /**
     * List all public robots
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerFindAll({
        status,
        tag,
        q,
        sort,
        limit,
        offset,
    }: {
        status: string,
        tag: string,
        q: string,
        sort: string,
        limit: string,
        offset: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots',
            query: {
                'status': status,
                'tag': tag,
                'q': q,
                'sort': sort,
                'limit': limit,
                'offset': offset,
            },
        });
    }
    /**
     * Create a new robot
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerCreate(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots',
        });
    }
    /**
     * Get featured robots
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetFeatured(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/featured',
        });
    }
    /**
     * Get public robot overview for discovery surfaces
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetOverview(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/overview',
        });
    }
    /**
     * Get my robots
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetMyRobots(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/my',
        });
    }
    /**
     * Get private robot by slug for owner/staff
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerFindPrivateBySlug({
        slug,
    }: {
        slug: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/private/{slug}',
            path: {
                'slug': slug,
            },
        });
    }
    /**
     * Get private robot by owner username + slug for owner/staff
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerFindPrivateByUsernameAndSlug({
        username,
        slug,
    }: {
        username: string,
        slug: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/private/{username}/{slug}',
            path: {
                'username': username,
                'slug': slug,
            },
        });
    }
    /**
     * Get the server-verified host go-live checklist
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetOnboardingStatus({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/onboarding',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get robot by slug (legacy route)
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerFindBySlug({
        slug,
    }: {
        slug: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{slug}',
            path: {
                'slug': slug,
            },
        });
    }
    /**
     * Update robot settings
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerUpdate({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/robots/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Delete a robot
     * @returns void
     * @throws ApiError
     */
    public static robotsControllerDelete({
        id,
    }: {
        id: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update robot settings as staff
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerUpdateAsStaff({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/robots/admin/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Delete robot as staff
     * @returns void
     * @throws ApiError
     */
    public static robotsControllerDeleteAsStaff({
        id,
    }: {
        id: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/admin/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Upload or replace a robot thumbnail (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerUploadThumbnail({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: UploadThumbnailDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/thumbnail',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Remove a robot thumbnail (owner only)
     * @returns void
     * @throws ApiError
     */
    public static robotsControllerDeleteThumbnail({
        id,
    }: {
        id: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/{id}/thumbnail',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get a robot thumbnail image
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetThumbnail({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/thumbnail-image',
            path: {
                'id': id,
            },
        });
    }
    /**
     * List allow-listed users for a robot (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetAllowedUsers({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/allowed-users',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Add a user to the robot allow list (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerAddAllowedUser({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: AddAllowedUserDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/allowed-users',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Remove a user from the robot allow list (owner only)
     * @returns void
     * @throws ApiError
     */
    public static robotsControllerRemoveAllowedUser({
        id,
        userId,
    }: {
        id: string,
        userId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/{id}/allowed-users/{userId}',
            path: {
                'id': id,
                'userId': userId,
            },
        });
    }
    /**
     * Verify room access and issue a temporary room access grant
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerVerifyRoomAccess({
        id,
        authorization,
        cookie,
        requestBody,
    }: {
        id: string,
        authorization: string,
        cookie: string,
        requestBody: VerifyRobotAccessDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/access/verify',
            path: {
                'id': id,
            },
            headers: {
                'authorization': authorization,
                'cookie': cookie,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get paginated chat history for a robot room
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerGetChatHistory({
        id,
        authorization,
        cookie,
    }: {
        id: string,
        authorization: string,
        cookie: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/chat-messages',
            path: {
                'id': id,
            },
            headers: {
                'authorization': authorization,
                'cookie': cookie,
            },
        });
    }
    /**
     * Get robot by owner username + slug
     * @returns any
     * @throws ApiError
     */
    public static robotsControllerFindByUsernameAndSlug({
        username,
        slug,
    }: {
        username: string,
        slug: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{username}/{slug}',
            path: {
                'username': username,
                'slug': slug,
            },
        });
    }
    /**
     * Claim a robot and get LiveKit token for hardware client
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerClaim({
        requestBody,
    }: {
        requestBody: ClaimRobotDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/claim',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Heartbeat from robot hardware client
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerHeartbeat({
        authorization,
    }: {
        authorization: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/heartbeat',
            headers: {
                'authorization': authorization,
            },
        });
    }
    /**
     * Enqueue remote robot action (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerEnqueueAction({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: EnqueueActionDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/actions',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List pending remote robot actions (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerGetPendingActions({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/actions/pending',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Robot polls pending remote actions using robot bearer auth
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerPollActions({
        authorization,
    }: {
        authorization: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/actions/poll',
            headers: {
                'authorization': authorization,
            },
        });
    }
    /**
     * Robot uploads temporary diagnostics logs using robot bearer auth
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerPushLogs({
        requestBody,
    }: {
        requestBody: IngestRobotLogsDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/logs',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Robot uploads temporary runtime telemetry using robot bearer auth
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerPushTelemetry({
        requestBody,
    }: {
        requestBody: PushTelemetryDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/telemetry',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get recent temporary robot logs (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerGetLogs({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/logs',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get recent temporary robot telemetry (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotRuntimeControllerGetTelemetry({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/telemetry',
            path: {
                'id': id,
            },
        });
    }
    /**
     * List robot webhooks (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotWebhooksControllerListWebhooks({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/webhooks',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create robot webhook (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotWebhooksControllerCreateWebhook({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: CreateRobotWebhookDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/webhooks',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete robot webhook (owner only)
     * @returns void
     * @throws ApiError
     */
    public static robotWebhooksControllerDeleteWebhook({
        id,
        webhookId,
    }: {
        id: string,
        webhookId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/{id}/webhooks/{webhookId}',
            path: {
                'id': id,
                'webhookId': webhookId,
            },
        });
    }
    /**
     * List WHIP camera ingresses for a robot (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotCamerasControllerListIngressCameras({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/robots/{id}/ingress-cameras',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create or update a WHIP camera ingress for OBS/manual streaming (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotCamerasControllerCreateIngressCamera({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: CreateIngressCameraDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/ingress-cameras',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete an external camera WHIP ingress (owner only)
     * @returns void
     * @throws ApiError
     */
    public static robotCamerasControllerDeleteIngressCamera({
        id,
        ingressId,
    }: {
        id: string,
        ingressId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/robots/{id}/ingress-cameras/{ingressId}',
            path: {
                'id': id,
                'ingressId': ingressId,
            },
        });
    }
    /**
     * Regenerate claim token
     * @returns any
     * @throws ApiError
     */
    public static robotSecretsControllerRegenerateToken({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/regenerate-token',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Regenerate invite code for link-only access
     * @returns any
     * @throws ApiError
     */
    public static robotSecretsControllerRegenerateInviteCode({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/regenerate-invite',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Ensure a stable invite code exists for a robot (owner only)
     * @returns any
     * @throws ApiError
     */
    public static robotSecretsControllerEnsureInviteCode({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/robots/{id}/ensure-invite',
            path: {
                'id': id,
            },
        });
    }
}
