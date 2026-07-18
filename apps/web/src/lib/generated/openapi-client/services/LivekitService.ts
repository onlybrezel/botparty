/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class LivekitService {
    /**
     * Get LiveKit viewer/controller token
     * @returns any
     * @throws ApiError
     */
    public static livekitControllerGetViewerToken({
        robotId,
        control,
        roomAccessToken,
    }: {
        robotId: string,
        control: string,
        roomAccessToken: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/livekit/token/viewer/{robotId}',
            path: {
                'robotId': robotId,
            },
            query: {
                'control': control,
                'roomAccessToken': roomAccessToken,
            },
        });
    }
    /**
     * Get guest LiveKit viewer token (ACL-aware)
     * @returns any
     * @throws ApiError
     */
    public static livekitControllerGetPublicViewerToken({
        robotId,
        guestSessionId,
        roomAccessToken,
    }: {
        robotId: string,
        guestSessionId: string,
        roomAccessToken: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/livekit/token/viewer-public/{robotId}',
            path: {
                'robotId': robotId,
            },
            query: {
                'guestSessionId': guestSessionId,
                'roomAccessToken': roomAccessToken,
            },
        });
    }
    /**
     * Get LiveKit robot publisher token
     * @returns any
     * @throws ApiError
     */
    public static livekitControllerGetRobotToken({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/livekit/token/robot/{robotId}',
            path: {
                'robotId': robotId,
            },
        });
    }
}
