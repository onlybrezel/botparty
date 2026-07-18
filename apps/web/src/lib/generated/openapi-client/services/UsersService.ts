/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UsersService {
    /**
     * Get current user profile
     * @returns any
     * @throws ApiError
     */
    public static usersControllerGetMe(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/me',
        });
    }
    /**
     * Update current user profile
     * @returns any
     * @throws ApiError
     */
    public static usersControllerUpdateMe(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/me',
        });
    }
    /**
     * Delete own account (GDPR self-service)
     * @returns void
     * @throws ApiError
     */
    public static usersControllerDeleteMe(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/users/me',
        });
    }
    /**
     * Export own account data
     * @returns any
     * @throws ApiError
     */
    public static usersControllerExportMe(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/users/me/export',
        });
    }
    /**
     * Upload own avatar to platform storage
     * @returns any
     * @throws ApiError
     */
    public static usersControllerUploadAvatar(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/users/me/avatar',
        });
    }
    /**
     * Remove own avatar
     * @returns any
     * @throws ApiError
     */
    public static usersControllerDeleteAvatar(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/users/me/avatar',
        });
    }
    /**
     * List users for admin/mod dashboard
     * @returns any
     * @throws ApiError
     */
    public static usersControllerGetAdminUsers({
        q,
        limit,
    }: {
        q: string,
        limit: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/admin/list',
            query: {
                'q': q,
                'limit': limit,
            },
        });
    }
    /**
     * Update user profile/role as staff
     * @returns any
     * @throws ApiError
     */
    public static usersControllerUpdateAdminUser({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/admin/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Delete user account as staff
     * @returns any
     * @throws ApiError
     */
    public static usersControllerDeleteAdminUser({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/users/admin/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get credits leaderboard
     * @returns any
     * @throws ApiError
     */
    public static usersControllerGetLeaderboard({
        limit,
        period,
        metric,
    }: {
        limit: string,
        period: string,
        metric: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/leaderboard',
            query: {
                'limit': limit,
                'period': period,
                'metric': metric,
            },
        });
    }
    /**
     * Get user by username
     * @returns any
     * @throws ApiError
     */
    public static usersControllerGetByUsername({
        username,
    }: {
        username: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/{username}',
            path: {
                'username': username,
            },
        });
    }
}
