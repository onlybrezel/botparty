/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModerateUserDto } from '../models/ModerateUserDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ModerationService {
    /**
     * Apply a moderation action (timeout / kick / ban / unban)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerModerate({
        robotId,
        requestBody,
    }: {
        robotId: string,
        requestBody: ModerateUserDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/moderation/robot/{robotId}',
            path: {
                'robotId': robotId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get moderation log for a robot (owner / staff)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetLog({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/robot/{robotId}/log',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Get moderation overview for admin/mod dashboard
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetAdminOverview({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/overview',
            query: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Get runtime, host, and LiveKit overview for staff dashboard
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetAdminRuntimeOverview(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/runtime-overview',
        });
    }
    /**
     * Queue a remote robot action from the staff dashboard
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerEnqueueStaffRobotAction({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/moderation/admin/robot/{robotId}/actions',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Get LiveKit recording status for a robot room (admin only)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetAdminRobotRecordingStatus({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/robot/{robotId}/recording',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Start LiveKit recording for a robot room (admin only)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerStartAdminRobotRecording({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/moderation/admin/robot/{robotId}/recording/start',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Stop LiveKit recording for a robot room (admin only)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerStopAdminRobotRecording({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/moderation/admin/robot/{robotId}/recording/stop',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * List available recording files (admin only)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerListAdminRecordings(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/recordings',
        });
    }
    /**
     * Stream a recording file (admin only)
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerStreamAdminRecording({
        fileName,
    }: {
        fileName: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/recordings/{fileName}',
            path: {
                'fileName': fileName,
            },
        });
    }
    /**
     * Stream a recording file via short-lived signed URL
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerStreamSignedAdminRecording({
        fileName,
        expires,
        signature,
    }: {
        fileName: string,
        expires: string,
        signature: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/recordings/{fileName}/signed',
            path: {
                'fileName': fileName,
            },
            query: {
                'expires': expires,
                'signature': signature,
            },
        });
    }
    /**
     * Get profanity counters and events across all robots for staff
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetAdminProfanityOverview(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/admin/profanity-overview',
        });
    }
    /**
     * Get profanity counters and recent events for a robot
     * @returns any
     * @throws ApiError
     */
    public static moderationControllerGetProfanityOverview({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/moderation/robot/{robotId}/profanity',
            path: {
                'robotId': robotId,
            },
        });
    }
}
