/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NotificationsService {
    /**
     * List notifications for the current user
     * @returns any
     * @throws ApiError
     */
    public static notificationsControllerList({
        cursor,
        limit,
    }: {
        cursor: string,
        limit: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications',
            query: {
                'cursor': cursor,
                'limit': limit,
            },
        });
    }
    /**
     * Mark one notification as read
     * @returns any
     * @throws ApiError
     */
    public static notificationsControllerMarkRead({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/notifications/{id}/read',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Mark all notifications as read
     * @returns any
     * @throws ApiError
     */
    public static notificationsControllerMarkAllRead(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/notifications/read-all',
        });
    }
    /**
     * Get notification preferences
     * @returns any
     * @throws ApiError
     */
    public static notificationsControllerGetPreferences(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications/preferences',
        });
    }
    /**
     * Update notification preferences
     * @returns any
     * @throws ApiError
     */
    public static notificationsControllerUpdatePreferences(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/notifications/preferences',
        });
    }
}
