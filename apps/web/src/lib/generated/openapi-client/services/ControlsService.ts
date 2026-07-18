/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateControlButtonDto } from '../models/CreateControlButtonDto';
import type { ReorderControlButtonsDto } from '../models/ReorderControlButtonsDto';
import type { UpdateControlButtonDto } from '../models/UpdateControlButtonDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ControlsService {
    /**
     * Get active control buttons for a robot
     * @returns any
     * @throws ApiError
     */
    public static controlsControllerGetPublicButtons({
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
            url: '/controls/robot/{robotId}',
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
     * Create a control button
     * @returns any
     * @throws ApiError
     */
    public static controlsControllerCreate({
        robotId,
        requestBody,
    }: {
        robotId: string,
        requestBody: CreateControlButtonDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/controls/robot/{robotId}',
            path: {
                'robotId': robotId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get all control buttons (owner only)
     * @returns any
     * @throws ApiError
     */
    public static controlsControllerGetAllButtons({
        robotId,
    }: {
        robotId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/controls/robot/{robotId}/all',
            path: {
                'robotId': robotId,
            },
        });
    }
    /**
     * Update a control button
     * @returns any
     * @throws ApiError
     */
    public static controlsControllerUpdate({
        buttonId,
        requestBody,
    }: {
        buttonId: string,
        requestBody: UpdateControlButtonDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/controls/{buttonId}',
            path: {
                'buttonId': buttonId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a control button
     * @returns void
     * @throws ApiError
     */
    public static controlsControllerRemove({
        buttonId,
    }: {
        buttonId: string,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/controls/{buttonId}',
            path: {
                'buttonId': buttonId,
            },
        });
    }
    /**
     * Reorder control buttons
     * @returns void
     * @throws ApiError
     */
    public static controlsControllerReorder({
        robotId,
        requestBody,
    }: {
        robotId: string,
        requestBody: ReorderControlButtonsDto,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/controls/robot/{robotId}/reorder',
            path: {
                'robotId': robotId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
