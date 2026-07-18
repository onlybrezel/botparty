/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SessionsService {
    /**
     * Get my session history
     * @returns any
     * @throws ApiError
     */
    public static sessionsControllerGetMySessions({
        limit,
    }: {
        limit: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/sessions/my',
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * Get detailed session replay data for the authenticated requester
     * @returns any
     * @throws ApiError
     */
    public static sessionsControllerGetMySession({
        sessionId,
    }: {
        sessionId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/sessions/my/{sessionId}',
            path: {
                'sessionId': sessionId,
            },
        });
    }
    /**
     * Get session history for a robot
     * @returns any
     * @throws ApiError
     */
    public static sessionsControllerGetByRobot({
        robotId,
        limit,
        authorization,
        cookie,
        roomAccessToken,
        guestSessionId,
    }: {
        robotId: string,
        limit: string,
        authorization: string,
        cookie: string,
        roomAccessToken: string,
        guestSessionId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/sessions/robot/{robotId}',
            path: {
                'robotId': robotId,
            },
            headers: {
                'authorization': authorization,
                'cookie': cookie,
            },
            query: {
                'limit': limit,
                'roomAccessToken': roomAccessToken,
                'guestSessionId': guestSessionId,
            },
        });
    }
    /**
     * Get active session for a robot
     * @returns any
     * @throws ApiError
     */
    public static sessionsControllerGetActiveSession({
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
            url: '/sessions/robot/{robotId}/active',
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
}
