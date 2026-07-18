/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuthService {
    /**
     * Register a new user
     * @returns any
     * @throws ApiError
     */
    public static authControllerRegister(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/register',
        });
    }
    /**
     * Issue CSRF token for double-submit protection
     * @returns any
     * @throws ApiError
     */
    public static authControllerGetCsrfToken(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/auth/csrf',
        });
    }
    /**
     * Login with email/password
     * @returns any
     * @throws ApiError
     */
    public static authControllerLogin(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/login',
        });
    }
    /**
     * Refresh access token
     * @returns any
     * @throws ApiError
     */
    public static authControllerRefresh(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/refresh',
        });
    }
    /**
     * Logout / revoke refresh tokens
     * @returns any
     * @throws ApiError
     */
    public static authControllerLogout(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/logout',
        });
    }
    /**
     * Revoke all refresh tokens for the current user (sign out everywhere)
     * @returns any
     * @throws ApiError
     */
    public static authControllerLogoutAll(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/logout-all',
        });
    }
    /**
     * Request a password reset email
     * @returns any
     * @throws ApiError
     */
    public static authControllerForgotPassword(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/forgot-password',
        });
    }
    /**
     * Reset password with token
     * @returns any
     * @throws ApiError
     */
    public static authControllerResetPassword(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/reset-password',
        });
    }
    /**
     * Verify email address with one-time token
     * @returns any
     * @throws ApiError
     */
    public static authControllerVerifyEmail({
        token,
    }: {
        token: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/auth/verify-email',
            query: {
                'token': token,
            },
        });
    }
    /**
     * Resend an email verification link
     * @returns any
     * @throws ApiError
     */
    public static authControllerResendVerifyEmail(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/auth/verify-email/resend',
        });
    }
}
