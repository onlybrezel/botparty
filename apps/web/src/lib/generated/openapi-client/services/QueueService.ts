/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class QueueService {
    /**
     * Get queue for a robot
     * @returns any
     * @throws ApiError
     */
    public static queueControllerGetQueue({
        robotId,
        authorization,
        cookie,
        roomAccessToken,
        guestSessionId,
    }: {
        robotId: string,
        authorization: string,
        cookie: string,
        roomAccessToken: string,
        guestSessionId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/queue/{robotId}',
            path: {
                'robotId': robotId,
            },
            headers: {
                'authorization': authorization,
                'cookie': cookie,
            },
            query: {
                'roomAccessToken': roomAccessToken,
                'guestSessionId': guestSessionId,
            },
        });
    }
    /**
     * Join the control queue
     * @returns any
     * @throws ApiError
     */
    public static queueControllerJoin({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/queue/{robotId}/join',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Leave the control queue
     * @returns any
     * @throws ApiError
     */
    public static queueControllerLeave({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/queue/{robotId}/leave',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Vote for a user in the queue
     * @returns any
     * @throws ApiError
     */
    public static queueControllerVote({
        robotId,
        targetUserId,
    }: {
        robotId: string,
        targetUserId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/queue/{robotId}/vote/{targetUserId}',
            path: {
                'robotId': robotId,
                'targetUserId': targetUserId,
            },
        });
    }
}
